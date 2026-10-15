import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';

function harness({ decodeFails = false, stalled = false, noisy = false } = {}) {
  let expire;
  const requests = [];
  const dimensions = [];
  const user = { email: 'editor@example.test', getIdToken: async () => 'test-token' };
  const app = {};
  const window = {
    FIREBASE_CONFIG: { apiKey: 'test' },
    TERESA_API_CONFIG: { endpoint: 'https://example.test', adminEmail: user.email },
    firebase: { apps: [app], app: () => app, auth: () => ({ currentUser: user }) },
  };
  vm.runInNewContext(readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), {
    window, File, FormData, URLSearchParams, AbortController, setTimeout: stalled ? (callback) => { expire=callback; return 1; } : setTimeout, clearTimeout: stalled ? () => {} : clearTimeout,
    console: { warn() {} },
    document: { readyState: 'complete', createElement() {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob(callback, type, quality) {
        dimensions.push([canvas.width, canvas.height]);
        callback(new Blob([noisy && canvas.width > 1000 ? new Uint8Array(quality > .74 ? 600000 : 300000) : 'optimized'], { type }));
      } }; return canvas;
    } },
    createImageBitmap: async () => { if (decodeFails) throw new Error('decode failed'); return { width: 6000, height: 4000, close() {} }; },
    fetch: async (_url, options) => { requests.push(options); if(stalled)return new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true})); return { ok: true, json: async () => ({ id: 'photo', src: 'https://example.test/photo' }) }; },
  });
  return { store: window.TeresaStore, requests, dimensions, expire: () => expire() };
}

test('new uploads store only two optimized files and use 2048px for the article and lightbox', async () => {
  const { store, requests, dimensions } = harness();
  const media = await store.saveMedia(new File(['input'], 'camera.jpg', { type: 'image/jpeg' }), { year: 2026 });
  const form = requests[0].body;
  assert.ok(form.get('thumbnail') instanceof File);
  assert.ok(form.get('original') instanceof File);
  assert.equal(form.get('medium'), null);
  assert.equal(dimensions[0][0], 480);
  assert.equal(dimensions[1][0], 2048);
  assert.equal(media.compression.storedVariants, 2);
});

test('covers use 2560px without creating a third duplicate file', async () => {
  const { store, requests, dimensions } = harness();
  await store.saveMedia(new File(['input'], 'cover.jpg', { type: 'image/jpeg' }), { year: 2026, purpose: 'cover' });
  assert.equal(dimensions[1][0], 2560);
  assert.equal(requests[0].body.get('medium'), null);
});

test('a failed decode never uploads the original camera file', async () => {
  const { store, requests } = harness({ decodeFails: true });
  await assert.rejects(store.saveMedia(new File(['broken'], 'bad.jpg', { type: 'image/jpeg' })), /ảnh gốc chưa được tải lên/);
  assert.equal(requests.length, 0);
});

test('unsupported RAW files are rejected before any upload', async () => {
  const { store, requests } = harness();
  await assert.rejects(store.saveMedia(new File(['raw'], 'camera.nef', { type: 'image/x-nikon-nef' })), /RAW/);
  assert.equal(requests.length, 0);
});

test('a stalled upload is aborted and reports that successful images remain available', async () => {
 const {store,requests,expire}=harness({stalled:true});
 const result=store.saveMedia(new File(['input'],'camera.jpg',{type:'image/jpeg'}),{year:2026});
 const rejected=assert.rejects(result,/Kết nối quá chậm hoặc gián đoạn/);
 await new Promise(resolve=>setImmediate(resolve)); expire(); await rejected;
 assert.equal(requests.length,1); assert.equal(requests[0].signal.aborted,true);
});


test('detailed photos are re-encoded toward a byte budget while still storing two variants', async()=>{
 const {store,requests,dimensions}=harness({noisy:true});
 const media=await store.saveMedia(new File(['input'],'detailed.jpg',{type:'image/jpeg'}),{year:2026});
 assert.equal(requests[0].body.get('original').size,300000);
 assert.ok(dimensions.length>2);assert.equal(media.compression.storedVariants,2);
});
