# Automated local capture

BIP-AI can continuously scan registered local Git projects and feed new commits through the normal ProjectEvent pipeline.

This is a **capture-only** subsystem. It does not approve content, call PAG, or publish anything.

## Lifecycle

Registered projects live in the existing project registry:

```bash
node ./src/cli.js projects add <projectId> <repoPath>
```

Automatic capture can run in either of two ways:

```bash
# Starts the Control Room and automatic capture together.
node ./src/cli.js serve

# Runs only the capture scheduler.
node ./src/cli.js capture start
```

The scheduler performs one immediate scan, then scans again on the configured polling interval.

A one-shot operator scan is also available:

```bash
node ./src/cli.js capture run
node ./src/cli.js capture run <projectId>
```

Manual `capture run` bypasses a source's current retry delay intentionally. It does not bypass event deduplication or any editorial/privacy controls.

Inspect durable health/cursor state with:

```bash
node ./src/cli.js capture status
```

The Control Room exposes the same information under **Capture health**.

## Configuration

Defaults:

```dotenv
BIP_AI_CAPTURE_ENABLED=1
BIP_AI_CAPTURE_POLL_MS=60000
BIP_AI_CAPTURE_BATCH_SIZE=50
BIP_AI_CAPTURE_RETRY_BASE_MS=5000
BIP_AI_CAPTURE_RETRY_MAX_MS=300000
```

- `BIP_AI_CAPTURE_ENABLED` — set to `0` to stop `serve` from starting automatic capture.
- `BIP_AI_CAPTURE_POLL_MS` — polling interval. Minimum accepted value is 1000 ms.
- `BIP_AI_CAPTURE_BATCH_SIZE` — commits processed per project per cycle, from 1 to 1000.
- `BIP_AI_CAPTURE_RETRY_BASE_MS` — first failure delay. Minimum 1000 ms.
- `BIP_AI_CAPTURE_RETRY_MAX_MS` — maximum exponential-backoff delay and must be at least the base delay.

The defaults favor a low-overhead local process rather than aggressive filesystem polling.

## SHA checkpoints

Git capture uses a durable commit-SHA cursor, not a timestamp.

For a normal scan:

1. BIP-AI reads the stored source cursor.
2. It enumerates commits after that SHA in oldest-first order.
3. Each commit is converted to a normal ProjectEvent and passed to `BipAI.ingest()`.
4. Only after the whole batch succeeds does BIP-AI advance the durable cursor to the last processed SHA.

This ordering is important for crash safety.

If the process exits after some events were written but before the cursor is advanced, the next run scans the old range again. Existing event fingerprinting recognizes already-written events as duplicates, so replay is idempotent and the remaining events can finish safely.

## Initial scan

A project with no cursor yet imports up to the most recent `BIP_AI_CAPTURE_BATCH_SIZE` commits, oldest-first within that initial window, then learns forward from the resulting HEAD checkpoint.

This intentionally avoids importing an unbounded repository history when a project is first registered.

The existing manual `git scan` command remains available for explicit historical/time-based imports.

## Rewritten history

If the stored SHA is no longer an ancestor of the current HEAD, BIP-AI treats the repository history as rewritten.

It re-scans a bounded recent window and relies on event fingerprinting for duplicate suppression before establishing a fresh SHA checkpoint. Capture health reports `healthy_with_warning` for that successful recovery cycle.

## Failure isolation and backoff

Each registered project has independent source state.

One repository failure does not prevent other registered repositories from being scanned or from advancing their own cursors.

On failure:

- the existing cursor is preserved;
- health moves to `degraded`;
- a non-secret failure code/summary is persisted;
- `consecutiveFailures` increments;
- the next automatic attempt is delayed with exponential backoff;
- backoff is capped at `BIP_AI_CAPTURE_RETRY_MAX_MS`.

Successful capture clears the failure streak and retry delay.

The scheduler never stores repository credentials in capture state. Durable source state contains the source key/type, project ID, SHA cursor, timestamps, health counters, safe error summaries, and scan statistics.

## Health states

Typical source health values:

- `never_run` — project is registered but no capture cycle has completed.
- `healthy` — most recent scan completed normally.
- `healthy_with_warning` — scan completed while recovering from rewritten Git history.
- `degraded` — most recent attempt failed and is in backoff/retry state.

Health includes:

- last attempt;
- last successful scan;
- last failure;
- next retry;
- consecutive failures;
- last safe error code/summary;
- last scan counts for scanned, accepted, duplicate, and campaign-producing events;
- remaining commits when a batch limit was reached.

## Local API

The Control Room exposes:

- `GET /api/capture/status`
- `POST /api/capture/run`

The manual run endpoint requires the same `X-BIPAI-CSRF: 1` mutation header as other local state-changing operations.

If an automatic capture cycle is already running, another manual run is rejected with HTTP 409 rather than overlapping the source scan.

## Extension boundary

The SQLite `capture_sources` state is keyed by `source_key`, `project_id`, and `source_type`. This is intentionally broader than Git so future sources such as GitHub activity can reuse the same cursor/health/retry model without sharing credentials or inventing a parallel scheduler.
