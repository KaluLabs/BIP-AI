# External and WhatsApp update adapters

BIP-AI accepts deliberate non-Git project signals through a transport-neutral external-update contract. A WhatsApp bridge can use this contract, but BIP-AI does not own the WhatsApp session, QR login, device keys, or account credentials.

## Update shape

```json
{
  "projectId": "bip-ai",
  "transport": "whatsapp",
  "messageId": "transport-message-id",
  "kind": "hardware_purchase",
  "text": "Bought a Raspberry Pi 5 for the prototype",
  "occurredAt": "2026-09-27T01:00:00.000Z",
  "privacy": "PASS"
}
```

Supported real-world kinds include `hardware_purchase`, `device_change`, `physical_task`, `deployment`, `meeting`, `feature`, `decision`, `learning`, `milestone`, and `note`.

For quick manual/WhatsApp updates, the text may carry a tag instead of `kind`, for example:

```text
#hardware Bought a Raspberry Pi 5
#device Switched the build machine
#physical Finished assembling the enclosure
#meeting Met a collaborator about the prototype
#deploy Put the first version on the test server
```

Plain untagged notes stay low-signal unless additional context raises their storyworthiness.

## Local bridge API

When the Control Room service is running, a trusted local transport process can submit an update to:

```text
POST /api/adapters/external/events
Content-Type: application/json
X-BIPAI-CSRF: 1
```

Example:

```bash
curl -X POST http://127.0.0.1:8790/api/adapters/external/events \
  -H 'Content-Type: application/json' \
  -H 'X-BIPAI-CSRF: 1' \
  -d '{"projectId":"bip-ai","transport":"whatsapp","messageId":"m-123","text":"#hardware Bought a Raspberry Pi 5"}'
```

The endpoint inherits the Control Room's localhost-first security boundary. A future Baileys or official WhatsApp bridge should run as a separate adapter and call this contract; it should never pass session credentials, phone numbers, JIDs, cookies, or device keys into BIP-AI.

BIP-AI hashes `messageId` into a short source reference for deterministic identity/deduplication and does not retain the raw message ID. Unknown transport-specific fields are ignored.

The same contract is available from the CLI:

```bash
node ./src/cli.js external emit ./update.json
```

## Approved WhatsApp Status output

BIP-AI can export an **approved-content package** for a separate Status Manager:

```bash
node ./src/cli.js status export <campaignId> ./status-package.json
```

Export is refused unless the campaign is privacy `PASS`, quality `PASS`, explicitly approved, and the approval matches the current `version + contentHash`.

The package contains the exact approved X-style short posts, LinkedIn-style long text, referenced assets, and provenance IDs. It contains no WhatsApp credential and does not publish anything by itself.

This keeps the boundary explicit:

`WhatsApp/manual transport -> ProjectEvent -> BIP-AI editorial/approval -> approved content package -> optional Status Manager`
