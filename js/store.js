/* Nguồn dữ liệu công khai: chỉ mục/nội dung JSON và ảnh Cloudflare R2. Firebase chỉ dùng xác thực. */
(function () {
  "use strict";

  const YEAR_MIN = 2015;
  const YEAR_MAX = 2026;
  const DB_NAME = "teresa-youth-choir-cache";
  const DB_VERSION = 2;
  let firebaseApp = null;
  let firebaseAuth = null;

  const copy = (value) => JSON.parse(JSON.stringify(value));
  const apiConfig = () => window.TERESA_API_CONFIG || {};
  const adminEmail = () => String(apiConfig().adminEmail || "").trim().toLowerCase();
  const topicLabels = { "phung-vu": "Phụng vụ", "thanh-le": "Thánh lễ", "le-quan-thay": "Lễ Quan thầy", "dai-le": "Đại lễ", "thanh-lap": "Thành lập", "phuc-sinh": "Phục Sinh", "giang-sinh": "Giáng Sinh", "thien-nguyen": "Thiện nguyện", "tinh-tam": "Tĩnh tâm", "gan-ket": "Gắn kết", "hoi-thao": "Hội thao", "hoa-nhac": "Hòa nhạc", "cong-doan": "Cộng đoàn", khac: "Khác" };
  const topicLabel = (value) => topicLabels[value] || value || "Khác";

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
      const result = indexedDB.open(DB_NAME, DB_VERSION);
      result.onupgradeneeded = () => {
        const db = result.result;
        if (!db.objectStoreNames.contains("years")) db.createObjectStore("years", { keyPath: "year" });
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
        if (!db.objectStoreNames.contains("index")) db.createObjectStore("index", { keyPath: "id" });
      };
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
  }

  async function inStore(name, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const result = action(tx.objectStore(name));
      tx.oncomplete = () => { db.close(); resolve(result?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  function normalizeYear(data) {
    const next = copy(data);
    next.year = Number(next.year);
    if (next.leadership) {
      const { deputyConductor, secretary, ...leadership } = next.leadership;
      const teams = (leadership.teams || leadership.serviceTeams || []).map((team) => {
        const normalized = typeof team === "string" ? { name: team, members: [] } : team;
        return {
          ...normalized,
          members: (normalized.members || []).map((member) => typeof member === "string"
            ? { name: member, photo: "" }
            : { name: member?.name || "", photo: member?.photo || "" }).filter((member) => member.name)
        };
      });
      next.leadership = {
        ...leadership,
        teams,
        serviceTeams: teams.map((team) => team.name)
      };
    }
    next.activities = (next.activities || []).map((activity, index) => ({
      ...activity,
      id: activity.id || `${next.year}-activity-${index + 1}`,
      body: activity.body || activity.description || "",
      images: activity.images || [],
      topic: activity.topic || activity.type || "Khác"
    }));
    return next;
  }

  function normalizeIndex(data) {
    const next = copy(data || {});
    next.version = Number(next.version) || 1;
    next.years = (next.years || []).map((year) => ({
      ...year,
      year: Number(year.year),
      members: year.members || {},
      leadership: year.leadership || [],
      events: (year.events || []).map((event, index) => ({
        ...event,
        id: event.id || `${year.year}-activity-${index + 1}`,
        type: event.type || "Khác",
        image: event.image || "images/hero.jpg"
      }))
    })).filter((year) => Number.isInteger(year.year)).sort((a, b) => b.year - a.year);
    next.totals = next.totals || { years: next.years.length, members: 0, activities: next.years.reduce((total, year) => total + year.events.length, 0) };
    return next;
  }

  async function loadIndex() {
    const cached = await inStore("index", "readonly", (store) => store.get("archive-index"));
    if (cached?.data && Date.now() - new Date(cached.updatedAt || 0).getTime() < 10 * 60 * 1000) return normalizeIndex(cached.data);
    const response = await fetch(`data/index.json?updated=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const data = normalizeIndex(await response.json());
      await inStore("index", "readwrite", (store) => store.put({ id: "archive-index", data, updatedAt: new Date().toISOString() }));
      return data;
    }
    if (cached?.data) return normalizeIndex(cached.data);
    throw new Error("Không thể đọc chỉ mục tư liệu.");
  }

  async function loadYear(year) {
    const numericYear = Number(year);
    const cached = await inStore("years", "readonly", (store) => store.get(numericYear));
    if (cached?.data && Date.now() - new Date(cached.updatedAt || 0).getTime() < 10 * 60 * 1000) return normalizeYear(cached.data);
    const response = await fetch(`data/${numericYear}.json?updated=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const data = normalizeYear(await response.json());
      await inStore("years", "readwrite", (store) => store.put({ year: numericYear, data, updatedAt: new Date().toISOString() }));
      return data;
    }
    const stored = await inStore("years", "readonly", (store) => store.get(numericYear));
    if (stored?.data) return normalizeYear(stored.data);
    throw new Error(`Không thể đọc dữ liệu năm ${numericYear}.`);
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
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Không thể kết nối máy chủ quản trị.");
    return body;
  }

  async function saveYear(data) {
    const normalized = normalizeYear(data);
    if (normalized.year < YEAR_MIN || normalized.year > YEAR_MAX) throw new Error("Năm phải trong khoảng 2015–2026.");
    await api(`/api/years/${normalized.year}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized)
    });
    await inStore("years", "readwrite", (store) => store.put({ year: normalized.year, data: normalized, updatedAt: new Date().toISOString() }));
    return normalized;
  }

  const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function saveActivity(year, activity) {
    const data = await loadYear(year);
    const next = { ...activity, id: activity.id || makeId(`${year}-activity`), images: activity.images || [] };
    const index = data.activities.findIndex((item) => item.id === next.id);
    if (index < 0) data.activities.push(next); else data.activities[index] = next;
    await saveYear(data);
    return next;
  }

  async function deleteActivity(year, activityId) {
    const data = await loadYear(year);
    data.activities = data.activities.filter((item) => item.id !== activityId);
    await saveYear(data);
  }

  async function compressImage(file) {
    const unchanged = { file, compressed: false, originalBytes: file.size, savedBytes: file.size };
    if (!file?.type?.startsWith("image/") || /image\/(gif|svg\+xml)/.test(file.type)) return unchanged;
    try {
      const bitmap = await createImageBitmap(file);
      const longest = Math.max(bitmap.width, bitmap.height);
      // 2048 px vẫn sắc nét trên màn hình desktop/Retina nhưng nhẹ hơn đáng kể cho 4G/5G.
      const scale = Math.min(1, 2048 / longest);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .84));
      if (!blob || blob.size >= file.size) return unchanged;
      const name = file.name + ".jpg";
      return { file: new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified }), compressed: true, originalBytes: file.size, savedBytes: blob.size };
    } catch (error) {
      console.warn("Không thể nén ảnh, sẽ tải ảnh gốc:", error);
      return unchanged;
    }
  }

  async function saveMedia(file, metadata = {}) {
    if (!file?.type?.startsWith("image/")) throw new Error("Vui lòng chọn một tệp ảnh.");
    const prepared = await compressImage(file);
    file = prepared.file;
    if (file.size > 25 * 1024 * 1024) throw new Error("Ảnh sau khi nén vẫn lớn hơn 25 MB. Hãy chọn ảnh nhỏ hơn.");
    const form = new FormData();
    form.append("file", file);
    form.append("year", String(metadata.year || ""));
    form.append("topic", metadata.topic || "Khác");
    form.append("caption", metadata.caption || "");
    form.append("alt", metadata.alt || file.name);
    const media = await api("/api/media", { method: "POST", body: form });
    const normalized = { ...media, id: media.id || media.src, year: Number(metadata.year), topic: metadata.topic || "Khác", filename: media.filename || file.name, caption: metadata.caption || "", alt: metadata.alt || file.name };
    await inStore("media", "readwrite", (store) => store.put(normalized));
    return { ...normalized, compression: prepared.compressed ? { originalBytes: prepared.originalBytes, savedBytes: prepared.savedBytes } : null };
  }

  async function getMedia(filters = {}) {
    let media = [];
    if (isSourceApiConfigured() && firebaseAuth?.currentUser) {
      try {
        const response = await api(`/api/media?year=${encodeURIComponent(filters.year || "")}`);
        media = (response.items || []).map((item) => ({ ...item, topic: topicLabel(item.topic) }));
        await Promise.all(media.map((item) => inStore("media", "readwrite", (store) => store.put(item))));
      } catch (error) { console.warn("Không đọc được kho ảnh R2, dùng bộ nhớ cục bộ:", error); }
    }
    if (!media.length) media = (await inStore("media", "readonly", (store) => store.getAll())) || [];
    return media.filter((item) => (!filters.year || Number(item.year) === Number(filters.year)) && (!filters.topic || filters.topic === "Tất cả" || item.topic === filters.topic));
  }

  async function deleteMedia(path) {
    const id = String(path);
    await api("/api/media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: id }) });
    await inStore("media", "readwrite", (store) => store.delete(id));
  }

  async function resolveSource(source) {
    if (!source) return "images/hero.jpg";
    if (source.startsWith("idb:")) {
      const item = await inStore("media", "readonly", (store) => store.get(source.slice(4)));
      return item?.src || "images/hero.jpg";
    }
    return source;
  }

  async function hydrateMedia(root = document) {
    const elements = [...root.querySelectorAll("[data-media-src]:not([data-media-hydrated])")];
    const loadBackground = async (element, src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      try {
        if (image.decode) await image.decode();
        else await new Promise((resolve) => { image.onload = image.onerror = resolve; });
      } catch (_error) {
        // Vẫn hiển thị ảnh nếu trình duyệt không hỗ trợ decode() đầy đủ.
      }
      element.style.backgroundImage = `url("${src}")`;
      element.classList.add("media-ready");
    };

    await Promise.all(elements.map(async (element) => {
      element.dataset.mediaHydrated = "true";
      element.classList.add("media-loading");
      const src = await resolveSource(element.dataset.mediaSrc);
      if (element.tagName === "IMG") {
        element.decoding = "async";
        element.fetchPriority = element.dataset.mediaPriority === "high" ? "high" : "low";
        element.addEventListener("load", () => element.classList.add("media-ready"), { once: true });
        element.addEventListener("error", () => element.classList.add("media-ready"), { once: true });
        element.src = src;
        return;
      }

      if (element.dataset.mediaPriority === "high" || !("IntersectionObserver" in window)) {
        await loadBackground(element, src);
        return;
      }
      const observer = new IntersectionObserver(([entry], currentObserver) => {
        if (!entry.isIntersecting) return;
        currentObserver.disconnect();
        loadBackground(element, src);
      }, { rootMargin: "600px 0px" });
      observer.observe(element);
    }));
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

  async function exportArchive() {
    const years = [];
    for (let year = YEAR_MIN; year <= YEAR_MAX; year += 1) years.push({ year, data: await loadYear(year) });
    return { version: 2, exportedAt: new Date().toISOString(), years };
  }

  async function importArchive(archive) {
    if (!archive || !Array.isArray(archive.years)) throw new Error("Tệp sao lưu không đúng định dạng.");
    for (const item of archive.years) await saveYear(item.data || item);
  }

  window.TeresaStore = { YEAR_MIN, YEAR_MAX, loadYear, loadIndex, saveYear, saveActivity, deleteActivity, saveMedia, getMedia, deleteMedia, resolveSource, hydrateMedia, login, isAdmin, logout, changeCredentials, exportArchive, importArchive, isFirebaseConfigured, isSourceApiConfigured, waitForAuth };
})();
