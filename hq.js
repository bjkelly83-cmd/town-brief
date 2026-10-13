'use strict';
// HQ: one page for the town and the phone. In the town it reads the records directly and its commands go straight to
// Head Office. Anywhere else it opens the encrypted copy, and a command is sealed with the same key and sent to the office by email.
const $=id=>document.getElementById(id),KEY='brief-key',SENT='hq-sent';
// "In the town" means this page is being served by the town itself: on the office PC, or from a phone or tablet through the private tunnel. The published copy lives on github.io.
const IN_TOWN=location.pathname.startsWith('/brief-site/')&&!/github\.io$/.test(location.hostname);
const TABS=[['overview','Overview'],['money','Money'],['compliance','Compliance'],['projects','Projects'],['comms','Comms'],['people','People'],['legal','Legal']];
const OPEN=new Set(),ALL=new Set(),COL={};
// The computer on the desk: the same records, sorted the way Ben asked for them.
const PC=[['actions','Actions for me'],['mail','Email'],['reports','Reports'],['opps','Opportunities'],['risks','Risks']];
let DATA=null,SIG='',page='desk',tab='overview',CRYPT=null,pcTab='actions',pcEnt='',tvPick='all',tvOpen='';
const fromB64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const toB64url=bytes=>{let s='';bytes.forEach(b=>{s+=String.fromCharCode(b);});return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined&&text!==null)e.textContent=text;return e;}
function toast(t){const x=$('toast');x.textContent=t;x.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{x.hidden=true;},6000);}
const count=rows=>rows.reduce((n,r)=>n+(r.sub&&r.sub.length||1),0);
const levelCounts=secs=>{let now=0,soon=0;secs.forEach(s=>s.rows.forEach(r=>{if(r.level==='now')now++;else if(r.level==='soon')soon++;}));return {now,soon};};
// what this phone has sent, so a command can be seen to land (a convenience: HQ works without it)
function sent(){try{return JSON.parse(localStorage.getItem(SENT)||'[]').filter(x=>Date.now()-Date.parse(x.at)<7*86400e3);}catch{return [];}}
function remember(x){try{localStorage.setItem(SENT,JSON.stringify([...sent(),x].slice(-40)));}catch{/* storage unavailable: the command is still sent */}}

// ---- sending a command ----
async function send(cmd,label,btn){
 const id=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2));
 if(btn)btn.disabled=true;
 try{
  if(IN_TOWN){const r=await fetch('/api/brief',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'command',id,cmd})}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'That did not work.');toast(j.text||'Done.');await refresh();return true;}
  if(!DATA.link||!DATA.link.mail)throw Error('The office has no mailbox switched on to receive commands.');
  const iv=crypto.getRandomValues(new Uint8Array(12)),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},CRYPT.key,new TextEncoder().encode(JSON.stringify({id,at:new Date().toISOString(),cmd})))),all=new Uint8Array(12+ct.length);all.set(iv);all.set(ct,12);
  remember({id,label,at:new Date().toISOString()});
  location.href='mailto:'+DATA.link.mail+'?subject='+encodeURIComponent('HQ command')+'&body='+encodeURIComponent('HQ1:'+toB64url(all)+':END\n\nSealed HQ command. Send as it is.');
  toast('Send the email your mail app just opened. The office acts on it within about ten minutes.');if(btn)btn.textContent='Sent to your mail app';return true;
 }catch(e){if(btn)btn.disabled=false;toast(e.message);return false;}
}
const cmdOf=(a,note)=>({k:a.k,id:a.id,action:a.action,entity:a.entity,key:a.key,section:a.section,note:note||undefined});

