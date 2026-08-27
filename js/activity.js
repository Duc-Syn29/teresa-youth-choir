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
  const galleryBatchSize = compactViewport.matches ? 20 : 24;
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const source = (media, variant = "medium") => window.TeresaStore?.mediaSource(media, variant)
    || Schema.mediaSource?.(media, variant)
    || (typeof media === "string" ? media : media?.src || "");
  const displayCaption = (value = "", fallback = "Ảnh tư liệu") => {
    const cleaned = String(value || fallback).replace(/\s*(?:[·•.\-–—]\s*)?ảnh\s*\d+\s*$/iu, "").trim();
    return cleaned || fallback;
  };

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
    return `data-media-src="${escapeHTML(src)}" data-media-variant="${variant}"${srcset ? ` data-media-srcset="${escapeHTML(srcset)}" data-media-sizes="${escapeHTML(sizes)}"` : ""}`;
  }

  function photoMarkup(photo, activity, index) {
    const original = source(photo, "original");
    const caption = displayCaption(photo?.caption, activity.title);
    return `<button class="gallery-item activity-photo reveal" type="button" data-full="${escapeHTML(original)}" data-caption="${escapeHTML(caption)}" aria-label="Mở ảnh ${index + 1}: ${escapeHTML(caption)}"><img ${mediaAttributes(photo)} alt="${escapeHTML(photo?.alt || caption)}" loading="lazy" decoding="async" fetchpriority="low" /><span class="activity-photo-index">${String(index + 1).padStart(2, "0")}</span><span><small>${escapeHTML(activity.topic || activity.type)}</small><strong>${escapeHTML(caption)}</strong></span></button>`;
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
    const loadMore = async () => {
      if (loadingBatch || rendered >= photos.length) return;
      loadingBatch = true;
      button.disabled = true;
      button.textContent = "Đang mở ảnh…";
      try {
        const batch = photos.slice(rendered, rendered + galleryBatchSize);
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
    button.addEventListener("click", loadMore);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "700px 0px" });
    observer.observe(button);
    updateButton();
  }

  function proseMarkup(value = "") {
    const paragraphs = String(value).split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
    return paragraphs.map((paragraph, index) => `<p${index === 0 ? ' class="activity-lead"' : ""}>${escapeHTML(paragraph)}</p>`).join("");
  }

  function storyParts(value = "") {
    const sourceText = String(value).trim();
    if (!sourceText) return [];
    const original = sourceText.split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
    return original.flatMap((paragraph) => {
      if (paragraph.length <= 520) return [paragraph];
      const sentences = paragraph.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/gu) || [paragraph];
      const chunks = [];
      let chunk = "";
      sentences.forEach((sentence) => {
        const next = `${chunk} ${sentence.trim()}`.trim();
        if (chunk && next.length > 460) { chunks.push(chunk); chunk = sentence.trim(); }
        else chunk = next;
      });
      if (chunk) chunks.push(chunk);
      return chunks;
    });
  }

  function storyMarkup(activity, photos) {
    const parts = storyParts(activity.body || activity.description);
    const photoIndexes = photos.length ? [...new Set([0, Math.floor(photos.length / 2), photos.length - 1])].slice(0, Math.min(3, parts.length || 1)) : [];
    return parts.map((paragraph, index) => {
      const photoIndex = photoIndexes[index];
      const photo = photoIndex !== undefined ? photos[photoIndex] : null;
      const caption = photo ? displayCaption(photo.caption, activity.title) : "";
      return `<section class="activity-story-chapter"><p${index === 0 ? ' class="activity-lead"' : ""}>${escapeHTML(paragraph)}</p>${photo ? `<button class="activity-story-photo" type="button" data-story-photo="${photoIndex}" aria-label="Mở ảnh: ${escapeHTML(caption)}"><img ${mediaAttributes(photo, "medium", "(max-width:680px) 92vw, 62vw")} alt="${escapeHTML(photo.alt || caption)}" loading="lazy" decoding="async" /><span>${String(photoIndex + 1).padStart(2, "0")} / ${photos.length}</span></button>` : ""}</section>`;
    }).join("");
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
    return `<a class="activity-nav-card reveal ${direction}${previewSrc ? "" : ` activity-nav-card-editorial editorial-theme-${editorial.theme}`}" href="activity.html?year=${data.year}&id=${encodeURIComponent(activity.id)}"><span class="activity-nav-image${previewSrc ? "" : " activity-nav-image-empty"}"${previewSrc ? ` data-media-src="${escapeHTML(previewSrc)}" data-media-variant="thumbnail"` : ""} aria-hidden="true">${previewSrc ? "" : `<i class="editorial-icon">${editorial.icon}</i>`}</span><span class="activity-nav-overlay" aria-hidden="true"></span><span class="activity-nav-copy"><small>${direction === "previous" ? "← Hoạt động trước" : "Hoạt động tiếp →"}</small><strong>${escapeHTML(activity.title)}</strong><span>${escapeHTML(activity.date)}</span></span></a>`;
  }

  async function activityPhotos(activity, data) {
    if (activity.album?.manifest || activity.images?.length) return window.TeresaStore.loadAlbum(year, activity);
    return (data.gallery || []).filter((photo) => photo.event === activity.title || photo.event === activity.type);
  }

  function errorMarkup(message) {
    return `<section class="year-error"><h1>Ôi!</h1><p>${escapeHTML(message)}</p><a class="button" href="index.html#journey">Trở về hành trình</a></section>`;
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
      const photos = await activityPhotos(activity, data);
      const cover = activity.coverImage || activity.album?.preview?.[0] || photos[0] || "";
      const coverImage = source(cover, "original");
      const editorial = editorialVisual(activity.type);
      const previous = activityIndex > 0 ? data.activities[activityIndex - 1] : null;
      const next = activityIndex < data.activities.length - 1 ? data.activities[activityIndex + 1] : null;
      const yearUrl = `year.html?year=${year}#year-activities`;
      const initialPhotos = photos.slice(0, galleryBatchSize);

      document.title = `${activity.title} — Teresa Youth Choir`;
      document.querySelector("#back-to-year").href = yearUrl;
      const adminLink = window.TeresaStore.isAdmin() ? `<a class="button button-light" href="admin.html?year=${year}&activity=${encodeURIComponent(activity.id)}">Chỉnh sửa hoạt động ↗</a>` : "";
      app.innerHTML = `
        <section class="activity-hero${coverImage ? "" : ` activity-hero-editorial editorial-theme-${editorial.theme}`}">
          <div class="activity-hero-bg${coverImage ? "" : " activity-hero-bg-empty"}">${coverImage ? `<img ${mediaAttributes(cover, "original", "100vw")} data-media-priority="high" alt="" loading="eager" decoding="async" />` : `<span class="activity-editorial-year" aria-hidden="true">${year}</span><i class="activity-editorial-icon" aria-hidden="true">${editorial.icon}</i><small>Tư liệu hình ảnh đang được bổ sung</small>`}</div>
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
              <div class="activity-fact"><span>Kho ảnh</span><strong>${photos.length ? `${photos.length} khoảnh khắc` : "Đang cập nhật"}</strong></div>
            </aside>
            <article class="activity-story reveal">
              <p class="activity-story-kicker">Câu chuyện được lưu lại</p>
              <h2>${escapeHTML(activity.title)}</h2>
              <div class="activity-prose activity-story-flow">${storyMarkup(activity, photos)}</div>
            </article>
          </div>
        </section>
        <section class="activity-gallery-section" aria-labelledby="activity-gallery-title">
          <div class="container">
            <div class="activity-section-heading reveal"><div><span>Ảnh — tư liệu</span><strong>${String(photos.length).padStart(2, "0")}</strong></div><h2 id="activity-gallery-title">Những khoảnh khắc<br /><em>còn ở lại.</em></h2></div>
            ${photos.length ? `<div class="activity-gallery">${initialPhotos.map((photo, index) => photoMarkup(photo, activity, index)).join("")}</div><div class="gallery-more-wrap"><button class="gallery-load-more" type="button" data-gallery-more>Xem thêm ảnh</button></div>` : '<div class="activity-empty reveal"><span aria-hidden="true">◇</span><h3>Kho ảnh đang được hoàn thiện</h3><p>Nội dung hoạt động vẫn được lưu trọn vẹn. Ảnh bìa và ảnh tư liệu có thể bổ sung sau trong khu quản trị.</p></div>'}
          </div>
        </section>
        <section class="activity-navigation"><div class="container"><p class="eyebrow">Tiếp tục hành trình ${year}</p><div class="activity-nav-grid">${navigationCard(previous, data, "previous")}${navigationCard(next, data, "next")}</div></div></section>`;

      await window.TeresaStore.hydrateMedia(app);
      loading.hidden = true;
      app.hidden = false;
      window.TeresaUI?.initReveal(app);
      window.TeresaUI?.initLightbox();
      initProgressiveGallery(photos, activity);
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
