#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { BipStore } from './store.js';
import { BipAI } from './pipeline.js';
import { FileInbox } from './capture/inbox.js';
import { scanGitActivity } from './capture/git.js';
import { ProjectRegistry } from './projects.js';
import { applyEditorial, approveCampaign, exportEditorial } from './editorial.js';
import { PagClient } from './pag-client.js';
import { requestPagHandoff, reconcilePagHandoff } from './handoff.js';
import { OpenAICompatibleDraftProvider, regenerateCampaignDrafts } from './drafting.js';

function usage() {
  console.log(`BIP-AI v0.5-dev\n\nCommands:\n  event emit <event.json>\n  events list [projectId]\n  campaigns list [projectId]\n  campaigns show <campaignId>\n  campaigns versions <campaignId>\n  campaigns approve <campaignId>\n  editorial export <campaignId> [output.json]\n  editorial import <campaignId> <editorial.json>\n  inbox emit <event.json>\n  inbox process\n  git scan <projectId> <repoPath> [since]\n  projects add <projectId> <repoPath>\n  projects list\n  request-x <campaignId>\n  request-linkedin <campaignId>\n  handoff status <x|linkedin> <campaignId>\n  draft regenerate <campaignId>\n`);
}

function print(value) { console.log(JSON.stringify(value, null, 2)); }
function requireCampaign(store, id) {
  if (!id) throw new Error('campaign id is required');
  const campaign = store.getCampaign(id);
  if (!campaign) throw new Error(`campaign not found: ${id}`);
  return campaign;
}

const [command, subcommand, arg1, arg2, arg3] = process.argv.slice(2);
if (!command) { usage(); process.exit(0); }

const store = new BipStore(process.env.BIP_AI_DB || '.bipai/bip-ai.sqlite');
try {
  const app = new BipAI({ store, storyThreshold: Number(process.env.BIP_AI_STORY_THRESHOLD || 3) });
  const inbox = new FileInbox(process.env.BIP_AI_EVENT_DIR || '.bipai/events');
  const projects = new ProjectRegistry(process.env.BIP_AI_PROJECTS || '.bipai/projects.json');
  const createPag = () => new PagClient({ baseUrl: process.env.PAG_BASE_URL || 'http://127.0.0.1:8787', token: process.env.PAG_ACTOR_TOKEN });
  const createDraftProvider = () => {
    const kind = process.env.BIP_AI_DRAFT_PROVIDER || 'deterministic';
    if (kind === 'deterministic') return null;
    if (kind === 'openai-compatible') return new OpenAICompatibleDraftProvider({
      baseUrl: process.env.BIP_AI_DRAFT_BASE_URL,
      apiKey: process.env.BIP_AI_DRAFT_API_KEY,
      model: process.env.BIP_AI_DRAFT_MODEL
    });
    throw new Error(`unsupported draft provider: ${kind}`);
  };

  if (command === 'event' && subcommand === 'emit') {
    if (!arg1) throw new Error('event emit requires a JSON file');
    print(app.ingest(JSON.parse(readFileSync(arg1, 'utf8'))));
  } else if (command === 'events' && subcommand === 'list') {
    print(store.listEvents(arg1 || null));
  } else if (command === 'campaigns' && subcommand === 'list') {
    print(store.listCampaigns(arg1 || null));
  } else if (command === 'campaigns' && subcommand === 'show') {
    print(requireCampaign(store, arg1));
  } else if (command === 'campaigns' && subcommand === 'versions') {
    if (!arg1) throw new Error('campaigns versions requires a campaign id');
    print(store.listCampaignVersions(arg1));
  } else if (command === 'campaigns' && subcommand === 'approve') {
    const approved = approveCampaign(requireCampaign(store, arg1));
    store.updateCampaignState(approved);
    print(approved);
  } else if (command === 'editorial' && subcommand === 'export') {
    const editorial = exportEditorial(requireCampaign(store, arg1));
    if (arg2) { writeFileSync(arg2, `${JSON.stringify(editorial, null, 2)}\n`); print({ written: arg2 }); }
    else print(editorial);
  } else if (command === 'editorial' && subcommand === 'import') {
    if (!arg1 || !arg2) throw new Error('editorial import requires <campaignId> <editorial.json>');
    const updated = applyEditorial(requireCampaign(store, arg1), JSON.parse(readFileSync(arg2, 'utf8')));
    store.saveCampaignVersion(updated);
    print(updated);
  } else if (command === 'inbox' && subcommand === 'emit') {
    if (!arg1) throw new Error('inbox emit requires a JSON file');
    print(inbox.enqueue(JSON.parse(readFileSync(arg1, 'utf8'))));
  } else if (command === 'inbox' && subcommand === 'process') {
    print(inbox.processAll((event) => app.ingest(event)));
  } else if (command === 'git' && subcommand === 'scan') {
    if (!arg1 || !arg2) throw new Error('git scan requires <projectId> <repoPath> [since]');
    const events = scanGitActivity({ projectId: arg1, repoPath: arg2, since: arg3 || null });
    print({ scanned: events.length, results: events.map((event) => app.ingest(event)) });
  } else if (command === 'projects' && subcommand === 'add') {
    if (!arg1 || !arg2) throw new Error('projects add requires <projectId> <repoPath>');
    print(projects.add({ id: arg1, path: arg2 }));
  } else if (command === 'projects' && subcommand === 'list') {
    print(projects.list());
  } else if (command === 'request-x') {
    const result = await requestPagHandoff(requireCampaign(store, subcommand), 'x', {
      pag: createPag(), connectionId: process.env.BIP_AI_X_CONNECTION_ID || null
    });
    store.updateCampaignState(result.campaign);
    print(result);
  } else if (command === 'request-linkedin') {
    const result = await requestPagHandoff(requireCampaign(store, subcommand), 'linkedin', {
      pag: createPag(), connectionId: process.env.BIP_AI_LINKEDIN_CONNECTION_ID || null
    });
    store.updateCampaignState(result.campaign);
    print(result);
  } else if (command === 'handoff' && subcommand === 'status') {
    if (!['x', 'linkedin'].includes(arg1) || !arg2) throw new Error('handoff status requires <x|linkedin> <campaignId>');
    const result = await reconcilePagHandoff(requireCampaign(store, arg2), arg1, { pag: createPag() });
    store.updateCampaignState(result.campaign);
    print(result);
  } else if (command === 'draft' && subcommand === 'regenerate') {
    const result = await regenerateCampaignDrafts(requireCampaign(store, arg1), { provider: createDraftProvider() });
    store.saveCampaignVersion(result.campaign);
    print(result);
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
