import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial, approveCampaign, validateClaims } from '../src/editorial.js';
import { regenerateWithEditorialPreferences } from '../src/editorial-preference-regeneration.js';

test('provider receives bounded style hints without expanding claim sources',async()=>{
  const store=new BipStore(':memory:');
  try{
    const base=new BipAI({store}).ingest({
      projectId:'provider-style',type:'feature',summary:'Provider preference source',
      details:'Added provider preference safety',userVisible:true,decisions:['Keep claims bounded'],nextStep:'Verify provider'
    }).campaign;
    const edited=applyEditorial(base,{x:{posts:[base.drafts.x.posts[0]],claims:[base.drafts.x.claims[0]]}});
    store.saveCampaignVersion(edited);
    const approved=approveCampaign(edited);store.updateCampaignState(approved);

    let hints=null;
    const provider={name:'stub',model:'stub-1',external:false,async generate(input){
      hints=input.storyBrief.editorialPreferences;
      return {x:structuredClone(approved.drafts.x),linkedin:structuredClone(approved.drafts.linkedin)};
    }};
    const result=await regenerateWithEditorialPreferences(store,approved,{provider});

    assert.equal(result.mode,'provider');
    assert.equal(result.campaign.draftGeneration.preferencesApplied,true);
    assert.equal(hints.scope,'project');
    assert.equal(hints.projectId,'provider-style');
    assert.ok(hints.x.threadDensity);
    assert.doesNotMatch(JSON.stringify(hints),/Provider preference source|Keep claims bounded|Verify provider/);
    assert.equal(validateClaims(result.campaign.drafts,result.campaign.storyBrief).x.result,'PASS');
    assert.equal(validateClaims(result.campaign.drafts,result.campaign.storyBrief).linkedin.result,'PASS');
  }finally{store.close()}
});
