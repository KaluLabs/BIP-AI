import {BipStore} from './store.js';
import {performanceStore} from './performance-db.js';
import {campaignPerformance,ingestPerformance,ingestPerformanceBatch,performanceReviewQueue} from './performance.js';

function json(res,status,value){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(value));
}
function error(statusCode,message){const value=new Error(message);value.statusCode=statusCode;return value}
function csrf(req){return req.headers['x-bipai-csrf']==='1'}
async function body(req,maxBytes=512_000){
  const type=String(req.headers['content-type']||'');
  if(!type.startsWith('application/json'))throw error(415,'application/json is required');
  const chunks=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;if(total>maxBytes)throw error(413,'request body too large');
    chunks.push(chunk);
  }
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch{throw error(400,'invalid JSON body')}
}
function withStore(fn){
  const store=new BipStore(performanceStore());
  try{return fn(store)}finally{store.close()}
}
function importResult(store,payload,sourceType){
  const records=Array.isArray(payload?.records)?payload.records:null;
  if(records){
    if(records.length>500)throw error(413,'performance import is limited to 500 records');
    const results=ingestPerformanceBatch(store,records,{sourceType});
    return {
      imported:results.filter(item=>!item.deduplicated).length,
      deduplicated:results.filter(item=>item.deduplicated).length,
      linked:results.filter(item=>item.snapshot.status==='linked').length,
      review:results.filter(item=>item.snapshot.status==='review').length,
      results
    };
  }
  const input=payload?.record&&typeof payload.record==='object'?payload.record:payload;
  const result=ingestPerformance(store,input,{sourceType});
  return {
    imported:result.deduplicated?0:1,
    deduplicated:result.deduplicated?1:0,
    linked:result.snapshot.status==='linked'?1:0,
    review:result.snapshot.status==='review'?1:0,
    results:[result]
  };
}
function validatePlatform(value){
  if(!value)return null;
  const platform=String(value).trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]*$/.test(platform))throw error(400,'invalid performance platform');
  return platform;
}

export async function handlePerformanceApi(req,res){
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  try{
    if(req.method==='POST'&&(path==='/api/performance/import'||path==='/api/adapters/performance')){
      if(!csrf(req)){json(res,403,{error:'CSRF header missing'});return true}
      const payload=await body(req);
      const sourceType=path==='/api/adapters/performance'?'adapter':null;
      const result=withStore(store=>importResult(store,payload,sourceType));
      json(res,201,result);return true;
    }

    const campaign=path.match(/^\/api\/campaigns\/([^/]+)\/performance$/);
    if(req.method==='GET'&&campaign){
      const id=decodeURIComponent(campaign[1]);
      const platform=validatePlatform(url.searchParams.get('platform'));
      const result=withStore(store=>{
        if(!store.getCampaign(id))throw error(404,'campaign not found');
        return campaignPerformance(store,id,{platform});
      });
      json(res,200,{snapshots:result});return true;
    }

    if(req.method==='GET'&&path==='/api/performance/review'){
      const projectId=url.searchParams.get('projectId')||null;
      const platform=validatePlatform(url.searchParams.get('platform'));
      const snapshots=withStore(store=>performanceReviewQueue(store,{projectId,platform}));
      json(res,200,{snapshots});return true;
    }

    const projectReview=path.match(/^\/api\/projects\/([^/]+)\/performance\/review$/);
    if(req.method==='GET'&&projectReview){
      const projectId=decodeURIComponent(projectReview[1]);
      const platform=validatePlatform(url.searchParams.get('platform'));
      const snapshots=withStore(store=>performanceReviewQueue(store,{projectId,platform}));
      json(res,200,{snapshots});return true;
    }
  }catch(err){
    const status=Number(err.statusCode)||(err instanceof TypeError?400:500);
    json(res,status,{error:status===500?'request failed':err.message});
    return true;
  }
  return false;
}
