# ADR 0003: External transports are adapters, not BIP-AI dependencies

- Status: Accepted
- Date: 2026-09-27

## Context

Useful building-in-public signals can originate outside Git, including WhatsApp messages, hardware purchases, device changes, meetings, deployments, and physical work. Transport SDKs may require sensitive session state or account identifiers.

## Decision

BIP-AI accepts a transport-neutral external-update contract. WhatsApp/Baileys or other transport processes must run separately and submit sanitized updates.

Raw session keys, cookies, phone/JID identifiers, device credentials, and transport credentials are not part of BIP-AI's event schema. Raw message IDs are reduced to deterministic hashed source references when needed for deduplication.

Approved WhatsApp Status content is exported as a content package; BIP-AI itself does not own the Status publishing session.

## Consequences

Transport implementations can change without changing BIP-AI core, and sensitive session material stays outside the editorial database. A separate bridge process is required for each transport.
