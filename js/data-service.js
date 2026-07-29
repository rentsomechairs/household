import { FIREBASE_SETTINGS } from './firebase-config.js';
import { demoData } from './demo-data.js';

let firebase=null;
let householdId=FIREBASE_SETTINGS.householdId||'primary-home';
let memberCache=[];
const PENDING_ACTION_KEY='householdHubPendingAuthAction';
const DEVICE_AUTH_KEY='householdHubAuthorizedProfiles';
const DEVICE_MODE_KEY='householdHubDeviceMode';
const LAST_PROFILE_KEY='householdHubLastProfile';
const clone=value=>JSON.parse(JSON.stringify(value));

function shouldUseRedirect(){return /Silk\/|Kindle|KF[A-Z]{2,}|Echo/i.test(navigator.userAgent||'');}
function savePendingAction(action){sessionStorage.setItem(PENDING_ACTION_KEY,JSON.stringify(action||{}));}
function takePendingAction(){try{const value=JSON.parse(sessionStorage.getItem(PENDING_ACTION_KEY)||'{}');sessionStorage.removeItem(PENDING_ACTION_KEY);return value;}catch{return {};}}
function authorizedMap(){try{return JSON.parse(localStorage.getItem(DEVICE_AUTH_KEY)||'{}');}catch{return {};}}
function saveAuthorizedMap(map){localStorage.setItem(DEVICE_AUTH_KEY,JSON.stringify(map));}
function clean(value){if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,clean(v)]));return value;}

async function initFirebase(){
  if(!FIREBASE_SETTINGS.enabled)return false;
  const appMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
  const authMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  const fsMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const app=appMod.initializeApp(FIREBASE_SETTINGS.config);
  const auth=authMod.getAuth(app);
  await authMod.setPersistence(auth,authMod.browserLocalPersistence);
  firebase={app,auth,db:fsMod.getFirestore(app),authMod,fsMod};

  if(typeof auth.authStateReady==='function')await auth.authStateReady();
  const redirectResult=await authMod.getRedirectResult(auth);
  if(redirectResult?.user){
    const pending=takePendingAction();
    await ensureHousehold();
    if(pending.profileUid&&redirectResult.user.uid!==pending.profileUid){await authMod.signOut(auth);throw new Error('That Google account does not match the selected profile.');}
    await upsertCurrentMember(pending.nickname||'');
    if(pending.profileUid)authorizeProfileOnDevice(pending.profileUid);
  }
  if(isGoogleUser(auth.currentUser)){await ensureHousehold();await upsertCurrentMember('');}
  return true;
}
function householdRef(){return firebase.fsMod.doc(firebase.db,'households',householdId);}
function collectionRef(name){return firebase.fsMod.collection(firebase.db,'households',householdId,name);}
function requireAuth(){if(!firebase?.auth.currentUser)throw new Error('Sign in before accessing household data.');}
function isGoogleUser(user=firebase?.auth.currentUser){return Boolean(user&&!user.isAnonymous&&user.providerData?.some(p=>p.providerId==='google.com'));}
async function ensureAnonymousSession(){if(!firebase.auth.currentUser)await firebase.authMod.signInAnonymously(firebase.auth);return firebase.auth.currentUser;}
async function ensureHousehold(){const ref=householdRef();const snap=await firebase.fsMod.getDoc(ref);if(!snap.exists())await firebase.fsMod.setDoc(ref,{createdAt:firebase.fsMod.serverTimestamp(),schemaVersion:3},{merge:true});}
async function docsToArray(name){const snap=await firebase.fsMod.getDocs(collectionRef(name));return snap.docs.map(d=>({id:d.id,...d.data()}));}
function memberSortValue(member){
  if(Number.isFinite(Number(member.profileOrder)))return Number(member.profileOrder);
  if(Number.isFinite(Number(member.createdAtMs)))return Number(member.createdAtMs);
  if(member.createdAt?.toMillis)return member.createdAt.toMillis();
  if(member.lastSeenAt?.toMillis)return member.lastSeenAt.toMillis();
  return Number.MAX_SAFE_INTEGER;
}
async function refreshMembers(){await ensureAnonymousSession();memberCache=(await docsToArray('members')).sort((a,b)=>memberSortValue(a)-memberSortValue(b));return clone(memberCache);}
async function upsertCurrentMember(nickname=''){
  requireAuth();
  const user=firebase.auth.currentUser;
  if(user.isAnonymous)throw new Error('Google sign-in is required to create a profile.');
  const ref=firebase.fsMod.doc(collectionRef('members'),user.uid);
  const snap=await firebase.fsMod.getDoc(ref);
  const existing=snap.exists()?snap.data():null;
  const now=Date.now();
  if(existing){
    const updates={photoURL:user.photoURL||'',lastSeenAt:firebase.fsMod.serverTimestamp()};
    if(nickname.trim())updates.nickname=nickname.trim();
    await firebase.fsMod.setDoc(ref,updates,{merge:true});
  }else{
    await firebase.fsMod.setDoc(ref,{uid:user.uid,name:user.displayName||user.email||'Google user',email:user.email||'',photoURL:user.photoURL||'',nickname:nickname.trim()||user.displayName||user.email||'Google user',lastSeenAt:firebase.fsMod.serverTimestamp(),createdAt:firebase.fsMod.serverTimestamp(),createdAtMs:now,profileOrder:now},{merge:true});
  }
  localStorage.setItem(LAST_PROFILE_KEY,user.uid);
  await refreshMembers();
  return user.uid;
}
async function beginGoogle(action={}){
  if(firebase.auth.currentUser?.isAnonymous)await firebase.authMod.signOut(firebase.auth);
  const provider=new firebase.authMod.GoogleAuthProvider();
  provider.setCustomParameters(action.loginHint?{prompt:'select_account',login_hint:action.loginHint}:{prompt:'select_account'});
  if(shouldUseRedirect()){
    savePendingAction(action);await firebase.authMod.signInWithRedirect(firebase.auth,provider);return {redirecting:true};
  }
  try{
    const result=await firebase.authMod.signInWithPopup(firebase.auth,provider);await ensureHousehold();if(action.profileUid&&result.user.uid!==action.profileUid){await firebase.authMod.signOut(firebase.auth);throw new Error('That Google account does not match the selected profile.');}await upsertCurrentMember(action.nickname||'');if(action.profileUid)authorizeProfileOnDevice(action.profileUid);return result;
  }catch(error){
    if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/web-storage-unsupported'].includes(error?.code)){savePendingAction(action);await firebase.authMod.signInWithRedirect(firebase.auth,provider);return {redirecting:true};}
    throw error;
  }
}
function authorizeProfileOnDevice(uid){const map=authorizedMap();map[uid]=Date.now();saveAuthorizedMap(map);}

