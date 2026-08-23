#!/usr/bin/env node

/**
 * Tạo ba biến thể JPEG nhẹ cho ảnh cục bộ đang được dữ liệu JSON tham chiếu.
 * Ảnh gốc vẫn được giữ nguyên như bản lưu trữ; website ưu tiên bản 480/1280/2048.
 * Mặc định là dry-run. Dùng --write để tạo ảnh và cập nhật JSON.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Schema = require("../js/schema.js");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(projectRoot, "data");
const write = process.argv.includes("--write");
const localImage = /^images\/.+\.(?:jpe?g)$/i;
const mediaKeys = new Set(["coverImage", "photo"]);
const cache = new Map();
const generated = new Set();

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const posix = (value) => value.split(path.sep).join("/");

function imageInfo(relativePath) {
  const result = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path.join(projectRoot, relativePath)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Không đọc được ${relativePath}`);
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1] || 0);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1] || 0);
  if (!width || !height) throw new Error(`Không xác định được kích thước ${relativePath}`);
  return { width, height };
}

function scaledSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function exists(target) {
  try { await stat(target); return true; }
  catch { return false; }
}

async function variant(relativePath, width, height, maxEdge, label, quality) {
  if (Math.max(width, height) <= maxEdge) return { src: relativePath, width, height };
  const parsed = path.parse(relativePath);
  const outputRelative = posix(path.join("images", "optimized", path.relative("images", parsed.dir), `${parsed.name}-${label}.jpg`));
  const output = path.join(projectRoot, outputRelative);
  const size = scaledSize(width, height, maxEdge);
  generated.add(outputRelative);
  if (write && !(await exists(output))) {
    await mkdir(path.dirname(output), { recursive: true });
    const result = spawnSync("sips", ["-Z", String(maxEdge), "-s", "format", "jpeg", "-s", "formatOptions", String(quality), path.join(projectRoot, relativePath), "--out", output], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `Không tối ưu được ${relativePath}`);
  }
  return { src: outputRelative, ...size };
}

async function optimizedMedia(value) {
  const normalized = Schema.normalizeMedia(value);
  const originalSource = Schema.mediaSource(normalized, "original") || normalized.src;
  if (!localImage.test(originalSource)) return value;
  if (cache.has(originalSource)) {
    const variants = await cache.get(originalSource);
    return { ...normalized, variants };
  }
  const task = (async () => {
    const { width, height } = imageInfo(originalSource);
    return {
      thumbnail: await variant(originalSource, width, height, 480, "480", 74),
      medium: await variant(originalSource, width, height, 1280, "1280", 80),
      original: await variant(originalSource, width, height, 2048, "2048", 84),
    };
  })();
  cache.set(originalSource, task);
  return { ...normalized, variants: await task };
}

async function visit(value, parentKey = "") {
  if (typeof value === "string") return mediaKeys.has(parentKey) && localImage.test(value) ? optimizedMedia(value) : value;
  if (Array.isArray(value)) return Promise.all(value.map((item) => visit(item, parentKey)));
  if (!value || typeof value !== "object") return value;
  if (typeof value.src === "string" && localImage.test(value.src)) return optimizedMedia(value);
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = await visit(child, key);
  return result;
}

async function atomicWrite(target, content) {
  const temporary = `${target}.optimized-${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

const entries = (await readdir(dataDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name))
  .map((entry) => path.join(dataDirectory, entry.name))
  .sort();
const years = [];
for (const target of entries) {
  const optimized = await visit(JSON.parse(await readFile(target, "utf8")));
  years.push(optimized);
  if (write) await atomicWrite(target, json(optimized));
}

const albumsRoot = path.join(dataDirectory, "albums");
for (const yearEntry of await readdir(albumsRoot, { withFileTypes: true })) {
  if (!yearEntry.isDirectory()) continue;
  const directory = path.join(albumsRoot, yearEntry.name);
  for (const albumEntry of await readdir(directory, { withFileTypes: true })) {
    if (!albumEntry.isFile() || !albumEntry.name.endsWith(".json")) continue;
    const target = path.join(directory, albumEntry.name);
    const optimized = await visit(JSON.parse(await readFile(target, "utf8")));
    if (write) await atomicWrite(target, json(optimized));
  }
}

if (write) await atomicWrite(path.join(dataDirectory, "index.json"), json(Schema.buildIndex(years)));
console.log(`${write ? "Đã tạo" : "Sẽ tạo"} ${generated.size} biến thể từ ${cache.size} ảnh cục bộ.`);
if (!write) console.log("Không có tệp nào được ghi. Chạy lại với --write để áp dụng.");
