export function ensurePreferenceSchema(store) {
  if (!store?.db) throw new TypeError('store with db is required');
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS editorial_preference_controls (
      project_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      reset_at TEXT,
      disabled_at TEXT,
      excluded_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
  `);
}

export function preferenceControl(store, projectId) {
  ensurePreferenceSchema(store);
  const row=store.db.prepare(
    'SELECT enabled, reset_at, disabled_at, excluded_json, updated_at FROM editorial_preference_controls WHERE project_id=?'
  ).get(projectId);
  return row ? {
    projectId,
    enabled:Boolean(row.enabled),
    resetAt:row.reset_at||null,
    disabledAt:row.disabled_at||null,
    excludedRanges:JSON.parse(row.excluded_json||'[]'),
    updatedAt:row.updated_at
  } : {projectId,enabled:true,resetAt:null,disabledAt:null,excludedRanges:[],updatedAt:null};
}

export function savePreferenceControl(store, control) {
  ensurePreferenceSchema(store);
  const updatedAt=control.updatedAt||new Date().toISOString();
  store.db.prepare(`
    INSERT INTO editorial_preference_controls(project_id,enabled,reset_at,disabled_at,excluded_json,updated_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,reset_at=excluded.reset_at,
      disabled_at=excluded.disabled_at,excluded_json=excluded.excluded_json,updated_at=excluded.updated_at
  `).run(
    control.projectId,control.enabled===false?0:1,control.resetAt||null,control.disabledAt||null,
    JSON.stringify(control.excludedRanges||[]),updatedAt
  );
  return preferenceControl(store,control.projectId);
}

export function preferenceVersions(store, projectId) {
  ensurePreferenceSchema(store);
  return store.db.prepare(`
    SELECT cv.campaign_id,cv.version,cv.content_hash,cv.payload_json,cv.created_at
    FROM campaign_versions cv JOIN campaigns c ON c.id=cv.campaign_id
    WHERE c.project_id=?
    ORDER BY cv.created_at ASC,cv.campaign_id ASC,cv.version ASC
  `).all(projectId).map(row=>({
    projectId,campaignId:row.campaign_id,version:row.version,contentHash:row.content_hash,
    campaign:JSON.parse(row.payload_json),createdAt:row.created_at
  }));
}

export function preferenceStore(filename) {
  return filename || process.env.BIP_AI_DB || '.bipai/bip-ai.sqlite';
}
