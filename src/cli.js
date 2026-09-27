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
import { createBipServer, listenBipServer } from './http-server.js';
import { ingestExternalUpdate } from './adapters/external-update.js';
import { exportApprovedStatusPackage } from './status-export.js';

function usage() {
  console.log(`BIP-AI v0.6-dev\n\nCommands:\n  event emit <event.json>\n  events list [projectId]\n  campaigns list [projectId]\n  campaigns show <campaignId>\n  campaigns versions <campaignId>\n  campaigns approve <campaignId>\n  editorial export <campaignId> [output.json]\n  editorial import <campaignId> <editorial.json>\n  inbox emit <event.json>\n  inbox process\n  git scan <projectId> <repoPath> [since]\n  projects add <projectId> <repoPath>\n  projects list\n  request-x <campaignId>\n  request-linkedin <campaignId>\n  handoff status <x|linkedin> <campaignId>\n  draft regenerate <campaignId>\n  external emit <update.json>\n  status export <campaignId> [output.json]\n  serve\n`);
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
  } else if (command === 'external' && subcommand === 'emit') {
    if (!arg1) throw new Error('external emit requires an update JSON file');
    print(ingestExternalUpdate(app, JSON.parse(readFileSync(arg1, 'utf8'))));
  } else if (command === 'status' && subcommand === 'export') {
    const pkg = exportApprovedStatusPackage(requireCampaign(store, arg1));
    if (arg2) { writeFileSync(arg2, `${JSON.stringify(pkg, null, 2)}\n`); print({ written: arg2 }); }
    else print(pkg);
  } else if (command === 'serve') {
    const host = process.env.BIP_AI_HOST || '127.0.0.1';
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.BIP_AI_ALLOW_REMOTE !== '1') {
      throw new Error('remote dashboard binding requires BIP_AI_ALLOW_REMOTE=1');
    }
    const pagFactory = process.env.PAG_ACTOR_TOKEN ? createPag : null;
    const server = createBipServer({
      store, projects, app, pagFactory, draftProviderFactory: createDraftProvider,
      connections: { x: process.env.BIP_AI_X_CONNECTION_ID || null, linkedin: process.env.BIP_AI_LINKEDIN_CONNECTION_ID || null },
      storyThreshold: Number(process.env.BIP_AI_STORY_THRESHOLD || 3),
      safeConfig: {
        draftProvider: process.env.BIP_AI_DRAFT_PROVIDER || 'deterministic',
        pagConfigured: Boolean(process.env.PAG_ACTOR_TOKEN),
        xConnectionConfigured: Boolean(process.env.BIP_AI_X_CONNECTION_ID),
        linkedinConnectionConfigured: Boolean(process.env.BIP_AI_LINKEDIN_CONNECTION_ID)
      }
    });
    const listening = await listenBipServer(server, { host, port: Number(process.env.BIP_AI_PORT || 8790) });
    console.log(`BIP-AI Control Room: ${listening.url}`);
    await new Promise((resolve) => {
      const stop = () => server.close();
      process.once('SIGINT', stop); process.once('SIGTERM', stop); server.once('close', resolve);
    });
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
