#!/usr/bin/env node

/**
 * Đồng bộ toàn bộ ảnh cục bộ đang được dữ liệu tham chiếu lên Cloudflare R2.
 *
 * Mặc định chỉ thống kê. Dùng --upload để tải ba biến thể lên R2, --verify để
 * kiểm tra URL Worker và --rewrite để thay đường dẫn cục bộ trong JSON. Dữ liệu
 * chỉ được ghi lại sau khi toàn bộ upload và kiểm tra hoàn tất.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Schema = require("../js/schema.js");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(projectRoot, "data");
const workerRoot = path.join(projectRoot, "cloudflare-worker");
const publicBase = String(process.env.R2_MEDIA_PUBLIC_BASE || "https://teresa-admin-api.chanvcl10.workers.dev/media").replace(/\/+$/, "");
const bucket = String(process.env.R2_MEDIA_BUCKET || "teresa-choir-images");
const localWrangler = path.join(projectRoot, "node_modules", ".bin", "wrangler");
const wrangler = process.env.WRANGLER_BIN || (existsSync(localWrangler) ? localWrangler : "npx");
const wranglerPrefix = wrangler === "npx" ? ["--yes", "wrangler@latest"] : [];
const shouldUpload = process.argv.includes("--upload");
const shouldVerify = process.argv.includes("--verify");
const shouldRewrite = process.argv.includes("--rewrite");
const concurrency = Math.max(1, Math.min(10, Number(process.env.R2_UPLOAD_CONCURRENCY || 6)));
const localImage = /^images\/.+\.(?:jpe?g|png|webp|avif)$/i;
const mediaKeys = new Set(["coverImage", "photo"]);
const mediaArrayKeys = new Set(["images", "gallery", "preview", "previews"]);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const posix = (value) => value.split(path.sep).join("/");

function slug(value) {
  return String(value || "archive")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "archive";
}

function ownerYear(filename) {
  const match = posix(filename).match(/(?:^|\/)data(?:\/albums)?\/(\d{4})(?:\.json|\/)/);
  return Number(match?.[1] || 0);
}

function dimensions(relativePath) {
  const result = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path.join(projectRoot, relativePath)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Không đọc được kích thước ${relativePath}`);
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1] || 0);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1] || 0);
  if (!width || !height) throw new Error(`Không xác định được kích thước ${relativePath}`);
  return { width, height };
}

function variantSource(media, name, fallback) {
  const variants = media?.variants || {};
  const candidate = name === "thumbnail" ? variants.thumbnail || variants.thumb : variants[name];
  if (typeof candidate === "string") return { src: candidate, ...dimensions(candidate) };
  if (candidate?.src) return { ...candidate, width: Number(candidate.width || 0), height: Number(candidate.height || 0) };
  return fallback;
}

function assetLocation(source, year) {
  const relative = source.replace(/^images\//, "");
  const parts = relative.split("/");
  let topic = "archive";
  if (["journal", "uploads"].includes(parts[0]) && Number(parts[1]) === year && parts[2]) topic = parts[2];
  else if (parts[0] === "gallery") topic = "gallery";
  const basename = path.basename(source, path.extname(source));
  return { topic: slug(topic), asset: slug(basename) };
}

async function dataFiles() {
  const files = (await readdir(dataRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name))
    .map((entry) => path.join(dataRoot, entry.name));
  const albumsRoot = path.join(dataRoot, "albums");
  for (const yearEntry of await readdir(albumsRoot, { withFileTypes: true })) {
    if (!yearEntry.isDirectory()) continue;
    const directory = path.join(albumsRoot, yearEntry.name);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) files.push(path.join(directory, entry.name));
    }
  }
  return files.sort();
}

const assets = new Map();
const occupiedRoots = new Map();
const transformedFiles = new Map();
const changedYears = new Set();

function targetRoot(source, year) {
  const location = assetLocation(source, year);
  let root = `media/${year}/${location.topic}/${location.asset}`;
  const owner = occupiedRoots.get(root);
  if (owner && owner !== source) root += `-${createHash("sha1").update(source).digest("hex").slice(0, 8)}`;
  occupiedRoots.set(root, source);
  return root;
}

function registerMedia(value, year) {
  const media = typeof value === "string" ? { src: value, id: value, alt: "", caption: "" } : value;
  const originalCandidate = variantSource(media, "original", null);
  const originalSource = originalCandidate?.src && localImage.test(originalCandidate.src) ? originalCandidate.src : media.src;
  if (!localImage.test(originalSource)) return value;
  const assetKey = `${year}\0${originalSource}`;
  let asset = assets.get(assetKey);
  if (!asset) {
    const original = originalCandidate?.src ? originalCandidate : { src: originalSource, ...dimensions(originalSource) };
    const medium = variantSource(media, "medium", original);
    const thumbnail = variantSource(media, "thumbnail", medium);
    const root = targetRoot(originalSource, year);
    const build = (name, descriptor) => ({
      name,
      source: descriptor.src,
      sourceAbsolute: path.join(projectRoot, descriptor.src),
      key: `${root}/${name === "thumbnail" ? "thumb" : name}.jpg`,
      width: Number(descriptor.width || dimensions(descriptor.src).width),
      height: Number(descriptor.height || dimensions(descriptor.src).height),
    });
    asset = { year, source: originalSource, root, variants: {
      original: build("original", original),
      medium: build("medium", medium),
      thumbnail: build("thumbnail", thumbnail),
    } };
    assets.set(assetKey, asset);
  }
  const variant = (name) => {
    const item = asset.variants[name];
    return { src: `${publicBase}/${item.key}`, width: item.width, height: item.height };
  };
  return {
    ...media,
    id: asset.variants.original.key,
    src: `${publicBase}/${asset.variants.medium.key}`,
    variants: {
      thumbnail: variant("thumbnail"),
      medium: variant("medium"),
      original: variant("original"),
    },
  };
}

function transform(value, year, parentKey = "", inMediaArray = false) {
  if (typeof value === "string") {
    return localImage.test(value) && (mediaKeys.has(parentKey) || inMediaArray) ? registerMedia(value, year) : value;
  }
  if (Array.isArray(value)) return value.map((item) => transform(item, year, parentKey, inMediaArray || mediaArrayKeys.has(parentKey)));
  if (!value || typeof value !== "object") return value;
  if (typeof value.src === "string") return localImage.test(value.src) ? registerMedia(value, year) : value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child, year, key, mediaArrayKeys.has(key))]));
}

async function atomicWrite(target, content) {
  const temporary = `${target}.r2-sync-${process.pid}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

function uploadOne(task) {
  return new Promise((resolve, reject) => {
    const child = spawn(wrangler, [
      ...wranglerPrefix,
      "r2", "object", "put", `${bucket}/${task.key}`,
      "--file", task.sourceAbsolute,
      "--content-type", "image/jpeg",
      "--cache-control", "public, max-age=31536000, immutable",
      "--remote", "--force",
    ], {
      cwd: workerRoot,
      env: { ...process.env, npm_config_cache: process.env.npm_config_cache || path.join(os.tmpdir(), "teresa-npm-cache") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Upload thất bại ${task.key}: ${output.slice(-1200)}`)));
  });
}

async function parallel(items, limit, handler, label) {
  let next = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await handler(items[index], index);
      completed += 1;
      if (completed % 10 === 0 || completed === items.length) console.log(`${label}: ${completed}/${items.length}`);
    }
  });
  await Promise.all(workers);
}

async function verifyOne(task) {
  const response = await fetch(`${publicBase}/${task.key}`, { method: "HEAD", redirect: "follow" });
  if (!response.ok) throw new Error(`URL chưa sẵn sàng (${response.status}): ${task.key}`);
}

for (const filename of await dataFiles()) {
  const year = ownerYear(filename);
  if (!year) continue;
  const before = JSON.parse(await readFile(filename, "utf8"));
  const after = transform(before, year);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    transformedFiles.set(filename, after);
    if (filename === path.join(dataRoot, `${year}.json`)) changedYears.add(year);
  }
}

const uploadTasks = [...assets.values()].flatMap((asset) => Object.values(asset.variants));
const bytes = (await Promise.all(uploadTasks.map((task) => stat(task.sourceAbsolute)))).reduce((sum, item) => sum + item.size, 0);
const byYear = {};
for (const asset of assets.values()) byYear[asset.year] = (byYear[asset.year] || 0) + 1;
console.log(`R2 ${bucket}: ${assets.size} ảnh, ${uploadTasks.length} object, ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
console.log(`Theo năm: ${Object.entries(byYear).sort().map(([year, count]) => `${year}: ${count}`).join(" · ")}`);

if (shouldUpload) await parallel(uploadTasks, concurrency, uploadOne, "Đã upload");
if (shouldVerify) await parallel(uploadTasks, Math.min(16, concurrency * 2), verifyOne, "Đã kiểm tra");

if (shouldRewrite) {
  if (!shouldUpload || !shouldVerify) throw new Error("Chỉ ghi lại JSON khi chạy đồng thời --upload và --verify.");
  for (const year of changedYears) {
    const filename = path.join(dataRoot, `${year}.json`);
    const data = transformedFiles.get(filename);
    if (data?.meta) data.meta.revision = Number(data.meta.revision || 0) + 1;
  }
  for (const [filename, data] of transformedFiles) await atomicWrite(filename, json(data));
  const years = [];
  for (const entry of (await readdir(dataRoot)).filter((name) => /^\d{4}\.json$/.test(name)).sort()) {
    years.push(JSON.parse(await readFile(path.join(dataRoot, entry), "utf8")));
  }
  await atomicWrite(path.join(dataRoot, "index.json"), json(Schema.buildIndex(years)));
  console.log(`Đã cập nhật ${transformedFiles.size} tệp JSON và data/index.json.`);
}

if (!shouldUpload && !shouldVerify && !shouldRewrite) console.log("Chưa có tệp hoặc object nào được thay đổi.");
