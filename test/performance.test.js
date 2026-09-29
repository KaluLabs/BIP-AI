import test from 'node:test';
import assert from 'node:assert/strict';
import {BipStore} from '../src/store.js';
import {BipAI} from '../src/pipeline.js';
import {approveCampaign} from '../src/editorial.js';
import {ensurePerformanceSchema} from '../src/performance-db.js';
import {campaignPerformance,ingestPerformance,performanceReviewQueue} from '../src/performance.js';

function seed(){
  const store=new BipStore(':memory:');
  const app=new BipAI({store,storyThreshold:1});
  const result=app.ingest({
    projectId:'bip-ai',
    type:'feature',
    summary:'Performance feedback',
    details:'Ship exact outcome snapshots',
    userVisible:true,
    occurredAt:'2026-09-29T18:00:00.000Z'
  });
  const campaign=approveCampaign(result.campaign);
  store.updateCampaignState(campaign);
  return {store,campaign};
}

test('exact campaign/version/hash snapshot links and duplicate import is idempotent',()=>{
  const {store,campaign}=seed();
  try{
    const input={
      projectId:'bip-ai',
      platform:'x',
      campaignId:campaign.id,
      campaignVersion:campaign.version,
      contentHash:campaign.contentHash,
      observedAt:'2026-09-29T19:00:00.000Z',
      metrics:{impressions:1200,likes:45,replies:7,clicks:12},
      source:{type:'manual',name:'operator'}
    };
    const first=ingestPerformance(store,input);
    const second=ingestPerformance(store,{...input,collectedAt:'2026-09-29T20:00:00.000Z'});
    assert.equal(first.deduplicated,false);
    assert.equal(first.snapshot.status,'linked');
    assert.equal(first.snapshot.campaignId,campaign.id);
    assert.equal(second.deduplicated,true);
    assert.equal(second.snapshot.id,first.snapshot.id);
    assert.equal(campaignPerformance(store,campaign.id).length,1);
  }finally{store.close()}
});

test('publishing attempt can provide exact linkage and receipt identity',()=>{
  const {store,campaign}=seed();
  try{
    store.appendPublishingJournal({
      id:'journal-1',
      attemptId:'pub-1',
      campaignId:campaign.id,
      projectId:campaign.projectId,
      platform:'x',
      campaignVersion:campaign.version,
      contentHash:campaign.contentHash,
      attemptNumber:1,
      eventType:'pag_result',
      status:'completed',
      retryable:false,
      idempotencyKey:'idem-1',
      pagIntentId:'intent-1',
      receipt:{executionStatus:'succeeded',externalId:'post-123'},
      createdAt:'2026-09-29T18:30:00.000Z'
    });
    const result=ingestPerformance(store,{
      platform:'x',
      publishingAttemptId:'pub-1',
      pagIntentId:'intent-1',
      externalId:'post-123',
      observedAt:'2026-09-29T20:00:00.000Z',
      metrics:{views:100,reactions:9}
    });
    assert.equal(result.snapshot.status,'linked');
    assert.equal(result.snapshot.campaignId,campaign.id);
    assert.equal(result.snapshot.contentHash,campaign.contentHash);
    assert.equal(result.snapshot.externalId,'post-123');
  }finally{store.close()}
});

test('wrong or incomplete exact linkage is held for review and never attached to campaign history',()=>{
  const {store,campaign}=seed();
  try{
    const wrong=ingestPerformance(store,{
      projectId:'bip-ai',
      platform:'x',
      campaignId:campaign.id,
      campaignVersion:campaign.version,
      contentHash:'wrong-hash',
      observedAt:'2026-09-29T20:00:00.000Z',
      metrics:{impressions:10}
    });
    assert.equal(wrong.snapshot.status,'review');
    assert.equal(wrong.snapshot.campaignId,null);
    assert.ok(wrong.snapshot.reviewReasons.includes('campaign_version_hash_not_found'));
    assert.equal(campaignPerformance(store,campaign.id).length,0);

    const incomplete=ingestPerformance(store,{
      projectId:'bip-ai',
      platform:'x',
      campaignId:campaign.id,
      observedAt:'2026-09-29T21:00:00.000Z',
      metrics:{impressions:20}
    });
    assert.equal(incomplete.snapshot.status,'review');
    assert.ok(incomplete.snapshot.reviewReasons.includes('incomplete_campaign_linkage'));
    assert.equal(performanceReviewQueue(store,{projectId:'bip-ai'}).length,2);
  }finally{store.close()}
});

test('platform histories stay isolated for the same exact campaign version',()=>{
  const {store,campaign}=seed();
  try{
    for(const platform of ['x','linkedin']){
      const result=ingestPerformance(store,{
        platform,
        campaignId:campaign.id,
        campaignVersion:campaign.version,
        contentHash:campaign.contentHash,
        observedAt:'2026-09-29T22:00:00.000Z',
        metrics:{impressions:platform==='x'?100:200}
      });
      assert.equal(result.snapshot.status,'linked');
    }
    assert.equal(campaignPerformance(store,campaign.id).length,2);
    assert.equal(campaignPerformance(store,campaign.id,{platform:'x'}).length,1);
    assert.equal(campaignPerformance(store,campaign.id,{platform:'linkedin'})[0].metrics.impressions,200);
  }finally{store.close()}
});

test('performance journal is append-only and source metadata drops credential-shaped fields',()=>{
  const {store,campaign}=seed();
  try{
    const result=ingestPerformance(store,{
      platform:'x',
      campaignId:campaign.id,
      campaignVersion:campaign.version,
      contentHash:campaign.contentHash,
      observedAt:'2026-09-29T23:00:00.000Z',
      metrics:{clicks:3},
      source:{
        type:'adapter',
        name:'safe-adapter',
        metadata:{workspace:'demo',apiKey:'never-store-me',nested:{access_token:'also-secret',safe:'yes'}}
      }
    });
    assert.equal(result.snapshot.source.metadata.workspace,'demo');
    assert.equal(result.snapshot.source.metadata.apiKey,undefined);
    assert.equal(result.snapshot.source.metadata.nested.access_token,undefined);
    assert.equal(result.snapshot.source.metadata.nested.safe,'yes');
    assert.doesNotMatch(JSON.stringify(result.snapshot),/never-store-me|also-secret/);

    ensurePerformanceSchema(store);
    assert.throws(()=>store.db.prepare('UPDATE content_performance_snapshots SET status=? WHERE id=?').run('review',result.snapshot.id),/append-only/);
    assert.throws(()=>store.db.prepare('DELETE FROM content_performance_snapshots WHERE id=?').run(result.snapshot.id),/append-only/);
  }finally{store.close()}
});

test('performance schema upgrades an existing store without damaging v0.2 campaign state',()=>{
  const {store,campaign}=seed();
  try{
    ensurePerformanceSchema(store);
    ensurePerformanceSchema(store);
    assert.equal(store.getCampaign(campaign.id).contentHash,campaign.contentHash);
    assert.equal(store.listCampaignVersions(campaign.id).length,1);
    assert.deepEqual(campaignPerformance(store,campaign.id),[]);
  }finally{store.close()}
});
