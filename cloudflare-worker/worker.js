/* Cloudflare Worker: Firebase Auth -> GitHub Contents API.
 * Secrets cần đặt trên Cloudflare: GITHUB_TOKEN, FIREBASE_API_KEY, ADMIN_EMAIL.
 */
const allowedOrigins = new Set([
  "https://cadoangioitreteresa.org",
  "https://www.cadoangioitreteresa.org",
  "https://teresa-youth-choir.pages.dev"
]);
const imageLimit = 20 * 1024 * 1024;

function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = allowedOrigins.has(origin) || local ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Vary": "Origin"
  };
}

function json(request, value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request) } });
}
function cleanYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2015 || year > 2026) throw new Error("Năm phải trong khoảng 2015–2026.");
  return year;
}
function slug(value) {
  return String(value || "khac").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "khac";
}
function pathUrl(path) { return path.split("/").map(encodeURIComponent).join("/"); }
function filename(value) { return String(value || "anh").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-"); }
function toBase64(bytes) {
  let output = "";
  const data = new Uint8Array(bytes);
  for (let i = 0; i < data.length; i += 0x8000) output += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(output);
}

async function verifyAdmin(request, env) {
  if (!env.FIREBASE_API_KEY) throw new Error("Worker chưa có secret FIREBASE_API_KEY.");
  if (!env.ADMIN_EMAIL) throw new Error("Worker chưa có secret ADMIN_EMAIL.");
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) throw new Error("Thiếu phiên đăng nhập Firebase.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: match[1] })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Firebase không xác minh được phiên đăng nhập: " + ((data.error && data.error.message) || "unknown error") + ".");
  const email = data.users?.[0]?.email?.trim().toLowerCase();
  if (!email) throw new Error("Firebase không trả về email tài khoản.");
  if (email !== String(env.ADMIN_EMAIL).trim().toLowerCase()) throw new Error("Email Firebase " + email + " chưa trùng với secret ADMIN_EMAIL của Worker.");
  return email;
}

async function github(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("Worker chưa có secret GITHUB_TOKEN.");
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER || "Duc-Syn29")}/${encodeURIComponent(env.GITHUB_REPO || "teresa-youth-choir")}${path}`, {
    ...init,
    headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "teresa-youth-choir-admin", ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Không thể ghi GitHub.");
  return data;
}
async function putFile(env, path, content, message) {
  let sha;
  try { sha = (await github(env, `/contents/${pathUrl(path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`)).sha; } catch (error) { if (!/Not Found/i.test(error.message)) throw error; }
  return github(env, `/contents/${pathUrl(path)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, content, branch: env.GITHUB_BRANCH || "main", ...(sha ? { sha } : {}) }) });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json(request, { ok: true, service: "teresa-admin-api" });
      const verifiedEmail = await verifyAdmin(request, env);
      if (request.method === "GET" && url.pathname === "/api/session") return json(request, { ok: true, email: verifiedEmail });
      if (request.method === "PUT" && /^\/api\/years\/\d{4}$/.test(url.pathname)) {
        const year = cleanYear(url.pathname.split("/").pop());
        const data = await request.json();
        if (Number(data.year) !== year) throw new Error("Dữ liệu năm không khớp.");
        const result = await putFile(env, `data/${year}.json`, btoa(unescape(encodeURIComponent(`${JSON.stringify(data, null, 2)}\n`))), `admin: cập nhật dữ liệu năm ${year}`);
        return json(request, { ok: true, path: `data/${year}.json`, commit: result.commit?.sha });
      }
      if (request.method === "POST" && url.pathname === "/api/media") {
        const form = await request.formData();
        const file = form.get("file");
        const year = cleanYear(form.get("year"));
        if (!(file instanceof File) || !file.type.startsWith("image/")) throw new Error("Vui lòng chọn tệp ảnh hợp lệ.");
        if (file.size > imageLimit) throw new Error("Mỗi ảnh tối đa 20 MB khi lưu vào GitHub source.");
        const topic = String(form.get("topic") || "Khác");
        const safe = filename(file.name);
        const path = `images/uploads/${year}/${slug(topic)}/${Date.now()}-${safe}`;
        const result = await putFile(env, path, toBase64(await file.arrayBuffer()), `admin: thêm ảnh ${year}/${slug(topic)}`);
        return json(request, { ok: true, id: path, src: path, year, topic, filename: file.name, caption: String(form.get("caption") || ""), alt: String(form.get("alt") || file.name), commit: result.commit?.sha });
      }
      if (request.method === "GET" && url.pathname === "/api/media") {
        const year = cleanYear(url.searchParams.get("year"));
        const tree = await github(env, `/git/trees/${encodeURIComponent(env.GITHUB_BRANCH || "main")}?recursive=1`);
        const prefix = `images/uploads/${year}/`;
        const items = (tree.tree || []).filter((item) => item.type === "blob" && item.path.startsWith(prefix)).map((item) => {
          const segments = item.path.split("/");
          return { id: item.path, src: item.path, year, topic: segments[3] || "Khác", filename: segments.at(-1), createdAt: "" };
        }).sort((a, b) => b.filename.localeCompare(a.filename));
        return json(request, { ok: true, items });
      }
      if (request.method === "DELETE" && url.pathname === "/api/media") {
        const { path } = await request.json();
        if (typeof path !== "string" || !/^images\/uploads\/20(1[5-9]|2[0-6])\//.test(path)) throw new Error("Đường dẫn ảnh không hợp lệ.");
        const file = await github(env, `/contents/${pathUrl(path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`);
        await github(env, `/contents/${pathUrl(path)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `admin: xóa ảnh ${path}`, sha: file.sha, branch: env.GITHUB_BRANCH || "main" }) });
        return json(request, { ok: true });
      }
      return json(request, { error: "Không tìm thấy API." }, 404);
    } catch (error) {
      const status = /quyền quản trị|Thiếu phiên/i.test(error.message) ? 401 : 400;
      return json(request, { error: error.message || "Lỗi máy chủ." }, status);
    }
  }
};
