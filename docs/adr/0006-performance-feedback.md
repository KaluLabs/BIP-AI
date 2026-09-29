# ADR 0006: Performance feedback is append-only, exact-linked outcome evidence

- Status: Accepted
- Date: 2026-09-29

## Context

BIP-AI needs outcome feedback so later analytics can compare editorial choices with observed performance. Social credentials and publishing authority remain outside BIP-AI, and platform metrics can arrive from manual collection, files, or external adapters.

A mutable "latest totals" field on a campaign would lose history, make imports difficult to audit, and encourage accidental attachment of metrics to the wrong version of edited content.

## Decision

BIP-AI stores performance as a separate append-only sequence of versioned `ContentPerformance` snapshots.

A snapshot is analytics-ready only when its platform and exact campaign/version/contentHash relationship can be verified. Existing publishing-journal references may establish that exact relationship. Conflicting, incomplete, ambiguous, or otherwise unverifiable claims are stored with `status: review` and are not attached to campaign history.

Repeated snapshots are deterministically deduplicated. Collection time does not change the identity of an already-observed snapshot.

Performance ingestion accepts already-collected metrics only. It does not introduce social account credentials, sessions, cookies, API keys, or publishing capability into BIP-AI. Persisted source metadata is allow-listed/sanitized.

## Consequences

- Outcome history remains auditable over time.
- Edits cannot cause old performance to be silently attributed to new content.
- Duplicate imports do not inflate later analytics.
- Reviewable data remains visible without becoming trusted evidence.
- BIP-020 can aggregate only exact-linked snapshots by default.
- Adapters remain transport/authentication boundaries rather than credential providers to BIP-AI.
- Resolving a review item is represented by importing a new verified snapshot; old evidence is not rewritten.
