/**
 * Tương tác dùng chung cho trang chủ và trang chi tiết năm.
 * Không dùng thư viện ngoài để dễ deploy trên GitHub/Cloudflare Pages.
 */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function initHeader() {
    const header = document.querySelector(".site-header");
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".main-nav");
    if (!header) return;

    const updateHeader = () => header.classList.toggle("scrolled", window.scrollY > 40);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    if (toggle && nav) {
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!open));
        toggle.setAttribute("aria-label", open ? "Mở menu" : "Đóng menu");
        nav.classList.toggle("open", !open);
        document.body.classList.toggle("menu-open", !open);
      });

      nav.addEventListener("click", (event) => {
        if (!event.target.closest("a")) return;
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Mở menu");
        nav.classList.remove("open");
        document.body.classList.remove("menu-open");
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

  function initParallax() {
    const background = document.querySelector(".hero-bg");
    if (!background || reduceMotion) return;
    let ticking = false;
    const update = () => {
      const y = Math.min(window.scrollY * 0.14, 100);
      background.style.transform = `translate3d(0, ${y}px, 0) scale(1.03)`;
      ticking = false;
    };
    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) requestAnimationFrame(update);
        ticking = true;
      },
      { passive: true },
    );
  }

  function initLiquidGlass(root = document) {
    const selectors = [
      ".button",
      ".stats-grid article",
      ".info-list",
      ".timeline-item",
      ".activity-card",
      ".gallery-filters button",
      ".gallery-item",
      ".contact-card",
      ".social-links a",
      ".back-to-top",
      ".year-nav",
      ".overview-story",
      ".year-mark-card",
      ".person-card",
      ".member-stat",
      ".year-activity",
      ".activity-story",
      ".activity-fact",
      ".activity-nav-card",
      ".reflection-card",
      ".quote-card",
      ".journal-mood",
      ".year-switcher a",
    ];
    const surfaces = [...root.querySelectorAll(selectors.join(","))].filter(
      (surface) => !surface.hasAttribute("data-glass-ready"),
    );

    surfaces.forEach((surface) => {
      surface.dataset.glassReady = "true";
      surface.classList.add("glass-surface");
      const shine = document.createElement("span");
      shine.className = "liquid-glass-shine";
      shine.setAttribute("aria-hidden", "true");
      surface.append(shine);

      if (reduceMotion) return;
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

    if (!reduceMotion && !document.documentElement.hasAttribute("data-glass-pointer")) {
      document.documentElement.dataset.glassPointer = "true";
      let pointerTicking = false;
      let pointerX = 0;
      let pointerY = 0;
      window.addEventListener(
        "pointermove",
        (event) => {
          pointerX = event.clientX;
          pointerY = event.clientY;
          if (pointerTicking) return;
          pointerTicking = true;
          requestAnimationFrame(() => {
            document.documentElement.style.setProperty("--pointer-x", `${pointerX}px`);
            document.documentElement.style.setProperty("--pointer-y", `${pointerY}px`);
            pointerTicking = false;
          });
        },
        { passive: true },
      );
    }
  }

  function initGalleryFilters() {
    const controls = document.querySelector(".gallery-filters");
    const items = [...document.querySelectorAll("#album .gallery-item")];
    if (!controls || !items.length) return;

    controls.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (!button) return;
      controls.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const filter = button.dataset.filter;
      items.forEach((item) => {
        const visible = filter === "all" || item.dataset.category === filter;
        item.classList.toggle("hidden", !visible);
      });
      initLightbox();
    });
  }

  function initLightbox() {
    const dialog = document.querySelector(".lightbox");
    if (!dialog || typeof dialog.showModal !== "function") return;
    const image = dialog.querySelector("figure img");
    const caption = dialog.querySelector("figcaption");
    const close = dialog.querySelector(".lightbox-close");
    const previous = dialog.querySelector(".lightbox-prev");
    const next = dialog.querySelector(".lightbox-next");
    let activeIndex = 0;

    const items = () => [...document.querySelectorAll(".gallery-item[data-full]:not(.hidden)")];
    const show = async (index) => {
      const currentItems = items();
      if (!currentItems.length) return;
      activeIndex = (index + currentItems.length) % currentItems.length;
      const current = currentItems[activeIndex];
      image.src = await window.TeresaStore?.resolveSource(current.dataset.full) || current.dataset.full;
      image.alt = current.querySelector("img")?.alt || "Ảnh kỷ niệm của ca đoàn";
      caption.textContent = current.dataset.caption || "Kỷ niệm Teresa Youth Choir";
    };

    document.querySelectorAll(".gallery-item[data-full]").forEach((item) => {
      if (item.dataset.lightboxBound) return;
      item.dataset.lightboxBound = "true";
      item.addEventListener("click", () => {
        activeIndex = items().indexOf(item);
        show(activeIndex);
        dialog.showModal();
        document.body.classList.add("lightbox-open");
      });
    });

    if (dialog.dataset.controlsBound) return;
    dialog.dataset.controlsBound = "true";
    const closeDialog = () => {
      dialog.close();
      document.body.classList.remove("lightbox-open");
    };
    close.addEventListener("click", closeDialog);
    previous.addEventListener("click", () => show(activeIndex - 1));
    next.addEventListener("click", () => show(activeIndex + 1));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") show(activeIndex - 1);
      if (event.key === "ArrowRight") show(activeIndex + 1);
    });
  }

  function initBackToTop() {
    const button = document.querySelector(".back-to-top");
    if (!button) return;
    const update = () => button.classList.toggle("visible", window.scrollY > 700);
    update();
    window.addEventListener("scroll", update, { passive: true });
    button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));
  }

  function setCurrentYear() {
    document.querySelectorAll("[data-current-year]").forEach((node) => {
      node.textContent = new Date().getFullYear();
    });
  }

  function init() {
    initHeader();
    initReveal();
    initTimeline();
    initCounters();
    initParallax();
    initLiquidGlass();
    initGalleryFilters();
    initLightbox();
    initBackToTop();
    setCurrentYear();
  }

  // API nhỏ để year.js khởi tạo animation/lightbox sau khi render JSON.
  window.TeresaUI = { initReveal, initLightbox, initLiquidGlass };
  document.addEventListener("DOMContentLoaded", init);
})();
