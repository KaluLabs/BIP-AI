import { campaignContentHash } from './core.js';
import { validateClaims, validateStructure } from './editorial.js';
import { preferenceHints } from './editorial-preference-profile.js';

function xLimit(hints){
  const density=hints?.x?.threadDensity;
  if(density==='single')return 1;
  if(density==='sparse')return 3;
  return Infinity;
}

export function applyPreferenceHintsToCampaign(campaign,profile){
  const hints=preferenceHints(profile);if(!hints)return campaign;
  const next=structuredClone(campaign);

  if(hints.x.ctaUse===false){
    next.drafts.x.posts=next.drafts.x.posts.filter(post=>!/^next\s*:/i.test(post));
    next.drafts.x.claims=next.drafts.x.claims.filter(claim=>claim.source!=='storyBrief.nextStep');
  }
  const limit=xLimit(hints);
  if(Number.isFinite(limit)&&next.drafts.x.posts.length>limit){
    const kept=new Set(next.drafts.x.posts.slice(0,limit));
    next.drafts.x.posts=next.drafts.x.posts.slice(0,limit);
    next.drafts.x.claims=next.drafts.x.claims.filter(claim=>kept.has(claim.text));
  }

  if(hints.linkedin.ctaUse===false){
    const paragraphs=next.drafts.linkedin.text.split(/\n\s*\n/).filter(Boolean);
    next.drafts.linkedin.text=paragraphs.filter(p=>!/^next\s*:/i.test(p.trim())).join('\n\n');
    next.drafts.linkedin.claims=next.drafts.linkedin.claims.filter(claim=>claim.source!=='storyBrief.nextStep');
  }

  const structure=validateStructure(next.drafts),claims=validateClaims(next.drafts,next.storyBrief);
  const valid=[...Object.values(structure),...Object.values(claims)].every(x=>x.result==='PASS');
  if(!valid)return campaign;

  next.editorialPreferences={revision:profile.revision,hints};
  next.contentHash=campaignContentHash(next);
  return next;
}
