import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BipStore} from '../src/store.js';
import {BipAI} from '../src/pipeline.js';
import {approveCampaign} from '../src/editorial.js';
import {ProjectRegistry} from '../src/projects.js';

async function fixture(){
  const root=mkdtempSync(join(tmpdir(),'bip-performance-http-'));
  const db=join(root,'bip.sqlite');
  process.env.BIP_AI_DB=db;
  const store=new BipStore(db);
  const projects=new ProjectRegistry(join(root,'projects.json'));
  projects.add({id:'bip-ai',path:root});
  const app=new BipAI({store,storyThreshold:1});
  const result=app.ingest({
    projectId:'bip-ai',
    type:'feature',
    summary:'Performance HTTP',
    details:'Exercise outcome feedback API',
    userVisible:true,
    occurredAt:'2026-09-29T18:00:00.000Z'
  });
  const campaign=approveCampaign(result.campaign);
  store.updateCampaignState(campaign);

  await import('../src/editorial-preference-bootstrap.js');
  const {createBipServer,listenBipServer}=await import('../src/http-server.js');
  const server=createBipServer({store,projects,app,schedulePollMs:0});
  const listening=await listenBipServer(server,{port:0});
  return {root,db,store,server,base:listening.url,campaign};
}
async function jsonFetch(url,options={}){
  const response=await fetch(url,options);
  return {response,body:await response.json().catch(()=>({}))};
}
const mutation=body=>({
  method:'POST',
  headers:{'content-type':'application/json','x-bipai-csrf':'1'},
  body:JSON.stringify(body)
});

test('Control Room exposes performance panels and exact snapshot history',async()=>{
  const f=await fixture();
  try{
    const shell=await fetch(`${f.base}/`),html=await shell.text();
    assert.equal(shell.status,200);
    assert.match(html,/Performance review/);
    assert.match(html,/Outcome snapshots/);
    assert.match(html,/performance\.js/);

    const record={
      platform:'x',
      campaignId:f.campaign.id,
      campaignVersion:f.campaign.version,
      contentHash:f.campaign.contentHash,
      observedAt:'2026-09-29T20:00:00.000Z',
      metrics:{impressions:500,likes:21},
      source:{type:'manual',name:'control-room'}
    };
    const imported=await jsonFetch(`${f.base}/api/performance/import`,mutation(record));
    assert.equal(imported.response.status,201);
    assert.equal(imported.body.linked,1);
    assert.equal(imported.body.imported,1);

    const duplicate=await jsonFetch(`${f.base}/api/performance/import`,mutation({...record,collectedAt:'2026-09-29T21:00:00.000Z'}));
    assert.equal(duplicate.body.deduplicated,1);

    const history=await jsonFetch(`${f.base}/api/campaigns/${encodeURIComponent(f.campaign.id)}/performance?platform=x`);
    assert.equal(history.response.status,200);
    assert.equal(history.body.snapshots.length,1);
    assert.equal(history.body.snapshots[0].metrics.impressions,500);
  }finally{
    await new Promise(resolve=>f.server.close(resolve));
    f.store.close();delete process.env.BIP_AI_DB;
  }
});

test('adapter submission keeps ambiguous records in review and requires CSRF',async()=>{
  const f=await fixture();
  try{
    const denied=await jsonFetch(`${f.base}/api/adapters/performance`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({records:[]})
    });
    assert.equal(denied.response.status,403);

    const submitted=await jsonFetch(`${f.base}/api/adapters/performance`,mutation({
      record:{
        projectId:'bip-ai',
        platform:'linkedin',
        observedAt:'2026-09-29T20:30:00.000Z',
        metrics:{views:900,comments:12},
        source:{
          name:'external-collector',
          metadata:{provider:'example',token:'must-not-persist'}
        }
      }
    }));
    assert.equal(submitted.response.status,201);
    assert.equal(submitted.body.review,1);
    assert.equal(submitted.body.results[0].snapshot.source.type,'adapter');
    assert.equal(submitted.body.results[0].snapshot.source.metadata.token,undefined);

    const review=await jsonFetch(`${f.base}/api/projects/bip-ai/performance/review`);
    assert.equal(review.response.status,200);
    assert.equal(review.body.snapshots.length,1);
    assert.equal(review.body.snapshots[0].status,'review');
    assert.ok(review.body.snapshots[0].reviewReasons.includes('unlinked_metrics'));
  }finally{
    await new Promise(resolve=>f.server.close(resolve));
    f.store.close();delete process.env.BIP_AI_DB;
  }
});

test('performance import validates content type, JSON, and campaign existence',async()=>{
  const f=await fixture();
  try{
    const wrongType=await jsonFetch(`${f.base}/api/performance/import`,{
      method:'POST',
      headers:{'x-bipai-csrf':'1','content-type':'text/plain'},
      body:'{}'
    });
    assert.equal(wrongType.response.status,415);

    const invalid=await jsonFetch(`${f.base}/api/performance/import`,{
      method:'POST',
      headers:{'x-bipai-csrf':'1','content-type':'application/json'},
      body:'{'
    });
    assert.equal(invalid.response.status,400);

    const missing=await jsonFetch(`${f.base}/api/campaigns/missing/performance`);
    assert.equal(missing.response.status,404);
  }finally{
    await new Promise(resolve=>f.server.close(resolve));
    f.store.close();delete process.env.BIP_AI_DB;
  }
});
