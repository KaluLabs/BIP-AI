# Dependency and update policy

BIP-AI intentionally keeps its trusted runtime surface small.

## Runtime dependencies

The core currently relies on Node.js built-ins, including `node:sqlite`, and does not require third-party npm runtime packages. New runtime dependencies need a clear functional reason and a review of maintenance activity, license compatibility, transitive dependency count, install scripts, network behavior, credential handling, and known security advisories.

A convenience dependency is not enough reason to enlarge the trusted runtime surface.

## Development dependencies

Development-only tools may be added when they materially improve testing, static analysis, formatting, or contributor experience. Prefer pinned major versions and reproducible configuration.

## Automated updates

Dependabot checks npm metadata and GitHub Actions monthly. Automated dependency PRs still require normal tests and review; they are not auto-merged by default.

## GitHub Actions

Pin marketplace actions to a maintained major tag at minimum. For a stable public release, prefer pinning security-sensitive third-party actions to immutable commit SHAs and document the update process.

## Security response

For a high-impact vulnerability in a dependency or action, prioritize a tested patch or removal over waiting for the normal monthly update cycle. If a dependency becomes abandoned, unnecessarily privileged, or incompatible with BIP-AI's trust model, replace or remove it.
