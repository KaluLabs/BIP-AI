# Changelog

All notable user-facing changes to BIP-AI will be documented here.

The project follows Semantic Versioning once releases are tagged. During the `0.x` phase, minor releases may contain breaking changes, but breaking changes must still be called out explicitly.

## Unreleased

### Added

- Per-platform editorial scheduling for X and LinkedIn with explicit RFC3339 timestamps and IANA timezone labels.
- Persistent `drafted / approved / planned / handed_off / published / failed` lifecycle state.
- Deterministic due/overdue schedule query and approval-gated scheduled PAG execution.
- Control Room editorial calendar with schedule, reschedule, and clear controls.
- URL-backed Control Room project/search/privacy/source/platform/status/date filters.
- Strict server-side event/campaign query validation, stable sorting, and pagination.
- Restart-safe automatic local Git capture with durable SHA checkpoints, per-project health, and capped exponential retry backoff.
- Capture CLI controls and Control Room capture-health/manual-run surfaces.
- Optional GitHub activity source for pushes, pull requests, issue closures, releases, and completed CI/workflow success/failure milestones.
- Composite GitHub repository-event/workflow cursors with ETag polling, conservative private-repository review defaults, and explicit rate-limit handling.
- Operational approval inbox with priority/age ordering, provenance preview, exact-version approval, stale-approval detection, blocked schedules, and PAG failure attention states.
- Explicit privacy REVIEW resolution with immutable versioning and required operator rationale.
- Append-only publishing/PAG journal with database-enforced immutability, exact version/content-hash attempt binding, receipt reconciliation, and platform-isolated outcome history.
- Deterministic safe retry chains for retryable publishing failures; duplicate retry requests collapse to one logical retry and PAG denial remains terminal.
- Restartable first-run setup with guided/non-interactive project registration and safe local-state initialization.
- `doctor` diagnostics for Node/config/provider/PAG readiness with secret redaction and read-only PAG health checks.
- Runtime version/revision reporting through the CLI and `/api/health`.
- Reproducible Git-derived source archives with SHA-256 checksum and release manifest.
- Non-root Docker/Compose runtime with `/data` persistence, internal health checks, read-only project mounts, and runtime-only secret injection.
- Trusted CI distribution verification covering clean archive setup, container health, and persistent state across container/image replacement.

## 0.1.0 - 2026-09-27

### Added

- Standalone ProjectEvent pipeline and local SQLite state.
- Storyworthiness scoring and PASS / REVIEW / BLOCK privacy gates.
- Traceable StoryBrief generation and deterministic X/LinkedIn drafts.
- Filesystem inbox, local Git scanning, and project registry.
- Immutable campaign versions, claim provenance, and content-bound approvals.
- PAG handoff for X and LinkedIn.
- Pluggable guarded drafting provider with deterministic fallback.
- Local Control Room API/dashboard.
- Transport-neutral real-world and WhatsApp update contract.
- Approved-content export for a separate WhatsApp Status Manager.
- Apache License 2.0 licensing and project NOTICE.
- Self-hosted GitHub Actions verification on Node.js 22+.
