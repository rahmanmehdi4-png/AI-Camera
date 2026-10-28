import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const handlers={},data=new Map();let offline=false,claimed=false;
const normalize=request=>new URL(typeof request==='string'?request:request.url,'https://planner.test').pathname;
const caches={
  async open(name){if(!data.has(name))data.set(name,new Map());const entries=data.get(name);return {
    async addAll(urls){for(const url of urls)entries.set(normalize(url),new Response(readFileSync('dist/'+(url==='/'?'index.html':url.slice(1)))));},
    async match(request){return entries.get(normalize(request))?.clone();},
    async put(request,response){entries.set(normalize(request),response.clone());},
  };},
  async keys(){return [...data.keys()];},async delete(key){return data.delete(key);},
};
const self={location:{origin:'https://planner.test'},addEventListener:(name,callback)=>handlers[name]=callback,skipWaiting:async()=>{},clients:{claim:async()=>{claimed=true;}}};
const fetch=async()=>{if(offline)throw new Error('offline');return new Response('fresh navigation');};
runInNewContext(readFileSync('dist/sw.js','utf8'),{self,caches,fetch,URL,Response});
async function lifecycle(name){let task;handlers[name]({waitUntil:p=>task=p});await task;}
async function request(path,mode='cors'){let task;handlers.fetch({request:{url:'https://planner.test'+path,method:'GET',mode},respondWith:p=>task=p});return task;}
data.set('pose-planner-legacy',new Map());data.set('unrelated-app-cache',new Map());
await lifecycle('install');await lifecycle('activate');assert.ok(claimed);assert.ok(!data.has('pose-planner-legacy'));assert.ok(data.has('unrelated-app-cache'));
const cache=[...data.keys()].find(k=>k.startsWith('camera-pose-v2-'));assert.ok(cache);
const assets=[...data.get(cache).keys()];assert.ok(assets.some(a=>a.endsWith('.woff2')));assert.ok(assets.includes('/release.json'));
offline=true;assert.match(await (await request('/saved-scene','navigate')).text(),/3D Camera/);
for(const asset of assets.filter(a=>/\.(js|css|woff2|png)$/.test(a)))assert.ok((await request(asset)).ok,asset);
offline=false;assert.equal(await (await request('/','navigate')).text(),'fresh navigation');
offline=true;assert.equal(await (await request('/','navigate')).text(),'fresh navigation');
console.log('Offline lifecycle verified: precache, fonts, images, offline navigation, fresh online HTML, cache isolation.');
