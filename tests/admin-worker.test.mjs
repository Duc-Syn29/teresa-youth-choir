import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const source = readFileSync(new URL('../cloudflare-worker/worker.js', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;

function bucket() {
  let serial = 0;
  const items = new Map();
  return {
    items,
    async get(key) { const item = items.get(key); return item && { ...item, json: async () => JSON.parse(item.value), body: item.value }; },
    async head(key) { return items.get(key) || null; },
    async put(key, value, options = {}) {
      const old = items.get(key);
      if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
      if (options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
      const item = { key, value, etag: String(++serial), size: typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength, customMetadata: options.customMetadata || {}, httpMetadata: options.httpMetadata || {}, uploaded: new Date() }; items.set(key, item); return item;
    },
    async list({ prefix }) { return { objects: [...items.values()].filter(item => item.key.startsWith(prefix)), truncated: false }; },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) items.delete(key); },
  };
}

test('cloud drafts enforce revision checks, private access, editor restrictions, and account revocation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.crypto ||= webcrypto;
  let email = 'owner@example.test';
  globalThis.fetch = async () => new Response(JSON.stringify({ users: [{ localId: email, email }] }));
  const env = { FIREBASE_API_KEY: 'test', ADMIN_EMAIL: email, EDITOR_EMAILS: 'editor@example.test', MEDIA_BUCKET: bucket(), PRIVATE_BUCKET: bucket(), ENVIRONMENT: 'preview', ALLOWED_ORIGINS: 'https://example.test' };
  const request = (path, method = 'GET', body, revision = '') => worker.fetch(new Request('https://example.test' + path, { method, headers: { Origin: 'https://example.test', Authorization: 'Bearer test', 'Content-Type': 'application/json', 'If-Match': revision }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil() {} });
  try {
    assert.equal((await request('/api/session')).status, 200);
    const draft = { data: { year: 2026, activities: [{ title: '' }] }, baseRevision: 'published' };
    const first = await request('/api/drafts/2026', 'PUT', draft); assert.equal(first.status, 200);
    const revision = (await first.json()).record.cloudRevision;
    assert.equal((await request('/api/drafts/2026', 'PUT', draft)).status, 409);
    assert.equal((await request('/media/private/drafts/2026.json')).status, 404);
    email = 'editor@example.test';
    assert.equal((await (await request('/api/session')).json()).role, 'editor');
    assert.equal((await request('/api/media', 'DELETE', { id: 'any' })).status, 403);
    assert.equal((await request('/api/accounts')).status, 403);
    const cleared = await request('/api/drafts/2026', 'DELETE', null, revision); assert.equal(cleared.status, 200);
    const tombstone = (await cleared.json()).cloudRevision;
    assert.equal((await (await request('/api/drafts/2026')).json()).record, null);
    assert.equal((await request('/api/drafts/2026', 'PUT', draft, tombstone)).status, 200);
    email = 'owner@example.test';
    const add = await request('/api/accounts', 'POST', { email: 'delegate@example.test', existing: true }); assert.equal(add.status, 200);
    const accessRevision = (await add.json()).revision;
    email = 'delegate@example.test'; assert.equal((await request('/api/session')).status, 200);
    email = 'owner@example.test'; assert.equal((await request('/api/accounts', 'DELETE', { email: 'delegate@example.test' }, accessRevision)).status, 200);
    email = 'delegate@example.test'; assert.equal((await request('/api/session')).status, 403);
  } finally { globalThis.fetch = originalFetch; }
});

test('identical optimized uploads reuse the same two R2 objects across topics', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.crypto ||= webcrypto;
  globalThis.fetch = async () => new Response(JSON.stringify({ users: [{ localId: 'owner', email: 'owner@example.test' }] }));
  const env = { FIREBASE_API_KEY: 'test', ADMIN_EMAIL: 'owner@example.test', MEDIA_BUCKET: bucket(), PRIVATE_BUCKET: bucket(), ENVIRONMENT: 'preview', ALLOWED_ORIGINS: 'https://example.test' };
  const upload = async (topic) => {
    const form = new FormData();
    const jpg = new Blob([new Uint8Array([255,216,255,224,0,4,0,0,255,217])], { type: 'image/jpeg' });
    form.append('original', jpg, 'photo.jpg'); form.append('thumbnail', jpg, 'thumb.jpg'); form.append('year','2026'); form.append('topic', topic);
    return worker.fetch(new Request('https://example.test/api/media', { method: 'POST', headers: { Origin: 'https://example.test', Authorization: 'Bearer test' }, body: form }), env, { waitUntil() {} });
  };
  try {
    const first = await upload('Thánh lễ'); assert.equal(first.status, 201); const a = await first.json();
    const second = await upload('Cộng đoàn'); assert.equal(second.status, 201); const b = await second.json();
    assert.equal(a.id, b.id); assert.equal(b.reused, true); assert.equal(env.MEDIA_BUCKET.items.size, 2); assert.equal(b.medium.src, b.original.src);
  } finally { globalThis.fetch = originalFetch; }
});

