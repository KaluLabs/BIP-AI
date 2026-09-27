import { sha256 } from '../core.js';

const KIND_TO_EVENT_TYPE = Object.freeze({
  hardware_purchase: 'hardware',
  hardware: 'hardware',
  device_change: 'device',
  device: 'device',
  physical_task: 'physical',
  physical: 'physical',
  deployment: 'deployment',
  meeting: 'meeting',
  feature: 'feature',
  decision: 'decision',
  learning: 'learning',
  milestone: 'milestone',
  note: 'note'
});

const TAGS = new Map([
  ['hardware', 'hardware_purchase'],
  ['device', 'device_change'],
  ['physical', 'physical_task'],
  ['deploy', 'deployment'],
  ['deployment', 'deployment'],
  ['meeting', 'meeting'],
  ['feature', 'feature'],
  ['decision', 'decision'],
  ['learning', 'learning'],
  ['milestone', 'milestone'],
  ['note', 'note']
]);

export function parseUpdateText(text, fallbackKind = 'note') {
  const value = String(text ?? '').trim();
  if (!value) throw new TypeError('update text is required');
  const tagged = value.match(/^(?:#|\/)?([a-z][a-z_-]{1,30})\s*(?::|-)?\s+(.+)$/i);
  if (tagged) {
    const kind = TAGS.get(tagged[1].toLowerCase());
    if (kind) return { kind, text: tagged[2].trim() };
  }
  return { kind: fallbackKind, text: value };
}

export function externalUpdateToProjectEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('external update must be an object');
  const projectId = String(input.projectId ?? '').trim();
  const transport = String(input.transport ?? 'manual').trim().toLowerCase();
  if (!projectId) throw new TypeError('projectId is required');
  if (!['manual', 'whatsapp', 'api', 'cli'].includes(transport)) throw new TypeError(`unsupported external update transport: ${transport}`);

  const parsed = parseUpdateText(input.text, String(input.kind ?? 'note').trim().toLowerCase());
  const kind = String(input.kind ?? parsed.kind).trim().toLowerCase();
  const type = KIND_TO_EVENT_TYPE[kind];
  if (!type) throw new TypeError(`unsupported external update kind: ${kind}`);

  const sourceMessageId = input.messageId == null ? null : String(input.messageId);
  const sourceRef = sourceMessageId ? sha256(`${transport}:${projectId}:${sourceMessageId}`).slice(0, 24) : null;
  const occurredAt = String(input.occurredAt ?? new Date().toISOString());
  const id = sourceRef ? `ext_${sourceRef}` : undefined;

  return {
    ...(id ? { id } : {}),
    projectId,
    type,
    summary: parsed.text,
    details: typeof input.details === 'string' && input.details.trim() ? input.details.trim() : null,
    source: `external:${transport}`,
    occurredAt,
    importance: String(input.importance ?? 'normal').trim().toLowerCase(),
    userVisible: input.storySignal === false ? false : true,
    implementation: Array.isArray(input.implementation) ? input.implementation : [],
    decisions: Array.isArray(input.decisions) ? input.decisions : [],
    lessons: Array.isArray(input.lessons) ? input.lessons : [],
    outcomes: Array.isArray(input.outcomes) ? input.outcomes : [],
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    assets: Array.isArray(input.assets) ? input.assets : [],
    nextStep: typeof input.nextStep === 'string' ? input.nextStep : null,
    privacy: String(input.privacy ?? 'PASS').trim().toUpperCase(),
    metadata: {
      externalUpdate: {
        transport,
        kind,
        sourceRef,
        submittedAsStorySignal: input.storySignal !== false
      }
    }
  };
}

export function whatsappUpdateToProjectEvent(input) {
  return externalUpdateToProjectEvent({ ...input, transport: 'whatsapp' });
}

export function ingestExternalUpdate(app, input) {
  if (!app || typeof app.ingest !== 'function') throw new TypeError('BIP-AI application is required');
  return app.ingest(externalUpdateToProjectEvent(input));
}
