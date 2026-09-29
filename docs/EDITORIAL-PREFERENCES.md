# Editorial preferences

BIP-AI learns how an operator prefers project updates to be written without turning style learning into factual memory or publishing authority.

## Scope

Preference state is local and project-scoped. BIP-AI currently keeps the global/default layer disabled (`globalDefaultsEnabled: false`), so one project's editing history cannot influence another project.

Supported signals are intentionally bounded:

- X: preferred length band, opening style, CTA use, thread density, and formality.
- LinkedIn: preferred length band, opening style, CTA use, paragraph density, and formality.

Each learned value carries confidence and evidence counts.

## What is learned

The learner derives signals from:

1. campaign-version changes that look like operator edits rather than a contemporaneous generated rewrite; and
2. explicit campaign approvals, which receive stronger weight because they represent accepted final style.

Preference evidence stores only project/campaign/version references, content hashes, signal names, bounded observed values, weights, and timestamps. It does **not** store copies of historical draft text.

Only privacy-`PASS` campaign versions contribute learning evidence. REVIEW/BLOCK material is not learned.

## What is not learned

Editorial preferences never become a source of factual claims. They do not contain or infer project facts, metrics, names, outcomes, credentials, transport identifiers, account tokens, or social-session material.

Preferences cannot:

- mark privacy PASS;
- approve a campaign;
- create PAG authority;
- publish content;
- expand the drafting claim allow-list.

Project Events and narrative memory remain the factual/evidence boundary. PAG remains the action boundary.

## Drafting behavior

New campaigns and explicit draft regeneration receive the current project profile when learning is enabled.

Safe deterministic effects are deliberately narrow. The current implementation may suppress an unwanted `Next:` CTA or reduce an X thread to a learned density. It may remove already sourced claims from a draft, but it does not paraphrase or invent claims.

External drafting providers receive only the bounded style hints in addition to the existing privacy-PASS StoryBrief and source-addressable allowed claims. Provider output still has to pass the existing structural and exact-claim validation.

## Controls

CLI:

```bash
bip-ai preferences show <projectId>
bip-ai preferences rebuild <projectId>
bip-ai preferences disable <projectId>
bip-ai preferences enable <projectId>
bip-ai preferences reset <projectId>
```

Control Room API:

```text
GET  /api/projects/:projectId/editorial-preferences
POST /api/projects/:projectId/editorial-preferences/rebuild
POST /api/projects/:projectId/editorial-preferences/disable
POST /api/projects/:projectId/editorial-preferences/enable
POST /api/projects/:projectId/editorial-preferences/reset
```

POST mutations require the normal same-origin `X-BIPAI-CSRF: 1` header.

Disabling learning preserves the existing inspectable profile but stops it from affecting drafts and excludes activity during the disabled interval from future learning. Re-enabling does not retroactively learn that interval.

Reset moves the learning boundary forward without deleting or rewriting immutable campaign-version history. New evidence after the reset can build a fresh profile.
