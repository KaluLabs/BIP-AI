#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { BipStore } from './store.js';
import { BipAI } from './pipeline.js';

function usage() {
  console.log(`BIP-AI v0.1\n\nCommands:\n  event emit <event.json>\n  events list [projectId]\n  campaigns list [projectId]\n  campaigns show <campaignId>\n  editorial export <campaignId> [output.json]\n`);
}

function print(value) { console.log(JSON.stringify(value, null, 2)); }

const [command, subcommand, arg1, arg2] = process.argv.slice(2);
if (!command) { usage(); process.exit(0); }

const store = new BipStore(process.env.BIP_AI_DB || '.bipai/bip-ai.sqlite');
try {
  const app = new BipAI({ store, storyThreshold: Number(process.env.BIP_AI_STORY_THRESHOLD || 3) });

  if (command === 'event' && subcommand === 'emit') {
    if (!arg1) throw new Error('event emit requires a JSON file');
    print(app.ingest(JSON.parse(readFileSync(arg1, 'utf8'))));
  } else if (command === 'events' && subcommand === 'list') {
    print(store.listEvents(arg1 || null));
  } else if (command === 'campaigns' && subcommand === 'list') {
    print(store.listCampaigns(arg1 || null));
  } else if (command === 'campaigns' && subcommand === 'show') {
    if (!arg1) throw new Error('campaigns show requires a campaign id');
    const campaign = store.getCampaign(arg1);
    if (!campaign) throw new Error(`campaign not found: ${arg1}`);
    print(campaign);
  } else if (command === 'editorial' && subcommand === 'export') {
    if (!arg1) throw new Error('editorial export requires a campaign id');
    const campaign = store.getCampaign(arg1);
    if (!campaign) throw new Error(`campaign not found: ${arg1}`);
    const editorial = {
      project: campaign.projectId,
      storyBrief: campaign.storyBrief,
      claims: { x: campaign.drafts.x.claims, linkedin: campaign.drafts.linkedin.claims },
      desiredFormats: { x: 'thread', linkedin: 'professional-narrative' },
      toneConstraints: ['factual', 'no invented claims', 'no credentials or PAG internals'],
      privacyConstraints: ['respect PASS/REVIEW/BLOCK', 'do not expose secrets']
    };
    if (arg2) { writeFileSync(arg2, `${JSON.stringify(editorial, null, 2)}\n`); print({ written: arg2 }); }
    else print(editorial);
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store.close();
}
