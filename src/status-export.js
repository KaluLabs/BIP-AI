export function exportApprovedStatusPackage(campaign) {
  assertApprovedCurrentCampaign(campaign);
  return {
    schemaVersion: 1,
    type: 'bip-ai.approved-content',
    channel: 'whatsapp-status',
    campaignId: campaign.id,
    projectId: campaign.projectId,
    version: campaign.version,
    contentHash: campaign.contentHash,
    approvedAt: campaign.campaignApproval.approvedAt,
    content: {
      shortPosts: structuredClone(campaign.drafts.x.posts),
      longText: campaign.drafts.linkedin.text,
      assets: structuredClone(campaign.storyBrief.assets || [])
    },
    provenance: {
      eventId: campaign.eventId,
      storyBriefId: campaign.storyBrief.id
    }
  };
}

function assertApprovedCurrentCampaign(campaign) {
  if (!campaign) throw new TypeError('campaign is required');
  if (campaign.privacyResult !== 'PASS') throw new Error(`campaign privacy is ${campaign.privacyResult}`);
  if (campaign.qualityResult && campaign.qualityResult !== 'PASS') throw new Error('campaign quality is not PASS');
  if (campaign.editorialStatus !== 'approved_for_handoff') throw new Error('campaign is not approved');
  const approval = campaign.campaignApproval;
  if (!approval) throw new Error('campaign approval is missing');
  if (approval.version !== campaign.version || approval.contentHash !== campaign.contentHash) {
    throw new Error('campaign approval is stale for current content');
  }
}
