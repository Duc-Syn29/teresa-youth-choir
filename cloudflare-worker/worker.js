/* Teresa admin API
 *
 * Firebase Auth protects every /api/* route. GitHub remains the source of
 * truth for JSON, while Cloudflare R2 stores immutable media objects.
 *
 * Required secrets: GITHUB_TOKEN, FIREBASE_API_KEY and either ADMIN_UIDS or
 * ADMIN_EMAIL. Required binding: MEDIA_BUCKET. RATE_LIMITER is optional at
 * runtime so local development keeps working without Cloudflare services.
 */

const DEFAULT_ORIGINS = [
  "https://cadoangioitreteresa.org",
  "https://www.cadoangioitreteresa.org",
  "https://teresa-youth-choir.pages.dev"
];
const ROLE_KEYS = ["chaplain", "leader", "deputyLeader", "conductor", "treasurer"];
const ROLE_LABELS = {
  chaplain: "Cha đặc trách",
  leader: "Trưởng ca đoàn",
  deputyLeader: "Phó ca đoàn",
  conductor: "Ca trưởng",
  treasurer: "Thủ quỹ"
};
const JSON_LIMIT = 2 * 1024 * 1024;
const ORIGINAL_LIMIT = 25 * 1024 * 1024;
const MEDIUM_LIMIT = 10 * 1024 * 1024;
const THUMB_LIMIT = 4 * 1024 * 1024;
// The transitional client sends `original` and a duplicate legacy `file`
// field. Keep the request ceiling above the sum of both while validating each
// unique variant separately below.
const MULTIPART_LIMIT = 70 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const fail = (status, code, message, details) => { throw new HttpError(status, code, message, details); };
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const utf8Size = (value) => new TextEncoder().encode(value).byteLength;
const boundedInteger = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

function environment(env) {
  return String(env.ENVIRONMENT || "production").toLowerCase();
}

function yearBounds(env) {
  const minimum = boundedInteger(env.ARCHIVE_YEAR_MIN, 2015, 1900, 2200);
  const automaticMaximum = new Date().getUTCFullYear() + 1;
  const maximum = boundedInteger(env.ARCHIVE_YEAR_MAX, automaticMaximum, minimum, 2200);
  return { minimum, maximum };
}

function cleanYear(value, env) {
  const year = Number(value);
  const { minimum, maximum } = yearBounds(env);
  if (!Number.isInteger(year) || year < minimum || year > maximum) {
    fail(422, "INVALID_YEAR", `Năm phải trong khoảng ${minimum}–${maximum}.`);
  }
  return year;
}

function slug(value) {
  return String(value || "khac")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "khac";
}

function safeFilename(value) {
  return String(value || "anh").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 160) || "anh";
}

function pathUrl(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function branchName(env) {
  return String(env.GITHUB_BRANCH || "main");
}

function repository(env) {
  return {
    owner: String(env.GITHUB_OWNER || "Duc-Syn29"),
    repo: String(env.GITHUB_REPO || "teresa-youth-choir")
  };
}

function configuredOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",").map((item) => item.trim()).filter(Boolean));
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  if (configuredOrigins(env).has(origin)) return true;
  const suffixes = String(env.ALLOWED_ORIGIN_SUFFIXES || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return environment(env) !== "production"
      && ["localhost", "127.0.0.1"].includes(url.hostname);
    return suffixes.some((suffix) => url.hostname === suffix.replace(/^\./, "") || url.hostname.endsWith(suffix.startsWith(".") ? suffix : `.${suffix}`));
  } catch (_error) {
    return false;
  }
}

function corsHeaders(request, env, publicMedia = false) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, If-None-Match, If-Range, Range",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "ETag, Content-Length, Content-Range, X-Request-Id, Server-Timing",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  });
  if (publicMedia) headers.set("Access-Control-Allow-Origin", "*");
  else {
    const origin = request.headers.get("Origin") || "";
    if (isAllowedOrigin(origin, env)) headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function responseWithHeaders(response, request, env, requestId, duration, publicMedia = false) {
  const headers = new Headers(response.headers);
  corsHeaders(request, env, publicMedia).forEach((value, key) => headers.set(key, value));
  headers.set("X-Request-Id", requestId);
  headers.set("Server-Timing", `worker;dur=${Math.max(0, duration)}`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function assertContentLength(request, maximum) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > maximum) fail(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
}

async function readJson(request, maximum = JSON_LIMIT) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) fail(415, "JSON_REQUIRED", "API yêu cầu dữ liệu JSON.");
  assertContentLength(request, maximum);
  const text = await request.text();
  if (utf8Size(text) > maximum) fail(413, "PAYLOAD_TOO_LARGE", "Dữ liệu JSON quá lớn.");
  try { return JSON.parse(text); }
  catch (_error) { fail(400, "INVALID_JSON", "Dữ liệu JSON không hợp lệ."); }
}

function safeText(value, label, maximum, required = false) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") fail(422, "INVALID_FIELD", `${label} phải là văn bản.`);
  const text = value.trim();
  if (required && !text) fail(422, "REQUIRED_FIELD", `${label} không được để trống.`);
  if (text.length > maximum) fail(422, "FIELD_TOO_LONG", `${label} dài quá giới hạn ${maximum} ký tự.`);
  return text;
}

function assertSafeTree(value, depth = 0) {
  if (depth > 14) fail(422, "DATA_TOO_DEEP", "Cấu trúc dữ liệu lồng nhau quá sâu.");
  if (typeof value === "string" && value.length > 120000) fail(422, "FIELD_TOO_LONG", "Một trường nội dung dài quá giới hạn.");
  if (Array.isArray(value)) {
    if (value.length > 6000) fail(422, "TOO_MANY_ITEMS", "Một danh sách có quá nhiều phần tử.");
    value.forEach((item) => assertSafeTree(item, depth + 1));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail(422, "UNSAFE_FIELD", "Dữ liệu chứa tên trường không an toàn.");
      assertSafeTree(item, depth + 1);
    }
  }
}

