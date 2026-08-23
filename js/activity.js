(function () {
  "use strict";
  const params = new URLSearchParams(window.location.search);
  const year = Number(params.get("year"));
  const activityId = params.get("id");
  const app = document.querySelector("#activity-app");
  const galleryBatchSize = window.matchMedia("(max-width: 560px)").matches ? 8 : 18;
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function photoMarkup(photo, activity, index) {
    return `<button class="gallery-item activity-photo reveal" type="button" data-full="${escapeHTML(photo.src)}" data-caption="${escapeHTML(photo.caption || activity.title)}"><img data-media-src="${escapeHTML(photo.src)}" src="images/hero.jpg" alt="${escapeHTML(photo.alt || activity.title)}" loading="lazy" decoding="async" fetchpriority="low" /><span class="activity-photo-index">${String(index + 1).padStart(2, "0")}</span><span><small>${escapeHTML(activity.topic || activity.type)}</small><strong>${escapeHTML(photo.caption || activity.title)}</strong></span></button>`;
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
      button.textContent = remaining ? `Xem thêm ${Math.min(galleryBatchSize, remaining)} ảnh · còn ${remaining}` : "Đã mở toàn bộ ảnh";
    };
    const loadMore = async () => {
      if (loadingBatch || rendered >= photos.length) return;
      loadingBatch = true;
      const batch = photos.slice(rendered, rendered + galleryBatchSize);
      grid.insertAdjacentHTML("beforeend", batch.map((photo, index) => photoMarkup(photo, activity, rendered + index)).join(""));
      rendered += batch.length;
      await window.TeresaStore?.hydrateMedia(grid);
      window.TeresaUI?.initReveal(grid);
      window.TeresaUI?.initLightbox();
      window.TeresaUI?.initLiquidGlass(grid);
      updateButton();
      loadingBatch = false;
    };
    button.addEventListener("click", loadMore);
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) loadMore();
      }, { rootMargin: "450px 0px" });
      observer.observe(button);
    }
    updateButton();
  }

  function proseMarkup(value = "") {
    const paragraphs = String(value).split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
    return paragraphs.map((paragraph, index) => `<p${index === 0 ? ' class="activity-lead"' : ""}>${escapeHTML(paragraph)}</p>`).join("");
  }

  function activityPreview(activity, data) {
    const matchingPhoto = (data.gallery || []).find((photo) => photo.event === activity.title || photo.event === activity.type);
    return activity.coverImage || activity.images?.[0]?.src || matchingPhoto?.src || data.overview.coverImage;
  }

  function navigationCard(activity, data, direction) {
    if (!activity) return '<span class="activity-nav-spacer"></span>';
    return `<a class="activity-nav-card reveal ${direction}" href="activity.html?year=${data.year}&id=${encodeURIComponent(activity.id)}"><span class="activity-nav-image" data-media-src="${escapeHTML(activityPreview(activity, data))}" aria-hidden="true"></span><span class="activity-nav-overlay" aria-hidden="true"></span><span class="activity-nav-copy"><small>${direction === "previous" ? "← Hoạt động trước" : "Hoạt động tiếp →"}</small><strong>${escapeHTML(activity.title)}</strong><span>${escapeHTML(activity.date)}</span></span></a>`;
  }

  async function render() {
    if (!window.TeresaStore || !Number.isInteger(year) || !activityId) {
      app.innerHTML = '<section class="year-error"><h1>Ôi!</h1><p>Liên kết hoạt động chưa hợp lệ.</p><a class="button" href="index.html#journey">Trở về hành trình</a></section>';
      return;
    }
    try {
      const data = await window.TeresaStore.loadYear(year);
      const activityIndex = data.activities.findIndex((item) => item.id === activityId);
      const activity = data.activities[activityIndex];
      if (!activity) throw new Error("Không tìm thấy hoạt động này.");
      document.title = `${activity.title} — Teresa Youth Choir`;
      document.querySelector("#back-to-year").href = `year.html?year=${year}`;
      const photos = activity.images?.length ? activity.images : (data.gallery || []).filter((photo) => photo.event === activity.title || photo.event === activity.type).slice(0, 6);
      const coverImage = activity.coverImage || photos[0]?.src || data.overview.coverImage;
      const previous = activityIndex > 0 ? data.activities[activityIndex - 1] : null;
      const next = activityIndex < data.activities.length - 1 ? data.activities[activityIndex + 1] : null;
      const adminLink = window.TeresaStore.isAdmin() ? `<a class="button button-light" href="admin.html?year=${year}&activity=${encodeURIComponent(activity.id)}">Chỉnh sửa hoạt động ↗</a>` : "";
      app.innerHTML = `
        <section class="activity-hero">
          <div class="activity-hero-bg" data-media-src="${escapeHTML(coverImage)}" data-media-priority="high"></div>
          <div class="activity-hero-grain" aria-hidden="true"></div>
          <div class="container activity-hero-content">
            <nav class="activity-breadcrumb" aria-label="Đường dẫn"><a href="index.html">Trang chủ</a><span>/</span><a href="year.html?year=${year}">Nhật ký ${year}</a><span>/</span><span>${escapeHTML(activity.type)}</span></nav>
            <div class="activity-hero-meta"><span>${escapeHTML(activity.type)}</span><time>${escapeHTML(activity.date)}</time></div>
            <h1>${escapeHTML(activity.title)}</h1>
            <p class="activity-hero-summary">${escapeHTML(activity.description)}</p>
            <div class="activity-actions"><a class="button button-primary" href="year.html?year=${year}">← Nhật ký ${year}</a>${adminLink}</div>
          </div>
          <a class="activity-scroll-cue" href="#activity-story"><span>Đọc câu chuyện</span><i aria-hidden="true">↓</i></a>
        </section>
        <section class="activity-story-section" id="activity-story">
          <div class="container activity-detail-grid">
            <aside class="activity-facts reveal" aria-label="Thông tin hoạt động">
              <p class="eyebrow">Tư liệu hoạt động</p>
              <div class="activity-fact"><span>Năm</span><strong>${year}</strong></div>
              <div class="activity-fact"><span>Thời gian</span><strong>${escapeHTML(activity.date)}</strong></div>
              <div class="activity-fact"><span>Chủ đề</span><strong>${escapeHTML(activity.topic || activity.type)}</strong></div>
              <div class="activity-fact"><span>Kho ảnh</span><strong>${photos.length ? `${photos.length} khoảnh khắc` : "Đang cập nhật"}</strong></div>
            </aside>
            <article class="activity-story reveal">
              <p class="activity-story-kicker">Câu chuyện được lưu lại</p>
              <h2>${escapeHTML(activity.title)}</h2>
              <div class="activity-prose">${proseMarkup(activity.body || activity.description)}</div>
            </article>
          </div>
        </section>
        <section class="activity-gallery-section">
          <div class="container">
            <div class="activity-section-heading reveal"><div><span>Ảnh — tư liệu</span><strong>${String(photos.length).padStart(2, "0")}</strong></div><h2>Những khoảnh khắc<br /><em>còn ở lại.</em></h2></div>
            ${photos.length ? `<div class="activity-gallery">${photos.slice(0, galleryBatchSize).map((photo, index) => photoMarkup(photo, activity, index)).join("")}</div><div class="gallery-more-wrap"><button class="gallery-load-more" type="button" data-gallery-more>Xem thêm ảnh</button></div>` : '<div class="activity-empty reveal"><span aria-hidden="true">◇</span><h3>Kho ảnh đang được hoàn thiện</h3><p>Những hình ảnh của hoạt động này sẽ sớm được bổ sung vào kho lưu trữ.</p></div>'}
          </div>
        </section>
        <section class="activity-navigation"><div class="container"><p class="eyebrow">Tiếp tục hành trình ${year}</p><div class="activity-nav-grid">${navigationCard(previous, data, "previous")}${navigationCard(next, data, "next")}</div></div></section>`;
      await window.TeresaStore.hydrateMedia(app);
      window.TeresaUI?.initReveal(app);
      window.TeresaUI?.initLightbox();
      window.TeresaUI?.initLiquidGlass(app);
      initProgressiveGallery(photos, activity);
    } catch (error) {
      app.innerHTML = `<section class="year-error"><h1>Ôi!</h1><p>${escapeHTML(error.message || "Không thể mở hoạt động.")}</p><a class="button" href="index.html#journey">Trở về hành trình</a></section>`;
    }
  }
  document.addEventListener("DOMContentLoaded", render);
})();
