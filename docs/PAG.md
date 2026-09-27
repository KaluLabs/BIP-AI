# Personal Access Gateway integration

BIP-AI treats PAG as the only boundary allowed to turn approved content into an external account action. BIP-AI never needs X or LinkedIn credentials.

## PAG-side setup

Run PAG v1, create an agent actor for BIP-AI, and grant only the capabilities you want BIP-AI to request.

```bash
node ./bin/pag.js actor create --name BIPAI
node ./bin/pag.js grant add --actor <ACTOR_ID> --capability x.threads.create --effect ask --priority 10
node ./bin/pag.js grant add --actor <ACTOR_ID> --capability linkedin.posts.create --effect ask --priority 10
```

Store the one-time actor token outside the repository and expose it to BIP-AI as `PAG_ACTOR_TOKEN`. `PAG_BASE_URL` defaults to `http://127.0.0.1:8787`.

If PAG connections are configured, set `BIP_AI_X_CONNECTION_ID` and/or `BIP_AI_LINKEDIN_CONNECTION_ID` to their non-secret connection IDs.

## BIP-AI-side flow

A campaign must first pass privacy/quality validation and be explicitly approved. Approval is bound to the exact campaign `version` and `contentHash`.

```bash
node ./src/cli.js campaigns approve <campaignId>
node ./src/cli.js request-x <campaignId>
node ./src/cli.js request-linkedin <campaignId>
node ./src/cli.js handoff status x <campaignId>
node ./src/cli.js handoff status linkedin <campaignId>
```

BIP-AI sends:

- X: `x.threads.create` with the exact approved `posts`
- LinkedIn: `linkedin.posts.create` with the exact approved `text`
- an idempotency key derived from campaign ID, platform, version, and content hash

If the campaign content changes, the previous BIP-AI approval and PAG handoff state are invalidated. A stale campaign version cannot submit or reconcile a PAG handoff.

PAG remains deny-first. A PAG `deny`, approval expiry, policy conflict, network failure, or payload conflict does not cause BIP-AI to bypass PAG or publish through another path.

## Compatibility note

Earlier Presence Agent prototypes used the actor label `presence-agent`. Standalone BIP-AI does not depend on that label: authentication is by the PAG actor token. Existing PAG environments can keep the old actor temporarily, but new installations should create a dedicated BIP-AI actor and least-privilege grants.
