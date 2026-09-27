# Project narrative memory

BIP-AI v0.3 introduces project-scoped narrative memory so current drafts can reference prior project milestones without turning generated prose into unsourced memory.

Narrative memory is **derived state**. The authoritative facts remain ProjectEvents, campaign versions, privacy decisions, and immutable publishing/editorial history.

## Trust model

Narrative memory preserves the existing BIP-AI boundaries:

- memory is isolated by `projectId`;
- every factual entry points back to a source ProjectEvent field;
- privacy `REVIEW` entries remain visible for inspection but are never draft-eligible;
- privacy `BLOCK` source material is omitted from narrative memory;
- only privacy-`PASS`, active entries can enter draft context;
- narrative memory cannot approve or publish content;
- PAG remains the external publishing authority;
- no social, WhatsApp, or provider credentials belong in narrative memory.

When a campaign resolves a captured privacy `REVIEW` to `PASS` or `BLOCK`, the derived-memory revision changes and the next memory read/rebuild uses the reviewed campaign privacy result.

## Data model

The SQLite store adds two backward-compatible tables:

- `narrative_memory` — one persisted derived memory snapshot per project;
- `narrative_memory_controls` — project-scoped archive/forget directives keyed by deterministic entry ID.

Existing v0.1/v0.2 event/campaign tables are not rewritten.

A memory snapshot contains:

- schema version;
- project ID;
- deterministic input revision;
- counts;
- story arcs;
- source-addressable entries.

Entry IDs are deterministic hashes of project, event, narrative kind, source field, and text.

Supported narrative kinds are:

- what changed;
- implementation;
- decisions;
- lessons;
- outcomes;
- next steps.

Each entry carries a source reference such as:

```json
{
  "type": "event",
  "id": "project-event-id",
  "path": "event.decisions[0]"
}
```

Campaign references are metadata about how the source event progressed through the editorial workflow; they are not substitute factual sources.

## Deterministic rebuild and staleness

BIP-AI computes the narrative revision from:

- project events;
- current campaign version/content hash/privacy/editorial/approval state;
- project-scoped narrative controls;
- narrative-memory schema version.

When the current source revision differs from the persisted revision, `getNarrativeMemory` rebuilds the derived snapshot before returning it.

The same unchanged source state produces the same narrative payload and revision.

## Draft context

When a new event becomes an eligible campaign, BIP-AI loads the **prior** project memory before saving the current event. This prevents the current event from appearing as its own historical context.

Only active, privacy-`PASS` entries are selected for `storyBrief.narrativeContext`.

Narrative claims use the same exact-text/source validation as ordinary StoryBrief claims. External providers therefore cannot turn narrative context into an unsupported factual statement.

Draft regeneration refreshes narrative context and excludes the campaign's own source event.

## Archive, forget, and restore

These controls affect only derived narrative memory. They do not rewrite immutable ProjectEvents or campaign history.

- **Archive** — keep the entry visible but remove it from draft-eligible context.
- **Forget** — suppress the entry from the derived memory payload.
- **Restore** — remove the archive/forget directive and re-derive the entry from authoritative source state.

Because the directive is project-scoped, an entry in one project cannot change another project's memory.

## CLI

```bash
node ./src/cli.js narrative show <projectId>
node ./src/cli.js narrative rebuild <projectId>
node ./src/cli.js narrative archive <projectId> <entryId>
node ./src/cli.js narrative forget <projectId> <entryId>
node ./src/cli.js narrative restore <projectId> <entryId>
```

## Local API

Read derived memory:

```text
GET /api/projects/:projectId/narrative-memory
```

Rebuild it:

```text
POST /api/projects/:projectId/narrative-memory/rebuild
X-BIPAI-CSRF: 1
```

Control an entry:

```text
POST /api/projects/:projectId/narrative-memory/:entryId/archive
POST /api/projects/:projectId/narrative-memory/:entryId/forget
POST /api/projects/:projectId/narrative-memory/:entryId/restore
X-BIPAI-CSRF: 1
```

All mutation routes use the same localhost-first/same-origin CSRF boundary as the rest of the Control Room.

## Control Room

Choose a single project with the global project filter.

The **Narrative memory** panel shows:

- story arcs;
- active/review/archived state;
- privacy state;
- event timestamp;
- exact event ID/source field provenance;
- archive/forget/restore controls;
- forgotten derived-entry controls;
- explicit rebuild action.

The panel intentionally does not show BLOCK-derived content.
