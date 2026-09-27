## What changed

Describe the change and why it is needed.

## Verification

- [ ] `npm test` passes locally
- [ ] New/changed behavior has test coverage where practical
- [ ] Documentation is updated where needed

## Trust-boundary review

- [ ] No secrets, credentials, sessions, cookies, phone/JID identifiers, or private tokens are committed
- [ ] Privacy PASS / REVIEW / BLOCK behavior remains correct
- [ ] Campaign approval remains bound to the exact current version + contentHash
- [ ] No direct publishing path bypasses PAG
- [ ] External provider/transport data exposure was reviewed
- [ ] Any architecture/security-boundary change has an ADR or documentation update

## Notes for reviewers

Call out migrations, compatibility concerns, stacked-PR dependencies, or manual verification steps.
