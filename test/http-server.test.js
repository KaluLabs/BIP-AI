import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { ProjectRegistry } from '../src/projects.js';
import { createBipServer, listenBipServer } from '../src/http-server.js';

async function fixture() {
  const root=mkdtempSync(join(tmpdir(),'bip-http-'));
  const store=new BipStore(':memory:'); const projects=new ProjectRegistry(join(root,'projects.json')); projects.add({id:'bip-ai',path:root});
  const app=new BipAI({store}); const seeded=app.ingest({projectId:'bip-ai',type:'feature',summary:'Dashboard',details:'Added local dashboard',userVisible:true,occurredAt:'2026-09-27T00:00:00.000Z'});
  const server=createBipServer({store,projects,safeConfig:{draftProvider:'deterministic',pagConfigured:true}}); const listening=await listenBipServer(server,{port:0});
  return {store,projects,campaign:seeded.campaign,server,base:listening.url};
}

async function jsonFetch(url, options={}) { const response=await fetch(url,options); return {response,body:await response.json()}; }

test('health and safe config are readable without secrets', async () => {
  const f=await fixture();
  try {
    const health=await jsonFetch(`${f.base}/api/health`); assert.equal(health.body.ok,true);
    const config=await jsonFetch(`${f.base}/api/config`); assert.equal(config.body.draftProvider,'deterministic'); assert.doesNotMatch(JSON.stringify(config.body),/token|apiKey|secret/i);
  } finally { await new Promise(r=>f.server.close(r)); f.store.close(); }
});

test('event timeline includes storyworthiness and privacy evaluation', async () => {
  const f=await fixture();
  try { const {body}=await jsonFetch(`${f.base}/api/events?projectId=bip-ai`); assert.equal(body.events[0].evaluation.eligible,true); assert.equal(body.events[0].privacy.result,'PASS'); }
  finally { await new Promise(r=>f.server.close(r)); f.store.close(); }
});

test('campaign detail includes immutable version history', async () => {
  const f=await fixture();
  try { const {body}=await jsonFetch(`${f.base}/api/campaigns/${f.campaign.id}`); assert.equal(body.campaign.id,f.campaign.id); assert.equal(body.versions.length,1); }
  finally { await new Promise(r=>f.server.close(r)); f.store.close(); }
});

test('mutations require CSRF header', async () => {
  const f=await fixture();
  try { const {response}=await jsonFetch(`${f.base}/api/campaigns/${f.campaign.id}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); assert.equal(response.status,403); }
  finally { await new Promise(r=>f.server.close(r)); f.store.close(); }
});

test('campaign can be approved through same-origin mutation contract', async () => {
  const f=await fixture();
  try {
    const {response,body}=await jsonFetch(`${f.base}/api/campaigns/${f.campaign.id}/approve`,{method:'POST',headers:{'content-type':'application/json','x-bipai-csrf':'1'},body:'{}'});
    assert.equal(response.status,200); assert.equal(body.campaign.editorialStatus,'approved_for_handoff'); assert.equal(body.campaign.campaignApproval.contentHash,body.campaign.contentHash);
  } finally { await new Promise(r=>f.server.close(r)); f.store.close(); }
});
