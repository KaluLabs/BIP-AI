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


test('dashboard shell is served with browser hardening headers', async () => {
  const f=await fixture();
  try {
    const response=await fetch(`${f.base}/`); const html=await response.text();
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')||'',/text\/html/);
    assert.equal(response.headers.get('x-frame-options'),'DENY');
    assert.match(response.headers.get('content-security-policy')||'',/default-src 'self'/);
    assert.match(html,/BIP-AI Control Room/);
  } finally { await new Promise(r=>f.server.close(r)); f.store.close(); }
});


test('external transport can submit a privacy-safe update through the local adapter endpoint', async () => {
  const root=mkdtempSync(join(tmpdir(),'bip-http-ext-'));
  const store=new BipStore(':memory:'); const projects=new ProjectRegistry(join(root,'projects.json')); projects.add({id:'bip-ai',path:root});
  const app=new BipAI({store}); const server=createBipServer({store,projects,app}); const listening=await listenBipServer(server,{port:0});
  try {
    const input={projectId:'bip-ai',transport:'whatsapp',messageId:'sensitive-message-id',phone:'sensitive-phone',jid:'sensitive-jid',kind:'hardware_purchase',text:'Bought a Raspberry Pi',occurredAt:'2026-09-27T00:00:00.000Z'};
    const {response,body}=await jsonFetch(`${listening.url}/api/adapters/external/events`,{method:'POST',headers:{'content-type':'application/json','x-bipai-csrf':'1'},body:JSON.stringify(input)});
    assert.equal(response.status,201); assert.equal(body.accepted,true); assert.ok(body.campaign);
    assert.doesNotMatch(JSON.stringify(body),/sensitive-message-id|sensitive-jid|sensitive-phone/);
  } finally { await new Promise(r=>server.close(r)); store.close(); }
});


test('project GitHub source can be configured and cleared through CSRF-protected API', async () => {
  const f=await fixture();
  try {
    const denied=await jsonFetch(`${f.base}/api/projects/bip-ai/github`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({repository:'victorkay97/BIP-AI',visibility:'private'})
    });
    assert.equal(denied.response.status,403);

    const configured=await jsonFetch(`${f.base}/api/projects/bip-ai/github`,{
      method:'POST',
      headers:{'content-type':'application/json','x-bipai-csrf':'1'},
      body:JSON.stringify({repository:'victorkay97/BIP-AI',visibility:'private',token:'do-not-store'})
    });
    assert.equal(configured.response.status,200);
    assert.deepEqual(configured.body.project.github,{repository:'victorkay97/BIP-AI',visibility:'private'});
    assert.doesNotMatch(JSON.stringify(configured.body),/do-not-store/);

    const invalid=await jsonFetch(`${f.base}/api/projects/bip-ai/github`,{
      method:'POST',
      headers:{'content-type':'application/json','x-bipai-csrf':'1'},
      body:JSON.stringify({repository:'not a repository',visibility:'private'})
    });
    assert.equal(invalid.response.status,400);
    assert.match(invalid.body.error,/owner\/repo/);

    const cleared=await jsonFetch(`${f.base}/api/projects/bip-ai/github/clear`,{
      method:'POST',
      headers:{'content-type':'application/json','x-bipai-csrf':'1'},
      body:'{}'
    });
    assert.equal(cleared.response.status,200);
    assert.equal(cleared.body.project.github,undefined);
  } finally { await new Promise(r=>f.server.close(r)); f.store.close(); }
});