function isSafeSource(value) {
  if (!value) return true;
  const source = String(value).trim();
  let decoded = source;
  try { decoded = decodeURIComponent(source); } catch (_error) { return false; }
  if (/^(javascript|data|vbscript):/i.test(decoded) || decoded.includes("\\") || decoded.split("/").includes("..")) return false;
  if (/^https:\/\//i.test(source)) return true;
  return /^\/?(?:images|media|data\/albums)\//i.test(source) || /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(source);
}

function variantSource(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (!isObject(value)) return "";
  return String(value.src || value.url || value.path || "").trim();
}

function mediaSource(media, preferred = "medium") {
  if (!media) return "";
  if (typeof media === "string") return media.trim();
  if (!isObject(media)) return "";
  const variants = isObject(media.variants) ? media.variants : {};
  const aliases = { thumb: "thumbnail", thumbnail: "thumbnail", medium: "medium", original: "original" };
  const requested = aliases[preferred] || preferred;
  const order = requested === "thumbnail"
    ? ["thumbnail", "medium", "original"]
    : requested === "original"
      ? ["original", "medium", "thumbnail"]
      : [requested, "medium", "original", "thumbnail"];
  for (const key of [...new Set(order)]) {
    const candidate = variants[key]
      || (key === "thumbnail" ? variants.thumb : null)
      || media[key]
      || (key === "thumbnail" ? media.thumb : null);
    const source = variantSource(candidate);
    if (source) return source;
  }
  return variantSource(media);
}

function assertSafeMedia(media, label, required = false) {
  if (media === undefined || media === null || media === "") {
    if (required) fail(422, "IMAGE_SOURCE_REQUIRED", `${label} cần có đường dẫn ảnh.`);
    return;
  }
  if (typeof media !== "string" && !isObject(media)) fail(422, "INVALID_IMAGE", `${label} không hợp lệ.`);
  const primary = mediaSource(media, "medium");
  if (required && !primary) fail(422, "IMAGE_SOURCE_REQUIRED", `${label} cần có đường dẫn ảnh.`);
  const sources = typeof media === "string" ? [media] : [
    media.src, media.url, media.path,
    media.thumbnail, media.thumb, media.medium, media.original,
    media.variants?.thumbnail, media.variants?.thumb, media.variants?.medium, media.variants?.original
  ].map(variantSource).filter(Boolean);
  for (const source of new Set([primary, ...sources].filter(Boolean))) {
    safeText(source, label, 2048, true);
    if (!isSafeSource(source)) fail(422, "UNSAFE_IMAGE_SOURCE", `${label} có đường dẫn không an toàn.`);
  }
  if (isObject(media)) {
    const variantValues = [media, media.thumbnail, media.thumb, media.medium, media.original,
      media.variants?.thumbnail, media.variants?.thumb, media.variants?.medium, media.variants?.original].filter(isObject);
    for (const variant of variantValues) {
      for (const dimension of [variant.width, variant.height]) {
        if (dimension !== undefined && (!Number.isInteger(Number(dimension)) || Number(dimension) < 0 || Number(dimension) > 30000)) {
          fail(422, "INVALID_IMAGE_DIMENSION", `${label} có kích thước không hợp lệ.`);
        }
      }
    }
    if (media.alt !== undefined) safeText(media.alt, `${label}.alt`, 500);
    if (media.caption !== undefined) safeText(media.caption, `${label}.caption`, 1000);
  }
}

function normalizeImage(image, activityTitle, year) {
  const source = typeof image === "string" ? { src: image } : image;
  if (!isObject(source)) fail(422, "INVALID_IMAGE", "Thông tin ảnh không hợp lệ.");
  assertSafeMedia(source, "Ảnh tư liệu", true);
  const src = safeText(mediaSource(source, "medium"), "Đường dẫn ảnh", 2048, true);
  const normalized = {
    ...source,
    src,
    alt: safeText(source.alt || `Ảnh tư liệu: ${activityTitle || year}`, "Mô tả ảnh", 500),
    caption: safeText(source.caption || activityTitle || `Năm ${year}`, "Chú thích ảnh", 1000),
    event: safeText(source.event || activityTitle || "Hoạt động", "Tên sự kiện ảnh", 300)
  };
  return normalized;
}

function activityImages(activity, year) {
  const source = activity.images;
  if (source === undefined) return undefined;
  if (Array.isArray(source)) {
    if (source.length > 1000) fail(422, "TOO_MANY_IMAGES", "Mỗi hoạt động tối đa 1000 ảnh.");
    return source.map((image) => normalizeImage(image, activity.title, year));
  }
  if (isObject(source) && source.base && Number(source.count) >= 0) {
    const count = boundedInteger(source.count, -1, 0, 1000);
    if (count < 0 || !isSafeSource(source.base)) fail(422, "INVALID_IMAGE_SET", "Bộ ảnh rút gọn không hợp lệ.");
    return Array.from({ length: count }, (_, index) => normalizeImage(
      `${String(source.base).replace(/\/$/, "")}/${String(index + 1).padStart(3, "0")}.jpg`, activity.title, year
    ));
  }
  fail(422, "INVALID_IMAGES", "Danh sách ảnh hoạt động không hợp lệ.");
}

function validatePerson(person, label) {
  const item = typeof person === "string" ? { name: person } : person;
  if (!isObject(item)) fail(422, "INVALID_LEADER", `${label} không hợp lệ.`);
  safeText(item.name || "", `${label}.name`, 300, true);
  if (item.photo) assertSafeMedia(item.photo, `${label}.photo`, true);
  if (item.note !== undefined) safeText(item.note, `${label}.note`, 1000);
}

function validateLeadership(leadership) {
  if (leadership === undefined) return {};
  if (!isObject(leadership)) fail(422, "INVALID_LEADERSHIP", "Ban điều hành phải là một đối tượng.");
  for (const key of ROLE_KEYS) {
    const entry = leadership[key];
    if (entry === undefined || entry === null || entry === "") continue;
    const people = Array.isArray(entry) ? entry : (Array.isArray(entry.members) ? entry.members : [entry]);
    if (people.length > 30) fail(422, "TOO_MANY_LEADERS", "Một vị trí có quá nhiều thành viên.");
    people.forEach((person, index) => validatePerson(person, `leadership.${key}.members[${index}]`));
  }
  const teams = leadership.teams;
  if (teams !== undefined) {
    if (!Array.isArray(teams) || teams.length > 100) fail(422, "INVALID_TEAMS", "Danh sách ban phục vụ không hợp lệ.");
    teams.forEach((team) => {
      if (!isObject(team)) fail(422, "INVALID_TEAM", "Thông tin ban phục vụ không hợp lệ.");
      safeText(team.name || "", "Tên ban phục vụ", 200, true);
      if (team.members !== undefined && (!Array.isArray(team.members) || team.members.length > 300)) fail(422, "INVALID_TEAM_MEMBERS", "Danh sách thành viên ban không hợp lệ.");
      (team.members || []).forEach((person, index) => validatePerson(person, `leadership.teams.members[${index}]`));
    });
  }
  return leadership;
}

function manifestPathValid(path, year) {
  return new RegExp(`^data/albums/${year}/[a-zA-Z0-9._-]+\\.json$`).test(String(path || ""));
}

function normalizeAlbum(album, title, year) {
  if (!isObject(album)) fail(422, "INVALID_ALBUM", `Album của “${title}” không hợp lệ.`);
  const manifest = safeText(album.manifest || "", "Đường dẫn album manifest", 300, true);
  if (!manifestPathValid(manifest, year)) fail(422, "INVALID_ALBUM_MANIFEST", `Chỉ mục album của “${title}” không hợp lệ.`);
  const count = Number(album.count || 0);
  if (!Number.isInteger(count) || count < 0 || count > 5000) fail(422, "INVALID_ALBUM_COUNT", `Số ảnh album của “${title}” không hợp lệ.`);
  const previewSource = album.preview === undefined ? [] : album.preview;
  if (!Array.isArray(previewSource) || previewSource.length > 12) fail(422, "INVALID_ALBUM_PREVIEW", `Ảnh xem trước album của “${title}” không hợp lệ.`);
  return { ...album, manifest, count, preview: previewSource.map((image) => normalizeImage(image, title, year)) };
}

function validateYearPayload(input, routeYear, env) {
  if (!isObject(input)) fail(422, "INVALID_YEAR_DATA", "Dữ liệu năm phải là một đối tượng JSON.");
  assertSafeTree(input);
  const raw = JSON.stringify(input);
  if (utf8Size(raw) > JSON_LIMIT) fail(413, "YEAR_TOO_LARGE", "Dữ liệu một năm vượt quá 2 MB.");
  const year = cleanYear(input.year, env);
  if (routeYear !== undefined && year !== routeYear) fail(422, "YEAR_MISMATCH", "Dữ liệu năm không khớp với địa chỉ API.");
  const data = clone(input);
  data.schemaVersion = 3;
  data.year = year;
  if (data.meta === undefined) data.meta = { revision: 0, status: "published" };
  if (!isObject(data.meta)) fail(422, "INVALID_META", "Thông tin phiên bản dữ liệu không hợp lệ.");
  const revision = Number(data.meta.revision || 0);
  if (!Number.isInteger(revision) || revision < 0 || revision > 1000000) fail(422, "INVALID_META_REVISION", "Số phiên bản dữ liệu không hợp lệ.");
  const status = safeText(data.meta.status || "published", "meta.status", 30, true).toLowerCase();
  if (!["draft", "published", "archived"].includes(status)) fail(422, "INVALID_META_STATUS", "Trạng thái dữ liệu không hợp lệ.");
  data.meta = { ...data.meta, revision, status };
  if (!isObject(data.overview)) fail(422, "INVALID_OVERVIEW", "Thiếu phần tổng quan của năm.");
  for (const [key, maximum] of Object.entries({ eyebrow: 300, title: 500, summary: 5000, longDescription: 120000 })) {
    if (data.overview[key] !== undefined) data.overview[key] = safeText(data.overview[key], `overview.${key}`, maximum);
  }
  if (!data.overview.title) fail(422, "REQUIRED_FIELD", "overview.title không được để trống.");
  if (data.overview.coverImage) assertSafeMedia(data.overview.coverImage, "overview.coverImage", true);
  data.leadership = validateLeadership(data.leadership);
  if (!isObject(data.members)) data.members = {};
  for (const key of ["total", "new", "inactive"]) {
    if (data.members[key] === undefined) continue;
    const value = Number(data.members[key]);
    if (!Number.isInteger(value) || value < 0 || value > 100000) fail(422, "INVALID_MEMBER_COUNT", `members.${key} không hợp lệ.`);
    data.members[key] = value;
  }
  if (data.members.notes !== undefined) data.members.notes = safeText(data.members.notes, "members.notes", 5000);
  if (!Array.isArray(data.activities) || data.activities.length > 500) fail(422, "INVALID_ACTIVITIES", "Danh sách hoạt động không hợp lệ hoặc quá dài.");
  const ids = new Set();
  let totalImages = 0;
  data.activities = data.activities.map((activity, index) => {
    if (!isObject(activity)) fail(422, "INVALID_ACTIVITY", `Hoạt động số ${index + 1} không hợp lệ.`);
    const next = { ...activity };
    next.id = safeText(next.id || `${year}-activity-${index + 1}`, "Mã hoạt động", 120, true);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(next.id)) fail(422, "INVALID_ACTIVITY_ID", `Mã hoạt động “${next.id}” chỉ được dùng chữ, số, dấu chấm, gạch ngang và gạch dưới.`);
    if (ids.has(next.id)) fail(422, "DUPLICATE_ACTIVITY_ID", `Mã hoạt động “${next.id}” bị trùng.`);
    ids.add(next.id);
    next.title = safeText(next.title, "Tên hoạt động", 500, true);
    next.date = safeText(next.date || "", "Ngày hoạt động", 200);
    next.type = safeText(next.type || next.topic || "Khác", "Loại hoạt động", 200, true);
    next.topic = safeText(next.topic || next.type || "Khác", "Chủ đề hoạt động", 200, true);
    next.description = safeText(next.description || "", "Tóm tắt hoạt động", 8000);
    next.body = safeText(next.body || next.description || "", "Nội dung hoạt động", 120000);
    if (next.coverImage) assertSafeMedia(next.coverImage, `Ảnh bìa của “${next.title}”`, true);
    if (Object.prototype.hasOwnProperty.call(next, "images")) {
      next.images = activityImages(next, year);
      totalImages += next.images.length;
    }
    if (next.album?.manifest) {
      next.album = normalizeAlbum(next.album, next.title, year);
      totalImages += Object.prototype.hasOwnProperty.call(next, "images") ? 0 : next.album.count;
    } else if (next.albumManifest) {
      next.album = normalizeAlbum({
        manifest: next.albumManifest,
        count: Number(next.imageCount || next.images?.length || 0),
        preview: Array.isArray(next.images) ? next.images.slice(0, 3) : []
      }, next.title, year);
    } else if (next.album !== undefined) {
      fail(422, "INVALID_ALBUM", `Album của “${next.title}” phải có đường dẫn manifest.`);
    }
    delete next.albumManifest;
    delete next.imageCount;
    return next;
  });
  if (totalImages > 5000) fail(422, "TOO_MANY_IMAGES", "Một năm tối đa 5000 ảnh trong dữ liệu.");
  if (data.gallery !== undefined) {
    if (!Array.isArray(data.gallery) || data.gallery.length > 5000) fail(422, "INVALID_GALLERY", "Album tổng hợp không hợp lệ hoặc quá dài.");
    data.gallery = data.gallery.map((image) => normalizeImage(image, `Năm ${year}`, year));
  }
  if (data.galleryAlbum?.manifest) data.galleryAlbum = normalizeAlbum(data.galleryAlbum, `Album năm ${year}`, year);
  else if (data.galleryAlbum !== undefined) fail(422, "INVALID_ALBUM", `Album năm ${year} phải có đường dẫn manifest.`);
  for (const key of ["achievements", "challenges", "sharing"]) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 1000)) {
      fail(422, "INVALID_COLLECTION", `${key} phải là một danh sách hợp lệ.`);
    }
  }
  return data;
}

