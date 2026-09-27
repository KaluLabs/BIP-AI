import http from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveCampaign, applyEditorial } from './editorial.js';
import { evaluatePrivacy, evaluateStoryworthiness } from './core.js';
import { requestPagHandoff, reconcilePagHandoff } from './handoff.js';
import { regenerateCampaignDrafts } from './drafting.js';
import { ingestExternalUpdate } from './adapters/external-update.js';
import { clearCampaignSchedule, listDueSchedules, runDueSchedules, scheduleCampaign } from './scheduling.js';
import { parseListQuery, queryCampaigns, queryEvents, sourceIndex } from './query.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };

function json(res, status, value) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  res.end(JSON.stringify(value));
}

async function bodyJson(req, maxBytes = 512_000) {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) throw httpError(415, 'application/json is required');
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw httpError(413, 'request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'invalid JSON body'); }
}

function httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
function requireCsrf(req) { if (req.headers['x-bipai-csrf'] !== '1') throw httpError(403, 'CSRF header missing'); }
function campaignOr404(store, id) { const value=store.getCampaign(id); if(!value) throw httpError(404, 'campaign not found'); return value; }
function projectOr404(projects, id) { const value=projects.get(id); if(!value) throw httpError(404, 'project not found'); return value; }
function enrichEvent(event, storyThreshold) { return { ...event, evaluation:evaluateStoryworthiness(event, storyThreshold), privacy:evaluatePrivacy(event) }; }

