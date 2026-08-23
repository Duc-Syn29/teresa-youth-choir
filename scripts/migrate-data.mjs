#!/usr/bin/env node

import { createRequire } from "node:module";
import { access, copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Schema = require("../js/schema.js");
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const dataDirectory = path.join(projectRoot, "data");

function parseArguments(argv) {
  const options = { write: false, years: new Set(), preview: 3, backupDirectory: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--help") options.help = true;
    else if (argument === "--year") options.years.add(Number(argv[++index]));
    else if (argument.startsWith("--year=")) options.years.add(Number(argument.split("=")[1]));
    else if (argument === "--preview") options.preview = Number(argv[++index]);
    else if (argument.startsWith("--preview=")) options.preview = Number(argument.split("=")[1]);
    else if (argument === "--backup-dir") options.backupDirectory = argv[++index];
    else if (argument.startsWith("--backup-dir=")) options.backupDirectory = argument.slice("--backup-dir=".length);
    else throw new Error(`Tùy chọn không hỗ trợ: ${argument}`);
  }
  options.preview = Number.isInteger(options.preview) && options.preview >= 0 ? options.preview : 3;
  for (const year of options.years) if (!Number.isInteger(year)) throw new Error("--year cần một năm hợp lệ.");
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(`Usage: node scripts/migrate-data.mjs [options]

Mặc định chỉ phân tích và in kế hoạch; không ghi bất kỳ tệp nào.

Options:
  --write               Ghi migration sau khi toàn bộ kiểm tra đạt
  --year 2020           Chỉ migrate một năm (có thể lặp lại)
  --preview 3            Số ảnh preview giữ trong year JSON
  --backup-dir PATH      Nơi lưu backup trước khi ghi
  --help                 Hiện hướng dẫn`);
  process.exit(0);
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const relative = (target) => path.relative(projectRoot, target).split(path.sep).join("/");
const exists = async (target) => { try { await access(target); return true; } catch { return false; } };

async function readJson(target) {
  try { return JSON.parse(await readFile(target, "utf8")); }
  catch (error) { error.message = `${relative(target)}: ${error.message}`; throw error; }
}

function legacyIdMap(indexYear) {
  const result = {};
  (indexYear?.events || []).forEach((event, index) => {
    const signature = Schema.activitySignature(event);
    if (!event.id) return;
    result[`${signature}#${index}`] = event.id;
    if (!result[signature]) result[signature] = event.id;
  });
  return result;
}

function uniqueMedia(media) {
  const seen = new Set();
  return media.filter((item) => {
    const source = Schema.mediaSource(item, "original");
    if (!source || seen.has(source)) return false;
    seen.add(source);
    return true;
  });
}

function albumManifest(year, activityId, title, images) {
  return {
    schemaVersion: 1,
    year,
    activityId,
    title,
    count: images.length,
    images,
  };
}

function safeFilename(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "album";
}

async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.migration-${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

const entries = await readdir(dataDirectory, { withFileTypes: true });
const yearFiles = entries
  .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name))
  .map((entry) => path.join(dataDirectory, entry.name))
  .sort();
const indexPath = path.join(dataDirectory, "index.json");
const currentIndex = await readJson(indexPath);
const indexByYear = new Map((currentIndex.years || []).map((year) => [Number(year.year), year]));
const plannedWrites = new Map();
const normalizedYears = [];
const summaries = [];
const selectedYears = options.years.size
  ? options.years
  : new Set(yearFiles.map((file) => Number(path.basename(file, ".json"))));

for (const year of selectedYears) {
  if (!yearFiles.some((file) => Number(path.basename(file, ".json")) === year)) throw new Error(`Không tìm thấy data/${year}.json.`);
}

for (const file of yearFiles) {
  const raw = await readJson(file);
  const year = Number(raw.year);
  const normalized = Schema.normalizeYear(raw, { legacyIdMap: legacyIdMap(indexByYear.get(year)) });
  let albumCount = 0;
  let imageCount = 0;

  if (selectedYears.has(year)) {
    normalized.activities = normalized.activities.map((activity) => {
      if (activity.album?.manifest) return activity;
      const images = uniqueMedia(activity.images || []);
      if (!images.length) return activity;
      const manifestRelative = `data/albums/${year}/${safeFilename(activity.id)}.json`;
      const manifest = albumManifest(year, activity.id, activity.title, images);
      plannedWrites.set(path.join(projectRoot, manifestRelative), json(manifest));
      albumCount += 1;
      imageCount += images.length;
      const migrated = {
        ...activity,
        album: {
          manifest: manifestRelative,
          count: images.length,
          preview: images.slice(0, options.preview),
        },
      };
      if (!migrated.coverImage && images[0]) migrated.coverImage = Schema.mediaSource(images[0], "medium");
      delete migrated.images;
      return migrated;
    });

    const galleryImages = uniqueMedia(normalized.gallery || []);
    if (galleryImages.length) {
      const galleryId = `${year}-year-gallery`;
      const manifestRelative = `data/albums/${year}/_gallery.json`;
      plannedWrites.set(path.join(projectRoot, manifestRelative), json(albumManifest(year, galleryId, `Album năm ${year}`, galleryImages)));
      normalized.galleryAlbum = {
        manifest: manifestRelative,
        count: galleryImages.length,
        preview: galleryImages.slice(0, options.preview),
      };
      normalized.gallery = galleryImages.slice(0, options.preview);
      albumCount += 1;
      imageCount += galleryImages.length;
    }

    normalized.meta = {
      ...normalized.meta,
      revision: Math.max(1, Number(normalized.meta?.revision || 0)),
      status: normalized.meta?.status || "published",
      migratedFrom: Number(raw.schemaVersion || 1),
    };
    plannedWrites.set(file, json(normalized));
  }

  const validation = Schema.validateYear(normalized, { normalize: false });
  if (!validation.valid) {
    const details = validation.errors.map((entry) => `${entry.path}: ${entry.message}`).join("\n  ");
    throw new Error(`Migration năm ${year} không hợp lệ:\n  ${details}`);
  }
  normalizedYears.push(normalized);
  if (selectedYears.has(year)) summaries.push({ year, activities: normalized.activities.length, albums: albumCount, images: imageCount });
}

for (const [target, content] of plannedWrites) {
  if (!target.includes(`${path.sep}albums${path.sep}`)) continue;
  const validation = Schema.validateAlbumManifest(JSON.parse(content));
  if (!validation.valid) {
    const details = validation.errors.map((entry) => `${entry.path}: ${entry.message}`).join("\n  ");
    throw new Error(`Album ${relative(target)} không hợp lệ:\n  ${details}`);
  }
}

const nextIndex = Schema.buildIndex(normalizedYears);
const indexValidation = Schema.validateIndex(nextIndex, { expectedYears: normalizedYears.length });
if (!indexValidation.valid) throw new Error(`Index mới không hợp lệ: ${indexValidation.errors.map((entry) => entry.message).join(" ")}`);
plannedWrites.set(indexPath, json(nextIndex));

console.log(`Teresa schema v${Schema.SCHEMA_VERSION} migration — ${options.write ? "WRITE" : "DRY RUN"}`);
summaries.forEach((summary) => console.log(`${summary.year}: ${summary.activities} hoạt động · ${summary.albums} manifest · ${summary.images} ảnh`));
console.log(`${plannedWrites.size} tệp sẽ được ${options.write ? "ghi" : "thay đổi"}.`);
for (const target of plannedWrites.keys()) console.log(`  ${relative(target)}`);

if (!options.write) {
  console.log("Không có tệp nào được ghi. Chạy lại với --write sau khi đã xem kế hoạch.");
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = options.backupDirectory
  ? path.resolve(projectRoot, options.backupDirectory)
  : path.join(projectRoot, ".migration-backups", `schema-v${Schema.SCHEMA_VERSION}-${timestamp}`);
await mkdir(backupRoot, { recursive: true });

for (const target of plannedWrites.keys()) {
  if (!(await exists(target))) continue;
  const backup = path.join(backupRoot, relative(target));
  await mkdir(path.dirname(backup), { recursive: true });
  await copyFile(target, backup);
}
await writeFile(path.join(backupRoot, "migration-plan.json"), json({
  schemaVersion: Schema.SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  selectedYears: [...selectedYears].sort(),
  files: [...plannedWrites.keys()].map(relative),
}), "utf8");

for (const [target, content] of plannedWrites) await atomicWrite(target, content);
console.log(`Đã migration thành công. Backup: ${relative(backupRoot)}`);
