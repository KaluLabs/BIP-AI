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
