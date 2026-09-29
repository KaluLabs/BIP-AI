export function ensurePreferenceOutcomeSchema(store){
  if(!store?.db)throw new TypeError('store with db is required');
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS editorial_preference_outcomes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome='approved'),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_editorial_preference_outcomes_project
      ON editorial_preference_outcomes(project_id,created_at ASC);
    CREATE TRIGGER IF NOT EXISTS editorial_preference_outcomes_no_update
      BEFORE UPDATE ON editorial_preference_outcomes
      BEGIN SELECT RAISE(ABORT,'editorial_preference_outcomes is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editorial_preference_outcomes_no_delete
      BEFORE DELETE ON editorial_preference_outcomes
      BEGIN SELECT RAISE(ABORT,'editorial_preference_outcomes is append-only'); END;
  `);
}

export function syncPreferenceApprovalOutcomes(store,records){
  ensurePreferenceOutcomeSchema(store);
  const insert=store.db.prepare(`
    INSERT OR IGNORE INTO editorial_preference_outcomes(
      id,project_id,campaign_id,campaign_version,content_hash,outcome,created_at
    ) VALUES(?,?,?,?,?,'approved',?)
  `);
  for(const r of records){
    const a=r.campaign?.campaignApproval;
    if(!a||a.version!==r.version||a.contentHash!==r.contentHash)continue;
    const id=`approved:${r.campaignId}:${r.version}:${r.contentHash}`;
    insert.run(id,r.projectId,r.campaignId,r.version,r.contentHash,a.approvedAt||r.createdAt);
  }
}

export function preferenceApprovalOutcomes(store,projectId){
  ensurePreferenceOutcomeSchema(store);
  return store.db.prepare(`
    SELECT id,project_id,campaign_id,campaign_version,content_hash,outcome,created_at
    FROM editorial_preference_outcomes WHERE project_id=?
    ORDER BY created_at ASC,id ASC
  `).all(projectId).map(r=>({
    id:r.id,projectId:r.project_id,campaignId:r.campaign_id,
    campaignVersion:r.campaign_version,contentHash:r.content_hash,
    outcome:r.outcome,createdAt:r.created_at
  }));
}
