/**
 * Tương tác dùng chung cho trang chủ và trang chi tiết năm.
 * Không dùng thư viện ngoài để dễ deploy trên GitHub/Cloudflare Pages.
 */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 820px)").matches;
  let pageReturnController = null;
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const activityGroups = {
    liturgy: {
      title: "Phụng vụ & Thánh nhạc",
      description: "Thánh lễ, lễ Quan thầy, Giáng Sinh, Phục Sinh, hòa nhạc và những dịp phụng vụ đặc biệt qua các thế hệ.",
      types: ["phung vu", "thanh le", "le quan thay", "giang sinh", "phuc sinh", "thanh nhac", "hoa nhac", "hat le cuoi", "hon phoi", "dai le"],
    },
    bonding: {
      title: "Gắn kết",
      description: "Những chuyến đi, ngày hội, hoạt động đội nhóm và khoảnh khắc cùng nhau lớn lên.",
      types: ["gan ket", "sinh hoat", "giao luu", "du lich/team building", "hoi thao", "dai hoi", "thanh lap", "hoc hoi"],
    },
    charity: {
      title: "Thiện nguyện",
      description: "Những hành trình sẻ chia, trao tặng và hiện diện bên những cộng đồng cần được nâng đỡ.",
      types: ["thien nguyen"],
    },
    retreat: {
      title: "Tĩnh tâm",
      description: "Những khoảng lặng cầu nguyện, giao hòa và làm mới đời sống đức tin trong suốt hành trình.",
      types: ["tinh tam", "tam linh", "cau nguyen"],
    },
  };

  function normalizeText(value = "") {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").trim().toLowerCase();
  }

  function initHeader() {
    const header = document.querySelector(".site-header");
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".main-nav");
    if (!header) return;

    const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 40);
    let headerTicking = false;
    const requestHeaderUpdate = () => {
      if (headerTicking) return;
      headerTicking = true;
      requestAnimationFrame(() => {
        updateHeader();
        headerTicking = false;
      });
    };
    updateHeader();
    window.addEventListener("scroll", requestHeaderUpdate, { passive: true });

    if (toggle && nav) {
      const menuMedia = window.matchMedia("(max-width: 980px)");
      nav.inert = menuMedia.matches;
      const setMenu = (open, returnFocus = false) => {
        open = Boolean(open && menuMedia.matches);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
        nav.classList.toggle("open", open);
        nav.inert = menuMedia.matches && !open;
        document.body.classList.toggle("menu-open", open);
        if (open) requestAnimationFrame(() => nav.querySelector("a")?.focus({ preventScroll: true }));
        else if (returnFocus) toggle.focus({ preventScroll: true });
      };
      const syncMenuMode = () => setMenu(false);
      menuMedia.addEventListener?.("change", syncMenuMode);
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") === "true";
        setMenu(!open, open);
      });

      nav.addEventListener("click", (event) => {
        if (!event.target.closest("a")) return;
        setMenu(false);
      });

      document.addEventListener("keydown", (event) => {
        if (toggle.getAttribute("aria-expanded") !== "true") return;
        if (event.key === "Escape") {
          event.preventDefault();
          setMenu(false, true);
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = [...header.querySelectorAll('a[href], button:not([disabled])')].filter((element) => !element.inert);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    // Đánh dấu mục menu theo section đang xem trên trang chủ.
    const sections = [...document.querySelectorAll("main > section[id]")];
    const localNavLinks = [...document.querySelectorAll('.main-nav a[href^="#"]')];
    if (sections.length && localNavLinks.length) {
      const spy = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            localNavLinks.forEach((link) => {
              link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
            });
          });
        },
        { rootMargin: "-40% 0px -50% 0px" },
      );
      sections.forEach((section) => spy.observe(section));
    }
  }

  function initPageReturn() {
    const stateKey = `teresa:view:${window.location.pathname}${window.location.search}`;
    const isYearPage = document.body.classList.contains("year-page") && document.querySelector("#year-app");
    const isActivityPage = document.body.classList.contains("year-page") && document.querySelector("#activity-app");
    const isManagedPage = isYearPage || isActivityPage;
    let restored = false;
    const readState = () => {
      try { return history.state?.teresaView || JSON.parse(sessionStorage.getItem(stateKey) || "null"); }
      catch (_error) { return null; }
    };
    const writeState = (value) => {
      try {
        sessionStorage.setItem(stateKey, JSON.stringify(value));
        history.replaceState({ ...(history.state || {}), teresaView: value }, "");
      }
      catch (_error) { /* Safari Private có thể từ chối sessionStorage. */ }
    };
    const collectState = (pending = Boolean(readState()?.pending)) => ({
      ...(readState() || {}),
      scrollY: Math.max(0, Math.round(window.scrollY)),
      yearNavLeft: Math.max(0, Math.round(document.querySelector(".year-nav")?.scrollLeft || 0)),
      albumFilter: document.querySelector("[data-album-filter].active")?.dataset.albumFilter || "all",
      albumSearch: document.querySelector("[data-album-search]")?.value || "",
      activeSection: document.querySelector(".year-nav a[aria-current]")?.getAttribute("href") || "",
      pending,
      savedAt: Date.now(),
    });
    const saveState = (pending) => {
      if (isManagedPage) writeState(collectState(pending));
    };

    // Chỉ khôi phục vị trí sau khi rời trang năm để mở một hoạt động. Một lần
    // truy cập mới vào trang năm vẫn bắt đầu từ đầu như bình thường.
    document.addEventListener("click", (event) => {
      if (!isManagedPage || !event.target.closest('a[href*="activity.html?"], a[href*="year.html?"]')) return;
      saveState(true);
    }, { capture: true });
    window.addEventListener("pagehide", () => {
      if (isManagedPage) saveState(Boolean(readState()?.pending));
    });
    document.addEventListener("teresa:view-state", (event) => {
      if (!isManagedPage) return;
      writeState({ ...collectState(Boolean(readState()?.pending)), ...(event.detail || {}) });
    });

    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      document.documentElement.classList.add("page-restored");
      requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("page-restored")));
    });

    const restoreViewState = () => {
      if (!isManagedPage || restored) return false;
      const state = readState();
      if (!state?.pending || Date.now() - Number(state.savedAt || 0) > 30 * 60 * 1000) return false;
      const app = document.querySelector("#year-app, #activity-app");
      if (!app || app.hidden || !app.children.length) return false;
      restored = true;
      document.documentElement.classList.add("page-restoring");
      const filter = state.albumFilter || "all";
      document.querySelectorAll("[data-album-filter]").forEach((button) => {
        const active = button.dataset.albumFilter === filter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll("[data-album-index]").forEach((card) => {
        const query = String(state.albumSearch || "").trim().toLocaleLowerCase("vi");
        card.classList.toggle("hidden", (filter !== "all" && card.dataset.albumType !== filter) || (query && !card.dataset.albumTitle?.includes(query)));
      });
      const search = document.querySelector("[data-album-search]");
      if (search) search.value = state.albumSearch || "";
      if (state.activeSection) document.querySelectorAll(".year-nav a").forEach((link) => link.toggleAttribute("aria-current", link.getAttribute("href") === state.activeSection));
      document.dispatchEvent(new CustomEvent("teresa:restore-view-state", { detail: state }));
      const finish = () => {
        const rail = document.querySelector(".year-nav");
        if (rail) rail.scrollLeft = Number(state.yearNavLeft || 0);
        window.scrollTo({ top: Number(state.scrollY || 0), behavior: "auto" });
      };
      requestAnimationFrame(() => requestAnimationFrame(() => {
        finish();
        window.setTimeout(finish, 140);
        window.setTimeout(() => document.documentElement.classList.remove("page-restoring"), 360);
      }));
      writeState({ ...state, pending: false });
      return true;
    };

    document.addEventListener("teresa:page-rendered", restoreViewState);
    document.addEventListener("teresa:content-ready", restoreViewState);
    const app = document.querySelector("#year-app, #activity-app");
    if (app) {
      const observer = new MutationObserver(() => {
        if (restoreViewState()) observer.disconnect();
      });
      observer.observe(app, { attributes: true, attributeFilter: ["hidden"], childList: true });
    }

    const bindYearRail = () => {
      const rail = document.querySelector(".year-nav");
      if (!rail || rail.dataset.wheelBound) return;
      rail.dataset.wheelBound = "true";
      rail.addEventListener("wheel", (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || !rail.scrollWidth) return;
        const atStart = rail.scrollLeft <= 0;
        const atEnd = Math.ceil(rail.scrollLeft + rail.clientWidth) >= rail.scrollWidth;
        if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return;
        rail.scrollLeft += event.deltaY;
        event.preventDefault();
      }, { passive: false });
    };
    bindYearRail();
    document.addEventListener("teresa:page-rendered", bindYearRail);
    document.addEventListener("teresa:content-ready", bindYearRail);

    return { saveState, restoreViewState };
  }

  function initPageTransitions() {
    const storageKey = "teresa:route-transition";
    const samePage = (url) => url.origin === location.origin && url.pathname === location.pathname && url.search === location.search;
    const imageFrom = (link) => {
      const visual = link.querySelector("img, [data-media-src]");
      if (visual?.currentSrc || visual?.src) return visual.currentSrc || visual.src;
      if (visual?.dataset.mediaSrc) return visual.dataset.mediaSrc;
      return link.dataset.transitionImage || "";
    };
    const visualFrom = (link) => link.querySelector(".year-activity-media, .activity-nav-image, .activity-archive-event-media, img") || link;
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href*="year.html?"], a[href*="activity.html?"]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (samePage(url)) return;
      const visual = visualFrom(link);
      const rect = visual.getBoundingClientRect();
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ href: `${url.pathname}${url.search}`, image: imageFrom(link), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, savedAt: Date.now() }));
      } catch (_error) { /* Chuyển trang vẫn hoạt động nếu Safari chặn storage. */ }
      visual.style.viewTransitionName = "teresa-cover";
      document.documentElement.classList.add("page-leaving");
    }, { capture: true });

    const complete = (target) => {
      if (!target) return;
      target.style.viewTransitionName = "teresa-cover";
      let saved;
      try { saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch (_error) { saved = null; }
      const currentHref = `${location.pathname}${location.search}`;
      if (!saved || saved.href !== currentHref || Date.now() - saved.savedAt > 12000 || !saved.image) return;
      try { sessionStorage.removeItem(storageKey); } catch (_error) { /* Không bắt buộc. */ }
      if (reduceMotion) return;
      const end = target.getBoundingClientRect();
      const start = saved.rect;
      const overlay = document.createElement("div");
      overlay.className = "route-cover-transition";
      overlay.style.cssText = `left:${start.x}px;top:${start.y}px;width:${start.width}px;height:${start.height}px;background-image:url(${JSON.stringify(saved.image)})`;
      document.body.append(overlay);
      overlay.animate([
        { left: `${start.x}px`, top: `${start.y}px`, width: `${start.width}px`, height: `${start.height}px`, borderRadius: "1.5rem", opacity: 1 },
        { left: `${end.x}px`, top: `${end.y}px`, width: `${end.width}px`, height: `${end.height}px`, borderRadius: getComputedStyle(target).borderRadius || "0", opacity: 1 },
      ], { duration: 520, easing: "cubic-bezier(.2,.75,.2,1)", fill: "forwards" }).finished.finally(() => overlay.remove());
    };
    window.TeresaUI = { ...(window.TeresaUI || {}), completeCoverTransition: complete };
  }

  async function initArchiveOverview() {
    const timeline = document.querySelector(".timeline");
    if (!timeline || !window.TeresaStore?.loadIndex) return false;
    try {
      const index = await window.TeresaStore.loadIndex();
      const years = [...(index.years || [])].filter((item) => Number.isInteger(Number(item.year))).sort((a, b) => Number(a.year) - Number(b.year));
      if (!years.length) return false;
      const oldest = Number(years[0].year);
      const newest = Number(years.at(-1).year);
      timeline.setAttribute("aria-label", `Hành trình từ ${oldest} đến ${newest}`);
      timeline.innerHTML = `<div class="timeline-line" aria-hidden="true"><span></span></div>${years.map((item) => `
        <a class="timeline-item${Number(item.year) === newest ? " featured" : ""}" href="year.html?year=${encodeURIComponent(item.year)}" data-transition-image="${escapeHTML(window.TeresaStore.mediaSource(item.overview?.coverImage, "medium") || "")}">
          <span class="timeline-dot" aria-hidden="true"></span>
          <span class="timeline-year">${escapeHTML(item.year)}</span>
          <span class="timeline-copy"><strong>${escapeHTML(item.overview?.title || `Năm ${item.year}`)}</strong><small>${escapeHTML(item.overview?.eyebrow || item.overview?.summary || "Mở trang nhật ký")}</small></span>
        </a>`).join("")}`;

      const heading = document.querySelector("#journey .section-heading .eyebrow");
      if (heading) heading.textContent = `${years.length} năm tư liệu — một hành trình`;
      const heroArchiveLabel = document.querySelector(".hero .eyebrow");
      if (heroArchiveLabel) heroArchiveLabel.textContent = `Digital Memory Archive · ${oldest}—${newest}`;
      const archiveDescription = document.querySelector("#activity-archive-description");
      if (archiveDescription && archiveDescription.textContent.includes("Đang mở")) {
        archiveDescription.textContent = `Đang mở kho tư liệu từ năm ${oldest} đến ${newest}…`;
      }
      const counters = [...document.querySelectorAll(".counter")];
      const totals = index.totals || {};
      const values = [years.length, Number(totals.members || 0), Number(totals.activities || 0)];
      counters.slice(0, 3).forEach((counter, position) => {
        if (!Number.isFinite(values[position]) || values[position] <= 0) return;
        counter.dataset.target = String(values[position]);
        counter.textContent = "0";
      });
      document.dispatchEvent(new CustomEvent("teresa:index-ready", { detail: index }));
      return true;
    } catch (error) {
      console.warn("Không thể cập nhật hành trình từ chỉ mục, giữ nội dung tĩnh:", error);
      return false;
    }
  }

  function initReveal(root = document) {
    const elements = [...root.querySelectorAll(".reveal:not([data-observed]), .timeline-item:not([data-observed])")];
    if (!elements.length) return;

    if (reduceMotion || !("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, currentObserver) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("visible");
          currentObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -7% 0px" },
    );

    elements.forEach((element, index) => {
      element.dataset.observed = "true";
      // Nhịp xuất hiện nhẹ cho nhóm card, giới hạn để không gây chậm.
      element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
      observer.observe(element);
    });
  }

  function initTimeline() {
    const timeline = document.querySelector(".timeline");
    if (!timeline) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      timeline.classList.add("animated");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry], currentObserver) => {
        if (!entry.isIntersecting) return;
        timeline.classList.add("animated");
        currentObserver.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(timeline);
  }

  function initYearNavigation() {
    const rail = document.querySelector(".year-nav");
    if (!rail || rail.dataset.spyBound) return;
    const links = [...rail.querySelectorAll('a[href^="#"]')];
    const label = rail.querySelector("[data-year-nav-label]");
    const targets = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
    if (!links.length || !targets.length || !("IntersectionObserver" in window)) return;
    rail.dataset.spyBound = "true";
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const active = links.find((link) => link.getAttribute("href") === `#${visible.target.id}`);
      links.forEach((link) => {
        const current = link === active;
        link.classList.toggle("active", current);
        if (current) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
      if (active) {
        if (label) label.textContent = active.textContent.trim();
        const left = Math.max(0, active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2);
        rail.scrollTo({ left, behavior: reduceMotion ? "auto" : "smooth" });
      }
    }, { rootMargin: "-32% 0px -58% 0px", threshold: [0, .25, .75] });
    targets.forEach((target) => observer.observe(target));
    const compactAt = Math.max(260, document.querySelector(".year-hero")?.offsetHeight * .62 || 260);
    const updateCompact = () => rail.classList.toggle("compact", window.scrollY > compactAt);
    updateCompact();
    window.addEventListener("scroll", updateCompact, { passive: true });
  }

  function initCounters() {
    const counters = [...document.querySelectorAll(".counter")];
    if (!counters.length) return;

    const archiveYearCount = document.querySelectorAll(".timeline-item").length;
    counters.forEach((counter) => {
      if (counter.hasAttribute("data-auto-years") && archiveYearCount) {
        counter.dataset.target = String(archiveYearCount);
      }
    });

    const animate = (counter) => {
      const target = Number(counter.dataset.target || 0);
      const suffix = counter.dataset.suffix || "";
      if (reduceMotion) {
        counter.textContent = `${target}${suffix}`;
        return;
      }
      const start = performance.now();
      const duration = 1500;
      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        counter.textContent = `${Math.floor(target * eased)}${suffix}`;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (reduceMotion || !("IntersectionObserver" in window)) {
      counters.forEach(animate);
      return;
    }

    const observer = new IntersectionObserver(
      (entries, currentObserver) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animate(entry.target);
          currentObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.65 },
    );
    counters.forEach((counter) => observer.observe(counter));
  }

  function initLiquidGlass(root = document) {
    const selectors = [
      ".button",
      ".stats-grid article",
      ".info-list",
      ".timeline-item",
      ".activity-card",
      ".gallery-filters button",
      ".contact-card",
      ".social-links a",
      ".back-to-top",
      ".year-nav",
      ".overview-story",
      ".year-mark-card",
      ".person-card",
      ".member-stat",
      ".activity-story",
      ".activity-fact",
      ".reflection-card",
      ".quote-card",
      ".year-switcher a",
    ];
    const surfaces = [...root.querySelectorAll(selectors.join(","))].filter(
      (surface) => !surface.hasAttribute("data-glass-ready"),
    );

    surfaces.forEach((surface) => {
      surface.dataset.glassReady = "true";
      surface.classList.add("glass-surface");
      if (reduceMotion || coarsePointer) return;
      const shine = document.createElement("span");
      shine.className = "liquid-glass-shine";
      shine.setAttribute("aria-hidden", "true");
      surface.append(shine);

      surface.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        const bounds = surface.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 100;
        const y = ((event.clientY - bounds.top) / bounds.height) * 100;
        surface.style.setProperty("--glass-x", `${x}%`);
        surface.style.setProperty("--glass-y", `${y}%`);
        surface.classList.add("glass-active");
      });
      surface.addEventListener("pointerleave", () => surface.classList.remove("glass-active"));
    });
  }

  function activityGroupKey(activity) {
    const type = normalizeText(activity?.type);
    const topic = normalizeText(activity?.topic);
    return Object.entries(activityGroups).find(([, group]) => group.types.includes(type) || group.types.includes(topic))?.[0] || "";
  }

  function initGalleryFilters() {
    const controls = document.querySelector(".gallery-filters");
    const grid = document.querySelector("#home-gallery-grid");
    const more = document.querySelector("#home-gallery-more");
    const note = document.querySelector("#home-gallery-note");
    if (!controls || !grid || !more) return;

    const batchSize = coarsePointer ? 6 : 12;
    const validFilters = new Set(["all", ...Object.keys(activityGroups)]);
    let activeFilter = "all";
    let visibleCount = batchSize;
    let events = [];
    let requestId = 0;

    try {
      const restored = sessionStorage.getItem("teresa:home-gallery-filter");
      if (validFilters.has(restored)) activeFilter = restored;
    } catch (_error) { /* Safari private mode may block storage. */ }

    const orderedEvents = () => {
      if (activeFilter !== "all") return events.filter((item) => item.group === activeFilter);
      const queues = Object.keys(activityGroups).map((group) => events.filter((item) => item.group === group));
      const balanced = [];
      while (queues.some((queue) => queue.length)) queues.forEach((queue) => { if (queue.length) balanced.push(queue.shift()); });
      return balanced;
    };

    const itemMarkup = (item, index) => {
      const layout = index % 9 === 0 ? " tall" : index % 9 === 4 ? " wide" : "";
      const label = activityGroups[item.group]?.title || item.topic || item.type || "Hoạt động";
      const caption = `${item.title} · ${item.year}`;
      return `
        <button class="gallery-item${layout} reveal" type="button" data-category="${item.group}" data-full="${escapeHTML(item.image)}" data-caption="${escapeHTML(caption)}">
          <img src="${escapeHTML(item.image)}" alt="${escapeHTML(`${item.title} — năm ${item.year}`)}" loading="lazy" decoding="async" />
          <span><small>${escapeHTML(label)} · ${item.year}</small><strong>${escapeHTML(item.title)}</strong></span>
        </button>`;
    };

    const render = async (reset = false) => {
      const renderRequest = ++requestId;
      if (reset) visibleCount = batchSize;
      const filtered = orderedEvents();
      const displayed = filtered.slice(0, visibleCount);
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = displayed.length
        ? displayed.map(itemMarkup).join("")
        : '<div class="gallery-grid-empty"><strong>Chưa có ảnh trong chủ đề này</strong><p>Ảnh mới sẽ tự xuất hiện tại đây sau khi được thêm vào hoạt động trong trang quản trị.</p></div>';
      const remaining = Math.max(0, filtered.length - displayed.length);
      more.hidden = remaining === 0;
      more.textContent = remaining ? `Xem thêm ${Math.min(batchSize, remaining)} ảnh` : "Đã hiển thị hết ảnh";
      if (note) note.textContent = displayed.length
        ? `Đang hiển thị ${displayed.length}/${filtered.length} hoạt động có ảnh${activeFilter === "all" ? " từ 4 chủ đề" : ` thuộc ${activityGroups[activeFilter]?.title || "chủ đề đã chọn"}`}.`
        : "Chủ đề này chưa có hoạt động kèm ảnh.";
      if (renderRequest !== requestId) return;
      await window.TeresaStore?.hydrateMedia(grid);
      initReveal(grid);
      initLightbox();
    };

    const setFilter = (filter) => {
      if (!validFilters.has(filter)) return;
      activeFilter = filter;
      controls.querySelectorAll("button[data-filter]").forEach((button) => {
        const active = button.dataset.filter === filter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      try { sessionStorage.setItem("teresa:home-gallery-filter", filter); } catch (_error) { /* Optional enhancement only. */ }
      render(true);
    };

    controls.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (button) setFilter(button.dataset.filter);
    });
    more.addEventListener("click", () => {
      visibleCount += batchSize;
      render();
    });

    const loadIndex = window.TeresaStore?.loadIndex
      ? window.TeresaStore.loadIndex()
      : fetch("data/index.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Không thể đọc chỉ mục tư liệu.")));
    loadIndex.then((index) => {
      events = (index.years || [])
        .flatMap((yearData) => (yearData.events || []).map((activity) => ({
          ...activity,
          year: Number(yearData.year),
          image: activity.image || "",
          group: activityGroupKey(activity),
        })))
        .filter((activity) => activity.image && activity.group)
        .sort((a, b) => b.year - a.year || String(a.date || "").localeCompare(String(b.date || "")));
      setFilter(activeFilter);
    }).catch((error) => {
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = `<div class="gallery-grid-empty"><strong>Chưa thể tải kho ảnh</strong><p>${escapeHTML(error.message || "Kết nối dữ liệu đang gián đoạn.")}</p></div>`;
      more.hidden = true;
      if (note) note.textContent = "Hãy tải lại trang để thử kết nối lại kho tư liệu.";
    });
  }

  function initActivityArchive() {
    const dialog = document.querySelector("#activity-archive-dialog");
    const cards = [...document.querySelectorAll("[data-activity-group]")];
    if (!dialog || !cards.length || typeof dialog.showModal !== "function") return;

    const title = dialog.querySelector("#activity-archive-title");
    const description = dialog.querySelector("#activity-archive-description");
    const count = dialog.querySelector("#activity-archive-count");
    const eventsRoot = dialog.querySelector("#activity-archive-events");
    const close = dialog.querySelector(".activity-archive-close");
    let archivePromise;
    let archiveRequest = 0;
    let activeTrigger = null;

    const loadArchive = () => {
      if (archivePromise) return archivePromise;
      archivePromise = (window.TeresaStore?.loadIndex
        ? window.TeresaStore.loadIndex()
        : fetch("data/index.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Không thể đọc chỉ mục tư liệu."))))
        .then((index) => index.years || [])
        .catch((error) => {
          archivePromise = undefined;
          throw error;
        });
      return archivePromise;
    };

    const eventMarkup = (item) => `
      <a class="activity-archive-event" href="activity.html?year=${item.year}&id=${encodeURIComponent(item.id)}">
        <span class="activity-archive-event-media${item.cover ? "" : " activity-archive-event-media-empty"}"${item.cover ? ` data-media-src="${escapeHTML(item.cover)}"` : ""} aria-hidden="true"></span>
        <span class="activity-archive-event-shade" aria-hidden="true"></span>
        <span class="activity-archive-event-copy">
          <span class="activity-archive-event-meta"><strong>${item.year}</strong><em>${escapeHTML(item.type)}</em></span>
          <span class="activity-archive-event-title">${escapeHTML(item.title)}</span>
          <span class="activity-archive-event-description">${escapeHTML(item.description)}</span>
          <span class="activity-archive-event-foot"><time>${escapeHTML(item.date)}</time><b>Mở hoạt động ↗</b></span>
        </span>
      </a>`;

    const openGroup = async (groupKey) => {
      const group = activityGroups[groupKey];
      if (!group) return;
      const requestId = ++archiveRequest;
      title.textContent = group.title;
      description.textContent = group.description;
      count.textContent = "Đang tổng hợp…";
      eventsRoot.innerHTML = '<div class="activity-archive-loading"><span aria-hidden="true">♪</span><p>Đang mở chỉ mục tư liệu của toàn bộ các năm…</p></div>';
      if (!dialog.open) dialog.showModal();
      document.body.classList.add("activity-archive-open");
      try {
        const years = await loadArchive();
        if (requestId !== archiveRequest || !dialog.open) return;
        const events = years
          .flatMap((yearData) => (yearData.events || []).map((activity) => ({
            ...activity,
            year: Number(yearData.year),
            cover: activity.image || ""
          })))
          .filter((activity) => group.types.includes(normalizeText(activity.type)) || group.types.includes(normalizeText(activity.topic)))
          .sort((a, b) => b.year - a.year);

        count.textContent = `${events.length} sự kiện · ${years.length} năm tư liệu`;
        eventsRoot.innerHTML = events.length
          ? events.map(eventMarkup).join("")
          : '<div class="activity-archive-empty"><strong>Chưa có sự kiện phù hợp</strong><p>Tư liệu của chủ đề này đang được tiếp tục bổ sung.</p></div>';
        await window.TeresaStore?.hydrateMedia(eventsRoot);
      } catch (error) {
        if (requestId !== archiveRequest) return;
        count.textContent = "Chưa thể tải kho sự kiện";
        eventsRoot.innerHTML = `<div class="activity-archive-empty"><strong>Kết nối đang gián đoạn</strong><p>${escapeHTML(error.message || "Không thể đọc chỉ mục tư liệu.")}</p><button class="button activity-archive-retry" type="button">Thử lại</button></div>`;
        eventsRoot.querySelector(".activity-archive-retry")?.addEventListener("click", () => openGroup(groupKey), { once: true });
      }
    };

    const closeDialog = () => {
      if (dialog.open) dialog.close();
      document.body.classList.remove("activity-archive-open");
      activeTrigger?.focus({ preventScroll: true });
    };

    cards.forEach((card) => {
      card.addEventListener("click", () => {
        activeTrigger = card;
        openGroup(card.dataset.activityGroup);
      });
    });
    close.addEventListener("click", closeDialog);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("close", () => document.body.classList.remove("activity-archive-open"));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });
  }

  function initLightbox() {
    const dialog = document.querySelector(".lightbox");
    if (!dialog || typeof dialog.showModal !== "function") return;
    const image = dialog.querySelector("figure img");
    const caption = dialog.querySelector("figcaption");
    const close = dialog.querySelector(".lightbox-close");
    const previous = dialog.querySelector(".lightbox-prev");
    const next = dialog.querySelector(".lightbox-next");
    const figure = dialog.querySelector("figure");
    let counter = figure.querySelector(".lightbox-counter");
    if (!counter) {
      counter = document.createElement("span");
      counter.className = "lightbox-counter";
      figure.prepend(counter);
    }
    const state = dialog._teresaState || { activeIndex: 0, customItems: null, albumTitle: "", touchStartX: 0, touchStartY: 0, requestId: 0, opener: null, lastTap: 0, zoomed: false };
    dialog._teresaState = state;

    const domItems = () => [...document.querySelectorAll(".gallery-item[data-full]:not(.hidden)")].map((item) => ({
      src: item.dataset.full,
      alt: item.querySelector("img")?.alt || "Ảnh kỷ niệm của ca đoàn",
      caption: item.dataset.caption || "Kỷ niệm Teresa Youth Choir",
    }));
    const items = () => state.customItems || domItems();
    const resolveItem = async (item) => {
      const candidate = window.TeresaStore?.mediaSource(item, "original") || item?.src || "";
      return window.TeresaStore?.resolveSource(candidate, "original") || candidate;
    };
    const preloadNext = (currentItems) => {
      if (currentItems.length < 2) return;
      [currentItems[(state.activeIndex + 1) % currentItems.length]].forEach(async (item) => {
        const src = await resolveItem(item);
        if (!src) return;
        const preload = new Image();
        preload.decoding = "async";
        preload.fetchPriority = "low";
        preload.src = src;
      });
    };
    const show = async (index) => {
      const currentItems = items();
      if (!currentItems.length) return;
      state.activeIndex = (index + currentItems.length) % currentItems.length;
      state.zoomed = false;
      image.classList.remove("is-zoomed");
      image.style.transform = "";
      figure.style.transform = "";
      const current = currentItems[state.activeIndex];
      const requestId = ++state.requestId;
      image.classList.add("is-changing");
      const resolved = await resolveItem(current);
      if (requestId !== state.requestId) return;
      image.alt = current.alt || "Ảnh kỷ niệm của ca đoàn";
      caption.textContent = current.caption || state.albumTitle || "Kỷ niệm Teresa Youth Choir";
      counter.textContent = `${state.activeIndex + 1} / ${currentItems.length}${state.albumTitle ? ` · ${state.albumTitle}` : ""}`;
      previous.disabled = currentItems.length < 2;
      next.disabled = currentItems.length < 2;
      const finish = () => {
        if (requestId !== state.requestId) return;
        image.classList.remove("is-changing");
        preloadNext(currentItems);
      };
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
      image.src = resolved;
      if (image.complete) requestAnimationFrame(finish);
    };
    const open = (customItems, index = 0, albumTitle = "") => {
      state.opener = document.activeElement;
      state.customItems = customItems?.length ? customItems : null;
      state.albumTitle = albumTitle;
      if (!dialog.open) dialog.showModal();
      document.body.classList.add("lightbox-open");
      show(index);
      requestAnimationFrame(() => close.focus({ preventScroll: true }));
    };
    window.TeresaUI = { ...(window.TeresaUI || {}), openLightbox: open };

    document.querySelectorAll(".gallery-item[data-full]").forEach((item) => {
      if (item.dataset.lightboxBound) return;
      item.dataset.lightboxBound = "true";
      item.addEventListener("click", () => {
        const visibleItems = [...document.querySelectorAll(".gallery-item[data-full]:not(.hidden)")];
        open(null, visibleItems.indexOf(item));
      });
    });

    if (dialog.dataset.controlsBound) return;
    dialog.dataset.controlsBound = "true";
    const closeDialog = () => {
      state.requestId += 1;
      if (dialog.open) dialog.close();
      document.body.classList.remove("lightbox-open");
      state.customItems = null;
      state.albumTitle = "";
      state.opener?.focus?.({ preventScroll: true });
      state.opener = null;
    };
    close.addEventListener("click", closeDialog);
    previous.addEventListener("click", () => show(state.activeIndex - 1));
    next.addEventListener("click", () => show(state.activeIndex + 1));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("close", () => document.body.classList.remove("lightbox-open"));
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
      if (event.key === "ArrowLeft") show(state.activeIndex - 1);
      if (event.key === "ArrowRight") show(state.activeIndex + 1);
    });
    figure.addEventListener("touchstart", (event) => {
      state.touchStartX = event.changedTouches[0]?.clientX || 0;
      state.touchStartY = event.changedTouches[0]?.clientY || 0;
    }, { passive: true });
    figure.addEventListener("touchmove", (event) => {
      if (state.zoomed) return;
      const distanceX = (event.changedTouches[0]?.clientX || 0) - state.touchStartX;
      const distanceY = (event.changedTouches[0]?.clientY || 0) - state.touchStartY;
      if (distanceY > 0 && Math.abs(distanceY) > Math.abs(distanceX)) {
        dialog.classList.add("is-dragging");
        figure.style.transform = `translate3d(0,${Math.min(distanceY, 240)}px,0) scale(${Math.max(.88, 1 - distanceY / 1100)})`;
        event.preventDefault();
      } else if (Math.abs(distanceX) > 8) {
        figure.style.transform = `translate3d(${Math.max(-90, Math.min(90, distanceX * .3))}px,0,0)`;
      }
    }, { passive: false });
    figure.addEventListener("touchend", (event) => {
      const distanceX = (event.changedTouches[0]?.clientX || 0) - state.touchStartX;
      const distanceY = (event.changedTouches[0]?.clientY || 0) - state.touchStartY;
      dialog.classList.remove("is-dragging");
      figure.style.transform = "";
      const now = Date.now();
      if (Math.abs(distanceX) < 12 && Math.abs(distanceY) < 12 && now - state.lastTap < 320) {
        state.zoomed = !state.zoomed;
        image.classList.toggle("is-zoomed", state.zoomed);
        state.lastTap = 0;
        event.preventDefault();
        return;
      }
      state.lastTap = now;
      if (!state.zoomed && distanceY > 110 && Math.abs(distanceY) > Math.abs(distanceX)) return closeDialog();
      if (!state.zoomed && Math.abs(distanceX) >= 48 && Math.abs(distanceX) > Math.abs(distanceY)) show(state.activeIndex + (distanceX < 0 ? 1 : -1));
    }, { passive: false });
  }

  function initBackToTop() {
    const button = document.querySelector(".back-to-top");
    if (!button) return;
    const update = () => button.classList.toggle("visible", window.scrollY > 700);
    let ticking = false;
    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));
  }

  function setCurrentYear() {
    document.querySelectorAll("[data-current-year]").forEach((node) => {
      node.textContent = new Date().getFullYear();
    });
  }

  function init() {
    initHeader();
    pageReturnController = initPageReturn();
    initPageTransitions();
    initYearNavigation();
    document.addEventListener("teresa:page-rendered", initYearNavigation);
    document.addEventListener("teresa:content-ready", initYearNavigation);
    initReveal();
    initArchiveOverview().finally(() => {
      const timeline = document.querySelector(".timeline");
      if (timeline) initReveal(timeline);
      initTimeline();
      initCounters();
    });
    initLiquidGlass();
    initActivityArchive();
    initGalleryFilters();
    initLightbox();
    initBackToTop();
    setCurrentYear();
  }

  // API nhỏ để year.js khởi tạo animation/lightbox sau khi render JSON.
  window.TeresaUI = {
    ...(window.TeresaUI || {}),
    initReveal,
    initLightbox,
    initLiquidGlass,
    notifyPageRendered: () => document.dispatchEvent(new CustomEvent("teresa:page-rendered")),
    restoreViewState: () => pageReturnController?.restoreViewState?.() || false,
    saveViewState: (pending = true) => pageReturnController?.saveState?.(pending),
  };
  document.addEventListener("DOMContentLoaded", init);
})();
