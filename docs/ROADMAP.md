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

## v0.2.0 — daily-use productization ✅

Released 2026-09-27.

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

- [x] **[BIP-013 — Approval inbox](https://github.com/victorkay97/BIP-AI/issues/28)**
  - drafts awaiting approval
  - privacy REVIEW items
  - stale approvals
  - failed/denied handoffs
  - actionable queue with provenance context

- [x] **[BIP-014 — Publishing history and safe retries](https://github.com/victorkay97/BIP-AI/issues/29)**
  - append-only handoff/publishing journal
  - platform-independent outcome tracking
  - PAG receipt reconciliation
  - idempotent retry controls
  - no retry path that bypasses approval/content-hash binding

BIP-013 depends on the v0.2 Control Room/query work. BIP-014 depends on BIP-013's operational state model.

### Wave D — onboarding and distribution

- [x] **[BIP-015 — First-run setup experience](https://github.com/victorkay97/BIP-AI/issues/30)**
  - setup/status doctor
  - guided project registration
  - environment/config validation
  - PAG connectivity check
  - provider configuration check without exposing secret values

- [x] **[BIP-016 — Distribution and reproducible installation](https://github.com/victorkay97/BIP-AI/issues/31)**
  - decide and document supported distribution forms
  - containerized/local installation path
  - reproducible release verification
  - no npm publication unless separately approved

BIP-016 should be finalized after the v0.2 runtime/config surface is stable.

## v0.2.0 definition of done

- [x] BIP-009 through BIP-016 are complete or explicitly deferred with rationale
- [x] migrations are backward-compatible from v0.1.0 state
- [x] self-hosted CI is green on the release commit
- [x] security/privacy boundaries remain fail-closed
- [x] contributor and operator documentation reflect the shipped behavior
- [x] changelog and release notes are prepared before tagging
- [x] no release is published with known unreviewed credential/private-state exposure

## v0.3.0 — contextual intelligence and extensibility 🚧

The goal of v0.3.0 is to make BIP-AI increasingly useful over time by adding evidence-backed project context, local editorial learning, outcome feedback, analytics, and a safe plugin boundary — without expanding autonomous publishing authority.

### Wave A — contextual intelligence

- [x] **[BIP-017 — Project narrative memory and story arcs](https://github.com/victorkay97/BIP-AI/issues/54)**
  - project-scoped durable narrative context derived from real events/campaigns
  - evidence/source references for every factual narrative item
  - deterministic backfill/rebuild from existing state
  - privacy-aware stale-context invalidation
  - Control Room story-arc/provenance views

- [x] **[BIP-018 — Local editorial preference learning](https://github.com/victorkay97/BIP-AI/issues/55)**
  - learn bounded style preferences from immutable edit/approval history
  - project-scoped by default
  - inspect/reset/disable controls
  - preference hints cannot become factual memory or publishing authority

BIP-018 depends on the v0.3 context boundary established by BIP-017.

### Wave B — feedback loop

- [x] **[BIP-019 — Content performance feedback ingestion](https://github.com/victorkay97/BIP-AI/issues/56)**
  - transport-neutral performance snapshots
  - exact campaign/version/contentHash linkage
  - append-only/auditable outcome history
  - deterministic deduplication
  - no social credentials in BIP-AI

- [ ] **[BIP-020 — Multi-project analytics and evidence-backed insights](https://github.com/victorkay97/BIP-AI/issues/57)**
  - project and cross-project analytics
  - capture/editorial/publishing/performance metrics
  - time/source/story-type/platform breakdowns
  - evidence-linked observations that do not overstate causation
  - machine-readable analytics export

BIP-020 depends on the normalized performance model from BIP-019.

### Wave C — extensibility

- [ ] **[BIP-021 — Adapter capability registry and plugin SDK](https://github.com/victorkay97/BIP-AI/issues/58)**
  - versioned plugin manifests and declared capabilities
  - capture/drafting/performance/export adapter classes
  - schema validation, error isolation, timeouts, and safe health reporting
  - runtime-only secret references
  - no plugin publishing capability that bypasses approval + PAG

- [ ] **[BIP-022 — First plugin-backed non-GitHub activity source](https://github.com/victorkay97/BIP-AI/issues/59)**
  - prove the SDK with a first-party non-GitHub activity adapter
  - versioned sanitized event envelopes
  - deterministic source identity/deduplication
  - privacy-safe REVIEW defaults
  - restart-safe health/replay behavior

BIP-022 depends on BIP-021 and must use the supported plugin boundary rather than adding another privileged core source.

### Wave D — private intelligence and external product integration

- [ ] **[BIP-023 — Local/private drafting providers and model diagnostics](https://github.com/victorkay97/BIP-AI/issues/60)**
  - first-class local OpenAI-compatible/Ollama/LM Studio-style profiles where applicable
  - safe endpoint/model diagnostics
  - deterministic fallback
  - unchanged privacy/provenance validation
  - Docker-to-host local-model guidance

- [ ] **[BIP-024 — Status Manager bridge and publication receipt contract](https://github.com/victorkay97/BIP-AI/issues/61)**
  - versioned approved-content handoff
  - exact version/contentHash and idempotency binding
  - receipt/outcome reconciliation
  - Control Room handoff history
  - explicit rejection of WhatsApp session/account credentials from BIP-AI state

BIP-024 should reuse BIP-014 journal/idempotency principles and the BIP-021 adapter boundary. The Status Manager remains a separate product and owns the WhatsApp session.

## v0.3.0 definition of done

- [ ] BIP-017 through BIP-024 are complete or explicitly deferred with rationale
- [ ] v0.2.0 persistent state upgrades without destructive migration
- [ ] project isolation is covered for narrative memory, preferences, feedback, and analytics
- [ ] plugin capabilities are declared, validated, and fail closed
- [ ] no new path bypasses exact approval + PAG for X/LinkedIn publishing
- [ ] no WhatsApp/social account credential moves into BIP-AI core
- [ ] deterministic fallback remains usable without any external/local model
- [ ] contributor/operator/plugin documentation reflects shipped behavior
- [ ] self-hosted CI, release-tree audit, and distribution verification are green on the release commit
- [ ] changelog and v0.3.0 release notes are prepared before tagging

## Later

- signed/multi-architecture container images and supply-chain attestations
- additional first-party activity-source plugins after the BIP-022 reference adapter
- richer local-model/provider families beyond the v0.3 first-class profiles
- optional content-experiment workflows built on the performance-feedback model
- standalone executable only if maintenance/signing tradeoffs become worthwhile
