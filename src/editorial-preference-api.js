import { BipStore } from './store.js';
import { buildEditorialPreferenceProfile, resetPreferenceLearning, setPreferenceLearning } from './editorial-preference-profile.js';
import { preferenceStore } from './editorial-preference-db.js';
import { regenerateWithEditorialPreferences } from './editorial-preference-regeneration.js';

function json(res,status,value){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(value));
}
function csrf(req){return req.headers['x-bipai-csrf']==='1'}
function bodyError(statusCode,message){const e=new Error(message);e.statusCode=statusCode;return e}
async function body(req,maxBytes=512_000){
  const type=String(req.headers['content-type']||'');
  if(!type.startsWith('application/json'))throw bodyError(415,'application/json is required');
  const chunks=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;if(total>maxBytes)throw bodyError(413,'request body too large');
    chunks.push(chunk);
  }
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch{throw bodyError(400,'invalid JSON body')}
}
function withStore(fn){
  const store=new BipStore(preferenceStore());
  try{return fn(store)}finally{store.close()}
}
function projectPath(path){
  const m=path.match(/^\/api\/projects\/([^/]+)\/editorial-preferences(?:\/(rebuild|reset|enable|disable))?$/);
  return m?{projectId:decodeURIComponent(m[1]),action:m[2]||null}:null;
}
async function consume(req,res){
  try{await body(req);return true}
  catch(error){json(res,error.statusCode||400,{error:error.message||'invalid request'});return false}
}

export async function handleEditorialPreferenceApi(req,res){
  const url=new URL(req.url,'http://localhost'),path=url.pathname,route=projectPath(path);
  if(route){
    if(req.method==='GET'&&!route.action){
      return withStore(store=>json(res,200,{profile:buildEditorialPreferenceProfile(store,route.projectId)})),true;
    }
    if(req.method==='POST'&&route.action){
      if(!csrf(req)){json(res,403,{error:'CSRF header missing'});return true}
      if(!await consume(req,res))return true;
      const profile=withStore(store=>{
        if(route.action==='disable')return setPreferenceLearning(store,route.projectId,false);
        if(route.action==='enable')return setPreferenceLearning(store,route.projectId,true);
        if(route.action==='reset')return resetPreferenceLearning(store,route.projectId);
        return buildEditorialPreferenceProfile(store,route.projectId);
      });
      json(res,200,{profile});return true;
    }
  }

  const regen=path.match(/^\/api\/campaigns\/([^/]+)\/draft\/regenerate$/);
  if(req.method==='POST'&&regen){
    if(!csrf(req)){json(res,403,{error:'CSRF header missing'});return true}
    if(!await consume(req,res))return true;
    const store=new BipStore(preferenceStore());
    try{
      const campaign=store.getCampaign(decodeURIComponent(regen[1]));
      if(!campaign){json(res,404,{error:'campaign not found'});return true}
      const result=await regenerateWithEditorialPreferences(store,campaign);
      store.saveCampaignVersion(result.campaign);
      json(res,200,result);
    }catch{json(res,500,{error:'request failed'})}
    finally{store.close()}
    return true;
  }
  return false;
}
