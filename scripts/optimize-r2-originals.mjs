#!/usr/bin/env node

/**
 * Thu gọn ảnh xem lớn đã có trên R2 mà không đổi URL.
 *
 * Mặc định chỉ thống kê. Dùng --write để giới hạn cạnh dài ở 3200 px và nén
 * JPEG chất lượng 90. Chỉ thay object khi tệp mới nhẹ hơn ít nhất 5%; dữ liệu
 * JSON được cập nhật lại kích thước sau khi tất cả upload thành công.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
const wrangler = process.env.WRANGLER_BIN || path.join(projectRoot, "node_modules", ".bin", "wrangler");
const write = process.argv.includes("--write");
const threshold = Number(process.env.R2_ORIGINAL_MIN_BYTES || 2_000_000);
const maxEdge = Number(process.env.R2_ORIGINAL_MAX_EDGE || 3200);
const quality = Number(process.env.R2_ORIGINAL_QUALITY || 90);
const concurrency = Math.max(1, Math.min(8, Number(process.env.R2_OPTIMIZE_CONCURRENCY || 4)));
const limitArg = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = limitArg ? Math.max(0, Number(limitArg.split("=")[1]) || 0) : 0;
const keyPattern = /\/media\/(media\/\d{4}\/.+\/original\.jpg)(?:[?#]|$)/;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function visitMedia(value, callback) {
  if (Array.isArray(value)) return value.forEach((item) => visitMedia(item, callback));
  if (!value || typeof value !== "object") return;
  const original = value.variants?.original;
  const source = typeof original === "string" ? original : original?.src;
  const match = String(source || "").match(keyPattern);
  if (match) callback(value, original, match[1]);
  Object.values(value).forEach((item) => visitMedia(item, callback));
}

async function responseSize(url) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (!response.ok) throw new Error(`HEAD ${response.status}: ${url}`);
  return Number(response.headers.get("content-length") || 0);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(output.slice(-2000) || `${command} thoát với mã ${code}`)));
  });
}

async function dimensions(filename) {
  const output = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filename]);
  return {
    width: Number(output.match(/pixelWidth:\s*(\d+)/)?.[1] || 0),
    height: Number(output.match(/pixelHeight:\s*(\d+)/)?.[1] || 0),
  };
}

async function parallel(items, handler) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await handler(items[next++]);
  }));
}

async function atomicWrite(filename, content) {
  const temporary = `${filename}.r2-optimize-${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filename);
}

const files = await walk(dataRoot);
const documents = new Map();
const assets = new Map();
for (const filename of files) {
  const document = JSON.parse(await readFile(filename, "utf8"));
  documents.set(filename, document);
  visitMedia(document, (_media, original, key) => {
    const width = Number(typeof original === "object" ? original.width : 0);
    const height = Number(typeof original === "object" ? original.height : 0);
    if (!assets.has(key)) assets.set(key, { key, url: `${publicBase}/${key}`, width, height });
    else {
      const asset = assets.get(key);
      asset.width ||= width;
      asset.height ||= height;
    }
  });
}

const allAssets = [...assets.values()];
let sized = 0;
await parallel(allAssets, async (asset) => {
  asset.bytes = await responseSize(asset.url);
  sized += 1;
  if (sized % 100 === 0 || sized === allAssets.length) console.log(`Đã đo: ${sized}/${allAssets.length}`);
});
let candidates = allAssets
  .filter((asset) => asset.bytes >= threshold && (!asset.width || !asset.height || Math.max(asset.width, asset.height) > maxEdge))
  .sort((a, b) => b.bytes - a.bytes);
if (limit) candidates = candidates.slice(0, limit);
const candidateBytes = candidates.reduce((total, asset) => total + asset.bytes, 0);
console.log(`R2: ${allAssets.length} ảnh xem lớn; ${candidates.length} ảnh từ ${(candidateBytes / 1048576).toFixed(1)} MiB cần tối ưu.`);
if (!write) {
  console.log("Chưa thay object nào. Chạy lại với --write để áp dụng.");
  process.exit(0);
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "teresa-r2-optimize-"));
const changed = new Map();
let completed = 0;
let savedBytes = 0;
try {
  await parallel(candidates, async (asset) => {
    const token = asset.key.replace(/[^a-z0-9]+/gi, "-").slice(-100);
    const input = path.join(temporaryRoot, `${token}-in.jpg`);
    const output = path.join(temporaryRoot, `${token}-out.jpg`);
    const response = await fetch(asset.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`GET ${response.status}: ${asset.url}`);
    await writeFile(input, Buffer.from(await response.arrayBuffer()));
    await run("sips", ["-Z", String(maxEdge), "-s", "format", "jpeg", "-s", "formatOptions", String(quality), input, "--out", output]);
    const outputInfo = await stat(output);
    const size = await dimensions(output);
    if (outputInfo.size < asset.bytes * 0.95) {
      await run(wrangler, ["r2", "object", "put", `${bucket}/${asset.key}`, "--file", output, "--content-type", "image/jpeg", "--cache-control", "public, max-age=31536000, immutable", "--remote", "--force"], {
        cwd: workerRoot,
        env: { ...process.env, npm_config_cache: process.env.npm_config_cache || path.join(os.tmpdir(), "teresa-npm-cache") },
      });
      changed.set(asset.key, { ...size, before: asset.bytes, after: outputInfo.size });
      savedBytes += asset.bytes - outputInfo.size;
    }
    await Promise.all([rm(input, { force: true }), rm(output, { force: true })]);
    completed += 1;
    if (completed % 10 === 0 || completed === candidates.length) console.log(`Đã xử lý: ${completed}/${candidates.length}`);
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const changedFiles = [];
for (const [filename, document] of documents) {
  let dirty = false;
  visitMedia(document, (_media, original, key) => {
    const replacement = changed.get(key);
    if (!replacement || typeof original === "string") return;
    original.src = `${String(original.src).split("?")[0]}?v=${replacement.after}`;
    original.width = replacement.width;
    original.height = replacement.height;
    dirty = true;
  });
  if (dirty) {
    await atomicWrite(filename, json(document));
    changedFiles.push(filename);
  }
}

const years = [];
for (const entry of (await readdir(dataRoot, { withFileTypes: true })).filter((item) => item.isFile() && /^\d{4}\.json$/.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
  years.push(JSON.parse(await readFile(path.join(dataRoot, entry.name), "utf8")));
}
await atomicWrite(path.join(dataRoot, "index.json"), json(Schema.buildIndex(years)));
console.log(`Đã tối ưu ${changed.size} ảnh, giảm ${(savedBytes / 1048576).toFixed(1)} MiB; cập nhật ${changedFiles.length} tệp JSON.`);
