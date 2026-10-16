/**
 * Tương tác dùng chung cho trang chủ và trang chi tiết năm.
 * Không dùng thư viện ngoài để dễ deploy trên GitHub/Cloudflare Pages.
 */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 820px)").matches;
  let pageReturnController = null;
  const escapeHTML = window.TeresaPublic.escapeHTML;
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
      activityRendered: document.querySelectorAll(".activity-gallery .gallery-item").length,
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
      const saved = readState();
      // Initial album filters emit state while the new document is still at
      // scrollY=0. Keep the previous position until restoration has finished.
      const base = saved?.pending && !restored ? saved : collectState(Boolean(saved?.pending));
      writeState({ ...base, ...(event.detail || {}) });
    });

    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      document.documentElement.classList.remove("page-leaving", "route-arriving");
      document.querySelectorAll(".route-pressed").forEach((element) => element.classList.remove("route-pressed"));
      document.documentElement.classList.add("page-restored", "page-returning");
      requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("page-restored")));
      window.setTimeout(() => document.documentElement.classList.remove("page-returning"), 320);
    });

    // Khi hoạt động được mở trực tiếp từ trang năm, quay lại bằng history để
    // trình duyệt khôi phục nguyên DOM, ảnh đã tải và vị trí cuộn từ bfcache.
    if (isActivityPage && document.referrer) {
      let referringYear = 0;
      try {
        const referrer = new URL(document.referrer);
        if (referrer.origin === location.origin && (referrer.pathname.endsWith("/year.html") || /\/nhat-ky-\d{4}(?:\.html)?$/.test(referrer.pathname))) referringYear = Number(referrer.searchParams.get("year") || window.TeresaPublic?.route(referrer.pathname)?.year);
      } catch (_error) { /* Liên kết quay lại thông thường vẫn hoạt động. */ }
      document.addEventListener("click", (event) => {
        const link = event.target.closest('a[href*="year.html?year="],a[href*="nhat-ky-"]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
        const destination = new URL(link.href, location.href);
        if (!referringYear || Number(destination.searchParams.get("year") || window.TeresaPublic?.route(destination.pathname)?.year) !== referringYear) return;
        event.preventDefault();
        document.documentElement.classList.add("page-leaving");
        requestAnimationFrame(() => history.back());
      }, { capture: true });
    }

    const restoreViewState = () => {
      if (!isManagedPage || restored) return false;
      const state = readState();
      if (!state?.pending || Date.now() - Number(state.savedAt || 0) > 30 * 60 * 1000) return false;
      const app = document.querySelector("#year-app, #activity-app");
      if (!app || app.hidden || !app.children.length) return false;
      if (isActivityPage && app.querySelector("[data-activity-gallery]")?.dataset.loading === "true") return false;
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
    // Hash targets do not exist until the year/article JSON has rendered.
    // A saved return position takes precedence over the initial deep link.
    let followedInitialHash = false;
    document.addEventListener("teresa:content-ready", () => {
      if (!isManagedPage || restored || followedInitialHash || !location.hash || readState()?.pending) return;
      let id;
      try { id = decodeURIComponent(location.hash.slice(1)); } catch (_error) { return; }
      const target = document.getElementById(id);
      if (!target) return;
      followedInitialHash = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: "instant" }));
    });
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
    let pressedLink = null;
    let releaseTimer = 0;
    const releasePressed = (immediate = false) => {
      window.clearTimeout(releaseTimer);
      if (!pressedLink) return;
      const current = pressedLink;
      pressedLink = null;
      if (immediate) current.classList.remove("route-pressed");
      else releaseTimer = window.setTimeout(() => current.classList.remove("route-pressed"), 150);
    };
    document.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const link = event.target.closest('a[href*="year.html?"], a[href*="activity.html?"]');
      if (!link) return;
      releasePressed(true);
      pressedLink = link;
      link.classList.add("route-pressed");
    }, { passive: true });
    document.addEventListener("pointerup", () => releasePressed());
    document.addEventListener("pointercancel", () => releasePressed(true));
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
      if (!saved || saved.href !== currentHref || Date.now() - saved.savedAt > 12000) return;
      try { sessionStorage.removeItem(storageKey); } catch (_error) { /* Không bắt buộc. */ }
      if (reduceMotion) return;
      const duration = coarsePointer ? 360 : 480;
      document.documentElement.classList.add("route-arriving");
      window.setTimeout(() => document.documentElement.classList.remove("route-arriving"), duration + 80);
      if (!saved.image) return;
      const end = target.getBoundingClientRect();
      const start = saved.rect;
      if (!start || end.width < 1 || end.height < 1 || start.width < 1 || start.height < 1) return;
      const overlay = document.createElement("div");
      overlay.className = "route-cover-transition";
      overlay.style.cssText = `left:${end.x}px;top:${end.y}px;width:${end.width}px;height:${end.height}px;background-image:url(${JSON.stringify(saved.image)})`;
      document.body.append(overlay);
      const startTransform = `translate3d(${start.x - end.x}px,${start.y - end.y}px,0) scale(${start.width / end.width},${start.height / end.height})`;
      overlay.animate([
        { transform: startTransform, borderRadius: "1.5rem", opacity: 1 },
        { offset: .76, transform: "translate3d(0,0,0) scale(1)", borderRadius: getComputedStyle(target).borderRadius || "0", opacity: 1 },
        { transform: "translate3d(0,0,0) scale(1)", borderRadius: getComputedStyle(target).borderRadius || "0", opacity: 0 },
      ], { duration, easing: "cubic-bezier(.2,.75,.2,1)", fill: "forwards" }).finished.finally(() => overlay.remove());
    };
    window.TeresaUI = { ...(window.TeresaUI || {}), completeCoverTransition: complete };
  }

  function initRoutePrefetch() {
    if (!window.TeresaStore?.loadYear) return;
    const warmed = new Set();
    const selector = 'a[href*="year.html?"], a[href*="activity.html?"]';
    const warm = async (link) => {
      if (!link?.matches?.(selector)) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      const year = Number(url.searchParams.get("year"));
      if (!Number.isInteger(year)) return;
      const key = String(year);
      if (warmed.has(key)) return;
      warmed.add(key);
      try {
        await window.TeresaStore.loadYear(year);
      } catch (_error) {
        // Cho phép lần mở trang thật thử tải lại nếu kết nối làm nóng bị gián đoạn.
        warmed.delete(key);
      }
    };
    // Warm only links the visitor intends to open. Scrolling past a long list
    // must not compete with the visible cover and photos for mobile bandwidth.
    const warmFromEvent = (event) => {
      const connection = navigator.connection;
      if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return;
      warm(event.target.closest?.(selector));
    };
    document.addEventListener("pointerover", warmFromEvent, { passive: true });
    document.addEventListener("focusin", warmFromEvent);
    document.addEventListener("touchstart", warmFromEvent, { passive: true });
  }

  async function initArchiveOverview() {
    const timeline = document.querySelector(".timeline");
    if (!timeline || !window.TeresaStore?.loadIndex) return false;
    try {
      const index = await window.TeresaStore.loadIndex();
      const years = [...(index.years || [])].filter((item) => Number.isInteger(Number(item.year)) && window.TeresaSchema?.isYearPublic?.(item.year) !== false).sort((a, b) => Number(a.year) - Number(b.year));
      if (!years.length) return false;
      const oldest = Number(years[0].year);
      const newest = Number(years.at(-1).year);
      timeline.setAttribute("aria-label", `Hành trình từ ${oldest} đến ${newest}`);
      timeline.innerHTML = `<div class="timeline-line" aria-hidden="true"><span></span></div>${years.map((item) => `
        <a class="timeline-item${Number(item.year) === newest ? " featured" : ""}" href="year.html?year=${encodeURIComponent(item.year)}" data-transition-image="${escapeHTML(window.TeresaStore.mediaSource(item.overview?.coverImage, "medium") || "")}">
          <span class="timeline-dot" aria-hidden="true"></span>
          <span class="timeline-year">${escapeHTML(item.year)}</span>
          <span class="timeline-copy"><strong>${escapeHTML(item.overview?.title || `Năm ${item.year}`)}</strong><small>${escapeHTML(Number(item.year) === 2025 ? "Hành trình 10 năm tiếp nối" : Number(item.year) === new Date().getFullYear() ? "Hiện tại" : item.overview?.eyebrow || item.overview?.summary || "Mở trang nhật ký")}</small></span>
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
      const values = [
        years.length,
        years.reduce((total, item) => total + Math.max(0, Number(item.members?.total || 0)), 0),
        years.reduce((total, item) => total + (item.events || []).length, 0),
        years.reduce((total, item) => total + (item.events || []).length, 0),
      ];
      counters.slice(0, 4).forEach((counter, position) => {
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
      { threshold: 0.01, rootMargin: "0px 0px -7% 0px" },
    );

    elements.forEach((element, index) => {
      element.dataset.observed = "true";
      // Nhịp xuất hiện nhẹ cho nhóm card, giới hạn để không gây chậm.
      element.style.transitionDelay = `${coarsePointer ? 0 : Math.min(index % 4, 3) * 70}ms`;
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

    const thumbnailSource = (src = "") => String(src).replace(/\/medium\.jpg(?=$|[?#])/, "/thumb.jpg");

    const itemMarkup = (item, index) => {
      const layout = index % 9 === 0 ? " tall" : index % 9 === 4 ? " wide" : "";
      const label = activityGroups[item.group]?.title || item.topic || item.type || "Hoạt động";
      const caption = `${item.title} · ${item.year}`;
      return `
        <button class="gallery-item${layout} reveal" type="button" data-category="${item.group}" data-full="${escapeHTML(item.image)}" data-caption="${escapeHTML(caption)}">
          <img src="${escapeHTML(thumbnailSource(item.image))}"${thumbnailSource(item.image) !== item.image ? ` srcset="${escapeHTML(thumbnailSource(item.image))} 480w, ${escapeHTML(item.image)} 1280w" sizes="(max-width:680px) 92vw, 28vw"` : ""} alt="${escapeHTML(`${item.title} — năm ${item.year}`)}" loading="lazy" decoding="async" />
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
      events = (index.years || []).filter((yearData) => window.TeresaSchema?.isYearPublic?.(yearData.year) !== false)
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
    const search = dialog.querySelector("#activity-archive-search");
    const yearSelect = dialog.querySelector("#activity-archive-year");
    const close = dialog.querySelector(".activity-archive-close");
    let archivePromise;
    let archiveRequest = 0;
    let activeTrigger = null;
    let activeEvents = [];
    let availableYearCount = 0;

    const loadArchive = () => {
      if (archivePromise) return archivePromise;
      archivePromise = (window.TeresaStore?.loadIndex
        ? window.TeresaStore.loadIndex()
        : fetch("data/index.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Không thể đọc chỉ mục tư liệu."))))
        .then((index) => (index.years || []).filter((yearData) => window.TeresaSchema?.isYearPublic?.(yearData.year) !== false))
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

    const renderEvents = async () => {
      const query = normalizeText(search?.value || "");
      const selectedYear = Number(yearSelect?.value || 0);
      const visibleEvents = activeEvents.filter((item) => {
        if (selectedYear && item.year !== selectedYear) return false;
        if (!query) return true;
        return normalizeText([item.title, item.description, item.date, item.type, item.topic, item.year].join(" ")).includes(query);
      });
      const filterSuffix = query || selectedYear ? ` · ${activeEvents.length} tổng cộng` : "";
      count.textContent = `${visibleEvents.length} sự kiện${filterSuffix} · ${availableYearCount} năm tư liệu`;
      eventsRoot.innerHTML = visibleEvents.length
        ? visibleEvents.map(eventMarkup).join("")
        : '<div class="activity-archive-empty"><strong>Không tìm thấy sự kiện</strong><p>Hãy thử tên, chủ đề hoặc một năm khác.</p></div>';
      rewritePublicLinks(eventsRoot);
      await window.TeresaStore?.hydrateMedia(eventsRoot);
    };

    const updateYearOptions = (events) => {
      if (!yearSelect) return;
      const years = [...new Set(events.map((item) => item.year))].sort((a, b) => b - a);
      yearSelect.innerHTML = '<option value="">Tất cả các năm</option>' + years.map((year) => `<option value="${year}">${year}</option>`).join("");
    };

    const openGroup = async (groupKey) => {
      const group = activityGroups[groupKey];
      if (!group) return;
      const requestId = ++archiveRequest;
      title.textContent = group.title;
      description.textContent = group.description;
      count.textContent = "Đang tổng hợp…";
      if (search) search.value = "";
      if (yearSelect) yearSelect.value = "";
      eventsRoot.innerHTML = '<div class="activity-archive-loading"><span aria-hidden="true">♪</span><p>Đang mở chỉ mục tư liệu của toàn bộ các năm…</p></div>';
      if (!dialog.open) dialog.showModal();
      document.body.classList.add("activity-archive-open");
      try {
        const years = await loadArchive();
        if (requestId !== archiveRequest || !dialog.open) return;
        activeEvents = years
          .flatMap((yearData) => (yearData.events || []).map((activity) => ({
            ...activity,
            year: Number(yearData.year),
            cover: activity.image || ""
          })))
          .filter((activity) => group.types.includes(normalizeText(activity.type)) || group.types.includes(normalizeText(activity.topic)))
          .sort((a, b) => b.year - a.year);
        availableYearCount = years.length;
        updateYearOptions(activeEvents);
        await renderEvents();
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
    search?.addEventListener("input", renderEvents);
    yearSelect?.addEventListener("change", renderEvents);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("close", () => document.body.classList.remove("activity-archive-open"));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });
  }

  function initMemorySearch() {
    const query = document.querySelector("#memory-query");
    if (!query) return;
    const yearSelect = document.querySelector("#memory-year");
    const topicSelect = document.querySelector("#memory-topic");
    const results = document.querySelector("#memory-results");
    const status = document.querySelector("#memory-search-status");
    const more = document.querySelector("#memory-more");
    let all = [], visible = 8, timer;
    const render = (reset = true) => {
      if (reset) visible = 8;
      const text = normalizeText(query.value);
      if (!text && !yearSelect.value && !topicSelect.value) {
        results.innerHTML = ""; status.textContent = "Tìm theo tên, địa điểm, năm hoặc chủ đề."; more.hidden = true; return;
      }
      const matches = all.filter(item => (!yearSelect.value || String(item.year) === yearSelect.value) && (!topicSelect.value || item.type === topicSelect.value) && (!text || normalizeText([item.title,item.description,item.type,item.topic,item.date,item.year].join(" ")).includes(text)));
      status.textContent = `${matches.length} kỷ niệm phù hợp`;
      results.innerHTML = matches.slice(0, visible).map(item => `<a class="memory-result" href="activity.html?year=${item.year}&id=${encodeURIComponent(item.id)}"><small>${item.year} · ${escapeHTML(item.type || "Kỷ niệm")}</small><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.date)} <b aria-hidden="true">↗</b></span></a>`).join("");
      more.hidden = visible >= matches.length;
      rewritePublicLinks(results);
    };
    query.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 120); });
    yearSelect.addEventListener("change", () => render()); topicSelect.addEventListener("change", () => render());
    more.addEventListener("click", () => { visible += 8; render(false); });
    window.TeresaStore.loadIndex().then(index => {
      all = index.years.filter(item => window.TeresaSchema?.isYearPublic?.(item.year) !== false).flatMap(item => (item.events || []).map(event => ({...event,year:item.year}))).sort((a,b) => b.year-a.year);
      yearSelect.innerHTML += [...new Set(all.map(item => item.year))].sort((a,b)=>b-a).map(year=>`<option>${year}</option>`).join("");
      topicSelect.innerHTML += [...new Set(all.map(item=>item.type).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"vi")).map(type=>`<option value="${escapeHTML(type)}">${escapeHTML(type)}</option>`).join("");
      render();
    }).catch(() => { status.textContent = "Chưa tải được chỉ mục. Hãy tải lại trang để tìm kiếm."; });
  }

  function rewritePublicLinks(root = document) {
    if (!document.documentElement.hasAttribute("data-static-routes")) return;
    root.querySelectorAll("a[href]").forEach(link => {
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.searchParams.has("preview")) return;
      const year = url.searchParams.get("year");
      if (!/^\d{4}$/.test(year || "")) return;
      if (/\/(year)(\.html)?$/.test(url.pathname)) link.href = window.TeresaPublic.yearUrl(year) + url.hash;
      if (/\/(activity)(\.html)?$/.test(url.pathname) && url.searchParams.get("id")) link.href = window.TeresaPublic.activityUrl(year, url.searchParams.get("id")) + url.hash;
    });
  }

  function initDataPreference() {
    if (document.body.classList.contains("admin-page")) return;
    const footer = document.querySelector(".site-footer .container") || document.querySelector(".site-footer");
    if (!footer) return;
    const label = document.createElement("label"); label.className = "data-preference";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = window.TeresaPublic.savingData();
    const span = document.createElement("span"); span.textContent = "Tiết kiệm dữ liệu ảnh";
    label.append(input,span); footer.append(label);
    input.addEventListener("change", () => {
      window.TeresaPublic.setSavingData(input.checked);
      document.dispatchEvent(new CustomEvent("teresa:data-preference"));
    });
  }

  function initLightbox() {
    const dialog = document.querySelector(".lightbox");
    if (!dialog || typeof dialog.showModal !== "function") return;
    // Dynamic galleries may re-initialize; install the controls exactly once.
    if (dialog._teresaOpen) { window.TeresaUI.openLightbox = dialog._teresaOpen; return; }
    const image = dialog.querySelector("figure img"), figure = dialog.querySelector("figure");
    const caption = dialog.querySelector("figcaption"), close = dialog.querySelector(".lightbox-close");
    const previous = dialog.querySelector(".lightbox-prev"), next = dialog.querySelector(".lightbox-next");
    let counter = figure.querySelector(".lightbox-counter");
    if (!counter) { counter = document.createElement("span"); counter.className = "lightbox-counter"; figure.prepend(counter); }
    const status = document.createElement("p"); status.className = "lightbox-status"; status.setAttribute("role","status");
    const retry = document.createElement("button"); retry.type="button"; retry.className="lightbox-retry"; retry.textContent="Thử tải lại ảnh"; retry.hidden=true;
    const full = document.createElement("button"); full.type="button"; full.className="lightbox-full"; full.textContent="Xem bản nét"; full.hidden=true;
    figure.append(status,retry,full);
    const state = { index:0, custom:null, title:"", request:0, opener:null, scale:1, x:0,y:0, full:false,lastTap:0 };
    const domItems = () => [...document.querySelectorAll(".gallery-item[data-full]:not(.hidden)")].map(item => ({src:item.dataset.full, preview:item.querySelector("img")?.currentSrc || item.querySelector("img")?.dataset.mediaSrc, variants:{medium:item.dataset.medium || item.querySelector("img")?.currentSrc || item.querySelector("img")?.dataset.mediaSrc,thumbnail:item.querySelector("img")?.currentSrc || item.querySelector("img")?.dataset.mediaSrc}, alt:item.querySelector("img")?.alt,caption:item.dataset.caption}));
    const items = () => state.custom || domItems();
    const resolve = async (item, variant="original") => {
      const candidate = window.TeresaStore?.mediaSource(item,variant) || item?.src || "";
      return window.TeresaStore?.resolveSource(candidate,variant) || candidate;
    };
    const transform = () => {
      const xLimit = image.clientWidth * (state.scale-1)/2, yLimit = image.clientHeight * (state.scale-1)/2;
      state.x = Math.max(-xLimit,Math.min(xLimit,state.x)); state.y=Math.max(-yLimit,Math.min(yLimit,state.y));
      image.style.transform=`translate3d(${state.x}px,${state.y}px,0) scale(${state.scale})`;
      image.classList.toggle("is-zoomed",state.scale>1);
    };
    const load = async (index, forceFull=false) => {
      const all=items(); if(!all.length)return;
      state.index=(index+all.length)%all.length; state.scale=1;state.x=state.y=0;transform();
      const request=++state.request, item=all[state.index];
      const save=window.TeresaPublic.savingData(); state.full=forceFull||!save;
      image.alt=item.alt||"Ảnh kỷ niệm của ca đoàn"; caption.textContent=item.caption||state.title||"Kỷ niệm Teresa";
      counter.textContent=`${state.index+1} / ${all.length}${state.title?` · ${state.title}`:""}`;
      previous.disabled=next.disabled=all.length<2; retry.hidden=true;full.hidden=state.full;
      status.textContent=state.full?"Đang tải ảnh nét…":"";
      // Swap only after decode; an already visible preview remains while loading.
      const preview = item.preview || await resolve(item,"thumbnail");
      if(request!==state.request)return;
      image.src=preview||""; image.hidden=!preview;
      try {
        const url=await resolve(item,state.full?"original":"medium");
        if(request!==state.request)return;
        const candidate=new Image(); candidate.decoding="async";
        await new Promise((ok,fail)=>{ candidate.onload=ok; candidate.onerror=()=>fail(new Error("image"));candidate.src=url;if(candidate.complete&&candidate.naturalWidth)ok(); });
        try { await candidate.decode?.(); } catch (_) {}
        if(request!==state.request||!dialog.open)return;
        image.src=url; image.hidden=false; status.textContent="";
        if(!save&&all.length>1) { const nextUrl=await resolve(all[(state.index+1)%all.length]); if(request!==state.request)return;const preload=new Image();preload.fetchPriority="low";preload.src=nextUrl; }
      } catch (_) {
        if(request!==state.request)return;
        status.textContent="Chưa tải được ảnh nét. Bạn có thể thử lại.";retry.hidden=false;
      }
    };
    const open=(custom,index=0,title="")=>{state.opener=document.activeElement;state.custom=custom?.length?custom:null;state.title=title;if(!dialog.open)dialog.showModal();document.body.classList.add("lightbox-open");load(index);close.focus({preventScroll:true});};
    dialog._teresaOpen=open;window.TeresaUI={...(window.TeresaUI||{}),openLightbox:open};
    document.addEventListener("click",event=>{const item=event.target.closest(".gallery-item[data-full]");if(item&&!item.closest(".album-dialog")){const all=[...document.querySelectorAll(".gallery-item[data-full]:not(.hidden)")];open(null,all.indexOf(item));}});
    const dismiss=()=>{++state.request;if(dialog.open)dialog.close();document.body.classList.remove("lightbox-open");state.opener?.focus?.({preventScroll:true});};
    close.addEventListener("click",dismiss);previous.addEventListener("click",()=>load(state.index-1));next.addEventListener("click",()=>load(state.index+1));
    retry.addEventListener("click",()=>load(state.index,state.full));full.addEventListener("click",()=>load(state.index,true));
    dialog.addEventListener("click",e=>{if(e.target===dialog)dismiss();});dialog.addEventListener("cancel",e=>{e.preventDefault();dismiss();});
    dialog.addEventListener("close",()=>{++state.request;document.body.classList.remove("lightbox-open");});
    dialog.addEventListener("keydown",e=>{if(e.key==="ArrowLeft")load(state.index-1);if(e.key==="ArrowRight")load(state.index+1);});
    let gesture=null;
    const distance=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
    figure.addEventListener("touchstart",e=>{
      if(e.target.closest("button"))return;
      gesture={x:e.touches[0].clientX,y:e.touches[0].clientY,panX:state.x,panY:state.y,scale:state.scale,pinch:e.touches.length>1?distance(e.touches):0,moved:false,wasZoomed:state.scale>1};
      image.classList.add("is-gesturing");
    },{passive:true});
    figure.addEventListener("touchmove",e=>{
      if(!gesture)return;const dx=e.touches[0].clientX-gesture.x,dy=e.touches[0].clientY-gesture.y;
      if(e.touches.length>1&&gesture.pinch){state.scale=Math.max(1,Math.min(4,gesture.scale*distance(e.touches)/gesture.pinch));gesture.moved=true;transform();}
      else if(state.scale>1){state.x=gesture.panX+dx;state.y=gesture.panY+dy;gesture.moved=Math.abs(dx)+Math.abs(dy)>8;transform();}
      else {gesture.moved=Math.abs(dx)+Math.abs(dy)>10;}
      e.preventDefault();
    },{passive:false});
    figure.addEventListener("touchend",e=>{
      if(!gesture)return;
      const g=gesture;gesture=null;image.classList.remove("is-gesturing");
      if(e.touches.length)return;
      const dx=(e.changedTouches[0]?.clientX||g.x)-g.x,dy=(e.changedTouches[0]?.clientY||g.y)-g.y;
      const now=Date.now();
      if(!g.moved&&now-state.lastTap<320){state.scale=state.scale>1?1:2;state.x=state.y=0;transform();state.lastTap=0;e.preventDefault();return;}
      state.lastTap=g.moved?0:now;
      if(!g.wasZoomed&&!g.pinch&&state.scale===1&&Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy))load(state.index+(dx<0?1:-1));
      else if(!g.wasZoomed&&!g.pinch&&state.scale===1&&dy>110&&dy>Math.abs(dx))dismiss();
    },{passive:false});
    figure.addEventListener("touchcancel",()=>{gesture=null;image.classList.remove("is-gesturing");});
    image.addEventListener("dblclick",()=>{state.scale=state.scale>1?1:2;state.x=state.y=0;transform();});
    let pointer;
    image.addEventListener("pointerdown",e=>{if(e.pointerType!=="mouse"||state.scale<=1)return;pointer={x:e.clientX,y:e.clientY,panX:state.x,panY:state.y};image.setPointerCapture(e.pointerId);e.preventDefault();});
    image.addEventListener("pointermove",e=>{if(!pointer)return;state.x=pointer.panX+e.clientX-pointer.x;state.y=pointer.panY+e.clientY-pointer.y;transform();});
    image.addEventListener("pointerup",()=>{pointer=null;});image.addEventListener("pointercancel",()=>{pointer=null;});
    image.draggable=false;
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
    initMemorySearch();
    initDataPreference();
    rewritePublicLinks();
    document.addEventListener("teresa:content-ready", () => rewritePublicLinks());
    document.addEventListener("teresa:page-rendered", () => rewritePublicLinks());
    pageReturnController = initPageReturn();
    initPageTransitions();
    initRoutePrefetch();
    initYearNavigation();
    document.addEventListener("teresa:page-rendered", initYearNavigation);
    document.addEventListener("teresa:content-ready", initYearNavigation);
    initReveal();
    initArchiveOverview().finally(() => {
      const timeline = document.querySelector(".timeline");
      if (timeline) initReveal(timeline);
      initTimeline();
      initCounters();
      rewritePublicLinks();
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
