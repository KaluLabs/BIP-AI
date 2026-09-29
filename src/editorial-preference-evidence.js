import { editorialStyle, EDITORIAL_PREFERENCE_SIGNALS as SIGNALS } from './editorial-preference-style.js';
import { preferenceApprovalOutcomes, syncPreferenceApprovalOutcomes } from './editorial-preference-outcomes.js';

function allowedAt(at,control){
  if(!at)return false;
  if(control.resetAt&&at<=control.resetAt)return false;
  if(control.disabledAt&&at>=control.disabledAt)return false;
  return !(control.excludedRanges||[]).some(r=>at>=r.from&&at<=r.to);
}

function operatorVersion(record){
  const generated=record.campaign?.draftGeneration?.generatedAt;
  if(!generated)return true;
  const a=Date.parse(generated),b=Date.parse(record.createdAt);
  return !Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1000;
}

function edits(projectId,records,control){
  const out=[],groups=new Map();
  for(const r of records){
    if(r.campaign?.privacyResult!=='PASS'||!allowedAt(r.createdAt,control))continue;
    const list=groups.get(r.campaignId)||[];list.push(r);groups.set(r.campaignId,list);
  }
  for(const list of groups.values()){
    list.sort((a,b)=>a.version-b.version||a.createdAt.localeCompare(b.createdAt));
    for(let i=1;i<list.length;i++){
      const before=list[i-1],after=list[i];if(!operatorVersion(after))continue;
      const a=editorialStyle(before.campaign),b=editorialStyle(after.campaign);
      for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names){
        if(a[platform][signal]===b[platform][signal])continue;
        out.push({source:'edit',projectId,campaignId:after.campaignId,fromVersion:before.version,
          version:after.version,contentHash:after.contentHash,platform,signal,observed:b[platform][signal],
          weight:1,createdAt:after.createdAt});
      }
    }
  }
  return out;
}

function approvals(store,projectId,records,control){
  syncPreferenceApprovalOutcomes(store,records);
  const index=new Map(records.map(r=>[`${r.campaignId}:${r.version}:${r.contentHash}`,r]));
  const out=[];
  for(const outcome of preferenceApprovalOutcomes(store,projectId)){
    if(!allowedAt(outcome.createdAt,control))continue;
    const record=index.get(`${outcome.campaignId}:${outcome.campaignVersion}:${outcome.contentHash}`);
    if(!record||record.campaign?.privacyResult!=='PASS')continue;
    const style=editorialStyle(record.campaign);
    for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names)
      out.push({source:'approval',projectId,campaignId:outcome.campaignId,version:outcome.campaignVersion,
        contentHash:outcome.contentHash,platform,signal,observed:style[platform][signal],
        weight:2,createdAt:outcome.createdAt,outcomeId:outcome.id});
  }
  return out;
}

export function buildPreferenceEvidence(store,projectId,records,control){
  return [...edits(projectId,records,control),...approvals(store,projectId,records,control)]
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.campaignId.localeCompare(b.campaignId)||
      a.platform.localeCompare(b.platform)||a.signal.localeCompare(b.signal)||a.source.localeCompare(b.source));
}
