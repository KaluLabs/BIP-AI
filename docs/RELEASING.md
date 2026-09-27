# Release policy

BIP-AI uses Semantic Versioning tags in the form `vMAJOR.MINOR.PATCH`.

## Pre-1.0 policy

During `0.x`, the project is still stabilizing. Breaking changes may ship in a minor release, but every breaking change must be explicitly called out in the changelog and release notes.

## Release requirements

A release candidate should have:

1. a selected and committed open-source license;
2. the full test suite passing in a trusted CI environment;
3. no unresolved security-blocking issue;
4. current CHANGELOG entries;
5. documentation matching the shipped CLI/API behavior;
6. no committed secrets or local state;
7. reviewed migrations or compatibility notes for persistent state changes;
8. verified approval/content-hash and PAG trust boundaries;
9. `npm run audit:release` passing;
10. `npm run verify:distribution` passing;
11. reproducible source archive/checksum generated from the release commit.

## Release procedure

1. Update `CHANGELOG.md` from **Unreleased** into the target version/date.
2. Update `package.json` version.
3. Run `npm test`.
4. Run `npm run audit:release`.
5. Run `npm run verify:distribution`.
6. Build the checksummed source artifact with `BIP_AI_RELEASE_VERSION=<version> npm run dist`.
7. Re-run the artifact build from the same commit/version and confirm the SHA-256 digest is unchanged.
8. Review the diff for secrets and generated local state. `dist/` is generated and must not be committed.
9. Merge through the protected default branch.
10. Create an annotated tag such as `v0.2.0` at the verified release commit.
11. Rebuild `dist/` from the tagged commit and verify `SHA256SUMS.txt`.
12. Create the GitHub release using `docs/releases/v<version>.md` plus migration/security notes.
13. Attach `bip-ai-v<version>.tar.gz`, `SHA256SUMS.txt`, and `release-manifest.json` to the GitHub release.
14. If publishing a Docker image separately, build it from the same tagged commit with `BIP_AI_VERSION` and `BIP_AI_REVISION` set to the release identity.
15. Keep npm/package-registry publication disabled unless it is explicitly adopted through a separate decision.

## Rollback

Do not rewrite released tags. If a release is defective, fix forward with a new patch release or mark the release as affected and document the safe version.


## Distribution boundary

The commit-derived source archive is the reproducible release artifact of record. Docker is a supported packaged runtime, but image rebuilds can depend on external base-image and operating-system package repositories.

The package must remain `private: true` until npm/package-registry publication is explicitly approved.

See [Distribution and installation](./DISTRIBUTION.md) and [ADR 0004](./adr/0004-distribution.md).
