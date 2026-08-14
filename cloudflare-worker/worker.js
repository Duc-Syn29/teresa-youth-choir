/* Cloudflare Worker: Firebase Auth -> GitHub data + Cloudflare R2 media.
 * Secrets: GITHUB_TOKEN, FIREBASE_API_KEY, ADMIN_EMAIL.
 * Binding: MEDIA_BUCKET (R2 bucket).
 */
const allowedOrigins = new Set([
  "https://cadoangioitreteresa.org",
  "https://www.cadoangioitreteresa.org",
  "https://teresa-youth-choir.pages.dev"
]);
const imageLimit = 25 * 1024 * 1024;

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = allowedOrigins.has(origin) || local ? origin : "";
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Vary": "Origin" };
}
function json(request, value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request) } });
}
function cleanYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2015 || year > 2026) throw new Error("Năm phải trong khoảng 2015–2026.");
  return year;
}
function slug(value) { return String(value || "khac").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "khac"; }
function pathUrl(path) { return path.split("/").map(encodeURIComponent).join("/"); }
function filename(value) { return String(value || "anh").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-"); }
function encodeJson(value) { return btoa(unescape(encodeURIComponent(`${JSON.stringify(value, null, 2)}\n`))); }
function decodeJson(value) { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\n/g, "")), (character) => character.charCodeAt(0)))); }

