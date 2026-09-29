import { sha256 } from './core.js';
import { preferenceControl, preferenceVersions, savePreferenceControl } from './editorial-preference-db.js';
import { buildPreferenceEvidence } from './editorial-preference-evidence.js';
import { EDITORIAL_PREFERENCE_SIGNALS as SIGNALS } from './editorial-preference-style.js';

export { editorialStyle } from './editorial-preference-style.js';

function aggregate(items,platform,signal){
  const rows=items.filter(x=>x.platform===platform&&x.signal===signal);if(!rows.length)return null;
  const scores=new Map();
  for(const row of rows){
    const key=JSON.stringify(row.observed),value=scores.get(key)||{value:row.observed,weight:0,count:0};
    value.weight+=row.weight;value.count++;scores.set(key,value);
  }
  const ranked=[...scores.values()].sort((a,b)=>
    b.weight-a.weight||b.count-a.count||String(a.value).localeCompare(String(b.value)));
  const top=ranked[0],total=ranked.reduce((n,x)=>n+x.weight,0);
  return {
    value:top.value,
    confidence:top.weight>=6&&top.weight/total>=.7?'high':top.weight>=2?'medium':'low',
    evidenceCount:rows.length,supportingWeight:top.weight,totalWeight:total
  };
}

export function buildEditorialPreferenceProfile(store,projectId){
  const control=preferenceControl(store,projectId);
  const records=preferenceVersions(store,projectId);
  const items=buildPreferenceEvidence(store,projectId,records,control);
  const platforms={x:{},linkedin:{}};
  for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names){
    const value=aggregate(items,platform,signal);if(value)platforms[platform][signal]=value;
  }
  const learnedSignals=Object.values(platforms).reduce((n,p)=>n+Object.keys(p).length,0);
  return {
    schemaVersion:1,projectId,scope:'project',globalDefaultsEnabled:false,enabled:control.enabled,
    revision:sha256({schemaVersion:1,projectId,control,items}),
    learning:{
      status:control.enabled?'enabled':'disabled',resetAt:control.resetAt,disabledAt:control.disabledAt,
      evidenceCount:items.length,learnedSignals,lastEvidenceAt:items.at(-1)?.createdAt||null
    },
    platforms,evidence:items
  };
}

export function preferenceHints(profile){
  if(!profile?.enabled)return null;
  const hints={scope:'project',projectId:profile.projectId,x:{},linkedin:{}};
  for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names){
    const value=profile.platforms?.[platform]?.[signal]?.value;
    if(value!==undefined)hints[platform][signal]=value;
  }
  return Object.keys(hints.x).length||Object.keys(hints.linkedin).length?hints:null;
}

export function setPreferenceLearning(store,projectId,enabled,at=new Date().toISOString()){
  const control=preferenceControl(store,projectId);
  if(control.enabled===enabled)return buildEditorialPreferenceProfile(store,projectId);
  if(!enabled)savePreferenceControl(store,{...control,enabled:false,disabledAt:at,updatedAt:at});
  else savePreferenceControl(store,{
    ...control,enabled:true,disabledAt:null,
    excludedRanges:[...(control.excludedRanges||[]),...(control.disabledAt?[{from:control.disabledAt,to:at}]:[])],
    updatedAt:at
  });
  return buildEditorialPreferenceProfile(store,projectId);
}

export function resetPreferenceLearning(store,projectId,at=new Date().toISOString()){
  const control=preferenceControl(store,projectId);
  savePreferenceControl(store,{
    ...control,resetAt:at,disabledAt:control.enabled?null:at,excludedRanges:[],updatedAt:at
  });
  return buildEditorialPreferenceProfile(store,projectId);
}
