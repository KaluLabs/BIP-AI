#!/usr/bin/env node
import { runEditorialPreferenceCommand } from './editorial-preference-cli.js';

try{
  const handled=await runEditorialPreferenceCommand(process.argv.slice(2));
  if(!handled){
    if(process.argv[2]==='serve')await import('./editorial-preference-bootstrap.js');
    await import('./cli.js');
  }
}catch(error){
  console.error(error.message);
  process.exitCode=1;
}
