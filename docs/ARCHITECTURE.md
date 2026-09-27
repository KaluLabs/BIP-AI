# BIP-AI architecture

BIP-AI separates observation, editorial reasoning, human approval, transport credentials, and external actions so no single content-generation component silently accumulates publishing authority.

## Boundaries

1. **Observation** — portable `ProjectEvent` records from Git, filesystem/manual updates, and sanitized external adapters.
2. **Editorial core** — deduplication, storyworthiness scoring, privacy gates, StoryBrief construction, deterministic drafting, claim provenance, and campaign versioning.
3. **Optional drafting provider** — can propose richer drafts from privacy-`PASS` StoryBrief claims, but its output must pass structure/provenance validation and cannot approve or publish.
4. **Local state** — SQLite event/campaign storage plus immutable campaign version history.
5. **Human approval** — binds approval to the exact current `version + contentHash`.
6. **Action gateway** — PAG receives least-privilege intents such as `x.threads.create` and `linkedin.posts.create`; BIP-AI never receives the social-account credential.
7. **External transports** — WhatsApp or other transports run separately, submit sanitized events, and keep their session/account material outside BIP-AI.

## ProjectEvent

Minimum fields are `projectId`, `type`, and `summary`. Useful optional context includes `details`, `implementation`, `decisions`, `lessons`, `outcomes`, `evidence`, `assets`, `nextStep`, `privacy`, and `occurredAt`.

## Editorial pipeline

`ProjectEvent -> normalize -> fingerprint/deduplicate -> storyworthiness -> privacy -> StoryBrief -> drafts -> campaign version -> approval -> PAG handoff`

Privacy is deny-first:

- `BLOCK` stops draft generation.
- `REVIEW` can preserve the event/campaign for human inspection but cannot be treated as approved content.
- `PASS` is eligible for normal editorial/provider processing.

Editing content creates a new campaign version and invalidates prior approval and handoff state.

## Drafting providers

BIP-AI remains usable without an external model. The deterministic writer is the fallback and zero-config default.

External providers receive only privacy-`PASS` StoryBrief material plus a finite list of allowed, source-addressable claims. Provider output that introduces unsupported claims or violates platform structure is discarded.

## PAG boundary

BIP-AI authenticates to PAG with a dedicated actor token. That token authorizes BIP-AI to request capabilities; it is not a social-account credential.

PAG owns:

- grant evaluation
- exact payload-hash approval
- idempotency / exactly-once behavior
- account connection metadata and credential vault
- X/LinkedIn browser handoff execution

BIP-AI owns:

- editorial content
- campaign version/hash approval state
- platform-specific request state
- PAG intent/approval identifiers needed for reconciliation

## Control Room

The Control Room is a localhost-first operator surface over the same application modules and SQLite state used by the CLI. It is not a second backend.

Mutations use a same-origin custom CSRF header and the server emits browser-hardening headers. Non-loopback binding is refused unless explicitly enabled, and remote binding alone is not considered authentication.

## External / WhatsApp boundary

A transport bridge may submit a deliberate real-world update, but BIP-AI does not persist transport session secrets, phone/JID identifiers, cookies, or device credentials.

When a transport message ID is useful for deduplication, it is reduced to a deterministic hashed source reference.

Approved WhatsApp Status output is an export-only content package for a separate Status Manager.

## Architecture decisions

See `docs/adr/` for the decisions that formalize these boundaries.
