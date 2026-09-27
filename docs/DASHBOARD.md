# BIP-AI Control Room

The Control Room is BIP-AI's local operator dashboard. It uses the same SQLite state and application modules as the CLI; it is not a second backend.

## Start it

```bash
node ./src/cli.js serve
```

By default it listens on `http://127.0.0.1:8790`.

Environment settings:

- `BIP_AI_HOST` — defaults to `127.0.0.1`.
- `BIP_AI_PORT` — defaults to `8790`.
- `BIP_AI_ALLOW_REMOTE` — defaults to `0`. A non-loopback bind is refused unless this is explicitly set to `1`.
- `BIP_AI_SCHEDULE_POLL_MS` — defaults to `30000`. When PAG is configured, the local server checks due editorial schedules at this interval.
- `BIP_AI_CAPTURE_ENABLED` — defaults to enabled; set to `0` to disable automatic local capture while serving the Control Room.
- `BIP_AI_CAPTURE_POLL_MS` — defaults to `60000`.
- `BIP_AI_CAPTURE_BATCH_SIZE` — defaults to `50` source records per project/cycle.
- `BIP_AI_GITHUB_POLL_MS` — defaults to `300000` for configured GitHub sources.
- `BIP_AI_GITHUB_TOKEN` — optional environment-only GitHub token; the Control Room receives only a boolean indicating whether one is configured.

## What the dashboard exposes

- configured local project capture sources
- event timeline with storyworthiness and privacy results
- campaigns and immutable version history
- X and LinkedIn drafts
- exact `version + contentHash` approval state
- StoryBrief claim provenance
- deterministic/provider draft regeneration
- independent X and LinkedIn PAG handoff/reconciliation state
- a per-platform editorial calendar based on scheduled handoff times
- independent X and LinkedIn schedule/reschedule/clear controls
- lifecycle state for each platform: `drafted`, `approved`, `planned`, `handed_off`, `published`, or `failed`
- due/overdue schedule visibility
- URL-backed project/search/filter/sort state
- server-side pagination for event and campaign collections
- deterministic event/campaign sorting with stable ID tie-breaking
- per-project/per-source capture health, last success, cadence/retry state, checkpoints, and last scan counts
- GitHub source configuration for registered projects
- manual capture run control for the selected project or all projects

The dashboard may display local repository paths because it is an operator surface. It does not expose PAG actor tokens, drafting-provider API keys, or social-account credentials. `/api/config` returns only safe provider/configuration names, booleans, and non-secret scheduling settings.

## Editorial scheduling

Scheduling is **not publishing authority**.

A schedule records an absolute RFC3339 publication time and optional IANA timezone label independently for X and LinkedIn. The timestamp is stored in the existing campaign state, so it survives process restarts without a separate scheduling database.

Scheduling and rescheduling do **not** change campaign `version`, `contentHash`, or an existing exact-version approval because schedule metadata is not part of the publishing payload.

A content edit behaves differently:

- campaign version increments;
- content hash is recalculated;
- existing approval is invalidated;
- existing PAG handoff bindings are reset;
- a still-active `planned` schedule may remain visible;
- when that schedule becomes due, execution fails closed until the edited version is explicitly approved.

Schedules that were already handed off, published, or failed are not carried forward as active plans when content is edited.

## Due execution

When `PAG_ACTOR_TOKEN` is configured, the local Control Room server runs a lightweight due-schedule loop using `BIP_AI_SCHEDULE_POLL_MS`.

Before any scheduled handoff, BIP-AI re-checks the same invariants as a manual handoff:

1. privacy must be `PASS`;
2. structural/editorial quality must be `PASS`;
3. the campaign must be explicitly approved for handoff;
4. approval version and content hash must exactly match the current campaign;
5. PAG must accept the same content-bound handoff request.

The scheduler never receives social-account credentials and cannot bypass PAG.

If no PAG client is configured, automatic scheduled execution is disabled. Planned items remain visible and become due/overdue rather than being silently discarded.

If execution is attempted and approval/PAG validation fails, the platform schedule moves to `failed` with a non-secret failure code so it is actionable. Rescheduling creates a fresh `planned` attempt without changing content approval.

The API also exposes:

- `GET /api/schedules/due?at=<RFC3339>` — deterministic due queue for inspection/testing.
- `POST /api/schedules/run-due` — same-origin, CSRF-protected explicit due execution; PAG must be configured.
- `POST /api/campaigns/:id/schedule/x`
- `POST /api/campaigns/:id/schedule/linkedin`
- matching `.../clear` routes for removing a plan.

## Mutation protection

State-changing API requests require the custom `X-BIPAI-CSRF: 1` header. The bundled UI sends this header for same-origin mutations. The server also sends a restrictive Content Security Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

## Remote access

`BIP_AI_ALLOW_REMOTE=1` only permits the process to bind to a non-loopback interface. It is **not** a complete authentication or internet-exposure model.

For remote use, place BIP-AI behind a trusted authenticated reverse proxy, private VPN/tunnel, or equivalent access-control layer with HTTPS. Do not expose the Control Room directly to the public internet in its current form.


## Search, filters, and navigation

The Control Room stores its navigation state in the browser URL query string. A filtered view can therefore be bookmarked, refreshed, or restored with browser Back/Forward navigation.

Global filters include:

- project;
- free-text search;
- privacy state;
- source;
- campaign platform;
- campaign lifecycle/editorial status;
- date range.

