(function () {
  "use strict";

  const app = document.querySelector("#admin-app");
  const commandBar = document.querySelector("#admin-command-bar");
  const Store = window.TeresaStore;
  const Schema = window.TeresaSchema;
  const params = new URLSearchParams(window.location.search);
  const TOPICS = [...new Set([...(Schema?.TOPICS || []), "Khác"])];
  const ROLE_LABELS = Schema?.ROLE_LABELS || {
    chaplain: "Cha đặc trách",
    leader: "Trưởng ca đoàn",
    deputyLeader: "Phó ca đoàn",
    conductor: "Ca trưởng",
    treasurer: "Thủ quỹ",
  };
  const ROLE_KEYS = Schema?.ROLE_KEYS || Object.keys(ROLE_LABELS);

  let years = [];
  let currentYear = Number(params.get("year")) || 0;
  let draft = null;
  let published = null;
  let baseRevision = "";
  let editingId = params.get("activity") || "";
  let pendingActivityForm = null;
  let pendingActivityImages = [];
  let pendingCoverMedia = null;
  let dirty = false;
  let pendingLocalSave = false;
  let savingDraft = false;
  let busy = false;
  let uploading = false;
  let cancelUploads = false;
  let autosaveTimer = 0;
  let activeDraftSave = null;
  let draftSavedAt = "";
  let draftEditor = null;
  let historyItems = [];
  let noticeHTML = "";
  let activityMediaRegistry = new Map();
  let revisionRegistry = new Map();
  let mediaState = { items: [], cursor: "", truncated: false, topic: "Tất cả", activityId: "", loading: false };
  let mediaAudit = { status: "idle", errors: [], warnings: [], checkedAt: "" };

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const message = (text, type = "success") => `<p class="admin-message ${type}" role="status">${escapeHTML(text)}</p>`;
  const sourceOf = (media, variant = "original") => Store.mediaSource?.(media, variant) || Schema.mediaSource?.(media, variant) || (typeof media === "string" ? media : media?.src || "");
  const mediaKey = (media) => String(media?.id || sourceOf(media, "original") || sourceOf(media, "medium"));
  const fingerprint = (value) => JSON.stringify(value || null);
  const formatTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "";
  const formatDateTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Chưa có";

  function uniqueMedia(items = []) {
    const seen = new Set();
    return items.filter((item) => {
      const key = mediaKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function topicSelect(name, value = "") {
    const options = [...new Set([...TOPICS, value].filter(Boolean))];
    return `<select name="${escapeHTML(name)}" required>${options.map((topic) => `<option value="${escapeHTML(topic)}" ${topic === value ? "selected" : ""}>${escapeHTML(topic)}</option>`).join("")}</select>`;
  }

  function blankYear(year) {
    return Schema.normalizeYear({
      schemaVersion: Schema.SCHEMA_VERSION,
      year,
      meta: { revision: 0, status: "draft" },
      overview: { eyebrow: `Nhật ký ${year}`, title: `Năm ${year}`, summary: "", longDescription: "", coverImage: "" },
      leadership: {},
      members: { total: 0, new: 0, inactive: 0, notes: "" },
      activities: [], achievements: [], challenges: [], sharing: [], gallery: [],
      yearMark: { title: "Dấu ấn trong năm", highlight: "" },
    });
  }

  function preserveMedia(existing, inputValue, uploaded = null) {
    const value = String(inputValue || "").trim();
    if (uploaded && sourceOf(uploaded, "original") === value) return clone(uploaded);
    if (existing && sourceOf(existing, "original") === value) return clone(existing);
    return value;
  }

  function validationResult() {
    if (!draft) return { valid: false, errors: [], warnings: [] };
    const result = Schema.validateYear(draft, { normalize: false, maxYear: Store.YEAR_MAX });
    const errors = [...result.errors, ...mediaAudit.errors];
    const warnings = [...result.warnings, ...mediaAudit.warnings];
    return { ...result, valid: errors.length === 0, errors, warnings };
  }

  function hasPendingNewActivity() {
    const form = document.querySelector("#activity-form");
    if (form && !form.querySelector('[name="id"]')?.value) {
      if (["title", "date", "description", "body"].some((name) => form.querySelector(`[name="${name}"]`)?.value.trim())) return true;
    }
    return Boolean(pendingActivityForm?.title || pendingActivityForm?.body) || pendingActivityImages.length > 0 || Boolean(pendingCoverMedia);
  }

  function updateCommandBar() {
    if (!commandBar || !draft) { if (commandBar) commandBar.hidden = true; return; }
    commandBar.hidden = false;
    const title = document.querySelector("#draft-status-title");
    const detail = document.querySelector("#draft-status-detail");
    const validation = validationResult();
    const pendingNew = hasPendingNewActivity();
    if (title) title.textContent = dirty || pendingNew ? `Năm ${currentYear} · Có thay đổi chưa xuất bản` : `Năm ${currentYear} · Đã đồng bộ`;
    if (detail) {
      if (uploading) detail.textContent = "Đang tải ảnh lên…";
      else if (savingDraft) detail.textContent = "Đang lưu bản nháp trên thiết bị…";
      else if (pendingLocalSave) detail.textContent = "Đang chờ tự lưu…";
      else if (!validation.valid) detail.textContent = `${validation.errors.length} lỗi cần sửa trước khi xuất bản`;
      else if (draftSavedAt) detail.textContent = `Bản nháp đã lưu lúc ${formatTime(draftSavedAt)}`;
      else detail.textContent = "Chưa có thay đổi";
    }
    document.querySelector("#command-save-draft")?.toggleAttribute("disabled", busy || savingDraft);
    document.querySelector("#command-preview")?.toggleAttribute("disabled", busy || !validation.valid);
    document.querySelector("#command-publish")?.toggleAttribute("disabled", busy || !validation.valid || (!dirty && !pendingNew));
    document.querySelector("#command-discard")?.toggleAttribute("disabled", busy || (!dirty && !pendingLocalSave && !pendingNew));
    document.title = dirty || pendingLocalSave || pendingNew ? `• Quản trị ${currentYear} — Teresa` : `Quản trị ${currentYear} — Teresa`;
  }

  function markChanged() {
    pendingLocalSave = true;
    dirty = true;
    mediaAudit = { status: "stale", errors: [], warnings: [], checkedAt: "" };
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => saveDraftNow({ sync: true }).catch(showError), 850);
    updateCommandBar();
  }

  function showError(error, prefix = "Không thể thực hiện") {
    const request = error?.requestId ? ` · Mã yêu cầu ${error.requestId}` : "";
    noticeHTML = message(`${prefix}: ${error?.message || error}${request}`, "error");
    renderPreservingScroll();
  }

  function loginView(note = "") {
    commandBar.hidden = true;
    const configured = Store.isFirebaseConfigured() && Store.isSourceApiConfigured();
    const cloudStatus = configured
      ? `<p class="cloud-status active">Firebase Auth và Worker quản trị đã sẵn sàng.</p>`
      : `<p class="cloud-status warning">Thiếu cấu hình Firebase hoặc Worker quản trị. Chế độ đăng nhập cục bộ không được hỗ trợ.</p>`;
    app.innerHTML = `<section class="admin-login"><div class="admin-login-card"><p class="eyebrow">Khu quản trị</p><h1>Chào người giữ ký ức.</h1><p>Đăng nhập để chuẩn bị bản nháp, xem trước rồi mới xuất bản.</p>${cloudStatus}${note}<form id="login-form"><label>Email Admin<input name="username" type="email" autocomplete="username" required /></label><label>Mật khẩu<span class="password-control"><input name="password" type="password" autocomplete="current-password" required /><button type="button" data-password-toggle aria-label="Hiện mật khẩu">Hiện</button></span></label><button class="button button-primary" type="submit">Đăng nhập →</button></form></div></section>`;
    document.querySelector("[data-password-toggle]")?.addEventListener("click", (event) => {
      const input = document.querySelector('[name="password"]');
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      event.currentTarget.textContent = visible ? "Hiện" : "Ẩn";
    });
    document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const result = await Store.login(values.get("username"), values.get("password"));
      if (result.success) await initializeDashboard();
      else loginView(message(result.message || "Email hoặc mật khẩu chưa đúng.", "error"));
    });
  }

  function memberRow(member = {}, options = {}) {
    const data = Schema.normalizeMember(member, { scope: options.scope || "member", index: options.index || 0 });
    const photo = sourceOf(data.photo, "original");
    return `<div class="team-member-editor" data-member-id="${escapeHTML(data.id)}">
      <input class="team-member-name" value="${escapeHTML(data.name)}" placeholder="Tên thành viên" aria-label="Tên thành viên" />
      <input class="team-member-note" value="${escapeHTML(data.note || "")}" placeholder="Ghi chú (tùy chọn)" aria-label="Ghi chú thành viên" />
      <input class="team-member-photo" value="${escapeHTML(photo)}" placeholder="Đường dẫn ảnh (tùy chọn)" aria-label="Ảnh thành viên" />
      <label class="mini-upload">Tải ảnh<input class="team-member-upload" type="file" accept="image/jpeg,image/png,image/webp,image/avif" /></label>
      <img class="member-photo-preview" src="${escapeHTML(photo || "images/hero.jpg")}" data-media-src="${escapeHTML(photo)}" alt="" ${photo ? "" : "hidden"} />
      <button class="danger-link" type="button" data-remove-member aria-label="Xóa thành viên">×</button>
    </div>`;
  }

  function roleEditor(key, role = {}) {
    const members = Array.isArray(role.members) ? role.members : [];
    return `<article class="team-row leadership-role-editor" data-role-key="${escapeHTML(key)}">
      <div class="teams-heading"><strong>${escapeHTML(ROLE_LABELS[key] || key)}</strong><button class="text-button" type="button" data-add-role-member="${escapeHTML(key)}">+ Thêm người</button></div>
      <div class="team-members-list">${members.map((member, index) => memberRow(member, { scope: key, index })).join("") || '<p class="empty-note">Chưa có người phụ trách.</p>'}</div>
    </article>`;
  }

  function teamEditor(team = {}, index = 0) {
    return `<article class="team-row" data-team-id="${escapeHTML(team.id || "")}">
      <label>Tên ban<input class="team-name" value="${escapeHTML(team.name || "")}" placeholder="Ví dụ: Ban Truyền thông" required /></label>
      <div class="team-members-editor"><div class="team-members-list">${(team.members || []).map((member, memberIndex) => memberRow(member, { scope: team.name || `team-${index}`, index: memberIndex })).join("") || '<p class="empty-note">Chưa có thành viên.</p>'}</div><button class="text-button" type="button" data-add-team-member>+ Thêm thành viên</button></div>
      <button class="danger-link" type="button" data-remove-team>Xóa ban</button>
    </article>`;
  }

  function overviewForm() {
    const overview = draft.overview || {};
    const yearMark = draft.yearMark || {};
    return `<form class="admin-form compact-form" id="overview-form"><div class="admin-form-title"><div><p class="eyebrow">Nhật ký ${currentYear}</p><h2>Thông tin năm</h2></div></div>
      <label>Nhãn giới thiệu<input name="eyebrow" value="${escapeHTML(overview.eyebrow)}" /></label>
      <label>Tiêu đề<input name="title" value="${escapeHTML(overview.title)}" required /></label>
      <label>Tóm tắt<textarea name="summary" rows="3">${escapeHTML(overview.summary)}</textarea></label>
      <label>Bài giới thiệu<textarea name="longDescription" rows="6">${escapeHTML(overview.longDescription)}</textarea></label>
      <label>Ảnh bìa<input name="coverImage" value="${escapeHTML(sourceOf(overview.coverImage, "original"))}" /></label>
      <div class="form-divider"><strong>Khung Dấu ấn</strong><small>Nội dung ngắn gọn giúp hiển thị tốt trên điện thoại.</small></div>
      <label>Tiêu đề dấu ấn<input name="yearMarkTitle" value="${escapeHTML(yearMark.title)}" /></label>
      <label>Dòng mô tả / ngày nổi bật<input name="yearMarkHighlight" value="${escapeHTML(yearMark.highlight)}" /></label>
      <button class="button" type="submit">Lưu vào bản nháp</button></form>`;
  }

  function leadershipForm() {
    const leadership = draft.leadership || Schema.normalizeLeadership({});
    return `<form class="admin-form compact-form" id="leadership-form"><div class="admin-form-title"><div><p class="eyebrow">Nhân sự ${currentYear}</p><h2>Ban điều hành</h2></div></div>
      <p class="storage-note">Mỗi người là một hàng riêng với ảnh và ghi chú riêng. Không cần nhập dấu chấm hoặc dấu phân cách.</p>
      <div class="leadership-people-editor">${ROLE_KEYS.map((key) => roleEditor(key, leadership[key])).join("")}</div>
      <div class="teams-editor"><div class="teams-heading"><strong>Các ban phục vụ & thành viên</strong><button type="button" class="text-button" id="add-team">+ Thêm ban</button></div><div id="teams-list">${(leadership.teams || []).map(teamEditor).join("") || '<p class="empty-note">Chưa có ban nào.</p>'}</div></div>
      <button class="button" type="submit">Lưu vào bản nháp</button></form>`;
  }

  function membersForm() {
    const members = draft.members || {};
    return `<form class="admin-form compact-form" id="members-form"><div class="admin-form-title"><div><p class="eyebrow">Thống kê ${currentYear}</p><h2>Thành viên</h2></div></div><div class="form-grid three">
      <label>Tổng số<input name="total" type="number" min="0" value="${Number(members.total || 0)}" /></label>
      <label>In · thêm mới<input name="new" type="number" min="0" value="${Number(members.new || 0)}" /></label>
      <label>Out · nghỉ<input name="inactive" type="number" min="0" value="${Number(members.inactive || 0)}" /></label></div>
      <label>Ghi chú<textarea name="notes" rows="3">${escapeHTML(members.notes || "")}</textarea></label><button class="button" type="submit">Lưu vào bản nháp</button></form>`;
  }

  function registerActivityMedia(media) {
    const key = mediaKey(media);
    if (key) activityMediaRegistry.set(key, media);
    return key;
  }

  function activityForm(activity = {}) {
    activityMediaRegistry = new Map();
    const hasManifest = Boolean(activity.album?.manifest);
    const images = hasManifest ? (activity.album.preview || []) : uniqueMedia([...(activity.images || []), ...pendingActivityImages]);
    const cover = sourceOf(pendingCoverMedia || activity.coverImage || images[0], "original");
    const imageRows = images.map((image) => {
      const key = registerActivityMedia(image);
      return `<span data-media-key="${escapeHTML(key)}" data-source="${escapeHTML(sourceOf(image, "original"))}">${escapeHTML(image.caption || image.alt || "Ảnh đã đính kèm")}${hasManifest ? "" : ` <button type="button" data-remove-activity-media="${escapeHTML(key)}" aria-label="Gỡ ảnh">×</button>`}</span>`;
    }).join("");
    const topic = activity.topic || activity.type || "Khác";
    return `<form class="admin-form" id="activity-form"><input type="hidden" name="id" value="${escapeHTML(activity.id || "")}" /><input type="hidden" name="coverImage" value="${escapeHTML(cover)}" />
      <div class="admin-form-title"><div><p class="eyebrow">Hoạt động</p><h2>${activity.id ? "Chỉnh sửa hoạt động" : "Thêm hoạt động"}</h2></div><button class="text-button" type="button" id="clear-activity">Tạo mục mới</button></div>
      <div class="activity-context"><span>Năm cố định: <strong>${currentYear}</strong></span><span>Mọi thay đổi chỉ nằm trong bản nháp cho đến khi bấm Xuất bản.</span></div>
      <div class="form-grid two"><label>Tên hoạt động<input name="title" required value="${escapeHTML(activity.title || "")}" /></label><label>Ngày / thời gian<input name="date" required value="${escapeHTML(activity.date || "")}" placeholder="Ví dụ: 01.10.${currentYear}" /></label><label>Địa điểm<input name="location" value="${escapeHTML(activity.location || "")}" placeholder="Có thể để trống và bổ sung sau" /></label><label>Loại hoạt động<input name="type" required value="${escapeHTML(activity.type || "Thánh lễ")}" /></label><label>Chủ đề ảnh${topicSelect("topic", topic)}</label></div>
      <label>Tóm tắt<input name="description" required value="${escapeHTML(activity.description || "")}" /></label>
      <label>Bài viết chi tiết<textarea name="body" rows="7" required>${escapeHTML(activity.body || activity.description || "")}</textarea></label>
      <div class="word-import"><strong>Nhập bài viết Word</strong><input id="word-import" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /><small id="word-import-note">Chỉ nhập nội dung bài viết; năm và chủ đề không thay đổi.</small></div>
      <div class="cover-picker"><div class="cover-picker-copy"><strong>Ảnh trang mở đầu hoạt động</strong><small>Ảnh tải lên được lưu ở R2 nhưng chỉ được áp dụng vào bản nháp.</small><code>${escapeHTML(cover || "Chưa chọn")}</code></div><img class="cover-preview" data-media-src="${escapeHTML(cover)}" src="${escapeHTML(cover || "images/hero.jpg")}" alt="Xem trước ảnh trang mở đầu" /><label class="cover-upload">Thay ảnh<input id="activity-cover" type="file" accept="image/jpeg,image/png,image/webp,image/avif" /></label></div>
      <div class="media-picker"><div><strong>Ảnh của hoạt động</strong><p>${hasManifest ? "Album này dùng manifest riêng. Hãy quản lý album sau khi API cập nhật manifest được bật." : `Ảnh được tải tuần tự để tránh quá tải bộ nhớ trên điện thoại.`}</p></div><input id="activity-images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple ${hasManifest ? "disabled" : ""} /><button class="text-button" type="button" data-cancel-upload hidden>Dừng sau ảnh hiện tại</button><small data-upload-status></small><div id="selected-images" class="selected-media">${imageRows}</div></div>
      <button class="button button-primary" type="submit">Lưu hoạt động vào bản nháp</button></form>`;
  }

  function activityRows() {
    return (draft.activities || []).map((activity) => `<article class="admin-activity-row ${activity.id === editingId ? "selected" : ""}"><div><small>${escapeHTML(activity.type)} · ${escapeHTML(activity.date)}</small><h3>${escapeHTML(activity.title)}</h3><p>${escapeHTML(activity.description)}</p></div><div class="admin-row-actions"><button type="button" data-preview-activity="${escapeHTML(activity.id)}">Xem trước ↗</button><button type="button" data-edit-activity="${escapeHTML(activity.id)}">Sửa</button><button class="danger-link" type="button" data-delete-activity="${escapeHTML(activity.id)}">Xóa</button></div></article>`).join("");
  }

  function mediaPanel() {
    const allTopics = [...new Set(["Tất cả", ...TOPICS, ...mediaState.items.map((item) => item.topic).filter(Boolean)])];
    const activityOptions = (draft.activities || []).map((activity) => `<option value="${escapeHTML(activity.id)}" ${activity.id === mediaState.activityId ? "selected" : ""}>${escapeHTML(activity.title)}</option>`).join("");
    const cards = mediaState.items.map((item) => {
      const id = mediaKey(item);
      const thumbnail = sourceOf(item, "thumbnail") || sourceOf(item, "medium") || sourceOf(item, "original");
      return `<figure data-media-topic="${escapeHTML(item.topic || "Khác")}"><img src="${escapeHTML(thumbnail || "images/hero.jpg")}" data-media-src="${escapeHTML(thumbnail)}" alt="${escapeHTML(item.alt || item.caption || item.filename || "Ảnh tư liệu")}" loading="lazy" decoding="async" /><figcaption><strong>${escapeHTML(item.topic || "Khác")}</strong><span>${escapeHTML(item.caption || item.filename || "Ảnh tư liệu")}</span><div class="media-card-actions"><button type="button" data-set-cover-id="${escapeHTML(id)}" ${editingId ? "" : "disabled"}>Đặt làm ảnh bìa</button><button type="button" data-delete-media-id="${escapeHTML(id)}" class="danger-link">Xóa ảnh</button></div></figcaption></figure>`;
    }).join("");
    return `<section class="admin-panel media-panel"><div class="admin-form-title"><div><p class="eyebrow">Kho ảnh ${currentYear}</p><h2>Ảnh theo năm và chủ đề</h2></div></div>
      <form id="media-form" class="media-upload-form"><input name="media" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required /><label>Chủ đề${topicSelect("topic", mediaState.topic === "Tất cả" ? "Khác" : mediaState.topic)}</label><input name="caption" placeholder="Chú thích ảnh" /><button class="button" type="submit">Thêm vào kho ảnh</button><button class="text-button" type="button" data-cancel-upload hidden>Dừng sau ảnh hiện tại</button><small data-upload-status></small></form>
      <p class="storage-note">Mỗi lần chỉ hiển thị 24 ảnh. Ảnh tải lên có bản nhỏ, vừa và đầy đủ để dùng tốt trên điện thoại.</p>
      <div class="media-library-controls"><label>Sự kiện<select id="media-activity-filter"><option value="">Tất cả sự kiện</option>${activityOptions}</select></label><div class="media-filters">${allTopics.map((topic) => `<button type="button" class="${topic === mediaState.topic ? "active" : ""}" data-media-filter="${escapeHTML(topic)}">${escapeHTML(topic)}</button>`).join("")}</div></div>
      <div class="media-library">${cards || '<p class="empty-note">Chưa có ảnh trong trang này.</p>'}</div>
      ${mediaState.truncated ? '<button class="button" id="load-more-media" type="button">Tải thêm 24 ảnh</button>' : ""}</section>`;
  }

  function coverReferences() {
    const references = [];
    const add = (path, media) => {
      const url = sourceOf(media, "medium") || sourceOf(media, "original");
      if (url) references.push({ path, url });
    };
    add("overview.coverImage", draft?.overview?.coverImage);
    (draft?.activities || []).forEach((activity, index) => add(`activities[${index}].coverImage`, activity.coverImage));
    return references;
  }

  async function auditCoverImages(options = {}) {
    if (!draft || mediaAudit.status === "checking") return mediaAudit;
    mediaAudit = { status: "checking", errors: [], warnings: [], checkedAt: "" };
    updateCommandBar();
    const grouped = new Map();
    coverReferences().forEach((reference) => {
      if (!grouped.has(reference.url)) grouped.set(reference.url, []);
      grouped.get(reference.url).push(reference.path);
    });
    const entries = [...grouped.entries()];
    const errors = [];
    const warnings = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const [url, paths] = entries[cursor++];
        if (/^(?:data:|blob:)/i.test(url)) continue;
        try {
          const response = await fetch(new URL(url, window.location.href), { method: "HEAD", cache: "no-store", credentials: "omit" });
          if (response.status === 404 || response.status === 410) paths.forEach((path) => errors.push({ path, code: "cover_not_found", message: `Ảnh bìa không tồn tại: ${url}` }));
          else if (!response.ok && response.type !== "opaque") paths.forEach((path) => warnings.push({ path, code: "cover_unverified", message: `Chưa xác minh được ảnh bìa (${response.status}): ${url}` }));
        } catch (_error) {
          paths.forEach((path) => warnings.push({ path, code: "cover_unverified", message: `Trình duyệt chưa xác minh được ảnh bìa: ${url}` }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, entries.length)) }, worker));
    mediaAudit = { status: "complete", errors, warnings, checkedAt: new Date().toISOString() };
    updateCommandBar();
    if (options.render !== false) renderPreservingScroll(errors.length ? message(`Phát hiện ${errors.length} ảnh bìa không tồn tại.`, "error") : message("Đã kiểm tra các ảnh bìa đang được sử dụng."));
    return mediaAudit;
  }

  function editorPanel() {
    const latest = historyItems[0] || {};
    const latestDate = latest.date || latest.timestamp || "";
    const localEditor = draftEditor?.name || draftEditor?.email || Store.currentUser?.()?.name || "Thiết bị hiện tại";
    const publishedEditor = latest.author || "Chưa có thông tin";
    return `<section class="admin-edit-meta" aria-label="Thông tin chỉnh sửa gần nhất"><div><small>Bản nháp gần nhất</small><strong>${escapeHTML(localEditor)}</strong><span>${escapeHTML(formatDateTime(draftSavedAt))}</span></div><div><small>Bản công khai gần nhất</small><strong>${escapeHTML(publishedEditor)}</strong><span>${escapeHTML(formatDateTime(latestDate))}</span></div></section>`;
  }

  function validationPanel() {
    const result = validationResult();
    const entries = [...result.errors.map((entry) => ({ ...entry, type: "Lỗi" })), ...result.warnings.map((entry) => ({ ...entry, type: "Lưu ý" }))];
    const auditText = mediaAudit.status === "checking" ? "Đang kiểm tra ảnh…" : mediaAudit.status === "complete" ? `Ảnh đã kiểm tra lúc ${formatTime(mediaAudit.checkedAt)}` : "Ảnh bìa cần được kiểm tra lại";
    return `<section class="admin-panel validation-summary" aria-live="polite"><div class="admin-form-title"><div><p class="eyebrow">Kiểm tra dữ liệu</p><h2>${result.valid ? "Bản nháp hợp lệ" : `${result.errors.length} lỗi cần sửa`}</h2><small>${escapeHTML(auditText)}</small></div><button class="text-button" type="button" id="audit-cover-images" ${mediaAudit.status === "checking" ? "disabled" : ""}>Kiểm tra ảnh bìa</button></div>${entries.length ? `<ul>${entries.slice(0, 20).map((entry) => `<li><strong>${escapeHTML(entry.type)}</strong> · <code>${escapeHTML(entry.path)}</code> — ${escapeHTML(entry.message)}</li>`).join("")}</ul>` : '<p>Không phát hiện lỗi cấu trúc. Bạn có thể xem trước trước khi xuất bản.</p>'}</section>`;
  }

  function historyPanel() {
    revisionRegistry = new Map();
    const rows = historyItems.map((item, index) => {
      const key = String(item.sha || item.id || item.revision || index);
      revisionRegistry.set(key, item);
      const date = item.date || item.timestamp || "";
      return `<li><div><strong>${escapeHTML(item.message || item.label || "Phiên bản đã lưu")}</strong><small>${escapeHTML(date ? new Date(date).toLocaleString("vi-VN") : key.slice(0, 12))}${item.author ? ` · ${escapeHTML(item.author)}` : ""}</small></div><button type="button" data-restore-revision="${escapeHTML(key)}">Khôi phục vào bản nháp</button></li>`;
    }).join("");
    return `<section class="admin-panel revision-panel"><div class="admin-form-title"><div><p class="eyebrow">Lịch sử</p><h2>Các phiên bản gần đây</h2></div><button class="text-button" type="button" id="refresh-history">Làm mới</button></div>${rows ? `<ul class="revision-list">${rows}</ul>` : '<p class="empty-note">Chưa đọc được lịch sử phiên bản.</p>'}</section>`;
  }

  function renderDashboard(extraNotice = "") {
    if (!draft) return;
    if (extraNotice) noticeHTML = extraNotice;
    const selected = draft.activities.find((activity) => activity.id === editingId) || (!editingId ? pendingActivityForm || {} : {});
    const yearButtons = years.map((year) => `<button type="button" class="${year === currentYear ? "active" : ""}" data-year="${year}">${year}</button>`).join("");
    app.innerHTML = `<section class="admin-shell"><div class="container"><div class="admin-heading"><div><p class="eyebrow">Quản trị kho lưu trữ · Bản nháp an toàn</p><h1>Nhật ký, hoạt động<br /><em>và những bức ảnh.</em></h1></div><div class="admin-tools"><button type="button" id="export-word">Xuất Word năm ${currentYear}</button><button type="button" id="export-archive">Sao lưu JSON đã xuất bản</button><label class="import-label">Nhập JSON vào bản nháp<input id="import-archive" type="file" accept="application/json" /></label><button type="button" id="logout">Đăng xuất</button></div></div>
      ${noticeHTML}<nav class="admin-years" aria-label="Chọn năm">${yearButtons}<button type="button" id="add-year">+ Thêm năm</button></nav>
      ${editorPanel()}${validationPanel()}<div class="admin-grid"><aside>${overviewForm()}${leadershipForm()}${membersForm()}</aside><div><section class="admin-panel"><div class="admin-form-title"><div><p class="eyebrow">Danh sách</p><h2>Hoạt động năm ${currentYear}</h2></div><button type="button" class="button" id="new-activity">+ Thêm hoạt động</button></div><div class="admin-activity-list">${activityRows() || '<p class="empty-note">Chưa có hoạt động.</p>'}</div></section>${activityForm(selected)}${mediaPanel()}${historyPanel()}</div></div></div></section>`;
    noticeHTML = "";
    Store.hydrateMedia?.(app);
    bindDashboard();
    updateCommandBar();
  }

  function renderPreservingScroll(extraNotice = "") {
    const top = window.scrollY;
    renderDashboard(extraNotice);
    requestAnimationFrame(() => window.scrollTo({ top, behavior: "auto" }));
  }

  function existingMember(id) {
    if (!id) return null;
    for (const key of ROLE_KEYS) {
      const found = draft.leadership?.[key]?.members?.find((member) => member.id === id);
      if (found) return found;
    }
    for (const team of draft.leadership?.teams || []) {
      const found = team.members?.find((member) => member.id === id);
      if (found) return found;
    }
    return null;
  }

  function collectMember(row) {
    const id = row.dataset.memberId || "";
    const previous = existingMember(id) || {};
    const photoValue = row.querySelector(".team-member-photo")?.value || "";
    return {
      ...previous,
      ...(id ? { id } : {}),
      name: row.querySelector(".team-member-name")?.value.trim() || "",
      note: row.querySelector(".team-member-note")?.value.trim() || "",
      photo: preserveMedia(previous.photo, photoValue, row._uploadedMedia),
    };
  }

  function collectOverview() {
    const form = document.querySelector("#overview-form");
    if (!form) return;
    const values = Object.fromEntries(new FormData(form));
    draft.overview = {
      ...draft.overview,
      eyebrow: values.eyebrow || "",
      title: values.title || "",
      summary: values.summary || "",
      longDescription: values.longDescription || "",
      coverImage: preserveMedia(draft.overview?.coverImage, values.coverImage),
    };
    draft.yearMark = { ...(draft.yearMark || {}), title: values.yearMarkTitle || "Dấu ấn trong năm", highlight: values.yearMarkHighlight || "" };
  }

  function collectMembers() {
    const form = document.querySelector("#members-form");
    if (!form) return;
    const values = Object.fromEntries(new FormData(form));
    draft.members = { ...draft.members, total: Number(values.total || 0), new: Number(values.new || 0), inactive: Number(values.inactive || 0), notes: values.notes || "" };
  }

  function collectLeadership() {
    const form = document.querySelector("#leadership-form");
    if (!form) return;
    const current = draft.leadership || {};
    const leadership = { ...current };
    ROLE_KEYS.forEach((key) => {
      const holder = form.querySelector(`[data-role-key="${key}"]`);
      leadership[key] = {
        ...(current[key] || {}),
        members: [...(holder?.querySelectorAll(".team-member-editor") || [])].map(collectMember).filter((member) => member.name),
      };
    });
    leadership.teams = [...form.querySelectorAll("#teams-list > .team-row")].map((row) => ({
      ...((current.teams || []).find((team) => team.id && team.id === row.dataset.teamId) || {}),
      ...(row.dataset.teamId ? { id: row.dataset.teamId } : {}),
      name: row.querySelector(".team-name")?.value.trim() || "",
      members: [...row.querySelectorAll(".team-member-editor")].map(collectMember).filter((member) => member.name),
    })).filter((team) => team.name);
    draft.leadership = Schema.normalizeLeadership(leadership);
  }

  function collectActivityForm(updateExisting = true) {
    const form = document.querySelector("#activity-form");
    if (!form) return null;
    const values = Object.fromEntries(new FormData(form));
    const existing = draft.activities.find((activity) => activity.id === values.id) || {};
    const images = [...form.querySelectorAll("#selected-images [data-media-key]")].map((element) => activityMediaRegistry.get(element.dataset.mediaKey) || Schema.normalizeMedia(element.dataset.source)).filter((media) => sourceOf(media));
    const activity = {
      ...existing,
      ...values,
      coverImage: preserveMedia(existing.coverImage, values.coverImage, pendingCoverMedia),
      title: values.title || "",
      date: values.date || "",
      location: values.location || "",
      type: values.type || "Khác",
      topic: values.topic || values.type || "Khác",
      description: values.description || "",
      body: values.body || "",
    };
    if (existing.album?.manifest) {
      activity.album = existing.album;
      delete activity.images;
    } else activity.images = images;
    if (!activity.coverImage) delete activity.coverImage;
    if (updateExisting && existing.id) {
      const index = draft.activities.findIndex((item) => item.id === existing.id);
      draft.activities[index] = activity;
    } else if (!existing.id) pendingActivityForm = activity;
    return activity;
  }

  function syncAllForms() {
    if (!draft) return;
    collectOverview();
    collectMembers();
    collectLeadership();
    collectActivityForm(true);
    draft = Schema.normalizeYear(draft);
  }

  async function saveDraftNow(options = {}) {
    if (!draft) return;
    clearTimeout(autosaveTimer);
    if (savingDraft && activeDraftSave) {
      pendingLocalSave = true;
      await activeDraftSave;
      return saveDraftNow(options);
    }
    if (options.sync !== false) syncAllForms();
    const snapshot = clone(draft);
    pendingLocalSave = false;
    savingDraft = true;
    updateCommandBar();
    try {
      activeDraftSave = Store.saveDraft(currentYear, snapshot);
      const record = await activeDraftSave;
      if (!pendingLocalSave && fingerprint(draft) === fingerprint(snapshot)) draft = Schema.normalizeYear(record?.data || snapshot);
      draftSavedAt = record?.updatedAt || new Date().toISOString();
      draftEditor = record?.editor || Store.currentUser?.() || draftEditor;
      dirty = !published || fingerprint(draft) !== fingerprint(published) || hasPendingNewActivity();
    } finally {
      savingDraft = false;
      activeDraftSave = null;
      if (pendingLocalSave) autosaveTimer = window.setTimeout(() => saveDraftNow({ sync: true }).catch(showError), 250);
      updateCommandBar();
    }
  }

  async function loadHistory() {
    try {
      const loader = Store.listRevisions || Store.getYearHistory;
      const result = loader ? await loader(currentYear) : { items: [] };
      historyItems = Array.isArray(result) ? result : (result.items || []);
    } catch (_error) { historyItems = []; }
  }

  async function loadMediaPage(reset = false, topic = mediaState.topic, activityId = mediaState.activityId) {
    if (mediaState.loading) return;
    mediaState.loading = true;
    if (reset) mediaState = { items: [], cursor: "", truncated: false, topic, activityId, loading: true };
    try {
      const result = Store.listMedia
        ? await Store.listMedia({ year: currentYear, topic: topic === "Tất cả" ? "" : topic, activityId, cursor: reset ? "" : mediaState.cursor, limit: 24 })
        : { items: await Store.getMedia({ year: currentYear, topic, activityId }), cursor: "", truncated: false };
      const known = new Set(mediaState.items.map(mediaKey));
      mediaState.items.push(...(result.items || []).filter((item) => !known.has(mediaKey(item))));
      mediaState.cursor = result.cursor || "";
      mediaState.truncated = Boolean(result.truncated || result.cursor);
    } finally { mediaState.loading = false; }
  }

  async function openYear(year, options = {}) {
    if (draft && pendingLocalSave) await saveDraftNow({ sync: true });
    busy = true;
    updateCommandBar();
    currentYear = Number(year);
    editingId = "";
    pendingActivityForm = null;
    pendingActivityImages = [];
    pendingCoverMedia = null;
    mediaState = { items: [], cursor: "", truncated: false, topic: "Tất cả", activityId: "", loading: false };
    mediaAudit = { status: "idle", errors: [], warnings: [], checkedAt: "" };
    try {
      if (options.blank) {
        published = null;
        baseRevision = "";
        draft = blankYear(currentYear);
        const record = await Store.saveDraft(currentYear, draft);
        draftSavedAt = record?.updatedAt || new Date().toISOString();
        draftEditor = record?.editor || Store.currentUser?.() || null;
        dirty = true;
      } else {
        const remote = await Store.loadYearForAdmin(currentYear);
        published = Schema.normalizeYear(remote);
        baseRevision = remote?._revision || remote?.meta?.revision || "";
        const local = await Store.loadDraft(currentYear);
        draft = Schema.normalizeYear(local?.data || published);
        draftSavedAt = local?.updatedAt || "";
        draftEditor = local?.editor || Store.currentUser?.() || null;
        dirty = Boolean(local) && fingerprint(draft) !== fingerprint(published);
      }
      pendingLocalSave = false;
      await Promise.all([loadHistory(), loadMediaPage(true, "Tất cả")]);
      history.replaceState(null, "", `admin.html?year=${currentYear}${editingId ? `&activity=${encodeURIComponent(editingId)}` : ""}`);
      renderDashboard(options.blank ? message(`Đã tạo bản nháp năm ${currentYear}. Chưa có dữ liệu nào được xuất bản.`) : "");
      window.setTimeout(() => auditCoverImages({ render: false }).catch(() => {}), 0);
    } catch (error) {
      adminError(error);
    } finally { busy = false; updateCommandBar(); }
  }

  async function initializeDashboard() {
    if (!Schema || !Store) { adminError(new Error("Thiếu TeresaSchema hoặc TeresaStore.")); return; }
    years = [...new Set((await Store.availableYears()).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
    if (!years.length) years = [new Date().getFullYear()];
    if (!currentYear || !years.includes(currentYear)) currentYear = years.at(-1);
    await openYear(currentYear);
  }

  async function publishDraft() {
    syncAllForms();
    await saveDraftNow({ sync: false });
    await auditCoverImages({ render: false });
    const validation = validationResult();
    if (!validation.valid) {
      renderPreservingScroll(message(`Chưa thể xuất bản: ${validation.errors[0]?.message || "dữ liệu chưa hợp lệ"}`, "error"));
      return;
    }
    if (!confirm(`Xuất bản toàn bộ thay đổi của năm ${currentYear}?`)) return;
    busy = true;
    updateCommandBar();
    try {
      const saved = await Store.saveYear(draft, { baseRevision, mode: "publish" });
      published = Schema.normalizeYear(saved);
      draft = Schema.normalizeYear(saved);
      baseRevision = saved?._revision || saved?.meta?.revision || "";
      dirty = false;
      pendingLocalSave = false;
      draftSavedAt = "";
      await loadHistory();
      renderDashboard(message(`Đã xuất bản dữ liệu năm ${currentYear}.`));
    } catch (error) {
      const prefix = error.status === 409 ? "Dữ liệu đã được sửa ở nơi khác; hãy tải lại và đối chiếu" : "Không thể xuất bản";
      showError(error, prefix);
    } finally { busy = false; updateCommandBar(); }
  }

  async function previewDraft(activityId = "") {
    syncAllForms();
    await saveDraftNow({ sync: false });
    const validation = validationResult();
    if (!validation.valid) { renderPreservingScroll(message(`Hãy sửa lỗi trước khi xem trước: ${validation.errors[0]?.message}`, "error")); return; }
    Store.setPreviewYear(currentYear, draft);
    const url = activityId
      ? `activity.html?year=${currentYear}&id=${encodeURIComponent(activityId)}&preview=1`
      : `year.html?year=${currentYear}&preview=1`;
    const dialog = document.querySelector("#admin-preview-dialog");
    const frame = dialog?.querySelector("iframe");
    if (!dialog || !frame) { window.open(url, "_blank", "noopener"); return; }
    dialog.dataset.url = url;
    dialog.querySelector("#admin-preview-title").textContent = activityId ? "Xem trước hoạt động" : `Xem trước năm ${currentYear}`;
    frame.src = url;
    if (!dialog.open) dialog.showModal();
  }

  async function discardDraft() {
    if (!confirm(`Bỏ toàn bộ thay đổi chưa xuất bản của năm ${currentYear} và tải lại bản đang công khai?`)) return;
    clearTimeout(autosaveTimer);
    await Store.clearDraft(currentYear);
    dirty = false;
    pendingLocalSave = false;
    pendingActivityImages = [];
    pendingActivityForm = null;
    pendingCoverMedia = null;
    if (published) await openYear(currentYear);
    else {
      years = years.filter((year) => year !== currentYear);
      await openYear(years.at(-1));
    }
  }

  async function runUploadQueue(files, metadata, onSaved, status, cancelButton) {
    if (!files.length || uploading) return;
    const oversized = files.find((file) => file.size > Number(Store.MAX_UPLOAD_BYTES || 25 * 1024 * 1024));
    if (oversized) throw new Error(`${oversized.name} lớn hơn 25 MB. Hãy nén hoặc chọn ảnh nhỏ hơn.`);
    uploading = true;
    cancelUploads = false;
    if (cancelButton) cancelButton.hidden = false;
    updateCommandBar();
    try {
      for (let index = 0; index < files.length; index += 1) {
        if (cancelUploads) break;
        if (status) status.textContent = `Đang tối ưu và tải ảnh ${index + 1}/${files.length}: ${files[index].name}`;
        const meta = typeof metadata === "function" ? metadata(files[index], index) : metadata;
        const saved = await Store.saveMedia(files[index], { ...meta, year: currentYear, draftId: `${currentYear}:${baseRevision || "new"}` });
        await onSaved(saved, index);
      }
      if (status) status.textContent = cancelUploads ? "Đã dừng hàng đợi sau ảnh hiện tại." : `Đã tải ${files.length} ảnh vào R2 và bản nháp.`;
    } finally {
      uploading = false;
      cancelUploads = false;
      if (cancelButton) cancelButton.hidden = true;
      updateCommandBar();
    }
  }

  function allMediaSources(media) {
    if (!media) return new Set();
    const values = [media.id, sourceOf(media, "thumbnail"), sourceOf(media, "medium"), sourceOf(media, "original")].filter(Boolean).map(String);
    return new Set(values);
  }

  function sameMedia(candidate, media) {
    const left = allMediaSources(candidate);
    const right = allMediaSources(media);
    return [...left].some((value) => right.has(value));
  }

  function removeMediaReferences(media) {
    let manifestWarning = false;
    if (sameMedia(draft.overview?.coverImage, media)) draft.overview.coverImage = "";
    draft.gallery = (draft.gallery || []).filter((image) => !sameMedia(image, media));
    if (draft.galleryAlbum?.preview) draft.galleryAlbum.preview = draft.galleryAlbum.preview.filter((image) => !sameMedia(image, media));
    draft.activities = draft.activities.map((activity) => {
      const next = { ...activity };
      if (sameMedia(next.coverImage, media)) next.coverImage = "";
      if (Array.isArray(next.images)) next.images = next.images.filter((image) => !sameMedia(image, media));
      if (next.album?.preview) {
        if (next.album.preview.some((image) => sameMedia(image, media))) manifestWarning = true;
        next.album = { ...next.album, preview: next.album.preview.filter((image) => !sameMedia(image, media)) };
      }
      return next;
    });
    ROLE_KEYS.forEach((key) => {
      draft.leadership[key].members = (draft.leadership[key].members || []).map((member) => sameMedia(member.photo, media) ? { ...member, photo: "" } : member);
    });
    draft.leadership.teams = (draft.leadership.teams || []).map((team) => ({ ...team, members: team.members.map((member) => sameMedia(member.photo, media) ? { ...member, photo: "" } : member) }));
    return manifestWarning;
  }

  function mediaReferencesIn(data, media) {
    if (!data || !media) return [];
    const references = [];
    if (sameMedia(data.overview?.coverImage, media)) references.push("ảnh bìa tổng quan");
    if ((data.gallery || []).some((image) => sameMedia(image, media))) references.push("album năm");
    if ((data.galleryAlbum?.preview || []).some((image) => sameMedia(image, media))) references.push("ảnh xem trước album năm");
    (data.activities || []).forEach((activity) => {
      if (sameMedia(activity.coverImage, media)) references.push(`bìa hoạt động “${activity.title || activity.id}”`);
      if ((activity.images || []).some((image) => sameMedia(image, media))) references.push(`album hoạt động “${activity.title || activity.id}”`);
      if ((activity.album?.preview || []).some((image) => sameMedia(image, media))) references.push(`ảnh xem trước “${activity.title || activity.id}”`);
    });
    ROLE_KEYS.forEach((key) => {
      if ((data.leadership?.[key]?.members || []).some((member) => sameMedia(member.photo, media))) references.push(ROLE_LABELS[key]);
    });
    (data.leadership?.teams || []).forEach((team) => {
      if ((team.members || []).some((member) => sameMedia(member.photo, media))) references.push(team.label || team.key || "ban phụng vụ");
    });
    return [...new Set(references)];
  }

  async function restoreRevision(key) {
    const revision = revisionRegistry.get(key);
    if (!revision) return;
    if (!confirm("Khôi phục phiên bản này vào bản nháp? Bản đang công khai chưa bị thay đổi.")) return;
    try {
      const loader = Store.loadRevision || Store.loadYearRevision;
      if (!loader) throw new Error("TeresaStore chưa hỗ trợ đọc nội dung một phiên bản.");
      const restored = await loader(currentYear, revision.data ? revision : (revision.sha || revision.id || revision.revision));
      draft = Schema.normalizeYear(restored);
      await Store.saveDraft(currentYear, draft);
      dirty = !published || fingerprint(draft) !== fingerprint(published);
      editingId = "";
      renderDashboard(message("Đã khôi phục phiên bản vào bản nháp. Hãy xem trước trước khi xuất bản."));
    } catch (error) { showError(error, "Không thể đọc nội dung phiên bản"); }
  }

  function bindDashboard() {
    document.querySelectorAll("[data-year]").forEach((button) => button.addEventListener("click", async () => openYear(Number(button.dataset.year))));
    document.querySelector("#add-year")?.addEventListener("click", async () => {
      const suggested = Math.min(Store.YEAR_MAX, Math.max(...years) + 1);
      const year = Number(prompt(`Nhập năm mới (${Store.YEAR_MIN}–${Store.YEAR_MAX})`, suggested));
      if (!Number.isInteger(year)) return;
      if (year < Store.YEAR_MIN || year > Store.YEAR_MAX) { renderPreservingScroll(message(`Năm phải trong khoảng ${Store.YEAR_MIN}–${Store.YEAR_MAX}.`, "error")); return; }
      if (years.includes(year)) { await openYear(year); return; }
      years.push(year); years.sort((a, b) => a - b);
      await openYear(year, { blank: true });
    });
    document.querySelector("#logout")?.addEventListener("click", async () => { if (pendingLocalSave) await saveDraftNow(); await Store.logout(); loginView(); });
    document.querySelector("#new-activity")?.addEventListener("click", () => { syncAllForms(); editingId = ""; pendingActivityForm = null; pendingActivityImages = []; pendingCoverMedia = null; renderPreservingScroll(); document.querySelector("#activity-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    document.querySelector("#clear-activity")?.addEventListener("click", () => { editingId = ""; pendingActivityForm = null; pendingActivityImages = []; pendingCoverMedia = null; renderPreservingScroll(); });
    document.querySelectorAll("[data-edit-activity]").forEach((button) => button.addEventListener("click", () => { syncAllForms(); editingId = button.dataset.editActivity; pendingActivityImages = []; pendingCoverMedia = null; renderPreservingScroll(); document.querySelector("#activity-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    document.querySelectorAll("[data-preview-activity]").forEach((button) => button.addEventListener("click", () => previewDraft(button.dataset.previewActivity)));
    document.querySelectorAll("[data-delete-activity]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("Xóa hoạt động khỏi bản nháp? Ảnh trong R2 không bị xóa.")) return;
      draft.activities = draft.activities.filter((activity) => activity.id !== button.dataset.deleteActivity);
      if (editingId === button.dataset.deleteActivity) editingId = "";
      await saveDraftNow({ sync: false });
      dirty = true;
      renderPreservingScroll(message("Đã xóa hoạt động khỏi bản nháp. Bản công khai chưa thay đổi."));
    }));

    app.oninput = (event) => {
      if (event.target.matches("input, textarea, select") && !event.target.matches('[type="file"]')) markChanged();
    };
    document.querySelector("#overview-form")?.addEventListener("submit", async (event) => { event.preventDefault(); await saveDraftNow(); renderPreservingScroll(message("Đã lưu phần thông tin năm vào bản nháp.")); });
    document.querySelector("#members-form")?.addEventListener("submit", async (event) => { event.preventDefault(); await saveDraftNow(); renderPreservingScroll(message("Đã lưu số liệu thành viên vào bản nháp.")); });
    document.querySelector("#leadership-form")?.addEventListener("submit", async (event) => { event.preventDefault(); await saveDraftNow(); renderPreservingScroll(message("Đã lưu ban điều hành vào bản nháp.")); });

    document.querySelector("#leadership-form")?.addEventListener("click", (event) => {
      const addRole = event.target.closest("[data-add-role-member]");
      if (addRole) {
        const list = addRole.closest(".leadership-role-editor").querySelector(".team-members-list");
        if (list.querySelector(".empty-note")) list.innerHTML = "";
        list.insertAdjacentHTML("beforeend", memberRow({}, { scope: addRole.dataset.addRoleMember, index: list.children.length }));
        markChanged(); return;
      }
      const addTeamMember = event.target.closest("[data-add-team-member]");
      if (addTeamMember) {
        const list = addTeamMember.closest(".team-row").querySelector(".team-members-list");
        if (list.querySelector(".empty-note")) list.innerHTML = "";
        list.insertAdjacentHTML("beforeend", memberRow({}, { scope: "team", index: list.children.length }));
        markChanged(); return;
      }
      const removeMember = event.target.closest("[data-remove-member]");
      if (removeMember) { removeMember.closest(".team-member-editor").remove(); markChanged(); return; }
      const removeTeam = event.target.closest("[data-remove-team]");
      if (removeTeam) { removeTeam.closest(".team-row").remove(); markChanged(); }
    });
    document.querySelector("#add-team")?.addEventListener("click", () => {
      const list = document.querySelector("#teams-list");
      if (list.querySelector(".empty-note")) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", teamEditor({}, list.children.length));
      markChanged();
    });
    document.querySelector("#leadership-form")?.addEventListener("change", async (event) => {
      const input = event.target.closest(".team-member-upload");
      if (!input?.files?.[0]) return;
      if (input.files[0].size > Number(Store.MAX_UPLOAD_BYTES || 25 * 1024 * 1024)) { showError(new Error(`${input.files[0].name} lớn hơn 25 MB.`), "Không thể tải ảnh thành viên"); return; }
      const row = input.closest(".team-member-editor");
      const name = row.querySelector(".team-member-name")?.value.trim() || input.files[0].name;
      try {
        input.disabled = true;
        const saved = await Store.saveMedia(input.files[0], { year: currentYear, topic: "Cộng đoàn", caption: `Ảnh thành viên · ${name}`, alt: name, draftId: `${currentYear}:${baseRevision || "new"}` });
        row._uploadedMedia = saved;
        const src = sourceOf(saved, "original");
        row.querySelector(".team-member-photo").value = src;
        const preview = row.querySelector(".member-photo-preview");
        preview.src = sourceOf(saved, "thumbnail") || src; preview.hidden = false;
        markChanged();
      } catch (error) { showError(error, "Không thể tải ảnh thành viên"); }
      finally { input.disabled = false; }
    });

    document.querySelector("#activity-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const activity = collectActivityForm(false);
      const result = await Store.saveActivity(currentYear, activity, draft);
      draft = Schema.normalizeYear(result.data);
      editingId = result.activity.id;
      pendingActivityForm = null;
      pendingActivityImages = [];
      pendingCoverMedia = null;
      await saveDraftNow({ sync: false });
      dirty = true;
      renderPreservingScroll(message("Đã lưu hoạt động vào bản nháp. Bản công khai chưa thay đổi."));
    });
    document.querySelector("#word-import")?.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const note = document.querySelector("#word-import-note");
      try {
        document.querySelector('[name="body"]').value = await window.TeresaWord.readDocx(file);
        note.textContent = "Đã nhập đầy đủ phần văn bản. Hãy kiểm tra rồi lưu hoạt động vào bản nháp.";
        markChanged();
      } catch (error) { note.textContent = error.message; }
    });
    document.querySelector("#activity-cover")?.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > Number(Store.MAX_UPLOAD_BYTES || 25 * 1024 * 1024)) { showError(new Error(`${file.name} lớn hơn 25 MB.`), "Không thể tải ảnh bìa"); return; }
      try {
        const topic = document.querySelector('#activity-form [name="topic"]')?.value || "Khác";
        const saved = await Store.saveMedia(file, { year: currentYear, topic, activityId: editingId, caption: `Ảnh mở đầu · ${file.name}`, alt: file.name, draftId: `${currentYear}:${baseRevision || "new"}` });
        pendingCoverMedia = saved;
        const src = sourceOf(saved, "original");
        document.querySelector('#activity-form [name="coverImage"]').value = src;
        document.querySelector(".cover-picker code").textContent = src;
        document.querySelector(".cover-preview").src = sourceOf(saved, "medium") || src;
        if (editingId) {
          const activity = draft.activities.find((item) => item.id === editingId);
          if (activity) activity.coverImage = clone(saved);
          await saveDraftNow({ sync: false });
        } else markChanged();
        dirty = true; updateCommandBar();
      } catch (error) { showError(error, "Không thể tải ảnh bìa"); }
    });
    document.querySelector("#activity-images")?.addEventListener("change", async (event) => {
      const files = [...event.target.files];
      const form = event.target.closest("#activity-form");
      const status = form.querySelector("[data-upload-status]");
      const cancel = form.querySelector("[data-cancel-upload]");
      try {
        await runUploadQueue(files, () => ({ topic: form.querySelector('[name="topic"]').value || "Khác", activityId: editingId, caption: "Ảnh hoạt động", alt: "Ảnh hoạt động" }), async (saved) => {
          if (editingId) {
            const activity = draft.activities.find((item) => item.id === editingId);
            if (activity?.album?.manifest) throw new Error("Album manifest cần API cập nhật album trước khi thêm ảnh.");
            activity.images = [...(activity.images || []), saved];
          } else pendingActivityImages.push(saved);
          dirty = true;
        }, status, cancel);
        if (editingId) await saveDraftNow({ sync: false });
        renderPreservingScroll(message("Đã thêm ảnh vào hoạt động trong bản nháp."));
      } catch (error) { showError(error, "Không thể tải ảnh hoạt động"); }
    });
    document.querySelectorAll("[data-cancel-upload]").forEach((button) => button.addEventListener("click", () => { cancelUploads = true; button.disabled = true; }));
    document.querySelector("#selected-images")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-activity-media]");
      if (!button) return;
      const key = button.dataset.removeActivityMedia;
      const activity = draft.activities.find((item) => item.id === editingId);
      if (activity) activity.images = (activity.images || []).filter((image) => mediaKey(image) !== key);
      pendingActivityImages = pendingActivityImages.filter((image) => mediaKey(image) !== key);
      button.closest("span").remove();
      markChanged();
    });

    document.querySelector("#media-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const files = [...event.currentTarget.querySelector('[name="media"]').files];
      const status = event.currentTarget.querySelector("[data-upload-status]");
      const cancel = event.currentTarget.querySelector("[data-cancel-upload]");
      try {
        await runUploadQueue(files, (file) => ({ topic: formData.get("topic"), caption: formData.get("caption") || file.name, alt: formData.get("caption") || file.name }), async (saved) => {
          draft.gallery = [...(draft.gallery || []), saved];
          mediaState.items.unshift(saved);
          dirty = true;
        }, status, cancel);
        await saveDraftNow({ sync: false });
        renderPreservingScroll(message("Đã tải ảnh vào R2 và thêm vào bản nháp."));
      } catch (error) { showError(error, "Không thể tải ảnh"); }
    });
    document.querySelectorAll("[data-media-filter]").forEach((button) => button.addEventListener("click", async () => {
      syncAllForms();
      await loadMediaPage(true, button.dataset.mediaFilter, mediaState.activityId);
      renderPreservingScroll();
    }));
    document.querySelector("#media-activity-filter")?.addEventListener("change", async (event) => {
      syncAllForms();
      await loadMediaPage(true, mediaState.topic, event.currentTarget.value);
      renderPreservingScroll();
    });
    document.querySelector("#load-more-media")?.addEventListener("click", async () => {
      syncAllForms();
      await loadMediaPage(false, mediaState.topic, mediaState.activityId);
      renderPreservingScroll();
    });
    document.querySelectorAll("[data-set-cover-id]").forEach((button) => button.addEventListener("click", async () => {
      const media = mediaState.items.find((item) => mediaKey(item) === button.dataset.setCoverId);
      const activity = draft.activities.find((item) => item.id === editingId);
      if (!media || !activity) { renderPreservingScroll(message("Hãy chọn Sửa một hoạt động trước khi đặt ảnh bìa.", "error")); return; }
      activity.coverImage = clone(media);
      await saveDraftNow({ sync: false });
      dirty = true;
      renderPreservingScroll(message("Đã đặt đúng URL/biến thể ảnh làm bìa trong bản nháp."));
    }));
    document.querySelectorAll("[data-delete-media-id]").forEach((button) => button.addEventListener("click", async () => {
      const media = mediaState.items.find((item) => mediaKey(item) === button.dataset.deleteMediaId);
      if (!media) return;
      const publishedReferences = mediaReferencesIn(published, media);
      if (publishedReferences.length) {
        renderPreservingScroll(message(`Chưa thể xóa khỏi R2 vì ảnh vẫn đang được dùng trên bản công khai (${publishedReferences.join(", ")}). Hãy gỡ ảnh khỏi bản nháp, xuất bản thay đổi, rồi quay lại xóa.`, "error"));
        return;
      }
      if (!confirm("Xóa vĩnh viễn ảnh này và các kích thước liên quan khỏi R2?")) return;
      try {
        const manifestWarning = removeMediaReferences(media);
        await saveDraftNow({ sync: false });
        await Store.deleteMedia(media.id || button.dataset.deleteMediaId);
        mediaState.items = mediaState.items.filter((item) => mediaKey(item) !== mediaKey(media));
        dirty = true;
        renderPreservingScroll(message(manifestWarning ? "Đã xóa ảnh và tham chiếu preview. Album manifest vẫn cần được cập nhật trước khi xuất bản." : "Đã xóa ảnh theo media ID và loại tham chiếu khỏi bản nháp."));
      } catch (error) { showError(error, "Không thể xóa ảnh"); }
    }));

    document.querySelector("#refresh-history")?.addEventListener("click", async () => { await loadHistory(); renderPreservingScroll(); });
    document.querySelector("#audit-cover-images")?.addEventListener("click", () => auditCoverImages().catch((error) => showError(error, "Không thể kiểm tra ảnh bìa")));
    document.querySelectorAll("[data-restore-revision]").forEach((button) => button.addEventListener("click", () => restoreRevision(button.dataset.restoreRevision)));
    document.querySelector("#export-word")?.addEventListener("click", () => { syncAllForms(); window.TeresaWord.downloadWordYear(draft); });
    document.querySelector("#export-archive")?.addEventListener("click", async () => download(`teresa-archive-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await Store.exportArchive(), null, 2)));
    document.querySelector("#import-archive")?.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const analysis = Store.analyzeArchive(JSON.parse(await file.text()));
        if (!analysis.valid) throw new Error(analysis.errors[0]);
        if (!confirm(`Nhập ${analysis.summary} vào các bản nháp cục bộ? Không có dữ liệu nào được xuất bản tự động.`)) return;
        for (const yearData of analysis.years) await Store.saveDraft(yearData.year, yearData);
        years = [...new Set([...years, ...analysis.years.map((item) => Number(item.year))])].sort((a, b) => a - b);
        const currentImported = analysis.years.find((item) => Number(item.year) === currentYear);
        if (currentImported) { draft = Schema.normalizeYear(currentImported); dirty = !published || fingerprint(draft) !== fingerprint(published); }
        renderDashboard(message("Đã nhập JSON vào bản nháp. Hãy kiểm tra và xem trước từng năm trước khi xuất bản."));
      } catch (error) { showError(error, "Không thể nhập sao lưu"); }
    });
  }

  function download(filename, content) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function adminError(error) {
    commandBar.hidden = true;
    app.innerHTML = `<section class="admin-login"><div class="admin-login-card"><p class="eyebrow">Không thể mở khu quản trị</p><h1>Cần kiểm tra kết nối.</h1><p>${escapeHTML(error?.message || "Không thể đọc dữ liệu.")}</p><p>Hãy chạy website qua máy chủ cục bộ và kiểm tra Firebase/Worker.</p><button class="button button-primary" type="button" id="retry-admin">Thử lại</button></div></section>`;
    document.querySelector("#retry-admin")?.addEventListener("click", initializeDashboard);
  }

  function bindCommandBar() {
    document.querySelector("#command-save-draft")?.addEventListener("click", async () => { await saveDraftNow(); renderPreservingScroll(message("Đã lưu bản nháp trên thiết bị. Chưa xuất bản lên website.")); });
    document.querySelector("#command-preview")?.addEventListener("click", () => previewDraft());
    document.querySelector("#command-publish")?.addEventListener("click", publishDraft);
    document.querySelector("#command-discard")?.addEventListener("click", discardDraft);
  }

  function bindPreviewDialog() {
    const dialog = document.querySelector("#admin-preview-dialog");
    if (!dialog || dialog.dataset.bound) return;
    dialog.dataset.bound = "true";
    const stage = dialog.querySelector(".admin-preview-stage");
    const frame = dialog.querySelector("iframe");
    const close = () => {
      if (dialog.open) dialog.close();
      if (frame) frame.src = "about:blank";
    };
    dialog.querySelectorAll("[data-preview-device]").forEach((button) => button.addEventListener("click", () => {
      const device = button.dataset.previewDevice;
      stage.dataset.device = device;
      dialog.querySelectorAll("[data-preview-device]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    }));
    dialog.querySelector(".admin-preview-new-tab")?.addEventListener("click", () => {
      if (dialog.dataset.url) window.open(dialog.dataset.url, "_blank", "noopener");
    });
    dialog.querySelector(".admin-preview-close")?.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  }

  window.addEventListener("beforeunload", (event) => {
    if (!dirty && !pendingLocalSave && !uploading && !hasPendingNewActivity()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("DOMContentLoaded", async () => {
    bindCommandBar();
    bindPreviewDialog();
    if (!Store || !Schema) {
      adminError(new Error("Thiếu TeresaSchema hoặc TeresaStore."));
      return;
    }
    await Store.waitForAuth();
    if (Store.isAdmin()) await initializeDashboard();
    else loginView();
  });
})();
