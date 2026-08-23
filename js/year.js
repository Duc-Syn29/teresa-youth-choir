/** Tạo trang nhật ký năm từ dữ liệu nhẹ; album chỉ được tải khi người dùng mở. */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const selectedYear = Number(params.get("year"));
  const app = document.querySelector("#year-app");
  const loading = document.querySelector("#year-loading");
  const Schema = window.TeresaSchema || {};
  const compactViewport = window.matchMedia("(max-width: 680px)");
  const albumBatchSize = compactViewport.matches ? 20 : 24;

  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const list = (items = []) => items.map((item) => `<li>${escapeHTML(item)}</li>`).join("");
  const source = (media, variant = "medium") => window.TeresaStore?.mediaSource(media, variant)
    || Schema.mediaSource?.(media, variant)
    || (typeof media === "string" ? media : media?.src || "");
  const displayCaption = (value = "", fallback = "Ảnh tư liệu") => {
    const cleaned = String(value || fallback).replace(/\s*(?:[·•.\-–—]\s*)?ảnh\s*\d+\s*$/iu, "").trim();
    return cleaned || fallback;
  };
  const withDisplayCaption = (photo, fallback) => typeof photo === "object" && photo
    ? { ...photo, caption: displayCaption(photo.caption, fallback) }
    : photo;

  function mediaAttributes(media, variant = "thumbnail", sizes = "(max-width: 680px) 92vw, 42vw") {
    const src = source(media, variant);
    const variants = typeof media === "object" ? media.variants || {} : {};
    const candidates = [
      [variants.thumbnail || variants.thumb, 480],
      [variants.medium, 1280],
      [variants.original || variants.full || media?.src, 2048],
    ];
    const seen = new Set();
    const srcset = candidates.map(([candidate, width]) => {
      const candidateSrc = source(candidate, "original");
      if (!candidateSrc || seen.has(candidateSrc)) return "";
      seen.add(candidateSrc);
      const candidateWidth = Number(candidate?.width || width);
      return `${candidateSrc} ${candidateWidth > 0 ? candidateWidth : width}w`;
    }).filter(Boolean).join(", ");
    return `data-media-src="${escapeHTML(src)}" data-media-variant="${variant}"${srcset ? ` data-media-srcset="${escapeHTML(srcset)}" data-media-sizes="${escapeHTML(sizes)}"` : ""}`;
  }

  function editorialVisual(type = "") {
    const normalized = String(type).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/thanh le|dai le|le quan thay|hon phoi/.test(normalized)) return { theme: "liturgy", icon: "✝" };
    if (/tinh tam|tam linh|cau nguyen/.test(normalized)) return { theme: "retreat", icon: "✦" };
    if (/giang sinh|phuc sinh/.test(normalized)) return { theme: "season", icon: "★" };
    if (/thien nguyen|bac ai/.test(normalized)) return { theme: "charity", icon: "♡" };
    if (/hoa nhac|thanh nhac|song ca/.test(normalized)) return { theme: "music", icon: "♪" };
    if (/gan ket|hoi thao|sinh hoat/.test(normalized)) return { theme: "community", icon: "◎" };
    return { theme: "archive", icon: "◇" };
  }

  function sectionHeading(index, eyebrow, title, id) {
    return `<div class="year-section-heading reveal" id="${id}"><span class="index">${String(index).padStart(2, "0")} — ${escapeHTML(eyebrow)}</span><h2>${escapeHTML(title)}</h2></div>`;
  }

  function legacyMembers(entry = {}) {
    if (Array.isArray(entry.members)) return entry.members;
    const name = typeof entry === "string" ? entry : entry.name || "";
    const names = Schema.splitLegacyNames ? Schema.splitLegacyNames(name) : String(name).split(/\s*(?:\n|·|•|;)\s*/).filter(Boolean);
    return names.map((memberName, index) => ({ id: `legacy-${index + 1}`, name: memberName, photo: index === 0 ? entry.photo || "" : "" }));
  }

  function renderLeadership(leadership = {}) {
    const labels = { chaplain: "Cha đặc trách", leader: "Trưởng ca đoàn", deputyLeader: "Phó ca đoàn", conductor: "Ca trưởng", treasurer: "Thủ quỹ" };
    const people = Object.entries(labels).map(([key, role]) => ({ role, members: legacyMembers(leadership[key] || {}) })).filter((entry) => entry.members.length);
    const teams = (leadership.teams || leadership.serviceTeams || []).map((team) => {
      const normalized = typeof team === "string" ? { name: team, members: [] } : team;
      return { role: normalized.name || "Ban phục vụ", members: (normalized.members || []).map((member) => typeof member === "string" ? { name: member, photo: "" } : member).filter((member) => member?.name) };
    });
    const photo = (member) => member.photo
      ? `<img class="team-member-photo" ${mediaAttributes(member.photo, "thumbnail", "48px")} alt="${escapeHTML(member.name)}" loading="lazy" decoding="async" />`
      : `<span class="team-member-initial" aria-hidden="true">${escapeHTML(member.name.trim().charAt(0) || "T")}</span>`;
    return [...people, ...teams].map((entry) => `
      <article class="person-card person-card-team reveal">
        <span>${escapeHTML(entry.role)}</span>
        ${entry.members.length ? `<ul class="team-member-list">${entry.members.map((member) => `<li>${photo(member)}<b>${escapeHTML(member.name)}</b></li>`).join("")}</ul>` : '<p class="empty-note">Đang cập nhật</p>'}
      </article>`).join("");
  }

  function activityPreview(activity, gallery = []) {
    const matching = gallery.find((photo) => photo.event === activity.title || photo.event === activity.type);
    return activity.coverImage || activity.album?.preview?.[0] || activity.images?.[0] || matching || "";
  }

  function activityPhotoCount(activity, gallery = []) {
    if (Number(activity.album?.count)) return Number(activity.album.count);
    if (Array.isArray(activity.images)) return activity.images.length;
    return gallery.filter((photo) => photo.event === activity.title || photo.event === activity.type).length;
  }

  function renderActivities(activities = [], gallery = []) {
    return activities.map((activity, index) => {
      const preview = activityPreview(activity, gallery);
      const previewSrc = source(preview, "medium");
      const photoCount = activityPhotoCount(activity, gallery);
      const editorial = editorialVisual(activity.type);
      const number = String(index + 1).padStart(2, "0");
      return `
        <a class="year-activity reveal${previewSrc ? "" : ` year-activity-editorial editorial-theme-${editorial.theme}`}" href="activity.html?year=${encodeURIComponent(activity.year || "")}&id=${encodeURIComponent(activity.id || "")}" aria-label="Mở hoạt động: ${escapeHTML(activity.title)}">
          <span class="year-activity-media${previewSrc ? "" : " year-activity-media-empty"}"${previewSrc ? ` data-media-src="${escapeHTML(previewSrc)}" data-media-variant="medium"` : ` data-editorial-number="${number}"`} aria-hidden="true">${previewSrc ? "" : `<i class="editorial-icon">${editorial.icon}</i><small>Tư liệu ${escapeHTML(activity.year || "")}</small>`}</span>
          <span class="year-activity-shade" aria-hidden="true"></span><span class="year-activity-number" aria-hidden="true">${number}</span>
          <span class="year-activity-content"><span class="year-activity-meta"><span>${escapeHTML(activity.type)}</span><time>${escapeHTML(activity.date)}</time></span><strong>${escapeHTML(activity.title)}</strong><span class="year-activity-description">${escapeHTML(activity.description)}</span><span class="year-activity-footer"><span>${photoCount ? `${photoCount} ảnh tư liệu` : "Tư liệu hình ảnh đang được bổ sung"}</span><b aria-hidden="true">↗</b></span></span>
        </a>`;
    }).join("");
  }

  function buildAlbums(data) {
    const gallery = data.gallery || [];
    const claimed = new Set();
    const unique = (photos) => [...new Map(photos.filter(Boolean).map((photo) => [source(photo, "original"), photo]).filter(([src]) => src)).values()];
    const albums = [];
    (data.activities || []).forEach((activity) => {
      const inline = unique([...(activity.images || []), ...gallery.filter((photo) => photo.event === activity.title)]);
      const album = activity.album || {};
      const previews = unique(album.preview?.length ? album.preview : inline.slice(0, 3));
      const count = Number(album.count || inline.length);
      if (!count) return;
      inline.forEach((photo) => claimed.add(source(photo, "original")));
      albums.push({ key: activity.id, title: activity.title, type: activity.type || "Hoạt động", date: activity.date || "", count, previews, activity, manifest: album.manifest || "" });
    });
    (data.extraAlbums || []).forEach((album) => albums.push({ ...album, key: album.id || album.manifest, count: Number(album.count || album.preview?.length || 0), previews: album.preview || [], activity: album }));
    if (data.galleryAlbum?.manifest || Number(data.galleryAlbum?.count)) {
      const album = data.galleryAlbum;
      const previews = unique(album.preview?.length ? album.preview : gallery.slice(0, 3));
      previews.forEach((photo) => claimed.add(source(photo, "original")));
      albums.push({
        key: `${data.year}-year-gallery`,
        title: `Album tổng hợp ${data.year}`,
        type: "Tư liệu khác",
        date: "",
        count: Number(album.count || previews.length),
        previews,
        activity: album,
        manifest: album.manifest || "",
      });
      return albums;
    }
    const remaining = gallery.filter((photo) => !claimed.has(source(photo, "original")));
    const groups = new Map();
    remaining.forEach((photo) => { const label = photo.event || "Tư liệu khác"; if (!groups.has(label)) groups.set(label, []); groups.get(label).push(photo); });
    groups.forEach((photos, label) => albums.push({ key: `legacy-${albums.length}`, title: label, type: label, date: "", count: photos.length, previews: unique(photos.slice(0, 3)), activity: { images: unique(photos) } }));
    return albums;
  }

  function renderAlbumCards(albums = []) {
    if (!albums.length) return '<div class="activity-empty"><span aria-hidden="true">◇</span><h3>Album đang được bổ sung</h3><p>Nội dung của năm vẫn được giữ nguyên. Ảnh bìa và ảnh hoạt động có thể thêm sau trong khu quản trị.</p></div>';
    return albums.map((album, index) => `
      <button class="year-album-card reveal" type="button" data-album-index="${index}" data-album-key="${escapeHTML(album.key)}" data-album-type="${escapeHTML(album.type)}" data-album-title="${escapeHTML(album.title.toLocaleLowerCase("vi"))}" aria-label="Mở album ${escapeHTML(album.title)}, ${album.count} ảnh">
        <span class="year-album-preview" aria-hidden="true">${album.previews.slice(0, 3).map((photo, photoIndex) => `<span class="year-album-thumb year-album-thumb-${photoIndex + 1}"><img ${mediaAttributes(photo, "thumbnail", "(max-width:680px) 40vw, 24vw")} alt="" loading="lazy" decoding="async" /></span>`).join("")}</span>
        <span class="year-album-copy"><span class="year-album-meta"><b>${escapeHTML(album.type)}</b>${album.date ? `<time>${escapeHTML(album.date)}</time>` : ""}</span><strong>${escapeHTML(album.title)}</strong><span class="year-album-foot"><span>${album.count} ảnh</span><b>Xem album <i aria-hidden="true">→</i></b></span></span>
      </button>`).join("");
  }

  function albumPhotoMarkup(photo, album, index) {
    const original = source(photo, "original");
    const caption = displayCaption(photo?.caption, album.title);
    return `<button class="gallery-item album-dialog-photo reveal" type="button" data-album-photo="${index}" aria-label="Mở ảnh ${index + 1} trong album ${escapeHTML(album.title)}"><img ${mediaAttributes(photo, "thumbnail", "(max-width:680px) 46vw, 22vw")} alt="${escapeHTML(photo?.alt || caption)}" loading="lazy" decoding="async" /><span class="activity-photo-index">${String(index + 1).padStart(2, "0")}</span><span class="album-dialog-photo-copy"><small>${escapeHTML(album.type)}</small><strong>${escapeHTML(caption)}</strong></span><i data-full="${escapeHTML(original)}" hidden></i></button>`;
  }

  async function openAlbumDialog(album, options = {}) {
    const dialog = document.querySelector("#year-album-dialog");
    if (!dialog) {
      const photos = await window.TeresaStore.loadAlbum(selectedYear, album.activity);
      window.TeresaUI?.openLightbox(photos.map((photo) => withDisplayCaption(photo, album.title)), 0, album.title);
      return;
    }
    const title = dialog.querySelector("[data-album-dialog-title]");
    const count = dialog.querySelector("[data-album-dialog-count]");
    const grid = dialog.querySelector("[data-album-dialog-grid]");
    const more = dialog.querySelector("[data-album-dialog-more]");
    title.textContent = album.title;
    count.textContent = `Đang mở ${album.count} ảnh…`;
    grid.innerHTML = '<div class="activity-archive-loading"><span aria-hidden="true">♪</span><p>Đang tải chỉ mục album…</p></div>';
    more.hidden = true;
    dialog.dataset.albumKey = album.key || "";
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("album-dialog-open");
    document.dispatchEvent(new CustomEvent("teresa:view-state", { detail: { lastAlbumKey: album.key || "", albumOpen: true, albumPhotoIndex: Number(options.photoIndex || 0) } }));
    try {
      const photos = (await window.TeresaStore.loadAlbum(selectedYear, album.activity)).map((photo) => withDisplayCaption(photo, album.title));
      let rendered = 0;
      let loadingBatch = false;
      const renderBatch = async () => {
        if (loadingBatch || rendered >= photos.length) return;
        loadingBatch = true;
        const batch = photos.slice(rendered, rendered + albumBatchSize);
        if (!rendered) grid.innerHTML = "";
        grid.insertAdjacentHTML("beforeend", batch.map((photo, index) => albumPhotoMarkup(photo, album, rendered + index)).join(""));
        rendered += batch.length;
        count.textContent = `${photos.length} ảnh · đang hiển thị ${rendered}`;
        more.hidden = rendered >= photos.length;
        more.textContent = `Xem thêm ${Math.min(albumBatchSize, photos.length - rendered)} ảnh`;
        await window.TeresaStore.hydrateMedia(grid);
        window.TeresaUI?.initReveal(grid);
        loadingBatch = false;
        document.dispatchEvent(new CustomEvent("teresa:view-state", { detail: { lastAlbumKey: album.key || "", albumOpen: true, albumRendered: rendered } }));
      };
      const targetCount = Math.max(albumBatchSize, Number(options.rendered || 0));
      while (rendered < Math.min(targetCount, photos.length)) await renderBatch();
      more.onclick = renderBatch;
      dialog._albumObserver?.disconnect();
      dialog._albumObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) renderBatch();
      }, { root: dialog.querySelector(".album-dialog-body"), rootMargin: "700px 0px" });
      dialog._albumObserver.observe(more);
      if (options.photoIndex !== undefined && Number.isInteger(Number(options.photoIndex))) {
        const previousPhoto = grid.querySelector(`[data-album-photo="${Number(options.photoIndex)}"]`);
        previousPhoto?.classList.add("last-viewed");
        requestAnimationFrame(() => previousPhoto?.scrollIntoView({ block: "center", behavior: "auto" }));
      }
      grid.onclick = (event) => {
        const button = event.target.closest("[data-album-photo]");
        if (!button) return;
        const photoIndex = Number(button.dataset.albumPhoto);
        document.dispatchEvent(new CustomEvent("teresa:view-state", { detail: { lastAlbumKey: album.key || "", albumOpen: true, albumPhotoIndex: photoIndex, albumRendered: rendered } }));
        window.TeresaUI?.openLightbox(photos, photoIndex, album.title);
      };
    } catch (error) {
      count.textContent = "Không thể mở album";
      grid.innerHTML = `<div class="activity-archive-empty"><strong>Album chưa tải được</strong><p>${escapeHTML(error.message)}</p><button class="button" type="button" data-album-retry>Thử lại</button></div>`;
      grid.querySelector("[data-album-retry]")?.addEventListener("click", () => openAlbumDialog(album));
    }
  }

  function initAlbumDialog() {
    const dialog = document.querySelector("#year-album-dialog");
    if (!dialog || dialog.dataset.bound) return;
    dialog.dataset.bound = "true";
    const close = () => { if (dialog.open) dialog.close(); };
    const rememberClosed = () => { document.body.classList.remove("album-dialog-open"); dialog._albumObserver?.disconnect(); document.dispatchEvent(new CustomEvent("teresa:view-state", { detail: { lastAlbumKey: dialog.dataset.albumKey || "", albumOpen: false } })); };
    dialog.querySelector("[data-album-dialog-close]")?.addEventListener("click", close);
    dialog.addEventListener("cancel", () => document.body.classList.remove("album-dialog-open"));
    dialog.addEventListener("close", rememberClosed);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  }

  function initYearAlbums(albums = [], available = []) {
    initAlbumDialog();
    const cards = [...app.querySelectorAll("[data-album-index]")];
    let restoredAlbum = null;
    cards.forEach((card) => card.addEventListener("click", () => {
      const album = albums[Number(card.dataset.albumIndex)];
      const options = restoredAlbum?.lastAlbumKey === album.key ? restoredAlbum : {};
      openAlbumDialog(album, options);
    }));
    const stateKey = `teresa-album-filter:${location.pathname}${location.search}`;
    const searchKey = `teresa-album-search:${location.pathname}${location.search}`;
    const savedFilter = sessionStorage.getItem(stateKey) || "all";
    const search = app.querySelector("[data-album-search]");
    const empty = app.querySelector("[data-album-empty]");
    const apply = (filter, query = search?.value || "") => {
      const needle = query.trim().toLocaleLowerCase("vi");
      app.querySelectorAll("[data-album-filter]").forEach((button) => { const active = button.dataset.albumFilter === filter; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
      let visible = 0;
      cards.forEach((card) => {
        const hidden = (filter !== "all" && card.dataset.albumType !== filter) || (needle && !card.dataset.albumTitle.includes(needle));
        card.classList.toggle("hidden", hidden);
        if (!hidden) visible += 1;
      });
      if (empty) empty.hidden = visible > 0;
      sessionStorage.setItem(stateKey, filter);
      sessionStorage.setItem(searchKey, query);
      document.dispatchEvent(new CustomEvent("teresa:view-state", { detail: { albumFilter: filter, albumSearch: query } }));
    };
    app.querySelectorAll("[data-album-filter]").forEach((button) => button.addEventListener("click", () => apply(button.dataset.albumFilter)));
    if (search) { search.value = sessionStorage.getItem(searchKey) || ""; search.addEventListener("input", () => apply(app.querySelector("[data-album-filter].active")?.dataset.albumFilter || "all", search.value)); }
    app.querySelector("[data-album-year]")?.addEventListener("change", (event) => { location.href = `year.html?year=${encodeURIComponent(event.currentTarget.value)}#year-album`; });
    document.addEventListener("teresa:restore-view-state", (event) => {
      restoredAlbum = event.detail || null;
      if (search && typeof event.detail?.albumSearch === "string") search.value = event.detail.albumSearch;
      apply(event.detail?.albumFilter || savedFilter, search?.value || "");
      const card = cards.find((item) => item.dataset.albumKey === event.detail?.lastAlbumKey);
      card?.classList.add("last-viewed");
      if (card && event.detail?.albumOpen) card.click();
    });
    if ([...app.querySelectorAll("[data-album-filter]")].some((button) => button.dataset.albumFilter === savedFilter)) apply(savedFilter, search?.value || "");
  }

  function renderQuotes(sharing = []) {
    return sharing.map((item) => `<article class="quote-card reveal"><blockquote>“${escapeHTML(item.quote)}”</blockquote><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.role)}</small></article>`).join("");
  }

  function yearSwitcher(year, years) {
    const position = years.indexOf(year);
    const previous = position > 0 ? `<a href="year.html?year=${years[position - 1]}">← Nhật ký ${years[position - 1]}</a>` : "<span></span>";
    const next = position >= 0 && position < years.length - 1 ? `<a href="year.html?year=${years[position + 1]}">Nhật ký ${years[position + 1]} →</a>` : "<span></span>";
    return `<div class="year-switcher">${previous}${next}</div>`;
  }

  function prose(value = "") {
    return String(value).split(/\n\s*\n|\n/).map((paragraph) => paragraph.trim()).filter(Boolean).map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("");
  }

  function initYearSectionSpy() {
    const links = [...app.querySelectorAll(".year-nav a[href^='#']")];
    if (!("IntersectionObserver" in window) || !links.length) return;
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => link.toggleAttribute("aria-current", link.hash === `#${entry.target.querySelector("[id]")?.id}`));
    }), { rootMargin: "-32% 0px -58%" });
    app.querySelectorAll(".year-section").forEach((section) => observer.observe(section));
  }

  async function render(data, available) {
    const { year, overview, leadership, members, activities, achievements, challenges, gallery, sharing, yearMark } = data;
    const albums = buildAlbums(data);
    const albumTypes = [...new Set(albums.map((album) => album.type).filter(Boolean))];
    const imageTotal = albums.reduce((total, album) => total + Number(album.count || 0), 0);
    document.title = `${year} — Teresa Youth Choir`;
    document.documentElement.style.setProperty("--year-accent", data.theme?.accent || "#f27f6b");
    const hero = source(overview.coverImage, "original");

    app.innerHTML = `
      <section class="year-hero"><div class="year-hero-bg">${hero ? `<img ${mediaAttributes(overview.coverImage, "original", "100vw")} data-media-priority="high" alt="" loading="eager" decoding="async" />` : ""}</div><div class="container year-hero-content"><div class="year-number">${year}</div><div class="year-intro"><p class="eyebrow">${escapeHTML(overview.eyebrow)}</p><h1>${escapeHTML(overview.title)}</h1><p>${escapeHTML(overview.summary)}</p><p class="year-verse">${escapeHTML(overview.verse)}</p></div></div></section>
      <nav class="year-nav" aria-label="Mục lục năm ${year}"><div class="container year-nav-inner"><a href="#overview">Tổng quan</a><a href="#leadership">Ban điều hành</a><a href="#members">Thành viên</a><a href="#year-activities">Hoạt động</a><a href="#reflection">Nhìn lại</a><a href="#year-album">Album</a><a href="#sharing">Lời chia sẻ</a></div></nav>
      <section class="year-section" aria-labelledby="overview"><div class="container">${sectionHeading(1, "Tổng quan năm", overview.title, "overview")}<div class="overview-grid"><article class="overview-story reveal">${prose(overview.longDescription)}</article><article class="year-mark-card reveal"><small>Dấu ấn ${year}</small><strong>${escapeHTML(yearMark.title)}</strong><span>${escapeHTML(yearMark.highlight)}</span></article></div></div></section>
      <section class="year-section" aria-labelledby="leadership"><div class="container">${sectionHeading(2, "Những người phục vụ", "Ban điều hành", "leadership")}<div class="leadership-grid">${renderLeadership(leadership)}</div></div></section>
      <section class="year-section" aria-labelledby="members"><div class="container">${sectionHeading(3, "Gia đình Têrêsa", "Thành viên", "members")}<div class="member-stats"><article class="member-stat reveal"><strong>${members.total}</strong><span>Tổng số ca viên</span></article><article class="member-stat reveal"><strong>+${members.new}</strong><span>Ca viên mới</span></article><article class="member-stat reveal"><strong>${members.inactive}</strong><span>Thành viên nghỉ</span></article></div><p class="member-note reveal">${escapeHTML(members.notes)}</p></div></section>
      <section class="year-section" aria-labelledby="year-activities"><div class="container">${sectionHeading(4, "Những ngày cùng nhau", "Hoạt động trong năm", "year-activities")}<div class="year-activities">${renderActivities(activities.map((activity) => ({ ...activity, year })), gallery || [])}</div></div></section>
      <section class="year-section" aria-labelledby="reflection"><div class="container">${sectionHeading(5, "Thành tựu & thử thách", "Nhìn lại để lớn lên", "reflection")}<div class="reflection-grid"><article class="reflection-card achievement reveal"><h3>Điều đã làm được</h3><ul>${list(achievements)}</ul></article><article class="reflection-card challenge reveal"><h3>Điều còn trăn trở</h3><ul>${list(challenges)}</ul></article></div></div></section>
      <section class="year-section" aria-labelledby="year-album"><div class="container">${sectionHeading(6, "Khoảnh khắc", `Album ${year}`, "year-album")}${albums.length ? `<div class="year-album-toolbar reveal"><p><strong>${imageTotal} ảnh</strong><span>${albums.length} album sự kiện</span></p><div class="year-album-controls"><label><span>Năm</span><select data-album-year aria-label="Lọc album theo năm">${available.map((item) => `<option value="${item}" ${Number(item) === Number(year) ? "selected" : ""}>${item}</option>`).join("")}</select></label><label class="album-search"><span>Sự kiện</span><input type="search" data-album-search placeholder="Tìm tên sự kiện…" autocomplete="off" /></label></div><div class="year-album-filters" aria-label="Lọc album theo loại sự kiện"><button class="active" type="button" data-album-filter="all" aria-pressed="true">Tất cả</button>${albumTypes.map((type) => `<button type="button" data-album-filter="${escapeHTML(type)}" aria-pressed="false">${escapeHTML(type)}</button>`).join("")}</div></div>` : ""}<div class="year-albums">${renderAlbumCards(albums)}</div><p class="empty-note year-album-empty" data-album-empty hidden>Không có album phù hợp với bộ lọc.</p><p class="gallery-note">Mỗi album mở 20–24 ảnh đầu tiên, sau đó tự tải thêm khi bạn cuộn gần cuối hoặc bấm “Xem thêm”.</p></div></section>
      <section class="year-section" aria-labelledby="sharing"><div class="container">${sectionHeading(7, "Thanh âm ở lại", "Lời chia sẻ", "sharing")}<div class="quote-grid">${renderQuotes(sharing)}</div></div></section>
      <section class="year-signature"><div class="container reveal"><p class="eyebrow">Dấu ấn của năm</p><h2>${escapeHTML(yearMark.title)}</h2><p>${escapeHTML(yearMark.description)}</p>${yearSwitcher(year, available)}</div></section>`;

    loading.hidden = true;
    app.hidden = false;
    await window.TeresaStore.hydrateMedia(app);
    window.TeresaUI?.initReveal(app);
    window.TeresaUI?.initLightbox();
    window.TeresaUI?.initLiquidGlass(app);
    initYearAlbums(albums, available);
    initYearSectionSpy();
    document.dispatchEvent(new CustomEvent("teresa:content-ready", { detail: { page: "year", year } }));
  }

  function renderError(message) {
    loading.hidden = true;
    app.hidden = false;
    app.innerHTML = `<section class="year-error"><h1>Ôi!</h1><p>${escapeHTML(message)}</p><a class="button" href="index.html#journey">Trở về hành trình</a></section>`;
  }

  async function loadSelectedYear() {
    try {
      if (!window.TeresaStore || !Number.isInteger(selectedYear)) throw new Error("Liên kết năm chưa hợp lệ.");
      const years = await window.TeresaStore.availableYears();
      if (!years.includes(selectedYear) && new URLSearchParams(location.search).get("preview") !== "1") throw new Error(`Năm ${selectedYear} chưa có trong kho lưu trữ.`);
      await render(await window.TeresaStore.loadYear(selectedYear), years);
    } catch (error) {
      console.error("Không thể đọc dữ liệu năm:", error);
      renderError(error.message || "Không thể mở dữ liệu. Hãy chạy website bằng máy chủ local.");
    }
  }

  document.addEventListener("DOMContentLoaded", loadSelectedYear);
})();
