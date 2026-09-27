# Drafting providers

BIP-AI is fully usable without an external model. The default writer is deterministic and uses only the structured StoryBrief.

Set `BIP_AI_DRAFT_PROVIDER=openai-compatible` only when you want an external OpenAI-compatible chat-completions provider. Then configure:

- `BIP_AI_DRAFT_BASE_URL`
- `BIP_AI_DRAFT_API_KEY`
- `BIP_AI_DRAFT_MODEL`

Run:

```bash
node ./src/cli.js draft regenerate <campaignId>
```

Draft regeneration always creates a new campaign version and therefore invalidates any older campaign approval or PAG handoff.

## Provenance rules

Before an external provider is called, BIP-AI creates a list of addressable allowed claims from the StoryBrief. Provider output must return claim records whose `source` and `text` exactly match those allowed claims, and the claim text must actually appear in the draft. Output that fails structural or provenance validation is discarded and replaced with the deterministic draft.

This first provider contract intentionally favors conservative factual grounding over unrestricted prose generation.

## Privacy and failure behavior

External providers are not called for campaigns whose privacy result is `REVIEW` or `BLOCK`. Provider errors, invalid JSON, unsupported claims, or invalid structure fail closed to the deterministic writer.

API keys are used only in the HTTP Authorization header. They are not included in the StoryBrief, provider prompt body, campaign state, editorial exports, or fallback error metadata.
