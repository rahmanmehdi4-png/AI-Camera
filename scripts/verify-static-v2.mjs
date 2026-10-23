#!/usr/bin/env node
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2] || 'dist');
const path=(name)=>join(root,name);
const read=(name)=>readFileSync(path(name),'utf8');
for (const name of ['index.html','manifest.webmanifest','sw.js','_redirects','_headers','favicon.svg'])
  assert.ok(existsSync(path(name)), 'Missing essential PWA output: '+name);
const html=read('index.html');
assert.ok(!html.includes('data-tsr-stream-part'), 'Obsolete TanStack Start markup leaked into the static V2 site');
assert.ok(!html.includes('grok.com/grok-app-builder/extensions.js'),'External editor extension leaked into release');
assert.ok(/<script\b/i.test(html),'Missing application script');
assert.ok(html.includes('/assets/') && html.includes('.js'),'Missing bundled application script');
assert.ok(html.includes('manifest.webmanifest'),'Missing manifest link');
assert.ok(html.includes('3D Camera'), 'Release page is not the V2 planner');
const manifest=JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.display,'standalone');
assert.equal(manifest.orientation,'any');
assert.ok(manifest.name?.includes('Camera'),'Incorrect app name');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length>=2,'Missing app icons');
for (const icon of manifest.icons)
  assert.ok(existsSync(path(icon.src.replace(/^\//,''))), 'Missing app icon '+icon.src);
assert.ok(existsSync(path('assets')),'Assets directory missing');
const files=[];
function walk(dir,prefix=''){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const relative=prefix+entry.name;
    if(entry.isDirectory())walk(join(dir,entry.name),relative+'/');
    else if(!entry.name.startsWith('.'))files.push(relative);
  }
}
walk(path('assets'),'assets/');
assert.ok(files.some(s=>s.endsWith('.js')),'Missing bundled JavaScript');
assert.ok(files.some(s=>s.endsWith('.css')),'Missing stylesheet');
const missing=[];
for(const m of html.matchAll(/\b(?:src|href)=["'](\/[^"']+)["']/g)){
  const name=m[1].split('?')[0].slice(1);
  if(name && !existsSync(path(name)) && !name.startsWith('api/'))missing.push(m[1]);
}
assert.deepEqual(missing,[],'Referenced static assets are missing');
const sw=read('sw.js');
assert.ok(sw.includes('caches.open'),'Missing service-worker cache');
assert.ok(sw.includes('camera-pose-v2-'),'Service worker is not the V2 cache');
assert.ok(sw.includes('/assets/'),'Service worker does not cache the application bundle');
assert.ok(read('_redirects').includes('/index.html'),'Missing static SPA fallback');
assert.ok(!existsSync(path('__grok')),'Preview-template assets leaked into the release');
console.log('V2 package verified: '+files.length+' web assets; manifest, cache, icons and referenced files OK.');
