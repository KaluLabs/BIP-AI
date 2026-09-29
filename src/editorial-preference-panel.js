export const EDITORIAL_PREFERENCE_PANEL=`
<section class="panel" id="editorial-preferences-panel">
  <div class="panel-head panel-head-wrap">
    <div><p class="eyebrow">EDITORIAL STYLE</p><h2>Learned preferences</h2></div>
    <div class="panel-tools">
      <span id="preference-status" class="pill muted">Choose a project</span>
      <button id="preference-rebuild" class="button secondary" type="button" disabled>Rebuild</button>
      <button id="preference-toggle" class="button secondary" type="button" disabled>Disable</button>
      <button id="preference-reset" class="button danger" type="button" disabled>Reset</button>
    </div>
  </div>
  <p class="subtle">Project-scoped style learning from editorial changes and explicit approvals. It learns presentation preferences, never facts, credentials, approval, or publishing authority.</p>
  <div id="editorial-preferences" class="narrative-memory">
    <div class="empty-list"><strong>Choose one project</strong><span>Use the project filter to inspect its learned writing profile.</span></div>
  </div>
</section>
`;

export function injectEditorialPreferenceUi(html){
  const marker='<section class="panel">\n        <div class="panel-head"><div><p class="eyebrow">CALENDAR</p>';
  const panel=`${EDITORIAL_PREFERENCE_PANEL}\n\n      `;
  const withPanel=html.includes(marker)?html.replace(marker,panel+marker):html.replace('</main>',panel+'</main>');
  return withPanel.replace('<script src="/app.js" defer></script>',
    '<script src="/app.js" defer></script>\n  <script src="/editorial-preferences.js" defer></script>');
}
