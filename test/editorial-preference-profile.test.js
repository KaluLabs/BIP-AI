import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial, approveCampaign } from '../src/editorial.js';
import { buildEditorialPreferenceProfile, resetPreferenceLearning, setPreferenceLearning } from '../src/editorial-preference-profile.js';

function seed(store,projectId,summary){
  const app=new BipAI({store});
  return app.ingest({
    projectId,type:'feature',summary,details:summary,userVisible:true,
    decisions:['Keep evidence bound'],nextStep:'Ship safely'
  }).campaign;
}

test('editorial preferences are deterministic, project-isolated, and text-free',()=>{
  const store=new BipStore(':memory:');
  try{
    const alpha=seed(store,'alpha','alpha-secret-style-source');
    seed(store,'beta','beta-source');
    const edited=applyEditorial(alpha,{
      x:{posts:[alpha.drafts.x.posts[0]],claims:[alpha.drafts.x.claims[0]]}
    });
    store.saveCampaignVersion(edited);
    store.updateCampaignState(approveCampaign(edited));

    const first=buildEditorialPreferenceProfile(store,'alpha');
    const second=buildEditorialPreferenceProfile(store,'alpha');
    const beta=buildEditorialPreferenceProfile(store,'beta');

    assert.deepEqual(second,first);
    assert.ok(first.learning.evidenceCount>0);
    assert.equal(beta.learning.evidenceCount,0);
    assert.ok(first.evidence.every(item=>item.projectId==='alpha'));
    assert.doesNotMatch(JSON.stringify(first),/alpha-secret-style-source|Keep evidence bound|Ship safely/);
  }finally{store.close()}
});

test('reset and disable keep source history immutable while excluding learning windows',()=>{
  const store=new BipStore(':memory:');
  try{
    const campaign=seed(store,'controls','control source');
    const edited=applyEditorial(campaign,{x:{posts:[campaign.drafts.x.posts[0]],claims:[campaign.drafts.x.claims[0]]}});
    store.saveCampaignVersion(edited);
    const versionsBefore=store.listCampaignVersions(campaign.id);

    const disabled=setPreferenceLearning(store,'controls',false,'0001-01-01T00:00:00.000Z');
    assert.equal(disabled.enabled,false);
    assert.equal(disabled.learning.evidenceCount,0);

    const enabled=setPreferenceLearning(store,'controls',true,'9998-01-01T00:00:00.000Z');
    assert.equal(enabled.enabled,true);
    assert.equal(enabled.learning.evidenceCount,0);

    const reset=resetPreferenceLearning(store,'controls','9999-01-01T00:00:00.000Z');
    assert.equal(reset.learning.evidenceCount,0);
    assert.deepEqual(store.listCampaignVersions(campaign.id),versionsBefore);
  }finally{store.close()}
});