function peopleFromLeadership(value) {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : (Array.isArray(value.members) ? value.members : [value]);
  return entries.flatMap((entry) => {
    const item = typeof entry === "string" ? { name: entry } : entry;
    if (!item?.name) return [];
    return String(item.name).split(/\s*[·;\n]\s*/).filter(Boolean).map((name) => ({ name, photo: item.photo || "" }));
  });
}

function leadershipSummary(leadership = {}) {
  return ROLE_KEYS.flatMap((role) => {
    const members = peopleFromLeadership(leadership[role]);
    return members.length ? [{ role, label: ROLE_LABELS[role], name: members.map((person) => person.name).join(" · ") }] : [];
  });
}

function firstRealImage(data, activity) {
  const images = Array.isArray(activity.images) ? activity.images : [];
  const matchingPhoto = (data.gallery || []).find((photo) => photo.event === activity.title || photo.event === activity.type);
  return mediaSource(activity.coverImage, "medium")
    || mediaSource(activity.album?.preview?.[0], "medium")
    || mediaSource(images[0], "medium")
    || mediaSource(matchingPhoto, "medium");
}

function albumPath(year, activityId) {
  return `data/albums/${year}/${activityId}.json`;
}

function galleryPath(year) {
  return `data/albums/${year}/_gallery.json`;
}

