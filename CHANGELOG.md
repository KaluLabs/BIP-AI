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
