/**
 * Đọc tham số ?year=YYYY, fetch file JSON tương ứng và tạo toàn bộ trang năm.
 * Muốn thêm năm mới: thêm JSON cùng schema và cập nhật VALID_YEARS.
 */
(function () {
  "use strict";

  const VALID_YEARS = Array.from({ length: 12 }, (_, index) => 2015 + index);
  const params = new URLSearchParams(window.location.search);
  const selectedYear = Number(params.get("year"));
  const app = document.querySelector("#year-app");
  const loading = document.querySelector("#year-loading");

  const escapeHTML = (value = "") =>
    String(value).replace(
      /[&<>'"]/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character],
    );

  const list = (items = []) => items.map((item) => `<li>${escapeHTML(item)}</li>`).join("");

  function sectionHeading(index, eyebrow, title, id) {
    return `
      <div class="year-section-heading reveal" id="${id}">
        <span class="index">${String(index).padStart(2, "0")} — ${escapeHTML(eyebrow)}</span>
        <h2>${escapeHTML(title)}</h2>
      </div>`;
  }

  function renderLeadership(leadership = {}) {
    const labels = {
      chaplain: "Cha đặc trách",
      leader: "Trưởng ca đoàn",
      deputyLeader: "Phó ca đoàn",
      conductor: "Ca trưởng",
      deputyConductor: "Ca phó",
      secretary: "Thư ký",
      treasurer: "Thủ quỹ",
    };
    const people = Object.entries(labels).map(([key, role]) => ({ role, ...(leadership[key] || {}) }));
    const serviceTeams = (leadership.teams || leadership.serviceTeams || []).map((team) => {
      const normalized = typeof team === "string" ? { name: team, members: [] } : team;
      return { role: normalized.name || "Ban phục vụ", name: (normalized.members || []).join(" · ") || "Đang cập nhật thành viên", note: "Ban phục vụ" };
    });

    return [...people, ...serviceTeams]
      .map(
        (person) => `
          <article class="person-card reveal">
            <span>${escapeHTML(person.role)}</span>
            <h3>${escapeHTML(person.name || "Đang cập nhật")}</h3>
            <p>${escapeHTML(person.note || "Phụng sự trong năm")}</p>
          </article>`,
      )
      .join("");
  }

  function renderActivities(activities = []) {
    const icons = { "Thánh lễ": "♪", "Lễ Quan thầy": "✦", "Hòa nhạc": "♫", "Thiện nguyện": "♡", "Tĩnh tâm": "☼", "Du lịch/Team Building": "↗", "Hội thao": "◎", "Giáng Sinh": "★", "Phục Sinh": "☀", "Hát lễ cưới": "∞" };
    return activities
      .map(
        (activity) => `
          <a class="year-activity reveal" href="activity.html?year=${encodeURIComponent(activity.year || "")}&id=${encodeURIComponent(activity.id || "")}">
            <span class="year-activity-icon" aria-hidden="true">${icons[activity.type] || "♪"}</span>
            <div>
              <small>${escapeHTML(activity.type)} · ${escapeHTML(activity.date)}</small>
              <h3>${escapeHTML(activity.title)}</h3>
              <p>${escapeHTML(activity.description)}</p>
            </div>
          </a>`,
      )
      .join("");
  }

  function renderGallery(gallery = []) {
    return gallery
      .map(
        (photo) => `
          <button class="gallery-item reveal" type="button" data-full="${escapeHTML(photo.src)}" data-caption="${escapeHTML(photo.caption)}">
            <img src="${escapeHTML(photo.src)}" data-media-src="${escapeHTML(photo.src)}" alt="${escapeHTML(photo.alt)}" loading="lazy" />
            <span><small>${escapeHTML(photo.event)}</small><strong>${escapeHTML(photo.caption)}</strong></span>
          </button>`,
      )
      .join("");
  }

  function renderQuotes(sharing = []) {
    return sharing
      .map(
        (item) => `
          <article class="quote-card reveal">
            <blockquote>“${escapeHTML(item.quote)}”</blockquote>
            <strong>${escapeHTML(item.name)}</strong>
            <small>${escapeHTML(item.role)}</small>
          </article>`,
      )
      .join("");
  }

  function renderJournal(entries = []) {
    return entries
      .map(
        (entry) => `
          <article class="journal-entry reveal">
            <time class="journal-date">${escapeHTML(entry.date)}</time>
            <div><h3>${escapeHTML(entry.title)}</h3><p>${escapeHTML(entry.text)}</p></div>
            <span class="journal-mood">${escapeHTML(entry.mood)}</span>
          </article>`,
      )
      .join("");
  }

  function yearSwitcher(year) {
    const previous = VALID_YEARS.includes(year - 1) ? `<a href="year.html?year=${year - 1}">← Nhật ký ${year - 1}</a>` : "<span></span>";
    const next = VALID_YEARS.includes(year + 1) ? `<a href="year.html?year=${year + 1}">Nhật ký ${year + 1} →</a>` : "<span></span>";
    return `<div class="year-switcher">${previous}${next}</div>`;
  }

  async function render(data) {
    const { year, overview, leadership, members, activities, achievements, challenges, gallery, sharing, emotionJournal, yearMark } = data;
    const storedMedia = (await window.TeresaStore?.getMedia({ year })) || [];
    const yearGallery = [
      ...gallery,
      ...storedMedia.map((media) => ({ src: `idb:${media.id}`, alt: media.alt, event: media.topic, caption: media.caption || media.filename })),
    ];
    document.title = `${year} — Teresa Youth Choir`;
    document.documentElement.style.setProperty("--year-accent", data.theme?.accent || "#f27f6b");

    app.innerHTML = `
      <section class="year-hero">
        <div class="year-hero-bg" style="background-image:url('${escapeHTML(overview.coverImage)}')" data-media-src="${escapeHTML(overview.coverImage)}"></div>
        <div class="year-glass-orb" aria-hidden="true"></div>
        <div class="container year-hero-content">
          <div class="year-number">${year}</div>
          <div class="year-intro">
            <p class="eyebrow">${escapeHTML(overview.eyebrow)}</p>
            <h1>${escapeHTML(overview.title)}</h1>
            <p>${escapeHTML(overview.summary)}</p>
            <p class="year-verse">${escapeHTML(overview.verse)}</p>
          </div>
        </div>
      </section>

      <nav class="year-nav" aria-label="Mục lục năm ${year}">
        <div class="container year-nav-inner">
          <a href="#overview">Tổng quan</a><a href="#leadership">Ban điều hành</a><a href="#members">Thành viên</a>
          <a href="#year-activities">Hoạt động</a><a href="#reflection">Nhìn lại</a><a href="#year-album">Album</a>
          <a href="#sharing">Lời chia sẻ</a><a href="#journal">Nhật ký</a>
        </div>
      </nav>

      <section class="year-section" aria-labelledby="overview">
        <div class="container">
          ${sectionHeading(1, "Tổng quan năm", overview.title, "overview")}
          <div class="overview-grid">
            <article class="overview-story reveal"><p>${escapeHTML(overview.longDescription)}</p></article>
            <article class="year-mark-card reveal"><small>Dấu ấn ${year}</small><strong>${escapeHTML(yearMark.title)}</strong><span>${escapeHTML(yearMark.highlight)}</span></article>
          </div>
        </div>
      </section>

      <section class="year-section" aria-labelledby="leadership">
        <div class="container">
          ${sectionHeading(2, "Những người phục vụ", "Ban điều hành", "leadership")}
          <div class="leadership-grid">${renderLeadership(leadership)}</div>
        </div>
      </section>

      <section class="year-section" aria-labelledby="members">
        <div class="container">
          ${sectionHeading(3, "Gia đình Têrêsa", "Thành viên", "members")}
          <div class="member-stats">
            <article class="member-stat reveal"><strong>${members.total}</strong><span>Tổng số ca viên</span></article>
            <article class="member-stat reveal"><strong>+${members.new}</strong><span>Ca viên mới</span></article>
            <article class="member-stat reveal"><strong>${members.inactive}</strong><span>Thành viên nghỉ</span></article>
          </div>
          <p class="member-note reveal">${escapeHTML(members.notes)}</p>
        </div>
      </section>

      <section class="year-section" aria-labelledby="year-activities">
        <div class="container">
          ${sectionHeading(4, "Những ngày cùng nhau", "Hoạt động trong năm", "year-activities")}
          <div class="year-activities">${renderActivities(activities.map((activity) => ({ ...activity, year })))}</div>
        </div>
      </section>

      <section class="year-section" aria-labelledby="reflection">
        <div class="container">
          ${sectionHeading(5, "Thành tựu & thử thách", "Nhìn lại để lớn lên", "reflection")}
          <div class="reflection-grid">
            <article class="reflection-card achievement reveal"><h3>Điều đã làm được</h3><ul>${list(achievements)}</ul></article>
            <article class="reflection-card challenge reveal"><h3>Điều còn trăn trở</h3><ul>${list(challenges)}</ul></article>
          </div>
        </div>
      </section>

      <section class="year-section" aria-labelledby="year-album">
        <div class="container">
          ${sectionHeading(6, "Khoảnh khắc", `Album ${year}`, "year-album")}
          <div class="year-gallery">${renderGallery(yearGallery)}</div>
          <p class="gallery-note">Ảnh được thêm qua khu quản trị sẽ tự xuất hiện ở đây, theo năm và chủ đề đã chọn.</p>
        </div>
      </section>

      <section class="year-section" aria-labelledby="sharing">
        <div class="container">
          ${sectionHeading(7, "Thanh âm ở lại", "Lời chia sẻ", "sharing")}
          <div class="quote-grid">${renderQuotes(sharing)}</div>
        </div>
      </section>

      <section class="year-section" aria-labelledby="journal">
        <div class="container">
          ${sectionHeading(8, "Nhật ký cảm xúc", "Những dòng chưa quên", "journal")}
          <div class="journal-list">${renderJournal(emotionJournal)}</div>
        </div>
      </section>

      <section class="year-signature">
        <div class="container reveal">
          <p class="eyebrow">Dấu ấn của năm</p>
          <h2>${escapeHTML(yearMark.title)}</h2>
          <p>${escapeHTML(yearMark.description)}</p>
          ${yearSwitcher(year)}
        </div>
      </section>`;

    loading.hidden = true;
    app.hidden = false;
    await window.TeresaStore?.hydrateMedia(app);
    window.TeresaUI?.initReveal(app);
    window.TeresaUI?.initLightbox();
    window.TeresaUI?.initLiquidGlass(app);
  }

  function renderError(message) {
    loading.hidden = true;
    app.hidden = false;
    app.innerHTML = `
      <section class="year-error">
        <h1>Ôi!</h1>
        <p>${escapeHTML(message)}</p>
        <a class="button" href="index.html#journey">Trở về hành trình</a>
      </section>`;
  }

  async function loadYear() {
    if (!VALID_YEARS.includes(selectedYear)) {
      renderError("Năm bạn chọn chưa có trong kho lưu trữ 2015–2026.");
      return;
    }

    try {
      if (!window.TeresaStore) throw new Error("Kho dữ liệu chưa sẵn sàng");
      await render(await window.TeresaStore.loadYear(selectedYear));
    } catch (error) {
      console.error("Không thể đọc dữ liệu năm:", error);
      renderError("Không thể mở dữ liệu. Hãy chạy website bằng Live Server thay vì mở file trực tiếp.");
    }
  }

  document.addEventListener("DOMContentLoaded", loadYear);
})();
