import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Schema = require("../js/schema.js");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function storeHarness(fetch, timers = {}) {
  const window = { TeresaSchema: Schema, location: { search: "" } };
  vm.runInNewContext(read("js/store.js"), {
    window, document: { readyState: "loading", addEventListener() {} },
    fetch, URLSearchParams, AbortController, setTimeout, clearTimeout,
    console: { warn() {} }, ...timers,
  });
  return window.TeresaStore;
}

test("concurrent homepage consumers share one index request and can retry a failure", async () => {
  let requests = 0;
  let release;
  let fail = true;
  const store = storeHarness(async () => {
    requests++;
    await new Promise((resolve) => { release = resolve; });
    return { ok: !fail, status: 503, json: async () => JSON.parse(read("data/index.json")) };
  });
  const first = Promise.allSettled([store.loadIndex(), store.loadIndex(), store.loadIndex()]);
  await tick();
  assert.equal(requests, 1);
  release();
  assert.ok((await first).every((entry) => entry.status === "rejected"));
  fail = false;
  const retry = store.loadIndex();
  await tick();
  assert.equal(requests, 2);
  release();
  assert.equal((await retry).years.length, 12);
  await store.loadIndex();
  assert.equal(requests, 2, "warm navigation should reuse memory cache");
});

test("a stalled public request is aborted and reports a retryable error", async () => {
  let expire;
  const store = storeHarness((_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), { setTimeout(callback) { expire = callback; return 1; }, clearTimeout() {} });
  const result = store.loadIndex();
  const rejected = assert.rejects(result, /Kết nối đang chậm/);
  await tick();
  expire();
  await rejected;
});

test("draft save reports storage failure instead of claiming success", async () => {
  const store = storeHarness(async () => ({ ok: true, json: async () => ({}) }));
  await assert.rejects(store.saveDraft(2020, JSON.parse(read("data/2020.json"))), /IndexedDB/);
});

test("JSON backup includes every external album and its full photo list", async () => {
  const store = storeHarness(async (path) => ({
    ok: true,
    json: async () => JSON.parse(read(String(path))),
  }));
  const archive = await store.exportArchive();
  assert.equal(archive.version, 4);
  assert.equal(archive.years.length, 12);
  const expectedManifests = archive.years.flatMap(({ data }) => [
    ...(data.activities || []).map((activity) => activity.album?.manifest),
    data.galleryAlbum?.manifest,
  ]).filter(Boolean);
  assert.equal(Object.keys(archive.albums).length, new Set(expectedManifests).size);
  assert.ok(Object.values(archive.albums).reduce((total, album) => total + album.images.length, 0) > 500);
  assert.ok(archive.assets.length > 300);
  const analysis = store.analyzeArchive(archive);
  assert.equal(analysis.valid, true);
  assert.ok(analysis.years.some((year) => year.activities.some((activity) => (activity.images || []).length > 3)));
});

test("article renders before its album; an album failure and retry preserve the story", async () => {
  const data = Schema.normalizeYear(JSON.parse(read("data/2020.json")));
  let render;
  let rejectAlbum;
  let retry;
  let attempts = 0;
  const album = {
    dataset: {}, innerHTML: "", setAttribute() {},
    querySelector: () => ({ addEventListener(_type, callback) { retry = callback; } }),
  };
  const count = { textContent: "" };
  const app = {
    hidden: true, innerHTML: "",
    querySelector(selector) {
      if (selector === "[data-activity-gallery]") return album;
      if (["[data-gallery-count]", "[data-photo-count]"].includes(selector)) return count;
      return null;
    },
    querySelectorAll: () => [],
  };
  const loading = { hidden: false };
  const window = {
    location: { search: "?year=2020&id=2020-retreat-thien-ha" },
    matchMedia: () => ({ matches: true }), TeresaSchema: Schema,
    TeresaStore: {
      mediaSource: Schema.mediaSource,
      loadYear: async () => data, isAdmin: () => false,
      hydrateMedia: async () => {},
      loadAlbum() {
        attempts++;
        if (attempts > 1) return Promise.resolve([]);
        return new Promise((_resolve, reject) => { rejectAlbum = reject; });
      },
    },
  };
  vm.runInNewContext(read("js/activity.js"), {
    window, URLSearchParams, console,
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: {
      querySelector: (selector) => selector === "#activity-app" ? app : selector === "#activity-loading" ? loading : {},
      addEventListener(type, callback) { if (type === "DOMContentLoaded") render = callback; },
      dispatchEvent() {},
    },
  });
  await render();
  assert.equal(app.hidden, false);
  assert.equal(loading.hidden, true);
  assert.match(app.innerHTML, /activity-story-section/);
  assert.match(app.innerHTML, /Ngày 20–21\/6/);
  assert.equal(album.dataset.loading, "true", "album is still pending while story is visible");
  const storyBefore = app.innerHTML;
  rejectAlbum(new Error("offline"));
  await tick();
  assert.equal(app.innerHTML, storyBefore);
  assert.match(album.innerHTML, /Thử tải lại ảnh/);
  await retry();
  assert.equal(attempts, 2);
  assert.equal(app.innerHTML, storyBefore);
  assert.match(album.innerHTML, /Kho ảnh đang được hoàn thiện/);
});

test("initial album filter events cannot overwrite the saved return position", () => {
  const handlers = new Map();
  const frames = [];
  const state = { scrollY: 2800, pending: true, activityRendered: 16, savedAt: Date.now() };
  const history = { state: { teresaView: state }, replaceState(next) { this.state = next; } };
  const storage = new Map();
  const app = { hidden: false, children: [{}], querySelector: () => null };
  const document = {
    body: { classList: { contains: () => true } }, referrer: "",
    documentElement: { classList: { add() {}, remove() {} } },
    querySelector: (selector) => selector === "#year-app" || selector === "#year-app, #activity-app" ? app : null,
    querySelectorAll: () => [],
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    dispatchEvent(event) { for (const fn of handlers.get(event.type) || []) fn(event); },
  };
  let restoredTop;
  const location = { pathname: "/year.html", search: "?year=2018", hash: "", origin: "http://localhost" };
  const window = { location, scrollY: 0, addEventListener() {}, setTimeout(fn) { frames.push(fn); }, scrollTo({ top }) { restoredTop = top; } };
  const main = read("js/main.js");
  const fn = main.slice(main.indexOf("  function initPageReturn()"), main.indexOf("  function initPageTransitions()"));
  vm.runInNewContext(`(${fn})()`, {
    document, window, location, history,
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: (callback) => frames.push(callback),
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  });
  document.dispatchEvent({ type: "teresa:view-state", detail: { albumFilter: "all" } });
  assert.equal(history.state.teresaView.scrollY, 2800);
  assert.equal(history.state.teresaView.activityRendered, 16);
  document.dispatchEvent({ type: "teresa:content-ready" });
  while (frames.length) frames.shift()();
  assert.equal(restoredTop, 2800);
  assert.equal(history.state.teresaView.pending, false);
});
