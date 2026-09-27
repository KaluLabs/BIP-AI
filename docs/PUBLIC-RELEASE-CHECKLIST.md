# Public release checklist

BIP-AI is a public Apache-2.0 repository. The v0.1.0 public-release hardening sequence is complete; this checklist now records the active release/security baseline used by v0.2.0.

## Legal and project metadata

- [x] Apache License 2.0 selected.
- [x] Canonical `LICENSE` committed.
- [x] Package metadata uses `Apache-2.0`.
- [x] Project attribution is documented in `NOTICE`.
- [x] Current dependency/action licensing is compatible with the project license.
- [x] npm/package-registry publication remains intentionally disabled with `private: true`.

BIP-AI currently has no third-party npm runtime/development dependencies. CI uses `actions/checkout` v7.0.1 pinned to the immutable official commit `3d3c42e5aac5ba805825da76410c181273ba90b1`.

## Repository security baseline

- [x] Repository visibility is public.
- [x] `SECURITY.md`, contributor policy, conduct policy, templates, CODEOWNERS, dependency policy, and Dependabot configuration are present.
- [x] Private vulnerability reporting was enabled during the v0.1.0 public-release sequence.
- [x] The active `main-protection` ruleset targets the default branch.
- [x] The ruleset requires pull requests.
- [x] The ruleset requires the green `test` status check.
- [x] Branch deletion and non-fast-forward updates are blocked by the ruleset.
- [x] No ruleset bypass actor is configured.

Before each release, verify that these controls still exist and have not been weakened.

## CI and distribution verification

The trusted self-hosted workflow verifies:

1. immutable checkout;
2. Node.js 22+ availability;
3. npm availability;
4. the complete `node --test` suite;
5. release-tree exposure auditing;
6. reproducible source-archive generation;
7. Docker packaged-runtime build and health;
8. persistent `/data` state across container and image replacement.

Required release-candidate commands:

```bash
npm test
npm run audit:release
npm run verify:distribution
```

A release candidate is not tag-ready until the same commit is green through the protected `main` workflow.

## Exposure review

Automated release-tree auditing fails when it finds:

- tracked `.env` files other than `.env.example`;
- tracked `.bipai`, SQLite/WAL, `node_modules`, generated `dist`, private-key, or certificate/key material;
- high-confidence GitHub, AWS, Slack, OpenAI-style, or private-key credential patterns;
- non-blank secret-bearing fields in `.env.example`;
- `package.json` without `private: true`.

The v0.1.0 retained-history exposure review remains part of the historical release record. v0.2.0 additionally gates the current release tree in CI.

## v0.1.0 release record

- [x] Changelog and release notes prepared.
- [x] Package version set to 0.1.0.
- [x] Public `v0.1.0` tag/release published on 2026-09-27.
- [x] npm publication excluded from the release.

## v0.2.0 release-candidate sequence

1. Complete BIP-009 through BIP-016.
2. Prove v0.1.0 persistent-state compatibility with an automated regression test.
3. Set package/runtime metadata to `0.2.0`.
4. Move shipped changelog entries into the dated `0.2.0` section.
5. Keep `docs/releases/v0.2.0.md` aligned with shipped behavior.
6. Run the full test suite, release-tree audit, and distribution verification in the release PR.
7. Merge only through protected `main`.
8. Require the post-merge `main` workflow to pass on the exact release-candidate commit.
9. Generate the source archive/checksum from that verified commit.
10. Review the release artifact manifest and checksum.
11. Only then create the immutable release tag and GitHub release.
12. Do not publish to npm unless a separate explicit decision approves that distribution boundary.

See [Release policy](./RELEASING.md), [Distribution and installation](./DISTRIBUTION.md), and [v0.2.0 release notes](./releases/v0.2.0.md).
