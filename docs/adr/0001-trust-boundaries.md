# ADR 0001: Keep observation, editorial state, credentials, and publishing authority separate

- Status: Accepted
- Date: 2026-09-27

## Context

BIP-AI observes project activity and prepares public-facing content. That creates a risk that an editorial agent gradually accumulates account credentials and external-action authority.

## Decision

BIP-AI is divided into explicit trust boundaries:

1. capture adapters produce normalized ProjectEvents;
2. the editorial core stores and transforms project facts;
3. optional model providers can propose drafts but cannot approve or publish;
4. campaign approval is a separate human-controlled state transition;
5. PAG owns permissioned external account actions and account credentials;
6. transports such as WhatsApp stay outside core and submit sanitized events.

BIP-AI core will not store social-account credentials or provide a fallback direct-publishing path.

## Consequences

Integrations require adapters and may involve more setup, but compromise or failure in one boundary has less authority. Publishing remains possible without giving the content-generation layer account credentials.
