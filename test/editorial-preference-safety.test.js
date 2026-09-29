import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { validateClaims } from '../src/editorial.js';
import { applyPreferenceHintsToCampaign } from '../src/editorial-preference-drafts.js';

test('preference styling can remove sourced content but cannot create unsupported claims',()=>{
  const store=new BipStore(':memory:');
  try{
    const campaign=new BipAI({store}).ingest({
      projectId:'safe-style',type:'feature',summary:'Preference safety',details:'Added safe preference hints',
      userVisible:true,decisions:['Keep claims exact'],nextStep:'Verify safety'
    }).campaign;
    const profile={
      enabled:true,revision:'test-revision',projectId:'safe-style',
      platforms:{
        x:{ctaUse:{value:false},threadDensity:{value:'single'}},
        linkedin:{ctaUse:{value:false}}
      }
    };
    const styled=applyPreferenceHintsToCampaign(campaign,profile);
    assert.equal(validateClaims(styled.drafts,styled.storyBrief).x.result,'PASS');
    assert.equal(validateClaims(styled.drafts,styled.storyBrief).linkedin.result,'PASS');
    assert.ok(styled.drafts.x.posts.length<=1);
    assert.equal(styled.drafts.x.claims.some(x=>x.source==='storyBrief.nextStep'),false);
    assert.equal(styled.drafts.linkedin.claims.some(x=>x.source==='storyBrief.nextStep'),false);
    const allowed=new Set([
      ...campaign.drafts.x.claims.map(x=>x.text),
      ...campaign.drafts.linkedin.claims.map(x=>x.text)
    ]);
    assert.ok(styled.drafts.x.claims.every(x=>allowed.has(x.text)));
    assert.ok(styled.drafts.linkedin.claims.every(x=>allowed.has(x.text)));
  }finally{store.close()}
});
