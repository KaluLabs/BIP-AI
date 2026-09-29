import { OpenAICompatibleDraftProvider, regenerateCampaignDrafts } from './drafting.js';
import { getNarrativeMemory, narrativeContextClaims } from './narrative-memory.js';
import { applyPreferenceHintsToCampaign } from './editorial-preference-drafts.js';
import { buildEditorialPreferenceProfile, preferenceHints } from './editorial-preference-profile.js';

export function configuredDraftProvider(){
  const kind=process.env.BIP_AI_DRAFT_PROVIDER||'deterministic';
  if(kind==='deterministic')return null;
  if(kind==='openai-compatible')return new OpenAICompatibleDraftProvider({
    baseUrl:process.env.BIP_AI_DRAFT_BASE_URL,
    apiKey:process.env.BIP_AI_DRAFT_API_KEY,
    model:process.env.BIP_AI_DRAFT_MODEL
  });
  throw new Error(`unsupported draft provider: ${kind}`);
}

function preferenceAwareProvider(provider,hints){
  if(!provider||!hints)return provider;
  return {
    name:provider.name,model:provider.model,external:provider.external,
    async generate(input){
      return provider.generate({
        ...input,
        storyBrief:{...input.storyBrief,editorialPreferences:structuredClone(hints)}
      });
    }
  };
}

export async function regenerateWithEditorialPreferences(store,campaign,{provider=configuredDraftProvider()}={}){
  const profile=buildEditorialPreferenceProfile(store,campaign.projectId);
  const hints=preferenceHints(profile);
  const memory=getNarrativeMemory(store,campaign.projectId).memory;
  const narrativeContext=narrativeContextClaims(memory,{excludeEventId:campaign.eventId});
  const result=await regenerateCampaignDrafts(campaign,{
    provider:preferenceAwareProvider(provider,hints),
    narrativeContext
  });
  const styled=applyPreferenceHintsToCampaign(result.campaign,profile);
  styled.draftGeneration={
    ...(styled.draftGeneration||{}),
    preferenceRevision:hints?profile.revision:null,
    preferencesApplied:Boolean(hints)
  };
  return {...result,campaign:styled,preferenceHints:hints};
}
