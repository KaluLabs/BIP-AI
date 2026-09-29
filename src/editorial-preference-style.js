import { classifyFormality, classifyLength, classifyOpening } from './editorial-preference-signals.js';

export const EDITORIAL_PREFERENCE_SIGNALS={
  x:['preferredLength','openingStyle','ctaUse','threadDensity','formality'],
  linkedin:['preferredLength','openingStyle','ctaUse','paragraphDensity','formality']
};

function xStyle(campaign){
  const posts=(campaign?.drafts?.x?.posts||[]).map(String).map(x=>x.trim()).filter(Boolean);
  const average=posts.length?Math.round(posts.reduce((n,x)=>n+x.length,0)/posts.length):0;
  return {
    preferredLength:classifyLength(average,100,200),
    openingStyle:classifyOpening(posts[0]||''),
    ctaUse:posts.some(x=>/^next\s*:/i.test(x)),
    threadDensity:posts.length<=1?'single':posts.length<=3?'sparse':'dense',
    formality:classifyFormality(posts.join('\n'))
  };
}

function linkedInStyle(campaign){
  const text=String(campaign?.drafts?.linkedin?.text||'').trim();
  const paragraphs=text?text.split(/\n\s*\n/).filter(Boolean):[];
  return {
    preferredLength:classifyLength(text.length,500,1400),
    openingStyle:classifyOpening(paragraphs[0]||text),
    ctaUse:/(?:^|\n)next\s*:/im.test(text),
    paragraphDensity:paragraphs.length<=2?'compact':paragraphs.length<=4?'balanced':'detailed',
    formality:classifyFormality(text)
  };
}

export function editorialStyle(campaign){
  return {x:xStyle(campaign),linkedin:linkedInStyle(campaign)};
}
