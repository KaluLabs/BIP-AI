# Security policy

BIP-AI handles project activity, editorial state, optional model-provider access, and permissioned publishing handoffs. Security reports should be treated as sensitive.

## Supported versions

Until the first stable release, security fixes are made on the current development line only.

## Reporting a vulnerability

For a public BIP-AI repository, use GitHub's **Report a vulnerability** / private vulnerability reporting flow when it is enabled for this repository. This keeps the report inside a private security advisory.

Do **not** place exploit details, credentials, tokens, session material, private project data, or reproduction secrets in a public issue.

If private vulnerability reporting is not yet enabled, open a minimal public issue titled **Security contact request** containing no sensitive details and ask the maintainer to establish a private reporting channel.

Enabling GitHub private vulnerability reporting is a required pre-public-release repository setting; see [PUBLIC-RELEASE-CHECKLIST.md](./docs/PUBLIC-RELEASE-CHECKLIST.md).

## Security boundaries contributors must preserve

- BIP-AI must not receive social-account credentials from PAG.
- External transports such as WhatsApp must not pass session keys, cookies, phone/JID identifiers, or device credentials into persistent BIP-AI state.
- Campaign approval is bound to the exact current `version + contentHash`.
- Editing approved content invalidates the prior approval and handoff state.
- External model providers receive only privacy-`PASS` campaign material.
- Provider/API secrets must remain outside prompts, campaign state, editorial exports, logs, and error metadata.
- The Control Room is localhost-first and is not an internet-facing authentication boundary.
- Privacy `BLOCK` must stop draft generation; `REVIEW` must remain human-gated.
- A PAG failure or denial must fail closed; BIP-AI must not bypass PAG with a direct publishing path.

## Response process

The maintainer will validate the report, assess affected versions, develop a fix in a private context when necessary, add regression coverage, and coordinate disclosure after users have a reasonable upgrade path.
