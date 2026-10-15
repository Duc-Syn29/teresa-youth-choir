/*
 * Kho dữ liệu dùng chung cho website công khai và khu quản trị.
 * JSON/GitHub là nguồn đã xuất bản; R2 lưu ảnh; IndexedDB giữ cache và bản nháp.
 */
(function () {
  "use strict";

  const Schema = window.TeresaSchema || {};
  const YEAR_MIN = Number(Schema.YEAR_MIN || 2015);
  const YEAR_MAX = Number(Schema.maxYear?.() || Math.max(2027, new Date().getFullYear() + 1));
  const DB_NAME = "teresa-youth-choir-cache";
  const DB_VERSION = 4;
  const CACHE_RELEASE = "public-20261015";
  const CACHE_FRESH_MS = 5 * 60 * 1000;
  const CACHE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
  const CACHE_REFRESH_WINDOW_MS = 60 * 60 * 1000;
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const PREVIEW_PREFIX = "teresa-preview-year:";
  const memoryCache = new Map();
  const pendingJson = new Map();
  const pendingRefresh = new Map();
  let firebaseApp = null;
  let firebaseAuth = null;
  let mediaObserver = null;
  let adminSession = null;
  const adminYears = new Map();
  const pendingAdminYears = new Map();
  const adminAlbums = new Map();
  const cloudSyncTasks = new Map();
  const cloudDraftRevisions = new Map();

  const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const apiConfig = () => window.TERESA_API_CONFIG || {};
  const adminEmail = () => String(apiConfig().adminEmail || "").trim().toLowerCase();
  const normalizeYear = (value) => Schema.normalizeYear ? Schema.normalizeYear(value) : copy(value);
  const normalizeIndex = (value) => Schema.normalizeIndex ? Schema.normalizeIndex(value) : copy(value || { version: 1, years: [] });
  const mediaSource = (value, variant = "original") => Schema.mediaSource
    ? Schema.mediaSource(value, variant)
    : (typeof value === "string" ? value : value?.variants?.[variant] || value?.src || value?.url || "");

  function isFirebaseConfigured() {
    const config = window.FIREBASE_CONFIG;
    return Boolean(config?.apiKey && config.apiKey !== "YOUR_API_KEY" && window.firebase);
  }

  function isSourceApiConfigured() {
    return Boolean(String(apiConfig().endpoint || "").replace(/\/$/, ""));
  }

  function initFirebase() {
    if (!isFirebaseConfigured() || firebaseApp) return;
    try {
      firebaseApp = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(window.FIREBASE_CONFIG);
      firebaseAuth = window.firebase.auth();
    } catch (error) {
      console.warn("Không thể khởi tạo Firebase Auth:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFirebase);
  else initFirebase();

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Trình duyệt không hỗ trợ IndexedDB."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("years")) db.createObjectStore("years", { keyPath: "year" });
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
        if (!db.objectStoreNames.contains("index")) db.createObjectStore("index", { keyPath: "id" });
        if (!db.objectStoreNames.contains("albums")) db.createObjectStore("albums", { keyPath: "id" });
        if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("revisions")) {
          const revisions = db.createObjectStore("revisions", { keyPath: "id" });
          revisions.createIndex("year", "year", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Bộ nhớ trình duyệt đang được mở ở tab khác."));
    });
  }

  async function inStore(name, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      let request;
      try { request = action(tx.objectStore(name)); }
      catch (error) { db.close(); reject(error); return; }
      tx.oncomplete = () => { db.close(); resolve(request?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("Giao dịch bộ nhớ bị hủy.")); };
    });
  }

  async function safeStore(name, mode, action, fallback = undefined) {
    try { return await inStore(name, mode, action); }
    catch (error) {
      console.warn(`Không dùng được cache ${name}:`, error);
      return fallback;
    }
  }

  const age = (record) => Date.now() - new Date(record?.updatedAt || 0).getTime();
  const isFresh = (record) => Boolean(record?.data && record.release === CACHE_RELEASE && age(record) < CACHE_FRESH_MS);
  const isUsable = (record) => Boolean(record?.data && age(record) < CACHE_STALE_MS);

  function refreshPublished(key, loader) {
    if (pendingRefresh.has(key)) return;
    const task = Promise.resolve().then(loader).catch(() => {})
      .finally(() => pendingRefresh.delete(key));
    pendingRefresh.set(key, task);
  }

  async function readPublicCache(name, id) {
    if (!("indexedDB" in window)) return undefined;
    // Slow or blocked browser storage must not delay the network request.
    let timer;
    try {
      return await Promise.race([
        safeStore(name, "readonly", (store) => store.get(id)),
        new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), 80); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function fetchJson(path) {
    // Several widgets request the same index/year at startup. Share the request,
    // including its failure, and allow a fresh attempt once it has settled.
    if (pendingJson.has(path)) return pendingJson.get(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const request = (async () => {
      await Promise.resolve();
      try {
        const response = await fetch(path, { cache: "no-cache", signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Không thể tải ${path} (${response.status}).`);
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw new Error("Kết nối đang chậm. Vui lòng thử lại.");
        throw error;
      } finally {
        clearTimeout(timeout);
        pendingJson.delete(path);
      }
    })();
    pendingJson.set(path, request);
    return request;
  }

  function previewYear(year) {
    try {
      if (new URLSearchParams(window.location.search).get("preview") !== "1") return null;
      const raw = sessionStorage.getItem(`${PREVIEW_PREFIX}${year}`);
      return raw ? normalizeYear(JSON.parse(raw)) : null;
    } catch (_error) { return null; }
  }

  function setPreviewYear(year, data) {
    sessionStorage.setItem(`${PREVIEW_PREFIX}${Number(year)}`, JSON.stringify(normalizeYear(data)));
  }

  async function loadIndex(options = {}) {
    const key = "archive-index";
    const memory = memoryCache.get(key);
    if (!options.force && isFresh(memory)) return normalizeIndex(memory.data);
    const cached = memory || await readPublicCache("index", key);
    if (!options.force && isUsable(cached) && cached.release === CACHE_RELEASE && age(cached) < CACHE_REFRESH_WINDOW_MS) {
      memoryCache.set(key, cached);
      if (!isFresh(cached)) refreshPublished(key, () => loadIndex({ force: true }));
      return normalizeIndex(cached.data);
    }
    try {
      const data = normalizeIndex(await fetchJson("data/index.json"));
      const record = { id: key, data, release: CACHE_RELEASE, updatedAt: new Date().toISOString() };
      memoryCache.set(key, record);
      // Cache persistence is best effort; rendering must not wait for a disk write.
      void safeStore("index", "readwrite", (store) => store.put(record));
      return data;
    } catch (error) {
      if (isUsable(cached)) return normalizeIndex(cached.data);
      throw error;
    }
  }

  async function availableYears() {
    try {
      const boot = JSON.parse(document.querySelector?.("#archive-bootstrap")?.textContent || "null");
      if (Array.isArray(boot?.publicYears)) return boot.publicYears.map(Number).sort((a,b) => a-b);
    } catch (_) {}
    try { return (await loadIndex()).years.map((item) => Number(item.year)).filter(Number.isInteger).sort((a, b) => a - b); }
    catch (_error) { return Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, index) => YEAR_MIN + index); }
  }

  async function loadYear(year, options = {}) {
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < YEAR_MIN || numericYear > YEAR_MAX) throw new Error(`Năm phải trong khoảng ${YEAR_MIN}–${YEAR_MAX}.`);
    const preview = previewYear(numericYear);
    if (preview) return preview;
    if (!options.force) {
      try {
        const boot = JSON.parse(document.querySelector?.("#archive-bootstrap")?.textContent || "null");
        if (Number(boot?.year) === numericYear) return normalizeYear(boot);
      } catch (_) { /* An old or invalid boot payload falls back to JSON. */ }
    }
    const key = `year:${numericYear}`;
    const memory = memoryCache.get(key);
    if (!options.force && isFresh(memory)) return normalizeYear(memory.data);
    const cached = memory || await readPublicCache("years", numericYear);
    if (!options.force && isUsable(cached) && cached.release === CACHE_RELEASE && age(cached) < CACHE_REFRESH_WINDOW_MS) {
      memoryCache.set(key, cached);
      if (!isFresh(cached)) refreshPublished(key, () => loadYear(numericYear, { force: true }));
      return normalizeYear(cached.data);
    }
    try {
      const data = normalizeYear(await fetchJson(`data/${numericYear}.json`));
      const record = { year: numericYear, data, release: CACHE_RELEASE, updatedAt: new Date().toISOString() };
      memoryCache.set(key, record);
      void safeStore("years", "readwrite", (store) => store.put(record));
      return data;
    } catch (error) {
      if (isUsable(cached)) return normalizeYear(cached.data);
      throw error;
    }
  }

  async function loadAlbum(year, activityOrAlbum, options = {}) {
    const activity = activityOrAlbum || {};
    const inline = Array.isArray(activity.images) ? activity.images : Array.isArray(activity.photos) ? activity.photos : null;
    if (inline?.length) return inline.map((item) => Schema.normalizeMedia ? Schema.normalizeMedia(item) : item);
    const album = activity.album || activity;
    if (Array.isArray(album.images)) return album.images;
    if (!album.manifest) return [];
    const id = `${Number(year)}:${album.manifest}`;
    const memory = memoryCache.get(`album:${id}`);
    if (!options.force && isFresh(memory)) return memory.data.images || [];
    const cached = memory || await readPublicCache("albums", id);
    if (!options.force && isUsable(cached) && cached.release === CACHE_RELEASE && age(cached) < CACHE_REFRESH_WINDOW_MS) {
      memoryCache.set(`album:${id}`, cached);
      if (!isFresh(cached)) refreshPublished(`album:${id}`, () => loadAlbum(year, activityOrAlbum, { force: true }));
      return cached.data.images || [];
    }
    try {
      const data = await fetchJson(album.manifest);
      const images = (data.images || []).map((item) => Schema.normalizeMedia ? Schema.normalizeMedia(item) : item);
      const record = { id, data: { ...data, images }, release: CACHE_RELEASE, updatedAt: new Date().toISOString() };
      memoryCache.set(`album:${id}`, record);
      void safeStore("albums", "readwrite", (store) => store.put(record));
      return images;
    } catch (error) {
      if (isUsable(cached)) return cached.data.images || [];
      throw error;
    }
  }

  async function requireAdminToken() {
    initFirebase();
    const user = firebaseAuth?.currentUser;
    if (!user) throw new Error("Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.");
    return user.getIdToken();
  }

  async function api(path, options = {}) {
    if (!isSourceApiConfigured()) throw new Error("Chưa cấu hình địa chỉ Worker quản trị trong js/firebase-config.js.");
    if (adminSession && !["GET","HEAD"].includes(options.method || "GET") && !(adminSession.capabilities?.adminProtocol === 2 && adminSession.capabilities?.cloudDrafts)) throw new Error("Bản quản trị mới chưa được kích hoạt. Nội dung vẫn lưu trên máy; thêm ảnh và đăng bài sẽ mở sau khi cập nhật hoàn tất.");
    const token = await requireAdminToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${String(apiConfig().endpoint).replace(/\/$/, "")}${path}`, {
        ...options, signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(options.headers || {}) }
      });
      const body = await response.json();
      if (!response.ok) {
        const error = new Error(body.error || "Không thể kết nối máy chủ quản trị.");
        error.status = response.status; error.details = body.details || [];
        error.requestId = response.headers.get("X-Request-Id") || body.requestId || "";
        throw error;
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Kết nối quá chậm hoặc gián đoạn. Hãy thử lại; ảnh thành công vẫn được giữ.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function loadYearForAdmin(year, options = {}) {
    const numericYear = Number(year);
    if (!isSourceApiConfigured()) return loadYear(numericYear, { force: Boolean(options.force) });
    const cached = adminYears.get(numericYear);
    const restore = (entry) => {
      const data = normalizeYear(entry.data);
      Object.defineProperty(data, "_revision", { value: entry.revision || "", writable: true, enumerable: false, configurable: true });
      return data;
    };
    if (!options.force && cached && Date.now() - cached.at < 60000) return restore(cached);
    if (!pendingAdminYears.has(numericYear)) {
      const task = api(`/api/years/${numericYear}?compact=1`).then(response => {
        const entry = { data: response.data, revision: response.revision, at: Date.now() };
        adminYears.set(numericYear, entry); return entry;
      }).finally(() => pendingAdminYears.delete(numericYear));
      pendingAdminYears.set(numericYear, task);
    }
    return restore(await pendingAdminYears.get(numericYear));
  }

  async function loadActivityMedia(year, activity, revision) {
    if (Array.isArray(activity.images)) return activity.images;
    if (!activity.album?.manifest) return [];
    const key = `${year}:${activity.id}:${revision}`;
    if (!adminAlbums.has(key)) {
      const task = api(`/api/years/${Number(year)}/activities/${encodeURIComponent(activity.id)}/media?revision=${encodeURIComponent(revision || "")}`)
        .then(result => (result.images || []).map(item => Schema.normalizeMedia(item))).catch(error => { adminAlbums.delete(key); throw error; });
      adminAlbums.set(key, task);
    }
    return copy(await adminAlbums.get(key));
  }

  async function saveLocalRevision(data, label = "Bản trước khi xuất bản", required = false) {
    const timestamp = new Date().toISOString();
    const record = { id: `${data.year}:${timestamp}:${Math.random().toString(36).slice(2)}`, year: Number(data.year), timestamp, label, data: copy(data) };
    if (required) await inStore("revisions", "readwrite", (store) => store.put(record));
    else await safeStore("revisions", "readwrite", (store) => store.put(record));
    const all = await safeStore("revisions", "readonly", store => store.indexNames?.contains("year") ? store.index("year").getAll(Number(data.year)) : store.getAll(), []);
    const old = (all || []).filter((item) => Number(item.year) === Number(data.year)).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))).slice(12);
    if (old.length) await safeStore("revisions", "readwrite", (store) => { old.forEach((item)=>store.delete(item.id)); });
    return record;
  }

  async function saveYear(data, options = {}) {
    const normalized = normalizeYear(data);
    const validation = Schema.validateYear ? Schema.validateYear(normalized) : { valid: true, errors: [], warnings: [] };
    if (!validation.valid) {
      const error = new Error(`Dữ liệu chưa hợp lệ: ${validation.errors[0]?.message || validation.errors[0] || "hãy kiểm tra lại"}`);
      error.details = validation.errors;
      throw error;
    }
    if (normalized.year < YEAR_MIN || normalized.year > YEAR_MAX) throw new Error(`Năm phải trong khoảng ${YEAR_MIN}–${YEAR_MAX}.`);
    const previous = await safeStore("years", "readonly", (store) => store.get(normalized.year));
    if (previous?.data) await saveLocalRevision(previous.data);
    const response = await api(`/api/years/${normalized.year}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: normalized, baseRevision: options.baseRevision ?? data?._revision ?? "", mode: options.mode || "publish" })
    });
    adminYears.delete(normalized.year);
    const saved = normalizeYear(response.data || normalized);
    Object.defineProperty(saved, "_revision", { value: response.revision || "", writable: true, enumerable: false, configurable: true });
    const record = { year: saved.year, data: saved, updatedAt: new Date().toISOString() };
    memoryCache.set(`year:${saved.year}`, record);
    memoryCache.delete("archive-index");
    for (const key of memoryCache.keys()) {
      if (key.startsWith(`album:${saved.year}:`)) memoryCache.delete(key);
    }
    await Promise.all([
      safeStore("years", "readwrite", (store) => store.put(record)),
      safeStore("index", "readwrite", (store) => store.delete("archive-index")),
      safeStore("albums", "readwrite", (store) => store.clear()),
      safeStore("drafts", "readwrite", (store) => store.delete(String(saved.year)))
    ]);
    return saved;
  }

  const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function saveActivity(year, activity, currentData = null) {
    const data = currentData || await loadYearForAdmin(year);
    const next = { ...activity, id: activity.id || makeId(`${year}-activity`), images: activity.images || [] };
    const index = data.activities.findIndex((item) => item.id === next.id);
    if (index < 0) data.activities.push(next); else data.activities[index] = next;
    return { activity: next, data };
  }

  async function deleteActivity(year, activityId, currentData = null) {
    const data = currentData || await loadYearForAdmin(year);
    data.activities = data.activities.filter((item) => item.id !== activityId);
    return data;
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function imageVariant(file, maxEdge, label, quality, budgetBytes = Infinity) {
    const bitmap = await createImageBitmap(file, file.rawOrientation ? { imageOrientation: "none" } : {});
    const orientation = file.rawOrientation || 1;
    const swapped = orientation >= 5;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = swapped ? height : width;
    canvas.height = swapped ? width : height;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (orientation !== 1) {
      const matrices = { 2: [-1,0,0,1,width,0], 3: [-1,0,0,-1,width,height], 4: [1,0,0,-1,0,height], 5: [0,1,1,0,0,0], 6: [0,1,-1,0,height,0], 7: [0,-1,-1,0,height,width], 8: [0,-1,1,0,0,width] };
      context.transform(...matrices[orientation]);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    let type = "image/webp";
    let blob = await canvasBlob(canvas, type, quality);
    if (!blob || !blob.type.includes("webp")) {
      type = "image/jpeg";
      blob = await canvasBlob(canvas, type, quality);
    }
    if (!blob) throw new Error("Trình duyệt không thể tạo ảnh tối ưu.");
    // Bound encode work and preserve detail: quality never drops below .70.
    while (blob.size > budgetBytes && quality > .70) {
      quality = Math.max(.70, quality - .04);
      const candidate = await canvasBlob(canvas, type, quality);
      if (!candidate) break;
      if (candidate.size < blob.size) blob = candidate;
    }
    const extension = type === "image/webp" ? "webp" : "jpg";
    const base = String(file.name || "anh").replace(/\.[^.]+$/, "");
    return { file: new File([blob], `${base}-${label}.${extension}`, { type, lastModified: file.lastModified }), width: canvas.width, height: canvas.height, bytes: blob.size };
  }

  async function prepareImageVariants(file, metadata = {}) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file?.type)) throw new Error("Hãy chọn ảnh JPG, PNG, WebP hoặc AVIF. Ảnh RAW cần xuất sang JPG trước khi thêm.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Ảnh lớn hơn 25 MB. Hãy xuất ảnh JPG nhỏ hơn rồi thêm lại.");
    try {
      const thumbnail = await imageVariant(file, 480, "thumb", .74, 60 * 1024);
      const original = await imageVariant(file, metadata.purpose === "cover" ? 2560 : 2048, "web", .82, (metadata.purpose === "cover" ? 500 : 350) * 1024);
      // Worker aliases the missing medium to original: two stored files, three compatible URLs.
      return { thumbnail, original, originalBytes: file.size };
    } catch (_error) {
      throw new Error("Không thể tối ưu ảnh này. Hãy xuất lại thành JPG rồi thử lại; ảnh gốc chưa được tải lên.");
    }
  }

  async function saveMedia(file, metadata = {}) {
    const inputFile = window.TeresaRaw?.isRaw(file) ? await window.TeresaRaw.extract(file) : file;
    const prepared = await prepareImageVariants(inputFile, metadata);
    const form = new FormData();
    Object.entries(prepared).forEach(([variant, item]) => {
      if (variant === "originalBytes" || !item?.file) return;
      form.append(variant, item.file);
      form.append(`${variant}Width`, String(item.width || 0));
      form.append(`${variant}Height`, String(item.height || 0));
    });
    form.append("year", String(metadata.year || ""));
    form.append("topic", metadata.topic || "Khác");
    form.append("activityId", metadata.activityId || "");
    form.append("draftId", metadata.draftId || "");
    form.append("caption", metadata.caption || "");
    form.append("alt", metadata.alt || file.name);
    const media = await api("/api/media", { method: "POST", body: form });
    const normalized = Schema.normalizeMedia ? Schema.normalizeMedia(media) : media;
    normalized.id ||= media.id || media.src;
    normalized.year = Number(metadata.year);
    normalized.topic = metadata.topic || "Khác";
    normalized.filename = file.name;
    normalized.caption ||= metadata.caption || "";
    normalized.alt ||= metadata.alt || file.name;
    normalized.compression = {
      originalBytes: file.size,
      displayBytes: prepared.original.bytes,
      lightboxBytes: prepared.original?.bytes || file.size,
      originalPreserved: false,
      rawPreview: inputFile !== file,
      maxLightboxEdge: metadata.purpose === "cover" ? 2560 : 2048,
      storedBytes: prepared.thumbnail.bytes + prepared.original.bytes,
      storedVariants: 2,
    };
    await safeStore("media", "readwrite", (store) => store.put(normalized));
    return normalized;
  }

  async function listMedia(filters = {}) {
    if (isSourceApiConfigured() && firebaseAuth?.currentUser) {
      const query = new URLSearchParams({
        year: String(filters.year || ""),
        limit: String(Math.min(60, Math.max(1, Number(filters.limit || 24)))),
        ...(filters.cursor ? { cursor: filters.cursor } : {}),
        ...(filters.topic && filters.topic !== "Tất cả" ? { topic: filters.topic } : {}),
        ...(filters.activityId ? { activityId: filters.activityId } : {})
      });
      try {
        const response = await api(`/api/media?${query}`);
        const items = (response.items || []).map((item) => Schema.normalizeMedia ? Schema.normalizeMedia(item) : item);
        await Promise.all(items.map((item) => safeStore("media", "readwrite", (store) => store.put(item))));
        return { items, cursor: response.cursor || "", truncated: Boolean(response.truncated) };
      } catch (error) {
        console.warn("Không đọc được kho ảnh R2, dùng bộ nhớ cục bộ:", error);
      }
    }
    const all = (await safeStore("media", "readonly", (store) => store.getAll(), [])) || [];
    const filtered = all.filter((item) => (!filters.year || Number(item.year) === Number(filters.year)) && (!filters.topic || filters.topic === "Tất cả" || item.topic === filters.topic) && (!filters.activityId || item.activityId === filters.activityId));
    const offset = Number(filters.cursor || 0);
    const limit = Number(filters.limit || 24);
    return { items: filtered.slice(offset, offset + limit), cursor: offset + limit < filtered.length ? String(offset + limit) : "", truncated: offset + limit < filtered.length };
  }

  async function getMedia(filters = {}) {
    return (await listMedia({ ...filters, limit: filters.limit || 60 })).items;
  }

  async function deleteMedia(id) {
    const mediaId = String(id);
    await api("/api/media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mediaId, path: mediaId }) });
    await safeStore("media", "readwrite", (store) => store.delete(mediaId));
  }

  async function resolveSource(source, variant = "original") {
    if (!source) return "";
    if (typeof source === "object") return mediaSource(source, variant);
    if (String(source).startsWith("idb:")) {
      const item = await safeStore("media", "readonly", (store) => store.get(String(source).slice(4)));
      return mediaSource(item, variant) || "";
    }
    return String(source);
  }

  function ensureMediaObserver() {
    if (mediaObserver || !("IntersectionObserver" in window)) return mediaObserver;
    mediaObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        mediaObserver.unobserve(entry.target);
        loadMediaElement(entry.target);
      });
    }, { rootMargin: "240px 0px" });
    return mediaObserver;
  }

  async function loadMediaElement(element) {
    if (element.dataset.mediaLoadingStarted) return;
    element.dataset.mediaLoadingStarted = "true";
    element.classList.add("media-loading");
    const variant = element.dataset.mediaVariant || (element.tagName === "IMG" ? "thumbnail" : "medium");
    const src = await resolveSource(element.dataset.mediaSrc, variant);
    if (!src) { element.classList.add("media-ready", "media-missing"); return; }
    if (element.tagName === "IMG") {
      let finish;
      const ready = new Promise((resolve) => { finish = resolve; });
      let settled = false;
      const markReady = async () => {
        if (settled) return;
        settled = true;
        try { if (element.decode) await element.decode(); }
        catch (_error) { /* Ảnh vẫn được hiện nếu trình duyệt không hỗ trợ decode. */ }
        element.classList.add("media-ready");
        finish();
      };
      element.decoding = "async";
      element.fetchPriority = element.dataset.mediaPriority === "high" ? "high" : "low";
      if (element.dataset.mediaSizes) element.sizes = element.dataset.mediaSizes;
      // A landscape cover is painted wider than the viewport in a tall hero.
      // Account for that crop so high-DPI phones do not get a blurry thumbnail.
      if (element.dataset.mediaPriority === "high" && element.width && element.height) {
        const rect = element.getBoundingClientRect();
        const ratio = Number(element.getAttribute("width")) / Number(element.getAttribute("height"));
        if (rect.width && rect.height && ratio > 0) element.sizes = `${Math.ceil(Math.max(rect.width, rect.height * ratio))}px`;
      }
      if (element.dataset.mediaSrcset) element.srcset = element.dataset.mediaSrcset;
      element.addEventListener("load", markReady, { once: true });
      element.addEventListener("error", markReady, { once: true });
      element.src = src;
      if (element.complete) markReady();
      return ready;
    }
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = element.dataset.mediaPriority === "high" ? "high" : "low";
    image.src = src;
    try { if (image.decode) await image.decode(); }
    catch (_error) { /* vẫn kết thúc skeleton với ảnh trình duyệt có thể đọc */ }
    element.style.backgroundImage = `url("${src.replace(/["\\]/g, "\\$&")}")`;
    element.classList.add("media-ready");
  }

  async function hydrateMedia(root = document) {
    const elements = [...root.querySelectorAll("[data-media-src]:not([data-media-hydrated])")];
    const observer = ensureMediaObserver();
    const priorityLoads = [];
    elements.forEach((element) => {
      element.dataset.mediaHydrated = "true";
      if (element.dataset.mediaPriority === "high" || !observer) priorityLoads.push(loadMediaElement(element));
      else observer.observe(element);
    });
    await Promise.all(priorityLoads);
  }

  function getAuthErrorMessage(code) {
    if (["auth/user-not-found", "auth/wrong-password", "auth/invalid-credential"].includes(code)) return "Email hoặc mật khẩu không chính xác.";
    if (code === "auth/invalid-email") return "Định dạng email không hợp lệ.";
    if (code === "auth/too-many-requests") return "Tài khoản tạm thời bị khóa vì đăng nhập sai nhiều lần.";
    return `Lỗi đăng nhập: ${code || "không xác định"}`;
  }

  async function login(email, password) {
    initFirebase();
    if (!firebaseAuth) return { success: false, message: "Firebase Auth chưa được tải. Hãy kiểm tra cấu hình." };
    try {
      const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
      adminSession = await api("/api/session");
      return { success: true, user: credential.user };
    } catch (error) { adminSession = null; await firebaseAuth.signOut(); return { success: false, message: error.message || getAuthErrorMessage(error.code) }; }
  }

  function isAdmin() {
    initFirebase();
    return Boolean(firebaseAuth?.currentUser && adminSession);
  }

  function currentUser() {
    initFirebase();
    const user = firebaseAuth?.currentUser;
    if (!user) return null;
    return { uid: user.uid || "", email: user.email || "", name: user.displayName || user.email || "Quản trị viên" };
  }

  async function waitForAuth() {
    initFirebase();
    if (!firebaseAuth) return;
    await new Promise((resolve) => { let unsubscribe; unsubscribe = firebaseAuth.onAuthStateChanged(() => { resolve(); queueMicrotask(() => unsubscribe?.()); }); });
    if (firebaseAuth.currentUser) { try { adminSession = await api("/api/session"); } catch (_error) { adminSession = null; } }
  }

  async function logout() { initFirebase(); adminSession = null; adminYears.clear(); adminAlbums.clear(); cloudDraftRevisions.clear(); if (firebaseAuth) await firebaseAuth.signOut(); }

  async function changeCredentials(_email, password) {
    initFirebase();
    if (!firebaseAuth?.currentUser) throw new Error("Hãy đăng nhập lại để đổi mật khẩu.");
    if (password.length < 8) throw new Error("Mật khẩu cần ít nhất 8 ký tự.");
    await firebaseAuth.currentUser.updatePassword(password);
  }

  async function saveDraft(year, data, options = {}) {
    const record = {
      id: String(Number(year)),
      year: Number(year),
      data: normalizeYear(data),
      baseRevision: String(options.baseRevision || ""),
      updatedAt: new Date().toISOString(),
      editor: currentUser(),
      cloudRevision: cloudDraftRevisions.get(Number(year)) || "",
      retainedMedia: options.retainedMedia,
      localVersion: makeId("draft"),
    };
    // Bản nháp là dữ liệu bắt buộc; lỗi IndexedDB phải được báo cho người dùng.
    await inStore("drafts", "readwrite", (store) => store.put(record));
    if (adminSession?.capabilities?.cloudDrafts && !options.localOnly) {
      if (cloudSyncTasks.has(Number(year))) await cloudSyncTasks.get(Number(year));
      return syncDraft(year);
    }
    return record;
  }

  async function syncDraft(year) {
    year = Number(year);
    if (!adminSession?.capabilities?.cloudDrafts) return null;
    if (cloudSyncTasks.has(year)) return cloudSyncTasks.get(year);
    const task = (async () => {
      const record = await inStore("drafts", "readonly", store => store.get(String(year)));
      if (!record) return null;
      try {
        const response = await api(`/api/drafts/${year}`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": cloudDraftRevisions.get(year) || "" }, body: JSON.stringify(record) });
        cloudDraftRevisions.set(year, response.record.cloudRevision);
        record.cloudRevision = response.record.cloudRevision; record.cloudSynced = true;
        await inStore("drafts", "readwrite", store => {
          const request = store.get(String(year));
          request.onsuccess = () => {
            const latest = request.result;
            if (!latest) return;
            if (latest.localVersion === record.localVersion) store.put(record);
            else store.put({ ...latest, cloudRevision: record.cloudRevision, cloudSynced: false });
          };
          return request;
        });
      } catch (error) { record.cloudSynced = false; record.cloudError = error.message; if (error.status === 409) throw error; }
      return record;
    })().finally(() => cloudSyncTasks.delete(year));
    cloudSyncTasks.set(year, task); return task;
  }

  async function loadDraft(year) {
    let local = await safeStore("drafts", "readonly", (store) => store.get(String(Number(year))), null);
    if (!adminSession?.capabilities?.cloudDrafts) return local;
    let response;
    try { response = await api(`/api/drafts/${Number(year)}`); }
    catch (error) { if (local && ![401,403].includes(error.status)) return { ...local, cloudSynced: false, cloudError: error.message }; throw error; }
    const remote = response.record;
    local = await safeStore("drafts", "readonly", store => store.get(String(Number(year))), local);
    if (local && cloudSyncTasks.has(Number(year))) return local;
    cloudDraftRevisions.set(Number(year), response.cloudRevision || remote?.cloudRevision || "");
    if (local && local.cloudSynced !== true && JSON.stringify(local.data) !== JSON.stringify(remote?.data)) {
      if ((local.cloudRevision || "") !== (response.cloudRevision || remote?.cloudRevision || "")) return { ...local, conflict: true };
      return local;
    }
    if (local && String(local.updatedAt) > String(remote?.updatedAt || "")) return local;
    if (remote) { remote.cloudSynced = true; await safeStore("drafts", "readwrite", (store) => store.put(remote)); }
    return remote || local;
  }

  async function draftComparison(year, currentData, baseRevision) {
    if (!adminSession?.capabilities?.cloudDrafts) throw new Error("Chưa triển khai đồng bộ bản nháp.");
    const response = await api(`/api/drafts/${Number(year)}`);
    const local = { data: normalizeYear(currentData), baseRevision };
    let remote = response.record;
    if (!remote) { const published = await loadYearForAdmin(year, { force: true }); remote = { data: published, baseRevision: published._revision || "" }; }
    return { local, remote, revision: response.cloudRevision || remote.cloudRevision || "" };
  }

  async function resolveDraftComparison(year, data, comparison) {
    await saveLocalRevision(comparison.local.data, "Trước đối chiếu · bản trên máy", true);
    await saveLocalRevision(comparison.remote.data, "Trước đối chiếu · bản đồng bộ", true);
    const roots = new Set();
    const collect = (value) => {
      if (typeof value === "string") { let decoded=value; try { decoded=decodeURIComponent(value); } catch(_error) {} const match=/(?:^|\/)(media\/\d{4}\/[^/]+\/[^/?#\s]+)/.exec(decoded); if (match) roots.add(match[1]); }
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(comparison.local.data); collect(comparison.remote.data);
    cloudDraftRevisions.set(Number(year), comparison.revision);
    return saveDraft(year, data, { baseRevision: comparison.remote.baseRevision, retainedMedia: [...roots] });
  }

  async function clearDraft(year) {
    if (adminSession?.capabilities?.cloudDrafts) {
      const result = await api(`/api/drafts/${Number(year)}`, { method: "DELETE", headers: { "If-Match": cloudDraftRevisions.get(Number(year)) || "" } });
      cloudDraftRevisions.set(Number(year), result.cloudRevision || "");
    }
    return inStore("drafts", "readwrite", (store) => store.delete(String(Number(year))));
  }

  async function localRevisions(year) {
    const all = (await safeStore("revisions", "readonly", store => store.indexNames?.contains("year") ? store.index("year").getAll(Number(year)) : store.getAll(), [])) || [];
    return all.filter((item) => Number(item.year) === Number(year)).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 12);
  }

  async function getYearHistory(year) {
    if (!isSourceApiConfigured()) return { items: await localRevisions(year) };
    try { const response = await api(`/api/years/${Number(year)}/history`); return { ...response, items: [...(await localRevisions(year)), ...(response.items || [])] }; }
    catch (_error) { return { items: await localRevisions(year) }; }
  }

  async function loadYearRevision(year, revision) {
    if (revision?.data) return normalizeYear(revision.data);
    const response = await api(`/api/years/${Number(year)}/history/${encodeURIComponent(revision)}`);
    return normalizeYear(response.data);
  }

  async function exportArchive() {
    const years = [];
    const albums = {};
    const assets = new Map();
    const rememberMedia = (media) => {
      if (!media) return;
      const normalized = Schema.normalizeMedia ? Schema.normalizeMedia(media) : media;
      const key = mediaSource(normalized, "original") || mediaSource(normalized, "medium");
      if (key) assets.set(key, normalized);
    };
    const rememberMediaTree = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(rememberMediaTree); return; }
      Object.values(value).forEach(rememberMediaTree);
      if (mediaSource(value, "original") || mediaSource(value, "medium")) rememberMedia(value);
    };
    for (const year of await availableYears()) {
      const data = await loadYear(year);
      years.push({ year, data });
      const references = [
        ...(data.activities || []).map((activity) => ({ owner: activity, album: activity.album })),
        ...(data.galleryAlbum?.manifest ? [{ owner: data.galleryAlbum, album: data.galleryAlbum }] : []),
      ].filter((entry) => entry.album?.manifest);
      for (const entry of references) {
        const images = await loadAlbum(year, entry.owner);
        albums[entry.album.manifest] = {
          schemaVersion: 1,
          year,
          activityId: entry.owner.id || `${year}-year-gallery`,
          title: entry.owner.title || `Album năm ${year}`,
          count: images.length,
          images,
        };
        rememberMediaTree(images);
      }
      rememberMediaTree(data);
    }
    return {
      version: 4,
      exportedAt: new Date().toISOString(),
      note: "Bản sao lưu chứa toàn bộ JSON và danh sách tài sản. Tệp ảnh gốc vẫn được lưu riêng trong R2.",
      years,
      albums,
      assets: [...assets.values()],
    };
  }

  function analyzeArchive(archive) {
    if (!archive || !Array.isArray(archive.years)) return { valid: false, errors: ["Tệp sao lưu không đúng định dạng."], years: [] };
    const albumMap = archive.albums && typeof archive.albums === "object" ? archive.albums : {};
    const years = archive.years.map((item) => {
      const data = normalizeYear(item.data || item);
      data.activities = (data.activities || []).map((activity) => {
        const manifest = activity.album?.manifest;
        const album = manifest ? albumMap[manifest] : null;
        if (!Array.isArray(album?.images)) return activity;
        const expanded = { ...activity, images: album.images };
        delete expanded.album;
        return expanded;
      });
      if (data.galleryAlbum?.manifest && Array.isArray(albumMap[data.galleryAlbum.manifest]?.images)) {
        data.gallery = albumMap[data.galleryAlbum.manifest].images;
        delete data.galleryAlbum;
      }
      return data;
    });
    const errors = [];
    years.forEach((data) => {
      const result = Schema.validateYear ? Schema.validateYear(data) : { valid: true, errors: [] };
      if (!result.valid) errors.push(...result.errors.map((entry) => `${data.year}: ${entry.message || entry}`));
    });
    return { valid: !errors.length, errors, years, summary: `${years.length} năm · ${years.reduce((total, item) => total + (item.activities || []).length, 0)} hoạt động` };
  }

  async function importArchive(archive, options = {}) {
    const analysis = analyzeArchive(archive);
    if (!analysis.valid) throw new Error(analysis.errors[0]);
    if (options.dryRun !== false) return analysis;
    const selected = options.years?.length ? new Set(options.years.map(Number)) : null;
    const results = [];
    for (const data of analysis.years) {
      if (selected && !selected.has(Number(data.year))) continue;
      results.push(await saveYear(data, { mode: "import" }));
    }
    return { ...analysis, results };
  }

  window.TeresaStore = {
    inputLimit: (file) => window.TeresaRaw?.isRaw(file) ? window.TeresaRaw.MAX_RAW_BYTES : MAX_UPLOAD_BYTES,
    mediaReferences: (id) => api("/api/media/references", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }),
    listTrash: (year, cursor = "") => api(`/api/trash?year=${Number(year)}&cursor=${encodeURIComponent(cursor)}`),
    restoreTrash: (key) => api("/api/trash/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }),
    async trashPreview(key) {
      const token = await requireAdminToken();
      const response = await fetch(`${String(apiConfig().endpoint).replace(/\/$/, "")}/api/trash/preview?key=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Chưa lấy được ảnh xem trước.");
      return URL.createObjectURL(await response.blob());
    },
    mediaStats: (year) => api(`/api/media/stats?year=${Number(year)}`),
    listAccounts: () => api("/api/accounts"),
    changeAccount: (data, revision, remove = false) => api("/api/accounts", { method: remove ? "DELETE" : "POST", headers: { "Content-Type": "application/json", "If-Match": revision || "" }, body: JSON.stringify(data) }),
    async waitForPublished(data, onProgress = () => {}) {
      const expected = JSON.stringify(normalizeYear(data));
      for (let attempt = 0; attempt < 20; attempt++) {
        try { const value = await fetchJson(`data/${Number(data.year)}.json?publication=${Date.now()}`); if (JSON.stringify(normalizeYear(value)) === expected) return true; } catch (_error) { /* retry deployment propagation */ }
        onProgress(attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      return false;
    },
    isUpgradeReady: () => Boolean(adminSession?.capabilities?.adminProtocol === 2 && adminSession?.capabilities?.cloudDrafts),
    adminRole: () => adminSession?.role || "owner",
    YEAR_MIN, YEAR_MAX, availableYears, loadYear, loadYearForAdmin, loadActivityMedia, loadIndex, loadAlbum, syncDraft,
    saveYear, saveActivity, deleteActivity, saveMedia, listMedia, getMedia, deleteMedia,
    resolveSource, mediaSource, hydrateMedia, login, isAdmin, currentUser, logout, changeCredentials,
    draftComparison, resolveDraftComparison, saveDraft, loadDraft, clearDraft, localRevisions, getYearHistory, loadYearRevision,
    setPreviewYear, exportArchive, analyzeArchive, importArchive,
    isFirebaseConfigured, isSourceApiConfigured, waitForAuth, MAX_UPLOAD_BYTES
  };
})();