function indexYear(data) {
  return {
    year: Number(data.year),
    overview: {
      eyebrow: data.overview?.eyebrow || "",
      title: data.overview?.title || `Năm ${data.year}`,
      summary: data.overview?.summary || "",
      coverImage: mediaSource(data.overview?.coverImage, "medium")
    },
    members: data.members || {},
    leadership: leadershipSummary(data.leadership),
    events: (data.activities || []).map((activity, position) => {
      const count = activity.album?.count ?? (Array.isArray(activity.images) ? activity.images.length : 0);
      return {
        id: activity.id || `${data.year}-activity-${position + 1}`,
        title: activity.title || "Hoạt động Teresa",
        type: activity.type || activity.topic || "Khác",
        topic: activity.topic || activity.type || "Khác",
        date: activity.date || "",
        description: activity.description || "",
        image: firstRealImage(data, activity),
        imageCount: Number(count || 0)
      };
    })
  };
}

function mergeIndex(index, data) {
  const current = index && Array.isArray(index.years) ? index : { years: [] };
  const summary = indexYear(data);
  const years = [...current.years.filter((item) => Number(item.year) !== summary.year), summary].sort((a, b) => b.year - a.year);
  return {
    schemaVersion: 3,
    version: 3,
    generatedAt: new Date().toISOString(),
    totals: {
      years: years.length,
      members: years.reduce((total, item) => total + Number(item.members?.total || 0), 0),
      activities: years.reduce((total, item) => total + (item.events || []).length, 0)
    },
    years
  };
}

function buildAlbumChanges(data, previousData) {
  const files = new Map();
  const currentManifestPaths = new Set(data.activities.map((activity) => (
    Object.prototype.hasOwnProperty.call(activity, "images")
      ? albumPath(data.year, activity.id)
      : activity.album?.manifest
  )).filter(Boolean));
  for (const oldActivity of previousData?.activities || []) {
    const oldManifest = oldActivity?.album?.manifest || oldActivity?.albumManifest;
    if (oldManifest && !currentManifestPaths.has(oldManifest)) files.set(oldManifest, null);
  }
  for (const activity of data.activities) {
    if (Object.prototype.hasOwnProperty.call(activity, "images")) {
      const path = albumPath(data.year, activity.id);
      const images = activity.images;
      files.set(path, JSON.stringify({
        schemaVersion: 1,
        year: data.year,
        activityId: activity.id,
        title: activity.title,
        topic: activity.topic || activity.type || "Khác",
        coverImage: mediaSource(activity.coverImage, "medium") || mediaSource(images[0], "medium"),
        count: images.length,
        images
      }, null, 2) + "\n");
      activity.album = { manifest: path, count: images.length, preview: images.slice(0, 3) };
      delete activity.images;
    }
    delete activity.albumManifest;
    delete activity.imageCount;
  }

  // Old datasets may still keep the full year gallery inline. Split it once;
  // existing gallery manifests remain untouched unless history restoration has
  // explicitly expanded them back to a full inline list.
  if (Array.isArray(data.gallery) && data.gallery.length && !data.galleryAlbum?.manifest) {
    const path = galleryPath(data.year);
    const images = data.gallery;
    files.set(path, JSON.stringify({
      schemaVersion: 1,
      year: data.year,
      activityId: `${data.year}-year-gallery`,
      title: `Album năm ${data.year}`,
      count: images.length,
      images
    }, null, 2) + "\n");
    data.galleryAlbum = { manifest: path, count: images.length, preview: images.slice(0, 3) };
    data.gallery = images.slice(0, 3);
  }
  const previousGallery = previousData?.galleryAlbum?.manifest;
  if (previousGallery && previousGallery !== data.galleryAlbum?.manifest) files.set(previousGallery, null);
  return files;
}

async function verifyAdmin(request, env) {
  if (!env.FIREBASE_API_KEY) fail(503, "FIREBASE_NOT_CONFIGURED", "Worker chưa có secret FIREBASE_API_KEY.");
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) fail(401, "AUTH_REQUIRED", "Thiếu phiên đăng nhập Firebase.");
  let response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: match[1] })
    });
  } catch (_error) {
    fail(503, "AUTH_SERVICE_UNAVAILABLE", "Dịch vụ xác thực tạm thời không khả dụng.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) fail(401, "INVALID_SESSION", "Phiên đăng nhập không còn hợp lệ.");
  const user = data.users?.[0];
  if (!user?.localId || !user.email) fail(401, "INVALID_SESSION", "Firebase không trả về tài khoản hợp lệ.");
  if (user.disabled) fail(403, "ACCOUNT_DISABLED", "Tài khoản quản trị đã bị vô hiệu hóa.");
  if (String(env.REQUIRE_VERIFIED_EMAIL || "false") === "true" && !user.emailVerified) fail(403, "EMAIL_NOT_VERIFIED", "Email quản trị chưa được xác minh.");
  const allowedUids = String(env.ADMIN_UIDS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowedEmails = String(env.ADMIN_EMAILS || env.ADMIN_EMAIL || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!allowedUids.length && !allowedEmails.length) fail(503, "ADMIN_NOT_CONFIGURED", "Worker chưa cấu hình tài khoản quản trị.");
  if (allowedUids.length ? !allowedUids.includes(user.localId) : !allowedEmails.includes(user.email.trim().toLowerCase())) {
    fail(403, "ADMIN_FORBIDDEN", "Tài khoản này không có quyền quản trị.");
  }
  return { uid: user.localId, email: user.email.trim().toLowerCase() };
}

async function enforceRateLimit(env, key) {
  if (!env.RATE_LIMITER?.limit) return;
  const result = await env.RATE_LIMITER.limit({ key });
  if (!result.success) fail(429, "RATE_LIMITED", "Bạn thao tác quá nhanh. Hãy thử lại sau một phút.");
}

async function githubRequest(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) fail(503, "GITHUB_NOT_CONFIGURED", "Worker chưa có secret GITHUB_TOKEN.");
  const { owner, repo } = repository(env);
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "teresa-youth-choir-admin",
        ...(init.headers || {})
      }
    });
  } catch (_error) {
    fail(503, "GITHUB_UNAVAILABLE", "GitHub tạm thời không khả dụng.");
  }
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_error) { body = {}; }
  if (!response.ok) {
    if (response.status === 404) fail(404, "GITHUB_NOT_FOUND", "Không tìm thấy dữ liệu yêu cầu trên GitHub.");
    if ([409, 422].includes(response.status)) fail(409, "GITHUB_CONFLICT", "Dữ liệu GitHub vừa thay đổi. Hãy tải lại và thử lần nữa.");
    if (response.status === 401 || response.status === 403) fail(503, "GITHUB_PERMISSION", "Worker không có quyền ghi repository GitHub.");
    if (response.status === 429 || response.status >= 500) fail(503, "GITHUB_UNAVAILABLE", "GitHub tạm thời không khả dụng.");
    fail(502, "GITHUB_ERROR", "GitHub không thể xử lý yêu cầu.");
  }
  return body;
}

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(String(value || "").replace(/\n/g, "")), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readGitHubJson(env, path, ref, optional = false) {
  try {
    const file = await githubRequest(env, `/contents/${pathUrl(path)}?ref=${encodeURIComponent(ref)}`);
    let encoded = file.content;
    // The Contents API omits `content` for files above 1 MB. Fall back to the
    // Git Blob API so large album manifests can still be restored safely.
    if (!encoded && file.sha) {
      const blob = await githubRequest(env, `/git/blobs/${encodeURIComponent(file.sha)}`);
      if (blob.encoding !== "base64" || !blob.content) fail(502, "INVALID_REPOSITORY_FILE", `Không thể đọc tệp ${path} từ GitHub.`);
      encoded = blob.content;
    }
    return JSON.parse(decodeBase64Utf8(encoded));
  } catch (error) {
    if (optional && error instanceof HttpError && error.status === 404) return null;
    if (error instanceof SyntaxError) fail(502, "INVALID_REPOSITORY_JSON", `Tệp ${path} trên GitHub không phải JSON hợp lệ.`);
    throw error;
  }
}

