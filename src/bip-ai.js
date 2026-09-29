#!/usr/bin/env node
import {runPerformanceCommand} from './performance-cli.js';
import {runEditorialPreferenceCommand} from './editorial-preference-cli.js';

try{
  const argv=process.argv.slice(2);
  const handledPerformance=await runPerformanceCommand(argv);
  const handled=handledPerformance||await runEditorialPreferenceCommand(argv);
  if(!handled){
    if(process.argv[2]==='serve')await import('./editorial-preference-bootstrap.js');
    await import('./cli.js');
  }
}catch(error){
  console.error(error.message);
  process.exitCode=1;
}