function mediaUrl(request, env, key) {
  const base = String(env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return base ? `${base}/${pathUrl(key)}` : new URL(`/media/${pathUrl(key)}`, request.url).toString();
}
function validMediaKey(key) { return /^media\/20(1[5-9]|2[0-6])\/[a-z0-9-]+\/.+/.test(key); }

function eventImage(data, activity) {
  const matchingPhoto = (data.gallery || []).find((photo) => photo.event === activity.title || photo.event === activity.type);
  return activity.coverImage || activity.images?.[0]?.src || matchingPhoto?.src || data.overview?.coverImage || "images/hero.jpg";
}
function leadershipSummary(leadership = {}) {
  return Object.entries(leadership)
    .filter(([, value]) => value)
    .map(([role, value]) => ({
      role,
      name: Array.isArray(value)
        ? value.map((item) => item?.name || String(item)).join(" · ")
        : value?.name || String(value)
    }));
}
function indexYear(data) {
  return {
    year: Number(data.year),
    overview: {
      eyebrow: data.overview?.eyebrow || "",
      title: data.overview?.title || `Năm ${data.year}`,
      summary: data.overview?.summary || "",
      coverImage: data.overview?.coverImage || "images/hero.jpg"
    },
    members: data.members || {},
    leadership: leadershipSummary(data.leadership),
    events: (data.activities || []).map((activity, position) => ({
      id: activity.id || `${data.year}-activity-${position + 1}`,
      title: activity.title || "Hoạt động Teresa",
      type: activity.type || activity.topic || "Khác",
      date: activity.date || "",
      description: activity.description || "",
      image: eventImage(data, activity)
    }))
  };
}
function mergeIndex(index, data) {
  const next = index && Array.isArray(index.years) ? index : { version: 1, years: [] };
  const summary = indexYear(data);
  const years = [...next.years.filter((item) => Number(item.year) !== summary.year), summary].sort((a, b) => b.year - a.year);
  const memberTotal = years.reduce((total, item) => total + Number(item.members?.total || 0), 0);
  const activityTotal = years.reduce((total, item) => total + (item.events || []).length, 0);
  return { version: 1, generatedAt: new Date().toISOString(), totals: { years: years.length, members: memberTotal, activities: activityTotal }, years };
}

async function verifyAdmin(request, env) {
  if (!env.FIREBASE_API_KEY) throw new Error("Worker chưa có secret FIREBASE_API_KEY.");
  if (!env.ADMIN_EMAIL) throw new Error("Worker chưa có secret ADMIN_EMAIL.");
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) throw new Error("Thiếu phiên đăng nhập Firebase.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: match[1] }) });
  const data = await response.json();
  if (!response.ok) throw new Error("Firebase không xác minh được phiên đăng nhập: " + ((data.error && data.error.message) || "unknown error") + ".");
  const email = data.users?.[0]?.email?.trim().toLowerCase();
  if (!email) throw new Error("Firebase không trả về email tài khoản.");
  if (email !== String(env.ADMIN_EMAIL).trim().toLowerCase()) throw new Error("Email Firebase " + email + " chưa trùng với secret ADMIN_EMAIL của Worker.");
  return email;
}
async function github(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("Worker chưa có secret GITHUB_TOKEN.");
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER || "Duc-Syn29")}/${encodeURIComponent(env.GITHUB_REPO || "teresa-youth-choir")}${path}`, { ...init, headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "teresa-youth-choir-admin", ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Không thể ghi GitHub.");
  return data;
}
async function putFile(env, path, content, message) {
  let sha;
  try { sha = (await github(env, `/contents/${pathUrl(path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`)).sha; } catch (error) { if (!/Not Found/i.test(error.message)) throw error; }
  return github(env, `/contents/${pathUrl(path)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, content, branch: env.GITHUB_BRANCH || "main", ...(sha ? { sha } : {}) }) });
}
async function readIndex(env) {
  try { return decodeJson((await github(env, `/contents/data/index.json?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`)).content); }
  catch (error) { if (/Not Found/i.test(error.message)) return { version: 1, years: [] }; throw error; }
}
async function listR2(bucket, prefix) {
  const all = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    all.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return all;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        const key = decodeURIComponent(url.pathname.slice("/media/".length));
        if (!validMediaKey(key) || !env.MEDIA_BUCKET) return new Response("Không tìm thấy ảnh.", { status: 404, headers: cors(request) });
        const object = await env.MEDIA_BUCKET.get(key);
        if (!object) return new Response("Không tìm thấy ảnh.", { status: 404, headers: cors(request) });
        const headers = new Headers(cors(request));
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(object.body, { headers });
      }
      if (url.pathname === "/health") return json(request, { ok: true, service: "teresa-admin-api", media: env.MEDIA_BUCKET ? "r2" : "not-configured" });
      const verifiedEmail = await verifyAdmin(request, env);
      if (request.method === "GET" && url.pathname === "/api/session") return json(request, { ok: true, email: verifiedEmail });
      if (request.method === "PUT" && /^\/api\/years\/\d{4}$/.test(url.pathname)) {
        const year = cleanYear(url.pathname.split("/").pop());
        const data = await request.json();
        if (Number(data.year) !== year) throw new Error("Dữ liệu năm không khớp.");
        const normalized = { ...data, year };
        const result = await putFile(env, `data/${year}.json`, encodeJson(normalized), `admin: cập nhật dữ liệu năm ${year}`);
        const index = mergeIndex(await readIndex(env), normalized);
        await putFile(env, "data/index.json", encodeJson(index), `admin: cập nhật chỉ mục năm ${year}`);
        return json(request, { ok: true, path: `data/${year}.json`, indexPath: "data/index.json", commit: result.commit?.sha });
      }
      if (request.method === "POST" && url.pathname === "/api/media") {
        if (!env.MEDIA_BUCKET) throw new Error("Worker chưa được gắn R2 binding MEDIA_BUCKET.");
        const form = await request.formData();
        const file = form.get("file");
        const year = cleanYear(form.get("year"));
        if (!(file instanceof File) || !file.type.startsWith("image/")) throw new Error("Vui lòng chọn tệp ảnh hợp lệ.");
        if (file.size > imageLimit) throw new Error("Mỗi ảnh tối đa 25 MB khi lưu vào Cloudflare R2.");
        const topic = String(form.get("topic") || "Khác");
        const safe = filename(file.name);
        const key = `media/${year}/${slug(topic)}/${Date.now()}-${safe}`;
        const caption = String(form.get("caption") || "");
        const alt = String(form.get("alt") || file.name);
        await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, contentDisposition: `inline; filename="${safe}"` }, customMetadata: { year: String(year), topic, filename: file.name, caption, alt, createdAt: new Date().toISOString() } });
        return json(request, { ok: true, id: key, src: mediaUrl(request, env, key), year, topic, filename: file.name, caption, alt });
      }
      if (request.method === "GET" && url.pathname === "/api/media") {
        if (!env.MEDIA_BUCKET) throw new Error("Worker chưa được gắn R2 binding MEDIA_BUCKET.");
        const year = cleanYear(url.searchParams.get("year"));
        const items = (await listR2(env.MEDIA_BUCKET, `media/${year}/`)).map((item) => ({ id: item.key, src: mediaUrl(request, env, item.key), year, topic: item.customMetadata?.topic || item.key.split("/")[2] || "Khác", filename: item.customMetadata?.filename || item.key.split("/").at(-1), caption: item.customMetadata?.caption || "", alt: item.customMetadata?.alt || item.customMetadata?.filename || item.key.split("/").at(-1), createdAt: item.customMetadata?.createdAt || item.uploaded?.toISOString?.() || "" })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return json(request, { ok: true, items });
      }
      if (request.method === "DELETE" && url.pathname === "/api/media") {
        const { path } = await request.json();
        if (typeof path !== "string") throw new Error("Đường dẫn ảnh không hợp lệ.");
        if (validMediaKey(path)) {
          if (!env.MEDIA_BUCKET) throw new Error("Worker chưa được gắn R2 binding MEDIA_BUCKET.");
          await env.MEDIA_BUCKET.delete(path);
          return json(request, { ok: true });
        }
        // Ảnh cũ trong GitHub vẫn có thể xóa để chuyển đổi dần sang R2.
        if (!/^images\/uploads\/20(1[5-9]|2[0-6])\//.test(path)) throw new Error("Đường dẫn ảnh không hợp lệ.");
        const file = await github(env, `/contents/${pathUrl(path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`);
        await github(env, `/contents/${pathUrl(path)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `admin: xóa ảnh cũ ${path}`, sha: file.sha, branch: env.GITHUB_BRANCH || "main" }) });
        return json(request, { ok: true });
      }
      return json(request, { error: "Không tìm thấy API." }, 404);
    } catch (error) {
      const status = /quyền quản trị|Thiếu phiên/i.test(error.message) ? 401 : 400;
      return json(request, { error: error.message || "Lỗi máy chủ." }, status);
    }
  }
};
