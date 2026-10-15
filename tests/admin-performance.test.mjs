import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), Schema=require('../js/schema.js');
const source=readFileSync(new URL('../js/store.js',import.meta.url),'utf8');
function storeHarness(fetch) {
 const data=new Map();
 const db={transaction(){const tx={pending:0,objectStore(){return {
  get(key){return operation(()=>structuredClone(data.get(key)));},
  put(value){return operation(()=>{data.set(value.id,structuredClone(value));return value.id;});}
 };}};function operation(action){const req={};tx.pending++;setImmediate(()=>{try{req.result=action();req.onsuccess?.();}catch(e){tx.error=e;tx.onerror?.();}tx.pending--;if(!tx.pending)queueMicrotask(()=>{if(!tx.pending)tx.oncomplete?.();});});return req;}return tx;},close(){}};
 const indexedDB={open(){const request={result:db};setImmediate(()=>request.onsuccess?.());return request;}};
 const auth={currentUser:{uid:'owner',email:'owner@example.test',getIdToken:async()=> 'test-token'},onAuthStateChanged(callback){queueMicrotask(callback);return ()=>{};}};
 const window={TeresaSchema:Schema,indexedDB,FIREBASE_CONFIG:{apiKey:'test'},TERESA_API_CONFIG:{endpoint:'https://api.example.test'},firebase:{apps:[{}],app:()=>({}),auth:()=>auth}};
 vm.runInNewContext(source,{window,indexedDB,document:{readyState:'complete'},fetch,URLSearchParams,AbortController,setTimeout,clearTimeout,queueMicrotask,console:{warn(){}}});
 return {store:window.TeresaStore,data};
}
const response=data=>({ok:true,json:async()=>data});
test('admin year requests a compact payload and reuses it when switching back',async()=>{
 const requests=[];const {store}=storeHarness(async(url)=>{requests.push(String(url));return response({data:{year:2026,overview:{title:'Year'},activities:[{id:'event',album:{manifest:'data/albums/2026/event.json',count:65,preview:[]}}]},revision:'a'.repeat(40)});});
 const first=await store.loadYearForAdmin(2026);first.overview.title='Local edit';
 const second=await store.loadYearForAdmin(2026);
 assert.equal(requests.length,1);assert.ok(requests[0].endsWith('/api/years/2026?compact=1'));assert.equal(second.overview.title,'Year');assert.equal(second.activities[0].album.count,65);assert.equal(second._revision,'a'.repeat(40));
 await store.loadYearForAdmin(2026,{force:true});assert.equal(requests.length,2);
});
test('cloud acknowledgement cannot overwrite newer local edits while syncing in background',async()=>{
 let finish;const {store,data}=storeHarness(async(url)=>{
  if(String(url).endsWith('/api/session'))return response({role:'owner',capabilities:{adminProtocol:2,cloudDrafts:true}});
  return new Promise(resolve=>{finish=()=>resolve(response({record:{cloudRevision:'cloud-1'}}));});
 });
 await store.waitForAuth();
 const original={year:2026,overview:{title:'Original'},activities:[]};
 await store.saveDraft(2026,original,{localOnly:true});
 const sync=store.syncDraft(2026);while(!finish)await new Promise(resolve=>setImmediate(resolve));
 await store.saveDraft(2026,{...original,overview:{title:'Newer typing'}},{localOnly:true});
 finish();await sync;
 assert.equal(data.get('2026').data.overview.title,'Newer typing');assert.equal(data.get('2026').cloudRevision,'cloud-1');assert.equal(data.get('2026').cloudSynced,false);
});
test('photo pagination preserves unrendered photos and respects removals and ordering',()=>{
 const source=readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('  function currentActivityMedia()'),source.indexOf('  async function ensureActivityMedia()'));
 const registry=new Map(Array.from({length:65},(_,i)=>['photo-'+i,{id:'photo-'+i}]));
 const visible=Array.from({length:24},(_,i)=>({dataset:{mediaKey:'photo-'+i}}));
 const context={activityMediaRegistry:registry,document:{querySelectorAll:()=>visible}};
 let images=vm.runInNewContext(`(${fn})()`,context);assert.equal(images.length,65);assert.equal(images[64].id,'photo-64');
 registry.delete('photo-5');visible.splice(5,1);visible.reverse();
 images=vm.runInNewContext(`(${fn})()`,context);assert.equal(images.length,64);assert.equal(images[0].id,'photo-23');assert.ok(!images.some(image=>image.id==='photo-5'));
});
