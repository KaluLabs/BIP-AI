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
- [ ] Resolve GitHub-hosted Actions jobs failing before `Set up job`.
- [ ] Obtain a green GitHub-hosted or trusted self-hosted CI run for the final public-release commit.
- [ ] Require the green CI check in default-branch protection.

The current GitHub-hosted failure produces a job object with no steps and no log URL, so it occurs before repository test commands execute. Check GitHub account Actions usage/budget and repository Actions settings before changing application code to chase this failure.

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
