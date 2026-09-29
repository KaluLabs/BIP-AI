import {readFileSync} from 'node:fs';
import {BipStore} from './store.js';
import {performanceStore} from './performance-db.js';
import {campaignPerformance,ingestPerformance,ingestPerformanceBatch,performanceReviewQueue} from './performance.js';

function print(value){console.log(JSON.stringify(value,null,2))}
function summary(results){
  return {
    imported:results.filter(item=>!item.deduplicated).length,
    deduplicated:results.filter(item=>item.deduplicated).length,
    linked:results.filter(item=>item.snapshot.status==='linked').length,
    review:results.filter(item=>item.snapshot.status==='review').length,
    results
  };
}
function parseDocument(text){
  const value=JSON.parse(text);
  if(Array.isArray(value))return value;
  if(Array.isArray(value?.records))return value.records;
  return [value?.record&&typeof value.record==='object'?value.record:value];
}

export async function runPerformanceCommand(argv){
  const [command,subcommand,arg1,arg2]=argv;
  if(command!=='performance')return false;
  const store=new BipStore(performanceStore());
  try{
    if(subcommand==='import'){
      if(!arg1)throw new Error('performance import requires a JSON file path or - for stdin');
      const records=parseDocument(readFileSync(arg1==='-'?0:arg1,'utf8'));
      if(records.length>500)throw new Error('performance import is limited to 500 records');
      print(summary(ingestPerformanceBatch(store,records,{sourceType:'json'})));return true;
    }
    if(subcommand==='add'){
      if(!arg1)throw new Error('performance add requires one JSON record');
      print(summary([ingestPerformance(store,JSON.parse(arg1),{sourceType:'manual'})]));return true;
    }
    if(subcommand==='list'){
      if(!arg1)throw new Error('performance list requires a campaign id');
      print({snapshots:campaignPerformance(store,arg1,{platform:arg2||null})});return true;
    }
    if(subcommand==='review'){
      print({snapshots:performanceReviewQueue(store,{projectId:arg1||null,platform:arg2||null})});return true;
    }
    throw new Error('performance command must be import, add, list, or review');
  }finally{store.close()}
}
