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
