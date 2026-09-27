# BIP-AI Control Room

The Control Room is BIP-AI's local operator dashboard. It uses the same SQLite state and application modules as the CLI; it is not a second backend.

## Start it

```bash
node ./src/cli.js serve
```

By default it listens on `http://127.0.0.1:8790`.

Environment settings:

- `BIP_AI_HOST` — defaults to `127.0.0.1`.
- `BIP_AI_PORT` — defaults to `8790`.
- `BIP_AI_ALLOW_REMOTE` — defaults to `0`. A non-loopback bind is refused unless this is explicitly set to `1`.

## What the dashboard exposes

- configured local project capture sources
- event timeline with storyworthiness and privacy results
- campaigns and immutable version history
- X and LinkedIn drafts
- exact `version + contentHash` approval state
- StoryBrief claim provenance
- deterministic/provider draft regeneration
- independent X and LinkedIn PAG handoff/reconciliation state
- a lightweight content-activity calendar based on campaign creation dates

The dashboard may display local repository paths because it is an operator surface. It does not expose PAG actor tokens, drafting-provider API keys, or social-account credentials. `/api/config` returns only safe provider/configuration names and booleans.

## Mutation protection

State-changing API requests require the custom `X-BIPAI-CSRF: 1` header. The bundled UI sends this header for same-origin mutations. The server also sends a restrictive Content Security Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

## Remote access

`BIP_AI_ALLOW_REMOTE=1` only permits the process to bind to a non-loopback interface. It is **not** a complete authentication or internet-exposure model.

For remote use, place BIP-AI behind a trusted authenticated reverse proxy, private VPN/tunnel, or equivalent access-control layer with HTTPS. Do not expose the Control Room directly to the public internet in its current form.
