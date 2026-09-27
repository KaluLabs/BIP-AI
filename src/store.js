import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class BipStore {
  constructor(filename = '.bipai/bip-ai.sqlite') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id)
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS campaign_versions (
        campaign_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(campaign_id, version)
      );
      CREATE TABLE IF NOT EXISTS publishing_journal (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        campaign_version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        retryable INTEGER NOT NULL DEFAULT 0,
        retry_of TEXT,
        idempotency_key TEXT NOT NULL,
        pag_intent_id TEXT,
        pag_approval_id TEXT,
        pag_status TEXT,
        args_hash TEXT,
        error_code TEXT,
        receipt_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_publishing_journal_campaign
        ON publishing_journal(campaign_id, platform, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_publishing_journal_attempt
        ON publishing_journal(attempt_id, created_at ASC);
      CREATE TRIGGER IF NOT EXISTS publishing_journal_no_update
        BEFORE UPDATE ON publishing_journal
        BEGIN
          SELECT RAISE(ABORT, 'publishing_journal is append-only');
        END;
      CREATE TRIGGER IF NOT EXISTS publishing_journal_no_delete
        BEFORE DELETE ON publishing_journal
        BEGIN
          SELECT RAISE(ABORT, 'publishing_journal is append-only');
        END;
      CREATE TABLE IF NOT EXISTS capture_sources (
        source_key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        cursor_json TEXT,
        health_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_capture_sources_project ON capture_sources(project_id, source_type);
    `);
  }

  close() { this.db.close(); }

  findEventByFingerprint(fingerprint) {
    const row = this.db.prepare('SELECT payload_json FROM events WHERE fingerprint = ?').get(fingerprint);
    return row ? JSON.parse(row.payload_json) : null;
  }

  saveEvent(event, fingerprint) {
    this.db.prepare('INSERT INTO events(id, project_id, fingerprint, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(event.id, event.projectId, fingerprint, JSON.stringify(event), new Date().toISOString());
    return event;
  }

  listEvents(projectId = null) {
    const rows = projectId
      ? this.db.prepare('SELECT payload_json FROM events WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : this.db.prepare('SELECT payload_json FROM events ORDER BY created_at DESC').all();
    return rows.map((row) => JSON.parse(row.payload_json));
  }

  saveCampaign(campaign) {
    this.db.prepare(`INSERT INTO campaigns(id, project_id, event_id, version, status, payload_json, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(campaign.id, campaign.projectId, campaign.eventId, campaign.version, campaign.status,
        JSON.stringify(campaign), campaign.contentHash, campaign.createdAt, campaign.updatedAt);
    this.db.prepare('INSERT INTO campaign_versions(campaign_id, version, content_hash, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(campaign.id, campaign.version, campaign.contentHash, JSON.stringify(campaign), campaign.updatedAt);
    return campaign;
  }

  saveCampaignVersion(campaign) {
    this.db.prepare('UPDATE campaigns SET version = ?, status = ?, payload_json = ?, content_hash = ?, updated_at = ? WHERE id = ?')
      .run(campaign.version, campaign.status, JSON.stringify(campaign), campaign.contentHash, campaign.updatedAt, campaign.id);
    this.db.prepare('INSERT INTO campaign_versions(campaign_id, version, content_hash, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(campaign.id, campaign.version, campaign.contentHash, JSON.stringify(campaign), campaign.updatedAt);
    return campaign;
  }

  updateCampaignState(campaign) {
    this.db.prepare('UPDATE campaigns SET status = ?, payload_json = ?, content_hash = ?, updated_at = ? WHERE id = ?')
      .run(campaign.status, JSON.stringify(campaign), campaign.contentHash, campaign.updatedAt, campaign.id);
    this.db.prepare('UPDATE campaign_versions SET payload_json = ?, content_hash = ? WHERE campaign_id = ? AND version = ?')
      .run(JSON.stringify(campaign), campaign.contentHash, campaign.id, campaign.version);
    return campaign;
  }

  listCampaignVersions(id) {
    return this.db.prepare('SELECT payload_json FROM campaign_versions WHERE campaign_id = ? ORDER BY version ASC').all(id)
      .map((row) => JSON.parse(row.payload_json));
  }

  getCampaign(id) {
    const row = this.db.prepare('SELECT payload_json FROM campaigns WHERE id = ?').get(id);
    return row ? JSON.parse(row.payload_json) : null;
  }

  listCampaigns(projectId = null) {
    const rows = projectId
      ? this.db.prepare('SELECT payload_json FROM campaigns WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
      : this.db.prepare('SELECT payload_json FROM campaigns ORDER BY updated_at DESC').all();
    return rows.map((row) => JSON.parse(row.payload_json));
  }

  appendPublishingJournal(entry) {
    if (!entry || typeof entry !== 'object') throw new TypeError('publishing journal entry is required');
    const required = [
      'id', 'attemptId', 'campaignId', 'projectId', 'platform',
      'campaignVersion', 'contentHash', 'attemptNumber',
      'eventType', 'status', 'idempotencyKey', 'createdAt'
    ];
    for (const key of required) {
      if (entry[key] == null || entry[key] === '') throw new TypeError(`publishing journal ${key} is required`);
    }
    if (!['x', 'linkedin'].includes(entry.platform)) throw new TypeError('publishing journal platform must be x or linkedin');
    this.db.prepare(`
      INSERT INTO publishing_journal(
        id, attempt_id, campaign_id, project_id, platform,
        campaign_version, content_hash, attempt_number,
        event_type, status, retryable, retry_of, idempotency_key,
        pag_intent_id, pag_approval_id, pag_status, args_hash,
        error_code, receipt_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.attemptId,
      entry.campaignId,
      entry.projectId,
      entry.platform,
      Number(entry.campaignVersion),
      entry.contentHash,
      Number(entry.attemptNumber),
      entry.eventType,
      entry.status,
      entry.retryable ? 1 : 0,
      entry.retryOf || null,
      entry.idempotencyKey,
      entry.pagIntentId || null,
      entry.pagApprovalId || null,
      entry.pagStatus || null,
      entry.argsHash || null,
      entry.errorCode || null,
      entry.receipt == null ? null : JSON.stringify(entry.receipt),
      entry.createdAt
    );
    return structuredClone(entry);
  }

  listPublishingJournal({ campaignId = null, platform = null, attemptId = null } = {}) {
    const clauses = [];
    const values = [];
    if (campaignId) { clauses.push('campaign_id = ?'); values.push(campaignId); }
    if (platform) { clauses.push('platform = ?'); values.push(platform); }
    if (attemptId) { clauses.push('attempt_id = ?'); values.push(attemptId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT id, attempt_id, campaign_id, project_id, platform,
        campaign_version, content_hash, attempt_number,
        event_type, status, retryable, retry_of, idempotency_key,
        pag_intent_id, pag_approval_id, pag_status, args_hash,
        error_code, receipt_json, created_at
      FROM publishing_journal
      ${where}
      ORDER BY created_at ASC, id ASC
    `).all(...values);
    return rows.map((row) => ({
      id: row.id,
      attemptId: row.attempt_id,
      campaignId: row.campaign_id,
      projectId: row.project_id,
      platform: row.platform,
      campaignVersion: row.campaign_version,
      contentHash: row.content_hash,
      attemptNumber: row.attempt_number,
      eventType: row.event_type,
      status: row.status,
      retryable: Boolean(row.retryable),
      retryOf: row.retry_of || null,
      idempotencyKey: row.idempotency_key,
      pagIntentId: row.pag_intent_id || null,
      pagApprovalId: row.pag_approval_id || null,
      pagStatus: row.pag_status || null,
      argsHash: row.args_hash || null,
      errorCode: row.error_code || null,
      receipt: row.receipt_json ? JSON.parse(row.receipt_json) : null,
      createdAt: row.created_at
    }));
  }

  getPublishingAttempt(attemptId) {
    return this.listPublishingJournal({ attemptId });
  }

  getCaptureState(sourceKey) {
    const row = this.db.prepare(
      'SELECT source_key, project_id, source_type, cursor_json, health_json, updated_at FROM capture_sources WHERE source_key = ?'
    ).get(sourceKey);
    if (!row) return null;
    return {
      sourceKey: row.source_key,
      projectId: row.project_id,
      sourceType: row.source_type,
      cursor: row.cursor_json ? JSON.parse(row.cursor_json) : null,
      health: JSON.parse(row.health_json),
      updatedAt: row.updated_at
    };
  }

  saveCaptureState({ sourceKey, projectId, sourceType, cursor = null, health = {}, updatedAt = new Date().toISOString() }) {
    if (!sourceKey || !projectId || !sourceType) throw new TypeError('capture state requires sourceKey, projectId, and sourceType');
    this.db.prepare(`
      INSERT INTO capture_sources(source_key, project_id, source_type, cursor_json, health_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        project_id = excluded.project_id,
        source_type = excluded.source_type,
        cursor_json = excluded.cursor_json,
        health_json = excluded.health_json,
        updated_at = excluded.updated_at
    `).run(
      sourceKey,
      projectId,
      sourceType,
      cursor == null ? null : JSON.stringify(cursor),
      JSON.stringify(health || {}),
      updatedAt
    );
    return this.getCaptureState(sourceKey);
  }

  listCaptureStates(projectId = null) {
    const rows = projectId
      ? this.db.prepare(
        'SELECT source_key, project_id, source_type, cursor_json, health_json, updated_at FROM capture_sources WHERE project_id = ? ORDER BY project_id, source_type'
      ).all(projectId)
      : this.db.prepare(
        'SELECT source_key, project_id, source_type, cursor_json, health_json, updated_at FROM capture_sources ORDER BY project_id, source_type'
      ).all();
    return rows.map((row) => ({
      sourceKey: row.source_key,
      projectId: row.project_id,
      sourceType: row.source_type,
      cursor: row.cursor_json ? JSON.parse(row.cursor_json) : null,
      health: JSON.parse(row.health_json),
      updatedAt: row.updated_at
    }));
  }
}
