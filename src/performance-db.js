export const CONTENT_PERFORMANCE_SCHEMA_VERSION=1;

export function performanceStore(){
  return process.env.BIP_AI_DB||'.bipai/bip-ai.sqlite';
}

export function ensurePerformanceSchema(store){
  if(!store?.db)throw new TypeError('store is required');
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS content_performance_snapshots (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('linked','review')),
      project_id TEXT,
      platform TEXT NOT NULL,
      campaign_id TEXT,
      campaign_version INTEGER,
      content_hash TEXT,
      publishing_attempt_id TEXT,
      pag_intent_id TEXT,
      external_id TEXT,
      metrics_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      review_reasons_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_performance_campaign
      ON content_performance_snapshots(campaign_id, platform, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_performance_project
      ON content_performance_snapshots(project_id, status, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_performance_status
      ON content_performance_snapshots(status, observed_at DESC);
    CREATE TRIGGER IF NOT EXISTS content_performance_no_update
      BEFORE UPDATE ON content_performance_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'content_performance_snapshots is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS content_performance_no_delete
      BEFORE DELETE ON content_performance_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'content_performance_snapshots is append-only');
      END;
  `);
}

function rowSnapshot(row){
  if(!row)return null;
  const payload=JSON.parse(row.payload_json);
  return {...payload,sequence:Number(row.snapshot_sequence)};
}

export function findPerformanceByFingerprint(store,fingerprint){
  ensurePerformanceSchema(store);
  const row=store.db.prepare(`
    SELECT rowid AS snapshot_sequence,payload_json
    FROM content_performance_snapshots WHERE fingerprint=?
  `).get(fingerprint);
  return rowSnapshot(row);
}

export function appendPerformanceSnapshot(store,snapshot){
  ensurePerformanceSchema(store);
  const existing=findPerformanceByFingerprint(store,snapshot.fingerprint);
  if(existing)return {snapshot:existing,deduplicated:true};

  store.db.prepare(`
    INSERT INTO content_performance_snapshots(
      id,fingerprint,schema_version,status,project_id,platform,
      campaign_id,campaign_version,content_hash,publishing_attempt_id,
      pag_intent_id,external_id,metrics_json,source_json,observed_at,
      collected_at,review_reasons_json,payload_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    snapshot.id,
    snapshot.fingerprint,
    Number(snapshot.schemaVersion),
    snapshot.status,
    snapshot.projectId||null,
    snapshot.platform,
    snapshot.campaignId||null,
    snapshot.campaignVersion==null?null:Number(snapshot.campaignVersion),
    snapshot.contentHash||null,
    snapshot.publishingAttemptId||null,
    snapshot.pagIntentId||null,
    snapshot.externalId||null,
    JSON.stringify(snapshot.metrics||{}),
    JSON.stringify(snapshot.source||{}),
    snapshot.observedAt,
    snapshot.collectedAt,
    JSON.stringify(snapshot.reviewReasons||[]),
    JSON.stringify(snapshot),
    snapshot.createdAt
  );
  return {snapshot:findPerformanceByFingerprint(store,snapshot.fingerprint),deduplicated:false};
}

export function listPerformanceSnapshots(store,{
  campaignId=null,projectId=null,platform=null,status=null
}={}){
  ensurePerformanceSchema(store);
  const clauses=[],values=[];
  if(campaignId){clauses.push('campaign_id=?');values.push(campaignId)}
  if(projectId){clauses.push('project_id=?');values.push(projectId)}
  if(platform){clauses.push('platform=?');values.push(platform)}
  if(status){clauses.push('status=?');values.push(status)}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  return store.db.prepare(`
    SELECT rowid AS snapshot_sequence,payload_json
    FROM content_performance_snapshots
    ${where}
    ORDER BY observed_at DESC,snapshot_sequence DESC
  `).all(...values).map(rowSnapshot);
}

export function getPerformanceSnapshot(store,id){
  ensurePerformanceSchema(store);
  return rowSnapshot(store.db.prepare(`
    SELECT rowid AS snapshot_sequence,payload_json
    FROM content_performance_snapshots WHERE id=?
  `).get(id));
}
