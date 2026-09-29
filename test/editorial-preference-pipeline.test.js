import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial, approveCampaign } from '../src/editorial.js';

test('learned project style affects the next campaign but not another project',()=>{
  const store=new BipStore(':memory:'),app=new BipAI({store});
  try{
    const first=app.ingest({
      projectId:'alpha',type:'feature',summary:'First alpha change',details:'First alpha details',
      userVisible:true,decisions:['Keep it safe'],nextStep:'Continue alpha'
    }).campaign;
    const single=applyEditorial(first,{x:{posts:[first.drafts.x.posts[0]],claims:[first.drafts.x.claims[0]]}});
    store.saveCampaignVersion(single);store.updateCampaignState(approveCampaign(single));

    const next=app.ingest({
      projectId:'alpha',type:'feature',summary:'Second alpha change',details:'Second alpha details',
      userVisible:true,decisions:['Still safe'],nextStep:'Continue again'
    }).campaign;
    const beta=app.ingest({
      projectId:'beta',type:'feature',summary:'First beta change',details:'First beta details',
      userVisible:true,decisions:['Independent style'],nextStep:'Continue beta'
    }).campaign;

    assert.equal(next.drafts.x.posts.length,1);
    assert.ok(next.editorialPreferences?.revision);
    assert.ok(beta.drafts.x.posts.length>1);
    assert.equal(beta.editorialPreferences,undefined);
  }finally{store.close()}
});
