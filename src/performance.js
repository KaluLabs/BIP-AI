import {createHash} from 'node:crypto';
import {CONTENT_PERFORMANCE_SCHEMA_VERSION,appendPerformanceSnapshot,listPerformanceSnapshots} from './performance-db.js';

const METRICS=['impressions','views','reactions','likes','replies','comments','reposts','shares','clicks'];
const CREDENTIAL_KEY=/(token|secret|password|authorization|cookie|credential|session|api[_-]?key)/i;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  }
  return value;
}
function digest(value){
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function iso(value,label){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw new TypeError(`${label} must be a valid timestamp`);
  return date.toISOString();
}
function cleanString(value,max=300){
  if(value==null||value==='')return null;
  return String(value).slice(0,max);
}
function sanitizeMetadata(value,depth=0){
  if(depth>5)return null;
  if(Array.isArray(value))return value.slice(0,100).map(item=>sanitizeMetadata(item,depth+1));
  if(value&&typeof value==='object'){
    const out={};
    for(const [key,item] of Object.entries(value)){
      if(CREDENTIAL_KEY.test(key))continue;
      const next=sanitizeMetadata(item,depth+1);
      if(next!==undefined)out[key]=next;
    }
    return out;
  }
  if(['string','number','boolean'].includes(typeof value)||value==null)return value;
  return undefined;
}
function normalizeSource(source={},sourceType=null){
  const type=cleanString(sourceType||source?.type||'manual',40)?.toLowerCase();
  if(!['manual','json','adapter'].includes(type))throw new TypeError('performance source type must be manual, json, or adapter');
  return {
    type,
    name:cleanString(source?.name,120),
    recordId:cleanString(source?.recordId,200),
    collectedBy:cleanString(source?.collectedBy,120),
    metadata:sanitizeMetadata(source?.metadata||{})
  };
}
function normalizeMetrics(input){
  const metrics=input?.metrics;
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics))throw new TypeError('performance metrics object is required');
  const out={};
  for(const key of METRICS){
    if(metrics[key]==null||metrics[key]==='')continue;
    const value=Number(metrics[key]);
    if(!Number.isSafeInteger(value)||value<0)throw new TypeError(`performance metric ${key} must be a non-negative safe integer`);
    out[key]=value;
  }
  if(!Object.keys(out).length)throw new TypeError('at least one supported performance metric is required');
  return out;
}
function normalizePlatform(value){
  const platform=cleanString(value,80)?.trim().toLowerCase();
  if(!platform||!/^[a-z0-9][a-z0-9._-]*$/.test(platform))throw new TypeError('performance platform is required');
  return platform;
}
function claimedLink(input){
  return {
    projectId:cleanString(input.projectId,160),
    campaignId:cleanString(input.campaignId,200),
    campaignVersion:input.campaignVersion==null?null:Number(input.campaignVersion),
    contentHash:cleanString(input.contentHash,200),
    publishingAttemptId:cleanString(input.publishingAttemptId,200),
    pagIntentId:cleanString(input.pagIntentId,200),
    externalId:cleanString(input.externalId,300)
  };
}
function bindingFromJournal(entries){
  if(!entries.length)return null;
  const bindings=new Map();
  for(const entry of entries){
    const key=JSON.stringify([entry.projectId,entry.campaignId,entry.platform,entry.campaignVersion,entry.contentHash]);
    bindings.set(key,{
      projectId:entry.projectId,campaignId:entry.campaignId,platform:entry.platform,
      campaignVersion:Number(entry.campaignVersion),contentHash:entry.contentHash,
      publishingAttemptId:entry.attemptId||null,pagIntentId:entry.pagIntentId||null,
      externalId:entry.receipt?.externalId||null
    });
  }
  return bindings.size===1?[...bindings.values()][0]:null;
}
function publicationBinding(store,claim,platform,reasons){
  const journal=typeof store.listPublishingJournal==='function'?store.listPublishingJournal({}):[];
  let binding=null;

  if(claim.publishingAttemptId){
    const matches=journal.filter(entry=>entry.attemptId===claim.publishingAttemptId);
    if(!matches.length)reasons.push('publishing_attempt_not_found');
    else{
      const candidate=bindingFromJournal(matches);
      if(!candidate)reasons.push('publishing_attempt_ambiguous');
      else binding=candidate;
    }
  }
  if(claim.pagIntentId){
    const matches=journal.filter(entry=>entry.pagIntentId===claim.pagIntentId);
    if(!matches.length)reasons.push('pag_intent_not_found');
    else{
      const candidate=bindingFromJournal(matches);
      if(!candidate)reasons.push('pag_intent_ambiguous');
      else if(binding&&(
        binding.campaignId!==candidate.campaignId||
        binding.campaignVersion!==candidate.campaignVersion||
        binding.contentHash!==candidate.contentHash||
        binding.platform!==candidate.platform
      ))reasons.push('publication_references_conflict');
      else binding=candidate;
    }
  }
  if(binding&&binding.platform!==platform)reasons.push('publication_platform_mismatch');
  if(binding&&claim.externalId&&binding.externalId&&claim.externalId!==binding.externalId)reasons.push('external_id_mismatch');
  return binding;
}
function exactCampaignBinding(store,claim,platform,publication,reasons){
  let campaignId=claim.campaignId||publication?.campaignId||null;
  let version=Number.isInteger(claim.campaignVersion)?claim.campaignVersion:(publication?.campaignVersion??null);
  let contentHash=claim.contentHash||publication?.contentHash||null;

  const campaignClaimCount=[claim.campaignId,claim.campaignVersion!=null,claim.contentHash].filter(Boolean).length;
  if(campaignClaimCount>0&&campaignClaimCount<3)reasons.push('incomplete_campaign_linkage');

  if(publication){
    if(claim.campaignId&&claim.campaignId!==publication.campaignId)reasons.push('campaign_publication_mismatch');
    if(claim.campaignVersion!=null&&Number(claim.campaignVersion)!==publication.campaignVersion)reasons.push('version_publication_mismatch');
    if(claim.contentHash&&claim.contentHash!==publication.contentHash)reasons.push('hash_publication_mismatch');
  }

  if(!campaignId||!Number.isInteger(version)||!contentHash){
    reasons.push('unlinked_metrics');
    return null;
  }
  const versions=store.listCampaignVersions(campaignId);
  const exact=versions.find(item=>Number(item.version)===version&&item.contentHash===contentHash);
  if(!exact){
    reasons.push('campaign_version_hash_not_found');
    return null;
  }
  if(exact.projectId==null){
    reasons.push('campaign_project_missing');
    return null;
  }
  if(claim.projectId&&claim.projectId!==exact.projectId)reasons.push('project_campaign_mismatch');
  const supported=Boolean(exact.platform?.[platform]||exact.drafts?.[platform]);
  if(!supported)reasons.push('campaign_platform_mismatch');

  return {
    projectId:exact.projectId,
    campaignId:exact.id,
    campaignVersion:Number(exact.version),
    contentHash:exact.contentHash,
    publishingAttemptId:publication?.publishingAttemptId||claim.publishingAttemptId||null,
    pagIntentId:publication?.pagIntentId||claim.pagIntentId||null,
    externalId:claim.externalId||publication?.externalId||null
  };
}

