import { CATEGORIES, LOCATION_FILTERS, visibleJobs, matchRole, safeURL, matchesLocation, permitNote, isUKWideRemote } from './job-policy.mjs';

(function(){
'use strict';
const $=id=>document.getElementById(id);

/* ---------- lenses ---------- */
const LENSES=[
 {id:'short',name:'Shortlist for Alex',re:/\b(multiverse group|futurelearn|pearson (plc|education|edexcel)|coursera|udemy|linkedin|deepmind|google uk|openai|anthropic|microsoft (limited|research)|royal holloway|wellcome (trust|sanger)|^nesta$|^jisc$|emerald (publishing|group)|taylor\s*&\s*francis|informa\b|springer nature|elsevier|relx|cipd|chartered institute of personnel|economist (group|newspaper)|financial times|guardian news|british broadcasting|^bbc$|science museum|natural history museum|british library|british museum|tate gallery|trustees of the tate|victoria and albert|^the royal society$|british council|open university|university of london|university college london|king'?s college london|imperial college|london school of economics|cambridge university press|oxford university press|hachette|penguin random house|bloomsbury publishing|harpercollins|faber\s*(&|and)\s*faber|macmillan (publishers|education)|times higher|qa (limited|ltd)|general assembly|hibob|personio|beamery|workday|culture amp|duolingo|kahoot|babbel|busuu|sana labs|synthesia|elevenlabs|wise payments|monzo|revolut\b|deliveroo|skyscanner|canva\b|notion labs|hubspot|figma|atlassian|salesforce|adobe systems|meta platforms|amazon (uk|development|web services)|apple (uk|europe|retail)|stripe payments)/i},
 {id:'learn',name:'Learning & EdTech',re:/\b(learn|learning|education|educat|edtech|e-?learning|training|skills|tutor|apprentice|curricul|course|academic|literacy|study)/i},
 {id:'uni',name:'Universities & research',re:/\b(universit|college|institute|research|royal society|school of|polytechnic|faculty|laborator|think ?tank|policy)/i},
 {id:'hr',name:'HR, people & future of work',re:/\b(hr\b|human resources|people\b|talent|recruit|workforce|payroll|staffing|employment|careers?\b|benefits|wellbeing|personnel|coaching|leadership|culture)/i},
 {id:'pub',name:'Publishing, media & content',re:/\b(publish|press\b|media|books?\b|journal|magazine|news|editorial|content|writ|storytell|communications?|comms|podcast|broadcast|studio|film|tv\b)/i},
 {id:'mus',name:'Museums, science & culture',re:/\b(museum|galler|heritage|planetarium|science centre|discovery|exhibition|arts?\b|theatre|theater|cultural|library|archive|zoo|botanic|observatory|national trust)/i},
 {id:'npo',name:'Nonprofits & foundations',re:/\b(charit|foundation|trust\b|cic\b|c\.i\.c|community interest|association|society|federation|fund\b|philanthrop|ngo\b|aid\b|relief)/i},
 {id:'ai',name:'AI & technology',re:/\b(ai\b|a\.i\.|artificial intelligence|machine learning|data\b|software|technolog|tech\b|digital|labs?\b|platform|analytics|cloud|robotic|automation)/i},
 {id:'mkt',name:'Marketing, strategy & agencies',re:/\b(marketing|brand|agency|agencies|creative|strategy|strateg|insight|consult|advertis|design|growth|campaign|pr\b|public relations)/i},
];

/* ---------- state ---------- */
let orgs=[];           // {name,key,town,county,routes:[{route,rating,type}],lens:Set,towns:string}
let hiring=null;       // Versioned, per-job verification evidence and employer coverage.
let routesAll=new Map();
let view=[], shown=0; const PAGE=60;
let tab='all';
const st={q:'',town:'',townSel:new Set(),routes:new Set(['Skilled Worker']),ratings:new Set(),lens:new Set(),sort:'relevance',hiringOnly:true,categories:new Set(),seniorOnly:false};
let jobsIndex=new Map();
function rebuildJobs(){jobsIndex=new Map();for(const [key,jobs] of Object.entries(hiring?.orgs||{}))jobsIndex.set(key,visibleJobs(jobs,{categories:[...st.categories],seniorOnly:st.seniorOnly,locations:[...st.townSel],locationQuery:st.town}));}
function jobsFor(o){return jobsIndex.get(o.key)||[];}
function sourceFor(o){return hiring?.sources?.find(s=>s.key===o.key);}
function formatTime(value){return new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
async function loadHiring(){try{const r=await fetch('hiring.json',{cache:'no-store'});if(!r.ok)throw new Error();const data=await r.json();if(data.schemaVersion!==2||!data.orgs||!Array.isArray(data.sources))throw new Error();hiring=data;}catch{hiring=null;}rebuildJobs();setupHiring();}

let saved=new Set();
try{saved=new Set(JSON.parse(localStorage.getItem('sf.saved')||'[]'));}catch(e){}
function persistSaved(){try{localStorage.setItem('sf.saved',JSON.stringify([...saved]));}catch(e){}}

/* ---------- IndexedDB cache ---------- */
function idb(){return new Promise((res,rej)=>{try{const r=indexedDB.open('sponsorfinder',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}catch(e){rej(e)}});}
async function cacheGet(){try{const db=await idb();return await new Promise((res,rej)=>{const t=db.transaction('kv').objectStore('kv').get('register');t.onsuccess=()=>res(t.result);t.onerror=()=>rej(t.error);});}catch(e){return null}}
async function cachePut(v){try{const db=await idb();await new Promise((res,rej)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(v,'register');t.oncomplete=res;t.onerror=()=>rej(t.error);});}catch(e){}}
async function cacheClear(){try{const db=await idb();await new Promise((res)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').delete('register');t.oncomplete=res;t.onerror=res;});}catch(e){}}

/* ---------- CSV parsing (RFC 4180-ish, handles quoted newlines) ---------- */
function parseCSV(text){
  const rows=[];let row=[],field='',i=0,q=false;const n=text.length;
  if(text.charCodeAt(0)===0xFEFF)i=1;
  while(i<n){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i+=2;continue;} q=false;i++;continue;} field+=c;i++;continue;}
    if(c==='"'){q=true;i++;continue;}
    if(c===','){row.push(field);field='';i++;continue;}
    if(c==='\r'){i++;continue;}
    if(c==='\n'){row.push(field);rows.push(row);row=[];field='';i++;continue;}
    field+=c;i++;}
  if(field!==''||row.length){row.push(field);rows.push(row);}
  return rows;
}
function buildOrgs(rows){
  const head=rows[0].map(h=>h.trim().toLowerCase());
  const col=(...keys)=>head.findIndex(h=>keys.some(k=>h.includes(k)));
  const cName=col('organisation','organization','name'),cTown=col('town','city'),cCounty=col('county'),cRate=col('rating','type'),cRoute=col('route','tier');
  if(cName<0||cRoute<0)throw new Error('This doesn\'t look like the sponsor register: couldn\'t find an organisation name and route column. Header seen: '+rows[0].join(' | '));
  const map=new Map();routesAll=new Map();
  for(let r=1;r<rows.length;r++){const row=rows[r];const name=(row[cName]||'').trim();if(!name)continue;
    const town=(row[cTown]||'').trim(),county=(row[cCounty]||'').trim(),rate=(row[cRate]||'').trim(),route=(row[cRoute]||'').trim();
    const key=name.toLowerCase()+'|'+town.toLowerCase();
    let o=map.get(key);if(!o){o=map.set(key,{name,key,town,county,routes:[],lens:new Set(),towns:(town+' '+county).toLowerCase(),lname:name.toLowerCase()}).get(key);}
    const rating=/\bA\b/i.test(rate)?'A':(/\bB\b/i.test(rate)?'B':'');
    o.routes.push({route,rating,type:rate});
    routesAll.set(route,(routesAll.get(route)||0)+1);}
  return {list:tagLenses([...map.values()]),rows:rows.length-1};
}
function tagLenses(list){for(const o of list){for(const L of LENSES){if(L.re.test(o.name))o.lens.add(L.id);}}return list;}
function fromBundle(data){
  routesAll=new Map();const list=[];
  for(const [name,town,county,rs] of data.orgs){
    const o={name,key:name.toLowerCase()+'|'+town.toLowerCase(),town,county,routes:[],lens:new Set(),towns:(town+' '+county).toLowerCase(),lname:name.toLowerCase()};
    for(const [ri,rating] of rs){const route=data.routes[ri];o.routes.push({route,rating,type:''});routesAll.set(route,(routesAll.get(route)||0)+1);}
    list.push(o);}
  return {list:tagLenses(list),rows:data.rows};
}
function showData(built,label){
  orgs=built.list;$('fileinfo').innerHTML=label;
  $('loader').hidden=true;$('results').hidden=false;$('stats').hidden=false;setupHiring();
  renderRoutes();renderLenses();renderTownChips();applyFilters();
}
async function loadBundled(){
  $('fileinfo').textContent='Loading the bundled register…';
  let data=null;
  try{const r=await fetch('register.json');if(r.ok)data=await r.json();}catch(e){}
  if(!data){$('fileinfo').textContent='Bundled register unavailable';$('loader').hidden=false;return;}
  showData(fromBundle(data),'Bundled register dated <b>'+esc(data.date)+'</b> · '+data.rows.toLocaleString()+' rows · <button class="linkbtn" id="newer">load a newer file</button>');
  $('newer').addEventListener('click',openLoader);
}

/* ---------- loading ---------- */
async function loadText(text,fileName,fromCache){
  $('loaderr').hidden=true;$('prog').hidden=false;$('prog').firstElementChild.style.width='30%';$('loadmsg').textContent='Parsing '+(fileName||'register')+'…';
  await new Promise(r=>setTimeout(r,20));
  try{const rows=parseCSV(text);$('prog').firstElementChild.style.width='70%';await new Promise(r=>setTimeout(r,10));
    const built=buildOrgs(rows);orgs=built.list;
    $('prog').firstElementChild.style.width='100%';
    if(!fromCache)await cachePut({text,fileName,savedAt:Date.now()});
    const dateM=/(\d{4}-\d{2}-\d{2})/.exec(fileName||'');
    showData(built,'Your file <b>'+esc(fileName||'register.csv')+'</b>'+(dateM?' · dated <b>'+dateM[1]+'</b>':'')+' · '+built.rows.toLocaleString()+' rows · <button class="linkbtn" id="usebundled">back to bundled</button>');
    $('usebundled').addEventListener('click',async()=>{await cacheClear();loadBundled();});
  }catch(e){$('prog').hidden=true;$('loaderr').hidden=false;$('loaderr').textContent=e.message||String(e);$('loadmsg').textContent='Choose a different file.';}
}
function readFile(f){if(!f)return;if(f.size>60e6){$('loaderr').hidden=false;$('loaderr').textContent='That file is '+(f.size/1e6).toFixed(0)+' MB, far bigger than the register. Pick the sponsor register CSV.';return;}
  const rd=new FileReader();rd.onload=()=>loadText(rd.result,f.name,false);rd.onerror=()=>{$('loaderr').hidden=false;$('loaderr').textContent='Could not read that file.';};rd.readAsText(f);}
$('file').addEventListener('change',e=>readFile(e.target.files[0]));
const L=$('loader');
['dragenter','dragover'].forEach(ev=>L.addEventListener(ev,e=>{e.preventDefault();L.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>L.addEventListener(ev,e=>{e.preventDefault();L.classList.remove('drag');}));
L.addEventListener('drop',e=>readFile(e.dataTransfer.files[0]));
document.addEventListener('paste',e=>{const f=e.clipboardData&&e.clipboardData.files&&e.clipboardData.files[0];if(f)readFile(f);});
function openLoader(){$('loader').hidden=false;$('prog').hidden=true;$('loaderr').hidden=true;$('loadmsg').textContent='Download the latest CSV from gov.uk, then drop it here.';$('file').value='';$('loader').scrollIntoView({behavior:'smooth',block:'start'});}
$('reload').addEventListener('click',openLoader);
$('cancelload').addEventListener('click',()=>{$('loader').hidden=true;});

/* ---------- filter UI ---------- */
function renderRoutes(){const el=$('routes');el.innerHTML='';
  const entries=[...routesAll.entries()].sort((a,b)=>b[1]-a[1]);
  if(!entries.some(e=>e[0]==='Skilled Worker')){st.routes.clear();}
  for(const [r,c] of entries){const b=document.createElement('button');b.className='chip';b.setAttribute('aria-pressed',st.routes.has(r)?'true':'false');
    b.innerHTML=esc(r)+' <span class="c">'+c.toLocaleString()+'</span>';b.addEventListener('click',()=>{st.routes.has(r)?st.routes.delete(r):st.routes.add(r);b.setAttribute('aria-pressed',st.routes.has(r));applyFilters();});el.appendChild(b);}}
function renderLenses(){const el=$('lenses');el.innerHTML='';
  for(const Ln of LENSES){const c=orgs.reduce((a,o)=>a+(o.lens.has(Ln.id)?1:0),0);
    const b=document.createElement('button');b.className='chip';b.dataset.l=Ln.id;b.setAttribute('aria-pressed',st.lens.has(Ln.id)?'true':'false');
    b.innerHTML='<span>'+esc(Ln.name)+'</span><span class="c">'+c.toLocaleString()+'</span>';
    b.addEventListener('click',()=>{st.lens.has(Ln.id)?st.lens.delete(Ln.id):st.lens.add(Ln.id);b.setAttribute('aria-pressed',st.lens.has(Ln.id));applyFilters();});el.appendChild(b);}}
function renderTownChips(){const el=$('townchips');el.innerHTML='';
  for(const [k,t] of LOCATION_FILTERS){const b=document.createElement('button');b.className='chip';b.textContent=t;b.dataset.t=k;b.setAttribute('aria-pressed',st.townSel.has(k)?'true':'false');
    b.addEventListener('click',()=>{st.townSel.has(k)?st.townSel.delete(k):st.townSel.add(k);syncTownChips();applyFilters();});el.appendChild(b);}}
function syncTownChips(){for(const b of $('townchips').children)b.setAttribute('aria-pressed',st.townSel.has(b.dataset.t)?'true':'false');}
let deb;$('q').addEventListener('input',()=>{clearTimeout(deb);deb=setTimeout(()=>{st.q=$('q').value.trim().toLowerCase();applyFilters();},120);});
$('town').addEventListener('input',()=>{clearTimeout(deb);deb=setTimeout(()=>{st.town=$('town').value.trim().toLowerCase();syncTownChips();applyFilters();},120);});
for(const b of $('ratings').children)b.addEventListener('click',()=>{const r=b.dataset.r;st.ratings.has(r)?st.ratings.delete(r):st.ratings.add(r);b.setAttribute('aria-pressed',st.ratings.has(r));applyFilters();});
$('sort').addEventListener('change',()=>{st.sort=$('sort').value;applyFilters();});
$('hiringonly').addEventListener('change',()=>{st.hiringOnly=$('hiringonly').checked;applyFilters();});
function setupHiring(){
  $('hiringgroup').hidden=false;$('stat-hiring').hidden=false;
  const sources=hiring?.sources||[], active=Object.values(hiring?.orgs||{}).flatMap(j=>visibleJobs(j));
  const fresh=hiring&&Date.parse(hiring.expiresAt)>Date.now();
  $('hiringhint').textContent='Only UK and Ireland postings verified within 24 hours and relevant to Alex. Unchecked, expired and unavailable jobs are excluded.';
  $('feedstatus').textContent=!hiring?'Vacancy data is unavailable. No jobs can currently be verified. Retry the refresh.':!fresh?'The vacancy checks have expired. Refresh to verify current openings.':active.length.toLocaleString()+' relevant UK & Ireland postings · checked '+formatTime(hiring.generatedAt)+'. Individual jobs may close between checks.';
  const incomplete=sources.filter(s=>s.status!=='ok').length;
  $('coveragesummary').textContent=sources.length+' employer sources · '+sources.reduce((n,s)=>n+(s.seen||0),0).toLocaleString()+' listings screened · '+incomplete+' need attention';
  $('coverage-list').innerHTML=sources.map(s=>'<div class="coverage-row"><a href="'+esc(safeURL(s.url)||'#')+'" target="_blank" rel="noopener">'+esc(s.name)+'</a><small>'+esc(!fresh?'Check expired':s.status==='unavailable'?'Could not verify — check employer site':s.status==='partial'?'Some vacancies could not be checked':s.matched?'Verified relevant openings: '+s.matched:'No relevant UK or Ireland openings found in this check')+'</small>'+((s.expired||s.outsideSupportedLocations)?'<small>Excluded: '+(s.expired||0)+' past closing date · '+(s.outsideSupportedLocations||0)+' outside confirmed UK / Ireland locations</small>':'')+(s.message?'<span class="err">'+esc(s.message)+'</span>':'')+'</div>').join('');
}
for(const category of CATEGORIES){const b=document.createElement('button');b.className='chip';b.textContent=category;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{st.categories.has(category)?st.categories.delete(category):st.categories.add(category);b.setAttribute('aria-pressed',st.categories.has(category));applyFilters();});$('rolechips').appendChild(b);}
$('senioronly').addEventListener('change',()=>{st.seniorOnly=$('senioronly').checked;applyFilters();});
$('refreshjobs').addEventListener('click',async()=>{
  const button=$('refreshjobs');button.disabled=true;button.textContent='Checking employers…';$('feedstatus').textContent='Checking live employer boards and vacancy closing dates. This may take a minute.';
  try{const r=await fetch('/api/refresh',{method:'POST',signal:AbortSignal.timeout(180000)});if(!r.ok)throw new Error();const data=await r.json();if(data.schemaVersion!==2)throw new Error();hiring=data;setupHiring();applyFilters();toast('Employer checks updated');}
  catch{setupHiring();$('feedstatus').textContent='Live refresh is unavailable right now. Existing results keep their original verification times. Use the employer links in source coverage to check current vacancies.';applyFilters();}
  finally{button.disabled=false;button.textContent='Refresh live jobs';}
});
$('reset').addEventListener('click',()=>{st.q='';st.town='';st.townSel.clear();st.lens.clear();st.categories.clear();st.seniorOnly=false;$('senioronly').checked=false;for(const b of $('rolechips').children)b.setAttribute('aria-pressed','false');st.hiringOnly=true;$('hiringonly').checked=true;st.ratings.clear();st.routes=new Set(routesAll.has('Skilled Worker')?['Skilled Worker']:[]);st.sort='relevance';
  $('q').value='';$('town').value='';$('sort').value='relevance';for(const b of $('ratings').children)b.setAttribute('aria-pressed','false');syncTownChips();renderRoutes();renderLenses();applyFilters();});
$('tab-all').addEventListener('click',()=>{tab='all';setTabs();applyFilters();});
$('tab-saved').addEventListener('click',()=>{tab='saved';setTabs();applyFilters();});
function setTabs(){$('tab-all').setAttribute('aria-selected',tab==='all');$('tab-saved').setAttribute('aria-selected',tab==='saved');}

/* ---------- filtering ---------- */
function applyFilters(){rebuildJobs();if(!orgs.length)return;
  const q=st.q,t=st.town;
  view=orgs.filter(o=>{
    if(tab==='saved'&&!saved.has(o.key))return false;
    if(st.hiringOnly&&!jobsFor(o).length)return false;
    if((st.categories.size||st.seniorOnly)&&!jobsFor(o).length)return false;
    if(q&&!o.lname.includes(q)&&!jobsFor(o).some(j=>j.t.toLowerCase().includes(q)||j.e.toLowerCase().includes(q)))return false;
    if((t||st.townSel.size)&&!jobsFor(o).length){
      // An employer with verified roles elsewhere must not reappear through its office address.
      if(visibleJobs(hiring?.orgs?.[o.key]||[]).length||!matchesLocation({l:o.towns},[...st.townSel],t))return false;
    }
    if(st.lens.size){let ok=false;for(const l of st.lens)if(o.lens.has(l)){ok=true;break;}if(!ok)return false;}
    if(st.routes.size||st.ratings.size){const ok=o.routes.some(r=>(!st.routes.size||st.routes.has(r.route))&&(!st.ratings.size||st.ratings.has(r.rating)));if(!ok)return false;}
    return true;});
  const cmpName=(a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'});
  if(st.sort==='name')view.sort(cmpName);
  else if(st.sort==='town')view.sort((a,b)=>a.town.localeCompare(b.town)||cmpName(a,b));
  else view.sort((a,b)=>(Math.max(0,...jobsFor(b).map(j=>matchRole(j.t,j.description).score))-Math.max(0,...jobsFor(a).map(j=>matchRole(j.t,j.description).score)))||cmpName(a,b));
  shown=0;$('list').innerHTML='';renderMore();
  $('cnt').textContent=view.length.toLocaleString();$('cntlabel').textContent=(view.length===1?'organisation':'organisations')+(tab==='saved'?' saved':'')+' · '+view.reduce((n,o)=>n+jobsFor(o).length,0)+' verified roles';
  $('empty').hidden=view.length>0;
  $('empty').textContent=st.hiringOnly?'No verified relevant jobs match these filters. This does not mean the employer has no vacancies. Check source coverage above, refresh, or turn off the verified-jobs filter to browse the register.':'No sponsors match these filters.';
  updateStats();
}
function renderMore(){const frag=document.createDocumentFragment();const end=Math.min(view.length,shown+PAGE);
  for(let i=shown;i<end;i++)frag.appendChild(card(view[i]));$('list').appendChild(frag);shown=end;$('more').hidden=shown>=view.length;
  $('morebtn').textContent='Show more ('+(view.length-shown).toLocaleString()+' left)';}
$('morebtn').addEventListener('click',renderMore);
function updateStats(){$('s-rows').textContent=[...routesAll.values()].reduce((a,b)=>a+b,0).toLocaleString();$('s-orgs').textContent=orgs.length.toLocaleString();
  $('s-sw').textContent=orgs.filter(o=>o.routes.some(r=>r.route==='Skilled Worker')).length.toLocaleString();
  $('s-lens').textContent=orgs.filter(o=>o.lens.size).length.toLocaleString();$('s-hiring').textContent=orgs.filter(o=>jobsFor(o).length).length.toLocaleString();$('s-saved').textContent=saved.size.toLocaleString();$('savedn').textContent=saved.size?'('+saved.size+')':'';}

/* ---------- cards ---------- */
const STAR='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.7 5.9 21.1l1.4-6.8L2.2 9.6l6.9-.8z"/></svg>';
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function hl(name){if(!st.q)return esc(name);const i=name.toLowerCase().indexOf(st.q);if(i<0)return esc(name);return esc(name.slice(0,i))+'<mark>'+esc(name.slice(i,i+st.q.length))+'</mark>'+esc(name.slice(i+st.q.length));}
function card(o){const d=document.createElement('article');d.className='org';
  const where=[o.town,o.county].filter(Boolean).join(', ');
  const routes=o.routes.map(r=>'<span class="rt '+(r.rating==='A'?'a':r.rating==='B'?'b':'')+(r.route==='Skilled Worker'?' sw':'')+'">'+esc(r.route)+(r.rating?' <b>'+r.rating+'</b>':'')+'</span>').join('');
  const tags=[...o.lens].map(id=>'<span class="tag">'+esc(LENSES.find(l=>l.id===id).name)+'</span>').join('');
  const qn=encodeURIComponent(o.name);
  const jobs=jobsFor(o);
  const jobHTML=j=>{const m=matchRole(j.t,j.description);return '<li><a href="'+esc(safeURL(j.u))+'" target="_blank" rel="noopener">'+esc(j.t)+'</a><span class="reason">'+esc(m.categories.join(' · '))+' — '+esc(m.reasons.join('; '))+'</span>'+(j.review?'<span class="review-note"><strong>'+esc(j.review.fit)+'</strong> · '+esc(j.review.summary)+'<br>Check: '+esc(j.review.caveat)+'</span>':'')+'<span class="jm">'+esc([j.l,j.salary].filter(Boolean).join(' · '))+'</span><span class="jm">Checked '+esc(formatTime(j.verifiedAt))+(j.closesAt?' · Closes '+esc(j.closesAt.slice(0,10)):' · No closing date published')+' · '+esc(j.e)+'</span><span class="jm">'+esc(j.evidence)+'</span>'+(isUKWideRemote(j.l,j.country)?'<span class="jm">UK-wide remote option — includes Scotland; confirm working arrangements.</span>':'')+(permitNote(j)?'<span class="jm">'+esc(permitNote(j))+'</span>':'')+'</li>';};
  const jobsHtml=jobs.length?'<ul class="jobs">'+jobs.slice(0,6).map(jobHTML).join('')+'</ul>'+(jobs.length>6?'<details><summary>Show all '+jobs.length+' verified roles</summary><ul class="jobs">'+jobs.slice(6).map(jobHTML).join('')+'</ul></details>':''):'<p class="unverified">'+(sourceFor(o)?'No verified matches in the current feed. See source coverage above.':'This employer’s vacancies have not been checked.')+'</p>';
  const careers=safeURL(sourceFor(o)?.url)||'https://www.google.com/search?q='+qn+'+careers+jobs';
  d.innerHTML='<div><div class="name">'+hl(o.name)+(jobs.length?' <span class="hire">Verified matches · '+jobs.length+'</span>':'')+'</div>'+(where?'<div class="where">UK register address: '+esc(where)+'</div>':'')+'<div class="routes">'+routes+'</div>'+(tags?'<div class="lenses">'+tags+'</div>':'')+jobsHtml+'</div>'
   +'<div class="acts"><button class="star" aria-pressed="'+saved.has(o.key)+'" aria-label="Save '+esc(o.name)+'">'+STAR+'</button>'
   +'<a href="'+esc(careers)+'" target="_blank" rel="noopener">Careers</a>'
   +'<a href="https://www.linkedin.com/search/results/companies/?keywords='+qn+'" target="_blank" rel="noopener">LinkedIn</a>'
   +'<a href="https://find-and-update.company-information.service.gov.uk/search/companies?q='+qn+'" target="_blank" rel="noopener">Companies House</a></div>';
  d.querySelector('.star').addEventListener('click',e=>{const b=e.currentTarget;if(saved.has(o.key)){saved.delete(o.key);b.setAttribute('aria-pressed','false');toast('Removed from saved');}else{saved.add(o.key);b.setAttribute('aria-pressed','true');toast('Saved');}persistSaved();updateStats();if(tab==='saved')applyFilters();});
  return d;}

/* ---------- copy ---------- */
$('copy').addEventListener('click',()=>{if(!view.length){toast('Nothing to copy yet');return;}
  const lines=['Organisation\tTown\tCounty\tRoutes\tLenses\tOpen postings'];for(const o of view.slice(0,5000))lines.push([o.name,o.town,o.county,o.routes.map(r=>r.route+(r.rating?' ('+r.rating+')':'')).join('; '),[...o.lens].map(id=>LENSES.find(l=>l.id===id).name).join('; '),jobsFor(o).map(j=>j.t+' '+j.u).join('; ')].join('\t'));
  const txt=lines.join('\n');
  const done=()=>toast('Copied '+Math.min(view.length,5000).toLocaleString()+' rows as tab-separated text');
  const fallback=()=>{const ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){toast('Copy blocked in this view');}ta.remove();};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done,fallback);else fallback();});
let tt;function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),1800);}

/* ---------- boot ---------- */
(async()=>{await loadHiring();const c=await cacheGet();if(c&&c.text){$('fileinfo').textContent='Restoring the register you loaded earlier…';await loadText(c.text,c.fileName,true);}else{await loadBundled();}})();
setInterval(()=>{setupHiring();applyFilters();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){setupHiring();applyFilters();}});
})();
