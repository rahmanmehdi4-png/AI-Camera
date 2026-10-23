import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root="dist";
const required=["index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","favicon.svg"];
for(const file of required){
  if(!existsSync(join(root,file))) throw new Error("Missing required V2 asset: "+file);
}
// The original Grok preview assets are not part of the product.
rmSync(join(root,"__grok"),{recursive:true,force:true});
rmSync(join(root,"og.jpg"),{force:true});
const files=[];
function crawl(directory,prefix=""){
  for(const item of readdirSync(directory,{withFileTypes:true})){
    if(item.name.startsWith(".") || item.name.startsWith("_") || item.name==="sw.js") continue;
    const relative=prefix+item.name;
    if(item.isDirectory()) crawl(join(directory,item.name),relative+"/");
    else files.push("/"+relative);
  }
}
crawl(root);
if(!files.some(f=>f.startsWith("/assets/")&&f.endsWith(".js"))) throw new Error("Bundled application JS missing");
if(!files.some(f=>f.startsWith("/assets/")&&f.endsWith(".css"))) throw new Error("Bundled stylesheet missing");
const html=readFileSync(join(root,"index.html"),"utf8");
if(!html.includes("manifest.webmanifest")) throw new Error("Installable PWA manifest link missing");
for(const match of html.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)){
  const ref=match[1].split("?")[0].slice(1);
  if(ref && !existsSync(join(root,ref))) throw new Error("Missing referenced asset: "+ref);
}
const version=createHash("sha256").update(files.slice().sort().join("\n")).digest("hex").slice(0,12);
const sw=[
  'const CACHE="camera-pose-v2-'+version+'";',
  'const ASSETS='+JSON.stringify(["/",...files])+';',
  'self.addEventListener("install",event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(ASSETS);await self.skipWaiting();})()));',
  'self.addEventListener("activate",event=>event.waitUntil((async()=>{for(const key of await caches.keys()){if((key.startsWith("camera-pose-v2-")||key.startsWith("pose-planner-"))&&key!==CACHE)await caches.delete(key);}await self.clients.claim();})()));',
  'self.addEventListener("fetch",event=>{const r=event.request;if(r.method!=="GET"||new URL(r.url).origin!==self.location.origin)return;event.respondWith((async()=>{const c=await caches.open(CACHE);const cached=await c.match(r,{ignoreSearch:true});if(cached)return cached;try{const result=await fetch(r);if(result.ok)await c.put(r,result.clone());return result;}catch{if(r.mode==="navigate")return await c.match("/")||Response.error();return Response.error();}})());});',
].join("\n");
writeFileSync(join(root,"sw.js"),sw);
writeFileSync(join(root,"_redirects"),"/*  /index.html  200\n");
writeFileSync(join(root,"_headers"),"/sw.js\n  Cache-Control: no-store\n/index.html\n  Cache-Control: no-cache\n");
for(const dir of [root,join(root,"assets"),join(root,"icons")]){
  if(existsSync(dir)) writeFileSync(join(dir,".nomedia"),"");
}
console.log("V2 static site ready: "+files.length+" cached files; version "+version);
