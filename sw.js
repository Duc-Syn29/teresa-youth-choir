/* Public pages only. RELEASE is replaced with a content hash during build. */
const CACHE='teresa-public-RELEASE';
const LIMIT=90;
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/offline.html'])));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('teresa-public-')&&key!==CACHE).map(key=>caches.delete(key)))));});
function allowed(request) {
 const u=new URL(request.url);
 const ref=request.referrer ? new URL(request.referrer) : null;
 if(ref && (/\/admin(?:\.html)?$/.test(ref.pathname)||ref.searchParams.has('preview')))return false;
 return request.method==='GET' && u.origin===self.location.origin && !request.headers.has('Authorization') && !u.searchParams.has('preview') && !/\/admin(?:\.html)?$/.test(u.pathname) && !u.pathname.startsWith('/api/') && !/firebase|admin|raw|word/.test(u.pathname) && (request.mode==='navigate'||/^\/(css|js|data)\//.test(u.pathname));
}
async function remember(request,response) {
 if(!response.ok || response.type==='opaque' || /no-store|private/.test(response.headers.get('Cache-Control')||''))return;
 const cache=await caches.open(CACHE);
 await cache.put(request,response);
 const keys=await cache.keys();
 for(const key of keys.slice(0,Math.max(0,keys.length-LIMIT)))if(!key.url.endsWith('/offline.html'))await cache.delete(key);
}
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(!allowed(request))return;
 const u=new URL(request.url);
 // Versioned scripts/styles are immutable in this cache. Content always checks the network.
 const immutable=/^\/(css|js)\//.test(u.pathname)&&u.searchParams.has('v');
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(immutable){const hit=await cache.match(request);if(hit)return hit;}
  try { const response=await fetch(request);event.waitUntil(remember(request,response.clone()).catch(()=>{}));return response; }
  catch(_){const saved=await cache.match(request);if(saved)return saved;if(request.mode==='navigate')return await cache.match('/offline.html');throw _;}
 })());
});