async function gitHead(env, branch) {
  const ref = await githubRequest(env, `/git/ref/heads/${pathUrl(branch)}`);
  return ref.object?.sha;
}

async function createAtomicCommit(env, branch, baseSha, changes, message) {
  const baseCommit = await githubRequest(env, `/git/commits/${encodeURIComponent(baseSha)}`);
  const entries = [];
  for (const [path, content] of changes) {
    if (content === null) {
      entries.push({ path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await githubRequest(env, "/git/blobs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, encoding: "utf-8" })
    });
    entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await githubRequest(env, "/git/trees", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries })
  });
  const commit = await githubRequest(env, "/git/commits", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] })
  });
  await githubRequest(env, `/git/refs/heads/${pathUrl(branch)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return commit;
}

async function commitYear(env, input, branch, message, expectedHead = "") {
  if (expectedHead && !/^[a-f0-9]{7,40}$/i.test(expectedHead)) fail(422, "INVALID_REVISION", "Mã phiên bản cơ sở không hợp lệ.");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await gitHead(env, branch);
    const previousData = await readGitHubJson(env, `data/${input.year}.json`, head, true);
    if (expectedHead && head !== expectedHead) {
      // The branch may move because another year was saved. Only report a real
      // conflict when this exact year changed since the revision the editor read.
      const baseData = await readGitHubJson(env, `data/${input.year}.json`, expectedHead, true);
      if (JSON.stringify(baseData) !== JSON.stringify(previousData)) {
        fail(409, "STALE_DATA", "Năm này đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu.");
      }
    }
    const currentIndex = await readGitHubJson(env, "data/index.json", head, true);
    const data = clone(input);
    const changes = buildAlbumChanges(data, previousData);
    const index = mergeIndex(currentIndex, data);
    changes.set(`data/${data.year}.json`, JSON.stringify(data, null, 2) + "\n");
    changes.set("data/index.json", JSON.stringify(index, null, 2) + "\n");
    try {
      const commit = await createAtomicCommit(env, branch, head, changes, message);
      return { commit, data, index, manifests: [...changes.keys()].filter((path) => path.startsWith("data/albums/") && changes.get(path) !== null) };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "GITHUB_CONFLICT" || attempt === 2) throw error;
    }
  }
  fail(409, "GITHUB_CONFLICT", "Dữ liệu thay đổi liên tục. Hãy thử lại.");
}

async function hydrateExternalAlbums(env, data, ref) {
  const copyData = clone(data);
  for (const activity of copyData.activities || []) {
    const manifestPath = activity.album?.manifest || activity.albumManifest;
    if (Object.prototype.hasOwnProperty.call(activity, "images") || !manifestPath) continue;
    const manifest = await readGitHubJson(env, manifestPath, ref);
    if (!Array.isArray(manifest?.images)) fail(502, "INVALID_ALBUM_MANIFEST", `Album ${manifestPath} trên GitHub không hợp lệ.`);
    activity.images = manifest.images;
    delete activity.album;
    delete activity.albumManifest;
    delete activity.imageCount;
  }
  if (copyData.galleryAlbum?.manifest) {
    const manifestPath = copyData.galleryAlbum.manifest;
    const manifest = await readGitHubJson(env, manifestPath, ref);
    if (!Array.isArray(manifest?.images)) fail(502, "INVALID_ALBUM_MANIFEST", `Album ${manifestPath} trên GitHub không hợp lệ.`);
    copyData.gallery = manifest.images;
    delete copyData.galleryAlbum;
  }
  return copyData;
}

function mediaUrl(request, env, key) {
  const base = String(env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return base ? `${base}/${pathUrl(key)}` : new URL(`/media/${pathUrl(key)}`, request.url).toString();
}

function validMediaKey(key, env) {
  const match = /^media\/(\d{4})\/[a-z0-9-]+\/.+/.exec(key);
  if (!match) return false;
  try { cleanYear(match[1], env); return !key.split("/").includes(".."); }
  catch (_error) { return false; }
}

function detectImageType(bytes) {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 64));
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (view.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => view[index] === value)) return { mime: "image/png", extension: "png" };
  if (view.length >= 12 && String.fromCharCode(...view.slice(0, 4)) === "RIFF" && String.fromCharCode(...view.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  if (view.length >= 12 && String.fromCharCode(...view.slice(4, 8)) === "ftyp") {
    for (let offset = 8; offset + 4 <= view.length; offset += 4) {
      const brand = String.fromCharCode(...view.slice(offset, offset + 4));
      if (["avif", "avis"].includes(brand)) return { mime: "image/avif", extension: "avif" };
    }
  }
  return null;
}

async function preparedUpload(file, label, maximum) {
  if (!file || typeof file.arrayBuffer !== "function") fail(422, "IMAGE_REQUIRED", `Thiếu ảnh ${label}.`);
  if (file.size <= 0 || file.size > maximum) fail(413, "IMAGE_TOO_LARGE", `Ảnh ${label} vượt quá giới hạn cho phép.`);
  const bytes = await file.arrayBuffer();
  const detected = detectImageType(bytes);
  if (!detected || !ALLOWED_IMAGE_TYPES.has(detected.mime)) fail(415, "UNSUPPORTED_IMAGE", "Chỉ chấp nhận JPEG, PNG, WebP hoặc AVIF; SVG không được phép.");
  if (file.type && file.type !== "application/octet-stream" && file.type.toLowerCase() !== detected.mime) fail(415, "MIME_MISMATCH", `Định dạng thật của ảnh ${label} không khớp loại tệp.`);
  return { bytes, ...detected, originalName: safeFilename(file.name) };
}

function positiveDimension(value) {
  return boundedInteger(value, 0, 1, 30000);
}

async function uploadMedia(request, env) {
  if (!env.MEDIA_BUCKET) fail(503, "R2_NOT_CONFIGURED", "Worker chưa được gắn R2 binding MEDIA_BUCKET.");
  assertContentLength(request, MULTIPART_LIMIT);
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) fail(415, "MULTIPART_REQUIRED", "API tải ảnh yêu cầu multipart/form-data.");
  const form = await request.formData();
  const submittedBytes = [...form.values()].reduce((total, value) => (
    value && typeof value === "object" && typeof value.arrayBuffer === "function" ? total + Number(value.size || 0) : total
  ), 0);
  if (submittedBytes > MULTIPART_LIMIT) fail(413, "UPLOAD_TOO_LARGE", "Tổng dung lượng multipart vượt quá giới hạn.");
  const year = cleanYear(form.get("year"), env);
  const topic = safeText(String(form.get("topic") || "Khác"), "Chủ đề ảnh", 200, true);
  const caption = safeText(String(form.get("caption") || ""), "Chú thích ảnh", 1000);
  const alt = safeText(String(form.get("alt") || ""), "Mô tả ảnh", 500);
  const activityId = safeText(String(form.get("activityId") || ""), "Mã hoạt động của ảnh", 120);
  const draftId = safeText(String(form.get("draftId") || ""), "Mã bản nháp của ảnh", 120);
  if (activityId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(activityId)) fail(422, "INVALID_ACTIVITY_ID", "Mã hoạt động của ảnh không hợp lệ.");
  if (draftId && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(draftId)) fail(422, "INVALID_DRAFT_ID", "Mã bản nháp của ảnh không hợp lệ.");
  const legacyFile = form.get("file");
  const originalFile = form.get("original") || legacyFile;
  const mediumFile = form.get("medium");
  const thumbnailFile = form.get("thumbnail") || form.get("thumb");
  const original = await preparedUpload(originalFile, "gốc", ORIGINAL_LIMIT);
  const medium = mediumFile && typeof mediumFile.arrayBuffer === "function" && mediumFile.size
    ? await preparedUpload(mediumFile, "cỡ vừa", MEDIUM_LIMIT) : null;
  const thumbnail = thumbnailFile && typeof thumbnailFile.arrayBuffer === "function" && thumbnailFile.size
    ? await preparedUpload(thumbnailFile, "thu nhỏ", THUMB_LIMIT) : null;
  if (original.bytes.byteLength + (medium?.bytes.byteLength || 0) + (thumbnail?.bytes.byteLength || 0) > MULTIPART_LIMIT) {
    fail(413, "UPLOAD_TOO_LARGE", "Tổng dung lượng ba phiên bản ảnh vượt quá giới hạn.");
  }
  const requestedAssetId = String(form.get("assetId") || "");
  const assetId = /^[a-zA-Z0-9_-]{8,100}$/.test(requestedAssetId) ? requestedAssetId : crypto.randomUUID();
  const root = `media/${year}/${slug(topic)}/${assetId}`;
  const variants = {
    original: { prepared: original, key: `${root}/original.${original.extension}`, width: positiveDimension(form.get("originalWidth")), height: positiveDimension(form.get("originalHeight")) }
  };
  if (medium) variants.medium = { prepared: medium, key: `${root}/medium.${medium.extension}`, width: positiveDimension(form.get("mediumWidth")), height: positiveDimension(form.get("mediumHeight")) };
  if (thumbnail) variants.thumbnail = { prepared: thumbnail, key: `${root}/thumb.${thumbnail.extension}`, width: positiveDimension(form.get("thumbnailWidth")), height: positiveDimension(form.get("thumbnailHeight")) };
  const createdAt = new Date().toISOString();
  const keyMap = Object.fromEntries(Object.entries(variants).map(([name, item]) => [name, item.key]));
  const dimensionMetadata = {
    originalWidth: String(variants.original.width || ""), originalHeight: String(variants.original.height || ""),
    mediumWidth: String(variants.medium?.width || variants.original.width || ""), mediumHeight: String(variants.medium?.height || variants.original.height || ""),
    thumbnailWidth: String(variants.thumbnail?.width || variants.medium?.width || variants.original.width || ""),
    thumbnailHeight: String(variants.thumbnail?.height || variants.medium?.height || variants.original.height || "")
  };
  try {
    await Promise.all(Object.entries(variants).map(([variant, item]) => env.MEDIA_BUCKET.put(item.key, item.prepared.bytes, {
      httpMetadata: {
        contentType: item.prepared.mime,
        contentDisposition: `inline; filename="${safeFilename(item.prepared.originalName)}"`,
        cacheControl: "public, max-age=31536000, immutable"
      },
      customMetadata: {
        schemaVersion: "3", assetId, assetRoot: root, variant, year: String(year), topic,
        activityId, draftId, filename: original.originalName, caption, alt: alt || original.originalName, createdAt,
        originalKey: keyMap.original, mediumKey: keyMap.medium || "", thumbnailKey: keyMap.thumbnail || "",
        width: String(item.width || ""), height: String(item.height || ""), ...dimensionMetadata
      }
    })));
  } catch (_error) {
    await env.MEDIA_BUCKET.delete(Object.values(keyMap)).catch(() => undefined);
    fail(503, "R2_UPLOAD_FAILED", "Không thể lưu đủ các phiên bản ảnh. Không có ảnh dở dang nào được giữ lại.");
  }
  const descriptor = (name) => {
    const item = variants[name] || variants.original;
    return { id: item.key, src: mediaUrl(request, env, item.key), width: item.width || 0, height: item.height || 0 };
  };
  const originalDescriptor = descriptor("original");
  const mediumDescriptor = descriptor("medium");
  const thumbnailDescriptor = descriptor("thumbnail");
  return {
    ok: true,
    id: originalDescriptor.id,
    src: mediumDescriptor.src,
    year,
    topic,
    activityId,
    draftId,
    filename: original.originalName,
    caption,
    alt: alt || original.originalName,
    createdAt,
    original: originalDescriptor,
    medium: mediumDescriptor,
    thumbnail: thumbnailDescriptor,
    variants: { original: originalDescriptor, medium: mediumDescriptor, thumbnail: thumbnailDescriptor },
    legacyFallback: !medium || !thumbnail
  };
}

function mediaDescriptorFromObject(request, env, item) {
  const metadata = item.customMetadata || {};
  const originalKey = metadata.originalKey || item.key;
  const mediumKey = metadata.mediumKey || originalKey;
  const thumbnailKey = metadata.thumbnailKey || mediumKey;
  const variant = (key, width = 0, height = 0) => ({ id: key, src: mediaUrl(request, env, key), width, height });
  const original = variant(originalKey, positiveDimension(metadata.originalWidth || metadata.width), positiveDimension(metadata.originalHeight || metadata.height));
  const medium = variant(mediumKey, positiveDimension(metadata.mediumWidth), positiveDimension(metadata.mediumHeight));
  const thumbnail = variant(thumbnailKey, positiveDimension(metadata.thumbnailWidth), positiveDimension(metadata.thumbnailHeight));
  return {
    id: originalKey,
    src: medium.src,
    year: Number(metadata.year || item.key.split("/")[1]),
    topic: metadata.topic || item.key.split("/")[2] || "Khác",
    activityId: metadata.activityId || "",
    draftId: metadata.draftId || "",
    filename: metadata.filename || item.key.split("/").at(-1),
    caption: metadata.caption || "",
    alt: metadata.alt || metadata.filename || item.key.split("/").at(-1),
    createdAt: metadata.createdAt || item.uploaded?.toISOString?.() || "",
    original,
    medium,
    thumbnail,
    variants: { original, medium, thumbnail }
  };
}

async function listMedia(request, env, url) {
  if (!env.MEDIA_BUCKET) fail(503, "R2_NOT_CONFIGURED", "Worker chưa được gắn R2 binding MEDIA_BUCKET.");
  const year = cleanYear(url.searchParams.get("year"), env);
  const topic = String(url.searchParams.get("topic") || "").trim();
  const activityId = String(url.searchParams.get("activityId") || "").trim();
  const cursor = url.searchParams.get("cursor") || undefined;
  const limit = boundedInteger(url.searchParams.get("limit"), 500, 1, 1000);
  const prefix = topic && topic !== "Tất cả" ? `media/${year}/${slug(topic)}/` : `media/${year}/`;
  const page = await env.MEDIA_BUCKET.list({ prefix, cursor, limit, include: ["customMetadata", "httpMetadata"] });
  const items = page.objects
    .filter((item) => !item.customMetadata?.variant || item.customMetadata.variant === "original")
    .map((item) => mediaDescriptorFromObject(request, env, item))
    .filter((item) => (!topic || topic === "Tất cả" || item.topic === topic || slug(item.topic) === slug(topic)) && (!activityId || item.activityId === activityId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    ok: true,
    items,
    cursor: page.truncated ? page.cursor : null,
    hasMore: Boolean(page.truncated),
    truncated: Boolean(page.truncated)
  };
}

function etagMatches(header, etag) {
  if (!header) return false;
  return header.split(",").map((item) => item.trim()).some((item) => item === "*" || item === etag || item.replace(/^W\//, "") === etag);
}

async function serveMedia(request, env, ctx, key) {
  if (!validMediaKey(key, env) || !env.MEDIA_BUCKET) return new Response("Không tìm thấy ảnh.", { status: 404 });
  let hasRange = Boolean(request.headers.get("Range"));
  const cache = caches.default;
  if (request.method === "GET" && !hasRange) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  let object;
  try {
    object = request.method === "HEAD"
      ? await env.MEDIA_BUCKET.head(key)
      : await env.MEDIA_BUCKET.get(key, hasRange ? { range: request.headers } : undefined);
  } catch (_error) {
    if (hasRange) return new Response("Khoảng dữ liệu không hợp lệ.", { status: 416, headers: { "Content-Range": "bytes */*" } });
    throw _error;
  }
  if (!object) return new Response("Không tìm thấy ảnh.", { status: 404 });
  const ifRange = request.headers.get("If-Range");
  if (hasRange && ifRange && ifRange !== object.httpEtag) {
    object = await env.MEDIA_BUCKET.get(key);
    hasRange = false;
    if (!object) return new Response("Không tìm thấy ảnh.", { status: 404 });
  }
  if (etagMatches(request.headers.get("If-None-Match"), object.httpEtag)) {
    return new Response(null, { status: 304, headers: { ETag: object.httpEtag, "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const mediaType = String(headers.get("Content-Type") || "").toLowerCase();
  if (mediaType.includes("svg") || (mediaType && !ALLOWED_IMAGE_TYPES.has(mediaType) && mediaType !== "image/gif")) {
    return new Response("Định dạng ảnh không được phục vụ.", { status: 415 });
  }
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  let status = 200;
  if (hasRange && object.range) {
    status = 206;
    const offset = Number(object.range.offset || 0);
    const length = Number(object.range.length || object.size);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
  } else if (object.size !== undefined) headers.set("Content-Length", String(object.size));
  const response = new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  if (request.method === "GET" && status === 200) ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function deleteMedia(request, env) {
  const body = await readJson(request, 16 * 1024);
  const key = String(body.path || body.id || "");
  if (validMediaKey(key, env)) {
    if (!env.MEDIA_BUCKET) fail(503, "R2_NOT_CONFIGURED", "Worker chưa được gắn R2 binding MEDIA_BUCKET.");
    const object = await env.MEDIA_BUCKET.head(key);
    if (!object) fail(404, "MEDIA_NOT_FOUND", "Không tìm thấy ảnh trong R2.");
    const root = object.customMetadata?.assetRoot;
    let keys = [key];
    if (root && key.startsWith(`${root}/`)) {
      const listed = await env.MEDIA_BUCKET.list({ prefix: `${root}/`, limit: 1000 });
      keys = listed.objects.map((item) => item.key);
    }
    await env.MEDIA_BUCKET.delete(keys);
    const workerOrigin = new URL(request.url).origin;
    const publicBase = String(env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
    const cacheRequests = keys.flatMap((item) => {
      const paths = [new URL(`/media/${pathUrl(item)}`, workerOrigin).toString()];
      if (publicBase) paths.push(`${publicBase}/${pathUrl(item)}`);
      return [...new Set(paths)].map((url) => new Request(url));
    });
    await Promise.all(cacheRequests.map((cacheRequest) => caches.default.delete(cacheRequest).catch(() => false)));
    return { ok: true, deleted: keys };
  }
  if (!/^images\/uploads\/\d{4}\//.test(key) || key.split("/").includes("..")) fail(422, "INVALID_MEDIA_PATH", "Đường dẫn ảnh không hợp lệ.");
  const branch = branchName(env);
  const file = await githubRequest(env, `/contents/${pathUrl(key)}?ref=${encodeURIComponent(branch)}`);
  const result = await githubRequest(env, `/contents/${pathUrl(key)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `admin: xóa ảnh cũ ${key}`, sha: file.sha, branch })
  });
  return { ok: true, commit: result.commit?.sha, deleted: [key] };
}

