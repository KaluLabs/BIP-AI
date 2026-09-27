# ADR 0002: Bind approval and handoff to immutable campaign content

- Status: Accepted
- Date: 2026-09-27

## Context

A human may approve one draft while the campaign is later edited. Reusing the prior approval for changed content would make the review meaningless.

## Decision

Every editorial change creates a new campaign version and content hash. Campaign approval records the exact `version + contentHash`.

Editing an approved campaign invalidates its prior approval and resets PAG handoff state. A PAG request or reconciliation operation must match the current approved version and hash.

## Consequences

Approval cannot silently survive content changes. Users may need to re-approve small edits, but the approved payload remains auditable and unambiguous.
