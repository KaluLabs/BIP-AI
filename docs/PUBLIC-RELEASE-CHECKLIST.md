# Public release checklist

BIP-AI should not be switched to a public repository until every blocking item below is resolved.

## Legal

- [ ] Explicitly choose an open-source license.
- [ ] Add the canonical `LICENSE` file.
- [ ] Add the selected SPDX/license identifier to package metadata.
- [ ] Review third-party dependency/action licenses for compatibility.

## Security and repository settings

- [x] Add SECURITY.md.
- [x] Add contributor and conduct policies.
- [x] Add issue and pull-request templates.
- [x] Add CODEOWNERS.
- [x] Add dependency/update policy and Dependabot configuration.
- [ ] Enable GitHub private vulnerability reporting before inviting public security reports.
- [ ] Enable default-branch protection/rules requiring CI before merge.

### Current branch-protection blocker

GitHub currently returns: `Upgrade to GitHub Pro or make this repository public to enable this feature.` when repository rulesets are queried for this private repository. Protection must therefore be enabled after the repository becomes public or after upgrading the account plan.

## CI

- [x] CI workflow exists.
- [x] Full suite passes in local Node.js 22 verification for the functional stack.
- [x] Trusted BIP-AI self-hosted runner is configured and executing repository jobs.
- [x] Aggregate PR verification passed on the self-hosted runner.
- [x] Post-merge `main` push verification passed on the self-hosted runner.
- [ ] Require the green CI check in default-branch protection once repository protections are available.

### Hosted-runner note

GitHub-hosted jobs previously failed before `Set up job`, returning no steps or job logs. The repository workflow/application was ruled out by successful execution of the same workflow on the BIP-AI self-hosted runner. The hosted-runner anomaly is therefore not a blocker for current CI integrity.

The active self-hosted workflow verifies:

1. checkout;
2. Node.js 22+ on the runner;
3. npm availability;
4. the full `npm test` suite.

## Documentation and release

- [x] Architecture/trust-boundary ADRs exist.
- [x] Release/versioning policy exists.
- [x] Changelog exists.
- [x] Reproducible contributor setup is documented.
- [ ] Update the changelog with the first release version/date.
- [ ] Set package version for the first release.
- [ ] Create the first signed/annotated release tag and GitHub release notes.
- [ ] Decide separately whether BIP-AI will be published to a package registry.

## Final exposure review

- [ ] Scan the full Git history and working tree for secrets/private files.
- [ ] Confirm no local `.bipai/`, SQLite state, `.env`, PAG tokens, AI-provider keys, or WhatsApp session material exists in Git history.
- [ ] Confirm README links and public issue/security routes work after visibility changes.
