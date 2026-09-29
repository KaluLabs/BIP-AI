import { BipStore } from './store.js';
import { preferenceStore } from './editorial-preference-db.js';
import { buildEditorialPreferenceProfile, resetPreferenceLearning, setPreferenceLearning } from './editorial-preference-profile.js';
import { regenerateWithEditorialPreferences } from './editorial-preference-regeneration.js';

function print(value){console.log(JSON.stringify(value,null,2))}

export async function runEditorialPreferenceCommand(argv){
  const [command,subcommand,arg1]=argv;
  const preferenceCommand=command==='preferences';
  const draftCommand=command==='draft'&&subcommand==='regenerate';
  if(!preferenceCommand&&!draftCommand)return false;

  const store=new BipStore(preferenceStore());
  try{
    if(draftCommand){
      if(!arg1)throw new Error('draft regenerate requires a campaign id');
      const campaign=store.getCampaign(arg1);
      if(!campaign)throw new Error(`campaign not found: ${arg1}`);
      const result=await regenerateWithEditorialPreferences(store,campaign);
      store.saveCampaignVersion(result.campaign);print(result);return true;
    }

    const projectId=arg1;
    if(!projectId)throw new Error('preferences requires a project id');
    let profile;
    if(subcommand==='show'||subcommand==='rebuild')profile=buildEditorialPreferenceProfile(store,projectId);
    else if(subcommand==='reset')profile=resetPreferenceLearning(store,projectId);
    else if(subcommand==='enable')profile=setPreferenceLearning(store,projectId,true);
    else if(subcommand==='disable')profile=setPreferenceLearning(store,projectId,false);
    else throw new Error('preferences command must be show, rebuild, reset, enable, or disable');
    print(profile);return true;
  }finally{store.close()}
}
