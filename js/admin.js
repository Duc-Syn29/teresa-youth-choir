(function () {
  "use strict";

  const app = document.querySelector("#admin-app");
  const commandBar = document.querySelector("#admin-command-bar");
  const Store = window.TeresaStore;
  const Schema = window.TeresaSchema;
  const Helpers = window.TeresaAdminTools;
  const reviewedActivities = new Map();
  let uploadJob = null;
  const uploadJobs = [];
  let trashState = { items: [], cursor: "" };
  const trashBlobUrls = new Set();
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

  let activityStep = 1;
  let activeSection = "events";
  let years = [];
  let currentYear = Number(params.get("year")) || 0;
  let draft = null;
  let published = null;
  let baseRevision = "";
  let editingId = params.get("activity") || "";
  let pendingActivityForm = null;
  let pendingActivityImages = [];
  let pendingYearCover = null;
  let pendingCoverMedia = null;
  let dirty = false;
  let pendingLocalSave = false;
  let savingDraft = false;
  let busy = false;
  let uploading = false;
  let preparingUpload = false;
  let uploadControlsLocked = false;
  const uploadControlStates = new Map();
  let cancelUploads = false;
  let autosaveTimer = 0;
  let activeDraftSave = null;
  let draftSavedAt = "";
  let draftCloudStatus = "";
  let draftEditor = null;
  let historyItems = [];
  let accounts = { items: [], revision: "" };
  let publicationStatus = "";
  let noticeHTML = "";
  let activityMediaRegistry = new Map();
  let revisionRegistry = new Map();
  let mediaLoadRequest = 0;
  let mediaState = { items: [], cursor: "", truncated: false, topic: "Tất cả", activityId: "", sourceYear: 0, loading: false };
  let mediaAudit = { status: "idle", errors: [], warnings: [], checkedAt: "" };
  let draftConflict = "";
  let openYearRequest = 0;

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
    if (draftConflict) errors.unshift({ path: "draft.baseRevision", code: "draft_conflict", message: draftConflict });
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
    if (uploading || preparingUpload) {
      uploadControlsLocked = true;
      app.querySelectorAll("input, textarea, select, button").forEach((control) => {
        if (control.matches("[data-cancel-upload]")) return;
        if (!uploadControlStates.has(control)) uploadControlStates.set(control,control.disabled);
        control.disabled = true;
      });
    } else if (uploadControlsLocked) {
      uploadControlsLocked = false;
      for (const [control,disabled] of uploadControlStates) if (control.isConnected) control.disabled = disabled;
      uploadControlStates.clear();
    }
    const title = document.querySelector("#draft-status-title");
    const detail = document.querySelector("#draft-status-detail");
    const validation = validationResult();
    const pendingNew = hasPendingNewActivity();
    if (title) title.textContent = dirty || pendingNew ? `Năm ${currentYear} · Có thay đổi chưa xuất bản` : `Năm ${currentYear} · Đã đồng bộ`;
    if (detail) {
      if (uploading) detail.textContent = "Đang tải ảnh lên…";
      else if (savingDraft) detail.textContent = "Đang lưu bản nháp…";
      else if (pendingLocalSave) detail.textContent = "Đang chờ tự lưu…";
      else if (!validation.valid) detail.textContent = `${validation.errors.length} lỗi cần sửa trước khi xuất bản`;
      else if (draftSavedAt) detail.textContent = `${draftCloudStatus || "Đã lưu trên thiết bị"} · ${formatTime(draftSavedAt)}`;
      else detail.textContent = "Chưa có thay đổi";
    }
    document.querySelector("#command-save-draft")?.toggleAttribute("disabled", busy || savingDraft || uploading || preparingUpload);
    document.querySelector("#command-preview")?.toggleAttribute("disabled", busy || uploading || preparingUpload || !validation.valid);
    document.querySelector("#command-publish")?.toggleAttribute("disabled", Store.isUpgradeReady?.() === false || busy || uploading || preparingUpload || !validation.valid || (!dirty && !pendingNew));
    document.querySelector("#command-discard")?.toggleAttribute("disabled", busy || uploading || preparingUpload || (!dirty && !pendingLocalSave && !pendingNew));
    document.querySelectorAll("[data-year], #add-year, #new-activity, #clear-activity, [data-edit-activity], [data-delete-activity], #logout").forEach((button) => button.toggleAttribute("disabled", busy || savingDraft || uploading || preparingUpload));
    document.querySelectorAll('#activity-form input:not([type="file"]):not([type="checkbox"]), #activity-form textarea, #overview-form input:not([type="file"]), #overview-form textarea').forEach((input) => { input.readOnly = uploading || preparingUpload; });
    document.querySelectorAll('[data-activity-step], [data-go-step], [data-photo-move], [data-use-activity-cover], [data-use-year-cover], [data-remove-activity-media], [data-paragraph-photo]').forEach((input) => { input.disabled = uploading || preparingUpload; });
    const readyPanel = document.querySelector("#readiness-panel");
    if (readyPanel) {
      const open = readyPanel.open;
      const html = readinessPanel();
      if (readyPanel.outerHTML !== html && readyPanel.outerHTML.replace(" open=\"\"", "") !== html) { readyPanel.outerHTML = html; document.querySelector("#readiness-panel").open = open; }
    }
    document.querySelectorAll("[data-retry-upload]").forEach((button) => {
      const job = uploadJobs[Number(button.dataset.retryUpload)];
      button.disabled = busy || uploading || preparingUpload || savingDraft || pendingLocalSave || !job || job.year !== currentYear || (job.kind === "activity" && job.activityId !== editingId);
    });
    if (Store.isUpgradeReady?.() === false) {
      app.querySelectorAll('input[type="file"]:not(#word-import):not(#import-archive), #load-trash, #more-trash, #check-storage, #load-accounts, #account-form button, #compare-drafts').forEach((control) => { control.disabled = true; });
    }
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
    if (error?.status === 409 && error.message?.includes("nháp")) { draftConflict = error.message; openDraftComparison().catch(() => {}); }
    noticeHTML = message(`${prefix}: ${error?.message || error}${request}`, "error");
    renderPreservingScroll();
  }

  function loginView(note = "") {
    commandBar.hidden = true;
    const configured = Store.isFirebaseConfigured() && Store.isSourceApiConfigured();
    const cloudStatus = configured
      ? `<p class="cloud-status active">Đăng nhập bằng tài khoản được cấp cho bạn.</p>`
      : `<p class="cloud-status warning">Thiếu cấu hình Firebase hoặc Worker quản trị. Chế độ đăng nhập cục bộ không được hỗ trợ.</p>`;
    app.innerHTML = `<section class="admin-login"><div class="admin-login-card"><p class="eyebrow">Khu quản trị</p><h1>Chào người giữ ký ức.</h1><p>Đăng nhập để chuẩn bị bản nháp, xem trước rồi mới xuất bản.</p>${cloudStatus}${note}<form id="login-form"><label>Email<input name="username" type="email" autocomplete="username" required /></label><label>Mật khẩu<span class="password-control"><input name="password" type="password" autocomplete="current-password" required /><button type="button" data-password-toggle aria-label="Hiện mật khẩu">Hiện</button></span></label><button class="button button-primary" type="submit">Đăng nhập →</button></form></div></section>`;
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
    return `<div class="team-member-editor" data-member-id="${escapeHTML(data.id)}">
      <input class="team-member-name" value="${escapeHTML(data.name)}" placeholder="Tên thành viên" aria-label="Tên thành viên" />
      <input class="team-member-note" value="${escapeHTML(data.note || "")}" placeholder="Ghi chú (tùy chọn)" aria-label="Ghi chú thành viên" />
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

  function coverFocusFields(value = {}, image = "") {
    const f = window.TeresaPublic.focus(value);
    return `<fieldset class="cover-focus"><legend>Căn khung ảnh bìa</legend><p>Di chuyển để giữ đúng người hoặc chi tiết quan trọng trong khung. Dùng lại ảnh hiện có.</p>${[["Máy tính", "x", "y", "desktop"],["Điện thoại", "mobileX", "mobileY", "phone"]].map(([title,x,y,device]) => `<div class="cover-focus-device" data-focus-device="${device}"><strong>${title}</strong><img src="${escapeHTML(image || "images/optimized/hero-768.webp")}" alt="Khung ảnh ${title}" style="object-position:${f[x]}% ${f[y]}%" /><label>Trái – phải<input type="range" name="focus_${x}" min="0" max="100" value="${f[x]}" /></label><label>Trên – dưới<input type="range" name="focus_${y}" min="0" max="100" value="${f[y]}" /></label></div>`).join("")}</fieldset>`;
  }
  function collectCoverFocus(values) {
    return window.TeresaPublic.focus({x:values.focus_x,y:values.focus_y,mobileX:values.focus_mobileX,mobileY:values.focus_mobileY});
  }

  function overviewForm() {
    const overview = draft.overview || {};
    const yearMark = draft.yearMark || {};
    return `<form class="admin-form compact-form" id="overview-form"><div class="admin-form-title"><div><p class="eyebrow">Nhật ký ${currentYear}</p><h2>Thông tin năm</h2></div></div>
      <label>Nhãn giới thiệu<input name="eyebrow" value="${escapeHTML(overview.eyebrow)}" /></label>
      <label>Tiêu đề<input name="title" value="${escapeHTML(overview.title)}" required /></label>
      <label>Tóm tắt<textarea name="summary" rows="3">${escapeHTML(overview.summary)}</textarea></label>
      <label>Bài giới thiệu<textarea name="longDescription" rows="6">${escapeHTML(overview.longDescription)}</textarea></label>
      <label class="cover-upload">Chọn ảnh bìa năm<input id="year-cover" type="file" accept="image/jpeg,image/png,image/webp,image/avif,.cr2,.cr3,.nef,.nrw,.arw,.dng,.raf,.rw2,.orf,.pef,.srw" /></label><img class="year-cover-preview" src="${escapeHTML(sourceOf(overview.coverImage, "medium") || "images/hero.jpg")}" alt="Ảnh bìa năm" />${coverFocusFields(overview.coverFocus, sourceOf(overview.coverImage,"medium"))}<label hidden>Ảnh bìa<input name="coverImage" value="${escapeHTML(sourceOf(overview.coverImage, "original"))}" /></label>
      <div class="form-divider"><strong>Khung Dấu ấn</strong><small>Nội dung ngắn gọn giúp hiển thị tốt trên điện thoại.</small></div>
      <label>Tiêu đề dấu ấn<input name="yearMarkTitle" value="${escapeHTML(yearMark.title)}" /></label>
      <label>Dòng mô tả / ngày nổi bật<input name="yearMarkHighlight" value="${escapeHTML(yearMark.highlight)}" /></label>
      <button class="button" type="submit">Lưu vào bản nháp</button></form>`;
  }

  function leadershipForm() {
    const leadership = draft.leadership || Schema.normalizeLeadership({});
    return `<form class="admin-form compact-form" id="leadership-form"><div class="admin-form-title"><div><p class="eyebrow">Nhân sự ${currentYear}</p><h2>Ban điều hành</h2></div></div>
      <p class="storage-note">Mỗi người là một hàng riêng gồm tên và ghi chú. Bấm “Thêm người” để bổ sung người phụ trách.</p>
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

  function storySelection() {
    return JSON.parse(document.querySelector("#story-placement-editor [data-story-selection]")?.dataset.storySelection || "[]");
  }

  function storyPlacementEditor(activity, images) {
    const paragraphs = String(activity.body || activity.description || "").split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
    if (!paragraphs.length || !images.length) return '<p class="storage-note">Viết nội dung và thêm ảnh để chọn vị trí chèn. Chọn tối đa 3 ảnh trong bài; các ảnh khác vẫn ở album.</p>';
    return `<div data-story-selection="${escapeHTML(JSON.stringify(activity.storyPhotos || []))}"></div><h3>Ảnh trong nội dung bài viết</h3><p class="storage-note">Chọn tối đa 3 ảnh, mỗi ảnh đặt sau một đoạn. Tìm theo chú thích hoặc tên tệp; mỗi lần hiện 24 ảnh.</p><p data-story-count>${(activity.storyPhotos || []).length}/3 ảnh đã chọn</p>${paragraphs.map((paragraph, index) => `<details class="paragraph-photo-picker" data-paragraph-index="${index}"><summary>Đoạn ${index + 1}: ${escapeHTML(paragraph.slice(0,100))}${paragraph.length > 100 ? "…" : ""} · thêm ảnh</summary><label>Tìm ảnh<input type="search" data-photo-search placeholder="Chú thích hoặc tên tệp…" /></label><div class="paragraph-photo-options"></div><button class="button" type="button" data-photo-more hidden>Thêm 24 ảnh</button><p data-photo-count></p></details>`).join("")}`;
  }

  function renderParagraphPhotos(details) {
    const query = details.querySelector("[data-photo-search]").value;
    const currentImages = [...document.querySelectorAll("#selected-images [data-media-key]")].map((node) => activityMediaRegistry.get(node.dataset.mediaKey)).filter(Boolean);
    const images = Helpers.filterPhotos(currentImages, query);
    const limit = Number(details.dataset.limit || 24);
    const index = Number(details.dataset.paragraphIndex);
    const selected = storySelection();
    details.querySelector(".paragraph-photo-options").innerHTML = images.slice(0,limit).map((image) => `<label><input type="checkbox" data-paragraph-photo="${index}" value="${escapeHTML(image.id || mediaKey(image))}" ${selected.some((placement) => placement.afterParagraph === index && placement.photoId === (image.id || mediaKey(image))) ? "checked" : ""} /><img loading="lazy" src="${escapeHTML(sourceOf(image,"thumbnail"))}" alt="${escapeHTML(image.caption || image.alt || "Ảnh sự kiện")}" /><span>${escapeHTML(image.caption || image.filename || "Ảnh sự kiện")}</span></label>`).join("");
    details.querySelector("[data-photo-more]").hidden = images.length <= limit;
    details.querySelector("[data-photo-count]").textContent = images.length ? `${Math.min(limit,images.length)}/${images.length} ảnh phù hợp` : "Không tìm thấy ảnh phù hợp.";
  }

  function uploadJobPanel() {
    const jobs = uploadJobs.filter((job) => job.year === currentYear);
    if (!jobs.length) return "";
    const labels = { pending: "Chờ tải", uploading: "Đang xử lý", success: "Đã thêm", failed: "Lỗi", paused: "Đã dừng" };
    return `<section class="admin-panel upload-job-panel" id="upload-job-panel"><h2>Tiến độ thêm ảnh</h2>${jobs.map((job) => {
      const retry = job.entries.some((entry) => ["failed","paused"].includes(entry.state));
      const matches = job.kind === "gallery" || job.activityId === editingId;
      const success = job.entries.filter((entry) => entry.state === "success").length;
      return `<details ${retry || job.entries.some((entry) => entry.state === "uploading") ? "open" : ""}><summary>${escapeHTML(job.kind === "gallery" ? "Kho ảnh năm" : draft.activities.find((activity) => activity.id === job.activityId)?.title || "Sự kiện đã gỡ")} · ${success}/${job.entries.length} ảnh đã thêm</summary><ul>${job.entries.map((entry) => `<li><strong>${escapeHTML(entry.file.name)}</strong><span>${labels[entry.state]}${entry.error ? " · " + escapeHTML(entry.error) : ""}</span></li>`).join("")}</ul>${retry ? `<button class="button" type="button" data-retry-upload="${uploadJobs.indexOf(job)}" ${uploading || !matches ? "disabled" : ""}>Thử lại ảnh lỗi / chưa tải</button>` : ""}</details>`;
    }).join("")}<p class="storage-note">Ảnh thành công không tải lại. Mở đúng sự kiện để thử lại ảnh lỗi. Khi đóng trang, cần chọn lại tệp lỗi trên máy.</p></section>`;
  }

  function readinessPanel() {
    const rows = (draft.activities || []).map((activity) => ({ activity, issues: Helpers.readiness(activity, reviewedActivities.get(activity.id) === fingerprint(activity)) })).filter((row) => row.issues.length);
    return `<details class="admin-panel" id="readiness-panel"><summary>${rows.length} sự kiện cần kiểm tra / hoàn thiện</summary><p class="storage-note">Ảnh và bìa là gợi ý; bài chưa có ảnh vẫn được đăng. Dấu xem trước chỉ tính trong phiên làm việc và mất hiệu lực khi sửa bài.</p>${rows.map(({activity,issues}) => `<article class="readiness-row"><strong>${escapeHTML(activity.title || "Sự kiện chưa đặt tên")}</strong><span>${escapeHTML(issues.join(" · "))}</span><button class="text-button" type="button" data-open-readiness="${escapeHTML(activity.id)}">Mở để sửa</button></article>`).join("")}</details>`;
  }

  function helpPanel() {
    return `<details class="admin-panel admin-help"><summary>Hướng dẫn nhanh & bài mẫu</summary><ol><li>Chọn năm và thêm sự kiện. Điền tên, ngày, nội dung.</li><li>Chọn hoặc kéo ảnh vào khung. Sửa chú thích và chọn bìa từ ảnh đã có để không tải thêm bản sao.</li><li>Mở đoạn cần minh họa, tìm ảnh và chọn tối đa 3 ảnh cho bài.</li><li>Xem trước trên điện thoại. Sau đó đăng thay đổi và chờ thông báo website cập nhật.</li></ol><button class="button" type="button" id="create-practice-event">Tạo bài mẫu trong bản nháp</button><p class="storage-note">Bài mẫu có nhãn THỰC HÀNH và bị chặn đăng cho đến khi bạn đổi thành nội dung thật hoặc gỡ bài.</p></details>`;
  }

  function activityForm(activity = {}) {
    activityMediaRegistry = new Map();
    const hasManifest = Boolean(activity.album?.manifest);
    const images = hasManifest ? (activity.album.preview || []) : uniqueMedia([...(activity.images || []), ...pendingActivityImages]);
    const cover = sourceOf(pendingCoverMedia || activity.coverImage || images[0], "original");
    const imageRows = images.map((image) => {
      const key = registerActivityMedia(image);
      const thumbnail = sourceOf(image, "thumbnail") || sourceOf(image, "medium") || sourceOf(image, "original");
      const caption = image.caption || image.alt || "Ảnh hoạt động";
      const isCover = mediaKey(image) === mediaKey(pendingCoverMedia || activity.coverImage);
      return `<figure class="selected-media-card" data-media-key="${escapeHTML(key)}" data-source="${escapeHTML(sourceOf(image, "original"))}">
        <img src="${escapeHTML(thumbnail || "images/hero.jpg")}" data-media-src="${escapeHTML(thumbnail)}" alt="${escapeHTML(caption)}" loading="lazy" decoding="async" />
        <figcaption><label>Chú thích<input data-photo-caption value="${escapeHTML(image.caption || "")}" placeholder="Nội dung ảnh…" /></label><small>${escapeHTML(image.filename || "")}</small></figcaption>
        <button type="button" data-use-activity-cover="${escapeHTML(key)}">${isCover ? "✓ Bìa sự kiện" : "Bìa sự kiện"}</button><button type="button" data-use-year-cover="${escapeHTML(key)}">Bìa năm</button><div class="photo-order"><button type="button" data-photo-move="up" aria-label="Đưa ảnh lên trước">↑</button><button type="button" data-photo-move="down" aria-label="Đưa ảnh xuống sau">↓</button></div>
        ${hasManifest ? "" : `<button type="button" data-remove-activity-media="${escapeHTML(key)}" aria-label="Gỡ ảnh ${escapeHTML(caption)} khỏi sự kiện">Gỡ khỏi sự kiện</button>`}
      </figure>`;
    }).join("");
    const topic = activity.topic || activity.type || "Khác";
    return `<form class="admin-form" id="activity-form"><input type="hidden" name="id" value="${escapeHTML(activity.id || "")}" /><input type="hidden" name="coverImage" value="${escapeHTML(cover)}" />
      <div class="admin-form-title"><div><p class="eyebrow">Hoạt động</p><h2>${activity.id ? "Chỉnh sửa hoạt động" : "Thêm hoạt động"}</h2></div><button class="text-button" type="button" id="clear-activity">Tạo mục mới</button></div>
      <nav class="activity-wizard" aria-label="Các bước sửa sự kiện">${[[1,"Viết bài"],[2,"Chọn ảnh"],[3,"Xem trước & đăng"]].map(([step,label]) => `<button type="button" data-activity-step="${step}" aria-pressed="${step === activityStep}">${step}. ${label}</button>`).join("")}</nav>
      <div data-step-panel="1" ${activityStep === 1 ? "" : "hidden"}>
      ${activity.practice ? `<p class="admin-message warning">Bài THỰC HÀNH chưa được đăng.<button type="button" class="text-button" id="finish-practice">Đã đổi thành bài thật</button></p>` : ""}<div class="activity-context"><span>Năm cố định: <strong>${currentYear}</strong></span><span>Mọi thay đổi chỉ nằm trong bản nháp cho đến khi bấm Xuất bản.</span></div>
      <div class="form-grid two"><label>Tên hoạt động<input name="title" required value="${escapeHTML(activity.title || "")}" /></label><label>Ngày / thời gian<input name="date" required value="${escapeHTML(activity.date || "")}" placeholder="Ví dụ: 01.10.${currentYear}" /></label><label>Địa điểm<input name="location" value="${escapeHTML(activity.location || "")}" placeholder="Có thể để trống và bổ sung sau" /></label><label>Loại sự kiện<input name="type" required value="${escapeHTML(activity.type || "Thánh lễ")}" /></label><label>Chủ đề ảnh${topicSelect("topic", topic)}</label></div>
      <label>Giới thiệu ngắn (có thể để trống)<input name="description" value="${escapeHTML(activity.description || "")}" /></label>
      <label>Nội dung bài viết<textarea name="body" rows="7" required>${escapeHTML(activity.body || activity.description || "")}</textarea></label>
      <div class="word-import"><strong>Nhập bài viết Word</strong><input id="word-import" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /><small id="word-import-note">Chỉ nhập nội dung bài viết; năm và chủ đề không thay đổi.</small></div>
      <button class="button" type="button" data-go-step="2">Tiếp tục: chọn ảnh →</button></div>
      <div data-step-panel="2" ${activityStep === 2 ? "" : "hidden"}>
      <p class="storage-note">Chọn bìa từ ảnh đã có bên dưới: dùng lại ảnh, không tăng dung lượng.</p><div class="cover-picker"><div class="cover-picker-copy"><strong>Ảnh trang mở đầu hoạt động</strong><small>Ảnh được tự động thu nhỏ và nén trước khi tải lên.</small><code hidden>${escapeHTML(cover || "Chưa chọn")}</code></div><img class="cover-preview" data-media-src="${escapeHTML(cover)}" src="${escapeHTML(cover || "images/hero.jpg")}" alt="Xem trước ảnh trang mở đầu" /><label class="cover-upload">Thay ảnh<input id="activity-cover" type="file" accept="image/jpeg,image/png,image/webp,image/avif,.cr2,.cr3,.nef,.nrw,.arw,.dng,.raf,.rw2,.orf,.pef,.srw" /></label></div>
      ${coverFocusFields(activity.coverFocus, sourceOf(pendingCoverMedia || activity.coverImage || images[0],"medium"))}<div class="media-picker" id="activity-drop-zone"><div><strong>Kéo ảnh vào đây hoặc bấm chọn tệp</strong><p>${hasManifest ? "Album đang dùng chỉ mục riêng. Ảnh xem trước được hiển thị bên dưới; có thể quản lý toàn bộ tại Kho ảnh theo sự kiện." : `Ảnh được tải tuần tự để tránh quá tải bộ nhớ trên điện thoại. Bấm “Gỡ khỏi sự kiện” khi không muốn dùng ảnh trong bài.`}</p></div><label class="cover-upload">Chọn ảnh hoặc RAW<input id="activity-images" type="file" accept="image/jpeg,image/png,image/webp,image/avif,.cr2,.cr3,.nef,.nrw,.arw,.dng,.raf,.rw2,.orf,.pef,.srw" multiple ${hasManifest ? "disabled" : ""} /></label><button class="text-button" type="button" data-cancel-upload hidden>Dừng sau ảnh hiện tại</button><small data-upload-status></small><div id="selected-images" class="selected-media">${imageRows || '<p class="empty-note">Hoạt động này chưa có ảnh.</p>'}</div></div>
      <div id="story-placement-editor">${storyPlacementEditor(activity, images)}</div><button class="button" type="button" data-go-step="3">Tiếp tục: xem trước →</button></div>
      <div data-step-panel="3" ${activityStep === 3 ? "" : "hidden"}><p>Kiểm tra bài trên điện thoại trước khi đăng. Nút “Đăng lên website” đăng tất cả thay đổi của năm đang chọn.</p><button type="button" class="button" id="preview-current-activity">Xem trước sự kiện trên điện thoại</button><button type="button" class="button" data-go-step="1">← Sửa nội dung</button></div>
      <button class="button button-primary" type="submit">Lưu sự kiện vào bản nháp</button></form>`;
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
      return `<figure data-media-topic="${escapeHTML(item.topic || "Khác")}"><img src="${escapeHTML(thumbnail || "images/hero.jpg")}" data-media-src="${escapeHTML(thumbnail)}" alt="${escapeHTML(item.alt || item.caption || item.filename || "Ảnh tư liệu")}" loading="lazy" decoding="async" /><figcaption><strong>${escapeHTML(item.topic || "Khác")}</strong><span>${escapeHTML(item.caption || item.filename || "Ảnh tư liệu")}</span><div class="media-card-actions"><button type="button" data-reuse-media-id="${escapeHTML(id)}" ${editingId ? "" : "disabled"}>Dùng lại trong sự kiện</button><button type="button" data-set-cover-id="${escapeHTML(id)}" ${editingId ? "" : "disabled"}>Đặt làm ảnh bìa</button>${Store.adminRole?.() === "editor" ? "" : `<button type="button" data-delete-media-id="${escapeHTML(id)}" class="danger-link">Xóa khỏi kho ảnh</button>`}</div></figcaption></figure>`;
    }).join("");
    return `<section class="admin-panel media-panel"><div class="admin-form-title"><div><p class="eyebrow">Kho ảnh · bài viết năm ${currentYear}</p><h2>Ảnh theo năm và chủ đề</h2></div></div>
      <form id="media-form" class="media-upload-form"><input name="media" type="file" accept="image/jpeg,image/png,image/webp,image/avif,.cr2,.cr3,.nef,.nrw,.arw,.dng,.raf,.rw2,.orf,.pef,.srw" multiple required /><label>Chủ đề${topicSelect("topic", mediaState.topic === "Tất cả" ? "Khác" : mediaState.topic)}</label><input name="caption" placeholder="Chú thích ảnh" /><button class="button" type="submit">Thêm vào kho ảnh</button><button class="text-button" type="button" data-cancel-upload hidden>Dừng sau ảnh hiện tại</button><small data-upload-status></small></form>
      <p class="storage-note">Ảnh được nén tự động và lưu hai kích thước để tiết kiệm dung lượng. Hỗ trợ JPG, PNG, WebP, AVIF và RAW có ảnh xem trước đủ lớn. RAW được xử lý trên thiết bị; tệp RAW không tải lên R2.</p>
      ${Store.adminRole?.() === "editor" ? "" : `<button class="button" type="button" id="load-trash">Xem thùng rác</button><div id="trash-list"></div><button class="button" type="button" id="more-trash" hidden>Xem thêm</button>`}
      <button class="button" type="button" id="check-storage">Xem dung lượng ảnh năm ${currentYear}</button><p id="storage-total" role="status"></p><div id="storage-events"></div>
      <div class="media-library-controls"><label>Năm lưu ảnh<select id="media-source-year">${years.map(year => `<option value="${year}" ${Number(year) === Number(mediaState.sourceYear || currentYear) ? "selected" : ""}>${year}</option>`).join("")}</select></label><label>Sự kiện<select id="media-activity-filter" ${(mediaState.sourceYear && Number(mediaState.sourceYear) !== currentYear) ? "disabled" : ""}><option value="">Tất cả sự kiện</option>${activityOptions}</select></label><div class="media-filters">${allTopics.map((topic) => `<button type="button" class="${topic === mediaState.topic ? "active" : ""}" data-media-filter="${escapeHTML(topic)}">${escapeHTML(topic)}</button>`).join("")}</div></div>
      <div class="media-library">${cards || '<p class="empty-note">Chưa có ảnh trong trang này.</p>'}</div>
      ${mediaState.truncated ? '<button class="button" id="load-more-media" type="button">Xem thêm ảnh</button>' : ""}</section>`;
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

  function accountsPanel() {
    if (Store.adminRole?.() === "editor") return "";
    return `<section class="admin-panel"><h2>Người quản trị</h2><p>Người biên tập được viết bài, thêm ảnh và đăng bài. Quyền xóa ảnh khỏi kho thuộc chủ quản trị.</p><button type="button" class="button" id="load-accounts">Xem danh sách tài khoản</button><div id="accounts-list"></div><form id="account-form" class="admin-form"><label>Email người được bàn giao<input name="email" type="email" required /></label><label>Mật khẩu ban đầu<input name="password" type="password" minlength="10" autocomplete="new-password" /></label><label><input name="existing" type="checkbox" /> Cấp quyền cho tài khoản đã có</label><button class="button" type="submit">Tạo / cấp quyền biên tập</button><p class="storage-note">Mật khẩu không được lưu trong nhật ký. Bạn bàn giao email và mật khẩu trực tiếp cho người phụ trách.</p></form></section>`;
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
    const sections = [["events", "Sự kiện"], ["year", "Giới thiệu năm"], ["people", "Ban điều hành & ca viên"], ["photos", "Kho ảnh"], ["review", "Kiểm tra & lịch sử"]];
    app.innerHTML = `<section class="admin-shell"><div class="container"><div class="admin-heading"><div><p class="eyebrow">Quản trị nhật ký</p><h1>Nhật ký năm ${currentYear}</h1><p>Chọn năm, sửa nội dung và ảnh, xem trước rồi đăng lên website.</p></div><div class="admin-tools"><a class="button" href="year.html?year=${currentYear}" target="_blank" rel="noopener">Xem website ↗</a><button type="button" id="logout">Đăng xuất</button></div></div>
      ${Store.isUpgradeReady?.() === false ? '<p class="admin-message warning">Bản quản trị mới chưa được kích hoạt trên website. Bạn vẫn có thể chuẩn bị nội dung và xem trước; thêm ảnh mới và đăng bài sẽ mở khi cập nhật hoàn tất.</p>' : ""}${noticeHTML}${draftConflict ? '<button class="button" type="button" id="compare-drafts">Đối chiếu hai bản nháp</button>' : ""}${helpPanel()}${uploadJobPanel()}<p id="publication-status" role="status">${escapeHTML(publicationStatus)}</p><nav class="admin-years" aria-label="Chọn năm">${yearButtons}<button type="button" id="add-year">+ Thêm năm</button></nav>
      <ol class="admin-steps" aria-label="Các bước đăng bài"><li><strong>1</strong> Chọn năm & viết bài</li><li><strong>2</strong> Thêm ảnh & chọn bìa</li><li><strong>3</strong> Xem trước & đăng bài</li></ol>
      <nav class="admin-sections" aria-label="Mục quản trị">${sections.map(([key, label]) => `<button type="button" data-admin-section="${key}" aria-controls="admin-section-${key}" aria-pressed="${key === activeSection}">${label}</button>`).join("")}</nav>
      <div class="admin-section" id="admin-section-events" ${activeSection === "events" ? "" : "hidden"}>${readinessPanel()}<section class="admin-panel"><div class="admin-form-title"><div><p class="eyebrow">${draft.activities.length} sự kiện</p><h2>Sự kiện năm ${currentYear}</h2></div><button type="button" class="button button-primary" id="new-activity">+ Thêm sự kiện</button></div><label class="admin-search">Tìm sự kiện<input id="activity-search" type="search" placeholder="Nhập tên hoặc ngày…" /></label><div class="admin-activity-list">${activityRows() || '<p class="empty-note">Chưa có sự kiện. Bấm “Thêm sự kiện” để bắt đầu.</p>'}</div><p id="activity-search-empty" hidden>Không tìm thấy sự kiện phù hợp.</p></section>${activityForm(selected)}</div>
      <div class="admin-section" id="admin-section-year" ${activeSection === "year" ? "" : "hidden"}>${overviewForm()}</div>
      <div class="admin-section" id="admin-section-people" ${activeSection === "people" ? "" : "hidden"}>${leadershipForm()}${membersForm()}</div>
      <div class="admin-section" id="admin-section-photos" ${activeSection === "photos" ? "" : "hidden"}>${mediaPanel()}</div>
      <div class="admin-section" id="admin-section-review" ${activeSection === "review" ? "" : "hidden"}>${validationPanel()}${editorPanel()}${historyPanel()}${accountsPanel()}<details class="admin-panel admin-advanced"><summary>Công cụ nâng cao · sao lưu và nhập dữ liệu</summary><div class="admin-tools"><button type="button" id="export-word">Tải bài viết Word năm ${currentYear}</button><button type="button" id="export-archive">Sao lưu dữ liệu</button><label class="import-label">Khôi phục từ tệp dữ liệu<input id="import-archive" type="file" accept="application/json" /></label></div></details></div>
      <p class="storage-note">Bản nháp tự lưu; trạng thái dưới màn hình cho biết đã lưu trên máy hay đã đồng bộ. Bấm “Đăng lên website” sau khi xem trước.</p></div></section>`;
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
    return {
      ...previous,
      ...(id ? { id } : {}),
      name: row.querySelector(".team-member-name")?.value.trim() || "",
      note: row.querySelector(".team-member-note")?.value.trim() || "",
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
      coverImage: preserveMedia(draft.overview?.coverImage, values.coverImage, pendingYearCover),
      coverFocus: collectCoverFocus(values),
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
      coverFocus: collectCoverFocus(values),
      title: values.title || "",
      date: values.date || "",
      location: values.location || "",
      type: values.type || "Khác",
      topic: values.topic || values.type || "Khác",
      description: values.description || (values.body || "").trim().slice(0, 220),
      body: values.body || "",
    };
    ["x","y","mobileX","mobileY"].forEach(key => delete activity[`focus_${key}`]);
    form.querySelectorAll("[data-photo-caption]").forEach((input) => {
      const media = activityMediaRegistry.get(input.closest("[data-media-key]").dataset.mediaKey);
      if (media && typeof media === "object") { media.caption = input.value.trim(); media.alt = media.caption || media.alt; }
    });
    if (form.querySelector("#story-placement-editor")?.dataset.changed === "true" || existing.storyPhotosMode === "manual") {
      activity.storyPhotos = storySelection().filter((placement) => images.some((image) => (image.id || mediaKey(image)) === placement.photoId));
      activity.storyPhotosMode = "manual";
    }
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
    const activity = collectActivityForm(true);
    if (activity && !activity.id && [activity.title, activity.date, activity.description, activity.body].some((value) => String(value || "").trim())) {
      activity.id = `${currentYear}-activity-${Date.now().toString(36)}`;
      draft.activities.push(activity);
      editingId = activity.id;
      pendingActivityForm = null;
      pendingActivityImages = [];
      pendingCoverMedia = null;
      const idInput = document.querySelector('#activity-form [name="id"]');
      if (idInput) idInput.value = activity.id;
    }
    draft = Schema.normalizeYear(draft);
  }

  async function saveDraftNow(options = {}) {
    if (!draft) return;
    if (uploading) { clearTimeout(autosaveTimer); autosaveTimer = window.setTimeout(() => saveDraftNow(options).catch(showError), 500); return; }
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
      activeDraftSave = Store.saveDraft(currentYear, snapshot, { baseRevision, localOnly: Boolean(draftConflict) });
      const record = await activeDraftSave;
      if (!pendingLocalSave && fingerprint(draft) === fingerprint(snapshot)) draft = Schema.normalizeYear(record?.data || snapshot);
      draftSavedAt = record?.updatedAt || new Date().toISOString();
      draftEditor = record?.editor || Store.currentUser?.() || draftEditor;
      draftCloudStatus = record?.cloudSynced ? "Đã đồng bộ bản nháp" : record?.cloudError ? "Đã lưu trên máy · chưa đồng bộ" : "Đã lưu trên thiết bị";
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
    if (mediaState.loading && !reset) return;
    const requestId = ++mediaLoadRequest;
    mediaState.loading = true;
    if (reset) mediaState = { items: [], cursor: "", truncated: false, topic, activityId, sourceYear: mediaState.sourceYear, loading: true };
    try {
      const result = Store.listMedia
        ? await Store.listMedia({ year: mediaState.sourceYear || currentYear, topic: topic === "Tất cả" ? "" : topic, activityId, cursor: reset ? "" : mediaState.cursor, limit: 24 })
        : { items: await Store.getMedia({ year: currentYear, topic, activityId }), cursor: "", truncated: false };
      if (requestId !== mediaLoadRequest) return;
      const known = new Set(mediaState.items.map(mediaKey));
      mediaState.items.push(...(result.items || []).filter((item) => !known.has(mediaKey(item))));
      mediaState.cursor = result.cursor || "";
      mediaState.truncated = Boolean(result.truncated || result.cursor);
    } finally { if (requestId === mediaLoadRequest) mediaState.loading = false; }
  }

  async function openYear(year, options = {}) {
    if (uploading) return;
    if (draft && pendingLocalSave) await saveDraftNow({ sync: true });
    const requestId = ++openYearRequest;
    busy = true;
    updateCommandBar();
    clearTrashPreviews();
    trashState = { items: [], cursor: "" };
    pendingYearCover = null;
    currentYear = Number(year);
    editingId = "";
    pendingActivityForm = null;
    pendingActivityImages = [];
    pendingCoverMedia = null;
    mediaState = { items: [], cursor: "", truncated: false, topic: "Tất cả", activityId: "", sourceYear: 0, loading: false };
    mediaAudit = { status: "idle", errors: [], warnings: [], checkedAt: "" };
    draftConflict = "";
    try {
      if (options.blank) {
        published = null;
        baseRevision = "";
        draft = blankYear(currentYear);
        const record = await Store.saveDraft(currentYear, draft, { baseRevision: "" });
        draftSavedAt = record?.updatedAt || new Date().toISOString();
        draftEditor = record?.editor || Store.currentUser?.() || null;
        dirty = true;
      } else {
        const remote = await Store.loadYearForAdmin(currentYear);
        if (requestId !== openYearRequest) return;
        published = Schema.normalizeYear(remote);
        const remoteRevision = remote?._revision || remote?.meta?.revision || "";
        const local = await Store.loadDraft(currentYear);
        if (local?.conflict) draftConflict = "Bản nháp trên máy khác bản đồng bộ. Hãy đối chiếu và chọn nội dung cần giữ.";
        if (requestId !== openYearRequest) return;
        draft = Schema.normalizeYear(local?.data || published);
        if (local) {
          draft.activities = draft.activities.map((activity) => {
            if (!activity.album?.manifest) return activity;
            const remoteActivity = published.activities.find((item) => item.id === activity.id);
            if (!Array.isArray(remoteActivity?.images)) return activity;
            const expanded = { ...activity, images: clone(remoteActivity.images) };
            delete expanded.album;
            return expanded;
          });
          if (draft.galleryAlbum?.manifest && Array.isArray(published.gallery) && published.gallery.length > (draft.gallery || []).length) {
            draft.gallery = clone(published.gallery);
            delete draft.galleryAlbum;
          }
        }
        baseRevision = local ? String(local.baseRevision || "") : remoteRevision;
        if (local && !local.baseRevision && fingerprint(draft) !== fingerprint(published)) {
          draftConflict = "Bản nháp này được tạo trước khi có kiểm tra phiên bản. Hãy xuất Word/JSON để đối chiếu, hoặc bỏ bản nháp và tải lại bản công khai trước khi xuất bản.";
        }
        draftSavedAt = local?.updatedAt || "";
        draftCloudStatus = local?.cloudSynced ? "Đã đồng bộ bản nháp" : "Đã lưu trên thiết bị";
        draftEditor = local?.editor || Store.currentUser?.() || null;
        dirty = Boolean(local) && fingerprint(draft) !== fingerprint(published);
      }
      pendingLocalSave = false;
      if (requestId !== openYearRequest) return;
      await Promise.all([loadHistory(), loadMediaPage(true, "Tất cả")]);
      if (requestId !== openYearRequest) return;
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
    if (uploading || busy) return;
    syncAllForms();
    if (draft.activities.some((activity) => activity.practice)) { alert("Hãy gỡ bài mẫu THỰC HÀNH hoặc đổi thành nội dung thật trước khi đăng."); return; }
    await saveDraftNow({ sync: false });
    await auditCoverImages({ render: false });
    const validation = validationResult();
    if (!validation.valid) {
      renderPreservingScroll(message(`Chưa thể xuất bản: ${validation.errors[0]?.message || "dữ liệu chưa hợp lệ"}`, "error"));
      return;
    }
    const changed = draft.activities.filter((item) => fingerprint(item) !== fingerprint(published?.activities?.find((old) => old.id === item.id)));
    const removed = (published?.activities || []).filter((item) => !draft.activities.some((next) => next.id === item.id));
    if (!confirm(`Đăng thay đổi năm ${currentYear}:\n${changed.length} sự kiện thêm/sửa; ${removed.length} sự kiện gỡ.\n${changed.slice(0,8).map((item) => "• " + item.title).join("\n")}\nGiới thiệu, nhân sự và ảnh của năm cũng được đăng theo bản nháp. Bạn đã xem trước chưa?`)) return;
    busy = true;
    updateCommandBar();
    try {
      const saved = await Store.saveYear(draft, { baseRevision, mode: "publish" });
      try { await Store.clearDraft(currentYear); } catch (_error) { /* Preserve a concurrent draft; publication already succeeded. */ }
      const refreshed = await Store.loadYearForAdmin(currentYear);
      published = Schema.normalizeYear(refreshed);
      draft = Schema.normalizeYear(refreshed);
      baseRevision = refreshed?._revision || saved?._revision || saved?.meta?.revision || "";
      draftConflict = "";
      dirty = false;
      pendingLocalSave = false;
      draftSavedAt = "";
      await loadHistory();
      const postedYear = currentYear;
      publicationStatus = `Đã gửi thay đổi năm ${postedYear}. Website đang cập nhật…`;
      renderDashboard(message("Đã lưu nội dung đã đăng."));
      Store.waitForPublished?.(saved).then((ready) => {
        publicationStatus = ready ? `Website đã cập nhật xong năm ${postedYear}.` : `Đã gửi thay đổi năm ${postedYear}; chưa xác nhận được website cập nhật. Có thể xem lại sau ít phút.`;
        const status = document.querySelector("#publication-status"); if (status) status.textContent = publicationStatus;
      }).catch(() => {});
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
    if (activityId) { const activity = draft.activities.find((item) => item.id === activityId); if (activity) reviewedActivities.set(activityId, fingerprint(activity)); }
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

  function refreshUploadJobPanel() {
    const html = uploadJobPanel();
    const panel = document.querySelector("#upload-job-panel");
    if (panel) panel.outerHTML = html;
    else if (html) document.querySelector("#publication-status")?.insertAdjacentHTML("beforebegin", html);
  }

  async function runUploadQueue(files, metadata, onSaved, status, cancelButton, options = {}) {
    if (!files.length || uploading || preparingUpload) return;
    syncAllForms();
    preparingUpload = true; updateCommandBar();
    try { await saveDraftNow({ sync: false }); }
    finally { preparingUpload = false; updateCommandBar(); }
    if (!options.retry) {
      const kind = status?.closest("form")?.id === "media-form" ? "gallery" : "activity";
      uploadJob = { year: currentYear, activityId: kind === "gallery" ? "" : editingId, kind, metadata, onSaved, entries: files.map((file) => ({ file, state: "pending", error: "" })) };
      uploadJobs.push(uploadJob);
    }
    const job = uploadJob;
    if (job.year !== currentYear || (job.kind === "activity" && job.activityId !== editingId)) throw new Error("Hãy mở lại đúng năm và sự kiện đang tải.");
    uploading = true;
    cancelUploads = false;
    const context = { year: currentYear, draft, editingId: job.activityId, baseRevision, pendingImages: pendingActivityImages };
    const entries = options.retry ? job.entries.filter((entry) => ["failed","paused"].includes(entry.state)) : job.entries;
    if (cancelButton) cancelButton.hidden = false;
    updateCommandBar();
    try {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (cancelUploads) { if (entry.state !== "success") entry.state = "paused"; continue; }
        entry.state = "uploading"; entry.error = "";
        refreshUploadJobPanel();
        if (status) status.textContent = `Đang xử lý ảnh ${index + 1}/${entries.length}: ${entry.file.name}`;
        try {
          if (entry.file.size > Number(Store.inputLimit?.(entry.file) || Store.MAX_UPLOAD_BYTES)) throw new Error("Tệp vượt giới hạn. Hãy xuất JPG nhỏ hơn.");
          entry.meta ||= typeof job.metadata === "function" ? job.metadata(entry.file, index, context) : job.metadata;
          const saved = await Store.saveMedia(entry.file, { ...entry.meta, year: context.year, draftId: `${context.year}:${context.baseRevision || "new"}` });
          await job.onSaved(saved, index, context);
          entry.state = "success";
          entry.storedBytes = saved.reused ? 0 : saved.compression?.storedBytes || 0;
        } catch (error) { entry.state = "failed"; entry.error = error.message || "Không tải được ảnh."; }
        refreshUploadJobPanel();
      }
      const success = job.entries.filter((entry) => entry.state === "success");
      const failed = job.entries.filter((entry) => entry.state === "failed").length;
      const paused = job.entries.filter((entry) => entry.state === "paused").length;
      const bytes = success.reduce((sum,entry) => sum + (entry.storedBytes || 0),0);
      if (status) status.textContent = `Đã thêm ${success.length}/${job.entries.length} ảnh · ${failed} lỗi · ${paused} chưa tải · ${(bytes / 1048576).toFixed(2)} MB lưu thêm trên R2.`;
    } finally {
      uploading = false; cancelUploads = false;
      if (cancelButton) cancelButton.hidden = true;
      updateCommandBar(); refreshUploadJobPanel();
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
      await Store.saveDraft(currentYear, draft, { baseRevision });
      dirty = !published || fingerprint(draft) !== fingerprint(published);
      editingId = "";
      renderDashboard(message("Đã khôi phục phiên bản vào bản nháp. Hãy xem trước trước khi xuất bản."));
    } catch (error) { showError(error, "Không thể đọc nội dung phiên bản"); }
  }

  function clearTrashPreviews() {
    for (const url of trashBlobUrls) URL.revokeObjectURL(url);
    trashBlobUrls.clear();
  }

  async function loadTrashView(reset = true) {
    const year = currentYear;
    if (reset) { clearTrashPreviews(); trashState = { items: [], cursor: "" }; }
    const result = await Store.listTrash(year, reset ? "" : trashState.cursor);
    if (year !== currentYear) return;
    const known = new Set(trashState.items.map((item) => item.key));
    trashState.items.push(...result.items.filter((item) => !known.has(item.key)));
    trashState.cursor = result.cursor || "";
    const target = document.querySelector("#trash-list");
    if (!target) return;
    target.innerHTML = `<h3>Ảnh trong thùng rác</h3><p class="storage-note">Khôi phục ảnh vào kho rồi chọn lại trong bài. Ngày hiển thị là hạn giữ tối thiểu; hiện chưa tự động xóa ảnh quá hạn.</p><div class="trash-grid">${trashState.items.map((item,index) => `<figure><img data-trash-index="${index}" alt="${escapeHTML(item.caption)}" /><figcaption><strong>${escapeHTML(item.caption)}</strong><span>Gỡ lúc ${escapeHTML(formatDateTime(item.deletedAt))}</span><span>${item.retainUntil ? `Giữ ít nhất đến ${escapeHTML(formatDateTime(item.retainUntil))}` : "Chưa rõ ngày gỡ"}</span><button class="button" type="button" data-restore-trash="${escapeHTML(item.key)}">Khôi phục vào kho</button></figcaption></figure>`).join("") || '<p>Trang này chưa có ảnh. Nếu còn trang tiếp theo, bấm “Xem thêm”.</p>'}</div>`;
    document.querySelector("#more-trash").hidden = !trashState.cursor;
    let next = 0;
    const preview = async () => {
      while(next < trashState.items.length && currentYear === year) {
        const index = next++; const item = trashState.items[index];
        const image = target.querySelector(`[data-trash-index="${index}"]`);
        if (!image) continue;
        try { const url = await Store.trashPreview(item.thumbnailKey || item.key); if (!image.isConnected || currentYear !== year) { URL.revokeObjectURL(url); continue; } trashBlobUrls.add(url); image.src = url; }
        catch (_error) { image.alt = `${item.caption} · không có ảnh xem trước`; }
      }
    };
    await Promise.all(Array.from({length:Math.min(4,trashState.items.length)},preview));
  }

  async function previewMediaDeletion(media) {
    syncAllForms();
    let dialog = document.querySelector("#media-delete-dialog");
    if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "media-delete-dialog"; dialog.className = "admin-action-dialog"; document.body.append(dialog); }
    dialog.innerHTML = '<h2>Kiểm tra trước khi xóa</h2><p>Đang tìm nơi sử dụng ảnh…</p>';
    dialog.showModal();
    try {
      const report = await Store.mediaReferences(media.id || mediaKey(media));
      const backups = await Store.localRevisions(currentYear);
      const localReferences = backups.filter((backup) => mediaReferencesIn(backup.data,media).length).map((backup) => ({ label: `Bản khôi phục trên thiết bị này · ${formatDateTime(backup.timestamp)}` }));
      const references = [...report.references, ...localReferences, ...mediaReferencesIn(draft,media).map((label) => ({ label: `Bản nháp trên máy · ${label}` }))];
      dialog.innerHTML = `<h2>Xem trước thao tác xóa</h2><img class="delete-photo-preview" src="${escapeHTML(sourceOf(media,"thumbnail"))}" alt="${escapeHTML(media.caption || "Ảnh sẽ gỡ")}" /><p>${escapeHTML(media.caption || media.filename || "Ảnh tư liệu")}</p><p>${report.variants} tệp / biến thể · ${(report.bytes / 1048576).toFixed(2)} MB</p>${references.length ? `<p>Ảnh còn được dùng. Hãy gỡ tham chiếu và đăng thay đổi trước khi xóa.</p><ul>${references.map((reference) => `<li>${escapeHTML(reference.label)}</li>`).join("")}</ul>` : '<p>Chưa tìm thấy tham chiếu trong dữ liệu công khai, bản nháp đồng bộ và lịch sử đang giữ. Xóa sẽ chuyển ảnh vào thùng rác.</p>'}<p id="media-delete-error" role="status"></p><button class="button" type="button" data-close-delete>Giữ ảnh · đóng</button><button class="button button-primary" type="button" id="confirm-media-delete" ${references.length ? "disabled" : ""}>Chuyển ảnh vào thùng rác</button>`;
      dialog.querySelector("[data-close-delete]").onclick = () => dialog.close();
      dialog.querySelector("#confirm-media-delete").onclick = async (event) => {
        const button = event.currentTarget; button.disabled = true;
        try { await Store.deleteMedia(media.id || mediaKey(media)); mediaState.items = mediaState.items.filter((item) => mediaKey(item) !== mediaKey(media)); dialog.close(); renderPreservingScroll(message("Đã chuyển ảnh vào thùng rác. Có thể khôi phục trong Kho ảnh.")); }
        catch (error) { dialog.querySelector("#media-delete-error").textContent = error.message; button.disabled = false; }
      };
    } catch (error) { dialog.close(); showError(error,"Chưa xác minh được việc xóa ảnh"); }
  }

  async function openDraftComparison() {
    if (!draft || uploading) return;
    syncAllForms();
    let dialog = document.querySelector("#draft-compare-dialog");
    if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "draft-compare-dialog"; dialog.className = "admin-action-dialog"; document.body.append(dialog); }
    dialog.innerHTML = '<h2>Đối chiếu bản nháp</h2><p>Đang lấy phiên bản mới nhất…</p>';
    if (!dialog.open) dialog.showModal();
    let comparison;
    try { comparison = await Store.draftComparison(currentYear, clone(draft), baseRevision); } catch(error) { dialog.close(); throw error; }
    if (!dialog.open) return;
    const blocks = Helpers.draftBlocks(comparison.local.data, comparison.remote.data);
    const full = (value) => {
      if (value === undefined) return "<p>Đã gỡ ở bản này.</p>";
      if (value === null) return "<p>Chưa có thông tin.</p>";
      if (typeof value !== "object") return `<pre>${escapeHTML(String(value))}</pre>`;
      if (Array.isArray(value)) return value.map(full).join("");
      const photo = sourceOf(value,"thumbnail");
      if (photo) return `<figure><img class="delete-photo-preview" loading="lazy" src="${escapeHTML(photo)}" alt="${escapeHTML(value.caption || value.alt || "Ảnh")}" /><figcaption>${escapeHTML(value.caption || value.filename || value.alt || "Ảnh")}</figcaption></figure>`;
      const labels = { title:"Tên / tiêu đề", date:"Ngày", location:"Địa điểm", description:"Giới thiệu", body:"Nội dung", summary:"Tóm tắt", name:"Tên", note:"Ghi chú", notes:"Ghi chú", images:"Ảnh", members:"Thành viên", total:"Tổng ca viên", new:"Thêm mới", inactive:"Nghỉ", coverImage:"Ảnh bìa", longDescription:"Bài giới thiệu", type:"Loại sự kiện", topic:"Chủ đề", teams:"Các ban", eyebrow:"Nhãn giới thiệu", year:"Năm", highlight:"Dấu ấn", photo:"Ảnh", practice:"Bài thực hành", ...ROLE_LABELS };
      return Object.entries(value).filter(([key])=>!['id','schemaVersion','meta','variants','src','original','medium','thumbnail','compression','album','storyPhotos','storyPhotosMode'].includes(key)).map(([key,item])=>`<div><strong>${escapeHTML(labels[key] || key)}</strong>${full(item)}</div>`).join("");
    };
    const brief = (value) => {
      if (value === undefined) return "Mục này đã được gỡ ở bản này.";
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return `${value.length} mục · ` + value.slice(0,6).map((item) => item?.title || item?.name || item?.caption || item?.filename || (typeof item === "string" ? item : "Ảnh / nội dung")).join(" · ");
      return [value.title,value.summary,value.description,value.body,value.notes,value.highlight,value.name,Array.isArray(value.images) ? `${value.images.length} ảnh` : ""].filter(Boolean).join("\n") || "Thông tin nhân sự / số liệu của năm. Xem bản đầy đủ trước khi chọn.";
    };
    dialog.innerHTML = `<form id="compare-form"><h2>Chọn bản nháp cần giữ</h2><p>Chọn từng mục khác nhau. Với sự kiện, lựa chọn giữ trọn nội dung và ảnh của sự kiện đó. Hai bản được lưu vào lịch sử trên máy trước khi kết hợp.</p><div class="compare-blocks">${blocks.map((block,index) => `<fieldset><legend>${escapeHTML(block.label)}</legend><div class="compare-options">${["local","remote"].map((side) => `<label><input type="radio" name="block-${index}" value="${side}" required /><strong>${side === "local" ? "Bản trên máy này" : "Bản đồng bộ / công khai"}</strong><pre>${escapeHTML(brief(block[side]).slice(0,1400))}</pre></label>`).join("")}</div><details><summary>Xem đầy đủ hai bản của mục này</summary><div class="compare-options">${["local","remote"].map((side) => `<div>${full(block[side])}</div>`).join("")}</div></details></fieldset>`).join("") || '<p>Hai bản có nội dung giống nhau. Bạn có thể xác nhận đồng bộ.</p>'}</div><p id="compare-error" role="status"></p><button class="button button-primary" type="submit">Giữ lựa chọn và đồng bộ</button><button class="button" type="button" data-close-compare>Để xem lại sau</button></form>`;
    dialog.querySelector("[data-close-compare]").onclick = () => dialog.close();
    dialog.querySelector("form").onsubmit = async (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      const choices = Object.fromEntries(blocks.map((block,index) => [block.id,values[`block-${index}`]]));
      const merged = Helpers.mergeDraft(comparison.local.data, comparison.remote.data, choices);
      const button = dialog.querySelector('[type="submit"]'); button.disabled = true;
      try {
        const record = await Store.resolveDraftComparison(currentYear, merged, comparison);
        if (!record.cloudSynced) throw new Error(record.cloudError || "Bản kết hợp đã lưu trên máy; chưa đồng bộ được. Hãy thử lại.");
        draft = Schema.normalizeYear(record.data); baseRevision = record.baseRevision; draftConflict = "";
        dirty = fingerprint(draft) !== fingerprint(published); draftSavedAt = record.updatedAt; draftCloudStatus = "Đã đồng bộ bản nháp";
        dialog.close(); await loadHistory(); renderPreservingScroll(message("Đã kết hợp bản nháp theo lựa chọn của bạn. Hãy xem trước trước khi đăng."));
      } catch (error) { dialog.querySelector("#compare-error").textContent = error.message; }
      finally { button.disabled = false; }
    };
    if (!dialog.open) dialog.showModal();
  }

  function bindDashboard() {
    document.querySelector("#load-trash")?.addEventListener("click", async (event) => { const button = event.currentTarget; button.disabled = true; try { await loadTrashView(true); } catch(error) { showError(error,"Không mở được thùng rác"); } finally { button.disabled = false; } });
    document.querySelector("#more-trash")?.addEventListener("click", async (event) => { const button = event.currentTarget; button.disabled = true; try { await loadTrashView(false); } catch(error) { showError(error); } finally { button.disabled = false; } });
    document.querySelector("#trash-list")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-restore-trash]"); if (!button) return;
      button.disabled = true;
      try { await Store.restoreTrash(button.dataset.restoreTrash); await loadMediaPage(true); await loadTrashView(true); document.querySelector("#trash-list").insertAdjacentHTML("afterbegin", message("Đã khôi phục ảnh vào kho. Chọn lại ảnh nếu muốn đưa vào bài.")); }
      catch(error) { button.disabled = false; document.querySelector("#trash-list").insertAdjacentHTML("afterbegin", message(error.message,"error")); }
    });
    document.querySelector("#compare-drafts")?.addEventListener("click", () => openDraftComparison().catch(showError));
    if (!app.dataset.queueBound) {
      app.dataset.queueBound = "true";
      app.addEventListener("click", async (event) => {
        const readiness = event.target.closest("[data-open-readiness]");
        if (readiness) { [...document.querySelectorAll(".admin-activity-list [data-edit-activity]")].find((button) => button.dataset.editActivity === readiness.dataset.openReadiness)?.click(); return; }
        const retry = event.target.closest("[data-retry-upload]");
        if (!retry || uploading || preparingUpload || savingDraft || pendingLocalSave || !uploadJobs[Number(retry.dataset.retryUpload)]) return;
        uploadJob = uploadJobs[Number(retry.dataset.retryUpload)];
        const status = document.querySelector(uploadJob.kind === "gallery" ? '#media-form [data-upload-status]' : '#activity-form [data-upload-status]');
        try { await runUploadQueue(uploadJob.entries.map((entry) => entry.file), uploadJob.metadata, uploadJob.onSaved, status, null, { retry: true }); await saveDraftNow({ sync: false }); renderPreservingScroll(message(status?.textContent || "Đã thử lại ảnh lỗi.")); }
        catch (error) { showError(error, "Không thể thử lại"); }
      });
    }
    document.querySelector("#create-practice-event")?.addEventListener("click", async () => {
      syncAllForms();
      const activity = { id: `${currentYear}-practice-${Date.now().toString(36)}`, practice: true, title: "[THỰC HÀNH] Sự kiện mẫu", date: String(currentYear), type: "Khác", topic: "Khác", description: "Bài mẫu để tập thao tác, chưa phải sự kiện thật.", body: "Đoạn mở đầu: giới thiệu sự kiện, thời gian và ý nghĩa.\nĐoạn nội dung: kể lại hoạt động và những khoảnh khắc đáng nhớ.\nĐoạn kết: lời cảm ơn và cảm nhận của ca đoàn.", images: [] };
      draft.activities.push(activity); editingId = activity.id; activityStep = 1; activeSection = "events";
      pendingActivityImages = []; pendingCoverMedia = null; pendingActivityForm = null; dirty = true;
      await saveDraftNow({ sync: false }); renderDashboard(message("Đã tạo bài THỰC HÀNH trong bản nháp. Bài này chưa được phép đăng."));
      document.querySelector("#activity-form")?.scrollIntoView({ behavior: "smooth" });
    });
    document.querySelector("#finish-practice")?.addEventListener("click", () => {
      syncAllForms(); const activity = draft.activities.find((item) => item.id === editingId);
      if (!activity) return;
      if (/THỰC HÀNH/i.test(activity.title) || activity.body.includes("Đoạn mở đầu: giới thiệu sự kiện, thời gian và ý nghĩa.")) { alert("Hãy thay tên và nội dung mẫu bằng sự kiện thật trước."); return; }
      if (!confirm("Bạn đã thay bài mẫu bằng nội dung sự kiện thật?")) return;
      delete activity.practice; markChanged(); renderPreservingScroll();
    });
    const displayAccounts = () => {
      document.querySelector("#accounts-list").innerHTML = accounts.items.map((item) => `<p>${escapeHTML(item.email)} <button type="button" class="text-button" data-revoke-account="${escapeHTML(item.email)}">Gỡ quyền biên tập</button></p>`).join("") || "<p>Chưa có người biên tập được thêm tại đây.</p>";
    };
    document.querySelector("#load-accounts")?.addEventListener("click", async () => { try { accounts = await Store.listAccounts(); displayAccounts(); } catch (error) { showError(error); } });
    document.querySelector("#account-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
      try { accounts = await Store.listAccounts(); accounts = await Store.changeAccount({ ...values, existing: values.existing === "on" }, accounts.revision); form.reset(); displayAccounts(); }
      catch (error) { showError(error, "Chưa cấp được quyền"); }
    });
    document.querySelector("#accounts-list")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-revoke-account]"); if (!button || !confirm(`Gỡ quyền quản trị của ${button.dataset.revokeAccount}?`)) return;
      try { accounts = await Store.changeAccount({ email: button.dataset.revokeAccount }, accounts.revision, true); displayAccounts(); } catch (error) { showError(error); }
    });
    document.querySelector("#check-storage")?.addEventListener("click", async (event) => {
      const button = event.currentTarget; const output = document.querySelector("#storage-total"); button.disabled = true; output.textContent = "Đang tính dung lượng…";
      try {
        const result = await Store.mediaStats(currentYear);
        output.textContent = `${result.photos ?? "—"} ảnh độc lập · ${result.objects} tệp / biến thể · ${(result.bytes / 1048576).toFixed(2)} MB`;
        document.querySelector("#storage-events").innerHTML = `<p class="storage-note">Dung lượng từng sự kiện tính cả bìa và ảnh album; ảnh dùng chung có thể xuất hiện ở nhiều dòng. Tổng của năm chỉ tính mỗi tệp một lần. Không cộng các dòng để tính tổng R2.</p><div class="storage-table-wrap"><table><thead><tr><th>Sự kiện</th><th>Ảnh / biến thể</th><th>Dung lượng dùng</th></tr></thead><tbody>${draft.activities.map((activity) => {
          const total=Helpers.eventStorage(activity,result.assets || [],sourceOf);
          return `<tr><td>${escapeHTML(activity.title)}${total.partial ? " (mới tính ảnh xem trước)" : ""}${total.unmatched ? ` · Chưa tính ${total.unmatched} ảnh ngoài kho của năm này` : ""}</td><td>${total.photos} / ${total.variants}</td><td>${(total.bytes / 1048576).toFixed(2)} MB</td></tr>`;
        }).join("")}</tbody></table></div>`;
      }
      catch (error) { output.textContent = error.message; }
      finally { button.disabled = false; }
    });
    const showStep = (step) => {
      activityStep = Number(step);
      if (uploading || preparingUpload || savingDraft) return;
      if (activityStep > 1) {
        const body = document.querySelector('#activity-form [name="body"]');
        const missing = ["title", "date", "body"].map((name) => document.querySelector(`#activity-form [name="${name}"]`)).find((input) => !input.value.trim());
        if (missing) { activityStep = 1; document.querySelectorAll("[data-step-panel]").forEach((panel) => { panel.hidden = panel.dataset.stepPanel !== "1"; }); missing.focus(); missing.reportValidity(); return; }
        const activity = collectActivityForm();
        const images = [...document.querySelectorAll("#selected-images [data-media-key]")].map((node) => activityMediaRegistry.get(node.dataset.mediaKey));
        const editor = document.querySelector("#story-placement-editor");
        const changed = editor.dataset.changed;
        editor.innerHTML = storyPlacementEditor(activity, images);
        if (changed) editor.dataset.changed = changed;
      }
      document.querySelectorAll("[data-step-panel]").forEach((panel) => { panel.hidden = Number(panel.dataset.stepPanel) !== activityStep; });
      document.querySelectorAll("[data-activity-step]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.activityStep) === activityStep)));
    };
    document.querySelectorAll("[data-activity-step], [data-go-step]").forEach((button) => button.addEventListener("click", () => showStep(button.dataset.activityStep || button.dataset.goStep)));
    document.querySelector("#preview-current-activity")?.addEventListener("click", async () => { syncAllForms(); await previewDraft(editingId); });
    document.querySelectorAll(".cover-focus input").forEach(input => input.addEventListener("input", () => {
      const panel = input.closest("[data-focus-device]");
      const fields = [...panel.querySelectorAll("input")];
      panel.querySelector("img").style.objectPosition = `${fields[0].value}% ${fields[1].value}%`;
    }));
    const placementEditor = document.querySelector("#story-placement-editor");
    placementEditor?.addEventListener("toggle", (event) => { if (event.target.matches("[data-paragraph-index]") && event.target.open) renderParagraphPhotos(event.target); }, true);
    placementEditor?.addEventListener("input", (event) => { if (event.target.matches("[data-photo-search]")) { const details = event.target.closest("details"); details.dataset.limit = "24"; renderParagraphPhotos(details); } });
    placementEditor?.addEventListener("click", (event) => { if (event.target.matches("[data-photo-more]")) { const details=event.target.closest("details"); details.dataset.limit = String(Number(details.dataset.limit || 24) + 24); renderParagraphPhotos(details); } });
    placementEditor?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-paragraph-photo]");
      if (!input) return;
      let selected = storySelection();
      if (input.checked && (selected.length >= 3 || selected.some((item) => item.photoId === input.value))) { input.checked = false; alert("Chọn tối đa 3 ảnh; mỗi ảnh chỉ chèn một lần."); return; }
      selected = input.checked ? [...selected, { afterParagraph: Number(input.dataset.paragraphPhoto), photoId: input.value }] : selected.filter((item) => !(item.photoId === input.value && item.afterParagraph === Number(input.dataset.paragraphPhoto)));
      placementEditor.querySelector("[data-story-selection]").dataset.storySelection = JSON.stringify(selected);
      placementEditor.querySelector("[data-story-count]").textContent = `${selected.length}/3 ảnh đã chọn`;
      placementEditor.dataset.changed = "true";
      markChanged();
    });
    document.querySelectorAll("[data-use-year-cover]").forEach((button) => button.addEventListener("click", () => {
      pendingYearCover = clone(activityMediaRegistry.get(button.dataset.useYearCover));
      document.querySelector('#overview-form [name="coverImage"]').value = sourceOf(pendingYearCover);
      document.querySelector(".year-cover-preview").src = sourceOf(pendingYearCover,"medium");
      button.textContent = "✓ Bìa năm";
      document.querySelectorAll("#overview-form .cover-focus img").forEach(img => { img.src = sourceOf(pendingYearCover,"medium"); });
      markChanged();
    }));
    document.querySelector("#selected-images")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-photo-move]");
      if (!button) return;
      const card = button.closest("[data-media-key]");
      if (button.dataset.photoMove === "up" && card.previousElementSibling) card.previousElementSibling.before(card);
      if (button.dataset.photoMove === "down" && card.nextElementSibling) card.nextElementSibling.after(card);
      markChanged();
    });
    const dropZone = document.querySelector("#activity-drop-zone");
    dropZone?.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("drag-active"); });
    dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("drag-active"));
    dropZone?.addEventListener("drop", (event) => {
      event.preventDefault(); dropZone.classList.remove("drag-active");
      const input = document.querySelector("#activity-images");
      if (uploading || input.disabled) return;
      input.files = event.dataTransfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    document.querySelectorAll("[data-use-activity-cover]").forEach((button) => button.addEventListener("click", () => {
      const media = activityMediaRegistry.get(button.dataset.useActivityCover);
      if (!media) return;
      pendingCoverMedia = clone(media);
      document.querySelector('#activity-form [name="coverImage"]').value = sourceOf(media);
      document.querySelector(".cover-preview").src = sourceOf(media, "medium");
      document.querySelectorAll("#activity-form .cover-focus img").forEach(img => { img.src = sourceOf(media,"medium"); });
      markChanged();
      document.querySelectorAll("[data-use-activity-cover]").forEach((item) => { item.textContent = item === button ? "✓ Bìa sự kiện" : "Bìa sự kiện"; });
    }));
    document.querySelector("#year-cover")?.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file || uploading) return;
      try {
        uploading = true; updateCommandBar(); event.target.disabled = true;
        const saved = await Store.saveMedia(file, { year: currentYear, topic: "Cộng đoàn", caption: `Ảnh bìa năm ${currentYear}`, purpose: "cover", draftId: `${currentYear}:${baseRevision || "new"}` });
        pendingYearCover = saved;
        document.querySelector('#overview-form [name="coverImage"]').value = sourceOf(saved);
        document.querySelector(".year-cover-preview").src = sourceOf(saved, "medium");
        document.querySelectorAll("#overview-form .cover-focus img").forEach(img => { img.src = sourceOf(saved,"medium"); });
        draft.overview.coverImage = clone(saved);
        markChanged();
      } catch (error) { showError(error, "Không thể thêm ảnh bìa năm"); }
      finally { uploading = false; event.target.disabled = false; updateCommandBar(); }
    });
    document.querySelectorAll("[data-admin-section]").forEach((button) => button.addEventListener("click", () => {
      activeSection = button.dataset.adminSection;
      document.querySelectorAll(".admin-section").forEach((section) => { section.hidden = section.id !== `admin-section-${activeSection}`; });
      document.querySelectorAll("[data-admin-section]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    }));
    document.querySelector("#activity-search")?.addEventListener("input", (event) => {
      const query = event.target.value.trim().toLocaleLowerCase("vi");
      let count = 0;
      document.querySelectorAll(".admin-activity-row").forEach((row) => {
        row.hidden = !row.textContent.toLocaleLowerCase("vi").includes(query);
        if (!row.hidden) count += 1;
      });
      document.querySelector("#activity-search-empty").hidden = count > 0;
    });
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
    document.querySelector("#new-activity")?.addEventListener("click", () => { activityStep = 1; syncAllForms(); editingId = ""; pendingActivityForm = null; pendingActivityImages = []; pendingCoverMedia = null; renderPreservingScroll(); document.querySelector("#activity-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    document.querySelector("#clear-activity")?.addEventListener("click", () => { activityStep = 1; syncAllForms(); editingId = ""; pendingActivityForm = null; pendingActivityImages = []; pendingCoverMedia = null; renderPreservingScroll(); });
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
      if (event.target.matches("input, textarea, select") && !event.target.matches('[type="file"], [data-photo-search], #media-source-year, #media-activity-filter, #activity-search')) markChanged();
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
      if (!file || uploading) return;
      if (file.size > Number(Store.inputLimit?.(file) || Store.MAX_UPLOAD_BYTES || 25 * 1024 * 1024)) { showError(new Error(`${file.name} vượt giới hạn tải lên.`), "Không thể tải ảnh bìa"); return; }
      syncAllForms();
      const uploadYear = currentYear;
      const uploadRevision = baseRevision;
      const uploadEditingId = editingId;
      const uploadDraft = draft;
      try {
        uploading = true;
        event.target.disabled = true;
        updateCommandBar();
        const topic = document.querySelector('#activity-form [name="topic"]')?.value || "Khác";
        const saved = await Store.saveMedia(file, { year: uploadYear, topic, activityId: uploadEditingId, caption: `Ảnh mở đầu · ${file.name}`, alt: file.name, purpose: "cover", draftId: `${uploadYear}:${uploadRevision || "new"}` });
        pendingCoverMedia = saved;
        const src = sourceOf(saved, "original");
        document.querySelector('#activity-form [name="coverImage"]').value = src;
        document.querySelector(".cover-picker code").textContent = src;
        document.querySelector(".cover-preview").src = sourceOf(saved, "medium") || src;
        document.querySelectorAll("#activity-form .cover-focus img").forEach(img => { img.src = sourceOf(saved,"medium"); });
        if (uploadEditingId) {
          const activity = uploadDraft.activities.find((item) => item.id === uploadEditingId);
          if (activity) activity.coverImage = clone(saved);
          await saveDraftNow({ sync: false });
        } else markChanged();
        dirty = true; updateCommandBar();
      } catch (error) { showError(error, "Không thể tải ảnh bìa"); }
      finally { uploading = false; event.target.disabled = false; updateCommandBar(); }
    });
    document.querySelector("#activity-images")?.addEventListener("change", async (event) => {
      const files = [...event.target.files];
      const form = event.target.closest("#activity-form");
      const status = form.querySelector("[data-upload-status]");
      const cancel = form.querySelector("[data-cancel-upload]");
      try {
        await runUploadQueue(files, (_file, _index, context) => ({ topic: form.querySelector('[name="topic"]').value || "Khác", activityId: context.editingId, caption: "Ảnh hoạt động", alt: "Ảnh hoạt động" }), async (saved, _index, context) => {
          if (context.editingId) {
            const activity = context.draft.activities.find((item) => item.id === context.editingId);
            if (activity?.album?.manifest) throw new Error("Album manifest cần API cập nhật album trước khi thêm ảnh.");
            activity.images = uniqueMedia([...(activity.images || []), saved]);
          } else if (!context.pendingImages.some((item) => mediaKey(item) === mediaKey(saved))) context.pendingImages.push(saved);
          dirty = true;
        }, status, cancel);
        if (editingId) await saveDraftNow({ sync: false });
        renderPreservingScroll(message(status?.textContent || "Đã thêm ảnh vào sự kiện."));
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
      button.closest("[data-media-key]")?.remove();
      document.querySelectorAll("[data-paragraph-photo]").forEach((input) => { if (input.value === key) input.checked = false; });
      const selected = document.querySelector("[data-story-selection]"); if (selected) selected.dataset.storySelection = JSON.stringify(storySelection().filter((item) => item.photoId !== key));
      document.querySelector("#story-placement-editor").dataset.changed = "true";
      markChanged();
    });

    document.querySelector("#media-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const files = [...event.currentTarget.querySelector('[name="media"]').files];
      const status = event.currentTarget.querySelector("[data-upload-status]");
      const cancel = event.currentTarget.querySelector("[data-cancel-upload]");
      try {
        await runUploadQueue(files, (file) => ({ topic: formData.get("topic"), caption: formData.get("caption") || file.name, alt: formData.get("caption") || file.name }), async (saved, _index, context) => {
          context.draft.gallery = uniqueMedia([...(context.draft.gallery || []), saved]);
          if ((!mediaState.sourceYear || Number(mediaState.sourceYear) === currentYear) && !mediaState.items.some((item) => mediaKey(item) === mediaKey(saved))) mediaState.items.unshift(saved);
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
    document.querySelector("#media-source-year")?.addEventListener("change", async event => {
      syncAllForms(); mediaState.sourceYear = Number(event.target.value); mediaState.activityId = "";
      await loadMediaPage(true, "Tất cả", ""); renderPreservingScroll();
    });
    document.querySelectorAll("[data-reuse-media-id]").forEach(button => button.addEventListener("click", async () => {
      if (busy || uploading) return;
      syncAllForms();
      const targetId = editingId, targetYear = currentYear;
      const activity = draft.activities.find(item => item.id === targetId);
      const media = mediaState.items.find(item => mediaKey(item) === button.dataset.reuseMediaId);
      if (!activity || !media) return;
      busy = true; updateCommandBar();
      try {
        const photos = activity.album?.manifest ? await Store.loadAlbum(targetYear, activity) : (activity.images || []);
        if (targetYear !== currentYear || targetId !== editingId) return;
        activity.images = uniqueMedia([...photos, clone(media)]); delete activity.album;
        dirty = true; await saveDraftNow({sync:false});
        renderPreservingScroll(message("Đã dùng lại ảnh trong sự kiện; không tải thêm tệp lên R2."));
      } catch (error) { showError(error); }
      finally { busy = false; updateCommandBar(); }
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
    document.querySelectorAll("[data-delete-media-id]").forEach((button) => button.addEventListener("click", () => {
      const media = mediaState.items.find((item) => mediaKey(item) === button.dataset.deleteMediaId);
      if (media) previewMediaDeletion(media).catch(showError);
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
        for (const yearData of analysis.years) await Store.saveDraft(yearData.year, yearData, { baseRevision: Number(yearData.year) === currentYear ? baseRevision : "" });
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
      updateCommandBar();
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
    if (!dirty && !pendingLocalSave && !uploading && !hasPendingNewActivity() && !uploadJobs.some((job) => job.entries.some((entry) => ["failed","paused","pending"].includes(entry.state)))) return;
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
