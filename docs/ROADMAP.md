# Roadmap

BIP-AI uses public release versions for product milestones. Historical implementation phases that were developed before the first public release are summarized under v0.1.0.

## v0.1.0 — public foundation ✅

Released 2026-09-27.

### Core and capture

- [x] ProjectEvent schema and normalization
- [x] SQLite event/campaign persistence
- [x] event fingerprinting and deduplication
- [x] storyworthiness scoring
- [x] PASS / REVIEW / BLOCK privacy gates
- [x] traceable StoryBrief generation
- [x] deterministic X and LinkedIn drafts
- [x] local Git scanner
- [x] filesystem inbox / processed / failed queues
- [x] project registry
- [x] transport-neutral real-world update adapter

### Editorial integrity

- [x] immutable campaign version history
- [x] editorial export/import
- [x] structural/editorial validation
- [x] source-bound claim provenance
- [x] explicit campaign approval bound to version + contentHash
- [x] approval invalidation after content changes

### PAG and publishing boundary

- [x] PAG actor client
- [x] `x.threads.create`
- [x] `linkedin.posts.create`
- [x] optional PAG connection IDs
- [x] content-bound idempotency
- [x] approval/action reconciliation
- [x] fail-closed deny/error handling
- [x] approved-content export contract for a separate WhatsApp Status Manager
- [x] no social or WhatsApp publishing credentials in BIP-AI core

### Guarded drafting

- [x] provider-neutral drafting interface
- [x] OpenAI-compatible adapter
- [x] deterministic fallback
- [x] privacy gate before external-provider use
- [x] unsupported-claim rejection

### Control Room

- [x] localhost-first API and dashboard
- [x] project/event/campaign views
- [x] version history and claim provenance
- [x] draft editing/regeneration
- [x] exact campaign approval
- [x] X/LinkedIn PAG controls
- [x] basic content-activity calendar

### Open-source and release hardening

- [x] Apache License 2.0
- [x] CONTRIBUTING / SECURITY / CODE_OF_CONDUCT
- [x] issue and PR templates
- [x] CODEOWNERS
- [x] dependency policy and Dependabot
- [x] changelog and release policy
- [x] trust-boundary ADRs
- [x] public-release exposure audit
- [x] self-hosted CI
- [x] immutable `actions/checkout` pin
- [x] active `main` ruleset requiring PRs and CI
- [x] private vulnerability reporting
- [x] public `v0.1.0` GitHub release

## v0.2.0 — daily-use productization 🚧

The goal of v0.2.0 is to make BIP-AI useful as an everyday operating surface rather than only a technically complete foundation.

### Wave A — editorial workspace

- [x] **[BIP-009 — Editorial calendar + scheduling](https://github.com/victorkay97/BIP-AI/issues/24)**
  - date/time scheduling and timezone-aware planned publication
  - planned / drafted / approved / handed-off / published / failed states
  - rescheduling without invalidating content unless the payload changes
  - calendar APIs and Control Room interactions

- [x] **[BIP-010 — Control Room search, filters, and navigation](https://github.com/victorkay97/BIP-AI/issues/25)**
  - project selector
  - event/campaign search
  - privacy/status/source/platform filters
  - pagination
  - stable URL/query-state navigation

BIP-009 and BIP-010 should be implemented in parallel against shared API/query conventions.

### Wave B — automated capture

- [x] **[BIP-011 — Automated local capture scheduler](https://github.com/victorkay97/BIP-AI/issues/26)**
  - scheduled/continuous project scans
  - durable cursors
  - restart-safe processing
  - duplicate suppression
  - observable capture health

- [x] **[BIP-012 — GitHub activity capture source](https://github.com/victorkay97/BIP-AI/issues/27)**
  - commits, pull requests, issues, releases, and CI milestones
  - optional authenticated access without storing raw credentials in BIP-AI state
  - normalized ProjectEvents
  - deterministic deduplication

BIP-012 should reuse BIP-011 scheduling/cursor primitives where practical.

### Wave C — review and publication operations

- [ ] **[BIP-013 — Approval inbox](https://github.com/victorkay97/BIP-AI/issues/28)**
  - drafts awaiting approval
  - privacy REVIEW items
  - stale approvals
  - failed/denied handoffs
  - actionable queue with provenance context

- [ ] **[BIP-014 — Publishing history and safe retries](https://github.com/victorkay97/BIP-AI/issues/29)**
  - append-only handoff/publishing journal
  - platform-independent outcome tracking
  - PAG receipt reconciliation
  - idempotent retry controls
  - no retry path that bypasses approval/content-hash binding

BIP-013 depends on the v0.2 Control Room/query work. BIP-014 depends on BIP-013's operational state model.

### Wave D — onboarding and distribution

- [ ] **[BIP-015 — First-run setup experience](https://github.com/victorkay97/BIP-AI/issues/30)**
  - setup/status doctor
  - guided project registration
  - environment/config validation
  - PAG connectivity check
  - provider configuration check without exposing secret values

- [ ] **[BIP-016 — Distribution and reproducible installation](https://github.com/victorkay97/BIP-AI/issues/31)**
  - decide and document supported distribution forms
  - containerized/local installation path
  - reproducible release verification
  - no npm publication unless separately approved

BIP-016 should be finalized after the v0.2 runtime/config surface is stable.

## v0.2.0 definition of done

- [ ] BIP-009 through BIP-016 are complete or explicitly deferred with rationale
- [ ] migrations are backward-compatible from v0.1.0 state
- [ ] self-hosted CI is green on the release commit
- [ ] security/privacy boundaries remain fail-closed
- [ ] contributor and operator documentation reflect the shipped behavior
- [ ] changelog and release notes are prepared before tagging
- [ ] no release is published with known unreviewed credential/private-state exposure

## Later

- richer local-model providers
- additional non-GitHub project-event sources
- Status Manager implementation as a separate product/integration
- richer multi-project analytics and content performance feedback
- optional plugin ecosystem for capture/drafting/export adapters
