import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { approveCampaign } from '../src/editorial.js';
import { buildEditorialPreferenceProfile } from '../src/editorial-preference-profile.js';
import { preferenceApprovalOutcomes } from '../src/editorial-preference-outcomes.js';

test('approval outcomes used for preferences are append-only',()=>{
  const store=new BipStore(':memory:');
  try{
    const campaign=new BipAI({store}).ingest({
      projectId:'journal',type:'feature',summary:'Immutable approval evidence',
      details:'Keep approval outcomes append-only',userVisible:true
    }).campaign;
    store.updateCampaignState(approveCampaign(campaign));
    buildEditorialPreferenceProfile(store,'journal');

    const outcomes=preferenceApprovalOutcomes(store,'journal');
    assert.equal(outcomes.length,1);
    assert.equal(outcomes[0].campaignVersion,campaign.version);
    assert.equal(outcomes[0].contentHash,campaign.contentHash);
    assert.throws(
      ()=>store.db.prepare('UPDATE editorial_preference_outcomes SET outcome=? WHERE id=?').run('approved',outcomes[0].id),
      /append-only/
    );
    assert.throws(
      ()=>store.db.prepare('DELETE FROM editorial_preference_outcomes WHERE id=?').run(outcomes[0].id),
      /append-only/
    );
  }finally{store.close()}
});
