import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const require = createRequire(import.meta.url);
const Schema = require("../js/schema.js");

const minimalYear = (overrides = {}) => ({
  year: 2020,
  overview: {
    title: "Nhật ký 2020",
    summary: "Một năm đáng nhớ.",
    longDescription: "Nội dung đầy đủ.",
    coverImage: "images/hero.jpg",
  },
  leadership: {},
  members: { total: 10, new: 2, inactive: 1, notes: "" },
  activities: [{
    title: "Lễ Quan thầy",
    date: "01.10.2020",
    type: "Lễ Quan thầy",
    topic: "Lễ Quan thầy",
    description: "Tóm tắt.",
    body: "Nội dung.",
    images: [],
  }],
  gallery: [],
  achievements: [],
  challenges: [],
  sharing: [],
  ...overrides,
});

test("exports the required browser/Node API", () => {
  [
    "SCHEMA_VERSION", "YEAR_MIN", "maxYear", "ROLE_KEYS", "TOPICS",
    "splitLegacyNames", "normalizeMember", "normalizeLeadership",
    "normalizeMedia", "mediaSource", "normalizeYear", "validateYear", "buildIndex",
  ].forEach((key) => assert.ok(key in Schema, `missing ${key}`));
  assert.equal(Schema.SCHEMA_VERSION, 3);
});

test("maxYear follows the calendar instead of a hard-coded 2026 ceiling", () => {
  assert.equal(Schema.maxYear(new Date("2026-08-23T00:00:00Z")), 2027);
  assert.equal(Schema.maxYear(2031, 2), 2033);
});

test("legacy leadership names become individual members without splitting commas", () => {
  assert.deepEqual(
    Schema.splitLegacyNames("Phêrô Bùi Ngọc Liêm · Giuse Nguyễn Xuân Hoàn; Maria A\nMaria B, OFM"),
    ["Phêrô Bùi Ngọc Liêm", "Giuse Nguyễn Xuân Hoàn", "Maria A", "Maria B, OFM"],
  );
  const leadership = Schema.normalizeLeadership({
    deputyLeader: { name: "Phêrô Bùi Ngọc Liêm · Giuse Nguyễn Xuân Hoàn", photo: "first.jpg" },
    serviceTeams: ["Ban Truyền thông"],
  });
  assert.deepEqual(leadership.deputyLeader.members.map((member) => member.name), ["Phêrô Bùi Ngọc Liêm", "Giuse Nguyễn Xuân Hoàn"]);
  assert.equal(leadership.deputyLeader.members[0].photo, "first.jpg");
  assert.equal(leadership.deputyLeader.members[1].photo, "");
  assert.equal(leadership.teams[0].name, "Ban Truyền thông");
  assert.equal("serviceTeams" in leadership, false);
});

test("legacy activity IDs are deterministic across reordering", () => {
  const first = minimalYear({
    activities: [
      { title: "Sự kiện A", date: "01.01.2020", type: "Gắn kết", description: "A", body: "A", images: [] },
      { title: "Sự kiện B", date: "02.01.2020", type: "Thánh lễ", description: "B", body: "B", images: [] },
    ],
  });
  const original = Schema.normalizeYear(first).activities;
  const reordered = Schema.normalizeYear({ ...first, activities: [...first.activities].reverse() }).activities;
  const ids = new Map(original.map((activity) => [activity.title, activity.id]));
  reordered.forEach((activity) => assert.equal(activity.id, ids.get(activity.title)));
});

test("an existing activity ID is preserved", () => {
  const normalized = Schema.normalizeYear(minimalYear({ activities: [{
    id: "2020-existing-id",
    title: "Sự kiện",
    date: "01.01.2020",
    type: "Gắn kết",
    topic: "Gắn kết",
    description: "Tóm tắt",
    body: "Nội dung",
    images: [],
  }] }));
  assert.equal(normalized.activities[0].id, "2020-existing-id");
});

test("album-backed activities do not retain inline images", () => {
  const normalized = Schema.normalizeYear(minimalYear({ activities: [{
    id: "2020-album",
    title: "Album",
    date: "01.01.2020",
    type: "Gắn kết",
    topic: "Gắn kết",
    description: "Tóm tắt",
    body: "Nội dung",
    images: ["ignored.jpg"],
    album: {
      manifest: "data/albums/2020/2020-album.json",
      count: 100,
      preview: ["thumb.jpg"],
    },
  }] }));
  assert.equal("images" in normalized.activities[0], false);
  assert.equal(normalized.activities[0].album.count, 100);
  assert.equal(Schema.mediaSource(normalized.activities[0].album.preview[0]), "thumb.jpg");
});

test("media variants select the requested source and fall back safely", () => {
  const media = Schema.normalizeMedia({
    src: "original.jpg",
    variants: {
      thumbnail: { src: "thumb.jpg", width: 480 },
      medium: { src: "medium.jpg", width: 1280 },
    },
  });
  assert.equal(Schema.mediaSource(media, "thumbnail"), "thumb.jpg");
  assert.equal(Schema.mediaSource(media, "medium"), "medium.jpg");
  assert.equal(Schema.mediaSource(media, "original"), "original.jpg");
  assert.equal(Schema.mediaSource("legacy.jpg", "thumbnail"), "legacy.jpg");
});

test("validator reports explicit duplicate activity IDs", () => {
  const data = minimalYear({
    schemaVersion: 3,
    activities: [
      { id: "duplicate", title: "A", date: "01.01.2020", type: "Gắn kết", topic: "Gắn kết", description: "A", body: "A", images: [] },
      { id: "duplicate", title: "B", date: "02.01.2020", type: "Gắn kết", topic: "Gắn kết", description: "B", body: "B", images: [] },
    ],
  });
  const result = Schema.validateYear(data, { normalize: false });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.code === "duplicate"));
});

test("validator warns when the same member is entered twice in one role", () => {
  const result = Schema.validateYear(minimalYear({
    leadership: {
      deputyLeader: {
        members: [
          { id: "deputy-1", name: "Maria Nguyễn Thị A" },
          { id: "deputy-2", name: "Maria Nguyễn Thị A" },
        ],
      },
    },
  }), { normalize: false });
  assert.ok(result.warnings.some((entry) => entry.code === "duplicate_member_name"));
});

test("index builder includes only canonical roles and correct totals", () => {
  const data = minimalYear({
    leadership: {
      leader: { name: "Maria A" },
      teams: [{ name: "Ban Truyền thông", members: [{ name: "Maria B" }] }],
      serviceTeams: ["Ban Truyền thông"],
    },
  });
  const index = Schema.buildIndex([data], { generatedAt: "2026-08-23T00:00:00.000Z" });
  assert.deepEqual(index.totals, { years: 1, members: 10, activities: 1 });
  assert.deepEqual(index.years[0].leadership.map((entry) => entry.role), ["leader"]);
  assert.equal(index.years[0].leadership.some((entry) => entry.role === "teams" || entry.role === "serviceTeams"), false);
});

test("album manifest validation checks count and source", () => {
  const valid = Schema.validateAlbumManifest({
    schemaVersion: 1,
    year: 2020,
    activityId: "2020-album",
    title: "Album",
    count: 1,
    images: [Schema.normalizeMedia("photo.jpg")],
  });
  assert.equal(valid.valid, true);
  const invalid = Schema.validateAlbumManifest({ schemaVersion: 1, year: 2020, activityId: "x", title: "x", count: 2, images: [] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((entry) => entry.code === "mismatch"));
});
