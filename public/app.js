const state={
  projects:[],events:[],campaigns:[],calendarCampaigns:[],approvalItems:[],capture:null,selected:null,config:{},
  eventPagination:null,campaignPagination:null,approvalPagination:null,approvalSummary:{total:0},loading:false
};
const $=(id)=>document.getElementById(id);
const esc=(value='')=>String(value).replace(/[&<>'\"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const when=(value)=>value?new Date(value).toLocaleString():'—';
const browserTimezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const statusClass=(value='')=>/pass|ready|approved|succeeded|published|completed|healthy|high/i.test(value)?'good':/review|pending|medium|requested|accepted|authorized|planned|handed_off|retryable|overdue|warning/i.test(value)?'warn':/block|fail|failed|denied|expired|degraded/i.test(value)?'bad':'muted';
const pill=(value)=>`<span class="pill ${statusClass(value)}">${esc(value||'unknown')}</span>`;

const DEFAULT_QUERY={
  project:'',q:'',privacy:'',source:'',platform:'',status:'',attention:'',from:'',to:'',
  esort:'occurredAt',eorder:'desc',epage:1,
  csort:'updatedAt',corder:'desc',cpage:1,ipage:1,pageSize:20,campaign:''
};

function queryState(){
  const p=new URLSearchParams(location.search);
  const positive=(key,fallback)=>{const n=Number(p.get(key));return Number.isInteger(n)&&n>0?n:fallback};
  return {
    project:p.get('project')||'',
    q:p.get('q')||'',
    privacy:p.get('privacy')||'',
    source:p.get('source')||'',
    platform:p.get('platform')||'',
    status:p.get('status')||'',
    attention:p.get('attention')||'',
    from:p.get('from')||'',
    to:p.get('to')||'',
    esort:p.get('esort')||'occurredAt',
    eorder:p.get('eorder')||'desc',
    epage:positive('epage',1),
    csort:p.get('csort')||'updatedAt',
    corder:p.get('corder')||'desc',
    cpage:positive('cpage',1),
    ipage:positive('ipage',1),
    pageSize:Math.min(100,positive('pageSize',20)),
    campaign:p.get('campaign')||''
  };
}

function setUrl(values,{resetPages=false,replace=true}={}){
  const current=queryState();
  const next={...current,...values};
  if(resetPages){next.epage=1;next.cpage=1;next.ipage=1}
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(next)){
    const def=DEFAULT_QUERY[key];
    if(value!==''&&value!=null&&String(value)!==String(def))params.set(key,String(value));
  }
  const url=`${location.pathname}${params.size?`?${params}`:''}`;
  history[replace?'replaceState':'pushState']({},'',url);
  return next;
}

function apiParams(kind,{calendar=false}={}){
  const q=queryState();
  const p=new URLSearchParams();
  const common={q:q.q,projectId:q.project,privacy:q.privacy,source:q.source};
  for(const [key,value] of Object.entries(common))if(value)p.set(key,value);
  if(kind==='campaigns'||kind==='inbox'){
    if(q.platform)p.set('platform',q.platform);
    if(q.status)p.set('status',q.status);
  }
  if(kind==='inbox'&&q.attention)p.set('category',q.attention);
  if(calendar){
    const now=new Date(); const start=new Date(now.getFullYear(),now.getMonth(),1); const end=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59,999);
    p.set('from',start.toISOString()); p.set('to',end.toISOString());
    p.set('sort','scheduledAt'); p.set('order','asc'); p.set('page','1'); p.set('pageSize','100');
  }else{
    if(q.from)p.set('from',q.from);
    if(q.to)p.set('to',q.to);
    if(kind==='events'){
      p.set('sort',q.esort);p.set('order',q.eorder);p.set('page',String(q.epage));
    }else if(kind==='inbox'){
      p.set('sort','priority');p.set('order','desc');p.set('page',String(q.ipage));
    }else{
      p.set('sort',q.csort);p.set('order',q.corder);p.set('page',String(q.cpage));
    }
    p.set('pageSize',String(q.pageSize));
  }
  return p;
}

function toLocalInput(value){
  if(!value)return '';
  const d=new Date(value); if(Number.isNaN(d.getTime()))return '';
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}

