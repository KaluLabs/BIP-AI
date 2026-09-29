import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { ProjectRegistry } from '../src/projects.js';

test('preference sidecar exposes Control Room profile and protected controls',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bip-pref-http-'));
  const db=join(root,'bip.sqlite');process.env.BIP_AI_DB=db;
  const store=new BipStore(db),projects=new ProjectRegistry(join(root,'projects.json'));
  projects.add({id:'bip-ai',path:root});
  new BipAI({store}).ingest({projectId:'bip-ai',type:'feature',summary:'Preference panel',userVisible:true});

  await import('../src/editorial-preference-bootstrap.js');
  const {createBipServer,listenBipServer}=await import('../src/http-server.js');
  const server=createBipServer({store,projects}),listening=await listenBipServer(server,{port:0});
  try{
    const shell=await fetch(`${listening.url}/`),html=await shell.text();
    assert.equal(shell.status,200);assert.match(html,/Learned preferences/);assert.match(html,/editorial-preferences\.js/);

    const profile=await fetch(`${listening.url}/api/projects/bip-ai/editorial-preferences`);
    const data=await profile.json();assert.equal(profile.status,200);assert.equal(data.profile.projectId,'bip-ai');

    const denied=await fetch(`${listening.url}/api/projects/bip-ai/editorial-preferences/disable`,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    });
    assert.equal(denied.status,403);

    const disabled=await fetch(`${listening.url}/api/projects/bip-ai/editorial-preferences/disable`,{
      method:'POST',headers:{'content-type':'application/json','x-bipai-csrf':'1'},body:'{}'
    });
    assert.equal(disabled.status,200);assert.equal((await disabled.json()).profile.enabled,false);
  }finally{
    await new Promise(resolve=>server.close(resolve));store.close();delete process.env.BIP_AI_DB;
  }
});
