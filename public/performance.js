(()=>{
  const $=id=>document.getElementById(id);
  const esc=(value='')=>String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const when=value=>value?new Date(value).toLocaleString():'—';
  const params=()=>new URLSearchParams(location.search);
  const projectId=()=>params().get('project')||'';
  const campaignId=()=>params().get('campaign')||'';

  async function api(path){
    const res=await fetch(path),data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
    return data;
  }
  function metricRows(metrics={}){
    const rows=Object.entries(metrics);
    if(!rows.length)return '<span class="subtle">No metrics</span>';
    return rows.map(([key,value])=>`<span class="pill muted">${esc(key)} · ${esc(value)}</span>`).join('');
  }
  function snapshotCard(item,{review=false}={}){
    const source=[item.source?.type,item.source?.name].filter(Boolean).join(' · ')||'unknown source';
    const reasons=review&&item.reviewReasons?.length
      ? `<p class="capture-error">${esc(item.reviewReasons.join(' · '))}</p>`:'';
    const claim=review?item.claimedLink||{}:{};
    const claimed=review&&Object.values(claim).some(v=>v!=null&&v!=='')
      ? `<div class="narrative-provenance"><span>claimed ${esc(claim.campaignId||'unlinked')} ${claim.campaignVersion!=null?`· v${esc(claim.campaignVersion)}`:''} ${claim.contentHash?`· ${esc(String(claim.contentHash).slice(0,12))}`:''}</span></div>`:'';
    return `<article class="narrative-entry">
      <div class="row spread"><strong>${esc(item.platform)}</strong><span class="pill ${item.status==='linked'?'good':'warn'}">${esc(item.status)}</span></div>
      <div class="meta">${metricRows(item.metrics)}</div>
      <p class="subtle">Observed ${esc(when(item.observedAt))} · collected ${esc(when(item.collectedAt))}</p>
      <div class="narrative-provenance"><span>${esc(source)}</span>${item.externalId?`<code>${esc(item.externalId)}</code>`:''}</div>
      ${reasons}${claimed}
    </article>`;
  }

  async function loadCampaign(){
    const root=$('campaign-performance'),count=$('campaign-performance-count');
    if(!root||!count)return;
    const id=campaignId();
    if(!id){
      count.textContent='Select a campaign';
      root.innerHTML='<div class="empty-list"><strong>No campaign selected</strong><span>Select a campaign to inspect linked outcome snapshots.</span></div>';
      return;
    }
    root.innerHTML='<div class="loading-state">Loading performance snapshots…</div>';
    try{
      const data=await api(`/api/campaigns/${encodeURIComponent(id)}/performance`);
      const items=data.snapshots||[];
      count.textContent=`${items.length} snapshot${items.length===1?'':'s'}`;
      root.innerHTML=items.length?items.map(item=>snapshotCard(item)).join('')
        :'<div class="empty-list"><strong>No linked performance yet</strong><span>Import a timestamped snapshot after this campaign is published.</span></div>';
    }catch(error){
      count.textContent='Unavailable';
      root.innerHTML=`<div class="error-state">${esc(error.message)}</div>`;
    }
  }
  async function loadReview(){
    const root=$('performance-review'),count=$('performance-review-count');
    if(!root||!count)return;
    const project=projectId();
    if(!project){
      count.textContent='Choose a project';
      root.innerHTML='<div class="empty-list"><strong>Choose one project</strong><span>Use the project filter to inspect ambiguous or unlinked performance snapshots.</span></div>';
      return;
    }
    root.innerHTML='<div class="loading-state">Loading performance review queue…</div>';
    try{
      const data=await api(`/api/projects/${encodeURIComponent(project)}/performance/review`);
      const items=data.snapshots||[];
      count.textContent=`${items.length} review item${items.length===1?'':'s'}`;
      root.innerHTML=items.length?items.map(item=>snapshotCard(item,{review:true})).join('')
        :'<div class="empty-list"><strong>No performance items need review</strong><span>Ambiguous or unlinked imports will appear here.</span></div>';
    }catch(error){
      count.textContent='Unavailable';
      root.innerHTML=`<div class="error-state">${esc(error.message)}</div>`;
    }
  }
  function load(){loadCampaign();loadReview()}
  addEventListener('popstate',load);
  const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
  history.pushState=(...args)=>{push(...args);queueMicrotask(load)};
  history.replaceState=(...args)=>{replace(...args);queueMicrotask(load)};
  $('refresh')?.addEventListener('click',()=>queueMicrotask(load));
  load();
})();
