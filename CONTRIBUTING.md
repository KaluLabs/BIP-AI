# Contributing to BIP-AI

Thank you for helping improve BIP-AI.

## Development requirements

- Node.js 22.5 or newer
- Git
- No external database is required; BIP-AI uses local SQLite through Node.js
- PAG and an AI provider are optional for most development

## Local setup

```bash
git clone https://github.com/victorkay97/BIP-AI.git
cd BIP-AI
npm test
```

To exercise the CLI with local state:

```bash
cp .env.example .env
node ./src/cli.js event emit ./examples/project-event.json
node ./src/cli.js campaigns list
node ./src/cli.js serve
```

Never commit `.env`, `.bipai/`, SQLite files, PAG actor tokens, model-provider keys, WhatsApp session material, cookies, or account credentials.

## Before opening a pull request

1. Keep changes focused and explain the security/trust-boundary impact.
2. Add or update tests for behavior changes.
3. Run `npm test`.
4. Do not weaken privacy `PASS / REVIEW / BLOCK` behavior, campaign content-hash binding, or PAG approval requirements.
5. Do not add direct social-account credentials or autonomous publishing paths to BIP-AI core.
6. Update architecture/ADR documentation when changing a trust boundary.

## Pull requests

Use the pull request template. PRs should state what changed, how it was verified, and whether the change affects privacy, credentials, approvals, external transports, or publishing authority.

Small changes are preferred over broad unrelated refactors.

## Commit style

Conventional-style prefixes are encouraged: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, and `security:`.

## Security issues

Do not disclose suspected vulnerabilities, credentials, tokens, session material, or exploit details in a public issue. Follow [SECURITY.md](./SECURITY.md).
