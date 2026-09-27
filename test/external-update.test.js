import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { approveCampaign } from '../src/editorial.js';
import { externalUpdateToProjectEvent, ingestExternalUpdate, parseUpdateText, whatsappUpdateToProjectEvent } from '../src/adapters/external-update.js';
import { exportApprovedStatusPackage } from '../src/status-export.js';

test('tagged real-world updates map to meaningful event types', () => {
  assert.deepEqual(parseUpdateText('#hardware Bought a Raspberry Pi 5'), { kind:'hardware_purchase', text:'Bought a Raspberry Pi 5' });
  const event=externalUpdateToProjectEvent({projectId:'bip-ai',transport:'manual',text:'#hardware Bought a Raspberry Pi 5'});
  assert.equal(event.type,'hardware');
  assert.equal(event.source,'external:manual');
});

test('plain notes remain low-signal unless more context is supplied', () => {
  const store=new BipStore(':memory:'); const app=new BipAI({store});
  const result=ingestExternalUpdate(app,{projectId:'bip-ai',transport:'manual',text:'Remember to inspect the enclosure',storySignal:false,occurredAt:'2026-09-27T00:00:00.000Z'});
  assert.equal(result.campaign,null); assert.equal(result.reason,'below_story_threshold'); store.close();
});

test('WhatsApp message identity is deterministic but raw identifiers are not retained', () => {
  const input={projectId:'bip-ai',messageId:'sensitive-message-id',jid:'sensitive-jid',phone:'sensitive-phone',session:'sensitive-session',text:'#device Switched the build machine',occurredAt:'2026-09-27T00:00:00.000Z'};
  const first=whatsappUpdateToProjectEvent(input); const second=whatsappUpdateToProjectEvent(input);
  assert.equal(first.id,second.id); assert.equal(first.metadata.externalUpdate.sourceRef,second.metadata.externalUpdate.sourceRef);
  const serialized=JSON.stringify(first);
  assert.doesNotMatch(serialized,/sensitive-message-id|sensitive-jid|sensitive-phone|sensitive-session/);
});

test('same WhatsApp update is deduplicated by the core pipeline', () => {
  const store=new BipStore(':memory:'); const app=new BipAI({store});
  const input={projectId:'bip-ai',transport:'whatsapp',messageId:'m-1',kind:'hardware_purchase',text:'Bought a Raspberry Pi',occurredAt:'2026-09-27T00:00:00.000Z'};
  const first=ingestExternalUpdate(app,input); const second=ingestExternalUpdate(app,input);
  assert.equal(first.accepted,true); assert.ok(first.campaign); assert.equal(second.duplicate,true); assert.equal(store.listCampaigns().length,1); store.close();
});

test('privacy REVIEW from an external update remains review-gated', () => {
  const store=new BipStore(':memory:'); const app=new BipAI({store});
  const result=ingestExternalUpdate(app,{projectId:'bip-ai',transport:'whatsapp',messageId:'m-2',kind:'meeting',text:'Met a partner about the prototype',privacy:'REVIEW',occurredAt:'2026-09-27T00:00:00.000Z'});
  assert.equal(result.campaign.editorialStatus,'needs_review'); assert.equal(result.campaign.privacyResult,'REVIEW'); store.close();
});

test('WhatsApp Status export requires an exact current campaign approval', () => {
  const store=new BipStore(':memory:'); const app=new BipAI({store});
  const result=app.ingest({projectId:'bip-ai',type:'feature',summary:'Status package',details:'Added approved content export',userVisible:true,assets:[{type:'image',ref:'asset-1'}],occurredAt:'2026-09-27T00:00:00.000Z'});
  assert.throws(()=>exportApprovedStatusPackage(result.campaign),/not approved/);
  const approved=approveCampaign(result.campaign); const pkg=exportApprovedStatusPackage(approved);
  assert.equal(pkg.channel,'whatsapp-status'); assert.equal(pkg.contentHash,approved.contentHash); assert.deepEqual(pkg.content.shortPosts,approved.drafts.x.posts); assert.deepEqual(pkg.content.assets,approved.storyBrief.assets);
  approved.version += 1; assert.throws(()=>exportApprovedStatusPackage(approved),/stale/); store.close();
});
