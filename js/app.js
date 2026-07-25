import { dataService } from './data-service.js';

let state={settings:{},events:[],lists:[],tasks:[],completions:{}};
let currentMonth=new Date();currentMonth.setDate(1);
let selectedDate=new Date();
let dashboardDays=1;
let taskFilter='all';
let activeListId=null;
let activeUser=null;
let profilesEditing=false;
let pendingAuthProfile=null;
let pendingNickname="";
let phoneAuthUnsubscribe=null;
let phoneAuthCode="";

const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
const iso=d=>{const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,10)};
const parseDate=s=>new Date(`${s}T12:00:00`);
const uid=p=>`${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const escapeHtml=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));


function initials(name='Household'){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'HH';}
function showProfileGate(message='Select a profile to continue'){
  $('#profileGateMessage').textContent=message;
  $('#profileGate').hidden=false;
  $('#app').classList.add('app-locked');
  $('#app').setAttribute('aria-hidden','true');
  renderProfileChooser();
}
function enterApp(){
  $('#profileGate').hidden=true;
  $('#app').classList.remove('app-locked');
  $('#app').setAttribute('aria-hidden','false');
}
function profileCard(profile,current=false){
  const displayName=profile.nickname||profile.name||profile.email||'Google user';
  const authorized=dataService.isProfileAuthorized(profile.uid);
  const photo=profile.photoURL?`<img src="${escapeHtml(profile.photoURL)}" alt="">`:`<span>${initials(displayName)}</span>`;
  return `<div class="profile-choice-wrap"><button type="button" class="profile-choice ${current?'current':''} ${authorized?'authorized':''}" data-profile-uid="${escapeHtml(profile.uid)}" data-profile-email="${escapeHtml(profile.email||'')}"><span class="profile-avatar">${photo}</span><strong>${escapeHtml(displayName)}</strong><small>${authorized?'Ready on this device':'Tap to sign in'}</small></button>${profilesEditing?`<button type="button" class="profile-remove" data-remove-profile="${escapeHtml(profile.uid)}" aria-label="Remove household profile">×</button>`:''}</div>`;
}
function renderProfileChooser(){
  const chooser=$('#profileChooser');
  const profiles=dataService.getKnownProfiles();
  const current=dataService.getCurrentUser();
  let html=profiles.map(p=>profileCard(p,current?.uid===p.uid)).join('');
  html+=`<button type="button" class="profile-choice add-profile-choice" id="addGoogleProfile"><span class="profile-avatar"><span class="plus-mark">+</span></span><strong>Add profile</strong><small>Sign in with Google</small></button>`;
  chooser.innerHTML=html;
  $('#continueDemoButton').hidden=dataService.isFirebaseEnabled();
  $('#manageProfilesButton').textContent=profilesEditing?'Done editing':'Edit profiles';
}
async function loadSignedInHousehold(user){
  activeUser=user;
  dataService.setHousehold();
  showLoading('Loading household…');
  try{state=await dataService.getAll();}finally{hideLoading();}
  const label=user.nickname||user.name||user.displayName||user.email||'Household profile';
  $('#profileInitials').textContent=initials(label);
  $('#profileInitials').hidden=Boolean(user.photoURL);
  $('#profilePhoto').hidden=!user.photoURL;
  if(user.photoURL)$('#profilePhoto').src=user.photoURL;
  $('#signInButton').hidden=true;
  $('#signOutButton').hidden=false;
  $('#authStatus').textContent=`Using ${label} · Shared household: ${dataService.getHouseholdId()}`;
  renderAll();
}

function showToast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
let loadingDepth=0;
function showLoading(message='Syncing with Firebase…'){loadingDepth++;$('#loadingMessage').textContent=message;$('#loadingOverlay').hidden=false;}
function hideLoading(){loadingDepth=Math.max(0,loadingDepth-1);if(!loadingDepth)$('#loadingOverlay').hidden=true;}
async function withLoading(message,work){showLoading(message);try{return await work();}catch(error){console.error(error);showToast(error.message||'Firebase request failed');throw error;}finally{hideLoading();}}
function formatTime(time){if(!time)return 'All day';const [h,m]=time.split(':');return new Date(2000,0,1,+h,+m).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
function dateLabel(d,opts={}){return d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric',...opts});}

function updateGreeting(){const now=new Date();const hour=now.getHours();$('#greeting').textContent=`Good ${hour<12?'morning':hour<17?'afternoon':'evening'}`;$('#todayLabel').textContent=now.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});document.title=state.settings.homeTitle||'Household Hub';}
function switchView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('[data-view-target]').forEach(b=>b.classList.toggle('active',b.dataset.viewTarget===id && b.closest('.bottom-nav')));if(id==='calendarView')renderCalendar();window.scrollTo({top:0,behavior:'smooth'});}

function renderUpcoming(){const todayIso=iso(new Date());const items=state.events.filter(e=>e.date>=todayIso).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,4);$('#upcomingEvents').innerHTML=items.length?items.map(eventRow).join(''):'<p class="muted">Nothing scheduled yet.</p>';}
function eventRow(e){const d=parseDate(e.date);return `<div class="event-row"><div class="event-date"><span>${d.toLocaleDateString([],{month:'short'})}</span>${d.getDate()}</div><div><h4>${escapeHtml(e.title)}</h4><p>${formatTime(e.time)}${e.notes?` · ${escapeHtml(e.notes)}`:''}</p></div><button class="icon-button delete-event" data-id="${e.id}" aria-label="Delete event">×</button></div>`;}

function taskOccurs(task,date){
  if(task.frequency==='daily')return true;
  if(task.frequency==='weekly')return (task.days||[]).includes(date.getDay());
  if(task.frequency==='monthly'){
    if(task.monthlyMode==='ordinalWeekday'){
      if(date.getDay()!==Number(task.monthWeekday))return false;
      const ordinal=Number(task.monthOrdinal||1);
      if(ordinal===-1){const nextWeek=new Date(date);nextWeek.setDate(date.getDate()+7);return nextWeek.getMonth()!==date.getMonth();}
      return Math.ceil(date.getDate()/7)===ordinal;
    }
    return date.getDate()===Number(task.monthDay||1);
  }
  return task.date===iso(date);
}
function activeProfile(){const user=activeUser||dataService.getCurrentUser();return dataService.getKnownProfiles().find(p=>p.uid===user?.uid)||null;}
function taskVisibleToCurrentUser(task){const assigned=task.assigneeUid||'everyone';return assigned==='everyone'||assigned===activeUser?.uid||assigned===dataService.getCurrentUser()?.uid;}
function taskAssigneeLabel(task){if(!task.assigneeUid||task.assigneeUid==='everyone')return 'Everyone';return task.assigneeName||dataService.getKnownProfiles().find(p=>p.uid===task.assigneeUid)?.name||'Assigned profile';}
function completionKey(taskId,date){return `${taskId}__${iso(date)}`;}
function renderDashboardTasks(){let html='';for(let i=0;i<dashboardDays;i++){const d=new Date();d.setDate(d.getDate()+i);const tasks=state.tasks.filter(t=>taskVisibleToCurrentUser(t)&&taskOccurs(t,d));html+=`<div class="task-day"><h3>${i===0?'Today':dateLabel(d)}</h3>${tasks.length?tasks.map(t=>taskRow(t,d)).join(''):'<p class="muted">No tasks scheduled.</p>'}</div>`;}$('#dashboardTasks').innerHTML=html;}
function taskRow(t,d){const done=Boolean(state.completions[completionKey(t.id,d)]);return `<div class="task-row"><button class="task-check ${done?'done':''}" data-task-id="${t.id}" data-date="${iso(d)}">${done?'✓':''}</button><div class="task-copy"><h4>${escapeHtml(t.title)}</h4><p>${escapeHtml(taskAssigneeLabel(t))}</p></div></div>`;}

function renderCalendar(){const y=currentMonth.getFullYear(),m=currentMonth.getMonth();$('#calendarMonthLabel').textContent=currentMonth.toLocaleDateString([],{month:'long',year:'numeric'});const first=new Date(y,m,1);const start=new Date(y,m,1-first.getDay());let cells='';for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const dayEvents=state.events.filter(e=>e.date===iso(d));cells+=`<button class="calendar-day ${d.getMonth()!==m?'outside':''} ${iso(d)===iso(new Date())?'today':''} ${iso(d)===iso(selectedDate)?'selected':''}" data-date="${iso(d)}"><span class="day-number">${d.getDate()}</span>${dayEvents.slice(0,2).map(e=>`<span class="event-dot">${escapeHtml(e.title)}</span>`).join('')}</button>`;}$('#calendarGrid').innerHTML=cells;renderSelectedDay();}
function renderSelectedDay(){const events=state.events.filter(e=>e.date===iso(selectedDate)).sort((a,b)=>a.time.localeCompare(b.time));$('#selectedDateLabel').textContent=selectedDate.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});$('#selectedDayEvents').innerHTML=events.length?events.map(eventRow).join(''):'<p class="muted">No events for this day.</p>';}

function renderLists(){$('#listsGrid').innerHTML=state.lists.length?state.lists.map(l=>{const done=l.items.filter(i=>i.done).length,total=l.items.length,pct=total?Math.round(done/total*100):0;return `<article class="card list-card" data-list-id="${l.id}"><div class="list-card-header"><div><p class="section-kicker">${l.type}</p><h3>${escapeHtml(l.name)}</h3></div><span class="badge">${done}/${total}</span></div><div class="progress-track"><div class="progress-bar" style="width:${pct}%"></div></div></article>`}).join(''):'<div class="card"><p class="muted">Create your first household list.</p></div>';}
function openList(id){activeListId=id;const list=state.lists.find(l=>l.id===id);if(!list)return;$('#listDetailTitle').textContent=list.name;$('#clearListChecksButton').hidden=list.type!=='repeating';renderListItems();$('#listDetailDialog').showModal();}
function renderListItems(){const list=state.lists.find(l=>l.id===activeListId);$('#listDetailItems').innerHTML=list.items.length?list.items.map(i=>`<div class="detail-item ${i.done?'done':''}"><button type="button" class="task-check list-item-check ${i.done?'done':''}" data-id="${i.id}">${i.done?'✓':''}</button><span>${escapeHtml(i.text)}</span><button type="button" class="icon-button delete-list-item" data-id="${i.id}">×</button></div>`).join(''):'<p class="muted">No items yet.</p>';}

function renderTaskManager(){const filtered=state.tasks.filter(t=>taskVisibleToCurrentUser(t)&&(taskFilter==='all'||t.frequency===taskFilter));$('#taskManagerList').innerHTML=filtered.length?filtered.map(t=>`<article class="card manager-card"><div><p class="section-kicker">${t.frequency}</p><h3>${escapeHtml(t.title)}</h3><p class="muted">${taskScheduleText(t)} · ${escapeHtml(taskAssigneeLabel(t))}</p></div><div class="manager-actions"><button class="danger-button delete-task" data-id="${t.id}">Delete</button></div></article>`).join(''):'<div class="card"><p class="muted">No tasks in this category.</p></div>';}
function taskScheduleText(t){
  if(t.frequency==='daily')return'Every day';
  if(t.frequency==='once')return t.date?parseDate(t.date).toLocaleDateString():'No date';
  const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  if(t.frequency==='weekly')return (t.days||[]).map(d=>names[d]).join(', ')||'No days selected';
  if(t.frequency==='monthly'){
    if(t.monthlyMode==='ordinalWeekday'){
      const ordinals={'1':'First','2':'Second','3':'Third','4':'Fourth','5':'Fifth','-1':'Last'};
      const fullNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      return `${ordinals[String(t.monthOrdinal)]||'First'} ${fullNames[Number(t.monthWeekday)||0]} of each month`;
    }
    const day=Number(t.monthDay||1);const suffix=(day%10===1&&day%100!==11)?'st':(day%10===2&&day%100!==12)?'nd':(day%10===3&&day%100!==13)?'rd':'th';
    return `Every ${day}${suffix} day of the month`;
  }
  return '';
}
function populateTaskAssignees(){
  const select=$('#taskAssignee');if(!select)return;
  const current=select.value||'everyone';
  const profiles=dataService.getKnownProfiles();
  select.innerHTML='<option value="everyone">Everyone</option>'+profiles.map(p=>`<option value="${escapeHtml(p.uid)}">${escapeHtml(p.name)}</option>`).join('');
  select.value=[...select.options].some(o=>o.value===current)?current:'everyone';
}

function renderSettings(){ $('#householdNameInput').value=state.settings.householdName||'Our Home';$('#homeTitleInput').value=state.settings.homeTitle||'Household Hub';$('#authStatus').textContent=dataService.isFirebaseEnabled()?'Firebase is connected. Sign in to sync this household.':'Demo mode is active. Data is stored only in this browser.';$('#signInButton').hidden=!dataService.isFirebaseEnabled();}
function renderAll(){updateGreeting();renderUpcoming();renderDashboardTasks();renderCalendar();renderLists();renderTaskManager();renderSettings();}

function openEventDialog(){const form=$('#eventForm');form.reset();form.elements.date.value=iso(selectedDate||new Date());$('#eventDialog').showModal();}
function bindEvents(){
  document.addEventListener('click',e=>{const close=e.target.closest('.dialog-close');if(close){e.preventDefault();const dialog=close.closest('dialog');if(dialog)dialog.close();}});
  $$('[data-view-target]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.viewTarget)));
  $('#profileButton').addEventListener('click',()=>showProfileGate('Switch household profile'));$('#refreshButton').addEventListener('click',async()=>{await withLoading('Refreshing household…',async()=>{state=await dataService.getAll();renderAll();});showToast('Refreshed')});
  $('#quickAddEventButton').addEventListener('click',openEventDialog);$('#addEventButton').addEventListener('click',openEventDialog);
  $('#eventForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const event={id:uid('event'),title:f.get('title').trim(),date:f.get('date'),time:f.get('time'),notes:f.get('notes').trim()};$('#eventDialog').close();await withLoading('Saving event…',()=>dataService.createEvent(event));state.events.push(event);renderAll();showToast('Event added');});
  document.addEventListener('click',async e=>{const del=e.target.closest('.delete-event');if(del){await withLoading('Removing event…',()=>dataService.deleteEvent(del.dataset.id));state.events=state.events.filter(x=>x.id!==del.dataset.id);renderAll();showToast('Event removed');}});
  $('#taskRangeControl').addEventListener('click',e=>{const b=e.target.closest('button[data-days]');if(!b)return;dashboardDays=+b.dataset.days;$$('#taskRangeControl button').forEach(x=>x.classList.toggle('active',x===b));renderDashboardTasks();});
  document.addEventListener('click',async e=>{const b=e.target.closest('.task-check[data-task-id]');if(!b)return;const key=`${b.dataset.taskId}__${b.dataset.date}`;const done=!state.completions[key];state.completions[key]=done;renderDashboardTasks();try{await dataService.setCompletion(key,done);}catch(error){state.completions[key]=!done;renderDashboardTasks();showToast('Could not save completion');}});
  $('#prevMonth').addEventListener('click',()=>{currentMonth.setMonth(currentMonth.getMonth()-1);renderCalendar()});$('#nextMonth').addEventListener('click',()=>{currentMonth.setMonth(currentMonth.getMonth()+1);renderCalendar()});
  $('#calendarGrid').addEventListener('click',e=>{const b=e.target.closest('[data-date]');if(!b)return;selectedDate=parseDate(b.dataset.date);currentMonth=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);renderCalendar();});
  $('#addListButton').addEventListener('click',()=>{$('#listForm').reset();$('#listDialog').showModal()});
  $('#listForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const list={id:uid('list'),name:f.get('name').trim(),type:f.get('type'),resetOnComplete:f.get('resetOnComplete')==='on',items:[]};$('#listDialog').close();await withLoading('Creating list…',()=>dataService.createList(list));state.lists.push(list);renderAll();showToast('List created');});
  $('#listsGrid').addEventListener('click',e=>{const card=e.target.closest('[data-list-id]');if(card)openList(card.dataset.listId)});
  $('#addListItemButton').addEventListener('click',async()=>{const input=$('#newListItemInput');const text=input.value.trim();if(!text)return;const list=state.lists.find(l=>l.id===activeListId);const previousItems=structuredClone(list.items);list.items.push({id:uid('item'),text,done:false});input.value='';renderListItems();renderLists();try{await withLoading('Saving list…',()=>dataService.updateListItems(list.id,list.items));}catch(error){list.items=previousItems;renderListItems();renderLists();}});
  $('#listDetailItems').addEventListener('click',async e=>{
    const list=state.lists.find(l=>l.id===activeListId);if(!list)return;
    const check=e.target.closest('.list-item-check');const del=e.target.closest('.delete-list-item');if(!check&&!del)return;
    const previousItems=structuredClone(list.items);
    if(check){const item=list.items.find(i=>i.id===check.dataset.id);if(item)item.done=!item.done;}
    if(del)list.items=list.items.filter(i=>i.id!==del.dataset.id);
    const temporaryComplete=Boolean(check&&list.type==='temporary'&&list.items.length&&list.items.every(item=>item.done));
    renderListItems();renderLists();
    if(temporaryComplete){
      try{
        $('#listDetailDialog').close();
        await withLoading('Completing temporary list…',()=>dataService.deleteList(list.id));
        state.lists=state.lists.filter(item=>item.id!==list.id);activeListId=null;renderAll();showToast('Temporary list completed and removed');
      }catch(error){list.items=previousItems;renderListItems();renderLists();$('#listDetailDialog').showModal();}
      return;
    }
    try{await withLoading('Saving list…',()=>dataService.updateListItems(list.id,list.items));}catch(error){list.items=previousItems;renderListItems();renderLists();}
  });
  $('#clearListChecksButton').addEventListener('click',async()=>{
    const list=state.lists.find(l=>l.id===activeListId);if(!list||list.type!=='repeating')return;
    if(!list.items.some(item=>item.done)){showToast('No checkmarks to clear');return;}
    const previousItems=structuredClone(list.items);list.items=list.items.map(item=>({...item,done:false}));renderListItems();renderLists();
    try{await withLoading('Clearing checkmarks…',()=>dataService.updateListItems(list.id,list.items));showToast('All checkmarks cleared');}
    catch(error){list.items=previousItems;renderListItems();renderLists();}
  });
  $('#deleteListButton').addEventListener('click',async()=>{const id=activeListId;$('#listDetailDialog').close();await withLoading('Deleting list…',()=>dataService.deleteList(id));state.lists=state.lists.filter(l=>l.id!==id);renderAll();showToast('List deleted')});
  $('#addTaskButton').addEventListener('click',()=>{$('#taskForm').reset();populateTaskAssignees();updateTaskForm();$('#taskDialog').showModal()});$('#taskFrequency').addEventListener('change',updateTaskForm);$('#monthlyMode').addEventListener('change',updateMonthlyForm);
  $('#weekdayQuickOptions').addEventListener('click',e=>{const button=e.target.closest('[data-day-preset]');if(!button)return;const preset=button.dataset.dayPreset;const selected=preset==='weekdays'?[1,2,3,4,5]:preset==='weekend'?[0,6]:preset==='everyday'?[0,1,2,3,4,5,6]:[];$$('#weeklyDays input').forEach(input=>{input.checked=selected.includes(Number(input.value));});});
  $('#taskForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const f=new FormData(e.target),freq=f.get('frequency');
    const days=$$('#weeklyDays input:checked').map(i=>+i.value);
    if(freq==='weekly'&&!days.length){showToast('Choose at least one day');return;}
    const assigneeUid=f.get('assigneeUid')||'everyone';
    const assigneeProfile=dataService.getKnownProfiles().find(p=>p.uid===assigneeUid);
    const task={
      id:uid('task'),title:f.get('title').trim(),frequency:freq,
      days:freq==='weekly'?days:[],date:freq==='once'?(f.get('date')||''):'',
      monthlyMode:freq==='monthly'?(f.get('monthlyMode')||'dayOfMonth'):'',
      monthDay:freq==='monthly'?Math.max(1,Math.min(31,Number(f.get('monthDay')||1))):null,
      monthOrdinal:freq==='monthly'?Number(f.get('monthOrdinal')||1):null,
      monthWeekday:freq==='monthly'?Number(f.get('monthWeekday')||0):null,
      assigneeUid,assigneeName:assigneeUid==='everyone'?'Everyone':(assigneeProfile?.nickname||assigneeProfile?.name||'Assigned profile')
    };
    $('#taskDialog').close();await withLoading('Saving task…',()=>dataService.createTask(task));state.tasks.push(task);renderAll();showToast('Task created');
  });
  $('.filter-row').addEventListener('click',e=>{const b=e.target.closest('[data-task-filter]');if(!b)return;taskFilter=b.dataset.taskFilter;$$('[data-task-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTaskManager();});
  $('#taskManagerList').addEventListener('click',async e=>{const b=e.target.closest('.delete-task');if(!b)return;await withLoading('Deleting task…',()=>dataService.deleteTask(b.dataset.id));state.tasks=state.tasks.filter(t=>t.id!==b.dataset.id);renderAll();showToast('Task deleted')});
  $('#saveSettingsButton').addEventListener('click',async()=>{state.settings.householdName=$('#householdNameInput').value.trim();state.settings.homeTitle=$('#homeTitleInput').value.trim();await withLoading('Saving settings…',()=>dataService.saveSettings(state.settings));renderAll();showToast('Settings saved')});
  $('#signInButton').addEventListener('click',()=>showProfileGate('Choose or add a Google profile'));$('#signOutButton').addEventListener('click',async()=>{await dataService.signOut();showProfileGate('Choose a profile to continue');});
  $('#profileChooser').addEventListener('click',async e=>{
    const remove=e.target.closest('[data-remove-profile]');
    if(remove){
      e.stopPropagation();
      const uid=remove.dataset.removeProfile;
      const current=dataService.getCurrentUser();
      await withLoading('Removing profile…',()=>dataService.forgetProfile(uid));
      if(current?.uid===uid)await dataService.signOut();
      renderProfileChooser();
      showToast('Profile removed from the household');
      return;
    }
    const add=e.target.closest('#addGoogleProfile');
    const profileButton=e.target.closest('[data-profile-uid]');
    try{
      if(add){pendingAuthProfile=null;pendingNickname='';$('#nicknameForm').reset();$('#nicknameDialog').showModal();setTimeout(()=>$('#profileNicknameInput').focus(),50);return;}
      if(profileButton){
        const profile=dataService.getKnownProfiles().find(p=>p.uid===profileButton.dataset.profileUid);
        if(!profile)return;
        if(dataService.isProfileAuthorized(profile.uid)){await loadSignedInHousehold(profile);enterApp();return;}
        pendingAuthProfile=profile;pendingNickname='';$('#signInChoiceTitle').textContent=`Sign in as ${profile.nickname||profile.name||'this profile'}`;$('#signInChoiceDialog').showModal();
      }
    }catch(err){showToast(err.message||'Google sign-in failed');}
  });
  $('#nicknameForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const nickname=$('#profileNicknameInput').value.trim();
    if(!nickname)return;
    $('#nicknameDialog').close();
    pendingNickname=nickname;pendingAuthProfile=null;
    $('#signInChoiceTitle').textContent=`Add ${nickname}`;
    $('#signInChoiceDialog').showModal();
  });
  $$('.nickname-cancel').forEach(button=>button.addEventListener('click',()=>$('#nicknameDialog').close()));
  $('#signInOnDeviceButton').addEventListener('click',async()=>{
    $('#signInChoiceDialog').close();
    try{
      const result=await dataService.signIn(pendingAuthProfile?.email||'',pendingNickname,pendingAuthProfile?.uid||'');
      if(result?.redirecting){showToast('Opening Google sign-in…');return;}
      await dataService.loadProfiles();
      const uid=pendingAuthProfile?.uid||result.user.uid;dataService.authorizeProfileOnDevice(uid);
      const profile=dataService.getKnownProfiles().find(p=>p.uid===uid)||{uid,nickname:pendingNickname,name:result.user.displayName,email:result.user.email,photoURL:result.user.photoURL};
      await loadSignedInHousehold(profile);enterApp();
    }catch(err){if(err?.code!=='auth/popup-closed-by-user')showToast(err.message||'Google sign-in failed');}
  });
  $('#signInWithPhoneButton').addEventListener('click',async()=>{
    $('#signInChoiceDialog').close();
    try{
      const request=await withLoading('Creating phone sign-in…',()=>dataService.createPhoneAuthRequest({profileUid:pendingAuthProfile?.uid||'',nickname:pendingNickname}));
      phoneAuthCode=request.code;$('#phoneSignInCode').textContent=request.code.match(/.{1,4}/g).join(' ');$('#phoneSignInStatus').textContent='Waiting for approval…';
      const canvas=$('#phoneSignInQr');await window.QRCode.toCanvas(canvas,request.url,{width:240,margin:1});$('#phoneSignInDialog').showModal();
      if(phoneAuthUnsubscribe)phoneAuthUnsubscribe();
      phoneAuthUnsubscribe=dataService.watchPhoneAuthRequest(request.code,async data=>{
        if(data?.status!=='approved')return;
        phoneAuthUnsubscribe?.();phoneAuthUnsubscribe=null;dataService.authorizeProfileOnDevice(data.approvedUid);await dataService.loadProfiles();
        const profile=dataService.getKnownProfiles().find(p=>p.uid===data.approvedUid);$('#phoneSignInStatus').textContent='Approved!';setTimeout(async()=>{$('#phoneSignInDialog').close();await dataService.deletePhoneAuthRequest(request.code);if(profile){await loadSignedInHousehold(profile);enterApp();}},450);
      });
    }catch(err){showToast(err.message||'Could not start phone sign-in');}
  });
  $$('.phone-signin-cancel').forEach(button=>button.addEventListener('click',async()=>{phoneAuthUnsubscribe?.();phoneAuthUnsubscribe=null;$('#phoneSignInDialog').close();if(phoneAuthCode)await dataService.deletePhoneAuthRequest(phoneAuthCode);phoneAuthCode='';}));
  $('#approveWithGoogleButton').addEventListener('click',async()=>{const code=new URLSearchParams(location.search).get('approve');if(!code)return;try{const result=await dataService.signInForApproval(code);if(result?.redirecting)return;$('#approveWithGoogleButton').hidden=true;$('#finishPhoneApprovalButton').hidden=false;$('#phoneApprovalMessage').textContent='Google sign-in complete. Approve the waiting device.';}catch(err){showToast(err.message||'Google sign-in failed');}});
  $('#finishPhoneApprovalButton').addEventListener('click',async()=>{const code=new URLSearchParams(location.search).get('approve');try{await withLoading('Approving device…',()=>dataService.approvePhoneAuthRequest(code));$('#phoneApprovalMessage').textContent='Approved. You can return to the other device.';$('#finishPhoneApprovalButton').hidden=true;}catch(err){showToast(err.message||'Approval failed');}});
  $('#manageProfilesButton').addEventListener('click',()=>{profilesEditing=!profilesEditing;renderProfileChooser();});
  $('#continueDemoButton').addEventListener('click',async()=>{state=await dataService.getAll();activeUser={displayName:'Demo Home',email:'',photoURL:''};$('#profileInitials').textContent='DH';$('#profileInitials').hidden=false;$('#profilePhoto').hidden=true;renderAll();enterApp();});
}
function updateTaskForm(){
  const f=$('#taskFrequency').value;
  $('#weeklySchedule').hidden=f!=='weekly';
  $('#monthlySchedule').hidden=f!=='monthly';
  $('#taskDateField').hidden=f!=='once';
  $('#taskDateField input').required=f==='once';
  if(f==='once'&&!$('#taskDateField input').value)$('#taskDateField input').value=iso(new Date());
  updateMonthlyForm();
}
function updateMonthlyForm(){
  const ordinal=$('#monthlyMode').value==='ordinalWeekday';
  $('#monthDayField').hidden=ordinal;
  $('#ordinalWeekdayFields').hidden=!ordinal;
}


async function init(){
  await dataService.init();
  bindEvents();
  if(!dataService.isFirebaseEnabled()){
    state=await dataService.getAll();renderAll();showProfileGate('Firebase is not configured yet. Continue in demo mode or configure Google sign-in.');return;
  }
  await dataService.loadProfiles();renderProfileChooser();renderAll();
  const approvalCode=new URLSearchParams(location.search).get('approve');
  if(approvalCode){
    showProfileGate('Approve the sign-in request from your phone');$('#phoneApprovalDialog').showModal();
    if(dataService.isGoogleSignedIn()){$('#approveWithGoogleButton').hidden=true;$('#finishPhoneApprovalButton').hidden=false;$('#phoneApprovalMessage').textContent='Google sign-in complete. Approve the waiting device.';}
    return;
  }
  dataService.onAuthChanged(async()=>{try{await dataService.loadProfiles();renderProfileChooser();}catch(err){console.error(err);}});
  showProfileGate('Select a profile to continue');
}

init();
