/** Shared, dependency-free presentation helpers. Also used by the static build. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TeresaPublic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  function updateSEO({title, description, file, image}) {
    if (new URLSearchParams(location.search).has('preview')) {
      const robots=document.createElement('meta');robots.name='robots';robots.content='noindex, nofollow';document.head.append(robots);return;
    }
    const url=new URL(file.replace(/\.html$/,''),'https://cadoangioitreteresa.org/').href;
    const set=(selector,tag,attributes)=>{let node=document.head.querySelector(selector);if(!node){node=document.createElement(tag);document.head.append(node);}Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,value));};
    set('link[rel="canonical"]','link',{rel:'canonical',href:url});
    set('meta[name="description"]','meta',{name:'description',content:intro(description || '')});
    for(const [name,value] of Object.entries({title,description:intro(description || ''),url,image:new URL(image || 'images/optimized/hero-1280.webp','https://cadoangioitreteresa.org/').href}))set(`meta[property="og:${name}"]`,'meta',{property:`og:${name}`,content:value});
  }
  const point = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : fallback;
  function focus(value = {}) {
    return { x: point(value?.x, 50), y: point(value?.y, 46), mobileX: point(value?.mobileX, point(value?.x, 50)), mobileY: point(value?.mobileY, point(value?.y, 46)) };
  }
  function focusStyle(value) {
    const p = focus(value);
    return `--cover-position:${p.x}% ${p.y}%;--cover-mobile-position:${p.mobileX}% ${p.mobileY}%`;
  }
  // Keep full sentences where possible; the complete prose remains in the article.
  function intro(value = "", maximum = 300) {
    const text = String(value).replace(/\s+/g, " ").trim();
    if (text.length <= maximum) return text;
    const sentences = text.match(/[^.!?…]+(?:[.!?…]+[”’"']?|$)/g) || [];
    let result = "";
    for (const sentence of sentences.slice(0, 3)) {
      if ((result + sentence).length > maximum) break;
      result += sentence;
    }
    if (result.trim().length >= 80) return result.trim();
    const cut = text.slice(0, maximum - 1);
    const clauseEnd = Math.max(cut.lastIndexOf(";"), cut.lastIndexOf(","));
    if (clauseEnd >= maximum * .6) return cut.slice(0, clauseEnd).trim() + "…";
    return cut.slice(0, cut.lastIndexOf(" ")) + "…";
  }
  const yearUrl = (year) => `nhat-ky-${Number(year)}.html`;
  const activityUrl = (year, id) => `su-kien-${Number(year)}-${encodeURIComponent(id)}.html`;
  function route(pathname) {
    const year = pathname.match(/\/nhat-ky-(\d{4})(?:\.html)?$/);
    const activity = pathname.match(/\/su-kien-(\d{4})-(.+?)(?:\.html)?$/);
    return year ? { year: Number(year[1]) } : activity ? { year: Number(activity[1]), id: decodeURIComponent(activity[2]) } : {};
  }
  let dataPreference;
  function setSavingData(value) {
    dataPreference = Boolean(value);
    try { localStorage.setItem("teresa:save-data", String(dataPreference)); } catch (_) {}
  }
  function savingData() {
    if (typeof dataPreference === "boolean") return dataPreference;
    try {
      const setting = localStorage.getItem("teresa:save-data");
      if (setting !== null) return setting === "true";
    } catch (_) { /* Device preference is optional. */ }
    return Boolean(typeof navigator !== "undefined" && (navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || "")));
  }
  return { escapeHTML, updateSEO, focus, focusStyle, intro, yearUrl, activityUrl, route, savingData, setSavingData };
});
