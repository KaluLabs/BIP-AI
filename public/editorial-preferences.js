(()=>{
  const $=id=>document.getElementById(id);
  const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const label=s=>String(s).replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
  let current=null;

  function projectId(){return new URLSearchParams(location.search).get('project')||''}
  async function api(path,options={}){
    const headers={...(options.body?{'content-type':'application/json','x-bipai-csrf':'1'}:{}),...(options.headers||{})};
    const res=await fetch(path,{...options,headers}),data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);return data;
  }
  function setButtons(profile,disabled=false){
    for(const id of ['preference-rebuild','preference-toggle','preference-reset'])$(id).disabled=disabled;
    $('preference-toggle').textContent=profile?.enabled===false?'Enable':'Disable';
  }
  function render(profile){
    current=profile;
    $('preference-status').textContent=profile.enabled
      ? `${profile.learning.learnedSignals} signals · ${profile.learning.evidenceCount} evidence`
      : 'Learning disabled';
    const cards=['x','linkedin'].map(platform=>{
      const values=profile.platforms?.[platform]||{},rows=Object.entries(values);
      return `<article class="narrative-arc"><div class="row spread"><h3>${platform==='x'?'X':'LinkedIn'}</h3><span class="subtle">${rows.length} learned</span></div>
        <div class="narrative-entry-list">${rows.length?rows.map(([signal,item])=>`<article class="narrative-entry">
          <div class="row spread"><strong>${esc(label(signal))}</strong><span class="pill muted">${esc(item.confidence)}</span></div>
          <p>${esc(item.value)}</p><div class="narrative-provenance"><span>${item.evidenceCount} observations · weight ${item.supportingWeight}/${item.totalWeight}</span></div>
        </article>`).join(''):'<div class="empty-list"><strong>No signals yet</strong><span>Edit and approve campaigns to build this profile.</span></div>'}</div>
      </article>`;
    }).join('');
    $('editorial-preferences').innerHTML=cards;
    setButtons(profile,false);
  }
  async function load(){
    const id=projectId();
    if(!id){
      current=null;$('preference-status').textContent='Choose a project';setButtons(null,true);
      $('editorial-preferences').innerHTML='<div class="empty-list"><strong>Choose one project</strong><span>Use the project filter to inspect its learned writing profile.</span></div>';
      return;
    }
    try{
      $('editorial-preferences').innerHTML='<div class="loading-state">Loading learned preferences…</div>';
      const data=await api(`/api/projects/${encodeURIComponent(id)}/editorial-preferences`);render(data.profile);
    }catch(error){$('editorial-preferences').innerHTML=`<div class="error-state">${esc(error.message)}</div>`}
  }
  async function action(name){
    const id=projectId();if(!id)return;setButtons(current,true);
    try{const data=await api(`/api/projects/${encodeURIComponent(id)}/editorial-preferences/${name}`,{method:'POST',body:'{}'});render(data.profile)}
    catch(error){$('editorial-preferences').innerHTML=`<div class="error-state">${esc(error.message)}</div>`;setButtons(current,false)}
  }

  $('preference-rebuild')?.addEventListener('click',()=>action('rebuild'));
  $('preference-reset')?.addEventListener('click',()=>action('reset'));
  $('preference-toggle')?.addEventListener('click',()=>action(current?.enabled===false?'enable':'disable'));
  addEventListener('popstate',load);
  const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
  history.pushState=(...args)=>{push(...args);queueMicrotask(load)};
  history.replaceState=(...args)=>{replace(...args);queueMicrotask(load)};
  $('refresh')?.addEventListener('click',()=>queueMicrotask(load));
  load();
})();
