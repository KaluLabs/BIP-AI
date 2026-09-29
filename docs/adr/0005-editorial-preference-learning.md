# ADR 0005: Local editorial preference learning

- Status: Accepted
- Date: 2026-09-29

## Context

BIP-AI already separates factual ProjectEvent/narrative evidence from drafting and exact human approval. Repeated operator edits contain useful style information, but treating those edits as factual memory would blur provenance and could let generated language become an unsourced claim source.

## Decision

Editorial preference learning is a separate, derived, project-scoped subsystem.

- Inputs are privacy-PASS campaign-version style diffs and explicit approval outcomes.
- Stored/returned evidence contains bounded style observations and campaign/version references, not historical draft text.
- Approval evidence has greater weight than an edit observation.
- Generated rewrites are excluded from edit learning when their generation timestamp is contemporaneous with the version timestamp.
- Disable and reset controls change the learning window without rewriting campaign history.
- The global/default layer remains off unless a future explicit opt-in design enables it.
- Drafting receives bounded style hints only; allowed factual claims continue to come exclusively from StoryBrief/narrative provenance.
- Learned state cannot approve, request PAG authority, or publish.

## Consequences

BIP-AI can converge toward an operator's preferred presentation while retaining rebuildability and project isolation. The learner is intentionally conservative: it can select/remove already sourced material for style, but cannot paraphrase facts merely to satisfy a preference.

Campaign-version history remains authoritative and unchanged by preference reset/disable. PAG remains the only external action boundary.
