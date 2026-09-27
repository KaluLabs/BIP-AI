import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BipStore } from '../src/store.js';

function createV010Database(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
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

  const event = {
    id: 'evt-v010',
    projectId: 'legacy-project',
    type: 'feature',
    summary: 'Legacy v0.1 event',
    occurredAt: '2026-09-27T00:00:00.000Z'
  };
  const campaign = {
    id: 'cmp-v010',
    projectId: 'legacy-project',
    eventId: event.id,
    version: 1,
    status: 'draft',
    contentHash: 'legacy-content-hash',
    createdAt: '2026-09-27T00:00:01.000Z',
    updatedAt: '2026-09-27T00:00:01.000Z'
  };

  db.prepare('INSERT INTO events(id, project_id, fingerprint, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(event.id, event.projectId, 'legacy-fingerprint', JSON.stringify(event), '2026-09-27T00:00:00.000Z');
  db.prepare(`INSERT INTO campaigns(
    id, project_id, event_id, version, status, payload_json, content_hash, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    campaign.id,
    campaign.projectId,
    campaign.eventId,
    campaign.version,
    campaign.status,
    JSON.stringify(campaign),
    campaign.contentHash,
    campaign.createdAt,
    campaign.updatedAt
  );
  db.prepare('INSERT INTO campaign_versions(campaign_id, version, content_hash, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(campaign.id, 1, campaign.contentHash, JSON.stringify(campaign), campaign.updatedAt);
  db.close();
  return { event, campaign };
}

test('v0.1.0 SQLite state opens under v0.2 without losing legacy records', () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-v010-upgrade-'));
  const filename = join(root, 'bip-ai.sqlite');
  const legacy = createV010Database(filename);

  const store = new BipStore(filename);

  assert.deepEqual(store.listEvents('legacy-project'), [legacy.event]);
  assert.deepEqual(store.listCampaigns('legacy-project'), [legacy.campaign]);
  assert.deepEqual(store.listCampaignVersions(legacy.campaign.id), [legacy.campaign]);

  const schema = store.db.prepare(`
    SELECT type, name
    FROM sqlite_master
    WHERE name IN (
      'events',
      'campaigns',
      'campaign_versions',
      'publishing_journal',
      'capture_sources',
      'narrative_memory',
      'narrative_memory_controls',
      'publishing_journal_no_update',
      'publishing_journal_no_delete'
    )
    ORDER BY type, name
  `).all();

  assert.ok(schema.some((row) => row.type === 'table' && row.name === 'publishing_journal'));
  assert.ok(schema.some((row) => row.type === 'table' && row.name === 'capture_sources'));
  assert.ok(schema.some((row) => row.type === 'table' && row.name === 'narrative_memory'));
  assert.ok(schema.some((row) => row.type === 'table' && row.name === 'narrative_memory_controls'));
  assert.ok(schema.some((row) => row.type === 'trigger' && row.name === 'publishing_journal_no_update'));
  assert.ok(schema.some((row) => row.type === 'trigger' && row.name === 'publishing_journal_no_delete'));

  store.saveCaptureState({
    sourceKey: 'git:legacy-project',
    projectId: 'legacy-project',
    sourceType: 'git',
    cursor: { sha: 'abc123' },
    health: { status: 'healthy' }
  });
  assert.deepEqual(store.getCaptureState('git:legacy-project').cursor, { sha: 'abc123' });

  store.appendPublishingJournal({
    id: 'journal-v020',
    attemptId: 'attempt-v020',
    campaignId: legacy.campaign.id,
    projectId: legacy.campaign.projectId,
    platform: 'x',
    campaignVersion: 1,
    contentHash: legacy.campaign.contentHash,
    attemptNumber: 1,
    eventType: 'attempt_started',
    status: 'requested',
    retryable: false,
    idempotencyKey: 'legacy-upgrade-test',
    createdAt: '2026-09-27T00:00:02.000Z'
  });
  assert.equal(store.listPublishingJournal({ campaignId: legacy.campaign.id }).length, 1);

  store.close();
});
