import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { allowedStoryClaims, OpenAICompatibleDraftProvider, regenerateCampaignDrafts } from '../src/drafting.js';

function campaign({ privacy = 'PASS' } = {}) {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  const result = app.ingest({
    projectId:'bip-ai', type:'feature', summary:'Added AI drafting',
    details:'Added a provider-neutral drafting layer', userVisible:true,
    implementation:['Added deterministic fallback'], decisions:['Keep claims source-bound'],
    nextStep:'Dogfood provider drafts', privacy, occurredAt:'2026-09-27T00:00:00.000Z'
  });
  store.close();
  return result.campaign;
}

test('allowed claims are stable and source-addressable', () => {
  const c = campaign();
  const claims = allowedStoryClaims(c.storyBrief);
  assert.ok(claims.length >= 4);
  assert.ok(claims.every((claim) => claim.id && claim.source.startsWith('storyBrief.')));
});

test('no provider uses deterministic fallback and creates a new version', async () => {
  const c = campaign();
  const result = await regenerateCampaignDrafts(c);
  assert.equal(result.mode, 'deterministic');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.campaign.version, 2);
});

test('valid provider output is accepted with provenance intact', async () => {
  const c = campaign();
  const provider = {
    name:'stub', model:'stub-1', external:false,
    async generate() { return { x: structuredClone(c.drafts.x), linkedin: structuredClone(c.drafts.linkedin) }; }
  };
  const result = await regenerateCampaignDrafts(c, { provider });
  assert.equal(result.mode, 'provider');
  assert.equal(result.campaign.draftGeneration.model, 'stub-1');
  assert.equal(result.campaign.qualityResult, 'PASS');
});

test('unsupported provider claims fall back instead of entering campaign content', async () => {
  const c = campaign();
  const provider = {
    name:'bad', external:false,
    async generate() { return { x:{posts:['We reached 1M users.'],claims:[{text:'We reached 1M users.',source:'storyBrief.outcomes[99]'}]}, linkedin:structuredClone(c.drafts.linkedin) }; }
  };
  const result = await regenerateCampaignDrafts(c, { provider });
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackReason, 'provider_output_failed_validation');
  assert.deepEqual(result.campaign.drafts.x.posts, c.drafts.x.posts);
});

test('external provider never receives REVIEW material', async () => {
  const c = campaign({ privacy:'REVIEW' });
  let called = false;
  const provider = { name:'external', external:true, async generate(){ called=true; return {}; } };
  const result = await regenerateCampaignDrafts(c, { provider });
  assert.equal(called, false);
  assert.equal(result.fallbackReason, 'privacy_not_pass');
});

test('provider failures fall back without exposing the error text', async () => {
  const c = campaign();
  const provider = { name:'external', external:true, async generate(){ const e=new Error('secret upstream detail'); e.status=503; throw e; } };
  const result = await regenerateCampaignDrafts(c, { provider });
  assert.equal(result.fallbackReason, 'provider_error:http_503');
  assert.doesNotMatch(JSON.stringify(result), /secret upstream detail/);
});

test('OpenAI-compatible provider keeps API key out of prompt/body', async () => {
  const c = campaign();
  let seen;
  const provider = new OpenAICompatibleDraftProvider({
    baseUrl:'https://provider.test/v1', apiKey:'super-secret-key', model:'draft-model',
    fetchImpl: async (url, options) => {
      seen={url,options};
      return { ok:true, status:200, async json(){ return { choices:[{message:{content:JSON.stringify({x:c.drafts.x,linkedin:c.drafts.linkedin})}}] }; } };
    }
  });
  const result = await regenerateCampaignDrafts(c, { provider });
  assert.equal(result.mode, 'provider');
  assert.equal(seen.options.headers.authorization, 'Bearer super-secret-key');
  assert.doesNotMatch(seen.options.body, /super-secret-key/);
  assert.equal(seen.url, 'https://provider.test/v1/chat/completions');
});