export function createBipServer({ store, projects, app = null, pagFactory = null, draftProviderFactory = null, connections = {}, storyThreshold = 3, publicDir = DEFAULT_PUBLIC_DIR, safeConfig = {}, schedulePollMs = 30_000, captureScheduler = null } = {}) {
  if (!store || !projects) throw new TypeError('store and projects are required');

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    try {
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok:true, service:'bip-ai', version:'0.2-dev' });
      if (req.method === 'GET' && path === '/api/config') return json(res, 200, { ...safeConfig });
      if (req.method === 'GET' && path === '/api/projects') return json(res, 200, { projects:projects.list() });
      if (req.method === 'GET' && path === '/api/capture/status') {
        if(!captureScheduler) throw httpError(503,'capture scheduler is not configured');
        return json(res,200,captureScheduler.status());
      }
      if (req.method === 'POST' && path === '/api/capture/run') {
        requireCsrf(req); if(!captureScheduler) throw httpError(503,'capture scheduler is not configured');
        const body=await bodyJson(req);
        return json(res,200,await captureScheduler.runOnce({projectId:body.projectId||null,force:true}));
      }
      if (req.method === 'POST' && path === '/api/adapters/external/events') {
        requireCsrf(req); if(!app) throw httpError(503,'external event ingestion is not configured');
        const body=await bodyJson(req); return json(res,201,ingestExternalUpdate(app,body));
      }
      if (req.method === 'POST' && path === '/api/projects') {
        requireCsrf(req); const body=await bodyJson(req); return json(res, 201, { project:projects.add(body) });
      }
      if (req.method === 'GET' && /^\/api\/projects\/[^/]+$/.test(path)) {
        const id=decodeURIComponent(path.split('/').pop()); const project=projectOr404(projects,id);
        return json(res,200,{ project, events:store.listEvents(id).map((event)=>enrichEvent(event,storyThreshold)), campaigns:store.listCampaigns(id) });
      }
      if (req.method === 'GET' && path === '/api/events') {
        const query=parseListQuery(url.searchParams,'events');
        const events=store.listEvents().map((event)=>enrichEvent(event,storyThreshold));
        const result=queryEvents(events,query);
        return json(res,200,{events:result.items,pagination:result.pagination,query});
      }
      if (req.method === 'GET' && path === '/api/campaigns') {
        const query=parseListQuery(url.searchParams,'campaigns');
        const rawEvents=store.listEvents();
        const result=queryCampaigns(store.listCampaigns(),query,{sourceByEventId:sourceIndex(rawEvents)});
        return json(res,200,{campaigns:result.items,pagination:result.pagination,query});
      }
      if (req.method === 'GET' && path === '/api/schedules/due') {
        const at=url.searchParams.get('at') || new Date().toISOString();
        const items=listDueSchedules(store.listCampaigns(),{at});
        return json(res,200,{at:new Date(at).toISOString(),items});
      }
      if (req.method === 'POST' && path === '/api/schedules/run-due') {
        requireCsrf(req); if(!pagFactory) throw httpError(503,'PAG is not configured');
        const body=await bodyJson(req); const at=body.at || new Date().toISOString();
        return json(res,200,await runDueSchedules(store,{pagFactory,connections,at}));
      }
      if (req.method === 'GET' && /^\/api\/campaigns\/[^/]+$/.test(path)) {
        const id=decodeURIComponent(path.split('/').pop());
        return json(res,200,{campaign:campaignOr404(store,id),versions:store.listCampaignVersions(id)});
      }
      if (req.method === 'POST' && /^\/api\/campaigns\/[^/]+\/schedule\/(x|linkedin)$/.test(path)) {
        requireCsrf(req); const parts=path.split('/'); const id=decodeURIComponent(parts[3]); const platform=parts[5]; const body=await bodyJson(req);
        const campaign=scheduleCampaign(campaignOr404(store,id),platform,body); store.updateCampaignState(campaign); return json(res,200,{campaign});
      }
      if (req.method === 'POST' && /^\/api\/campaigns\/[^/]+\/schedule\/(x|linkedin)\/clear$/.test(path)) {
        requireCsrf(req); const parts=path.split('/'); const id=decodeURIComponent(parts[3]); const platform=parts[5]; await bodyJson(req);
        const campaign=clearCampaignSchedule(campaignOr404(store,id),platform); store.updateCampaignState(campaign); return json(res,200,{campaign});
      }
      if (req.method === 'POST' && /^\/api\/campaigns\/[^/]+\/editorial$/.test(path)) {
        requireCsrf(req); const id=decodeURIComponent(path.split('/')[3]); const body=await bodyJson(req);
        const campaign=applyEditorial(campaignOr404(store,id),body); store.saveCampaignVersion(campaign); return json(res,200,{campaign});
      }
      if (req.method === 'POST' && /^\/api\/campaigns\/[^/]+\/approve$/.test(path)) {
        requireCsrf(req); const id=decodeURIComponent(path.split('/')[3]); const campaign=approveCampaign(campaignOr404(store,id));
        store.updateCampaignState(campaign); return json(res,200,{campaign});
      }
      if (req.method === 'POST' && /^\/api\/campaigns\/[^/]+\/draft\/regenerate$/.test(path)) {
        requireCsrf(req); const id=decodeURIComponent(path.split('/')[3]); const provider=draftProviderFactory ? draftProviderFactory() : null;
        const result=await regenerateCampaignDrafts(campaignOr404(store,id),{provider}); store.saveCampaignVersion(result.campaign); return json(res,200,result);
      }
      if (req.method === 'POST' && /^\/api\/campaigns\/[^/]+\/handoff\/(x|linkedin)$/.test(path)) {
        requireCsrf(req); if(!pagFactory) throw httpError(503,'PAG is not configured');
        const parts=path.split('/'); const id=decodeURIComponent(parts[3]); const platform=parts[5]; const body=await bodyJson(req);
        const result=await requestPagHandoff(campaignOr404(store,id),platform,{pag:pagFactory(),connectionId:body.connectionId||connections[platform]||null});
        store.updateCampaignState(result.campaign); return json(res,200,result);
      }
      if (req.method === 'POST' && /^\/api\/campaigns\/[^/]+\/handoff\/(x|linkedin)\/reconcile$/.test(path)) {
        requireCsrf(req); if(!pagFactory) throw httpError(503,'PAG is not configured');
        const parts=path.split('/'); const id=decodeURIComponent(parts[3]); const platform=parts[5]; await bodyJson(req);
        const result=await reconcilePagHandoff(campaignOr404(store,id),platform,{pag:pagFactory()});
        store.updateCampaignState(result.campaign); return json(res,200,result);
      }

      if (req.method === 'GET' && serveStatic(path, publicDir, res)) return;
      json(res,404,{error:'not found'});
    } catch (error) {
      const status=error.statusCode || (Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500);
      json(res,status,{error:status>=500?'request failed':String(error.message||error)});
    }
  });

  if (captureScheduler) {
    server.once('listening', () => { captureScheduler.start(); });
    server.once('close', () => { captureScheduler.stop(); });
  }

  if (pagFactory && Number(schedulePollMs) > 0) {
    let timer = null;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await runDueSchedules(store, { pagFactory, connections, at: new Date() }); }
      catch { /* per-item failures are persisted by the scheduling engine */ }
      finally { running = false; }
    };
    server.once('listening', () => {
      void tick();
      timer = setInterval(() => { void tick(); }, Number(schedulePollMs));
      timer.unref?.();
    });
    server.once('close', () => { if (timer) clearInterval(timer); });
  }

  return server;
}

function serveStatic(pathname, publicDir, res) {
  const file = pathname === '/' ? 'index.html' : pathname === '/app.js' ? 'app.js' : pathname === '/styles.css' ? 'styles.css' : null;
  if (!file) return false;
  try {
    const data=readFileSync(join(publicDir,file));
    res.writeHead(200,{ 'content-type':MIME[extname(file)]||'application/octet-stream', 'cache-control':'no-store' }); res.end(data); return true;
  } catch { return false; }
}

export async function listenBipServer(server, { host='127.0.0.1', port=8790 } = {}) {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const address=server.address(); return { server, host, port:address.port, url:`http://${host}:${address.port}` };
}
