/** Trang chi tiết hoạt động: tải album theo nhu cầu và dựng ảnh theo từng đợt. */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const year = Number(params.get("year"));
  const activityId = params.get("id");
  const app = document.querySelector("#activity-app");
  const loading = document.querySelector("#activity-loading");
  const Schema = window.TeresaSchema || {};
  const compactViewport = window.matchMedia("(max-width: 680px)");
  const galleryBatchSize = compactViewport.matches ? 8 : 16;
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const source = (media, variant = "medium") => window.TeresaStore?.mediaSource(media, variant)
    || Schema.mediaSource?.(media, variant)
    || (typeof media === "string" ? media : media?.src || "");
  const displayCaption = (value = "", fallback = "Ảnh tư liệu") => {
    const cleaned = String(value || fallback).replace(/\s*(?:[·•.\-–—]\s*)?ảnh\s*\d+\s*$/iu, "").trim();
    return cleaned || fallback;
  };
  const normalizeText = (value = "") => String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const stopWords = new Set("anh anh em bai ban bang bo buc ca cac cho cua cung da day de den doan duoc giua hai hat hay hon ket la lai lam len loi minh mot nam ngay nguoi nguyen nhu nhung noi phuc qua ra sau su tai thanh theo thi thien tieng trong tu va vao ve vien voi".split(" "));
  const contextTokens = (value) => new Set(normalizeText(value).split(/\s+/).filter((word) => word.length > 2 && !stopWords.has(word)));
  const contextThemes = [
    ["phung-vu", ["thanh le", "phung vu", "hat le", "cung thanh", "hop xuong", "gio chau"]],
    ["thanh-nhac", ["hoa nhac", "thanh nhac", "thanh ca", "am nhac", "tap hat", "song ca", "tieng hat"]],
    ["phuc-sinh", ["phuc sinh"]],
    ["giang-sinh", ["giang sinh", "dem dong", "hang da", "ngoi sao", "noel"]],
    ["tinh-tam", ["tinh tam", "cau nguyen", "thinh lang", "giao hoa", "mua chay", "hanh huong"]],
    ["bac-ai", ["thien nguyen", "bac ai", "yeu thuong", "vung cao", "hoc bong", "nhu yeu pham", "phan qua"]],
    ["gan-ket", ["gan ket", "team building", "dong hanh", "gap lai", "doan vien", "cong vien", "mai nha"]],
    ["the-thao", ["hoi thao", "bong da", "the thao", "teresa games", "thi dau"]],
    ["quan-thay", ["quan thay", "bon mang", "thanh teresa"]],
    ["hon-phoi", ["hon phoi", "dam cuoi", "le cuoi", "ngay hanh phuc"]],
  ];
  const themesFor = (value) => {
    const text = ` ${normalizeText(value)} `;
    return new Set(contextThemes.filter(([, phrases]) => phrases.some((phrase) => text.includes(` ${phrase} `))).map(([theme]) => theme));
  };

  function contextualScore(text, photo) {
    const photoText = [photo?.event, photo?.caption, photo?.alt, source(photo, "original")].filter(Boolean).join(" ");
    const wantedTokens = contextTokens(text);
    const photoTokens = contextTokens(photoText);
    let score = 0;
    wantedTokens.forEach((token) => { if (photoTokens.has(token)) score += token.length > 6 ? 3 : 2; });
    const wantedThemes = themesFor(text);
    const photoThemes = themesFor(photoText);
    const specificThemes = new Set(["phuc-sinh", "giang-sinh", "tinh-tam", "bac-ai", "gan-ket", "the-thao", "quan-thay", "hon-phoi"]);
    photoThemes.forEach((theme) => {
      if (wantedThemes.has(theme)) score += 8;
      else if (specificThemes.has(theme)) score -= 8;
    });
    wantedThemes.forEach((theme) => {
      if (specificThemes.has(theme) && !photoThemes.has(theme)) score -= 4;
    });
    return score;
  }

  function mediaAttributes(media, variant = "thumbnail", sizes = "(max-width: 680px) 92vw, 42vw") {
    const src = source(media, variant);
    const variants = typeof media === "object" ? media.variants || {} : {};
    const candidates = [
      [variants.thumbnail || variants.thumb, 480],
      [variants.medium, 1280],
      [variants.original || variants.full || media?.src, 2048],
    ];
    const seen = new Set();
    const srcset = candidates.map(([candidate, fallbackWidth]) => {
      const candidateSrc = source(candidate, "original");
      if (!candidateSrc || seen.has(candidateSrc)) return "";
      seen.add(candidateSrc);
      return `${candidateSrc} ${Number(candidate?.width || fallbackWidth)}w`;
    }).filter(Boolean).join(", ");
    const dimensions = variants.original || variants.medium || media || {};
    const width = Number(dimensions.width || 0);
    const height = Number(dimensions.height || 0);
    const sizeAttributes = width > 0 && height > 0 ? ` width="${width}" height="${height}" style="aspect-ratio:auto ${width} / ${height}"` : "";
    return `${sizeAttributes} data-media-src="${escapeHTML(src)}" data-media-variant="${variant}"${srcset ? ` data-media-srcset="${escapeHTML(srcset)}" data-media-sizes="${escapeHTML(sizes)}"` : ""}`;
  }

  function mediaShape(media) {
    const variants = typeof media === "object" ? media.variants || {} : {};
    const dimensions = variants.original || variants.medium || media || {};
    const width = Number(dimensions.width || 0);
    const height = Number(dimensions.height || 0);
    if (!width || !height) return "is-landscape";
    if (height > width * 1.08) return "is-portrait";
    if (width > height * 1.08) return "is-landscape";
    return "is-square";
  }

  function photoMarkup(photo, activity, index) {
    const original = source(photo, "original");
    const caption = displayCaption(photo?.caption, activity.title);
    return `<button class="gallery-item activity-photo ${mediaShape(photo)} reveal" type="button" data-full="${escapeHTML(original)}" data-caption="${escapeHTML(caption)}" aria-label="Mở ảnh ${index + 1}: ${escapeHTML(caption)}"><img ${mediaAttributes(photo)} alt="${escapeHTML(photo?.alt || caption)}" loading="lazy" decoding="async" fetchpriority="low" /><span class="activity-photo-index">${String(index + 1).padStart(2, "0")}</span><span><small>${escapeHTML(activity.topic || activity.type)}</small><strong>${escapeHTML(caption)}</strong></span></button>`;
  }

  function initProgressiveGallery(photos, activity) {
    const grid = app.querySelector(".activity-gallery");
    const button = app.querySelector("[data-gallery-more]");
    if (!grid || !button) return;
    let rendered = grid.children.length;
    let loadingBatch = false;
    const updateButton = () => {
      const remaining = Math.max(0, photos.length - rendered);
      button.hidden = remaining === 0;
      button.textContent = remaining
        ? `Xem thêm ${Math.min(galleryBatchSize, remaining)} ảnh · còn ${remaining}`
        : "Đã mở toàn bộ ảnh";
      button.setAttribute("aria-label", remaining ? `Hiển thị thêm ảnh, còn ${remaining} ảnh` : "Đã hiển thị toàn bộ ảnh");
    };
    const loadMore = async (targetCount = rendered + galleryBatchSize) => {
      if (loadingBatch || rendered >= photos.length) return;
      loadingBatch = true;
      button.disabled = true;
      button.textContent = "Đang mở ảnh…";
      try {
        const batch = photos.slice(rendered, Math.max(rendered, Math.min(photos.length, targetCount)));
        grid.insertAdjacentHTML("beforeend", batch.map((photo, index) => photoMarkup(photo, activity, rendered + index)).join(""));
        rendered += batch.length;
        await window.TeresaStore?.hydrateMedia(grid);
        window.TeresaUI?.initReveal(grid);
        window.TeresaUI?.initLightbox();
      } finally {
        loadingBatch = false;
        button.disabled = false;
        updateButton();
      }
    };
    button.addEventListener("click", () => loadMore());
    document.addEventListener("teresa:restore-view-state", (event) => {
      if (Number(event.detail?.activityRendered) > rendered) loadMore(Number(event.detail.activityRendered));
    });
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
        if (rendered >= photos.length) observer.disconnect();
      }, { rootMargin: "240px 0px" });
      observer.observe(button);
    }
    updateButton();
  }

  function proseMarkup(value = "") {
    const paragraphs = String(value).split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
    return paragraphs.map((paragraph, index) => `<p${index === 0 ? ' class="activity-lead"' : ""}>${escapeHTML(paragraph)}</p>`).join("");
  }

  function storyParts(value = "") {
    const sourceText = String(value).trim();
    if (!sourceText) return [];
    // Giữ nguyên ranh giới đoạn văn từ nội dung gốc. Việc tự cắt theo số ký tự
    // khiến một đoạn văn bị biến thành nhiều khối và tạo khoảng trắng giả.
    return sourceText.split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
  }

  function storyPhotoPlan(activity, parts, photos) {
    if (!parts.length || !photos.length) return new Map();
    const count = Math.min(4, photos.length, parts.length > 1 ? parts.length - 1 : 1);
    const slots = [];
    for (let index = 0; index < count; index += 1) {
      const slot = parts.length === 1 ? 0 : Math.min(parts.length - 2, Math.round(((index + 1) * parts.length) / (count + 1)) - 1);
      if (!slots.includes(slot)) slots.push(slot);
    }
    for (let slot = 0; slots.length < count && slot < Math.max(1, parts.length - 1); slot += 1) {
      if (!slots.includes(slot)) slots.push(slot);
    }
    slots.sort((a, b) => a - b);

    const unused = new Set(photos.map((_photo, index) => index));
    const plan = new Map();
    slots.forEach((slot, order) => {
      const target = Math.round(((order + 1) * (photos.length - 1)) / (slots.length + 1));
      const paragraphContext = `${activity.title} ${activity.type || ""} ${activity.topic || ""} ${parts[slot]}`;
      const candidates = [...unused].map((photoIndex) => ({
        photoIndex,
        score: contextualScore(paragraphContext, photos[photoIndex]),
        distance: Math.abs(photoIndex - target),
      })).sort((left, right) => right.score - left.score || left.distance - right.distance || left.photoIndex - right.photoIndex);
      const selected = candidates[0]?.photoIndex;
      if (selected === undefined) return;
      unused.delete(selected);
      plan.set(slot, selected);
    });
    return plan;
  }

  function storyMarkup(activity, photos) {
    const parts = storyParts(activity.body || activity.description);
    const photoPlan = storyPhotoPlan(activity, parts, photos);
    const chapters = [];
    let textRun = [];
    const paragraphMarkup = (paragraph, index) => `<p${index === 0 ? ' class="activity-lead"' : ""}>${escapeHTML(paragraph)}</p>`;
    const flushTextRun = () => {
      if (!textRun.length) return;
      chapters.push(`<section class="activity-story-chapter text-only">${textRun.map(({ paragraph, index }) => paragraphMarkup(paragraph, index)).join("")}</section>`);
      textRun = [];
    };

    parts.forEach((paragraph, index) => {
      const photoIndex = photoPlan.get(index);
      const photo = photoIndex !== undefined ? photos[photoIndex] : null;
      if (!photo) {
        textRun.push({ paragraph, index });
        return;
      }
      flushTextRun();
      const caption = photo ? displayCaption(photo.caption, activity.title) : "";
      chapters.push(`<section class="activity-story-chapter has-inline-media">${paragraphMarkup(paragraph, index)}<figure class="activity-story-figure"><button class="activity-story-photo ${mediaShape(photo)}" type="button" data-story-photo="${photoIndex}" aria-label="Mở ảnh: ${escapeHTML(caption)}"><img ${mediaAttributes(photo, "medium", "(max-width:680px) 92vw, 62vw")} alt="${escapeHTML(photo.alt || caption)}" loading="lazy" decoding="async" /><span>${String(photoIndex + 1).padStart(2, "0")} / ${photos.length}</span></button><figcaption>${escapeHTML(caption)}</figcaption></figure></section>`);
    });
    flushTextRun();
    return chapters.join("");
  }

  function activityPreview(activity, data) {
    const matchingPhoto = (data.gallery || []).find((photo) => photo.event === activity.title || photo.event === activity.type);
    return activity.coverImage || activity.album?.preview?.[0] || activity.images?.[0] || matchingPhoto || "";
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

  function navigationCard(activity, data, direction) {
    if (!activity) return '<span class="activity-nav-spacer"></span>';
    const preview = activityPreview(activity, data);
    const previewSrc = source(preview, "thumbnail");
    const editorial = editorialVisual(activity.type);
    return `<a class="activity-nav-card reveal ${direction}${previewSrc ? "" : ` activity-nav-card-editorial editorial-theme-${editorial.theme}`}" href="activity.html?year=${data.year}&id=${encodeURIComponent(activity.id)}"><span class="activity-nav-image${previewSrc ? "" : " activity-nav-image-empty"}" aria-hidden="true">${previewSrc ? `<img ${mediaAttributes(preview, "medium", "(max-width:680px) 100vw, 50vw")} alt="" loading="lazy" decoding="async" />` : `<i class="editorial-icon">${editorial.icon}</i>`}</span><span class="activity-nav-overlay" aria-hidden="true"></span><span class="activity-nav-copy"><small>${direction === "previous" ? "← Hoạt động trước" : "Hoạt động tiếp →"}</small><strong>${escapeHTML(activity.title)}</strong><span>${escapeHTML(activity.date)}</span></span></a>`;
  }

  async function activityPhotos(activity, data) {
    if (activity.album?.manifest || activity.images?.length) return window.TeresaStore.loadAlbum(year, activity);
    const gallery = data.gallery || [];
    const exact = gallery.filter((photo) => photo.event === activity.title || photo.event === activity.type || photo.event === activity.topic);
    if (exact.length) return exact;
    const activityContext = [activity.title, activity.type, activity.topic, activity.description, activity.body].filter(Boolean).join(" ");
    const ranked = gallery.map((photo) => ({ photo, score: contextualScore(activityContext, photo) })).sort((left, right) => right.score - left.score);
    const best = ranked[0]?.score || 0;
    if (best < 8) return [];
    return ranked.filter((item) => item.score >= Math.max(8, best - 3)).map((item) => item.photo);
  }

  function errorMarkup(message) {
    return `<section class="year-error"><h1>Ôi!</h1><p>${escapeHTML(message)}</p><a class="button" href="index.html#journey">Trở về hành trình</a></section>`;
  }

  function galleryMarkup(photos, activity) {
    return photos.length
      ? `<div class="activity-gallery">${photos.slice(0, galleryBatchSize).map((photo, index) => photoMarkup(photo, activity, index)).join("")}</div><div class="gallery-more-wrap"><button class="gallery-load-more" type="button" data-gallery-more>Xem thêm ảnh</button></div>`
      : '<div class="activity-empty"><span aria-hidden="true">◇</span><h3>Kho ảnh đang được hoàn thiện</h3><p>Nội dung hoạt động vẫn được lưu trọn vẹn. Ảnh tư liệu sẽ được bổ sung sau.</p></div>';
  }

  async function loadGallery(activity) {
    const mount = app.querySelector("[data-activity-gallery]");
    if (!mount || mount.dataset.loading === "true") return;
    mount.dataset.loading = "true";
    mount.setAttribute("aria-busy", "true");
    mount.innerHTML = '<p class="album-load-status" role="status">Đang tải danh sách ảnh… Bạn có thể đọc câu chuyện trong lúc chờ.</p>';
    try {
      const photos = await window.TeresaStore.loadAlbum(year, activity);
      mount.innerHTML = galleryMarkup(photos, activity);
      app.querySelector("[data-gallery-count]").textContent = String(photos.length).padStart(2, "0");
      app.querySelector("[data-photo-count]").textContent = photos.length ? `${photos.length} khoảnh khắc` : "Đang cập nhật";
      window.TeresaStore.hydrateMedia(mount).catch((error) => console.warn("Không thể tải ảnh:", error));
      window.TeresaUI?.initReveal(mount);
      window.TeresaUI?.initLightbox();
      initProgressiveGallery(photos, activity);
    } catch (_error) {
      // Only the album needs retrying; keep the hero and article usable.
      mount.innerHTML = '<div class="album-load-status" role="status"><p>Chưa tải được danh sách ảnh. Nội dung bài viết vẫn hiển thị đầy đủ.</p><button class="gallery-load-more" type="button" data-album-retry>Thử tải lại ảnh</button></div>';
      mount.querySelector("[data-album-retry]").addEventListener("click", () => loadGallery(activity));
    } finally {
      mount.dataset.loading = "false";
      mount.setAttribute("aria-busy", "false");
      window.TeresaUI?.notifyPageRendered?.();
    }
  }

  async function render() {
    if (!window.TeresaStore || !Number.isInteger(year) || !activityId) {
      loading.hidden = true;
      app.hidden = false;
      app.innerHTML = errorMarkup("Liên kết hoạt động chưa hợp lệ.");
      return;
    }
    try {
      const data = await window.TeresaStore.loadYear(year);
      const activityIndex = data.activities.findIndex((item) => item.id === activityId);
      const activity = data.activities[activityIndex];
      if (!activity) throw new Error("Không tìm thấy hoạt động này.");
      const deferredAlbum = Boolean(activity.album?.manifest);
      // Use the embedded previews for the story. Loading the full album later
      // never replaces paragraphs or shifts the reader's position in the story.
      const photos = deferredAlbum ? (activity.album.preview || []) : await activityPhotos(activity, data);
      const photoCount = deferredAlbum ? Number(activity.album.count || photos.length) : photos.length;
      const hasPhotos = photoCount > 0;
      const cover = activity.coverImage || activity.album?.preview?.[0] || photos[0] || "";
      const coverImage = source(cover, "original");
      const editorial = editorialVisual(activity.type);
      const previous = activityIndex > 0 ? data.activities[activityIndex - 1] : null;
      const next = activityIndex < data.activities.length - 1 ? data.activities[activityIndex + 1] : null;
      const yearUrl = `year.html?year=${year}#year-activities`;

      document.title = `${activity.title} — Teresa Youth Choir`;
      document.querySelector("#back-to-year").href = yearUrl;
      const adminLink = window.TeresaStore.isAdmin() ? `<a class="button button-light" href="admin.html?year=${year}&activity=${encodeURIComponent(activity.id)}">Chỉnh sửa hoạt động ↗</a>` : "";
      app.innerHTML = `
        <section class="activity-hero${coverImage ? "" : ` activity-hero-editorial editorial-theme-${editorial.theme}`}">
          <div class="activity-hero-bg${coverImage ? "" : " activity-hero-bg-empty"}">${coverImage ? `<img ${mediaAttributes(cover, "medium", "100vw")} data-media-priority="high" alt="" loading="eager" decoding="async" fetchpriority="high" />` : `<span class="activity-editorial-year" aria-hidden="true">${year}</span><i class="activity-editorial-icon" aria-hidden="true">${editorial.icon}</i><small>Tư liệu hình ảnh đang được bổ sung</small>`}</div>
          <div class="activity-hero-grain" aria-hidden="true"></div>
          <div class="container activity-hero-content">
            <nav class="activity-breadcrumb" aria-label="Đường dẫn"><a href="index.html">Trang chủ</a><span>/</span><a href="${yearUrl}">Nhật ký ${year}</a><span>/</span><span>${escapeHTML(activity.type)}</span></nav>
            <div class="activity-hero-meta"><span>${escapeHTML(activity.type)}</span><time>${escapeHTML(activity.date)}</time></div>
            <h1>${escapeHTML(activity.title)}</h1>
            <p class="activity-hero-summary">${escapeHTML(activity.description)}</p>
            <div class="activity-actions"><a class="button button-primary" href="#activity-story">Xem hành trình ↓</a><a class="button button-light" href="${yearUrl}">← Nhật ký ${year}</a>${adminLink}</div>
          </div>
          <a class="activity-scroll-cue" href="#activity-story"><span>Đọc câu chuyện</span><i aria-hidden="true">↓</i></a>
        </section>
        <section class="activity-story-section" id="activity-story">
          <div class="container activity-detail-grid">
            <aside class="activity-facts reveal" aria-label="Thông tin hoạt động">
              <p class="eyebrow">Tư liệu hoạt động</p>
              <div class="activity-fact"><span>Năm</span><strong>${year}</strong></div>
              <div class="activity-fact"><span>Thời gian</span><strong>${escapeHTML(activity.date)}</strong></div>
              ${activity.location ? `<div class="activity-fact"><span>Địa điểm</span><strong>${escapeHTML(activity.location)}</strong></div>` : ""}
              <div class="activity-fact"><span>Chủ đề</span><strong>${escapeHTML(activity.topic || activity.type)}</strong></div>
              ${hasPhotos ? `<div class="activity-fact"><span>Kho ảnh</span><strong data-photo-count>${photoCount} khoảnh khắc</strong></div>` : ""}
            </aside>
            <article class="activity-story reveal">
              <p class="activity-story-kicker">Câu chuyện được lưu lại</p>
              <h2>${escapeHTML(activity.title)}</h2>
              <div class="activity-prose activity-story-flow ${hasPhotos ? "has-story-media" : "no-story-media"}">${storyMarkup(activity, photos)}</div>
            </article>
          </div>
        </section>
        ${hasPhotos ? `<section class="activity-gallery-section" aria-labelledby="activity-gallery-title">
          <div class="container">
            <div class="activity-section-heading reveal"><div><span>Ảnh — tư liệu</span><strong data-gallery-count>${String(photoCount).padStart(2, "0")}</strong></div><h2 id="activity-gallery-title">Những khoảnh khắc<br /><em>còn ở lại.</em></h2></div>
            <div data-activity-gallery>${deferredAlbum ? '<p class="album-load-status" role="status">Đang tải danh sách ảnh…</p>' : galleryMarkup(photos, activity)}</div>
          </div>
        </section>` : ""}
        <section class="activity-navigation"><div class="container"><p class="eyebrow">Tiếp tục hành trình ${year}</p><div class="activity-nav-grid">${navigationCard(previous, data, "previous")}${navigationCard(next, data, "next")}</div></div></section>`;

      // Nội dung hoạt động không cần chờ ảnh bìa tải và giải mã xong mới xuất
      // hiện. hydrateMedia vẫn ưu tiên ảnh bìa và tải các ảnh còn lại khi cần.
      window.TeresaStore.hydrateMedia(app).catch((error) => console.warn("Không thể tải một số ảnh của hoạt động:", error));
      loading.hidden = true;
      app.hidden = false;
      window.TeresaUI?.initReveal(app);
      window.TeresaUI?.initLightbox();
      if (deferredAlbum) loadGallery(activity);
      else initProgressiveGallery(photos, activity);
      app.querySelectorAll("[data-story-photo]").forEach((button) => button.addEventListener("click", () => window.TeresaUI?.openLightbox(photos, Number(button.dataset.storyPhoto), activity.title)));
      window.TeresaUI?.completeCoverTransition?.(app.querySelector(".activity-hero-bg"));
      document.dispatchEvent(new CustomEvent("teresa:content-ready", { detail: { page: "activity", year, activityId } }));
      window.TeresaUI?.notifyPageRendered?.();
    } catch (error) {
      console.error("Không thể mở hoạt động:", error);
      loading.hidden = true;
      app.hidden = false;
      app.innerHTML = errorMarkup(error.message || "Không thể mở hoạt động.");
    }
  }

  document.addEventListener("DOMContentLoaded", render);
})();
