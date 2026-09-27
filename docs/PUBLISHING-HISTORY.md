# Publishing history and safe retries

BIP-AI keeps an append-only operational journal for every new PAG publishing handoff.

The journal records what exact campaign payload was handed off, what PAG returned, whether the outcome is retryable, and any later reconciliation receipt. It is intentionally separate from mutable campaign lifecycle state.

## Safety model

Publishing history does not weaken BIP-AI's existing approval boundary.

Every attempt is bound to:

- campaign ID;
- project ID;
- platform;
- exact campaign version;
- exact content hash;
- attempt number;
- PAG idempotency key.

Retries are permitted only when the **current campaign is still the same exact approved version/content hash** as the failed attempt.

A retry never silently upgrades an old failed attempt to a newer draft.

If the campaign changed after the failure, the operator must review and approve the new campaign version as a new payload.

## Append-only storage

BIP-AI creates a SQLite `publishing_journal` table.

The journal is append-only at the database layer. SQLite triggers reject both:

```text
UPDATE publishing_journal ...
DELETE FROM publishing_journal ...
```

A logical publishing attempt therefore accumulates immutable events such as:

- `attempt_started`;
- `pag_result`;
- `request_failed`;
- `reconciled`.

Campaign state can continue to change normally, but historical attempt rows are not rewritten.

## Attempt statuses

Journal events normalize PAG/transport state into operator-facing publishing statuses.

| Status | Meaning | Retry |
| --- | --- | --- |
| `requested` | BIP-AI durably recorded the handoff before calling PAG. | No |
| `accepted` | PAG accepted the intent and it is awaiting approval. | No |
| `handed_off` | PAG authorized/approved/is executing the intent. | No |
| `completed` | PAG reported successful execution. | No |
| `denied` | PAG explicitly denied the handoff. | **Never** |
| `retryable` | PAG failed/expired or a transient transport failure occurred. | Yes, if exact approval is still current |
| `failed` | Non-retryable failure. | No |

PAG denial is always terminal in BIP-AI. It is never automatically retried.

## Deterministic idempotency

The first attempt for one approved campaign/platform payload uses the existing content-bound key:

```text
bip-ai:<campaignId>:<platform>:v<version>:<contentHash>
```

Its logical BIP-AI attempt ID is deterministic for that same approved payload.

A safe retry is a deterministic child of the failed attempt.

The retry idempotency key adds a deterministic retry suffix derived from the failed attempt ID.

Consequences:

- clicking **Retry safely** twice for the same failed attempt does not create two logical retries;
- restarting BIP-AI and repeating the same retry request addresses the same logical child attempt;
- if that retry itself fails and is retryable, another retry must target that failed child attempt, creating the next link in the chain.

This gives BIP-AI an explicit attempt chain rather than an unbounded "retry current state" button.

## Retry eligibility

An attempt is retry-eligible only when all of these are true:

1. its latest journal state is marked retryable;
2. the campaign still exists at the exact recorded version;
3. the campaign content hash still matches;
4. the exact current campaign version is explicitly approved;
5. privacy is still `PASS`.

This means editorial changes, privacy decisions, draft regeneration, or any other version/content change automatically prevent reuse of an old publishing attempt.

The operator must approve the changed campaign as a new publishing payload.

## Manual and scheduled handoffs

Both publishing paths use the same journal service:

- manual Control Room/API handoff;
- due scheduled handoff.

A successful scheduled publication therefore produces the same publishing history as a manual publication.

Scheduling does not create a separate retry mechanism.

If a scheduled PAG handoff fails in a retryable way, the schedule/campaign shows failure and the operator can use the publishing history to perform a safe retry.

## PAG correlation and receipts

Journal entries may keep these non-secret correlation fields:

- PAG intent ID;
- PAG approval ID;
- PAG status;
- PAG args hash;
- minimal execution receipt summary.

BIP-AI does **not** copy PAG credentials or the raw publishing payload into the journal.

Receipt storage is intentionally minimal. Current fields are limited to:

- execution status;
- result mode;
- external result ID when PAG supplies one.

Raw PAG error bodies are not persisted.

## Transport failures

BIP-AI writes `attempt_started` **before** calling PAG.

If the PAG request throws, BIP-AI appends a failure event before returning the error to the caller.

Transient classes are retryable:

- network/transport error without an HTTP status;
- HTTP 408;
- HTTP 429;
- HTTP 5xx.

Other HTTP failures are recorded as non-retryable failures unless PAG itself returns a structured retryable intent state.

This guarantees that a failed outbound request still leaves a durable operational trace.

## Restart reconciliation

A PAG result can be reconciled after BIP-AI restarts because the journal persists the PAG intent ID.

Reconciliation:

1. loads the exact journal attempt;
2. fetches the current PAG intent/receipt by intent ID;
3. appends a new `reconciled` journal event;
4. updates campaign platform state **only if** the campaign still has the same version/content hash as that attempt.

If the campaign changed in the meantime, the historical attempt can still be reconciled and completed in the journal, but BIP-AI does not overwrite the newer campaign's state.

This preserves history without allowing old publishing activity to mutate new content.

## Crash window and idempotent recovery

BIP-AI records `attempt_started` before the PAG request.

If the process exits after PAG receives the request but before BIP-AI appends PAG's response, the journal still contains the deterministic attempt and idempotency key.

Repeating the same logical request reuses that same attempt/idempotency key rather than creating a new publish identity.

Once the PAG intent ID has been journaled, normal receipt reconciliation can resume after restart.

## Platform isolation

X and LinkedIn maintain independent attempt chains.

An X success is not changed if LinkedIn later fails or is retried.

Likewise, retrying a LinkedIn failure updates only the LinkedIn platform state.

## Control Room

Campaign detail contains a **Publishing history** section.

Each attempt shows:

- platform;
- attempt number;
- normalized status;
- exact campaign version/content-hash prefix;
- start time;
- PAG intent ID when available;
- retry ancestry;
- minimal receipt state;
- safe error code when applicable.

Controls:

- **Sync receipt** — reconcile a journaled PAG intent.
- **Retry safely** — shown only when that attempt is currently retry-eligible.

The retry button submits the current campaign version/content hash plus the exact failed attempt ID.

The server revalidates everything. A stale browser cannot force a retry.

## API

Campaign history:

```text
GET /api/campaigns/:campaignId/publishing-history
GET /api/campaigns/:campaignId/publishing-history?platform=x
GET /api/campaigns/:campaignId/publishing-history?platform=linkedin
```

Safe retry:

```text
POST /api/campaigns/:campaignId/publishing/:platform/retry
X-BIPAI-CSRF: 1
Content-Type: application/json

{
  "attemptId": "pub_...",
  "version": 1,
  "contentHash": "..."
}
```

Receipt reconciliation:

```text
POST /api/campaigns/:campaignId/publishing/:platform/reconcile
X-BIPAI-CSRF: 1
Content-Type: application/json

{
  "attemptId": "pub_..."
}
```

The existing handoff reconciliation route remains available. For post-BIP-014 journaled handoffs it resolves the relevant journal attempt and appends reconciliation history. Legacy handoffs created before the journal existed retain the old reconciliation fallback.

## Migration behavior

The schema change is backward-compatible.

Existing v0.1/v0.2 SQLite files gain the new table/indexes/triggers through `CREATE ... IF NOT EXISTS`.

Historical handoffs that predate BIP-014 are not fabricated into journal rows because BIP-AI cannot reliably reconstruct every old outbound attempt.

Those legacy campaign states remain readable and reconcilable through the existing compatibility path.

Complete append-only history begins with handoffs performed after BIP-014 is installed.
