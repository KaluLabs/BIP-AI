const state={projects:[],events:[],campaigns:[],selected:null,config:{}};
const $=(id)=>document.getElementById(id);
const esc=(value='')=>String(value).replace(/[&<>'\"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const when=(value)=>value?new Date(value).toLocaleString():'—';
const statusClass=(value='')=>/pass|ready|approved|succeeded|high/i.test(value)?'good':/review|pending|medium|requested|authorized/i.test(value)?'warn':/block|fail|denied|expired/i.test(value)?'bad':'muted';
const pill=(value)=>`<span class="pill ${statusClass(value)}">${esc(value||'unknown')}</span>`;

async function api(path,options={}){
  const headers={...(options.body?{'content-type':'application/json','x-bipai-csrf':'1'}:{}),...(options.headers||{})};
  const res=await fetch(path,{...options,headers}); const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`); return data;
}
function notify(message,type='success'){const el=$('notice');el.textContent=message;el.className=`notice ${type}`;setTimeout(()=>el.classList.add('hidden'),4500)}

async function load(){
  try{
    const [health,config,projects,events,campaigns]=await Promise.all([api('/api/health'),api('/api/config'),api('/api/projects'),api('/api/events'),api('/api/campaigns')]);
    state.projects=projects.projects; state.events=events.events; state.campaigns=campaigns.campaigns; state.config=config;
    $('health').textContent=health.ok?'Local service online':'Unavailable'; $('health').className=`pill ${health.ok?'good':'bad'}`;
    render(); if(state.selected) await selectCampaign(state.selected);
  }catch(error){$('health').textContent='Service error';$('health').className='pill bad';notify(error.message,'error')}
}

function render(){renderMetrics();renderProjects();renderEvents();renderCalendar();renderCampaigns()}
function renderMetrics(){
  const review=state.campaigns.filter(c=>c.editorialStatus==='needs_review'||c.privacyResult==='REVIEW').length;
  const approved=state.campaigns.filter(c=>c.editorialStatus==='approved_for_handoff').length;
  const html=[['Projects',state.projects.length],['Events',state.events.length],['Needs review',review],['Approved',approved]].map(([label,value])=>`<div class="metric"><div class="value">${value}</div><div class="label">${label}</div></div>`).join('');$('metrics').innerHTML=html;
}
function renderProjects(){
  $('projects').innerHTML=state.projects.length?state.projects.map(p=>`<div class="project-card"><strong>${esc(p.name||p.id)}</strong><span class="subtle">${esc(p.id)}</span><code>${esc(p.path||'')}</code></div>`).join(''):'<p class="subtle">No capture projects configured yet.</p>';
}
function renderEvents(){
  $('event-count').textContent=`${state.events.length} total`;
  $('events').innerHTML=state.events.length?state.events.slice(0,30).map(e=>`<div class="event"><strong>${esc(e.summary)}</strong><p>${esc(e.details||e.type)}</p><div class="meta">${pill(e.evaluation?.level)}${pill(e.privacy?.result)}<span class="subtle">${esc(e.projectId)} · ${esc(when(e.occurredAt))}</span></div></div>`).join(''):'<p class="subtle">No events captured yet.</p>';
}
function renderCalendar(){
  const now=new Date(); const year=now.getFullYear(),month=now.getMonth(); const first=new Date(year,month,1); const days=new Date(year,month+1,0).getDate(); const cells=[];
  for(let i=0;i<first.getDay();i++)cells.push('<div class="calendar-day"></div>');
  for(let day=1;day<=days;day++){const matches=state.campaigns.filter(c=>{const d=new Date(c.createdAt);return d.getFullYear()===year&&d.getMonth()===month&&d.getDate()===day});cells.push(`<div class="calendar-day"><strong>${day}</strong>${matches.slice(0,3).map(c=>`<span class="calendar-dot">${esc(c.storyBrief?.hook||c.projectId)}</span>`).join('')}</div>`)}
  $('calendar').innerHTML=cells.join('');
}
function renderCampaigns(){
  $('campaign-count').textContent=`${state.campaigns.length} total`;
  $('campaigns').innerHTML=state.campaigns.length?state.campaigns.map(c=>`<div class="campaign-item ${state.selected===c.id?'active':''}" data-id="${esc(c.id)}"><h3>${esc(c.storyBrief?.hook||c.projectId)}</h3><small>${esc(c.projectId)} · v${c.version} · ${esc(when(c.updatedAt))}</small><div class="meta">${pill(c.editorialStatus)}${pill(c.privacyResult)}${pill(c.evaluation?.level)}</div></div>`).join(''):'<p class="subtle">No campaigns yet.</p>';
  document.querySelectorAll('.campaign-item').forEach(el=>el.addEventListener('click',()=>selectCampaign(el.dataset.id)));
}

async function selectCampaign(id){
  try{state.selected=id;renderCampaigns();const {campaign,versions}=await api(`/api/campaigns/${encodeURIComponent(id)}`);renderDetail(campaign,versions)}catch(error){notify(error.message,'error')}
}
function renderDetail(c,versions){
  const approval=c.campaignApproval; const claims=[...(c.drafts?.x?.claims||[]),...(c.drafts?.linkedin?.claims||[])];
  const uniqueClaims=[...new Map(claims.map(x=>[`${x.source}|${x.text}`,x])).values()];
  $('campaign-detail').className=''; $('campaign-detail').innerHTML=`
    <div class="detail-head"><div><p class="eyebrow">${esc(c.projectId)} · CAMPAIGN</p><h2>${esc(c.storyBrief?.hook||'Campaign')}</h2><p>${esc(c.storyBrief?.whatChanged||'')}</p></div><div class="actions">${pill(c.editorialStatus)}${pill(c.privacyResult)}${pill(c.qualityResult||'PASS')}</div></div>
    <div class="section"><h3>Approval integrity</h3><div class="row">${approval?pill('approved'):pill('not approved')}<span>Version <strong>${c.version}</strong></span></div><p class="hash">contentHash ${esc(c.contentHash)}</p>${approval?`<p class="hash">approved v${approval.version} · ${esc(approval.contentHash)} · ${esc(when(approval.approvedAt))}</p>`:''}</div>
    <div class="section"><h3>Drafts</h3><div class="draft-grid"><div class="field"><label>X THREAD — separate posts with ---</label><textarea id="x-draft">${esc((c.drafts?.x?.posts||[]).join('\n---\n'))}</textarea></div><div class="field"><label>LINKEDIN</label><textarea id="linkedin-draft">${esc(c.drafts?.linkedin?.text||'')}</textarea></div></div><div class="actions"><button class="button secondary" id="save-editorial">Save edits</button><button class="button secondary" id="regen-draft">Regenerate</button><button class="button" id="approve-campaign">Approve exact version</button></div></div>
    <div class="section"><h3>PAG handoff</h3><div class="draft-grid"><div><p>X</p>${pill(c.platform?.x?.handoffStatus)}<p class="hash">${esc(c.platform?.x?.pagActionId||'No intent yet')}</p><div class="actions"><button class="button secondary" id="request-x">Request X</button><button class="button secondary" id="sync-x">Sync</button></div></div><div><p>LinkedIn</p>${pill(c.platform?.linkedin?.handoffStatus)}<p class="hash">${esc(c.platform?.linkedin?.pagActionId||'No intent yet')}</p><div class="actions"><button class="button secondary" id="request-linkedin">Request LinkedIn</button><button class="button secondary" id="sync-linkedin">Sync</button></div></div></div></div>
    <div class="section"><h3>Claim provenance</h3><div class="claims">${uniqueClaims.length?uniqueClaims.map(x=>`<div class="claim"><code>${esc(x.source||'unsupported')}</code><p>${esc(x.text)}</p></div>`).join(''):'<p class="subtle">No claims recorded.</p>'}</div></div>
    <div class="section"><h3>Version history</h3><div class="versions">${versions.map(v=>`<div class="version">v${v.version} · ${esc(v.contentHash.slice(0,10))}… · ${esc(v.status)}</div>`).join('')}</div></div>
  `;
  wireDetail(c);
}
function wireDetail(c){
  $('save-editorial').onclick=()=>mutate(`/api/campaigns/${c.id}/editorial`,{x:{posts:$('x-draft').value.split(/\n---\n/g).map(x=>x.trim()).filter(Boolean)},linkedin:{text:$('linkedin-draft').value}},'Draft edits saved');
  $('regen-draft').onclick=()=>mutate(`/api/campaigns/${c.id}/draft/regenerate`,{},'Draft regenerated');
  $('approve-campaign').onclick=()=>mutate(`/api/campaigns/${c.id}/approve`,{},'Exact campaign version approved');
  $('request-x').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/x`,{},'X handoff requested');
  $('request-linkedin').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/linkedin`,{},'LinkedIn handoff requested');
  $('sync-x').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/x/reconcile`,{},'X handoff reconciled');
  $('sync-linkedin').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/linkedin/reconcile`,{},'LinkedIn handoff reconciled');
}
async function mutate(path,body,message){
  try{await api(path,{method:'POST',body:JSON.stringify(body)});notify(message);await load()}catch(error){notify(error.message,'error')}
}

$('project-form').addEventListener('submit',async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));try{await api('/api/projects',{method:'POST',body:JSON.stringify(data)});event.currentTarget.reset();notify('Project capture source added');await load()}catch(error){notify(error.message,'error')}});
$('refresh').addEventListener('click',load);
load();
