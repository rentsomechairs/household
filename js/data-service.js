import { FIREBASE_SETTINGS } from './firebase-config.js';
import { demoData } from './demo-data.js';

let firebase=null;
let householdId=FIREBASE_SETTINGS.householdId||'primary-home';
let memberCache=[];
const clone=value=>JSON.parse(JSON.stringify(value));

async function initFirebase(){
  if(!FIREBASE_SETTINGS.enabled)return false;
  const appMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
  const authMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  const fsMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const app=appMod.initializeApp(FIREBASE_SETTINGS.config);
  const auth=authMod.getAuth(app);
  await authMod.setPersistence(auth,authMod.browserLocalPersistence);
  firebase={app,auth,db:fsMod.getFirestore(app),authMod,fsMod};
  return true;
}

function requireAuth(){
  if(!firebase?.auth.currentUser)throw new Error('Sign in before accessing household data.');
}
function householdRef(){return firebase.fsMod.doc(firebase.db,'households',householdId);}
function collectionRef(name){return firebase.fsMod.collection(firebase.db,'households',householdId,name);}
function clean(value){
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,clean(v)]));
  return value;
}
async function ensureHousehold(){
  const {getDoc,setDoc,serverTimestamp}=firebase.fsMod;
  const ref=householdRef();
  const snap=await getDoc(ref);
  if(!snap.exists())await setDoc(ref,{createdAt:serverTimestamp(),schemaVersion:2},{merge:true});
  return snap;
}
async function migrateLegacyIfNeeded(){
  const {getDoc,writeBatch,doc,deleteField,serverTimestamp}=firebase.fsMod;
  const ref=householdRef();
  const snap=await getDoc(ref);
  if(!snap.exists())return false;
  const old=snap.data();
  if(!Array.isArray(old.events)&&!Array.isArray(old.tasks)&&!Array.isArray(old.lists))return false;
  const batch=writeBatch(firebase.db);
  for(const event of old.events||[])batch.set(doc(collectionRef('events'),event.id),clean(event));
  for(const task of old.tasks||[])batch.set(doc(collectionRef('tasks'),task.id),clean(task));
  for(const list of old.lists||[])batch.set(doc(collectionRef('lists'),list.id),clean(list));
  for(const [id,done] of Object.entries(old.completions||{}))batch.set(doc(collectionRef('completions'),id),{done:Boolean(done)});
  batch.set(doc(collectionRef('configuration'),'settings'),clean(old.settings||demoData.settings),{merge:true});
  batch.update(ref,{events:deleteField(),tasks:deleteField(),lists:deleteField(),completions:deleteField(),settings:deleteField(),schemaVersion:2,migratedAt:serverTimestamp()});
  await batch.commit();
  return true;
}
async function docsToArray(name){
  const snap=await firebase.fsMod.getDocs(collectionRef(name));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function refreshMembers(){
  requireAuth();
  memberCache=(await docsToArray('members')).sort((a,b)=>(a.nickname||a.name||'').localeCompare(b.nickname||b.name||''));
  return clone(memberCache);
}
async function upsertCurrentMember(nickname=''){
  requireAuth();
  const user=firebase.auth.currentUser;
  const ref=firebase.fsMod.doc(collectionRef('members'),user.uid);
  const prior=memberCache.find(p=>p.uid===user.uid);
  const profile={
    uid:user.uid,
    nickname:nickname.trim()||prior?.nickname||user.displayName||user.email||'Google user',
    name:user.displayName||user.email||'Google user',
    email:user.email||'',photoURL:user.photoURL||'',
    lastSeenAt:firebase.fsMod.serverTimestamp()
  };
  await firebase.fsMod.setDoc(ref,profile,{merge:true});
  await refreshMembers();
}

export const dataService={
  async init(){try{return await initFirebase();}catch(error){console.error(error);return false;}},
  isFirebaseEnabled(){return Boolean(firebase);},
  getCurrentUser(){return firebase?.auth.currentUser||null;},
  getKnownProfiles(){return clone(memberCache);},
  async loadProfiles(){return refreshMembers();},
  async forgetProfile(uid){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('members'),uid));memberCache=memberCache.filter(p=>p.uid!==uid);},
  async renameProfile(uid,name){requireAuth();if(!name.trim())return;await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('members'),uid),{nickname:name.trim()},{merge:true});await refreshMembers();},
  onAuthChanged(callback){if(!firebase){callback(null);return()=>{};}return firebase.authMod.onAuthStateChanged(firebase.auth,callback);},
  async signIn(loginHint='',nickname=''){
    if(!firebase)throw new Error('Firebase is not configured.');
    const provider=new firebase.authMod.GoogleAuthProvider();
    provider.setCustomParameters(loginHint?{prompt:'select_account',login_hint:loginHint}:{prompt:'select_account'});
    const result=await firebase.authMod.signInWithPopup(firebase.auth,provider);
    await ensureHousehold();
    await upsertCurrentMember(nickname);
    return result;
  },
  async switchProfile(profile){return this.signIn(profile?.email||'',profile?.nickname||profile?.name||'');},
  async signOut(){if(firebase)await firebase.authMod.signOut(firebase.auth);memberCache=[];},
  setHousehold(id){householdId=id||FIREBASE_SETTINGS.householdId||'primary-home';},
  getHouseholdId(){return householdId;},

  async getAll(){
    requireAuth();
    await ensureHousehold();
    await migrateLegacyIfNeeded();
    await upsertCurrentMember();
    const {getDoc,doc}=firebase.fsMod;
    const [settingsSnap,events,lists,tasks,completionDocs,members]=await Promise.all([
      getDoc(doc(collectionRef('configuration'),'settings')),
      docsToArray('events'),docsToArray('lists'),docsToArray('tasks'),docsToArray('completions'),refreshMembers()
    ]);
    const completions={};
    completionDocs.forEach(x=>{completions[x.id]=Boolean(x.done);});
    return {settings:settingsSnap.exists()?settingsSnap.data():clone(demoData.settings),events,lists,tasks,completions,members};
  },

  async createEvent(event){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('events'),event.id),clean(event));},
  async deleteEvent(id){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('events'),id));},
  async createTask(task){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('tasks'),task.id),clean(task));},
  async deleteTask(id){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('tasks'),id));},
  async setCompletion(id,done){requireAuth();const ref=firebase.fsMod.doc(collectionRef('completions'),id);if(done)await firebase.fsMod.setDoc(ref,{done:true});else await firebase.fsMod.deleteDoc(ref);},
  async createList(list){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('lists'),list.id),clean(list));},
  async updateList(list){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('lists'),list.id),clean(list));},
  async updateListItems(id,items){requireAuth();await firebase.fsMod.updateDoc(firebase.fsMod.doc(collectionRef('lists'),id),{items:clean(items)});},
  async deleteList(id){requireAuth();await firebase.fsMod.deleteDoc(firebase.fsMod.doc(collectionRef('lists'),id));},
  async saveSettings(settings){requireAuth();await firebase.fsMod.setDoc(firebase.fsMod.doc(collectionRef('configuration'),'settings'),clean(settings),{merge:true});}
};
