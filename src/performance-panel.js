export const PERFORMANCE_REVIEW_PANEL=`
<section class="panel" id="performance-review-panel">
  <div class="panel-head panel-head-wrap">
    <div><p class="eyebrow">OUTCOME FEEDBACK</p><h2>Performance review</h2></div>
    <span id="performance-review-count" class="pill muted">Choose a project</span>
  </div>
  <p class="subtle">Snapshots that cannot be verified against an exact campaign/version/content hash are held here for review instead of being attached to analytics.</p>
  <div id="performance-review" class="narrative-memory">
    <div class="empty-list"><strong>Choose one project</strong><span>Use the project filter to inspect ambiguous or unlinked performance snapshots.</span></div>
  </div>
</section>
`;

export const CAMPAIGN_PERFORMANCE_PANEL=`
<div id="campaign-performance-panel" class="narrative-memory">
  <div class="panel-head panel-head-wrap">
    <div><p class="eyebrow">PERFORMANCE</p><h3>Outcome snapshots</h3></div>
    <span id="campaign-performance-count" class="pill muted">Select a campaign</span>
  </div>
  <div id="campaign-performance">
    <div class="empty-list"><strong>No campaign selected</strong><span>Select a campaign to inspect linked outcome snapshots.</span></div>
  </div>
</div>
`;

export function injectPerformanceUi(html){
  let next=html;
  const calendar='<section class="panel">\n        <div class="panel-head"><div><p class="eyebrow">CALENDAR</p>';
  next=next.includes(calendar)?next.replace(calendar,`${PERFORMANCE_REVIEW_PANEL}\n\n      ${calendar}`):next.replace('</main>',PERFORMANCE_REVIEW_PANEL+'</main>');
  const detail='          <div id="campaign-detail" class="empty-state">';
  const close='          </div>\n        </article>\n      </section>';
  const start=next.indexOf(detail);
  if(start>=0){
    const end=next.indexOf(close,start);
    if(end>=0){
      const insertAt=end+('          </div>\n').length;
      next=next.slice(0,insertAt)+CAMPAIGN_PERFORMANCE_PANEL+'\n'+next.slice(insertAt);
    }
  }
  return next.replace('<script src="/editorial-preferences.js" defer></script>',
    '<script src="/editorial-preferences.js" defer></script>\n  <script src="/performance.js" defer></script>');
}
