import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const files=[];
function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())walk(path);else if(!item.name.endsWith('.test.ts'))files.push(path);}}
walk('src');
files.push('package.json','package-lock.json','vite.config.ts','index.html','scripts/emit-offline-v2.mjs');
const hash=createHash('sha256');for(const file of files.sort())hash.update(file).update(readFileSync(file));
let commit=process.env.GITHUB_SHA||process.env.CF_PAGES_COMMIT_SHA||process.env.WORKERS_CI_COMMIT_SHA||'unknown';
try {commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())commit+='-dirty';}catch{}
const release={version:'2.1.0',renderer:'sculpted-2.1',entry:'src/main-v2.tsx',sourceCommit:commit,sourceHash:hash.digest('hex'),node:process.version};
writeFileSync('dist/release.json',JSON.stringify(release,null,2)+'\n');
console.log('Release identity: '+release.version+' '+release.renderer+' '+release.sourceCommit);
