# Public release checklist

BIP-AI should remain private until the pre-public checks are complete. Some GitHub security/protection features only become available on the current account configuration after the repository is made public, so the visibility change and those settings must be treated as one release sequence.

## Legal

- [x] Explicitly choose an open-source license: Apache License 2.0.
- [x] Add the canonical `LICENSE` file.
- [x] Add the selected SPDX/license identifier (`Apache-2.0`) to package metadata.
- [x] Add project attribution information in `NOTICE`.
- [x] Review current dependency/action licenses for compatibility.

Current inventory: BIP-AI has no third-party npm runtime/development dependencies. The active CI workflow uses `actions/checkout` v7.0.1, MIT-licensed and compatible with Apache-2.0, pinned to the immutable commit `3d3c42e5aac5ba805825da76410c181273ba90b1`.

## Security and repository settings

- [x] Add SECURITY.md.
- [x] Add contributor and conduct policies.
- [x] Add issue and pull-request templates.
- [x] Add CODEOWNERS.
- [x] Add dependency/update policy and Dependabot configuration.
- [ ] Change repository visibility from private to public.
- [ ] Immediately after visibility changes, enable GitHub private vulnerability reporting.
- [ ] Immediately after visibility changes, enable a default-branch ruleset/protection for `main` requiring pull requests and the green CI check.

### Visibility-dependent settings

GitHub private vulnerability reporting is available for **public repositories**. On the current private repository, it cannot be enabled in advance.

GitHub rulesets/protected branches are available for public repositories on GitHub Free; private repositories require GitHub Pro, Team, or Enterprise. GitHub currently returns `Upgrade to GitHub Pro or make this repository public to enable this feature.` for BIP-AI.

Therefore the safe order is:

1. finish all pre-public code/history checks;
2. make the repository public;
3. immediately enable private vulnerability reporting;
4. immediately protect `main` and require the CI check;
5. verify public-facing README/security/issue links.

## CI

- [x] CI workflow exists.
- [x] Full suite passes in local Node.js 22 verification for the functional stack.
- [x] Trusted BIP-AI self-hosted runner is configured and executing repository jobs.
- [x] Aggregate PR verification passed on the self-hosted runner.
- [x] Post-merge `main` push verification passed on the self-hosted runner.
- [x] Update checkout to v7.0.1 and verify it on the self-hosted runner.
- [x] Pin checkout v7.0.1 to its immutable official commit SHA.
- [ ] Require the green CI check in default-branch protection after the repository becomes public.

### Hosted-runner note

GitHub-hosted jobs previously failed before `Set up job`, returning no steps or job logs. The repository workflow/application was ruled out by successful execution of the same workflow on the BIP-AI self-hosted runner. The hosted-runner anomaly is therefore not a blocker for current CI integrity.

The active self-hosted workflow verifies:

1. checkout;
2. Node.js 22+ on the runner;
3. npm availability;
4. the full `npm test` suite.

## Documentation and first release

- [x] Architecture/trust-boundary ADRs exist.
- [x] Release/versioning policy exists.
- [x] Changelog exists.
- [x] Reproducible contributor setup is documented.
- [x] Prepare the changelog for version `0.1.0` dated 2026-09-27.
- [x] Package version is `0.1.0`.
- [x] Prepare first-release notes in `docs/releases/v0.1.0.md`.
- [x] Decide package-registry publication: **not part of v0.1.0**; keep `private: true`.
- [ ] Create the `v0.1.0` tag and GitHub release after the release-prep commit is on `main`.

## Exposure review

- [x] Scan every live branch head for sensitive filenames/local state.
- [x] Scan the retained pre-public development history for credential-shaped content and sensitive file additions/removals.
- [x] Separately scan the later release-prep, checkout-v7, and immutable-pin hardening commits added after the first history pass.
- [x] Confirm current `.env.example` secret values are blank.
- [x] Confirm `.gitignore` excludes `.env`, `.bipai/`, SQLite/WAL state, node_modules, and coverage.
- [x] Confirm no real private keys, GitHub/OpenAI/AWS/Slack credentials, PAG tokens, session stores, or similar sensitive artifacts were found.
- [x] Review the only secret-pattern hit: intentional fake unit-test value `super-secret-key`.
- [ ] Verify public README/security/issue links after visibility changes.

## Remaining release sequence

All pre-public repository work that can be completed while BIP-AI is private is done. The remaining actions are visibility-dependent GitHub repository settings and creation of the `v0.1.0` tag/release.
