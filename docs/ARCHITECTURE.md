# BIP-AI architecture

BIP-AI is split into four boundaries so content generation never silently becomes publishing authority.

1. **Observation** — accepts portable `ProjectEvent` records from Git, CLI/manual updates, and future adapters.
2. **Editorial core** — deduplicates, scores storyworthiness, applies privacy gates, builds a traceable story brief, and produces deterministic drafts.
3. **State** — stores events and campaigns locally in SQLite. Campaigns keep X and LinkedIn state independently.
4. **Action gateway** — future PAG adapter submits an approved, content-hash-bound action request. Core BIP-AI does not own social credentials and does not autonomously publish.

## ProjectEvent

Minimum fields are `projectId`, `type`, and `summary`. Useful optional context includes `details`, `implementation`, `decisions`, `lessons`, `outcomes`, `evidence`, `assets`, `nextStep`, `privacy`, and `occurredAt`.

## Pipeline

`ProjectEvent -> normalize -> fingerprint/deduplicate -> storyworthiness -> privacy -> StoryBrief -> X/LinkedIn drafts -> campaign -> editorial review -> PAG handoff`

Privacy is deny-first: `BLOCK` stops draft generation; `REVIEW` can create a campaign but keeps it in `needs_review`; only `PASS` is draft-ready.

## Compatibility with the earlier Presence Agent prototype

The standalone design deliberately carries forward the proven prototype concepts: filesystem/manual event capture, portable ProjectEvents, Git scanning, storyworthiness thresholds, privacy review, campaign versioning, deduplication, independent platform state, claim traceability, and PAG approval gating. Integrations will be reintroduced behind adapters rather than coupling the core package back to PAG.