async function api(path,options={}){
  const headers={...(options.body?{'content-type':'application/json','x-bipai-csrf':'1'}:{}),...(options.headers||{})};
  const res=await fetch(path,{...options,headers}); const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`); return data;
}
function notify(message,type='success'){const el=$('notice');el.textContent=message;el.className=`notice ${type}`;setTimeout(()=>el.classList.add('hidden'),4500)}

function setLoading(loading){
  state.loading=loading;
  if(loading){
    $('approval-inbox').innerHTML='<div class="loading-state">Loading approval inbox…</div>';
    $('events').innerHTML='<div class="loading-state">Loading events…</div>';
    $('campaigns').innerHTML='<div class="loading-state">Loading campaigns…</div>';
    $('calendar').innerHTML='<div class="loading-state calendar-loading">Loading schedule…</div>';
  }
}

async function load(){
  setLoading(true);
  try{
    const [health,config,projects]=await Promise.all([api('/api/health'),api('/api/config'),api('/api/projects')]);
    state.projects=projects.projects;state.config=config;
    syncFilterControls();
    const capturePromise=config.captureEnabled
      ? api('/api/capture/status').catch((error)=>({error:error.message,sources:[]}))
      : Promise.resolve(null);
    const [events,campaigns,calendar,inbox,capture]=await Promise.all([
      api(`/api/events?${apiParams('events')}`),
      api(`/api/campaigns?${apiParams('campaigns')}`),
      api(`/api/campaigns?${apiParams('campaigns',{calendar:true})}`),
      api(`/api/approval-inbox?${apiParams('inbox')}`),
      capturePromise
    ]);
    state.events=events.events;state.eventPagination=events.pagination;
    state.campaigns=campaigns.campaigns;state.campaignPagination=campaigns.pagination;
    state.calendarCampaigns=calendar.campaigns;
    state.approvalItems=inbox.items;state.approvalPagination=inbox.pagination;state.approvalSummary=inbox.summary||{total:0};
    state.capture=capture;
    const selected=queryState().campaign;
    state.selected=selected||null;
    $('health').textContent=health.ok?'Local service online':'Unavailable';$('health').className=`pill ${health.ok?'good':'bad'}`;
    render();
    if(state.selected)await selectCampaign(state.selected,{updateUrl:false});
    else renderEmptyDetail();
  }catch(error){
    $('health').textContent='Service error';$('health').className='pill bad';
    $('approval-inbox').innerHTML=`<div class="error-state">${esc(error.message)}</div>`;
    $('events').innerHTML=`<div class="error-state">${esc(error.message)}</div>`;
    $('campaigns').innerHTML=`<div class="error-state">${esc(error.message)}</div>`;
    $('calendar').innerHTML=`<div class="error-state calendar-loading">${esc(error.message)}</div>`;
    notify(error.message,'error');
  }finally{state.loading=false}
}

function syncFilterControls(){
  const q=queryState();
  const project=$('filter-project');
  const options=['<option value="">All projects</option>',...state.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.id)}</option>`)];
  project.innerHTML=options.join('');
  project.value=q.project;
  const githubProject=$('github-project');
  githubProject.innerHTML=['<option value="">Choose project</option>',...state.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.id)}</option>`)].join('');
  if(q.project && state.projects.some(p=>p.id===q.project)) githubProject.value=q.project;
  const configuredProject=state.projects.find(p=>p.id===githubProject.value);
  $('github-repository').value=configuredProject?.github?.repository||'';
  $('github-visibility').value=configuredProject?.github?.visibility||'private';
  $('github-auth').textContent=state.config.githubTokenConfigured?'token configured':'public access / no token';
  $('approval-category').value=q.attention;
  $('filter-q').value=q.q;$('filter-privacy').value=q.privacy;$('filter-source').value=q.source;
  $('filter-platform').value=q.platform;$('filter-status').value=q.status;$('filter-from').value=q.from;$('filter-to').value=q.to;
  $('event-sort').value=q.esort;$('event-order').value=q.eorder;
  $('campaign-sort').value=q.csort;$('campaign-order').value=q.corder;
}

function render(){renderMetrics();renderApprovalInbox();renderProjects();renderCapture();renderEvents();renderCalendar();renderCampaigns()}
function renderMetrics(){
  const review=state.campaigns.filter(c=>c.editorialStatus==='needs_review'||c.privacyResult==='REVIEW').length;
  const scheduled=state.calendarCampaigns.reduce((count,c)=>count+['x','linkedin'].filter(p=>c.platform?.[p]?.schedule?.status==='planned').length,0);
  const eventTotal=state.eventPagination?.total??state.events.length;
  const campaignTotal=state.campaignPagination?.total??state.campaigns.length;
  const degraded=(state.capture?.sources||[]).filter(x=>x.health?.status==='degraded').length;
  const attention=state.approvalSummary?.total??state.approvalItems.length;
  const html=[['Projects',state.projects.length],['Needs attention',attention],['Matching events',eventTotal],['Review on page',review],['Matching campaigns',campaignTotal],['Scheduled this month',scheduled],['Capture degraded',degraded]].map(([label,value])=>`<div class="metric"><div class="value">${value}</div><div class="label">${label}</div></div>`).join('');
  $('metrics').innerHTML=html;
}
function ageLabel(ms){
  const value=Math.max(0,Number(ms)||0);
  const minutes=Math.floor(value/60000);
  if(minutes<60)return `${minutes}m old`;
  const hours=Math.floor(minutes/60);
  if(hours<48)return `${hours}h old`;
  return `${Math.floor(hours/24)}d old`;
}
function attentionLabel(value){return String(value||'').replaceAll('_',' ')}
function renderApprovalInbox(){
  const items=state.approvalItems||[];const page=state.approvalPagination;
  $('approval-count').textContent=page?`${items.length} shown · ${page.total} actionable`:`${items.length} actionable`;
  const approve=$('approve-selected');approve.disabled=true;approve.textContent='Approve selected';
  $('approval-inbox').innerHTML=items.length?items.map(item=>{
    const platform=item.platform?pill(item.platform==='x'?'X':'LinkedIn'):'';
    const blockers=(item.approvalBlockers||[]).length?`<div class="approval-blockers">${item.approvalBlockers.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'';
    const evidence=item.provenance?.summary?`<div class="approval-provenance"><strong>Evidence</strong><span>${esc(item.provenance.summary)}</span><small>${esc(item.provenance.source||'manual')} · ${esc(when(item.provenance.occurredAt))}</small></div>`:'';
    const select=item.canApprove?`<label class="approval-check"><input type="checkbox" class="approval-select" data-campaign="${esc(item.campaignId)}" data-version="${item.campaignVersion}" data-hash="${esc(item.campaignContentHash)}" /> select</label>`:'';
    const approveOne=item.canApprove?`<button class="button secondary approval-one" data-campaign="${esc(item.campaignId)}" data-version="${item.campaignVersion}" data-hash="${esc(item.campaignContentHash)}">Approve exact v${item.campaignVersion}</button>`:'';
    return `<article class="approval-item priority-${item.priority}">
      <div class="row spread"><div class="approval-title"><span class="priority-mark">P${item.priority}</span><strong>${esc(item.title)}</strong></div><div class="row">${platform}${pill(attentionLabel(item.category))}</div></div>
      <p>${esc(item.reason)}</p>
      ${blockers}${evidence}
      <div class="approval-footer"><span class="subtle">${esc(item.projectId)} · campaign v${item.campaignVersion} · ${esc(ageLabel(item.ageMs))}</span><div class="actions">${select}<button class="button secondary approval-open" data-campaign="${esc(item.campaignId)}">Open campaign</button>${approveOne}</div></div>
    </article>`;
  }).join(''):'<div class="empty-list"><strong>Nothing needs attention</strong><span>The current filters have no unresolved approval or publishing items.</span></div>';
  document.querySelectorAll('.approval-open').forEach(el=>el.addEventListener('click',()=>selectCampaign(el.dataset.campaign)));
  document.querySelectorAll('.approval-select').forEach(el=>el.addEventListener('change',()=>{
    const count=document.querySelectorAll('.approval-select:checked').length;
    approve.disabled=count===0;approve.textContent=count?`Approve selected (${count})`:'Approve selected';
  }));
  document.querySelectorAll('.approval-one').forEach(el=>el.addEventListener('click',()=>approveInboxTargets([{
    campaignId:el.dataset.campaign,version:Number(el.dataset.version),contentHash:el.dataset.hash
  }])));
  renderPager('approval-pager',page,'ipage');
}
async function approveInboxTargets(items){
  if(!items.length)return;
  try{
    const result=await api('/api/approval-inbox/approve',{method:'POST',body:JSON.stringify({items})});
    notify(`${result.approved.length} campaign${result.approved.length===1?'':'s'} approved`);
    await load();
  }catch(error){notify(error.message,'error')}
}
function renderProjects(){
  const selected=queryState().project;
  $('projects').innerHTML=state.projects.length?state.projects.map(p=>{
    const github=p.github?.repository?`<span class="github-source-badge">GitHub · ${esc(p.github.repository)} · ${esc(p.github.visibility||'private')}</span>`:'<span class="subtle">GitHub not configured</span>';
    return `<button class="project-card project-select ${selected===p.id?'active':''}" data-project="${esc(p.id)}"><strong>${esc(p.name||p.id)}</strong><span class="subtle">${esc(p.id)}</span><code>${esc(p.path||'')}</code>${github}</button>`;
  }).join(''):'<p class="subtle">No capture projects configured yet.</p>';
  document.querySelectorAll('.project-select').forEach(el=>el.addEventListener('click',()=>applyFilters({project:el.dataset.project})));
}
function renderCapture(){
  const el=$('capture-status'); const run=$('run-capture');
  if(!state.config.captureEnabled){
    run.disabled=true; run.title='Automatic capture is disabled by configuration';
    el.innerHTML='<div class="empty-list"><strong>Capture automation disabled</strong><span>Set BIP_AI_CAPTURE_ENABLED=1 and restart BIP-AI to enable it.</span></div>';
    return;
  }
  run.disabled=false;
  const project=queryState().project;
  run.textContent=project?'Run selected project':'Run all now';
  run.title=project?`Run all capture sources for ${project}`:'Run all configured capture sources';
  if(state.capture?.error){
    el.innerHTML=`<div class="error-state">${esc(state.capture.error)}</div>`; return;
  }
  const sources=state.capture?.sources||[];
  if(!sources.length){
    el.innerHTML='<div class="empty-list"><strong>No capture sources yet</strong><span>Add a project to start automatic capture.</span></div>'; return;
  }
  el.innerHTML=sources.map(source=>{
    const h=source.health||{}; const last=h.lastScan||{};
    const error=h.lastError?`<span class="capture-error">${esc(h.lastError.code)} · ${esc(h.lastError.summary)}</span>`:'';
    const next=h.nextAttemptAt?`<span>${h.status==='degraded'?'next retry':'next scan'} ${esc(when(h.nextAttemptAt))}</span>`:'';
    const stats=h.lastScan?`<span>scan ${Number(last.scanned||0)} · accepted ${Number(last.accepted||0)} · duplicates ${Number(last.duplicates||0)}</span>`:'<span>no scan completed yet</span>';
    const cursor=source.cursor?.headSha
      ? `<code>${esc(source.cursor.headSha.slice(0,12))}</code>`
      : source.cursor?.events?.id || source.cursor?.workflows?.key
        ? `<code>events ${esc(source.cursor?.events?.id||'—')} · runs ${esc(source.cursor?.workflows?.key||'—')}</code>`
        : '<code>no cursor</code>';
    const sourceLabel=source.sourceType==='github'&&source.repository?`${source.sourceType} · ${source.repository}`:source.sourceType;
    return `<div class="capture-card"><div class="row spread"><strong>${esc(source.projectName||source.projectId)}</strong>${pill(h.status||'never_run')}</div><div class="capture-meta"><span>last success ${esc(when(h.lastSuccessAt))}</span>${next}${stats}${error}</div><div class="row spread"><span class="subtle">${esc(sourceLabel)}</span>${cursor}</div></div>`;
  }).join('');
}