test('inline photos chosen outside the first three album photos remain in the public preview', async () => {
  const helpers = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { buildAlbumChanges };').toString('base64'));
  const images = Array.from({ length: 5 }, (_, index) => ({ id: 'photo-' + index, src: 'https://example.test/' + index + '.webp' }));
  const data = { year: 2026, activities: [{ id: 'event', images, storyPhotos: [{ afterParagraph: 0, photoId: 'photo-4' }] }] };
  helpers.buildAlbumChanges(data, {});
  assert.ok(data.activities[0].album.preview.some(image => image.id === 'photo-4'));
  assert.equal(data.activities[0].album.count, 5);
});

test('deletion preserves images referenced by shared drafts and retained history', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.crypto ||= webcrypto;
  const head = 'a'.repeat(40);
  globalThis.fetch = async (url) => {
    if (String(url).includes('identitytoolkit')) return new Response(JSON.stringify({ users: [{ localId: 'owner', email: 'owner@example.test' }] }));
    if (String(url).includes('/git/ref/')) return new Response(JSON.stringify({ object: { sha: head } }));
    return new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify({ years: [] })).toString('base64') }));
  };
  const env = { FIREBASE_API_KEY: 'test', ADMIN_EMAIL: 'owner@example.test', GITHUB_OWNER: 'test', GITHUB_REPO: 'test', GITHUB_TOKEN: 'test', MEDIA_BUCKET: bucket(), PRIVATE_BUCKET: bucket(), ENVIRONMENT: 'preview', ALLOWED_ORIGINS: 'https://example.test' };
  const key = 'media/2026/shared/asset123/original.jpg';
  await env.MEDIA_BUCKET.put(key, new Uint8Array([1]), { customMetadata: { assetRoot: 'media/2026/shared/asset123' } });
  const remove = () => worker.fetch(new Request('https://example.test/api/media', { method: 'DELETE', headers: { Origin: 'https://example.test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key }) }), env, { waitUntil() {} });
  try {
    await env.PRIVATE_BUCKET.put('private/drafts/2026.json', JSON.stringify({ data: { photo: key } }));
    const draft = await remove(); assert.equal(draft.status, 409); assert.equal((await draft.json()).code, 'MEDIA_IN_DRAFT');
    await env.PRIVATE_BUCKET.delete('private/drafts/2026.json');
    await env.PRIVATE_BUCKET.put('private/history/2026/old.json', JSON.stringify({ retainedAt: new Date().toISOString(), data: { photo: key } }));
    const history = await remove(); assert.equal(history.status, 409); assert.equal((await history.json()).code, 'MEDIA_IN_HISTORY');
    assert.ok(await env.MEDIA_BUCKET.head(key));
  } finally { globalThis.fetch = originalFetch; }
});

test('trash listing, private preview and restoration preserve all variants and reject invalid keys', async () => {
  const originalFetch=globalThis.fetch;globalThis.crypto ||= webcrypto;
  globalThis.fetch=async()=>new Response(JSON.stringify({users:[{localId:'owner',email:'owner@example.test'}]}));
  const env={FIREBASE_API_KEY:'test',ADMIN_EMAIL:'owner@example.test',MEDIA_BUCKET:bucket(),PRIVATE_BUCKET:bucket(),ENVIRONMENT:'preview',ALLOWED_ORIGINS:'https://example.test'};
  const root='media/2026/shared/restore123',prefix='trash/2026-10-14T00-00-00-000Z',original=root+'/original.jpg',thumb=root+'/thumb.jpg';
  for(const [target,variant] of [[original,'original'],[thumb,'thumbnail']]) await env.MEDIA_BUCKET.put(prefix+'/'+target,new Uint8Array([255,216,255]),{httpMetadata:{contentType:'image/jpeg'},customMetadata:{assetRoot:root,originalKey:target,thumbnailKey:thumb,variant,deletedAt:'2026-10-14T00:00:00.000Z',caption:'Ảnh khôi phục'}});
  const request=(path,method='GET',body,auth=true)=>worker.fetch(new Request('https://example.test'+path,{method,headers:{Origin:'https://example.test',...(auth?{Authorization:'Bearer test'}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){}});
  try{
    const listed=await request('/api/trash?year=2026');assert.equal(listed.status,200);const items=(await listed.json()).items;assert.equal(items.length,1);assert.equal(items[0].thumbnailKey,prefix+'/'+thumb);assert.equal(items[0].retainUntil,'2026-11-13T00:00:00.000Z');
    assert.equal((await request('/api/trash/preview?key='+encodeURIComponent(prefix+'/'+thumb), 'GET', null, false)).status,401);
    const preview=await request('/api/trash/preview?key='+encodeURIComponent(prefix+'/'+thumb));assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/jpeg');assert.equal((await preview.arrayBuffer()).byteLength,3);
    assert.equal((await request('/api/trash/restore','POST',{key:'private/access.json'})).status,422);
    assert.equal((await request('/api/trash/restore','POST',{key:prefix+'/'+thumb})).status,422);
    const restored=await request('/api/trash/restore','POST',{key:items[0].key});assert.equal(restored.status,200);assert.equal((await restored.json()).restored.length,2);
    assert.ok(await env.MEDIA_BUCKET.head(original));assert.ok(await env.MEDIA_BUCKET.head(thumb));assert.equal(await env.MEDIA_BUCKET.head(prefix+'/'+original),null);
    const stats=await request('/api/media/stats?year=2026');const result=await stats.json();assert.equal(result.photos,1);assert.equal(result.objects,2);assert.equal(result.bytes,6);
  }finally{globalThis.fetch=originalFetch;}
});

test('restoration refuses to overwrite a different existing image', async () => {
  const originalFetch=globalThis.fetch;globalThis.crypto ||= webcrypto;
  globalThis.fetch=async()=>new Response(JSON.stringify({users:[{localId:'owner',email:'owner@example.test'}]}));
  const env={FIREBASE_API_KEY:'test',ADMIN_EMAIL:'owner@example.test',MEDIA_BUCKET:bucket(),PRIVATE_BUCKET:bucket(),ENVIRONMENT:'preview',ALLOWED_ORIGINS:'https://example.test'};
  const target='media/2026/shared/existing/original.jpg',key='trash/2026-10-14/'+target;
  await env.MEDIA_BUCKET.put(key,new Uint8Array([1]),{customMetadata:{originalKey:target,assetRoot:'media/2026/shared/existing',variant:'original'}});await env.MEDIA_BUCKET.put(target,new Uint8Array([2]));
  try{const response=await worker.fetch(new Request('https://example.test/api/trash/restore',{method:'POST',headers:{Origin:'https://example.test',Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({key})}),env,{waitUntil(){}});assert.equal(response.status,409);assert.ok(await env.MEDIA_BUCKET.head(key));assert.equal((await env.MEDIA_BUCKET.get(target)).value[0],2);}finally{globalThis.fetch=originalFetch;}
});

test('resolving a draft retains compact photo references from both versions without copying image bytes', async () => {
 const originalFetch=globalThis.fetch;globalThis.crypto ||= webcrypto;
 globalThis.fetch=async()=>new Response(JSON.stringify({users:[{localId:'owner',email:'owner@example.test'}]}));
 const env={FIREBASE_API_KEY:'test',ADMIN_EMAIL:'owner@example.test',MEDIA_BUCKET:bucket(),PRIVATE_BUCKET:bucket(),ENVIRONMENT:'preview',ALLOWED_ORIGINS:'https://example.test'};
 try {
 const roots=['media/2026/shared/local-image','media/2026/shared/cloud-image'];
 const response=await worker.fetch(new Request('https://example.test/api/drafts/2026',{method:'PUT',headers:{Origin:'https://example.test',Authorization:'Bearer test','Content-Type':'application/json','If-Match':''},body:JSON.stringify({data:{year:2026,activities:[]},retainedMedia:roots})}),env,{waitUntil(){}});
 assert.equal(response.status,200);
 const snapshots=[...env.PRIVATE_BUCKET.items.values()].filter(item=>item.key.startsWith('private/history/'));
 assert.equal(snapshots.length,1);assert.deepEqual(JSON.parse(snapshots[0].value).data.media,[...roots].sort());assert.equal(env.MEDIA_BUCKET.items.size,0);
 }finally{globalThis.fetch=originalFetch;}
});

test('a photo reused in another year cannot be deleted even when absent from album previews', async()=>{
 const oldFetch=globalThis.fetch;globalThis.crypto ||= webcrypto;
 const root='media/2020/shared/photo',key=root+'/original.jpg';
 globalThis.fetch=async url=>{
  url=String(url);
  if(url.includes('identitytoolkit'))return new Response(JSON.stringify({users:[{localId:'owner',email:'owner@example.test'}]}));
  if(url.includes('/git/ref/'))return new Response(JSON.stringify({object:{sha:'a'.repeat(40)}}));
  const data=url.includes('media-usage.json')?{version:1,years:{2026:{revision:0,roots:[root]}}}:url.includes('index.json')?{years:[{year:2026}]}:{year:2026,meta:{revision:0},activities:[{id:'event',album:{manifest:'data/albums/2026/event.json',preview:[]}}]};
  return new Response(JSON.stringify({encoding:'base64',content:Buffer.from(JSON.stringify(data)).toString('base64')}));
 };
 const env={FIREBASE_API_KEY:'test',ADMIN_EMAIL:'owner@example.test',GITHUB_OWNER:'test',GITHUB_REPO:'test',GITHUB_TOKEN:'test',MEDIA_BUCKET:bucket(),PRIVATE_BUCKET:bucket(),ENVIRONMENT:'preview',ALLOWED_ORIGINS:'https://example.test'};
 await env.MEDIA_BUCKET.put(key,new Uint8Array([1]),{customMetadata:{assetRoot:root}});
 try {
  const res=await worker.fetch(new Request('https://example.test/api/media',{method:'DELETE',headers:{Origin:'https://example.test',Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({id:key})}),env,{waitUntil(){}});
  assert.equal(res.status,409);assert.equal((await res.json()).code,'MEDIA_IN_USE');assert.ok(await env.MEDIA_BUCKET.head(key));
 }finally{globalThis.fetch=oldFetch;}
});

test('compact year loads skip album expansion and individual albums use the pinned commit',async()=>{
 const oldFetch=globalThis.fetch;const requests=[];const revision='b'.repeat(40);
 globalThis.fetch=async url=>{
  url=String(url);requests.push(url);
  if(url.includes('identitytoolkit'))return new Response(JSON.stringify({users:[{localId:'owner',email:'owner@example.test'}]}));
  if(url.includes('/git/ref/'))return new Response(JSON.stringify({object:{sha:revision}}));
  const data=url.includes('/contents/data/albums/')?{images:[{id:'photo',src:'https://example.test/photo.jpg'}]}:{year:2026,activities:[{id:'event',album:{manifest:'data/albums/2026/event.json',count:1,preview:[]}}]};
  return new Response(JSON.stringify({content:Buffer.from(JSON.stringify(data)).toString('base64')}));
 };
 const env={FIREBASE_API_KEY:'test',ADMIN_EMAIL:'owner@example.test',GITHUB_OWNER:'test',GITHUB_REPO:'test',GITHUB_TOKEN:'test',ENVIRONMENT:'preview',ALLOWED_ORIGINS:'https://example.test'};
 const get=path=>worker.fetch(new Request('https://example.test'+path,{headers:{Origin:'https://example.test',Authorization:'Bearer test'}}),env,{waitUntil(){}});
 try{
  const compact=await get('/api/years/2026?compact=1');assert.equal(compact.status,200);const data=await compact.json();assert.ok(data.data.activities[0].album);assert.equal(requests.filter(u=>u.includes('/contents/data/albums/')).length,0);
  const album=await get('/api/years/2026/activities/event/media?revision='+revision);assert.equal(album.status,200);assert.equal((await album.json()).images.length,1);assert.ok(requests.filter(u=>u.includes('/contents/data/albums/')).every(u=>u.endsWith('ref='+revision)));
 }finally{globalThis.fetch=oldFetch;}
});
