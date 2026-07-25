const iso = date => date.toISOString().slice(0,10);
const today = new Date();
const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
const threeDays = new Date(today); threeDays.setDate(today.getDate()+3);

export const demoData = {
  settings:{householdName:"Our Home",homeTitle:"Household Hub"},
  events:[
    {id:"event-1",title:"Family dinner",date:iso(today),time:"18:00",notes:"At home"},
    {id:"event-2",title:"Grocery pickup",date:iso(tomorrow),time:"17:30",notes:"Pickup window"},
    {id:"event-3",title:"Weekend plans",date:iso(threeDays),time:"10:00",notes:""}
  ],
  lists:[
    {id:"list-1",name:"Groceries",type:"repeating",resetOnComplete:true,items:[{id:"i1",text:"Milk",done:false},{id:"i2",text:"Bananas",done:true},{id:"i3",text:"Dish soap",done:false}]},
    {id:"list-2",name:"Weekend projects",type:"temporary",resetOnComplete:false,items:[{id:"i4",text:"Replace porch bulb",done:false},{id:"i5",text:"Organize garage shelf",done:false}]},
    {id:"list-3",name:"Monthly supplies",type:"repeating",resetOnComplete:true,items:[{id:"i6",text:"Air filters",done:false},{id:"i7",text:"Pet food",done:false}]}
  ],
  tasks:[
    {id:"task-1",title:"Feed the fish",frequency:"daily",days:[],date:"",assignee:"Anyone"},
    {id:"task-2",title:"Take trash to curb",frequency:"weekly",days:[2],date:"",assignee:"John"},
    {id:"task-3",title:"Water plants",frequency:"weekly",days:[0,3],date:"",assignee:"Anyone"},
    {id:"task-4",title:"Change air filter",frequency:"once",days:[],date:iso(threeDays),assignee:"John"}
  ],
  completions:{}
};