export function normalizePerformanceInput(input,{sourceType=null,now=new Date()}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('performance record must be an object');
  return {
    schemaVersion:CONTENT_PERFORMANCE_SCHEMA_VERSION,
    platform:normalizePlatform(input.platform),
    metrics:normalizeMetrics(input),
    observedAt:iso(input.observedAt,'observedAt'),
    collectedAt:iso(input.collectedAt||now,'collectedAt'),
    source:normalizeSource(input.source||{},sourceType),
    claimedLink:claimedLink(input)
  };
}

export function buildPerformanceSnapshot(store,input,options={}){
  const normalized=normalizePerformanceInput(input,options);
  const reasons=[];
  const publication=publicationBinding(store,normalized.claimedLink,normalized.platform,reasons);
  const link=exactCampaignBinding(store,normalized.claimedLink,normalized.platform,publication,reasons);
  const uniqueReasons=[...new Set(reasons)];
  const linked=Boolean(link)&&uniqueReasons.length===0;
  const identity={
    schemaVersion:CONTENT_PERFORMANCE_SCHEMA_VERSION,
    platform:normalized.platform,
    observedAt:normalized.observedAt,
    metrics:normalized.metrics,
    link:linked?{
      projectId:link.projectId,
      campaignId:link.campaignId,
      campaignVersion:link.campaignVersion,
      contentHash:link.contentHash
    }:normalized.claimedLink
  };
  const fingerprint=digest(identity);
  const createdAt=normalized.collectedAt;
  return {
    schemaVersion:CONTENT_PERFORMANCE_SCHEMA_VERSION,
    id:`perf_${fingerprint.slice(0,24)}`,
    fingerprint,
    status:linked?'linked':'review',
    projectId:linked?link.projectId:(
      normalized.claimedLink.projectId||
      publication?.projectId||
      (normalized.claimedLink.campaignId?store.getCampaign(normalized.claimedLink.campaignId)?.projectId:null)||
      null
    ),
    platform:normalized.platform,
    campaignId:linked?link.campaignId:null,
    campaignVersion:linked?link.campaignVersion:null,
    contentHash:linked?link.contentHash:null,
    publishingAttemptId:linked?link.publishingAttemptId:null,
    pagIntentId:linked?link.pagIntentId:null,
    externalId:linked?link.externalId:(normalized.claimedLink.externalId||null),
    metrics:normalized.metrics,
    source:normalized.source,
    observedAt:normalized.observedAt,
    collectedAt:normalized.collectedAt,
    reviewReasons:linked?[]:(uniqueReasons.length?uniqueReasons:['unlinked_metrics']),
    claimedLink:normalized.claimedLink,
    createdAt
  };
}

export function ingestPerformance(store,input,options={}){
  if(!store)throw new TypeError('store is required');
  return appendPerformanceSnapshot(store,buildPerformanceSnapshot(store,input,options));
}

export function ingestPerformanceBatch(store,records,options={}){
  if(!Array.isArray(records))throw new TypeError('performance records must be an array');
  return records.map(record=>ingestPerformance(store,record,options));
}

export function campaignPerformance(store,campaignId,{platform=null}={}){
  if(!campaignId)throw new TypeError('campaignId is required');
  return listPerformanceSnapshots(store,{campaignId,platform,status:'linked'});
}

export function performanceReviewQueue(store,{projectId=null,platform=null}={}){
  return listPerformanceSnapshots(store,{projectId,platform,status:'review'});
}
