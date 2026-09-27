import { sha256 } from './core.js';
import { applyEditorial, validateClaims, validateStructure } from './editorial.js';

export function allowedStoryClaims(storyBrief) {
  const claims = [];
  const add = (source, text) => {
    if (typeof text !== 'string' || !text.trim()) return;
    claims.push({ id: sha256(`${source}\n${text}`).slice(0, 16), source, text });
  };
  add('storyBrief.whatChanged', storyBrief.whatChanged);
  storyBrief.outcomes.forEach((text, i) => add(`storyBrief.outcomes[${i}]`, text));
  storyBrief.implementation.forEach((text, i) => add(`storyBrief.implementation[${i}]`, text));
  storyBrief.decisions.forEach((text, i) => add(`storyBrief.decisions[${i}]`, text));
  storyBrief.lessons.forEach((text, i) => add(`storyBrief.lessons[${i}]`, text));
  add('storyBrief.nextStep', storyBrief.nextStep);
  (storyBrief.narrativeContext || []).forEach((item, i) => add(`storyBrief.narrativeContext[${i}]`, item?.text));
  return claims;
}

function deterministicEditorial(campaign) {
  return {
    x: { posts: campaign.drafts.x.posts, claims: campaign.drafts.x.claims },
    linkedin: { text: campaign.drafts.linkedin.text, claims: campaign.drafts.linkedin.claims }
  };
}

export function validateGeneratedEditorial(editorial, storyBrief) {
  const structure = validateStructure(editorial);
  const claims = validateClaims(editorial, storyBrief);
  const valid = Object.values(structure).every((item) => item.result === 'PASS') &&
    Object.values(claims).every((item) => item.result === 'PASS');
  return { valid, structure, claims };
}

export async function regenerateCampaignDrafts(campaign, { provider = null, narrativeContext = null } = {}) {
  if (!campaign) throw new TypeError('campaign is required');
  const working = structuredClone(campaign);
  if (Array.isArray(narrativeContext)) working.storyBrief.narrativeContext = structuredClone(narrativeContext);
  const fallback = (reason = null) => {
    const next = applyEditorial(working, deterministicEditorial(working));
    next.draftGeneration = { mode: 'deterministic', provider: null, fallbackUsed: Boolean(reason), fallbackReason: reason, generatedAt: new Date().toISOString() };
    return { campaign: next, mode: 'deterministic', fallbackUsed: Boolean(reason), fallbackReason: reason };
  };

  if (!provider) return fallback(null);
  if (provider.external && working.privacyResult !== 'PASS') return fallback('privacy_not_pass');

  const allowedClaims = allowedStoryClaims(working.storyBrief);
  try {
    const generated = await provider.generate({
      storyBrief: structuredClone(working.storyBrief),
      allowedClaims: structuredClone(allowedClaims),
      formats: { x: 'thread', linkedin: 'professional-narrative' }
    });
    const validation = validateGeneratedEditorial(generated, working.storyBrief);
    if (!validation.valid) return fallback('provider_output_failed_validation');

    const next = applyEditorial(working, generated);
    next.draftGeneration = {
      mode: 'provider',
      provider: provider.name || 'custom',
      model: provider.model || null,
      fallbackUsed: false,
      generatedAt: new Date().toISOString()
    };
    return { campaign: next, mode: 'provider', fallbackUsed: false, validation };
  } catch (error) {
    return fallback(`provider_error:${safeErrorCode(error)}`);
  }
}

function safeErrorCode(error) {
  if (Number.isInteger(error?.status)) return `http_${error.status}`;
  if (error instanceof SyntaxError) return 'invalid_json';
  return 'generation_failed';
}

export class OpenAICompatibleDraftProvider {
  constructor({ baseUrl, apiKey, model, fetchImpl = globalThis.fetch } = {}) {
    if (!baseUrl) throw new Error('draft provider base URL is required');
    if (!apiKey) throw new Error('draft provider API key is required');
    if (!model) throw new Error('draft provider model is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.name = 'openai-compatible';
    this.external = true;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
  }

  async generate({ storyBrief, allowedClaims, formats }) {
    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ storyBrief, allowedClaims, formats }) }
        ]
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`draft provider HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new SyntaxError('draft provider returned no JSON content');
    return JSON.parse(stripFence(content));
  }
}

const SYSTEM_PROMPT = `You draft factual building-in-public updates. Return JSON only with shape {"x":{"posts":[string],"claims":[{"text":string,"source":string}]},"linkedin":{"text":string,"claims":[{"text":string,"source":string}]}}. Every factual claim entry must use an exact source and exact text from allowedClaims. Each claim text must appear verbatim in the corresponding draft. You may add non-factual connective wording, but never add metrics, outcomes, names, dates, capabilities, promises, or assertions not present in allowedClaims. Keep each X post at or below 280 characters.`;

function stripFence(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}