Event and campaign sort/order/page state are independent, so moving through one collection does not reset the other.

### Event query API

`GET /api/events` accepts:

- `q`
- `projectId`
- `privacy=PASS|REVIEW|BLOCK`
- `source`
- `from` / `to`
- `sort=occurredAt|projectId|source|privacy`
- `order=asc|desc`
- `page`
- `pageSize` (1–100)

Event date filtering uses `occurredAt`.

### Campaign query API

`GET /api/campaigns` accepts:

- `q`
- `projectId`
- `privacy=PASS|REVIEW|BLOCK`
- `source` inherited from the originating ProjectEvent
- `platform=x|linkedin`
- `status`
- `from` / `to`
- `sort=updatedAt|createdAt|scheduledAt|projectId|privacy|status`
- `order=asc|desc`
- `page`
- `pageSize` (1–100)

When `sort=scheduledAt`, date filtering uses the selected platform's scheduled time (or the earliest scheduled platform when no platform is selected). When `sort=createdAt`, it uses campaign creation time. Other campaign sorts use `updatedAt` for date filtering.

Platform filtering scopes platform-specific status and schedule behavior. Current campaigns produce both X and LinkedIn drafts, so choosing a platform primarily scopes lifecycle/status/schedule interpretation rather than removing drafts for the other platform.

### Validation and pagination

Unknown query parameters, unsupported enum values, invalid date ranges, unsupported sort keys, and invalid pagination values return HTTP 400 rather than being silently ignored.

Responses contain both the collection and pagination metadata:

```json
{
  "events": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0,
    "hasPrevious": false,
    "hasNext": false
  },
  "query": {}
}
```

Campaign responses use the same `pagination` and `query` shape.

Stable sorting always uses the record ID as a deterministic tie-breaker, preventing records with equal primary sort values from jumping between pages.


## Automated capture in the Control Room

When automatic capture is enabled, `serve` starts the same restart-safe capture scheduler documented in [CAPTURE.md](./CAPTURE.md).

The **Capture health** panel shows one local Git source per registered project, including:

- current source health;
- last successful capture time;
- next retry time when degraded;
- last scan accepted/duplicate counts;
- the current abbreviated SHA checkpoint;
- safe failure code/summary when a source is unavailable.

The **Run now** control performs an explicit one-shot scan. When a project is selected by the global project filter it targets only that project; otherwise it scans all registered projects.

The Control Room never turns capture into publishing. Captured commits enter the same ProjectEvent/storyworthiness/privacy/editorial pipeline as manually emitted events. Approval and PAG remain separate downstream boundaries.


## GitHub source configuration

The Projects panel can associate a registered project with an `owner/repo` GitHub source and a visibility mode.

The visibility defaults to **Private / internal**. Private sources feed evidence into BIP-AI with `REVIEW` privacy rather than producing approval-ready drafts automatically.

The browser never receives `BIP_AI_GITHUB_TOKEN`. The safe config endpoint exposes only `githubTokenConfigured: true|false`, allowing the UI to indicate whether authenticated access is available without disclosing the credential.

GitHub capture health appears beside local Git health as a separate source. Its checkpoint shows the repository-event cursor and attempt-aware workflow cursor. Healthy GitHub sources may display a future **next scan** time; degraded sources display **next retry**.

See [GitHub activity capture](./GITHUB-CAPTURE.md) for event mappings, privacy behavior, cursor semantics, and authentication.


## Approval inbox

The Control Room includes an operational **Approval inbox** above the capture/event workspace.

It inherits the global search/project/privacy/source/platform/status filters and adds a URL-backed attention-category filter.

Inbox cards show:

- priority and age;
- attention category;
- project/platform;
- exact campaign version;
- actionable reason;
- blockers that prevent immediate approval;
- originating event provenance.

Approval-ready cards support exact-version single or bulk approval. The browser submits the rendered campaign version/content hash and stale actions fail closed.

Privacy REVIEW cards do not expose normal approval controls. Open the campaign to record an explicit privacy PASS/BLOCK decision with a required note.

PAG denied/failed cards are informational/action-routing items in BIP-013; safe retry controls arrive with BIP-014.

See [Approval inbox](./APPROVAL-INBOX.md) for the full state model and API contract.


## Publishing history and safe retries

Campaign detail includes an append-only **Publishing history** view for X and LinkedIn.

Each logical attempt shows its exact campaign version/content hash, normalized status, PAG intent correlation, retry ancestry, and minimal receipt/error context.

**Sync receipt** reconciles a journaled PAG intent without rewriting prior history.

**Retry safely** is rendered only when the server marks an attempt eligible. The browser sends the exact attempt ID plus the current rendered campaign version/content hash, and the server validates the approval again before any new PAG request.

Duplicate retry actions against the same failed attempt collapse onto the same deterministic child attempt/idempotency key.

PAG denial never receives a retry control.

See [Publishing history and safe retries](./PUBLISHING-HISTORY.md) for journal semantics, restart behavior, and the API contract.


## Narrative memory

When a single project is selected, the Control Room loads its derived narrative memory.

The panel shows story arcs, entry state/privacy, event-field provenance, and operator controls. REVIEW entries remain non-draftable; BLOCK source material is omitted entirely.

Archive/forget/restore mutations require the normal same-origin CSRF header and affect only derived memory. Immutable ProjectEvents and campaign history are not rewritten.

See [Project narrative memory](./NARRATIVE-MEMORY.md).
