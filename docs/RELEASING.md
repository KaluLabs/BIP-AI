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
8. verified approval/content-hash and PAG trust boundaries.

## Release procedure

1. Update `CHANGELOG.md` from **Unreleased** into the target version/date.
2. Update `package.json` version.
3. Run `npm test`.
4. Review the diff for secrets and generated local state.
5. Merge through the protected default branch once repository protections are available.
6. Create an annotated tag such as `v0.1.0`.
7. Create GitHub release notes from the changelog plus migration/security notes.
8. Keep npm/package-registry publication separate from the GitHub release unless package publication is explicitly adopted.

## Rollback

Do not rewrite released tags. If a release is defective, fix forward with a new patch release or mark the release as affected and document the safe version.
