import { sha256 } from './core.js';
import { classifyFormality, classifyLength, classifyOpening } from './editorial-preference-signals.js';
import { preferenceControl, preferenceVersions, savePreferenceControl } from './editorial-preference-db.js';

const SIGNALS={
  x:['preferredLength','openingStyle','ctaUse','threadDensity','formality'],
  linkedin:['preferredLength','openingStyle','ctaUse','paragraphDensity','formality']
};

function xStyle(c){
  const posts=(c?.drafts?.x?.posts||[]).map(String).map(x=>x.trim()).filter(Boolean);
  const avg=posts.length?Math.round(posts.reduce((n,x)=>n+x.length,0)/posts.length):0;
  return {
    preferredLength:classifyLength(avg,100,200),
    openingStyle:classifyOpening(posts[0]||''),
    ctaUse:posts.some(x=>/^next\s*:/i.test(x)),
    threadDensity:posts.length<=1?'single':posts.length<=3?'sparse':'dense',
    formality:classifyFormality(posts.join('\n'))
  };
}

function linkedInStyle(c){
  const text=String(c?.drafts?.linkedin?.text||'').trim();
  const paragraphs=text?text.split(/\n\s*\n/).filter(Boolean):[];
  return {
    preferredLength:classifyLength(text.length,500,1400),
    openingStyle:classifyOpening(paragraphs[0]||text),
    ctaUse:/(?:^|\n)next\s*:/im.test(text),
    paragraphDensity:paragraphs.length<=2?'compact':paragraphs.length<=4?'balanced':'detailed',
    formality:classifyFormality(text)
  };
}

export function editorialStyle(campaign){return {x:xStyle(campaign),linkedin:linkedInStyle(campaign)}}

function operatorVersion(record){
  const generated=record.campaign?.draftGeneration?.generatedAt;
  if(!generated)return true;
  const a=Date.parse(generated),b=Date.parse(record.createdAt);
  return !Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>1000;
}

function allowedAt(at,control){
  if(!at)return false;
  if(control.resetAt&&at<=control.resetAt)return false;
  if(control.disabledAt&&at>=control.disabledAt)return false;
  return !(control.excludedRanges||[]).some(r=>at>=r.from&&at<=r.to);
}

function evidence(projectId,records,control){
  const out=[],groups=new Map();
  for(const r of records){
    if(r.campaign?.privacyResult!=='PASS'||!allowedAt(r.createdAt,control))continue;
    const list=groups.get(r.campaignId)||[];list.push(r);groups.set(r.campaignId,list);
  }
  for(const list of groups.values()){
    list.sort((a,b)=>a.version-b.version||a.createdAt.localeCompare(b.createdAt));
    for(let i=1;i<list.length;i++){
      const a=list[i-1],b=list[i]; if(!operatorVersion(b))continue;
      const before=editorialStyle(a.campaign),after=editorialStyle(b.campaign);
      for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names){
        if(before[platform][signal]===after[platform][signal])continue;
        out.push({source:'edit',projectId,campaignId:b.campaignId,fromVersion:a.version,version:b.version,
          contentHash:b.contentHash,platform,signal,observed:after[platform][signal],weight:1,createdAt:b.createdAt});
      }
    }
  }
  for(const r of records){
    const a=r.campaign?.campaignApproval;
    if(!a||a.version!==r.version||a.contentHash!==r.contentHash||r.campaign?.privacyResult!=='PASS')continue;
    const at=a.approvedAt||r.createdAt;if(!allowedAt(at,control))continue;
    const style=editorialStyle(r.campaign);
    for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names)
      out.push({source:'approval',projectId,campaignId:r.campaignId,version:r.version,contentHash:r.contentHash,
        platform,signal,observed:style[platform][signal],weight:2,createdAt:at});
  }
  return out.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.campaignId.localeCompare(b.campaignId)||
    a.platform.localeCompare(b.platform)||a.signal.localeCompare(b.signal));
}

function aggregate(items,platform,signal){
  const rows=items.filter(x=>x.platform===platform&&x.signal===signal);if(!rows.length)return null;
  const scores=new Map();
  for(const row of rows){const k=JSON.stringify(row.observed),v=scores.get(k)||{value:row.observed,weight:0,count:0};
    v.weight+=row.weight;v.count++;scores.set(k,v)}
  const ranked=[...scores.values()].sort((a,b)=>b.weight-a.weight||b.count-a.count||String(a.value).localeCompare(String(b.value)));
  const top=ranked[0],total=ranked.reduce((n,x)=>n+x.weight,0);
  return {value:top.value,confidence:top.weight>=6&&top.weight/total>=.7?'high':top.weight>=2?'medium':'low',
    evidenceCount:rows.length,supportingWeight:top.weight,totalWeight:total};
}

export function buildEditorialPreferenceProfile(store,projectId){
  const control=preferenceControl(store,projectId),records=preferenceVersions(store,projectId),items=evidence(projectId,records,control);
  const platforms={x:{},linkedin:{}};
  for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names){
    const value=aggregate(items,platform,signal);if(value)platforms[platform][signal]=value;
  }
  const learnedSignals=Object.values(platforms).reduce((n,p)=>n+Object.keys(p).length,0);
  return {schemaVersion:1,projectId,scope:'project',globalDefaultsEnabled:false,enabled:control.enabled,
    revision:sha256({schemaVersion:1,projectId,control,items}),learning:{status:control.enabled?'enabled':'disabled',
      resetAt:control.resetAt,disabledAt:control.disabledAt,evidenceCount:items.length,learnedSignals,
      lastEvidenceAt:items.at(-1)?.createdAt||null},platforms,evidence:items};
}

export function preferenceHints(profile){
  if(!profile?.enabled)return null;const hints={scope:'project',projectId:profile.projectId,x:{},linkedin:{}};
  for(const [platform,names] of Object.entries(SIGNALS))for(const signal of names){
    const value=profile.platforms?.[platform]?.[signal]?.value;if(value!==undefined)hints[platform][signal]=value;
  }
  return Object.keys(hints.x).length||Object.keys(hints.linkedin).length?hints:null;
}

export function setPreferenceLearning(store,projectId,enabled,at=new Date().toISOString()){
  const c=preferenceControl(store,projectId);if(c.enabled===enabled)return buildEditorialPreferenceProfile(store,projectId);
  if(!enabled)savePreferenceControl(store,{...c,enabled:false,disabledAt:at,updatedAt:at});
  else savePreferenceControl(store,{...c,enabled:true,disabledAt:null,
    excludedRanges:[...(c.excludedRanges||[]),...(c.disabledAt?[{from:c.disabledAt,to:at}]:[])],updatedAt:at});
  return buildEditorialPreferenceProfile(store,projectId);
}

export function resetPreferenceLearning(store,projectId,at=new Date().toISOString()){
  const c=preferenceControl(store,projectId);
  savePreferenceControl(store,{...c,resetAt:at,disabledAt:c.enabled?null:at,excludedRanges:[],updatedAt:at});
  return buildEditorialPreferenceProfile(store,projectId);
}
