#!/usr/bin/env node

import { createRequire } from "node:module";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Schema = require("../js/schema.js");
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const dataDirectory = path.join(projectRoot, "data");
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const jsonOutput = args.has("--json");
const checkMedia = args.has("--check-media");

if (args.has("--help")) {
  console.log(`Usage: node scripts/validate-data.mjs [options]

Options:
  --strict       Treat warnings as failures
  --json         Print a machine-readable report
  --check-media  Verify local image and album-manifest paths
  --help         Show this help`);
  process.exit(0);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    error.message = `${path.relative(projectRoot, file)}: ${error.message}`;
    throw error;
  }
}

async function filesRecursively(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(target) : [target];
  }));
  return nested.flat();
}

function legacyIdMap(indexYear) {
  const result = {};
  (indexYear?.events || []).forEach((event, index) => {
    const signature = Schema.activitySignature(event);
    if (event.id) {
      result[`${signature}#${index}`] = event.id;
      if (!result[signature]) result[signature] = event.id;
    }
  });
  return result;
}

function addIssues(report, file, result) {
  result.errors.forEach((entry) => report.errors.push({ file, ...entry }));
  result.warnings.forEach((entry) => report.warnings.push({ file, ...entry }));
}

function localMediaPaths(year) {
  const sources = [];
  const add = (media) => {
    const source = Schema.mediaSource(media, "original");
    if (source && !/^(?:https?:|data:|blob:|\/\/)/i.test(source)) sources.push(source.replace(/^\//, ""));
  };
  add(year.overview?.coverImage);
  year.activities.forEach((activity) => {
    add(activity.coverImage);
    (activity.images || []).forEach(add);
    (activity.album?.preview || []).forEach(add);
  });
  year.gallery.forEach(add);
  (year.galleryAlbum?.preview || []).forEach(add);
  Schema.ROLE_KEYS.forEach((key) => (year.leadership[key]?.members || []).forEach((member) => add(member.photo)));
  (year.leadership.teams || []).forEach((team) => team.members.forEach((member) => add(member.photo)));
  return [...new Set(sources)];
}

const report = {
  schemaVersion: Schema.SCHEMA_VERSION,
  checkedAt: new Date().toISOString(),
  files: [],
  totals: { years: 0, activities: 0, albums: 0 },
  errors: [],
  warnings: [],
};

let indexData = null;
try {
  indexData = await readJson(path.join(dataDirectory, "index.json"));
  addIssues(report, "data/index.json", Schema.validateIndex(indexData));
} catch (error) {
  report.errors.push({ file: "data/index.json", path: "$", code: "read_failed", message: error.message });
}

const entries = await readdir(dataDirectory, { withFileTypes: true });
const yearFiles = entries
  .filter((entry) => entry.isFile() && /^\d{4}\.json$/.test(entry.name))
  .map((entry) => path.join(dataDirectory, entry.name))
  .sort();
const normalizedYears = [];

for (const file of yearFiles) {
  const relative = path.relative(projectRoot, file);
  try {
    const raw = await readJson(file);
    const indexYear = indexData?.years?.find((item) => Number(item.year) === Number(raw.year));
    const result = Schema.validateYear(raw, { legacyIdMap: legacyIdMap(indexYear) });
    addIssues(report, relative, result);
    normalizedYears.push(result.value);
    report.files.push(relative);
    report.totals.years += 1;
    report.totals.activities += result.value.activities.length;

    if (checkMedia) {
      for (const source of localMediaPaths(result.value)) {
        try { await access(path.resolve(projectRoot, source)); }
        catch { report.warnings.push({ file: relative, path: source, code: "missing_local_media", message: `Không tìm thấy ảnh cục bộ: ${source}` }); }
      }
      const manifests = [
        ...result.value.activities.map((activity) => activity.album?.manifest).filter(Boolean),
        result.value.galleryAlbum?.manifest,
      ].filter(Boolean);
      for (const manifest of manifests) {
        try { await access(path.resolve(projectRoot, manifest)); }
        catch { report.errors.push({ file: relative, path: manifest, code: "missing_manifest", message: `Không tìm thấy album manifest: ${manifest}` }); }
      }
    }
  } catch (error) {
    report.errors.push({ file: relative, path: "$", code: "read_failed", message: error.message });
  }
}

const albumFiles = (await filesRecursively(path.join(dataDirectory, "albums"))).filter((file) => file.endsWith(".json")).sort();
for (const file of albumFiles) {
  const relative = path.relative(projectRoot, file);
  try {
    const manifest = await readJson(file);
    addIssues(report, relative, Schema.validateAlbumManifest(manifest));
    report.files.push(relative);
    report.totals.albums += 1;
    if (checkMedia) {
      for (const image of manifest.images || []) {
        const source = Schema.mediaSource(image, "original");
        if (!source || /^(?:https?:|data:|blob:|\/\/)/i.test(source)) continue;
        try { await access(path.resolve(projectRoot, source.replace(/^\//, ""))); }
        catch { report.warnings.push({ file: relative, path: source, code: "missing_local_media", message: `Không tìm thấy ảnh cục bộ: ${source}` }); }
      }
    }
  } catch (error) {
    report.errors.push({ file: relative, path: "$", code: "read_failed", message: error.message });
  }
}

if (indexData && normalizedYears.length) {
  const built = Schema.buildIndex(normalizedYears, { generatedAt: indexData.generatedAt || report.checkedAt });
  if (Number(indexData.totals?.years) !== built.totals.years) report.errors.push({ file: "data/index.json", path: "totals.years", code: "source_mismatch", message: `Index ghi ${indexData.totals?.years}; dữ liệu nguồn có ${built.totals.years} năm.` });
  if (Number(indexData.totals?.members) !== built.totals.members) report.errors.push({ file: "data/index.json", path: "totals.members", code: "source_mismatch", message: `Index ghi ${indexData.totals?.members}; dữ liệu nguồn có ${built.totals.members} thành viên.` });
  if (Number(indexData.totals?.activities) !== built.totals.activities) report.errors.push({ file: "data/index.json", path: "totals.activities", code: "source_mismatch", message: `Index ghi ${indexData.totals?.activities}; dữ liệu nguồn có ${built.totals.activities} hoạt động.` });
  if (indexData.schemaVersion === Schema.SCHEMA_VERSION) {
    const byYear = new Map(indexData.years.map((year) => [Number(year.year), year]));
    built.years.forEach((year) => {
      const indexed = byYear.get(year.year);
      if (!indexed) report.errors.push({ file: "data/index.json", path: "years", code: "missing_year", message: `Index thiếu năm ${year.year}.` });
      else if ((indexed.events || []).length !== year.events.length) report.errors.push({ file: "data/index.json", path: `years.${year.year}.events`, code: "source_mismatch", message: `Số hoạt động năm ${year.year} không khớp dữ liệu nguồn.` });
    });
  }
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Teresa schema v${Schema.SCHEMA_VERSION}: ${report.totals.years} năm, ${report.totals.activities} hoạt động, ${report.totals.albums} album manifest.`);
  report.errors.forEach((entry) => console.error(`ERROR ${entry.file} ${entry.path}: ${entry.message}`));
  report.warnings.forEach((entry) => console.warn(`WARN  ${entry.file} ${entry.path}: ${entry.message}`));
  console.log(`${report.errors.length} lỗi · ${report.warnings.length} cảnh báo.`);
}

process.exitCode = report.errors.length || (strict && report.warnings.length) ? 1 : 0;
