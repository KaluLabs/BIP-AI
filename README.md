# BIP-AI

**Building in Public AI** is a personal, evidence-first agent for turning real project activity into accurate, privacy-aware building-in-public content.

BIP-AI observes project events from Git, local/manual activity, and optional external adapters; turns them into structured story briefs; creates reviewable X and LinkedIn drafts; and delegates any external publishing action to a permissioned gateway such as [Personal Access Gateway (PAG)](https://github.com/victorkay97/Personal-Access-Gateway).

The project is being prepared for public open-source release. The repository is currently private and an explicit open-source license has **not yet been selected**. See [Licensing](./docs/LICENSING.md) and the [Public release checklist](./docs/PUBLIC-RELEASE-CHECKLIST.md).

## Principles

- **Evidence first** — drafts must be traceable to observed or user-provided project events.
- **Privacy first** — sensitive or ambiguous material is held for review or blocked.
- **Human control** — BIP-AI can draft autonomously, but approval and publishing authority stay separate.
- **Least privilege** — BIP-AI never needs social-account credentials.
- **No hard social-API dependency** — final actions are delegated to PAG/browser handoff.
- **Adapter isolation** — optional transports such as WhatsApp are never required by core BIP-AI.

## Current implementation

The current development stack includes:

- portable `ProjectEvent` normalization
- local SQLite persistence
- event fingerprinting and deduplication
- storyworthiness scoring
- `PASS / REVIEW / BLOCK` privacy gates
- traceable `StoryBrief` generation
- deterministic X thread and LinkedIn narrative drafts
- local Git scanner and filesystem event inbox
- immutable campaign versions
- claim provenance and unsupported-claim review gating
- exact `version + contentHash` campaign approvals
- PAG handoff for `x.threads.create` and `linkedin.posts.create`
- pluggable guarded drafting provider with deterministic fallback
- local Control Room dashboard/API
- transport-neutral real-world/WhatsApp update contract
- approved-content export for a separate WhatsApp Status Manager
- automated tests and GitHub Actions workflow

## Quick start

Requires Node.js 22.5+.

```bash
npm test
node ./src/cli.js event emit ./examples/project-event.json
node ./src/cli.js campaigns list
node ./src/cli.js serve
```

The default database is `.bipai/bip-ai.sqlite`. Copy `.env.example` for optional configuration.

## Core pipeline

```text
activity
  -> ProjectEvent
  -> normalize / deduplicate
  -> storyworthiness + privacy
  -> StoryBrief
  -> deterministic or guarded provider drafts
  -> immutable campaign version
  -> human approval bound to version + contentHash
  -> PAG intent
  -> X / LinkedIn browser handoff
```

External real-world updates use the same pipeline:

```text
WhatsApp/manual transport
  -> sanitized external update
  -> ProjectEvent
  -> normal BIP-AI editorial pipeline
```

## Control Room

Run:

```bash
node ./src/cli.js serve
```

The Control Room binds to `127.0.0.1:8790` by default and exposes projects, events, campaigns, version history, claim provenance, draft editing/regeneration, approvals, and PAG handoff state.

Remote binding is an explicit opt-in and is **not** an authentication model. See [Dashboard security](./docs/DASHBOARD.md).

## Publishing boundary

BIP-AI does not own X, LinkedIn, or WhatsApp publishing credentials and does not silently publish.

For X and LinkedIn, approved campaigns submit explicit PAG intents. PAG evaluates least-privilege grants and exact-payload approval before producing the browser handoff.

For WhatsApp Status, BIP-AI can export an approved-content package for a separate Status Manager; it does not hold the WhatsApp publishing session.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Roadmap](./docs/ROADMAP.md)
- [PAG integration](./docs/PAG.md)
- [Drafting providers](./docs/DRAFTING.md)
- [Control Room](./docs/DASHBOARD.md)
- [External / WhatsApp adapters](./docs/EXTERNAL-ADAPTERS.md)
- [Dependency policy](./docs/DEPENDENCY-POLICY.md)
- [Release policy](./docs/RELEASING.md)
- [Licensing decision](./docs/LICENSING.md)
- [Public release checklist](./docs/PUBLIC-RELEASE-CHECKLIST.md)
- [Architecture decisions](./docs/adr/)

## Contributing and security

Read [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before contributing.

Do not place credentials, tokens, session material, private project data, or vulnerability details in public issues.