// ---- the sheet: a direction, a note with an action, or a register entry ----
function closeSheet(){$('shade').hidden=true;$('sheet').textContent='';}
function sheet(titleText,ctx,build,go,onSend){
 const f=$('sheet');f.textContent='';f.append(el('h2','',titleText));if(ctx)f.append(el('p','ctx',ctx));const get=build(f);
 const bar=el('div','acts'),ok=el('button','act go2',go),no=el('button','act','Cancel');ok.type='submit';no.type='button';no.onclick=closeSheet;bar.append(ok,no);f.append(bar);
 f.onsubmit=async ev=>{ev.preventDefault();const v=get();if(!v)return;ok.disabled=true;if(await onSend(v))closeSheet();else ok.disabled=false;};
 $('shade').hidden=false;const first=f.querySelector('textarea,input');if(first)first.focus();
}
const field=(f,label,node)=>{const l=el('label','',label);l.append(node);f.append(l);return node;};
function directSheet(row){
 let kind='direction';
 sheet('Direct Head Office',row?'About: '+row.title:'The General Manager plans it and delegates by priority, criticality and due date. The manager of everyone it goes to is copied in.',f=>{
  const seg=el('div','seg');[['direction','Direction'],['decision','Decision'],['idea','Idea']].forEach(([k,n])=>{const b=el('button','',n);b.type='button';b.setAttribute('aria-pressed',String(k===kind));b.onclick=()=>{kind=k;seg.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));};seg.append(b);});f.append(seg);
  const who=el('select');[['all','All entities'],...DATA.entities.map(e=>[e.id,e.name])].forEach(([v,n])=>{const o=el('option','',n);o.value=v;who.append(o);});if(DATA.entities.some(e=>e.id===page))who.value=page;
  if(!row)field(f,'For',who);
  const t=field(f,'What do you want done?',el('textarea'));t.required=true;t.maxLength=2000;
  return ()=>t.value.trim().length<4?null:{kind,entity:who.value,text:t.value.trim()};
 },'Send to Head Office',v=>send({k:'direct',kind:v.kind,entity:v.entity,text:v.text,ref:row&&row.ref||undefined},'Your '+v.kind));
}
// ---- the desk: notepad, phone ----
function padSheet(){sheet('Notepad','What you write here goes up on the whiteboard.',f=>{const t=field(f,'Note',el('textarea'));t.required=true;t.maxLength=400;return ()=>t.value.trim().length<2?null:{text:t.value.trim()};},'Pin to the whiteboard',v=>send({k:'note',text:v.text},'A note for the whiteboard'));}
function phoneSheet(){
 const people=DATA.desk&&DATA.desk.people||[],groups=[...new Set(people.map(p=>p.group))];
 sheet('Phone','Ring anyone in the business: every position and every specialist. Whoever they answer to is copied in.',f=>{
  const q=field(f,'Find',el('input'));q.placeholder='Name, title or department';q.maxLength=60;
  const who=field(f,'Who',el('select'));who.size=7;who.className='book';
  const cc=el('p','ctx','');f.append(cc);
  const say=()=>{const p=people.find(x=>x.id===who.value);cc.textContent=!p?'Choose who to ring.':p.up?'Copied in: '+p.up+'.':'Nobody is above them but you.';};
  const fill=()=>{const k=q.value.trim().toLowerCase(),keep=who.value;who.textContent='';
   groups.forEach(g=>{const list=people.filter(p=>p.group===g&&(!k||(p.name+' '+p.title+' '+p.group).toLowerCase().includes(k)));if(!list.length)return;const og=document.createElement('optgroup');og.label=g;
    list.forEach(p=>{const o=el('option','',(p.name?p.name+', ':'')+p.title);o.value=p.id;og.append(o);});who.append(og);});
   who.value=keep;say();};
  q.oninput=fill;who.onchange=say;fill();
  const t=field(f,'What do you want to say?',el('textarea'));t.maxLength=2000;
  return ()=>who.value&&t.value.trim().length>=4?{to:who.value,text:t.value.trim()}:null;
 },'Ring',v=>send({k:'call',to:v.to,text:v.text},'Your call'));
}
function noteSheet(a,row,btn){sheet(a.label,row?row.title:'',f=>{const t=field(f,a.ask,el('textarea'));t.maxLength=400;return ()=>({note:t.value.trim()});},a.label,v=>send(cmdOf(a,v.note),a.label,btn));}
function recordSheet(a,heading){sheet('Add to '+heading,'Kept in the register in the vault. An entry with an expiry date is raised 45 days before it lapses.',f=>{
  const t=field(f,'Name',el('input'));t.required=true;t.maxLength=120;const two=el('div','two');f.append(two);
  const s=field(two,'Status',el('input'));s.maxLength=80;s.placeholder='held, current, not held';const x=field(two,'Expires',el('input'));x.type='date';
  const n=field(f,'Note',el('textarea'));n.maxLength=600;n.style.minHeight='70px';
  return ()=>t.value.trim()?{title:t.value.trim(),status:s.value.trim(),expires:x.value,note:n.value.trim()}:null;
 },'Add',v=>send({k:'record',entity:a.entity,section:a.section,title:v.title,status:v.status,expires:v.expires,note:v.note},'Register entry'));}
