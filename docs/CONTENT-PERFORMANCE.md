# Content Performance Feedback

BIP-AI can ingest timestamped outcome snapshots for published content without owning social-network credentials.

## Contract

The normalized record is **ContentPerformance schema version 1**.

A stored snapshot contains:

- `schemaVersion`: currently `1`
- `id`: deterministic BIP-AI snapshot identifier
- `fingerprint`: deterministic deduplication fingerprint
- `status`: `linked` or `review`
- `projectId`: verified project when linked, or an optional claimed project for review
- `platform`: transport-neutral platform identifier such as `x` or `linkedin`
- `campaignId`, `campaignVersion`, `contentHash`: populated only after exact verification
- optional `publishingAttemptId`, `pagIntentId`, and external post identifier
- `metrics`: normalized non-negative integer counters
- `observedAt`: when the metrics applied
- `collectedAt`: when the snapshot was collected/imported
- `source`: credential-free collection metadata
- `reviewReasons`: why a snapshot was not linked
- `claimedLink`: the caller's requested linkage, retained for review

Supported counters in v1 are:

`impressions`, `views`, `reactions`, `likes`, `replies`, `comments`, `reposts`, `shares`, and `clicks`.

BIP-AI does not collapse these counters into one metric because platforms can define views, impressions, reactions, and related concepts differently.

## Exact linkage

A snapshot becomes `linked` only when BIP-AI can verify an exact campaign version and content hash.

Callers may provide:

1. `campaignId` + `campaignVersion` + `contentHash`, or
2. a publishing attempt/PAG intent already present in the append-only publishing journal.

Publishing references must agree with the supplied platform and with any explicit campaign/version/hash claim.

If BIP-AI cannot verify the relationship, it stores the snapshot with `status: "review"`. Review records do not receive a verified `campaignId` and therefore do not appear in campaign analytics/history until a future verified snapshot is imported.

BIP-AI never guesses a campaign version from the current campaign state.

## Append-only and deduplication

`content_performance_snapshots` is append-only. SQLite triggers reject updates and deletes.

Repeated imports are deduplicated by a deterministic fingerprint over:

- schema version
- platform
- observation timestamp
- normalized metrics
- verified linkage, or the original claimed linkage for review records

`collectedAt` is intentionally excluded from the fingerprint so importing the same observation again later does not inflate analytics.

## Credential boundary

Performance adapters submit already-collected metrics. They do **not** give BIP-AI X, LinkedIn, WhatsApp, or other social credentials.

Only allow-listed source fields are persisted. Credential-shaped metadata keys such as tokens, passwords, cookies, sessions, secrets, and API keys are dropped before storage. Unknown top-level adapter payload fields are not persisted.

A future plugin or Status Manager may fetch metrics using its own authorization boundary, then submit the sanitized snapshot to BIP-AI.

## HTTP API

All mutation endpoints require `x-bipai-csrf: 1` and `application/json`.

### Manual/JSON import

`POST /api/performance/import`

The body can be one record, `{"record": {...}}`, or `{"records": [...]}`.

Example:

```json
{
  "platform": "x",
  "campaignId": "campaign-id",
  "campaignVersion": 2,
  "contentHash": "exact-content-hash",
  "observedAt": "2026-09-29T20:00:00.000Z",
  "metrics": {
    "impressions": 1200,
    "likes": 45,
    "replies": 7,
    "clicks": 12
  },
  "source": {
    "type": "manual",
    "name": "operator"
  }
}
```

### Adapter submission

`POST /api/adapters/performance`

The record shape is the same, but BIP-AI forces `source.type` to `adapter`.

### Views

- `GET /api/campaigns/:campaignId/performance`
- optional `?platform=x`
- `GET /api/performance/review`
- optional `?projectId=...&platform=...`
- `GET /api/projects/:projectId/performance/review`

## CLI

Import a JSON document or batch:

```bash
bip-ai performance import ./performance.json
```

Use `-` to read JSON from stdin:

```bash
cat performance.json | bip-ai performance import -
```

Add one JSON record directly:

```bash
bip-ai performance add '{"platform":"x","observedAt":"2026-09-29T20:00:00Z","metrics":{"views":100}}'
```

Inspect linked campaign history:

```bash
bip-ai performance list <campaign-id>
bip-ai performance list <campaign-id> x
```

Inspect review records:

```bash
bip-ai performance review
bip-ai performance review <project-id>
```

## Control Room

The selected campaign detail shows verified performance snapshots.

A separate **Performance review** panel shows ambiguous/unlinked records for the selected project, including their review reasons and claimed linkage. This keeps unverifiable metrics visible without silently contaminating campaign analytics.

## Upgrade behavior

The performance table is created lazily with `CREATE TABLE IF NOT EXISTS`. Existing v0.2/v0.3 event, campaign, publishing, narrative-memory, and editorial-preference state is not rewritten.
