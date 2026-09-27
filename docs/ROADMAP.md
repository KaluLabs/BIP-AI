# Roadmap

This file tracks implementation status, not release status. The items below are implemented in the current stacked development branches unless otherwise noted.

## v0.1 — standalone core

- [x] ProjectEvent schema and normalization
- [x] SQLite event/campaign persistence
- [x] event deduplication
- [x] storyworthiness scoring
- [x] PASS / REVIEW / BLOCK privacy gates
- [x] traceable StoryBrief generation
- [x] deterministic X and LinkedIn drafts
- [x] CLI + CI workflow

## v0.2 — capture adapters

- [x] local Git scanner
- [x] filesystem inbox / processed / failed queues
- [x] portable event producer
- [x] project registry

## v0.3 — editorial workflow

- [x] immutable campaign version history
- [x] editorial export/import
- [x] structural/editorial validation
- [x] claim provenance checks
- [x] explicit campaign approval bound to version + contentHash

## v0.4 — PAG handoff

- [x] PAG actor client
- [x] `x.threads.create`
- [x] `linkedin.posts.create`
- [x] optional PAG connection IDs
- [x] content-bound idempotency
- [x] approval/action state reconciliation
- [x] fail-closed deny/error handling

## v0.5 — guarded intelligence

- [x] provider-neutral drafting interface
- [x] OpenAI-compatible adapter
- [x] deterministic fallback
- [x] privacy gate before external provider use
- [x] source-bound claim validation

## v0.6 — Control Room

- [x] local API
- [x] project/event/campaign views
- [x] version history and claim provenance
- [x] draft editing/regeneration
- [x] exact campaign approval
- [x] X/LinkedIn PAG controls
- [x] content-activity calendar
- [x] localhost-first security boundary

## v0.7 — real-world / WhatsApp adapters

- [x] transport-neutral external update contract
- [x] hardware/device/physical/deployment/meeting signals
- [x] WhatsApp message deduplication without retaining raw identifiers
- [x] localhost bridge endpoint
- [x] approved-content Status export contract
- [x] no WhatsApp credential/session dependency in core

## v0.8 — open-source / release hardening

- [x] CONTRIBUTING / SECURITY / CODE_OF_CONDUCT
- [x] issue and PR templates
- [x] CODEOWNERS
- [x] dependency policy and Dependabot
- [x] changelog and release policy
- [x] trust-boundary ADRs
- [x] public-release checklist
- [ ] explicit open-source license selection
- [ ] GitHub-hosted CI startup issue resolved
- [ ] default branch protection requiring CI
- [ ] GitHub private vulnerability reporting enabled
- [ ] first tagged release

## Later

- richer dashboard search/filtering and editorial calendar scheduling
- additional project-event sources
- optional richer local-model providers
- Status Manager implementation as a separate product/integration
- packaging/distribution after release strategy is selected
