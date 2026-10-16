import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { poolFor } from '../db.js';
import { migrate } from '../migrate.js';
import { Ycore } from '../ycore.js';
import { migrateContent } from './migrate.js';
import { editorialOnce } from './editorial-worker.js';
import { editorialStatus } from './editorial-api.js';
export async function main(args=process.argv.slice(2)) {
  const [command='status',...rest]=args;
  if(!['once','worker','status','migrate'].includes(command) || rest.length) throw new Error('Usage: editorial once | worker | status | migrate');
  const config=loadConfig(); const pool=poolFor(config.databaseUrl); const core=new Ycore(config);
  try {
    await migrate(pool); await migrateContent(pool);
    if(command==='migrate') return {migrated:'004'};
    if(command==='status') return await editorialStatus(pool);
    if(command==='once') return await editorialOnce(pool,core,config);
    let stopped=false;
    const stop=()=>{stopped=true;};
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
    try {
      while(!stopped) {
        try { console.log(JSON.stringify(await editorialOnce(pool,core,config))); }
        catch { console.error('Editorial cycle unavailable; durable state retained.'); }
        for(let i=0;i<60 && !stopped;i++) await new Promise(resolve=>setTimeout(resolve,1000));
      }
    } finally { process.off('SIGINT',stop);process.off('SIGTERM',stop); }
    return {stopped:true};
  } finally { await pool.end(); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('Editorial command failed; check configuration and durable status.');process.exitCode=1;});
}
