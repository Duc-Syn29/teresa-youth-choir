/* Kho dữ liệu cho Digital Memory Archive.
 * Hỗ trợ lưu trữ Đám mây (Firebase Firestore + Auth + Cloudflare R2)
 * và lưu trữ cục bộ phía trình duyệt (IndexedDB) làm dự phòng.
 */
(function () {
  "use strict";

  const DB_NAME = "teresa-youth-choir-archive";
  const DB_VERSION = 1;
  const YEAR_MIN = 2015;
  const YEAR_MAX = 2026;
  const ADMIN_KEY = "archive-admin";
  const SESSION_KEY = "teresa-admin-session";

  // Khởi tạo Firebase nếu có cấu hình hợp lệ
  let firebaseApp = null;
  let firebaseAuth = null;
  let firestoreDb = null;

  function isFirebaseConfigured() {
    const config = window.FIREBASE_CONFIG;
    return Boolean(config && config.apiKey && config.apiKey !== "YOUR_API_KEY" && window.firebase);
  }

  function initFirebase() {
    if (isFirebaseConfigured() && !firebaseApp) {
      try {
        if (!window.firebase.apps.length) {
          firebaseApp = window.firebase.initializeApp(window.FIREBASE_CONFIG);
        } else {
          firebaseApp = window.firebase.app();
        }
        firebaseAuth = window.firebase.auth();
        firestoreDb = window.firebase.firestore();
        console.log("🔥 Đã kết nối Firebase (Auth & Firestore) thành công.");
      } catch (error) {
        console.warn("⚠️ Không thể kết nối Firebase, sẽ dùng IndexedDB cục bộ:", error);
      }
    }
  }

  // Tự động khởi tạo khi thư viện Firebase được nhúng
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFirebase);
  } else {
    initFirebase();
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("years")) db.createObjectStore("years", { keyPath: "year" });
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function request(storeName, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const result = action(store);
      transaction.oncomplete = () => { db.close(); resolve(result?.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    });
  }

  const copy = (data) => JSON.parse(JSON.stringify(data));
  const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function normalizeYear(data) {
    const normalized = copy(data);
    normalized.activities = (normalized.activities || []).map((activity, index) => ({
      ...activity,
      id: activity.id || `${normalized.year}-activity-${index + 1}`,
      body: activity.body || activity.description || "",
      images: activity.images || [],
      topic: activity.topic || activity.type || "Khác",
    }));
    return normalized;
  }

  async function loadYear(year) {
    initFirebase();
    const numYear = Number(year);

    // 1. Nếu có Firestore, thử lấy dữ liệu đám mây thời gian thực
    if (firestoreDb) {
      try {
        const docRef = firestoreDb.collection("years").doc(String(numYear));
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = normalizeYear(docSnap.data());
          // Lưu bản sao xuống IndexedDB để dùng khi offline
          await request("years", "readwrite", (store) => store.put({ year: numYear, data, updatedAt: new Date().toISOString() }));
          return data;
        }
      } catch (error) {
        console.warn(`[Firestore] Đọc năm ${year} thất bại, chuyển sang IndexedDB/JSON:`, error);
      }
    }

    // 2. Thử đọc từ IndexedDB cục bộ
    const stored = await request("years", "readonly", (store) => store.get(numYear));
    if (stored?.data) return normalizeYear(stored.data);

    // 3. Đọc từ file JSON tĩnh dự phòng
    const response = await fetch(`data/${year}.json`);
    if (!response.ok) throw new Error(`Không thể đọc dữ liệu năm ${year}`);
    return normalizeYear(await response.json());
  }

  async function saveYear(data) {
    initFirebase();
    const normalized = normalizeYear(data);
    const numYear = Number(normalized.year);

    // 1. Lưu lên Firestore đám mây nếu có kết nối
    if (firestoreDb) {
      try {
        await firestoreDb.collection("years").doc(String(numYear)).set(normalized);
        console.log(`☁️ Đã lưu dữ liệu năm ${numYear} lên Firestore.`);
      } catch (error) {
        console.error(`[Firestore] Không thể lưu năm ${numYear}:`, error);
        throw new Error(`Không thể lưu lên Firestore Đám mây: ${error.message}`);
      }
    }

    // 2. Lưu bản sao vào IndexedDB trình duyệt
    await request("years", "readwrite", (store) => store.put({ year: numYear, data: normalized, updatedAt: new Date().toISOString() }));
    return normalized;
  }

  async function saveActivity(year, activity) {
    const data = await loadYear(year);
    const next = { ...activity, id: activity.id || id(`${year}-activity`), images: activity.images || [] };
    const existing = data.activities.findIndex((item) => item.id === next.id);
    if (existing === -1) data.activities.push(next);
    else data.activities[existing] = next;
    await saveYear(data);
    return next;
  }

  async function deleteActivity(year, activityId) {
    const data = await loadYear(year);
    data.activities = data.activities.filter((activity) => activity.id !== activityId);
    await saveYear(data);
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function saveMedia(file, metadata = {}) {
    if (!file?.type?.startsWith("image/")) throw new Error("Vui lòng chọn một tệp ảnh.");
    if (file.size > 25 * 1024 * 1024) throw new Error("Mỗi ảnh tối đa 25 MB.");

    initFirebase();
    const r2Config = window.CLOUDFLARE_R2_CONFIG || {};
    let imageUrl = "";

    // 1. Tải ảnh lên Cloudflare R2 nếu có endpoint
    if (r2Config.uploadEndpoint) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("year", metadata.year || "");
        formData.append("topic", metadata.topic || "");

        const response = await fetch(r2Config.uploadEndpoint, {
          method: "POST",
          body: formData
        });
        if (!response.ok) throw new Error("Lỗi tải ảnh lên Cloudflare R2");
        const result = await response.json();
        imageUrl = result.url || result.src;
      } catch (error) {
        console.warn("⚠️ Upload R2 thất bại, tự động dùng DataURL:", error);
      }
    }

    // 2. Nếu không có R2 hoặc upload thất bại, chuyển thành DataURL
    if (!imageUrl) {
      imageUrl = await fileToDataURL(file);
    }

    const media = {
      id: id("image"),
      year: Number(metadata.year),
      topic: metadata.topic || "Khác",
      filename: file.name,
      alt: metadata.alt || file.name,
      caption: metadata.caption || "",
      dataUrl: imageUrl,
      src: imageUrl,
      createdAt: new Date().toISOString(),
    };

    // Lưu vào Firestore nếu có
    if (firestoreDb) {
      try {
        await firestoreDb.collection("media").doc(media.id).set(media);
      } catch (err) {
        console.warn("[Firestore] Không thể lưu media metadata:", err);
      }
    }

    // Lưu vào IndexedDB
    await request("media", "readwrite", (store) => store.put(media));
    return media;
  }

  async function getMedia(filters = {}) {
    initFirebase();
    if (firestoreDb) {
      try {
        let ref = firestoreDb.collection("media");
        if (filters.year) ref = ref.where("year", "==", Number(filters.year));
        const snapshot = await ref.get();
        if (!snapshot.empty) {
          const media = snapshot.docs.map((doc) => doc.data());
          if (filters.topic && filters.topic !== "Tất cả") {
            return media.filter((item) => item.topic === filters.topic);
          }
          return media.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        }
      } catch (error) {
        console.warn("[Firestore] Đọc media thất bại, chuyển sang IndexedDB:", error);
      }
    }

    const media = (await request("media", "readonly", (store) => store.getAll())) || [];
    return media
      .filter((item) => (!filters.year || item.year === Number(filters.year)) && (!filters.topic || filters.topic === "Tất cả" || item.topic === filters.topic))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function getMediaById(mediaId) {
    initFirebase();
    if (firestoreDb) {
      try {
        const doc = await firestoreDb.collection("media").doc(mediaId).get();
        if (doc.exists) return doc.data();
      } catch (e) { /* ignore */ }
    }
    return request("media", "readonly", (store) => store.get(mediaId));
  }

  async function deleteMedia(mediaId) {
    initFirebase();
    if (firestoreDb) {
      try {
        await firestoreDb.collection("media").doc(mediaId).delete();
      } catch (e) { /* ignore */ }
    }
    await request("media", "readwrite", (store) => store.delete(mediaId));
  }

  async function resolveSource(source) {
    if (!source) return "images/hero.jpg";
    if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("data:") || source.startsWith("images/")) {
      return source;
    }
    if (source.startsWith("idb:")) {
      const media = await getMediaById(source.slice(4));
      return media?.dataUrl || media?.src || "images/hero.jpg";
    }
    return source;
  }

  async function hydrateMedia(root = document) {
    const elements = [...root.querySelectorAll("[data-media-src]")];
    await Promise.all(elements.map(async (element) => {
      const source = await resolveSource(element.dataset.mediaSrc);
      if (element.tagName === "IMG") element.src = source;
      else element.style.backgroundImage = `url("${source}")`;
    }));
  }

  async function digest(value) {
    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(value);
      const hash = await window.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return btoa(unescape(encodeURIComponent(value)));
  }

  async function getAdmin() {
    let admin = await request("settings", "readonly", (store) => store.get(ADMIN_KEY));
    if (!admin) {
      admin = { key: ADMIN_KEY, username: "admin", passwordHash: await digest("teresa2026") };
      await request("settings", "readwrite", (store) => store.put(admin));
    }
    return admin;
  }

  async function login(usernameOrEmail, password) {
    initFirebase();
    if (firebaseAuth) {
      try {
        const userCredential = await firebaseAuth.signInWithEmailAndPassword(usernameOrEmail, password);
        sessionStorage.setItem(SESSION_KEY, "true");
        return { success: true, user: userCredential.user };
      } catch (error) {
        console.error("Lỗi đăng nhập Firebase Auth:", error);
        return { success: false, message: getAuthErrorMessage(error.code) };
      }
    }

    // Fallback: Đăng nhập local nếu Firebase chưa bật
    const admin = await getAdmin();
    const verified = usernameOrEmail.trim() === admin.username && (await digest(password)) === admin.passwordHash;
    if (verified) sessionStorage.setItem(SESSION_KEY, "true");
    return { success: verified, message: verified ? "" : "Tài khoản hoặc mật khẩu chưa đúng." };
  }

  function getAuthErrorMessage(code) {
    switch (code) {
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Email hoặc mật khẩu không chính xác.";
      case "auth/invalid-email":
        return "Định dạng Email không hợp lệ.";
      case "auth/too-many-requests":
        return "Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần.";
      default:
        return "Lỗi đăng nhập: " + code;
    }
  }

  const isAdmin = () => {
    initFirebase();
    if (firebaseAuth && firebaseAuth.currentUser) return true;
    return sessionStorage.getItem(SESSION_KEY) === "true";
  };

  const logout = async () => {
    initFirebase();
    if (firebaseAuth) {
      try { await firebaseAuth.signOut(); } catch (e) { /* ignore */ }
    }
    sessionStorage.removeItem(SESSION_KEY);
  };

  async function changeCredentials(username, password) {
    initFirebase();
    if (firebaseAuth && firebaseAuth.currentUser) {
      if (password.length < 8) throw new Error("Mật khẩu cần ít nhất 8 ký tự.");
      await firebaseAuth.currentUser.updatePassword(password);
      return;
    }
    if (!username?.trim() || password.length < 8) throw new Error("Tên đăng nhập là bắt buộc và mật khẩu cần ít nhất 8 ký tự.");
    const passwordHash = await digest(password);
    await request("settings", "readwrite", (store) => store.put({ key: ADMIN_KEY, username: username.trim(), passwordHash }));
  }

  // Đồng bộ toàn bộ dữ liệu 2015-2026 từ file JSON tĩnh lên Firestore
  async function seedFirestoreToCloud() {
    initFirebase();
    if (!firestoreDb) throw new Error("Chưa cấu hình Firebase SDK.");
    let count = 0;
    for (let year = YEAR_MIN; year <= YEAR_MAX; year++) {
      try {
        const response = await fetch(`data/${year}.json`);
        if (response.ok) {
          const rawData = await response.json();
          const normalized = normalizeYear(rawData);
          await firestoreDb.collection("years").doc(String(year)).set(normalized);
          count++;
        }
      } catch (err) {
        console.warn(`Lỗi đồng bộ năm ${year}:`, err);
      }
    }
    return count;
  }

  async function exportArchive() {
    const [years, media] = await Promise.all([
      request("years", "readonly", (store) => store.getAll()),
      request("media", "readonly", (store) => store.getAll()),
    ]);
    return { version: 1, exportedAt: new Date().toISOString(), years, media };
  }

  async function importArchive(archive) {
    if (!archive || !Array.isArray(archive.years) || !Array.isArray(archive.media)) throw new Error("Tệp sao lưu không đúng định dạng.");
    await Promise.all(archive.years.map((item) => saveYear(item.data || item)));
    await Promise.all(archive.media.map((item) => saveMedia(item)));
  }

  window.TeresaStore = {
    YEAR_MIN, YEAR_MAX, loadYear, saveYear, saveActivity, deleteActivity,
    saveMedia, getMedia, deleteMedia, resolveSource, hydrateMedia,
    getAdmin, login, isAdmin, logout, changeCredentials,
    exportArchive, importArchive, seedFirestoreToCloud, isFirebaseConfigured
  };
})();

