import { loadConfig } from './config.js';
import { poolFor } from './db.js';
import { migrate } from './migrate.js';
import { bootstrapUser } from './auth.js';
import { syncOnce } from './sync.js';
import { analyzeOnce } from './analyze.js';
import { Ycore } from './ycore.js';
import { queueCompanyAnalysis } from './jobs.js';
async function passwordFromStdin(): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = ''; for await (const chunk of process.stdin) { value += chunk.toString(); if (value.length>2048) throw new Error('Password input too long'); }
    return value.replace(/\r?\n$/,'');
  }
  process.stderr.write('首次账号密码（至少16字符，不回显）：');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject) => {
    let value = '';
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data',onData); process.stderr.write('\n'); };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f') value = value.slice(0,-1); else if (char >= ' ') value += char;
        if (value.length>1024) { finish(); reject(new Error('Password input too long')); return; }
      }
    };
    process.stdin.on('data',onData);
  });
}
const config = loadConfig();
const pool = poolFor(config.databaseUrl);
const ycore = new Ycore(config);
try {
  switch (process.argv[2]) {
    case 'migrate': await migrate(pool); console.log('Migrations applied.'); break;
    case 'bootstrap-user': await bootstrapUser(pool,await passwordFromStdin()); console.log('Single user created.'); break;
    case 'sync': { let more = true; for (let i=0; i<20 && more; i++) more = await syncOnce(pool,ycore); console.log(more ? 'Batch persisted; backlog remains.' : 'Sync persisted.'); break; }
    case 'analyze': {
      const args = process.argv.slice(3);
      if (args.length) {
        const eventIndex = args.indexOf('--event');
        if (eventIndex<0 || !args[eventIndex+1]) throw new Error('Explicit company inputs require --event ID');
        const refs=[];
        for (let i=0;i<args.length;i++) if (args[i]==='--company-ref') {
          const value=args[++i] ?? ''; const at=value.lastIndexOf('@'); const version=Number(value.slice(at+1));
          if (at<1 || !Number.isSafeInteger(version) || version<1) throw new Error('Use --company-ref ITEM_ID@VERSION');
          refs.push({ item_id: value.slice(0,at), item_version: version });
        }
        console.log(`Queued ${await queueCompanyAnalysis(pool,args[eventIndex+1],refs)}; explicit evidence set persisted.`);
      }
      console.log(await analyzeOnce(pool,ycore,config) ? 'One durable analysis step processed.' : 'No eligible step.'); break;
    }
    case 'worker': {
      let stopped = false; let nextSync = 0;
      for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => { stopped = true; });
      while (!stopped) {
        if (Date.now()>=nextSync) {
          try { const more = await syncOnce(pool,ycore); nextSync=Date.now()+(more ? 1000 : 300000); }
          catch { console.error('Source sync unavailable; see authenticated status.'); nextSync=Date.now()+60000; }
        }
        try { await analyzeOnce(pool,ycore,config); } catch { console.error('Analysis step unavailable; durable state retained.'); }
        for (let i=0;i<30 && !stopped;i++) await new Promise(resolve => setTimeout(resolve,1000));
      }
      break;
    }
    default: throw new Error('Use migrate | bootstrap-user | sync | analyze | worker');
  }
} catch { console.error('Operation failed. Check configuration and durable service state; no credential/body details are logged.'); process.exitCode=1; }
finally { await pool.end(); }
