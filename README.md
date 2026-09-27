# BIP-AI

**Building in Public AI** is a personal, open-source agent for turning real project activity into accurate, privacy-aware building-in-public content.

BIP-AI observes project events from sources such as Git activity, CLI/manual updates, and optional integrations; turns them into structured story briefs; drafts channel-specific content; and delegates any external publishing action to a permissioned gateway such as [Personal Access Gateway (PAG)](https://github.com/victorkay97/Personal-Access-Gateway).

## Principles

- Evidence first: drafts must be traceable to observed or user-provided project events.
- Privacy first: sensitive or ambiguous material is held for review.
- Human control: BIP-AI can draft autonomously, but publishing is approval-gated.
- No hard dependency on social APIs: authenticated-browser / intent handoff can be used through PAG.
- BIP-AI is independent: optional consumers such as WhatsApp Status integrations must never be required for core operation.

## Status

Repository initialized for the standalone BIP-AI implementation. The first implementation PR will establish the event model, local persistence, ingestion pipeline, story generation, editorial workflow, and PAG adapter.
