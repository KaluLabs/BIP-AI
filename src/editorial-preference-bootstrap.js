import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleEditorialPreferenceApi } from './editorial-preference-api.js';
import { injectEditorialPreferenceUi } from './editorial-preference-panel.js';

const INDEX=fileURLToPath(new URL('../public/index.html',import.meta.url));
const original=http.createServer.bind(http);

function harden(res){
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('referrer-policy','no-referrer');
  res.setHeader('x-frame-options','DENY');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

http.createServer=function(options,listener){
  if(typeof options==='function'){listener=options;options=undefined}
  const wrapped=async(req,res)=>{
    harden(res);
    try{
      if(await handleEditorialPreferenceApi(req,res))return;
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='GET'&&path==='/'){
        const html=injectEditorialPreferenceUi(readFileSync(INDEX,'utf8'));
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
        res.end(html);return;
      }
      return listener(req,res);
    }catch{
      if(!res.headersSent)res.writeHead(500,{'content-type':'application/json; charset=utf-8'});
      if(!res.writableEnded)res.end(JSON.stringify({error:'request failed'}));
    }
  };
  return options===undefined?original(wrapped):original(options,wrapped);
};
