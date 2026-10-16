import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {metadata,withMetadata} from '../scripts/seo.mjs';
const require=createRequire(import.meta.url);
const Photos=require('../js/admin-photos.js');
test('selection caps the entire event at 50 and grandfathered albums cannot grow',()=>{
 assert.deepEqual(Photos.capacity(40,10),{remaining:10,valid:true});
 assert.equal(Photos.capacity(40,11).valid,false);
 assert.equal(Photos.capacity(65,1).valid,false);
 assert.equal(Photos.capacity(0,0).valid,false);
});
test('byte-identical local files are removed before upload, distinct files remain',async()=>{
 const a=new Blob(['same']), b=new Blob(['same']), c=new Blob(['other']);
 assert.deepEqual(await Photos.uniqueFiles([a,b,c]),[a,c]);
});
test('metadata escapes user prose and uses a unique public canonical for every event',()=>{
 const options={title:'A "title" <script>',description:'Text & meaning',file:'su-kien-2026-test.html',image:'images/test.webp',article:true,body:'Text </script> kept'};
 const html=metadata(options);
 assert.ok(html.includes('https://cadoangioitreteresa.org/su-kien-2026-test'));
 assert.ok(html.includes('A &quot;title&quot; &lt;script&gt;'));
 const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
 assert.equal(schema.articleBody,options.body);assert.equal(schema['@type'],'Article');
 const updated=withMetadata('<head><meta name="description" content="old" /><link rel="canonical" href="old" /></head>',options);
 assert.equal((updated.match(/rel="canonical"/g)||[]).length,1);
});
const workerSource=readFileSync(new URL('../cloudflare-worker/worker.js',import.meta.url),'utf8');
const {assertPhotoLimit}=await import('data:text/javascript;base64,'+Buffer.from(workerSource).toString('base64'));
test('server allows old albums to shrink or change captions but rejects new photos above 50',()=>{
 const old={activities:[{id:'event',images:Array.from({length:65},(_,i)=>({src:`https://images.test/${i}.webp`,caption:'old'}))}]};
 assert.doesNotThrow(()=>assertPhotoLimit(structuredClone(old),old));
 const changed=structuredClone(old);changed.activities[0].images[0].caption='new';
 assert.doesNotThrow(()=>assertPhotoLimit(changed,old));
 changed.activities[0].images[0].src='https://images.test/new.webp';
 assert.throws(()=>assertPhotoLimit(changed,old),/50/);
 assert.throws(()=>assertPhotoLimit(old),/50/);
 assert.doesNotThrow(()=>assertPhotoLimit({activities:[{id:'new',images:old.activities[0].images.slice(0,50)}]}));
});
test('offline worker ignores admin, previews, cross-origin and write requests',()=>{
 const listeners={};
 vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>listeners[name]=fn},URL});
 for(const [url,options] of [['https://example.test/admin.html',{}],['https://example.test/year.html?preview=1',{}],['https://api.test/api/media',{}],['https://example.test/data/2026.json',{referrer:'https://example.test/admin.html'}],['https://example.test/api/media',{method:'POST'}],['https://example.test/data/2026.json',{referrer:'https://example.test/activity.html?preview=1'}]]){
  let handled=false;listeners.fetch({request:new Request(url,options),respondWith(){handled=true;}});assert.equal(handled,false,url);
 }
});
test('near-image hints tolerate a few differences without treating them as exact duplicates',()=>{
 assert.equal(Photos.similar('1'.repeat(64),'1'.repeat(60)+'0000'),true);
 assert.equal(Photos.similar('1'.repeat(64),'0'.repeat(64)),false);
});
test('offline content tries the network first and falls back only after network failure',async()=>{
 const listeners={},stored=new Map(),pending=[];let fail=false,version='new';
 const cache={async match(request){return stored.get(typeof request==='string'?request:request.url)?.clone();},async put(request,response){stored.set(request.url,response);},async keys(){return [...stored.keys()].map(url=>new Request(url));},async delete(request){stored.delete(request.url);}};
 vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{
  self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>listeners[name]=fn},URL,
  caches:{open:async()=>cache},fetch:async()=>{if(fail)throw new Error('offline');return new Response(version);},
 });
 const request=new Request('https://example.test/data/2026.json');stored.set(request.url,new Response('old'));
 async function read(){let result;listeners.fetch({request,respondWith(value){result=value;},waitUntil(value){pending.push(value);}});const response=await result;await Promise.all(pending);return response.text();}
 assert.equal(await read(),'new');fail=true;assert.equal(await read(),'new');
});
