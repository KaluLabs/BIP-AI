# Approval inbox

BIP-AI's approval inbox is the daily operational queue for campaign states that need human attention.

The inbox is **derived from campaign truth**. It does not maintain a separate mutable "resolved" flag that could drift from campaign, approval, schedule, or PAG state.

When the underlying state is resolved, the actionable item disappears from the inbox while the campaign/version history remains available.

## Attention categories

The inbox currently normalizes six categories:

| Category | Scope | Meaning |
| --- | --- | --- |
| `privacy_review` | campaign | Captured evidence is explicitly held at privacy `REVIEW`. |
| `stale_approval` | campaign | A previous approval no longer matches the current version/content hash. |
| `awaiting_approval` | campaign | Current PASS campaign version has not received exact campaign approval. |
| `handoff_denied` | platform | PAG denied the X or LinkedIn publishing handoff. |
| `handoff_failed` | platform | PAG publishing handoff failed and needs operator review. |
| `schedule_blocked` | platform | A planned/approval-failed schedule cannot proceed because current approval is missing or stale. |

Each campaign/category/platform combination is emitted at most once.

A campaign can legitimately have more than one item when the reasons are distinct. For example, an edited scheduled campaign can have:

- one campaign-level `stale_approval` item; and
- one X-specific `schedule_blocked` item.

That is not duplication: each item represents a different operational condition.

## Priority and age

Default ordering is:

1. privacy review — priority 100;
2. handoff failed/denied — priority 90;
3. blocked schedules — priority 80;
4. stale approvals — priority 70;
5. new drafts awaiting approval — priority 50.

Within equal priority, older items appear first.

The inbox also exposes explicit priority/age/attention-time sorting through its API.

## Exact-version actions

Every item carries:

- campaign ID;
- current campaign version;
- current content hash;
- originating event ID;
- project;
- platform when applicable;
- compact provenance preview.

Approval actions must submit the exact `version + contentHash` shown by the item.

If the campaign changes before the action reaches the server, the request fails with HTTP 409 and the operator must refresh the inbox.

This prevents stale browser state from approving a newer or different payload.

## Bulk approval

The Control Room supports bulk approval only for items that are already safe for campaign approval.

Eligible items are:

- `awaiting_approval`; or
- `stale_approval`;

and only when all existing approval invariants are satisfied:

- privacy is `PASS`;
- structural quality is `PASS`;
- editorial/claim quality is `PASS`;
- the exact campaign version/content hash still matches.

The server validates **every target first**. If one target is stale or invalid, no campaign in the request is approved.

Privacy review and publishing failure states are never bulk-converted into approval.

## Privacy review

Privacy review is intentionally separate from editorial approval.

A campaign with `privacyResult = REVIEW`:

- appears as `privacy_review`;
- cannot be approved by the normal campaign approval path;
- cannot become PASS merely because the draft was edited or regenerated.

The operator must open the campaign, enter a review note, and choose one explicit decision:

- **Mark privacy PASS**; or
- **Block publishing**.

That decision:

1. creates a new immutable campaign version;
2. records the previous REVIEW state, decision, note, and review time;
3. changes the campaign privacy result;
4. invalidates any approval/PAG handoff state;
5. recomputes the content hash.

A PASS decision then enters the ordinary exact campaign-approval queue. A BLOCK decision does not.

## Stale approval detection

BIP-AI detects stale approval in two ways.

If a current `campaignApproval` object exists but its version or content hash no longer matches the campaign, the inbox explains the mismatch directly.

If editorial/privacy changes already cleared the current approval, BIP-AI reads immutable campaign version history and finds the most recent valid approval from an older version.

This is why an edit after approval can still produce a clear message such as:

```text
campaign changed after approval of version 1
```

instead of degrading into a generic "not approved" state.

## PAG failure states

PAG denial and failure are platform-specific.

An X denial does not create a LinkedIn denial item, and vice versa.

Inbox items include the available non-secret action/approval IDs and current PAG status for operator context.

BIP-013 does **not** add an automatic retry button. Safe idempotent publishing retries are part of BIP-014 and must retain exact approval/content-hash binding.

## Schedule blocking

A planned schedule is actionable when it lacks a current exact approval.

The schedule item preserves:

- platform;
- UTC scheduled time;
- requested timezone;
- schedule status;
- last approval-related failure code when present.

Approving the current campaign version resolves the approval blocker without changing the planned content or schedule payload.

## Search, filters, and navigation

The inbox follows the v0.2 Control Room query conventions.

Supported filters include:

- search text;
- project;
- privacy;
- source;
- platform;
- current campaign/platform status;
- attention category;
- date range.

Every item navigates directly to its exact current campaign/version context.

The card also previews the originating ProjectEvent summary/source/time so the operator can see why the draft exists before approving it.

## API

Read:

```text
GET /api/approval-inbox
```

Query parameters:

```text
q
projectId
privacy
source
platform
status
category
from
to
sort
order
page
pageSize
```

Safe exact approval:

```text
POST /api/approval-inbox/approve
X-BIPAI-CSRF: 1
Content-Type: application/json

{
  "items": [
    {
      "campaignId": "...",
      "version": 2,
      "contentHash": "..."
    }
  ]
}
```

Explicit privacy decision:

```text
POST /api/approval-inbox/privacy/:campaignId
X-BIPAI-CSRF: 1
Content-Type: application/json

{
  "version": 2,
  "contentHash": "...",
  "decision": "PASS",
  "note": "Reviewed the evidence and confirmed it is safe to publish."
}
```

Privacy decisions accept only `PASS` or `BLOCK`.

## Relationship to BIP-014

BIP-013 defines the operational attention model that BIP-014 will build on.

BIP-014 adds the append-only publishing/handoff journal and safe retry controls. The inbox intentionally does not invent retry semantics ahead of that journal.