function renderEvents(){
  const page=state.eventPagination;
  $('event-count').textContent=page?`${state.events.length} shown · ${page.total} total`:`${state.events.length} total`;
  $('events').innerHTML=state.events.length?state.events.map(e=>`<div class="event"><strong>${esc(e.summary)}</strong><p>${esc(e.details||e.type)}</p><div class="meta">${pill(e.evaluation?.level)}${pill(e.privacy?.result)}<span class="pill muted">${esc(e.source||'manual')}</span><span class="subtle">${esc(e.projectId)} · ${esc(when(e.occurredAt))}</span></div></div>`).join(''):'<div class="empty-list"><strong>No matching events</strong><span>Adjust the search or filters to widen this view.</span></div>';
  renderPager('event-pager',page,'epage');
}
function scheduledEntries(){
  const entries=[];
  for(const c of state.calendarCampaigns){
    for(const platform of ['x','linkedin']){
      const target=c.platform?.[platform];const schedule=target?.schedule;
      if(!schedule)continue;
      entries.push({campaign:c,platform,target,schedule,date:new Date(schedule.scheduledAtUtc)});
    }
  }
  return entries.filter(x=>!Number.isNaN(x.date.getTime()));
}
function renderCalendar(){
  const now=new Date();const year=now.getFullYear(),month=now.getMonth();const first=new Date(year,month,1);const days=new Date(year,month+1,0).getDate();const cells=[];const entries=scheduledEntries();
  for(let i=0;i<first.getDay();i++)cells.push('<div class="calendar-day"></div>');
  for(let day=1;day<=days;day++){
    const matches=entries.filter(x=>x.date.getFullYear()===year&&x.date.getMonth()===month&&x.date.getDate()===day);
    const dots=matches.slice(0,5).map(x=>{
      const overdue=x.schedule.status==='planned'&&x.date.getTime()<=Date.now();
      const label=`${x.platform==='x'?'X':'LinkedIn'} · ${x.date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${x.target.lifecycleStatus||x.schedule.status}`;
      return `<button class="calendar-dot ${overdue?'overdue':''}" data-campaign="${esc(x.campaign.id)}" title="${esc(x.campaign.storyBrief?.hook||x.campaign.projectId)}">${esc(label)}</button>`;
    }).join('');
    cells.push(`<div class="calendar-day"><strong>${day}</strong>${dots}${matches.length>5?`<span class="subtle">+${matches.length-5} more</span>`:''}</div>`);
  }
  $('calendar').innerHTML=cells.join('');
  document.querySelectorAll('.calendar-dot[data-campaign]').forEach(el=>el.addEventListener('click',()=>selectCampaign(el.dataset.campaign)));
}
function renderCampaigns(){
  const page=state.campaignPagination;
  $('campaign-count').textContent=page?`${state.campaigns.length} shown · ${page.total} total`:`${state.campaigns.length} total`;
  $('campaigns').innerHTML=state.campaigns.length?state.campaigns.map(c=>{
    const lifecycle=['x','linkedin'].map(p=>`${p==='x'?'X':'LI'}: ${c.platform?.[p]?.lifecycleStatus||'drafted'}`).join(' · ');
    return `<div class="campaign-item ${state.selected===c.id?'active':''}" data-id="${esc(c.id)}"><h3>${esc(c.storyBrief?.hook||c.projectId)}</h3><small>${esc(c.projectId)} · ${esc(c.source||'manual')} · v${c.version} · ${esc(when(c.updatedAt))}</small><div class="meta">${pill(c.editorialStatus)}${pill(c.privacyResult)}</div><small class="subtle">${esc(lifecycle)}</small></div>`;
  }).join(''):'<div class="empty-list"><strong>No matching campaigns</strong><span>Adjust the search or filters to widen this view.</span></div>';
  document.querySelectorAll('.campaign-item').forEach(el=>el.addEventListener('click',()=>selectCampaign(el.dataset.id)));
  renderPager('campaign-pager',page,'cpage');
}
function renderPager(id,page,key){
  const el=$(id);if(!page){el.innerHTML='';return}
  const label=page.totalPages===0?'Page 0 of 0':`Page ${page.page} of ${page.totalPages}`;
  el.innerHTML=`<button class="button secondary pager-prev" ${page.hasPrevious?'':'disabled'}>← Previous</button><span class="subtle">${esc(label)}</span><button class="button secondary pager-next" ${page.hasNext?'':'disabled'}>Next →</button>`;
  const prev=el.querySelector('.pager-prev');const next=el.querySelector('.pager-next');
  if(page.hasPrevious)prev.onclick=()=>changePage(key,page.page-1);
  if(page.hasNext)next.onclick=()=>changePage(key,page.page+1);
}