function actBar(acts,row,heading){
 const bar=el('div','acts');
 (acts||[]).forEach(a=>{const b=el('button','act'+(a.tone==='go'?' go2':''),a.label);b.type='button';b.onclick=()=>{if(a.k==='record')recordSheet(a,heading||'the register');else if(a.ask)noteSheet(a,row,b);else send(cmdOf(a),a.label,b);};bar.append(b);});
 if(row&&row.ref){const b=el('button','act ghost','Direct Head Office on this');b.type='button';b.onclick=()=>directSheet(row);bar.append(b);}
 return bar;
}

// ---- drawing ----
function body(r,key){const b=el('div','rb');if(r.who)b.append(el('div','who',r.who));if(r.detail)b.append(el('div','txt',r.detail));
 if(r.sub&&r.sub.length){const ul=el('ul');r.sub.forEach((c,n)=>ul.append(row(c,key+'>'+n)));b.append(ul);}
 if((r.acts&&r.acts.length)||r.ref)b.append(actBar(r.acts,r));return b;}
function row(r,key){
 const can=!!(r.detail||r.who||(r.sub&&r.sub.length)||(r.acts&&r.acts.length)||r.ref),li=el('li','row '+(r.level||'info')+(can&&OPEN.has(key)?' open':'')),h=el(can?'button':'div','rh');
 h.append(el('span','dot'));
 if(r.tag){const t=el('span','tag',r.tag);if(COL[r.tag])t.style.background=COL[r.tag];h.append(t);}
 h.append(el('span','tt',r.title));if(r.meta)h.append(el('span','mm',r.meta));
 li.append(h);
 if(can){h.type='button';h.append(el('span','chev','\u203a'));h.setAttribute('aria-expanded',String(OPEN.has(key)));if(OPEN.has(key))li.append(body(r,key));
  h.onclick=()=>{const on=!OPEN.has(key);if(on)OPEN.add(key);else OPEN.delete(key);li.classList.toggle('open',on);h.setAttribute('aria-expanded',String(on));const old=li.querySelector(':scope>.rb');if(old)old.remove();if(on)li.append(body(r,key));};}
 return li;
}
function recs(s){const g=el('div','recs');s.rows.forEach(r=>{const c=el('div','rec');if(r.meta)c.append(el('span','pri'+(r.level==='soon'?' hot':''),r.meta));c.append(el('b','',r.title));if(r.who)c.append(el('div','to','\u2192 '+r.who));if(r.detail)c.append(el('p','',r.detail));if(r.acts&&r.acts.length)c.append(actBar(r.acts,r));g.append(c);});return g;}
function section(s,key){
 const c=el('section','sec'),h=el('h3','',s.h);
 if(!s.rows.length){c.classList.add('quiet');c.append(h,el('p','empty',s.empty||'Nothing here.'));}
 else{if(s.rows.some(r=>r.level==='now'))c.classList.add('hot');h.append(el('b','',String(count(s.rows))));c.append(h);if(s.note)c.append(el('p','note',s.note));
  if(s.h==='Recommended assignments')c.append(recs(s));
  else{const ul=el('ul');const fill=()=>{ul.textContent='';s.rows.slice(0,ALL.has(key)?s.rows.length:5).forEach((r,n)=>ul.append(row(r,key+':'+n)));};fill();c.append(ul);
   if(s.rows.length>5){const m=el('button','more');m.type='button';const lab=()=>{m.textContent=ALL.has(key)?'Show fewer':'Show all '+s.rows.length;};lab();m.onclick=()=>{if(ALL.has(key))ALL.delete(key);else ALL.add(key);fill();lab();};c.append(m);}}}
 if(s.acts&&s.acts.length)c.append(actBar(s.acts,null,s.h));
 return c;
}
function tile(n,label,tone){const t=el('div','tile '+(n?tone:'zero'));t.append(el('b','',String(n)),el('span','',label));return t;}
function go(hash){if(location.hash==='#'+hash){route();draw();}else location.hash=hash;}
function viewToday(v){
 const d=new Date(DATA.day+'T00:00:00'),hr=new Date().getHours(),hero=el('div','hero');
 hero.append(el('h1','',d.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'})),el('p','',(hr<12?'Morning':hr<18?'Afternoon':'Evening')+', Ben. Here is what needs you.'));v.append(hero);
 const [now,decide,dates]=DATA.today.sections,tiles=el('div','tiles');
 tiles.append(tile(count(now.rows),'Do now','red'),tile(count(decide.rows),'Decide or approve','amber'),tile(dates.rows.length,'Dates in 14 days','amber'));v.append(tiles);
 DATA.today.sections.forEach((s,n)=>v.append(section(s,'today:'+n)));
 v.append(el('h2','lab','Entities'));
 const cards=el('div','cards');DATA.entities.forEach(e=>{const c=el('button','card');c.style.setProperty('--e',e.colour);c.append(el('b','',e.name),el('small','',e.kind));
  const ch=el('div','chips'),chip=(n,t,tone)=>{if(n)ch.append(el('span','chip '+tone,n+' '+t));};chip(e.counts.urgent,'urgent','red');chip(e.counts.todo,'to decide','amber');chip(e.counts.approve,'to approve','amber');chip(e.counts.dates,e.counts.dates===1?'date soon':'dates soon','');
  if(!ch.children.length)ch.append(el('span','chip','all quiet'));c.append(ch);c.onclick=()=>go(e.id);cards.append(c);});v.append(cards);
}
// ---- the desk scene ----
const glance=(e,name)=>{const g=e.overview.find(s=>s.h==='At a glance'),r=g&&g.rows.find(x=>x.title===name);return r&&r.meta||'';};
function wallScreen(){
 const box=el('section','tv'),head=el('div','tvh'),b=el('div','tvb'),redraw=()=>box.replaceWith(wallScreen());box.setAttribute('aria-label','Dashboard');
 [['all','All'],...DATA.entities.map(e=>[e.id,e.short])].forEach(([id,n])=>{const k=el('button','',n);k.type='button';k.setAttribute('aria-pressed',String(tvPick===id));k.onclick=()=>{tvPick=id;tvOpen='';redraw();};head.append(k);});
 const e=DATA.entities.find(x=>x.id===tvPick),stat=(n,l,tone)=>{const d=el('div','st '+(n?tone:''));d.append(el('b','',String(n)),el('span','',l));return d;},stats=el('div','stats'),sum=k=>e?e.counts[k]:DATA.entities.reduce((n,x)=>n+x.counts[k],0);
 stats.append(stat(sum('urgent'),'urgent','red'),stat(sum('todo'),'to decide','amber'),stat(sum('approve'),'to approve','amber'),stat(sum('dates'),'dates soon',''));b.append(stats);
 if(!e)DATA.entities.forEach(x=>{const l=el('button','line');l.type='button';l.style.setProperty('--e',x.colour);l.append(el('b','',x.name),el('span','',glance(x,'Money, 30 days')));l.onclick=()=>{tvPick=x.id;redraw();};b.append(l);});
 else{const g=e.overview.find(s=>s.h==='At a glance');if(g){const kv=el('div','kv');g.rows.forEach(r=>{const d=el('div');d.append(el('span','',r.title),el('b','',r.meta||''));kv.append(d);});b.append(kv);}
  const pr=e.tabs.projects.find(s=>s.h==='Projects');
  if(pr&&pr.rows.length){b.append(el('h4','','Projects'));pr.rows.forEach(r=>{const l=el('button','line');l.type='button';l.style.setProperty('--e',e.colour);l.append(el('b','',r.title),el('span','',r.meta||''));l.setAttribute('aria-expanded',String(tvOpen===r.title));l.onclick=()=>{tvOpen=tvOpen===r.title?'':r.title;redraw();};b.append(l);if(tvOpen===r.title)b.append(el('p','pd',r.detail||'Nothing more recorded.'));});}
  const open=el('button','act','Open '+e.short+' in full');open.type='button';open.onclick=()=>go(e.id);b.append(open);}
 box.append(head,b);return box;
}
function whiteboard(){
 const w=el('section','wb'),notes=DATA.desk&&DATA.desk.board||[];w.setAttribute('aria-label','Whiteboard');w.append(el('small','','WHITEBOARD'));
 if(!notes.length)w.append(el('p','wbe','Nothing up yet. Write on the notepad.'));
 const ul=el('ul');notes.forEach(n=>{const li=el('li');li.append(el('span','',n.text));const x=el('button','','\u00d7');x.type='button';x.setAttribute('aria-label','Wipe this note off');x.onclick=()=>send({k:'noteWipe',id:n.id},'Wipe a note',x);li.append(x);ul.append(li);});w.append(ul);return w;
}
function viewDesk(v){
 const sc=el('div','scene'),wall=el('div','wall'),row=el('div','wallrow'),desk=el('div','desk'),t=DATA.today.sections,nNow=count(t[0].rows),nDec=count(t[1].rows);
 wall.append(el('div','sign','THE TOWN'),el('div','signsub','Head Office \u00b7 the Founder\u2019s desk'));row.append(wallScreen(),whiteboard());wall.append(row);
 const item=(cls,big,line,small,fn)=>{const b=el('button',cls);b.type='button';b.append(el('b','',big),el('span','',line),el('small','',small));b.onclick=fn;desk.append(b);};
 item('pc','Computer',nNow||nDec?nNow+' to do now \u00b7 '+nDec+' to decide':'Nothing waiting on you','Email \u00b7 Actions \u00b7 Reports \u00b7 Opportunities \u00b7 Risks',()=>go('pc/actions'));
 item('pad','Notepad','Write a note.','It goes up on the whiteboard.',padSheet);
 item('phone','\u260e Phone','Ring anyone in the business.','Their manager is copied in.',phoneSheet);
 item('memo','Give a direction','To one entity or the whole company.','Managers are copied in.',()=>directSheet(null));
 sc.append(wall,desk);v.append(sc);
}
// One section made from the same-named section of every entity, each row tagged with whose it is.
const across=(h,get,empty)=>({h,rows:DATA.entities.flatMap(e=>{const s=get(e);return s?s.rows.map(r=>Object.assign({},r,{tag:e.short})):[];}),empty:empty||'None on record.'});
const named=(list,h)=>list.find(s=>s.h===h);
function viewPc(v){
 document.documentElement.style.setProperty('--e','#f59e0b');
 const head=el('div','ehead'),put=(secs)=>secs.forEach((s,n)=>v.append(section(s,'pc:'+pcTab+':'+n)));
 if(pcTab==='mail'){const e=DATA.entities.find(x=>x.id===pcEnt)||DATA.entities[0];document.documentElement.style.setProperty('--e',e.colour);head.append(el('h1','','Email: '+e.name),el('p','','Replies to approve, what is waiting on you, and the mailboxes. Approving never sends.'));v.append(head);e.tabs.comms.forEach((s,n)=>v.append(section(s,'pc:mail:'+e.id+':'+n)));return;}
 if(pcTab==='reports'){head.append(el('h1','','Reports'),el('p','','Each Project Manager\u2019s report, the work finished this week, and what Head Office did with your directions.'));v.append(head);
  DATA.entities.forEach(e=>{v.append(el('h2','lab',e.name));['Projects','Finished in the last 7 days','Resources: gaps, under-used roles, engaged work'].forEach(h=>{const s=named(e.tabs.projects,h);if(s)v.append(section(s,'pc:rep:'+e.id+':'+h));});});
  v.append(el('h2','lab','Head Office'));['Your directions','Calls','Departments'].forEach(h=>{const s=named(DATA.office,h);if(s)v.append(section(s,'pc:rep:office:'+h));});return;}
 if(pcTab==='opps'){head.append(el('h1','','Opportunities'),el('p','','Across every entity. Ideas are labelled as ideas.'));v.append(head);
  put([across('Opportunities',e=>named(e.tabs.projects,'Opportunities')),across('Growth moves',e=>named(e.tabs.projects,'Growth')),across('Stretch targets, ideas and competitors',e=>named(e.tabs.projects,'Stretch targets, ideas and competitors'))]);return;}
 if(pcTab==='risks'){head.append(el('h1','','Risks'),el('p','','Across every entity: what is urgent, legal and regulator matters, open points and gaps.'));v.append(head);
  put([across('Urgent',e=>named(e.overview,'Urgent'),'Nothing urgent.'),across('Legal and regulator mail',e=>named(e.tabs.legal,'Legal and regulator mail')),across('Open points',e=>named(e.tabs.legal,'Open points')),across('Facts still needed',e=>named(e.tabs.compliance,'Facts still needed'))]);return;}
 head.append(el('h1','','Actions for me'),el('p','','What needs the Founder: do now, decide or approve, and the dates coming up.'));v.append(head);
 const s3=DATA.today.sections,tiles=el('div','tiles');tiles.append(tile(count(s3[0].rows),'Do now','red'),tile(count(s3[1].rows),'Decide or approve','amber'),tile(s3[2].rows.length,'Dates in 14 days','amber'));v.append(tiles);put(s3);
}
function viewEntity(v,e){
 document.documentElement.style.setProperty('--e',e.colour);
 const head=el('div','ehead');head.append(el('h1','',e.name),el('p','',e.kind+(e.abn?' \u00b7 ABN '+e.abn:'')));v.append(head);
 if(tab!=='overview'){e.tabs[tab].forEach((s,n)=>v.append(section(s,e.id+':'+tab+':'+n)));return;}
 const tiles=el('div','tiles');tiles.append(tile(e.counts.urgent,'Urgent','red'),tile(e.counts.todo,'To decide','amber'),tile(e.counts.approve,'To approve','amber'),tile(e.counts.dates,'Dates in 14 days','amber'));v.append(tiles);
 e.overview.forEach((s,n)=>{if(s.h!=='At a glance'){v.append(section(s,e.id+':o:'+n));return;}
  const c=el('section','sec');c.append(el('h3','',s.h));const kv=el('div','kv');s.rows.forEach(r=>{const d=el('div');d.append(el('span','',r.title),el('b','',r.meta||''));kv.append(d);});c.append(kv);v.append(c);});
 v.append(el('h2','lab','Areas'));
 const cards=el('div','cards');TABS.slice(1).forEach(([id,name])=>{const l=levelCounts(e.tabs[id]),c=el('button','card area '+(l.now?'red':l.soon?'amber':''));c.append(el('b','',name),el('small','',l.now?l.now+' urgent':l.soon?l.soon+' to look at':'Quiet'));c.onclick=()=>go(e.id+'/'+id);cards.append(c);});v.append(cards);
}
function viewOffice(v){
 document.documentElement.style.setProperty('--e','#f59e0b');
 const head=el('div','ehead');head.append(el('h1','','Head Office'),el('p','','Your directions, what was delegated, and each department\u2019s queue.'));v.append(head);
 if(!IN_TOWN){const seen=DATA.link&&DATA.link.seen||[],mine=sent().reverse();
  if(mine.length)v.append(section({h:'Sent from this phone',rows:mine.map(x=>{const r=seen.find(y=>y.id===x.id);return {title:x.label,meta:r?(r.ok?'done':'refused'):'waiting for the office',level:r?(r.ok?'ok':'now'):'soon',detail:r?r.text:'Sent '+new Date(x.at).toLocaleString('en-AU',{weekday:'short',hour:'numeric',minute:'2-digit'})+'. If you did not press send in your mail app, it has not gone.'};})},'office:sent'));}
 DATA.office.forEach((s,n)=>v.append(section(s,'office:'+n)));
}
function stamp(){const m=$('made'),at=new Date(DATA.made),old=Date.now()-at>3*3600e3;m.className=old?'stale':'';
 m.textContent=(old?'Last updated ':'Updated ')+at.toLocaleString('en-AU',old?{weekday:'short',hour:'numeric',minute:'2-digit'}:{hour:'numeric',minute:'2-digit'})+(old?'. The office PC may be off.':'');}
function route(){const [p,t,u]=location.hash.slice(1).split('/'),isEntity=id=>!!DATA&&DATA.entities.some(e=>e.id===id);
 page=p==='office'||p==='today'||p==='pc'||isEntity(p)?p:'desk';tab=TABS.some(x=>x[0]===t)?t:'overview';
 if(page==='pc'){pcTab=PC.some(x=>x[0]===t)?t:'actions';pcEnt=isEntity(u)?u:DATA?DATA.entities[0].id:'';}}
function draw(){
 const v=$('view'),prim=$('prim'),sub=$('sub'),strip=sub.firstElementChild;v.textContent='';prim.textContent='';strip.textContent='';
 if(DATA.v!==4){$('fab').hidden=true;v.append(el('p','empty','This page and the briefing behind it are out of step. It catches up within a few minutes; pull down to reload.'));return;}
 $('fab').hidden=false;DATA.entities.forEach(e=>{COL[e.short]=e.colour;});
 const nav=(host,hash,name,on,n,red,colour)=>{const b=el('button','',name);b.type='button';if(on)b.setAttribute('aria-current','page');if(colour)b.style.setProperty('--c',colour);if(n)b.append(el('span','n'+(red?' red':''),String(n)));b.onclick=()=>go(hash);host.append(b);};
 const atDesk=page==='desk';document.body.classList.toggle('atdesk',atDesk);
 if(atDesk){$('fab').hidden=true;sub.hidden=true;viewDesk(v);}
 else if(page==='pc'){nav(prim,'desk','\u2190 Desk',false);
  PC.forEach(([id,name])=>nav(prim,'pc/'+id,name,pcTab===id,id==='actions'?count(DATA.today.sections[0].rows):0,true));nav(prim,'today','Everything',false);
  sub.hidden=pcTab!=='mail';if(pcTab==='mail')DATA.entities.forEach(e=>{const l=levelCounts(e.tabs.comms);nav(strip,'pc/mail/'+e.id,e.short,pcEnt===e.id,l.now||l.soon,!!l.now,e.colour);});
  viewPc(v);}
 else{
 nav(prim,'desk','\u2190 Desk',false);
 nav(prim,'today','Today',page==='today',count(DATA.today.sections[0].rows),true);
 DATA.entities.forEach(e=>nav(prim,e.id,e.short,page===e.id,e.counts.urgent||e.counts.todo+e.counts.approve,!!e.counts.urgent,e.colour));
 const ol=levelCounts([DATA.office[0]]);nav(prim,'office','Office',page==='office',ol.now||ol.soon,!!ol.now);
 const e=DATA.entities.find(x=>x.id===page);sub.hidden=!e;
 if(e){TABS.forEach(([id,name])=>{const l=id==='overview'?{now:e.counts.urgent}:levelCounts(e.tabs[id]);nav(strip,id==='overview'?e.id:e.id+'/'+id,name,tab===id,l.now,true);});viewEntity(v,e);const cur=strip.querySelector('[aria-current]');if(cur)cur.scrollIntoView({block:'nearest',inline:'center'});}
 else if(page==='office')viewOffice(v);else viewToday(v);}
 const f=el('footer');f.append(el('p','note',DATA.note));
 if(IN_TOWN){const b=el('button','act','Email today\u2019s brief to me');b.type='button';b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/api/brief',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'email'})}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'The email did not send.');toast('Sent to your mailbox.');}catch(x){toast(x.message);}b.disabled=false;};f.append(b);}
 else{const b=el('button','act','Sign out on this device');b.type='button';b.onclick=()=>{try{localStorage.removeItem(KEY);}catch{/* storage unavailable: nothing was kept */}DATA=null;CRYPT=null;SIG='';$('app').hidden=true;$('lock').hidden=false;};f.append(b);}
 v.append(f);stamp();
}
// New data is drawn only when something changed, so an open row is not closed under the reader's thumb.
function take(d){DATA=d;$('lock').hidden=true;$('app').hidden=false;const sig=JSON.stringify(Object.assign({},d,{made:''}));if(sig!==SIG){SIG=sig;const y=scrollY;route();draw();scrollTo(0,y);}else stamp();}
addEventListener('hashchange',()=>{if(!DATA)return;route();draw();scrollTo(0,0);});
$('fab').onclick=()=>directSheet(null);
$('shade').addEventListener('click',ev=>{if(ev.target===$('shade'))closeSheet();});
addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!$('shade').hidden)closeSheet();});

