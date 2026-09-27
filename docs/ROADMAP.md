# Roadmap

## v0.1 — standalone core
- ProjectEvent schema and normalization
- SQLite event/campaign persistence
- event deduplication
- storyworthiness scoring
- PASS / REVIEW / BLOCK privacy gates
- traceable StoryBrief generation
- deterministic X and LinkedIn drafts
- CLI + CI

## v0.2 — capture adapters
- local Git scanner
- filesystem inbox / processed / failed queues
- portable event producer SDK
- project registry

## v0.3 — editorial workflow
- campaign versioning and immutable content hashes
- editorial export/import
- structural/editorial validation
- explicit campaign approval

## v0.4 — PAG handoff
- PAG client adapter
- `x.threads.create` and `linkedin.posts.create`
- connection IDs such as `x:personal` and `linkedin:personal`
- payload/content-hash binding and approval state reconciliation

## v0.5 — intelligence and dashboard
- pluggable LLM provider for richer drafts while preserving claim provenance
- dashboard for projects, events, campaigns, review queues, and publishing state
- content calendar / campaigns

## later adapters
- dedicated WhatsApp update number as a ProjectEvent source
- optional WhatsApp Status consumer for approved BIP-AI content
- additional activity sources such as CLI, hardware/device events, and manual notes
