import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial } from '../src/editorial.js';
import { buildEditorialPreferenceProfile } from '../src/editorial-preference-profile.js';

test('REVIEW and BLOCK material never becomes preference evidence',()=>{
  const store=new BipStore(':memory:'),app=new BipAI({store});
  try{
    const review=app.ingest({
      projectId:'private-style',type:'feature',summary:'review-only-secret-phrase',
      userVisible:true,privacy:'REVIEW',nextStep:'private next step'
    }).campaign;
    const edited=applyEditorial(review,{
      x:{posts:[review.drafts.x.posts[0]],claims:[review.drafts.x.claims[0]]}
    });
    store.saveCampaignVersion(edited);
    const blocked=app.ingest({
      projectId:'private-style',type:'feature',summary:'blocked-secret-phrase',
      userVisible:true,privacy:'BLOCK'
    });
    assert.equal(blocked.campaign,null);

    const profile=buildEditorialPreferenceProfile(store,'private-style');
    assert.equal(profile.learning.evidenceCount,0);
    assert.doesNotMatch(JSON.stringify(profile),/review-only-secret-phrase|blocked-secret-phrase|private next step/);
  }finally{store.close()}
});