export const dataService={
  async init(){try{const ok=await initFirebase();if(ok){await ensureAnonymousSession();await refreshMembers();}return ok;}catch(error){console.error(error);return false;}},
  isFirebaseEnabled(){return Boolean(firebase);},
  getCurrentUser(){return firebase?.auth.currentUser||null;},
  isGoogleSignedIn(){return isGoogleUser();},
  getKnownProfiles(){return clone(memberCache);},
  getProfilePhoto(profile){return profile?.customPhotoURL||profile?.photoURL||'';},
  isEchoDevice(){return localStorage.getItem(DEVICE_MODE_KEY)==='echo';},
  setEchoDevice(){localStorage.setItem(DEVICE_MODE_KEY,'echo');},
  resetEchoDevice(){localStorage.removeItem(DEVICE_MODE_KEY);},
  getLastProfileUid(){return localStorage.getItem(LAST_PROFILE_KEY)||'';},
  async loadProfiles(){return refreshMembers();},
  isProfileAuthorized(uid){return isGoogleUser()&&firebase.auth.currentUser.uid===uid||Boolean(authorizedMap()[uid]);},
  authorizeProfileOnDevice,
  removeDeviceAuthorization(uid){const map=authorizedMap();delete map[uid];saveAuthorizedMap(map);},
  async forgetProfile(uid){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('members'),uid));this.removeDeviceAuthorization(uid);memberCache=memberCache.filter(p=>p.uid!==uid);},
  async updateProfile(uid,changes={}){requireAuth();if(!uid)throw new Error('No active profile selected.');const nickname=String(changes.nickname||'').trim();if(!nickname)throw new Error('Enter a nickname.');const profileColor=/^#[0-9a-f]{6}$/i.test(changes.profileColor||'')?changes.profileColor:'#4f6f66';const payload={nickname,profileColor,updatedAt:firebase.fsMod.serverTimestamp()};if(Object.prototype.hasOwnProperty.call(changes,'customPhotoURL'))payload.customPhotoURL=changes.customPhotoURL||firebase.fsMod.deleteField();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('members'),uid),payload,{merge:true});await refreshMembers();return clone(memberCache.find(p=>p.uid===uid));},
  async reorderProfiles(orderedUids){requireAuth();const current=new Map(memberCache.map(p=>[p.uid,Number(p.profileOrder)]));const batch=firebase.fsMod.writeBatch(firebase.db);let writes=0;orderedUids.forEach((uid,index)=>{if(current.get(uid)!==index){batch.update(firebase.fsMod.doc(collectionRef('members'),uid),{profileOrder:index});writes++;}});if(writes)await batch.commit();await refreshMembers();return clone(memberCache);},
  async renameProfile(uid,name){requireAuth();if(!name.trim())return;await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('members'),uid),{nickname:name.trim()},{merge:true});await refreshMembers();},
  onAuthChanged(callback){if(!firebase){callback(null);return()=>{};}return firebase.authMod.onAuthStateChanged(firebase.auth,callback);},
  async signIn(loginHint='',nickname='',profileUid=''){return beginGoogle({loginHint,nickname,profileUid});},
  async switchProfile(profile){return beginGoogle({loginHint:profile?.email||'',profileUid:profile?.uid||''});},
  async signOut(){if(firebase)await firebase.authMod.signOut(firebase.auth);await ensureAnonymousSession();},
  async createPhoneAuthRequest({profileUid='',nickname=''}){
    await ensureAnonymousSession();const code=Math.random().toString(36).slice(2,6).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
    const ref=firebase.fsMod.doc(collectionRef('authRequests'),code);
    await firebase.fsMod.setDoc(ref,{code,profileUid,nickname,status:'pending',createdAt:firebase.fsMod.serverTimestamp(),expiresAt:Date.now()+10*60*1000,requestingUid:firebase.auth.currentUser.uid});
    const approvalUrl=new URL(location.href);approvalUrl.search='';approvalUrl.hash='';approvalUrl.searchParams.set('approve',code);return {code,url:approvalUrl.toString()};
  },
  watchPhoneAuthRequest(code,callback,onError){const ref=firebase.fsMod.doc(collectionRef('authRequests'),code);return firebase.fsMod.onSnapshot(ref,s=>callback(s.exists()?s.data():null),onError);},
  async approvePhoneAuthRequest(code){
    if(!isGoogleUser())throw new Error('Sign in with Google on this phone first.');
    const ref=firebase.fsMod.doc(collectionRef('authRequests'),code);const snap=await firebase.fsMod.getDoc(ref);if(!snap.exists())throw new Error('This sign-in request no longer exists.');
    const request=snap.data();if(request.expiresAt<Date.now())throw new Error('This sign-in request expired.');
    const uid=await upsertCurrentMember(request.nickname||'');
    if(request.profileUid&&request.profileUid!==uid)throw new Error('This Google account does not match the selected profile.');
    await firebase.fsMod.updateDoc(ref,{status:'approved',approvedUid:uid,approvedAt:firebase.fsMod.serverTimestamp()});return uid;
  },
  async deletePhoneAuthRequest(code){try{await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('authRequests'),code));}catch{}},
  async signInForApproval(code){return beginGoogle({approvalCode:code});},
  setHousehold(id){householdId=id||FIREBASE_SETTINGS.householdId||'primary-home';},getHouseholdId(){return householdId;},
  async getAll(){requireAuth();await ensureHousehold();const [settingsSnap,events,lists,tasks,completionDocs,members]=await Promise.all([firebase.fsMod.getDoc(firebase.fsMod.doc(collectionRef('configuration'),'settings')),docsToArray('events'),docsToArray('lists'),docsToArray('tasks'),docsToArray('completions'),refreshMembers()]);const completions={};completionDocs.forEach(x=>{completions[x.id]=Boolean(x.done);});return {settings:settingsSnap.exists()?settingsSnap.data():clone(demoData.settings),events,lists,tasks,completions,members};},
  async createEvent(event){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('events'),event.id),clean(event));},async updateEvent(id,changes){requireAuth();await firebase.fsMod.updateDoc(firebase.fsMod.doc(collectionRef('events'),id),clean(changes));},async deleteEvent(id){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('events'),id));},
  async createTask(task){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('tasks'),task.id),clean(task));},async deleteTask(id){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('tasks'),id));},async setCompletion(id,done){requireAuth();const ref=firebase.fsMod.doc(collectionRef('completions'),id);if(done)await firebase.fsMod.setDoc(ref,{done:true});else await firebase.fsMod.deleteDoc(ref);},
  async createList(list){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('lists'),list.id),clean(list));},async updateList(list){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('lists'),list.id),clean(list));},async updateListItems(id,items){requireAuth();await firebase.fsMod.updateDoc(firebase.fsMod.doc(collectionRef('lists'),id),{items:clean(items)});},async deleteList(id){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('lists'),id));},async saveSettings(settings){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('configuration'),'settings'),clean(settings),{merge:true});}
};
