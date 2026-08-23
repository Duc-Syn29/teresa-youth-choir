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
  const CACHE_FRESH_MS = 30 * 60 * 1000;
  const CACHE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const PREVIEW_PREFIX = "teresa-preview-year:";
  const memoryCache = new Map();
  let firebaseApp = null;
  let firebaseAuth = null;
  let mediaObserver = null;

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
  const isFresh = (record) => Boolean(record?.data && age(record) < CACHE_FRESH_MS);
  const isUsable = (record) => Boolean(record?.data && age(record) < CACHE_STALE_MS);

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "default", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Không thể tải ${path} (${response.status}).`);
    return response.json();
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
    const cached = await safeStore("index", "readonly", (store) => store.get(key));
    if (!options.force && isFresh(cached)) {
      memoryCache.set(key, cached);
      return normalizeIndex(cached.data);
    }
    try {
      const data = normalizeIndex(await fetchJson("data/index.json"));
      const record = { id: key, data, updatedAt: new Date().toISOString() };
      memoryCache.set(key, record);
      await safeStore("index", "readwrite", (store) => store.put(record));
      return data;
    } catch (error) {
      if (isUsable(cached)) return normalizeIndex(cached.data);
      throw error;
    }
  }

  async function availableYears() {
    try { return (await loadIndex()).years.map((item) => Number(item.year)).filter(Number.isInteger).sort((a, b) => a - b); }
    catch (_error) { return Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, index) => YEAR_MIN + index); }
  }

  async function loadYear(year, options = {}) {
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < YEAR_MIN || numericYear > YEAR_MAX) throw new Error(`Năm phải trong khoảng ${YEAR_MIN}–${YEAR_MAX}.`);
    const preview = previewYear(numericYear);
    if (preview) return preview;
    const key = `year:${numericYear}`;
    const memory = memoryCache.get(key);
    if (!options.force && isFresh(memory)) return normalizeYear(memory.data);
    const cached = await safeStore("years", "readonly", (store) => store.get(numericYear));
    if (!options.force && isFresh(cached)) {
      memoryCache.set(key, cached);
      return normalizeYear(cached.data);
    }
    try {
      const data = normalizeYear(await fetchJson(`data/${numericYear}.json`));
      const record = { year: numericYear, data, updatedAt: new Date().toISOString() };
      memoryCache.set(key, record);
      await safeStore("years", "readwrite", (store) => store.put(record));
      return data;
    } catch (error) {
      if (isUsable(cached)) return normalizeYear(cached.data);
      throw error;
    }
  }

  async function loadAlbum(year, activityOrAlbum) {
    const activity = activityOrAlbum || {};
    const inline = Array.isArray(activity.images) ? activity.images : Array.isArray(activity.photos) ? activity.photos : null;
    if (inline?.length) return inline.map((item) => Schema.normalizeMedia ? Schema.normalizeMedia(item) : item);
    const album = activity.album || activity;
    if (Array.isArray(album.images)) return album.images;
    if (!album.manifest) return [];
    const id = `${Number(year)}:${album.manifest}`;
    const memory = memoryCache.get(`album:${id}`);
    if (isFresh(memory)) return memory.data.images || [];
    const cached = await safeStore("albums", "readonly", (store) => store.get(id));
    if (isFresh(cached)) return cached.data.images || [];
    try {
      const data = await fetchJson(album.manifest);
      const images = (data.images || []).map((item) => Schema.normalizeMedia ? Schema.normalizeMedia(item) : item);
      const record = { id, data: { ...data, images }, updatedAt: new Date().toISOString() };
      memoryCache.set(`album:${id}`, record);
      await safeStore("albums", "readwrite", (store) => store.put(record));
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
    if (!adminEmail() || user.email?.toLowerCase() !== adminEmail()) throw new Error("Tài khoản này không có quyền quản trị.");
    return user.getIdToken();
  }

  async function api(path, options = {}) {
    if (!isSourceApiConfigured()) throw new Error("Chưa cấu hình địa chỉ Worker quản trị trong js/firebase-config.js.");
    const token = await requireAdminToken();
    const response = await fetch(`${String(apiConfig().endpoint).replace(/\/$/, "")}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "Không thể kết nối máy chủ quản trị.");
      error.status = response.status;
      error.details = body.details || [];
      error.requestId = response.headers.get("X-Request-Id") || body.requestId || "";
      throw error;
    }
    return body;
  }

  async function loadYearForAdmin(year) {
    const numericYear = Number(year);
    if (!isSourceApiConfigured()) return loadYear(numericYear, { force: true });
    const response = await api(`/api/years/${numericYear}`);
    const data = normalizeYear(response.data);
    Object.defineProperty(data, "_revision", { value: response.revision || "", writable: true, enumerable: false, configurable: true });
    const record = { year: numericYear, data, updatedAt: new Date().toISOString() };
    memoryCache.set(`year:${numericYear}`, record);
    await safeStore("years", "readwrite", (store) => store.put(record));
    return data;
  }

  async function saveLocalRevision(data, label = "Bản trước khi xuất bản") {
    const timestamp = new Date().toISOString();
    const record = { id: `${data.year}:${timestamp}`, year: Number(data.year), timestamp, label, data: copy(data) };
    await safeStore("revisions", "readwrite", (store) => store.put(record));
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
    const saved = normalizeYear(response.data || normalized);
    Object.defineProperty(saved, "_revision", { value: response.revision || "", writable: true, enumerable: false, configurable: true });
    const record = { year: saved.year, data: saved, updatedAt: new Date().toISOString() };
    memoryCache.set(`year:${saved.year}`, record);
    memoryCache.delete("archive-index");
    await Promise.all([
      safeStore("years", "readwrite", (store) => store.put(record)),
      safeStore("index", "readwrite", (store) => store.delete("archive-index")),
      clearDraft(saved.year)
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

  async function imageVariant(file, maxEdge, label, quality) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    let type = "image/webp";
    let blob = await canvasBlob(canvas, type, quality);
    if (!blob || !blob.type.includes("webp")) {
      type = "image/jpeg";
      blob = await canvasBlob(canvas, type, quality);
    }
    if (!blob) throw new Error("Trình duyệt không thể tạo ảnh tối ưu.");
    const extension = type === "image/webp" ? "webp" : "jpg";
    const base = String(file.name || "anh").replace(/\.[^.]+$/, "");
    return { file: new File([blob], `${base}-${label}.${extension}`, { type, lastModified: file.lastModified }), width, height, bytes: blob.size };
  }

  async function prepareImageVariants(file) {
    if (!file?.type?.startsWith("image/") || file.type === "image/svg+xml") throw new Error("Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc AVIF.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Ảnh lớn hơn 25 MB. Hãy chọn ảnh nhỏ hơn.");
    try {
      // Tạo tuần tự để tránh tăng đột biến bộ nhớ trên iPhone.
      const thumbnail = await imageVariant(file, 480, "thumb", .76);
      const medium = await imageVariant(file, 1280, "medium", .82);
      const original = await imageVariant(file, 2048, "full", .87);
      return { thumbnail, medium, original, originalBytes: file.size };
    } catch (error) {
      console.warn("Không thể tạo đủ biến thể, tải ảnh gốc:", error);
      return { original: { file, width: 0, height: 0, bytes: file.size }, originalBytes: file.size };
    }
  }

  async function saveMedia(file, metadata = {}) {
    const prepared = await prepareImageVariants(file);
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
    normalized.filename ||= file.name;
    normalized.caption ||= metadata.caption || "";
    normalized.alt ||= metadata.alt || file.name;
    normalized.compression = { originalBytes: file.size, savedBytes: prepared.original.bytes };
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
    }, { rootMargin: "420px 0px" });
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
      const markReady = () => element.classList.add("media-ready");
      element.decoding = "async";
      element.fetchPriority = element.dataset.mediaPriority === "high" ? "high" : "low";
      if (element.dataset.mediaSrcset) element.srcset = element.dataset.mediaSrcset;
      if (element.dataset.mediaSizes) element.sizes = element.dataset.mediaSizes;
      element.addEventListener("load", markReady, { once: true });
      element.addEventListener("error", markReady, { once: true });
      element.src = src;
      if (element.complete) markReady();
      return;
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
    elements.forEach((element) => {
      element.dataset.mediaHydrated = "true";
      if (element.dataset.mediaPriority === "high" || !observer) loadMediaElement(element);
      else observer.observe(element);
    });
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
      if (credential.user.email?.toLowerCase() !== adminEmail()) {
        await firebaseAuth.signOut();
        return { success: false, message: "Email này không có quyền quản trị." };
      }
      return { success: true, user: credential.user };
    } catch (error) { return { success: false, message: getAuthErrorMessage(error.code) }; }
  }

  function isAdmin() {
    initFirebase();
    return Boolean(firebaseAuth?.currentUser && firebaseAuth.currentUser.email?.toLowerCase() === adminEmail());
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
    await new Promise((resolve) => firebaseAuth.onAuthStateChanged(() => resolve()));
  }

  async function logout() { initFirebase(); if (firebaseAuth) await firebaseAuth.signOut(); }

  async function changeCredentials(_email, password) {
    initFirebase();
    if (!firebaseAuth?.currentUser) throw new Error("Hãy đăng nhập lại để đổi mật khẩu.");
    if (password.length < 8) throw new Error("Mật khẩu cần ít nhất 8 ký tự.");
    await firebaseAuth.currentUser.updatePassword(password);
  }

  async function saveDraft(year, data) {
    const record = { id: String(Number(year)), year: Number(year), data: normalizeYear(data), updatedAt: new Date().toISOString(), editor: currentUser() };
    await safeStore("drafts", "readwrite", (store) => store.put(record));
    return record;
  }

  async function loadDraft(year) {
    return safeStore("drafts", "readonly", (store) => store.get(String(Number(year))), null);
  }

  async function clearDraft(year) {
    return safeStore("drafts", "readwrite", (store) => store.delete(String(Number(year))));
  }

  async function localRevisions(year) {
    const all = (await safeStore("revisions", "readonly", (store) => store.getAll(), [])) || [];
    return all.filter((item) => Number(item.year) === Number(year)).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 12);
  }

  async function getYearHistory(year) {
    if (!isSourceApiConfigured()) return { items: await localRevisions(year) };
    try { return await api(`/api/years/${Number(year)}/history`); }
    catch (_error) { return { items: await localRevisions(year) }; }
  }

  async function loadYearRevision(year, revision) {
    if (revision?.data) return normalizeYear(revision.data);
    const response = await api(`/api/years/${Number(year)}/history/${encodeURIComponent(revision)}`);
    return normalizeYear(response.data);
  }

  async function exportArchive() {
    const years = [];
    for (const year of await availableYears()) years.push({ year, data: await loadYear(year) });
    return { version: 3, exportedAt: new Date().toISOString(), years };
  }

  function analyzeArchive(archive) {
    if (!archive || !Array.isArray(archive.years)) return { valid: false, errors: ["Tệp sao lưu không đúng định dạng."], years: [] };
    const years = archive.years.map((item) => normalizeYear(item.data || item));
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
    YEAR_MIN, YEAR_MAX, availableYears, loadYear, loadYearForAdmin, loadIndex, loadAlbum,
    saveYear, saveActivity, deleteActivity, saveMedia, listMedia, getMedia, deleteMedia,
    resolveSource, mediaSource, hydrateMedia, login, isAdmin, currentUser, logout, changeCredentials,
    saveDraft, loadDraft, clearDraft, localRevisions, getYearHistory, loadYearRevision,
    setPreviewYear, exportArchive, analyzeArchive, importArchive,
    isFirebaseConfigured, isSourceApiConfigured, waitForAuth, MAX_UPLOAD_BYTES
  };
})();
