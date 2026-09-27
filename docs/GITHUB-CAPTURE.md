# GitHub activity capture

BIP-AI can capture meaningful repository activity from GitHub in addition to local Git commits.

GitHub capture reuses the BIP-011 capture scheduler, durable cursor table, health model, replay semantics, and bounded retry/backoff behavior. It is a capture-only source: it cannot approve or publish content.

## Configure a project

A registered local project can optionally point at one GitHub repository.

CLI:

```bash
node ./src/cli.js projects github <projectId> <owner/repo> [public|private]
```

Examples:

```bash
node ./src/cli.js projects github bip-ai victorkay97/BIP-AI public
node ./src/cli.js projects github internal-agent my-org/internal-agent private
```

The visibility argument defaults to `private` if omitted.

Clear the source with:

```bash
node ./src/cli.js projects github-clear <projectId>
```

The Control Room exposes the same configuration under **GitHub source → Repository activity**.

Project configuration stores only:

```json
{
  "github": {
    "repository": "owner/repo",
    "visibility": "private"
  }
}
```

There is no token field in the project registry.

## Authentication

Configuration:

```dotenv
BIP_AI_GITHUB_TOKEN=
BIP_AI_GITHUB_API_BASE_URL=https://api.github.com
BIP_AI_GITHUB_POLL_MS=300000
```

Public repository activity can be queried without a token, subject to GitHub API limits.

For private repositories, set `BIP_AI_GITHUB_TOKEN` to a token that has read access to the configured repository and the activity being captured.

BIP-AI reads the token only when building the HTTP Authorization header. It is not copied into:

- `.bipai/projects.json`;
- SQLite capture cursors/health;
- ProjectEvents;
- campaign state;
- Control Room safe configuration responses.

The API base URL is configurable for compatible GitHub deployments.

## Captured activity

The initial BIP-012 source covers:

- pushed commits / pushed changes;
- pull request opened;
- pull request merged;
- issue closed;
- GitHub release published;
- completed GitHub Actions runs with `success` or `failure` conclusion.

Repository activity and Actions runs are separate GitHub API streams but share one BIP-AI source record.

The durable cursor therefore contains two checkpoints:

```json
{
  "repository": "owner/repo",
  "events": {
    "id": "repository-event-id",
    "etag": "..."
  },
  "workflows": {
    "key": "workflow-run-id:attempt:updated-at",
    "etag": "..."
  }
}
```

These are provenance/checkpoint identifiers, not credentials. The workflow key includes the run attempt and update timestamp so a GitHub Actions rerun can produce a new milestone even when GitHub reuses the same workflow-run ID.

## Evidence and data minimization

BIP-AI does not store complete GitHub API payloads.

Normalized events keep only the context needed for an evidence-backed building-in-public record, such as:

- repository name;
- GitHub event/run ID;
- issue or PR number;
- commit SHA or branch/ref when relevant;
- GitHub HTML URL;
- concise title/message needed to describe the activity.

Issue bodies, PR bodies, comments, logs, actor profiles, token data, and unrelated API payload fields are not copied into ProjectEvents.

Every GitHub-derived event gets a deterministic external ID. Event fingerprinting uses that source ID, so replay remains idempotent even if a mutable display field such as a PR title changes later.

## Privacy behavior

GitHub source visibility is conservative by default.

If the source is configured as `private`, every GitHub-derived ProjectEvent is explicitly marked:

```text
privacy = REVIEW
userVisible = false
```

That means the event can be retained as evidence and may create a review-required campaign, but it cannot become an approval-ready publishing candidate without human review.

Repository Events API items that explicitly report `public: false` are also forced to `REVIEW` even when the project was configured as public.

Public source configuration allows normal BIP-AI privacy evaluation to proceed, but the normal credential-pattern checks and approval gates still apply downstream.

## Polling and cursors

GitHub polling defaults to five minutes:

```dotenv
BIP_AI_GITHUB_POLL_MS=300000
```

The main capture scheduler can still wake every 60 seconds for local Git. A healthy GitHub source records its next allowed scan time and is skipped as `cadence` until that time.

GitHub response polling hints can make the interval longer.

The client uses conditional `ETag` requests. A `304 Not Modified` response produces no events and keeps the same source cursor.

### Initial scan

With no existing GitHub cursor, BIP-AI processes a bounded recent window from both GitHub streams and then learns forward.

This intentionally avoids copying an unbounded repository history on first connection.

### Cursor gaps

If a stored GitHub event/run ID can no longer be found within the bounded API window, BIP-AI performs a bounded recent recovery scan, marks the source `healthy_with_warning`, and relies on deterministic external-ID deduplication before establishing a fresh checkpoint.

## Rate limits and transient failures

GitHub API failures are normalized into safe operational codes such as:

- `github_rate_limited`;
- `github_auth_failed`;
- `github_forbidden`;
- `github_repository_unavailable`;
- `github_transient_error`;
- `github_network_error`.

Raw GitHub error bodies are not persisted.

When GitHub supplies a retry hint, the shared capture backoff uses it up to BIP-AI's configured retry ceiling. Otherwise the normal exponential capture backoff applies.

A GitHub failure does not roll back or corrupt the local Git source cursor, and a local Git failure does not prevent GitHub capture from being attempted for the same project.

## Capture controls

The normal BIP-AI capture controls include every configured source:

```bash
node ./src/cli.js capture run
node ./src/cli.js capture run <projectId>
node ./src/cli.js capture status
node ./src/cli.js capture start
```

A manual `capture run` forces an immediate attempt for both local Git and configured GitHub sources for the target project, while retaining deduplication and privacy safeguards.
