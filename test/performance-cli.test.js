import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {BipStore} from '../src/store.js';
import {BipAI} from '../src/pipeline.js';
import {approveCampaign} from '../src/editorial.js';

test('performance CLI imports JSON and lists exact-linked snapshots',()=>{
  const root=mkdtempSync(join(tmpdir(),'bip-performance-cli-'));
  const db=join(root,'bip.sqlite');
  const input=join(root,'performance.json');
  const store=new BipStore(db);
  const app=new BipAI({store,storyThreshold:1});
  const result=app.ingest({
    projectId:'bip-ai',
    type:'feature',
    summary:'Performance CLI',
    userVisible:true,
    occurredAt:'2026-09-29T18:00:00.000Z'
  });
  const campaign=approveCampaign(result.campaign);
  store.updateCampaignState(campaign);
  store.close();

  writeFileSync(input,JSON.stringify({
    platform:'x',
    campaignId:campaign.id,
    campaignVersion:campaign.version,
    contentHash:campaign.contentHash,
    observedAt:'2026-09-29T20:00:00.000Z',
    metrics:{views:321,clicks:8},
    source:{name:'fixture'}
  }));

  const env={...process.env,BIP_AI_DB:db};
  const imported=spawnSync(process.execPath,['./src/bip-ai.js','performance','import',input],{
    cwd:process.cwd(),env,encoding:'utf8'
  });
  assert.equal(imported.status,0,imported.stderr);
  const importBody=JSON.parse(imported.stdout);
  assert.equal(importBody.imported,1);
  assert.equal(importBody.linked,1);
  assert.equal(importBody.results[0].snapshot.source.type,'json');

  const listed=spawnSync(process.execPath,['./src/bip-ai.js','performance','list',campaign.id,'x'],{
    cwd:process.cwd(),env,encoding:'utf8'
  });
  assert.equal(listed.status,0,listed.stderr);
  const listBody=JSON.parse(listed.stdout);
  assert.equal(listBody.snapshots.length,1);
  assert.equal(listBody.snapshots[0].metrics.views,321);
});
