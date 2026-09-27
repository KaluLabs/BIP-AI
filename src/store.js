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
}