function renderEmptyDetail(){
  const el=$('campaign-detail');
  el.className='empty-state';
  el.innerHTML='<div class="empty-icon">↗</div><h3>Select a campaign</h3><p>Inspect drafts, provenance, versions, approvals, schedules, and PAG handoff state.</p>';
}

async function selectCampaign(id,{updateUrl=true}={}){
  try{
    state.selected=id;
    if(updateUrl)setUrl({campaign:id},{replace:false});
    renderCampaigns();
    $('campaign-detail').className='loading-state detail-loading';$('campaign-detail').textContent='Loading campaign…';
    const [detail,history]=await Promise.all([
      api(`/api/campaigns/${encodeURIComponent(id)}`),
      api(`/api/campaigns/${encodeURIComponent(id)}/publishing-history`)
    ]);
    renderDetail(detail.campaign,detail.versions,history.attempts||[]);
  }catch(error){
    $('campaign-detail').className='error-state detail-loading';$('campaign-detail').textContent=error.message;
    notify(error.message,'error');
  }
}
function schedulePanel(c,platform,label){
  const target=c.platform?.[platform]||{};const schedule=target.schedule;const id=`schedule-${platform}`;
  const timing=schedule?`<p class="schedule-time"><strong>${esc(when(schedule.scheduledAtUtc))}</strong><br><span class="subtle">${esc(schedule.timezone||'UTC')} · ${esc(schedule.status)}</span></p>`:'<p class="subtle">No publication time planned.</p>';
  return `<div class="schedule-card"><div class="row spread"><strong>${esc(label)}</strong>${pill(target.lifecycleStatus||'drafted')}</div>${timing}<div class="field"><label>PLANNED LOCAL TIME</label><input id="${id}" type="datetime-local" value="${esc(toLocalInput(schedule?.scheduledAtUtc))}" /></div><div class="actions"><button class="button secondary" id="${id}-save">${schedule?'Reschedule':'Schedule'}</button>${schedule?`<button class="button danger" id="${id}-clear">Clear</button>`:''}</div>${schedule?.lastError?`<p class="schedule-error">Needs attention: ${esc(schedule.lastError)}</p>`:''}</div>`;
}
function renderDetail(c,versions,publishingAttempts=[]){
  const approval=c.campaignApproval;const claims=[...(c.drafts?.x?.claims||[]),...(c.drafts?.linkedin?.claims||[])];
  const uniqueClaims=[...new Map(claims.map(x=>[`${x.source}|${x.text}`,x])).values()];
  $('campaign-detail').className='';$('campaign-detail').innerHTML=`
    <div class="detail-head"><div><p class="eyebrow">${esc(c.projectId)} · CAMPAIGN</p><h2>${esc(c.storyBrief?.hook||'Campaign')}</h2><p>${esc(c.storyBrief?.whatChanged||'')}</p></div><div class="actions">${pill(c.editorialStatus)}${pill(c.privacyResult)}${pill(c.qualityResult||'PASS')}</div></div>
    ${c.privacyResult==='REVIEW'?`<div class="section privacy-review"><h3>Privacy review</h3><p>This decision is separate from editorial approval. Record why this captured evidence is safe to publish or must remain blocked.</p><div class="field"><label>REVIEW NOTE</label><textarea id="privacy-review-note" placeholder="Record the privacy decision rationale"></textarea></div><div class="actions"><button class="button" id="privacy-pass">Mark privacy PASS</button><button class="button danger" id="privacy-block">Block publishing</button></div></div>`:''}
    <div class="section"><h3>Approval integrity</h3><div class="row">${approval?pill('approved'):pill('not approved')}<span>Version <strong>${c.version}</strong></span></div><p class="hash">contentHash ${esc(c.contentHash)}</p>${approval?`<p class="hash">approved v${approval.version} · ${esc(approval.contentHash)} · ${esc(when(approval.approvedAt))}</p>`:''}</div>
    <div class="section"><div class="row spread"><h3>Editorial schedule</h3><span class="subtle">Browser timezone: ${esc(browserTimezone())}</span></div><p class="subtle">Scheduling plans a PAG handoff; it never grants publishing authority. Due items still require a current exact-version approval.</p><div class="schedule-grid">${schedulePanel(c,'x','X')}${schedulePanel(c,'linkedin','LinkedIn')}</div></div>
    <div class="section"><h3>Drafts</h3><div class="draft-grid"><div class="field"><label>X THREAD — separate posts with ---</label><textarea id="x-draft">${esc((c.drafts?.x?.posts||[]).join('\n---\n'))}</textarea></div><div class="field"><label>LINKEDIN</label><textarea id="linkedin-draft">${esc(c.drafts?.linkedin?.text||'')}</textarea></div></div><div class="actions"><button class="button secondary" id="save-editorial">Save edits</button><button class="button secondary" id="regen-draft">Regenerate</button><button class="button" id="approve-campaign">Approve exact version</button></div></div>
    <div class="section"><h3>PAG handoff</h3><div class="draft-grid"><div><p>X</p>${pill(c.platform?.x?.handoffStatus)}<p class="hash">${esc(c.platform?.x?.pagActionId||'No intent yet')}</p><div class="actions"><button class="button secondary" id="request-x">Request X</button><button class="button secondary" id="sync-x">Sync</button></div></div><div><p>LinkedIn</p>${pill(c.platform?.linkedin?.handoffStatus)}<p class="hash">${esc(c.platform?.linkedin?.pagActionId||'No intent yet')}</p><div class="actions"><button class="button secondary" id="request-linkedin">Request LinkedIn</button><button class="button secondary" id="sync-linkedin">Sync</button></div></div></div></div>
    <div class="section"><div class="row spread"><h3>Publishing history</h3><span class="subtle">${publishingAttempts.length} attempt${publishingAttempts.length===1?'':'s'}</span></div>
      <p class="subtle">Append-only PAG handoff history. Retries remain bound to the exact approved campaign version and content hash.</p>
      <div class="publishing-history">${publishingAttempts.length?publishingAttempts.map(attempt=>{
        const platformLabel=attempt.platform==='x'?'X':'LinkedIn';
        const receipt=attempt.receipt?.executionStatus?`<span>receipt ${esc(attempt.receipt.executionStatus)}${attempt.receipt.resultMode?` · ${esc(attempt.receipt.resultMode)}`:''}</span>`:'';
        const retryOf=attempt.retryOf?`<span>retry of ${esc(attempt.retryOf)}</span>`:'';
        const pag=attempt.pagIntentId?`<span>PAG ${esc(attempt.pagIntentId)}</span>`:'';
        const error=attempt.errorCode?`<span class="publishing-error">${esc(attempt.errorCode)}</span>`:'';
        const reconcile=attempt.pagIntentId&&!['completed','denied'].includes(attempt.status)
          ?`<button class="button secondary publishing-reconcile" data-platform="${esc(attempt.platform)}" data-attempt="${esc(attempt.attemptId)}">Sync receipt</button>`:'';
        const retry=attempt.retryEligible
          ?`<button class="button publishing-retry" data-platform="${esc(attempt.platform)}" data-attempt="${esc(attempt.attemptId)}">Retry safely</button>`:'';
        return `<article class="publishing-attempt">
          <div class="row spread"><div class="row">${pill(platformLabel)}${pill(attempt.status)}</div><strong>Attempt ${attempt.attemptNumber}</strong></div>
          <div class="publishing-meta">
            <span>v${attempt.campaignVersion} · ${esc(attempt.contentHash.slice(0,12))}…</span>
            <span>started ${esc(when(attempt.startedAt))}</span>
            ${pag}${retryOf}${receipt}${error}
          </div>
          <div class="actions">${reconcile}${retry}</div>
        </article>`;
      }).join(''):'<div class="empty-list"><strong>No publishing attempts yet</strong><span>Approved X/LinkedIn handoffs will appear here.</span></div>'}</div>
    </div>
    <div class="section"><h3>Claim provenance</h3><div class="claims">${uniqueClaims.length?uniqueClaims.map(x=>`<div class="claim"><code>${esc(x.source||'unsupported')}</code><p>${esc(x.text)}</p></div>`).join(''):'<p class="subtle">No claims recorded.</p>'}</div></div>
    <div class="section"><h3>Version history</h3><div class="versions">${versions.map(v=>`<div class="version">v${v.version} · ${esc(v.contentHash.slice(0,10))}… · ${esc(v.status)}</div>`).join('')}</div></div>
  `;
  wireDetail(c);
}
function scheduleBody(platform){
  const input=$(`schedule-${platform}`);
  if(!input?.value)throw new Error('Choose a publication date and time first');
  const date=new Date(input.value);if(Number.isNaN(date.getTime()))throw new Error('Invalid publication date and time');
  return {scheduledAt:date.toISOString(),timezone:browserTimezone()};
}
function wireDetail(c){
  const privacyPass=$('privacy-pass');const privacyBlock=$('privacy-block');
  if(privacyPass)privacyPass.onclick=()=>resolvePrivacy(c,'PASS');
  if(privacyBlock)privacyBlock.onclick=()=>resolvePrivacy(c,'BLOCK');
  $('save-editorial').onclick=()=>mutate(`/api/campaigns/${c.id}/editorial`,{x:{posts:$('x-draft').value.split(/\n---\n/g).map(x=>x.trim()).filter(Boolean)},linkedin:{text:$('linkedin-draft').value}},'Draft edits saved');
  $('regen-draft').onclick=()=>mutate(`/api/campaigns/${c.id}/draft/regenerate`,{},'Draft regenerated');
  $('approve-campaign').onclick=()=>mutate(`/api/campaigns/${c.id}/approve`,{version:c.version,contentHash:c.contentHash},'Exact campaign version approved');
  $('request-x').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/x`,{version:c.version,contentHash:c.contentHash},'X handoff requested');
  $('request-linkedin').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/linkedin`,{version:c.version,contentHash:c.contentHash},'LinkedIn handoff requested');
  $('sync-x').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/x/reconcile`,{},'X handoff reconciled');
  $('sync-linkedin').onclick=()=>mutate(`/api/campaigns/${c.id}/handoff/linkedin/reconcile`,{},'LinkedIn handoff reconciled');
  document.querySelectorAll('.publishing-retry').forEach(el=>el.addEventListener('click',()=>retryPublishing(c,el.dataset.platform,el.dataset.attempt)));
  document.querySelectorAll('.publishing-reconcile').forEach(el=>el.addEventListener('click',()=>reconcilePublishing(c,el.dataset.platform,el.dataset.attempt)));
  for(const platform of ['x','linkedin']){
    $(`schedule-${platform}-save`).onclick=()=>{try{mutate(`/api/campaigns/${c.id}/schedule/${platform}`,scheduleBody(platform),`${platform==='x'?'X':'LinkedIn'} schedule saved`)}catch(error){notify(error.message,'error')}};
    const clear=$(`schedule-${platform}-clear`);if(clear)clear.onclick=()=>mutate(`/api/campaigns/${c.id}/schedule/${platform}/clear`,{},`${platform==='x'?'X':'LinkedIn'} schedule cleared`);
  }
}
async function retryPublishing(c,platform,attemptId){
  try{
    const result=await api(`/api/campaigns/${encodeURIComponent(c.id)}/publishing/${encodeURIComponent(platform)}/retry`,{
      method:'POST',
      body:JSON.stringify({attemptId,version:c.version,contentHash:c.contentHash})
    });
    notify(result.reused?'Retry already recorded':'Publishing retry requested');
    await load();
  }catch(error){notify(error.message,'error')}
}
async function reconcilePublishing(c,platform,attemptId){
  try{
    await api(`/api/campaigns/${encodeURIComponent(c.id)}/publishing/${encodeURIComponent(platform)}/reconcile`,{
      method:'POST',
      body:JSON.stringify({attemptId})
    });
    notify('Publishing receipt reconciled');
    await load();
  }catch(error){notify(error.message,'error')}
}
async function resolvePrivacy(c,decision){
  const note=$('privacy-review-note')?.value.trim();
  if(!note){notify('A privacy review note is required','error');return}
  try{
    await api(`/api/approval-inbox/privacy/${encodeURIComponent(c.id)}`,{
      method:'POST',
      body:JSON.stringify({version:c.version,contentHash:c.contentHash,decision,note})
    });
    notify(`Privacy review resolved as ${decision}`);
    await load();
  }catch(error){notify(error.message,'error')}
}
async function mutate(path,body,message){
  try{await api(path,{method:'POST',body:JSON.stringify(body)});notify(message);await load()}catch(error){notify(error.message,'error')}
}

function applyFilters(values){
  const clearCampaign=Object.prototype.hasOwnProperty.call(values,'project')?{campaign:''}:{};
  setUrl({...values,...clearCampaign},{resetPages:true,replace:false});
  load();
}
function changePage(key,page){setUrl({[key]:page},{replace:false});load()}

$('filter-form').addEventListener('submit',(event)=>{
  event.preventDefault();
  applyFilters({
    q:$('filter-q').value.trim(),project:$('filter-project').value,privacy:$('filter-privacy').value,
    source:$('filter-source').value.trim(),platform:$('filter-platform').value,status:$('filter-status').value,
    from:$('filter-from').value,to:$('filter-to').value
  });
});
$('clear-filters').addEventListener('click',()=>{
  setUrl({project:'',q:'',privacy:'',source:'',platform:'',status:'',attention:'',from:'',to:'',campaign:''},{resetPages:true,replace:false});
  load();
});
$('event-sort').addEventListener('change',()=>applyFilters({esort:$('event-sort').value}));
$('event-order').addEventListener('change',()=>applyFilters({eorder:$('event-order').value}));
$('campaign-sort').addEventListener('change',()=>applyFilters({csort:$('campaign-sort').value}));
$('campaign-order').addEventListener('change',()=>applyFilters({corder:$('campaign-order').value}));
$('approval-category').addEventListener('change',()=>applyFilters({attention:$('approval-category').value}));
$('approve-selected').addEventListener('click',()=>{
  const items=[...document.querySelectorAll('.approval-select:checked')].map(el=>({
    campaignId:el.dataset.campaign,version:Number(el.dataset.version),contentHash:el.dataset.hash
  }));
  approveInboxTargets(items);
});
$('github-project').addEventListener('change',()=>{
  const project=state.projects.find(p=>p.id===$('github-project').value);
  $('github-repository').value=project?.github?.repository||'';
  $('github-visibility').value=project?.github?.visibility||'private';
});
$('github-source-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const projectId=$('github-project').value;
  if(!projectId){notify('Choose a project first','error');return}
  try{
    await api(`/api/projects/${encodeURIComponent(projectId)}/github`,{
      method:'POST',
      body:JSON.stringify({repository:$('github-repository').value.trim(),visibility:$('github-visibility').value})
    });
    notify('GitHub source saved');
    await load();
  }catch(error){notify(error.message,'error')}
});
$('clear-github-source').addEventListener('click',async()=>{
  const projectId=$('github-project').value;
  if(!projectId){notify('Choose a project first','error');return}
  try{
    await api(`/api/projects/${encodeURIComponent(projectId)}/github/clear`,{method:'POST',body:'{}'});
    $('github-repository').value='';
    $('github-visibility').value='private';
    notify('GitHub source cleared');
    await load();
  }catch(error){notify(error.message,'error')}
});
$('run-capture').addEventListener('click',async()=>{
  const button=$('run-capture'); button.disabled=true;
  try{
    const projectId=queryState().project||null;
    const result=await api('/api/capture/run',{method:'POST',body:JSON.stringify({projectId})});
    notify(`Capture finished: ${result.succeeded} succeeded, ${result.failed} failed`);
    await load();
  }catch(error){notify(error.message,'error')}
  finally{button.disabled=false}
});
$('project-form').addEventListener('submit',async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));try{await api('/api/projects',{method:'POST',body:JSON.stringify(data)});event.currentTarget.reset();notify('Project capture source added');await load()}catch(error){notify(error.message,'error')}});
$('refresh').addEventListener('click',load);
addEventListener('popstate',load);
load();
