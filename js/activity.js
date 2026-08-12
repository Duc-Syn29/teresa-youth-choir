(function () {
  "use strict";
  const params = new URLSearchParams(window.location.search);
  const year = Number(params.get("year"));
  const activityId = params.get("id");
  const app = document.querySelector("#activity-app");
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function photoMarkup(photo, activity) {
    return `<button class="gallery-item activity-photo" type="button" data-full="${escapeHTML(photo.src)}" data-caption="${escapeHTML(photo.caption || activity.title)}"><img data-media-src="${escapeHTML(photo.src)}" src="images/hero.jpg" alt="${escapeHTML(photo.alt || activity.title)}" loading="lazy" /><span><small>${escapeHTML(activity.topic || activity.type)}</small><strong>${escapeHTML(photo.caption || activity.title)}</strong></span></button>`;
  }

  async function render() {
    if (!window.TeresaStore || !Number.isInteger(year) || !activityId) {
      app.innerHTML = '<section class="year-error"><h1>Ôi!</h1><p>Liên kết hoạt động chưa hợp lệ.</p><a class="button" href="index.html#journey">Trở về hành trình</a></section>';
      return;
    }
    try {
      const data = await window.TeresaStore.loadYear(year);
      const activity = data.activities.find((item) => item.id === activityId);
      if (!activity) throw new Error("Không tìm thấy hoạt động này.");
      document.title = `${activity.title} — Teresa Youth Choir`;
      document.querySelector("#back-to-year").href = `year.html?year=${year}`;
      const photos = activity.images?.length ? activity.images : data.gallery.filter((photo) => photo.event === activity.title || photo.event === activity.type).slice(0, 6);
      const coverImage = activity.coverImage || photos[0]?.src || data.overview.coverImage;
      const adminLink = window.TeresaStore.isAdmin() ? `<a class="button button-light" href="admin.html?year=${year}&activity=${encodeURIComponent(activity.id)}">Chỉnh sửa hoạt động ↗</a>` : "";
      app.innerHTML = `
        <section class="activity-hero"><div class="activity-hero-bg" data-media-src="${escapeHTML(coverImage)}" style="background-image:url('${escapeHTML(coverImage)}')"></div><div class="container"><p class="eyebrow">${escapeHTML(activity.type)} · ${escapeHTML(activity.date)}</p><h1>${escapeHTML(activity.title)}</h1><p>${escapeHTML(activity.description)}</p><div class="activity-actions"><a class="button button-primary" href="year.html?year=${year}">← Nhật ký ${year}</a>${adminLink}</div></div></section>
        <section class="year-section"><div class="container activity-detail-grid"><article class="activity-body reveal"><p>${escapeHTML(activity.body || activity.description)}</p></article><aside class="activity-meta reveal"><span>Năm</span><strong>${year}</strong><span>Chủ đề</span><strong>${escapeHTML(activity.topic || activity.type)}</strong></aside></div></section>
        <section class="year-section activity-gallery-section"><div class="container"><div class="year-section-heading"><span class="index">ẢNH — TƯ LIỆU</span><h2>Khoảnh khắc của hoạt động</h2></div>${photos.length ? `<div class="year-gallery">${photos.map((photo) => photoMarkup(photo, activity)).join("")}</div>` : '<p class="empty-note">Chưa có ảnh cho hoạt động này. Quản trị viên có thể bổ sung ảnh trong khu quản trị.</p>'}</div></section>`;
      await window.TeresaStore.hydrateMedia(app);
      window.TeresaUI?.initReveal(app);
      window.TeresaUI?.initLightbox();
      window.TeresaUI?.initLiquidGlass(app);
    } catch (error) {
      app.innerHTML = `<section class="year-error"><h1>Ôi!</h1><p>${escapeHTML(error.message || "Không thể mở hoạt động.")}</p><a class="button" href="index.html#journey">Trở về hành trình</a></section>`;
    }
  }
  document.addEventListener("DOMContentLoaded", render);
})();