// ---- opening ----
const USES=['encrypt','decrypt'];
async function keyFrom(pass,box){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:fromB64(box.salt),iterations:box.rounds,hash:'SHA-256'},base,{name:'AES-GCM',length:256},true,USES);}
async function unseal(key,box){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(box.iv)},key,fromB64(box.data))));}
async function fetchBox(){const r=await fetch('data.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('The briefing has not been published yet.');return r.json();}
async function refresh(){
 try{if(IN_TOWN){const r=await fetch('/api/brief',{cache:'no-store'}),j=await r.json().catch(()=>({}));
   // not signed in to the town on this device: say so and offer the way in
   if(r.status===401&&!DATA){$('app').hidden=false;$('fab').hidden=true;const v=$('view');v.textContent='';v.append(el('p','empty','Sign in to the Town on this device to open HQ.'));const b=el('button','act go2','Sign in to the Town');b.type='button';b.onclick=()=>{(window.top||window).location.href='/';};v.append(b);return;}
   if(!r.ok)throw Error(j.error||'Could not read the records.');take(j);}
  else if(CRYPT){const box=await fetchBox();if(box.salt===CRYPT.salt)take(await unseal(CRYPT.key,box));
   // a different salt means the passphrase was changed at the office: say so, instead of quietly showing an old copy for ever
   else{try{localStorage.removeItem(KEY);}catch{/* nothing was kept */}DATA=null;CRYPT=null;SIG='';$('app').hidden=true;$('lock').hidden=false;$('err').textContent='The passphrase was changed at the office. Enter the new one.';}}}
 catch(e){if(!DATA&&IN_TOWN){$('app').hidden=false;$('fab').hidden=true;$('view').textContent=e.message;}
  // the last good copy stays on screen, but its age is shown again and the failure is said, in the town and on the phone
  else if(DATA){stamp();toast('HQ could not refresh: '+e.message);}}
}
$('form').addEventListener('submit',async ev=>{ev.preventDefault();$('err').textContent='';
 try{const box=await fetchBox(),key=await keyFrom($('pass').value,box);take(await unseal(key,box));CRYPT={key,salt:box.salt};$('pass').value='';
  // staying signed in is a convenience: if this browser refuses storage HQ is still open
  if($('keep').checked)try{const jwk=await crypto.subtle.exportKey('jwk',key);delete jwk.key_ops;localStorage.setItem(KEY,JSON.stringify({salt:box.salt,jwk}));}catch{toast('This browser would not remember the sign-in.');}}
 catch(e){$('err').textContent=e.name==='OperationError'?'That passphrase did not open it.':(e.message||'Could not open HQ.');}});
(async()=>{
 if(IN_TOWN){await refresh();setInterval(refresh,60000);return;}
 $('lock').hidden=false;
 // a device that chose to stay signed in holds the derived key; it stops working when the passphrase (and so the salt) changes
 try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved){const box=await fetchBox();if(box.salt===saved.salt){delete saved.jwk.key_ops;const key=await crypto.subtle.importKey('jwk',saved.jwk,{name:'AES-GCM',length:256},true,USES);take(await unseal(key,box));CRYPT={key,salt:box.salt};}}}catch{/* no saved sign-in, or it no longer opens: the passphrase form is showing */}
 setInterval(refresh,3*60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();