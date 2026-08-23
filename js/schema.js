/* Teresa archive schema v3.
 *
 * This file deliberately has no runtime dependencies. It can be loaded with a
 * regular <script> tag (window.TeresaSchema) and required from Node scripts.
 */
(function universalSchema(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TeresaSchema = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSchema() {
  "use strict";

  const SCHEMA_VERSION = 3;
  const YEAR_MIN = 2015;
  const ROLE_KEYS = Object.freeze(["chaplain", "leader", "deputyLeader", "conductor", "treasurer"]);
  const ROLE_LABELS = Object.freeze({
    chaplain: "Cha đặc trách",
    leader: "Trưởng ca đoàn",
    deputyLeader: "Phó ca đoàn",
    conductor: "Ca trưởng",
    treasurer: "Thủ quỹ",
  });
  const TOPICS = Object.freeze([
    "Phụng vụ",
    "Thánh lễ",
    "Lễ Quan thầy",
    "Đại lễ",
    "Thành lập",
    "Đại hội",
    "Phục Sinh",
    "Giáng Sinh",
    "Cầu nguyện",
    "Thánh nhạc",
    "Thiện nguyện",
    "Tĩnh tâm",
    "Tâm linh",
    "Gắn kết",
    "Sinh hoạt",
    "Giao lưu",
    "Du lịch/Team Building",
    "Hội thao",
    "Hội thảo",
    "Học hỏi",
    "Hòa nhạc",
    "Hát lễ cưới",
    "Hôn phối",
    "Cộng đoàn",
    "Khác",
  ]);

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const string = (value, fallback = "") => value === undefined || value === null ? fallback : String(value).trim();
  const integer = (value, fallback = 0) => {
    const result = Number(value);
    return Number.isFinite(result) ? Math.trunc(result) : fallback;
  };
  const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

  function maxYear(reference = new Date(), futureYears = 1) {
    let year;
    if (reference instanceof Date) year = reference.getFullYear();
    else if (typeof reference === "number" && reference >= 1000) year = Math.trunc(reference);
    else year = new Date(reference).getFullYear();
    if (!Number.isInteger(year)) year = new Date().getFullYear();
    return year + Math.max(0, integer(futureYears, 1));
  }

  function slug(value, fallback = "item") {
    const result = string(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56);
    return result || fallback;
  }

  function stableHash(value) {
    const input = String(value || "");
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).padStart(7, "0");
  }

  function stableId(prefix, ...parts) {
    const readable = slug(parts.find((part) => string(part)) || prefix, "item");
    return `${slug(prefix, "item")}-${readable}-${stableHash(parts.join("\u241f"))}`;
  }

  function splitLegacyNames(value) {
    if (Array.isArray(value)) return value.flatMap(splitLegacyNames);
    return string(value)
      .split(/(?:\r?\n|\s*[·•;]\s*)/g)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function normalizeMember(member, options = {}) {
    const source = typeof member === "string" ? { name: member } : (member && typeof member === "object" ? copy(member) : {});
    const name = string(source.name);
    const normalized = {
      ...source,
      id: string(source.id) || stableId(options.prefix || "member", options.scope || "", name, options.index ?? 0),
      name,
    };
    if (source.photo !== undefined) normalized.photo = copy(source.photo);
    else normalized.photo = "";
    if (source.note !== undefined) normalized.note = string(source.note);
    return normalized;
  }

  function normalizeRole(entry, key) {
    const source = Array.isArray(entry)
      ? { members: entry }
      : typeof entry === "string"
        ? { name: entry }
        : (entry && typeof entry === "object" ? copy(entry) : {});
    let rawMembers = Array.isArray(source.members) ? source.members : [];
    if (!rawMembers.length && source.name) {
      rawMembers = splitLegacyNames(source.name).map((name, index) => ({
        name,
        photo: index === 0 ? copy(source.photo || "") : "",
      }));
    }
    const normalized = { ...source };
    delete normalized.name;
    delete normalized.photo;
    normalized.members = rawMembers
      .map((member, index) => normalizeMember(member, { prefix: "person", scope: key, index }))
      .filter((member) => member.name);
    if (source.note !== undefined) normalized.note = string(source.note);
    return normalized;
  }

  function normalizeLeadership(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? copy(value) : {};
    const result = {};

    Object.keys(source).forEach((key) => {
      if (![...ROLE_KEYS, "teams", "serviceTeams", "deputyConductor", "secretary"].includes(key)) result[key] = source[key];
    });
    ROLE_KEYS.forEach((key) => { result[key] = normalizeRole(source[key], key); });

    const teamSource = Array.isArray(source.teams) && source.teams.length
      ? source.teams
      : (Array.isArray(source.serviceTeams) ? source.serviceTeams : []);
    result.teams = teamSource.map((team, teamIndex) => {
      const current = typeof team === "string" ? { name: team, members: [] } : (team && typeof team === "object" ? copy(team) : {});
      const name = string(current.name, `Ban phục vụ ${teamIndex + 1}`);
      return {
        ...current,
        id: string(current.id) || stableId("team", name, teamIndex),
        name,
        members: (Array.isArray(current.members) ? current.members : [])
          .map((member, memberIndex) => normalizeMember(member, { prefix: "team-member", scope: name, index: memberIndex }))
          .filter((member) => member.name),
      };
    }).filter((team) => team.name);
    return result;
  }

  function normalizeVariant(value) {
    if (!value) return null;
    if (typeof value === "string") return { src: string(value) };
    if (typeof value !== "object") return null;
    const src = string(value.src || value.url || value.path);
    if (!src) return null;
    const result = { ...copy(value), src };
    delete result.url;
    delete result.path;
    if (value.width !== undefined) result.width = Math.max(0, integer(value.width));
    if (value.height !== undefined) result.height = Math.max(0, integer(value.height));
    return result;
  }

  function normalizeMedia(value, defaults = {}) {
    const source = typeof value === "string"
      ? { src: value }
      : (value && typeof value === "object" ? copy(value) : {});
    const incomingVariants = source.variants && typeof source.variants === "object" ? source.variants : {};
    const thumbnail = normalizeVariant(incomingVariants.thumbnail || incomingVariants.thumb || source.thumbnail || source.thumb);
    const medium = normalizeVariant(incomingVariants.medium || source.medium);
    const original = normalizeVariant(incomingVariants.original || source.original);
    const src = string(source.src || source.url || source.path || medium?.src || original?.src || thumbnail?.src || defaults.src);
    const variants = {};
    if (thumbnail) variants.thumbnail = thumbnail;
    if (medium) variants.medium = medium;
    if (original) variants.original = original;
    const result = {
      ...source,
      id: string(source.id || defaults.id || src),
      src,
      alt: string(source.alt, string(defaults.alt)),
      caption: string(source.caption, string(defaults.caption)),
      variants,
    };
    delete result.url;
    delete result.path;
    delete result.thumbnail;
    delete result.thumb;
    delete result.medium;
    delete result.original;
    if (source.width !== undefined) result.width = Math.max(0, integer(source.width));
    if (source.height !== undefined) result.height = Math.max(0, integer(source.height));
    return result;
  }

  function mediaSource(media, variant = "medium") {
    if (!media) return "";
    if (typeof media === "string") return string(media);
    const variants = media.variants && typeof media.variants === "object" ? media.variants : {};
    const aliases = { thumb: "thumbnail", thumbnail: "thumbnail", medium: "medium", original: "original" };
    const preferred = aliases[variant] || variant;
    if (preferred === "original") {
      const original = variants.original || media.original;
      const explicit = typeof original === "string" ? string(original) : string(original?.src || original?.url || original?.path);
      if (explicit) return explicit;
      const base = string(media.src || media.url || media.path);
      if (base) return base;
    }
    const order = preferred === "thumbnail"
      ? ["thumbnail", "medium", "original"]
      : preferred === "original"
        ? ["original", "medium", "thumbnail"]
        : [preferred, "medium", "original", "thumbnail"];
    for (const key of [...new Set(order)]) {
      const candidate = variants[key] || (key === "thumbnail" ? variants.thumb : null) || media[key];
      const src = typeof candidate === "string" ? string(candidate) : string(candidate?.src || candidate?.url || candidate?.path);
      if (src) return src;
    }
    return string(media.src || media.url || media.path);
  }

  function expandLegacyImages(images, defaults = {}) {
    if (Array.isArray(images)) return images;
    if (!images || typeof images !== "object" || !images.base || integer(images.count) <= 0) return [];
    const base = string(images.base).replace(/\/+$/, "");
    const count = integer(images.count);
    const start = integer(images.start, 1);
    const padding = Math.max(1, integer(images.padding, 3));
    const extension = string(images.extension, "jpg").replace(/^\./, "");
    return Array.from({ length: count }, (_, index) => ({
      src: `${base}/${String(start + index).padStart(padding, "0")}.${extension}`,
      alt: defaults.alt || "",
      caption: defaults.caption || "",
    }));
  }

  function activitySignature(activity = {}) {
    return [string(activity.title).toLocaleLowerCase("vi"), string(activity.date).toLocaleLowerCase("vi"), string(activity.type).toLocaleLowerCase("vi")].join("\u241f");
  }

  function stableActivityId(year, activity = {}) {
    const signature = activitySignature(activity);
    return `${integer(year)}-${slug(activity.title || activity.type || "activity", "activity")}-${stableHash(signature)}`;
  }

  function legacyMappedId(activity, index, options) {
    const map = options.legacyIdMap;
    if (!map) return "";
    const signature = activitySignature(activity);
    if (map instanceof Map) return string(map.get(`${signature}#${index}`) || map.get(signature));
    return string(map[`${signature}#${index}`] || map[signature]);
  }

  function normalizeActivity(activity, year, index, options, usedIds) {
    const source = activity && typeof activity === "object" ? copy(activity) : {};
    let id = string(source.id) || legacyMappedId(source, index, options) || stableActivityId(year, source);
    if (usedIds.has(id)) id = `${id}-${stableHash(`${activitySignature(source)}\u241f${index}`)}`;
    usedIds.add(id);

    const result = {
      ...source,
      id,
      type: string(source.type, "Khác"),
      topic: string(source.topic, string(source.type, "Khác")),
      date: string(source.date),
      title: string(source.title),
      description: string(source.description),
      body: string(source.body, string(source.description)),
    };

    if (source.coverImage !== undefined && source.coverImage !== null && source.coverImage !== "") result.coverImage = copy(source.coverImage);
    else delete result.coverImage;

    const hasManifest = Boolean(string(source.album?.manifest));
    if (hasManifest) {
      result.album = {
        ...copy(source.album),
        manifest: string(source.album.manifest),
        count: Math.max(0, integer(source.album.count)),
        preview: (Array.isArray(source.album.preview) ? source.album.preview : [])
          .map((media) => normalizeMedia(media, { alt: `Ảnh tư liệu: ${result.title}` }))
          .filter((media) => mediaSource(media)),
      };
      delete result.images;
    } else {
      result.images = expandLegacyImages(source.images, {
        alt: `Ảnh tư liệu: ${result.title || result.type || year}`,
        caption: result.title || result.type || `Năm ${year}`,
      }).map((media) => normalizeMedia(media, {
        alt: `Ảnh tư liệu: ${result.title || result.type || year}`,
        caption: result.title || result.type || `Năm ${year}`,
      })).filter((media) => mediaSource(media));
      delete result.album;
    }
    return result;
  }

  function normalizeYear(value, options = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? copy(value) : {};
    const year = integer(source.year);
    const usedIds = new Set();
    const overviewSource = source.overview && typeof source.overview === "object" ? source.overview : {};
    const memberSource = source.members && typeof source.members === "object" ? source.members : {};
    const result = {
      ...source,
      schemaVersion: SCHEMA_VERSION,
      year,
      meta: {
        ...(source.meta && typeof source.meta === "object" ? source.meta : {}),
        revision: Math.max(0, integer(source.meta?.revision)),
        status: ["draft", "published", "archived"].includes(source.meta?.status) ? source.meta.status : "published",
      },
      overview: {
        ...overviewSource,
        eyebrow: string(overviewSource.eyebrow),
        title: string(overviewSource.title, year ? `Năm ${year}` : ""),
        summary: string(overviewSource.summary),
        longDescription: string(overviewSource.longDescription, string(overviewSource.summary)),
        coverImage: copy(overviewSource.coverImage || ""),
      },
      leadership: normalizeLeadership(source.leadership),
      members: {
        ...memberSource,
        total: Math.max(0, integer(memberSource.total)),
        new: Math.max(0, integer(memberSource.new)),
        inactive: Math.max(0, integer(memberSource.inactive)),
        notes: string(memberSource.notes),
      },
      activities: (Array.isArray(source.activities) ? source.activities : [])
        .map((activity, index) => normalizeActivity(activity, year, index, options, usedIds)),
      achievements: Array.isArray(source.achievements) ? copy(source.achievements) : [],
      challenges: Array.isArray(source.challenges) ? copy(source.challenges) : [],
      sharing: Array.isArray(source.sharing) ? copy(source.sharing) : [],
      gallery: (Array.isArray(source.gallery) ? source.gallery : [])
        .map((media) => normalizeMedia(media))
        .filter((media) => mediaSource(media)),
    };
    if (source.galleryAlbum?.manifest) {
      result.galleryAlbum = {
        ...copy(source.galleryAlbum),
        manifest: string(source.galleryAlbum.manifest),
        count: Math.max(0, integer(source.galleryAlbum.count)),
        preview: (Array.isArray(source.galleryAlbum.preview) ? source.galleryAlbum.preview : [])
          .map((media) => normalizeMedia(media))
          .filter((media) => mediaSource(media)),
      };
    }
    return result;
  }

  function issue(path, code, message) { return { path, code, message }; }
  function validateMedia(media, path, errors) {
    if (!mediaSource(media)) errors.push(issue(path, "media_source_required", "Ảnh cần có đường dẫn src hoặc một biến thể hợp lệ."));
    if (media && typeof media === "object") {
      ["width", "height"].forEach((key) => {
        if (media[key] !== undefined && (!Number.isInteger(media[key]) || media[key] < 0)) errors.push(issue(`${path}.${key}`, "invalid_dimension", `${key} phải là số nguyên không âm.`));
      });
    }
  }

  function validateYear(value, options = {}) {
    const errors = [];
    const warnings = [];
    const raw = value;
    const normalized = options.normalize === false ? copy(value) : normalizeYear(value, options);
    const upperYear = options.maxYear ?? maxYear(options.referenceDate, options.futureYears ?? 1);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) errors.push(issue("$", "object_required", "Dữ liệu năm phải là một object JSON."));
    if (raw?.schemaVersion !== SCHEMA_VERSION) warnings.push(issue("schemaVersion", "migration_required", `Dữ liệu sẽ được chuẩn hóa lên schemaVersion ${SCHEMA_VERSION}.`));
    if (options.normalize !== false && Array.isArray(raw?.activities)) {
      const explicitIds = new Set();
      raw.activities.forEach((activity, index) => {
        const id = string(activity?.id);
        if (!id) return;
        if (explicitIds.has(id)) errors.push(issue(`activities[${index}].id`, "duplicate", `ID hoạt động bị trùng: ${id}.`));
        explicitIds.add(id);
        if (activity?.album?.manifest && own(activity, "images")) errors.push(issue(`activities[${index}].images`, "manifest_conflict", "Không lưu images trực tiếp khi hoạt động đã có album manifest."));
      });
    }
    ["total", "new", "inactive"].forEach((key) => {
      if (raw?.members?.[key] !== undefined && (!Number.isInteger(Number(raw.members[key])) || Number(raw.members[key]) < 0)) errors.push(issue(`members.${key}`, "non_negative_integer", `${key} phải là số nguyên không âm.`));
    });
    if (!Number.isInteger(normalized?.year) || normalized.year < YEAR_MIN || normalized.year > upperYear) errors.push(issue("year", "invalid_year", `Năm phải nằm trong khoảng ${YEAR_MIN}–${upperYear}.`));
    if (!normalized?.overview?.title) errors.push(issue("overview.title", "required", "Thiếu tiêu đề năm."));
    if (!normalized?.overview?.summary) warnings.push(issue("overview.summary", "recommended", "Nên có phần tóm tắt năm."));
    if (!Array.isArray(normalized?.activities)) errors.push(issue("activities", "array_required", "activities phải là một mảng."));

    const activityIds = new Set();
    (normalized?.activities || []).forEach((activity, index) => {
      const path = `activities[${index}]`;
      if (!activity.id) errors.push(issue(`${path}.id`, "required", "Hoạt động cần có ID ổn định."));
      else if (activityIds.has(activity.id)) errors.push(issue(`${path}.id`, "duplicate", `ID hoạt động bị trùng: ${activity.id}.`));
      else activityIds.add(activity.id);
      ["title", "date", "type", "description", "body"].forEach((key) => {
        if (!string(activity[key])) errors.push(issue(`${path}.${key}`, "required", `Thiếu ${key} của hoạt động.`));
      });
      if (!TOPICS.includes(activity.topic)) warnings.push(issue(`${path}.topic`, "legacy_topic", `Chủ đề “${activity.topic}” chưa nằm trong danh mục chuẩn; vẫn được giữ nguyên.`));
      if (activity.album?.manifest) {
        if (own(activity, "images")) errors.push(issue(`${path}.images`, "manifest_conflict", "Không lưu images trực tiếp khi hoạt động đã có album manifest."));
        if (!Number.isInteger(activity.album.count) || activity.album.count < 0) errors.push(issue(`${path}.album.count`, "invalid_count", "Số ảnh album phải là số nguyên không âm."));
        (activity.album.preview || []).forEach((media, mediaIndex) => validateMedia(media, `${path}.album.preview[${mediaIndex}]`, errors));
      } else if (!Array.isArray(activity.images)) errors.push(issue(`${path}.images`, "array_required", "images phải là mảng khi chưa có album manifest."));
      else activity.images.forEach((media, mediaIndex) => validateMedia(media, `${path}.images[${mediaIndex}]`, errors));
      if (activity.coverImage) validateMedia(activity.coverImage, `${path}.coverImage`, errors);
    });

    const memberIds = new Set();
    const memberNames = new Map();
    const registerMember = (member, path, roleLabel, groupKey) => {
      if (!member?.name) return;
      const canonicalName = string(member.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/\s+/g, " ").toLowerCase();
      if (/^dang cap nhat(?: tu lieu)?$/.test(canonicalName)) return;
      const key = `${groupKey}:${canonicalName}`;
      const previous = memberNames.get(key);
      if (previous) warnings.push(issue(`${path}.name`, "duplicate_member_name", `Thành viên “${member.name}” bị nhập hai lần trong ${roleLabel}.`));
      else memberNames.set(key, { path, role: roleLabel });
    };
    ROLE_KEYS.forEach((key) => {
      const role = normalized?.leadership?.[key];
      if (!role || !Array.isArray(role.members)) errors.push(issue(`leadership.${key}.members`, "array_required", `${ROLE_LABELS[key]} cần dùng danh sách members.`));
      (role?.members || []).forEach((member, index) => {
        if (!member.name) errors.push(issue(`leadership.${key}.members[${index}].name`, "required", "Thiếu tên thành viên."));
        if (member.id && memberIds.has(member.id)) warnings.push(issue(`leadership.${key}.members[${index}].id`, "duplicate_member_id", `ID thành viên bị trùng: ${member.id}.`));
        if (member.id) memberIds.add(member.id);
        registerMember(member, `leadership.${key}.members[${index}]`, ROLE_LABELS[key], `role:${key}`);
      });
    });
    (normalized?.leadership?.teams || []).forEach((team, teamIndex) => {
      if (!team.name) errors.push(issue(`leadership.teams[${teamIndex}].name`, "required", "Thiếu tên ban phục vụ."));
      if (!Array.isArray(team.members)) errors.push(issue(`leadership.teams[${teamIndex}].members`, "array_required", "Thành viên ban phải là một mảng."));
      (team.members || []).forEach((member, memberIndex) => {
        if (!member.name) errors.push(issue(`leadership.teams[${teamIndex}].members[${memberIndex}].name`, "required", "Thiếu tên thành viên."));
        if (member.id && memberIds.has(member.id)) warnings.push(issue(`leadership.teams[${teamIndex}].members[${memberIndex}].id`, "duplicate_member_id", `ID thành viên bị trùng: ${member.id}.`));
        if (member.id) memberIds.add(member.id);
        registerMember(member, `leadership.teams[${teamIndex}].members[${memberIndex}]`, team.name || `Ban ${teamIndex + 1}`, `team:${teamIndex}`);
      });
    });
    ["total", "new", "inactive"].forEach((key) => {
      if (!Number.isInteger(normalized?.members?.[key]) || normalized.members[key] < 0) errors.push(issue(`members.${key}`, "non_negative_integer", `${key} phải là số nguyên không âm.`));
    });
    return { valid: errors.length === 0, errors, warnings, value: normalized };
  }

  function eventImage(year, activity) {
    const direct = mediaSource(activity.coverImage, "medium")
      || mediaSource(activity.album?.preview?.[0], "medium")
      || mediaSource(activity.images?.[0], "medium");
    if (direct) return direct;
    const match = (year.gallery || []).find((photo) => photo.event === activity.title || photo.event === activity.type);
    return mediaSource(match, "medium");
  }

  function buildIndex(years, options = {}) {
    const normalizedYears = (Array.isArray(years) ? years : [])
      .map((year) => normalizeYear(year, options))
      .filter((year) => Number.isInteger(year.year))
      .sort((a, b) => b.year - a.year);
    const summaries = normalizedYears.map((year) => ({
      year: year.year,
      overview: {
        eyebrow: year.overview.eyebrow,
        title: year.overview.title,
        summary: year.overview.summary,
        coverImage: mediaSource(year.overview.coverImage, "medium"),
      },
      members: copy(year.members),
      leadership: ROLE_KEYS.map((role) => {
        const members = year.leadership[role]?.members || [];
        return {
          role,
          label: ROLE_LABELS[role],
          name: members.map((member) => member.name).filter(Boolean).join(" · "),
        };
      }).filter((entry) => entry.name),
      events: year.activities.map((activity) => ({
        id: activity.id,
        title: activity.title,
        type: activity.type,
        topic: activity.topic,
        date: activity.date,
        description: activity.description,
        image: eventImage(year, activity),
        imageCount: activity.album?.count ?? activity.images?.length ?? 0,
      })),
    }));
    return {
      schemaVersion: SCHEMA_VERSION,
      version: SCHEMA_VERSION,
      generatedAt: options.generatedAt || new Date().toISOString(),
      totals: {
        years: summaries.length,
        members: summaries.reduce((total, year) => total + Math.max(0, integer(year.members.total)), 0),
        activities: summaries.reduce((total, year) => total + year.events.length, 0),
      },
      years: summaries,
    };
  }

  function validateIndex(value, options = {}) {
    const errors = [];
    const warnings = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: [issue("$", "object_required", "Index phải là object JSON.")], warnings };
    if (value.schemaVersion !== SCHEMA_VERSION) warnings.push(issue("schemaVersion", "migration_required", `Index nên dùng schemaVersion ${SCHEMA_VERSION}.`));
    if (!Array.isArray(value.years)) errors.push(issue("years", "array_required", "Index cần mảng years."));
    const seen = new Set();
    (value.years || []).forEach((year, index) => {
      if (!Number.isInteger(Number(year.year))) errors.push(issue(`years[${index}].year`, "invalid_year", "Năm trong index không hợp lệ."));
      if (seen.has(Number(year.year))) errors.push(issue(`years[${index}].year`, "duplicate", `Năm ${year.year} xuất hiện nhiều lần.`));
      seen.add(Number(year.year));
      if (!Array.isArray(year.events)) errors.push(issue(`years[${index}].events`, "array_required", "events phải là mảng."));
    });
    const totals = value.totals || {};
    const actualActivities = (value.years || []).reduce((total, year) => total + (Array.isArray(year.events) ? year.events.length : 0), 0);
    if (Number(totals.years) !== (value.years || []).length) errors.push(issue("totals.years", "mismatch", "Tổng số năm không khớp."));
    if (Number(totals.activities) !== actualActivities) errors.push(issue("totals.activities", "mismatch", "Tổng số hoạt động không khớp."));
    if (options.expectedYears && Number(totals.years) !== options.expectedYears) warnings.push(issue("totals.years", "unexpected", `Dự kiến ${options.expectedYears} năm.`));
    return { valid: errors.length === 0, errors, warnings };
  }

  function validateAlbumManifest(value) {
    const errors = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: [issue("$", "object_required", "Album manifest phải là object JSON.")], warnings: [] };
    if (value.schemaVersion !== 1) errors.push(issue("schemaVersion", "unsupported", "Album manifest hiện dùng schemaVersion 1."));
    if (!Number.isInteger(Number(value.year))) errors.push(issue("year", "invalid_year", "Năm album không hợp lệ."));
    if (!string(value.activityId)) errors.push(issue("activityId", "required", "Album cần activityId."));
    if (!Array.isArray(value.images)) errors.push(issue("images", "array_required", "Album cần mảng images."));
    (value.images || []).forEach((media, index) => validateMedia(media, `images[${index}]`, errors));
    if (Number(value.count) !== (value.images || []).length) errors.push(issue("count", "mismatch", "Số lượng ảnh không khớp mảng images."));
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    YEAR_MIN,
    maxYear,
    ROLE_KEYS,
    ROLE_LABELS,
    TOPICS,
    splitLegacyNames,
    normalizeMember,
    normalizeLeadership,
    normalizeMedia,
    mediaSource,
    normalizeYear,
    validateYear,
    buildIndex,
    validateIndex,
    validateAlbumManifest,
    activitySignature,
    stableActivityId,
  });
});
