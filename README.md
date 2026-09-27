# BIP-AI

**Building in Public AI** is a personal, open-source agent for turning real project activity into accurate, privacy-aware building-in-public content.

BIP-AI observes project events from sources such as Git activity, CLI/manual updates, and optional integrations; turns them into structured story briefs; drafts channel-specific content; and delegates any external publishing action to a permissioned gateway such as [Personal Access Gateway (PAG)](https://github.com/victorkay97/Personal-Access-Gateway).

## Principles

- Evidence first: drafts must be traceable to observed or user-provided project events.
- Privacy first: sensitive or ambiguous material is held for review.
- Human control: BIP-AI can draft autonomously, but publishing is approval-gated.
- No hard dependency on social APIs: authenticated-browser / intent handoff can be used through PAG.
- BIP-AI is independent: optional consumers such as WhatsApp Status integrations must never be required for core operation.

## Current standalone core

The first implementation slice includes:

- portable `ProjectEvent` normalization
- local SQLite persistence
- event fingerprinting and deduplication
- configurable storyworthiness scoring
- `PASS` / `REVIEW` / `BLOCK` privacy gates
- traceable `StoryBrief` generation
- deterministic X thread and LinkedIn narrative drafts
- independent X/LinkedIn campaign state
- CLI commands for ingest, listing, inspection, and editorial export
- automated tests and GitHub Actions CI

## Quick start

Requires Node.js 22.5+.

```bash
npm test
node ./src/cli.js event emit ./examples/project-event.json
node ./src/cli.js events list
node ./src/cli.js campaigns list
```

The default database is `.bipai/bip-ai.sqlite`. Override it with `BIP_AI_DB`, and override the default story threshold with `BIP_AI_STORY_THRESHOLD`.

See [Architecture](./docs/ARCHITECTURE.md) and [Roadmap](./docs/ROADMAP.md).

## Publishing boundary

BIP-AI does not own social credentials and does not autonomously publish. The PAG integration will submit explicit capability requests such as `x.threads.create` and `linkedin.posts.create`, with final external actions remaining approval-gated.