function expectedCommit(request) {
  return String(request.headers.get("If-Match") || "").replace(/^W\//, "").replace(/^"|"$/g, "");
}

function isMutation(request, pathname) {
  return pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const publicMedia = /^\/media\//.test(url.pathname);
  if (request.method === "OPTIONS") {
    if (publicMedia) return new Response(null, { status: 204 });
    if (!isAllowedOrigin(request.headers.get("Origin") || "", env)) fail(403, "ORIGIN_FORBIDDEN", "Nguồn gửi yêu cầu không được phép.");
    return new Response(null, { status: 204 });
  }
  if (["GET", "HEAD"].includes(request.method) && publicMedia) {
    let key;
    try { key = decodeURIComponent(url.pathname.slice("/media/".length)); }
    catch (_error) { fail(400, "INVALID_MEDIA_PATH", "Đường dẫn ảnh không hợp lệ."); }
    return serveMedia(request, env, ctx, key);
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      service: "teresa-admin-api",
      environment: environment(env),
      release: String(env.RELEASE || "development"),
      bindings: { media: Boolean(env.MEDIA_BUCKET), rateLimiter: Boolean(env.RATE_LIMITER) },
      yearRange: yearBounds(env)
    });
  }
  if (!url.pathname.startsWith("/api/")) fail(404, "NOT_FOUND", "Không tìm thấy API.");
  if (isMutation(request, url.pathname) && !isAllowedOrigin(request.headers.get("Origin") || "", env)) {
    fail(403, "ORIGIN_FORBIDDEN", "Nguồn gửi yêu cầu không được phép.");
  }
  const clientKey = request.headers.get("CF-Connecting-IP") || "unknown";
  await enforceRateLimit(env, `preauth:${clientKey}`);
  const admin = await verifyAdmin(request, env);
  await enforceRateLimit(env, `admin:${admin.uid}:${request.method}:${url.pathname.split("/").slice(0, 4).join("/")}`);

  if (request.method === "GET" && url.pathname === "/api/session") {
    return json({ ok: true, email: admin.email, uid: admin.uid, environment: environment(env), branch: branchName(env) });
  }

  const yearMatch = /^\/api\/years\/(\d{4})$/.exec(url.pathname);
  if (request.method === "GET" && yearMatch) {
    const year = cleanYear(yearMatch[1], env);
    const branch = branchName(env);
    const head = await gitHead(env, branch);
    if (etagMatches(request.headers.get("If-None-Match"), `"${head}"`)) {
      return new Response(null, { status: 304, headers: { ETag: `"${head}"`, "Cache-Control": "private, no-cache" } });
    }
    let data = await readGitHubJson(env, `data/${year}.json`, head);
    data = await hydrateExternalAlbums(env, data, head);
    return json({ ok: true, data, year, branch, revision: head, commit: head }, 200, { ETag: `"${head}"` });
  }
  if (request.method === "PUT" && yearMatch) {
    const year = cleanYear(yearMatch[1], env);
    const payload = await readJson(request);
    const envelope = isObject(payload?.data) ? payload : { data: payload };
    const mode = safeText(envelope.mode || "publish", "Chế độ lưu", 30, true).toLowerCase();
    if (!["publish", "draft", "import", "restore"].includes(mode)) fail(422, "INVALID_SAVE_MODE", "Chế độ lưu dữ liệu không hợp lệ.");
    const data = validateYearPayload(envelope.data, year, env);
    const baseRevision = expectedCommit(request) || String(envelope.baseRevision || "");
    const action = { publish: "cập nhật", draft: "lưu nháp", import: "nhập bản sao lưu", restore: "khôi phục" }[mode];
    const result = await commitYear(env, data, branchName(env), `admin: ${action} dữ liệu năm ${year}`, baseRevision);
    return json({
      ok: true,
      data: result.data,
      path: `data/${year}.json`,
      indexPath: "data/index.json",
      albumManifests: result.manifests,
      revision: result.commit.sha,
      commit: result.commit.sha,
      mode
    }, 200, { ETag: `"${result.commit.sha}"` });
  }

  const historyMatch = /^\/api\/years\/(\d{4})\/history$/.exec(url.pathname);
  if (request.method === "GET" && historyMatch) {
    const year = cleanYear(historyMatch[1], env);
    const limit = boundedInteger(url.searchParams.get("limit"), 20, 1, 100);
    const commits = await githubRequest(env, `/commits?path=${encodeURIComponent(`data/${year}.json`)}&sha=${encodeURIComponent(branchName(env))}&per_page=${limit}`);
    return json({ ok: true, year, items: commits.map((item) => ({
      revision: item.sha,
      sha: item.sha,
      label: item.commit?.message || "Phiên bản dữ liệu",
      message: item.commit?.message || "",
      timestamp: item.commit?.committer?.date || "",
      date: item.commit?.committer?.date || "",
      author: item.commit?.author?.name || ""
    })) });
  }

  const historyDetailMatch = /^\/api\/years\/(\d{4})\/history\/([a-f0-9]{7,40})$/i.exec(url.pathname);
  if (request.method === "GET" && historyDetailMatch) {
    const year = cleanYear(historyDetailMatch[1], env);
    const revision = historyDetailMatch[2];
    let data = await readGitHubJson(env, `data/${year}.json`, revision);
    data = await hydrateExternalAlbums(env, data, revision);
    return json({ ok: true, year, data, revision, commit: revision }, 200, { ETag: `"${revision}"` });
  }

  const restoreMatch = /^\/api\/years\/(\d{4})\/restore$/.exec(url.pathname);
  if (request.method === "POST" && restoreMatch) {
    const year = cleanYear(restoreMatch[1], env);
    const body = await readJson(request, 32 * 1024);
    const commitSha = String(body.commitSha || "");
    if (!/^[a-f0-9]{7,40}$/i.test(commitSha)) fail(422, "INVALID_COMMIT", "Mã phiên bản GitHub không hợp lệ.");
    let data = await readGitHubJson(env, `data/${year}.json`, commitSha);
    data = await hydrateExternalAlbums(env, data, commitSha);
    data = validateYearPayload(data, year, env);
    const result = await commitYear(env, data, branchName(env), `admin: khôi phục dữ liệu năm ${year} từ ${commitSha.slice(0, 12)}`, expectedCommit(request) || String(body.baseRevision || ""));
    return json({ ok: true, year, data: result.data, revision: result.commit.sha, commit: result.commit.sha, restoredFrom: commitSha }, 200, { ETag: `"${result.commit.sha}"` });
  }

  const publishMatch = /^\/api\/years\/(\d{4})\/publish$/.exec(url.pathname);
  if (request.method === "POST" && publishMatch) {
    const year = cleanYear(publishMatch[1], env);
    const sourceBranch = branchName(env);
    const targetBranch = String(env.PUBLISH_BRANCH || "main");
    if (sourceBranch === targetBranch) fail(409, "ALREADY_PRODUCTION", "Môi trường hiện tại đã ghi trực tiếp vào nhánh xuất bản.");
    const sourceHead = await gitHead(env, sourceBranch);
    let data = await readGitHubJson(env, `data/${year}.json`, sourceHead);
    data = await hydrateExternalAlbums(env, data, sourceHead);
    data = validateYearPayload(data, year, env);
    const result = await commitYear(env, data, targetBranch, `admin: xuất bản dữ liệu năm ${year} từ ${sourceBranch}`);
    return json({ ok: true, year, data: result.data, sourceBranch, targetBranch, sourceCommit: sourceHead, revision: result.commit.sha, commit: result.commit.sha });
  }

  if (url.pathname === "/api/media" && request.method === "POST") return json(await uploadMedia(request, env), 201);
  if (url.pathname === "/api/media" && request.method === "GET") return json(await listMedia(request, env, url));
  if (url.pathname === "/api/media" && request.method === "DELETE") return json(await deleteMedia(request, env));
  fail(404, "NOT_FOUND", "Không tìm thấy API.");
}

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const requestId = request.headers.get("CF-Ray") || crypto.randomUUID();
    const pathname = new URL(request.url).pathname;
    let response;
    let errorCode = "";
    try {
      response = await route(request, env, ctx);
    } catch (error) {
      const known = error instanceof HttpError;
      const status = known ? error.status : 500;
      errorCode = known ? error.code : "INTERNAL_ERROR";
      if (!known) console.error(JSON.stringify({ event: "worker_exception", requestId, route: pathname, message: String(error?.message || error) }));
      const headers = status === 429 ? { "Retry-After": "60" } : {};
      response = json({ error: known ? error.message : "Máy chủ gặp lỗi ngoài dự kiến.", code: errorCode, requestId, ...(known && error.details ? { details: error.details } : {}) }, status, headers);
    }
    const duration = Date.now() - startedAt;
    const publicMedia = pathname.startsWith("/media/");
    const finalResponse = responseWithHeaders(response, request, env, requestId, duration, publicMedia);
    console.log(JSON.stringify({
      event: "request", requestId, environment: environment(env), method: request.method,
      route: pathname.replace(/\/[a-f0-9-]{24,}/ig, "/:id"), status: finalResponse.status,
      durationMs: duration, errorCode: errorCode || undefined
    }));
    return finalResponse;
  }
};
