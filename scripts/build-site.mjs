import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const Schema = require('../js/schema.js');
const Public = require('../js/public-tools.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, '.site');
const read = file => readFile(path.join(root, file), 'utf8');
const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const index = JSON.parse(await read('data/index.json'));
const years = index.years.map(item => Number(item.year)).filter(year => Schema.isYearPublic(year)).sort((a,b)=>a-b);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['index.html','year.html','activity.html','admin.html','js','css','images','data']) await cp(path.join(root,item), path.join(out,item), {recursive:true});
for (const item of ['index.html','year.html','activity.html','admin.html']) {
  let html = await read(item);
  html = html.replace('<html lang="vi">','<html lang="vi" data-static-routes>');
  await writeFile(path.join(out,item),html);
}
const cover = media => {
  if (!media) return { src:'',srcset:'' };
  const variants = media.variants || {};
  const seen = new Set();
  const srcset = [['thumbnail',480],['medium',1280],['original',2560]].map(([key,w])=>{
    const v=variants[key],url=Schema.mediaSource(v,'original');
    if(!url||seen.has(url))return '';seen.add(url);return `${url} ${v.width||w}w`;
  }).filter(Boolean).join(', ');
  return {src:Schema.mediaSource(media,'medium'),srcset};
};
const sizes='(max-width: 680px) max(100vw, 150svh), 100vw';
function hero(data, activity) {
  const item=activity||data.overview;
  const image=cover(item.coverImage || activity?.album?.preview?.[0]);
  const type=activity?'activity':'year';
  const photo=image.src?`<img src="${escape(image.src)}" ${image.srcset?`srcset="${escape(image.srcset)}" sizes="${sizes}"`:''} alt="" decoding="async" fetchpriority="high" />`:'';
  const copy=activity?`<div class="activity-hero-meta"><span>${escape(activity.type)}</span><time>${escape(activity.date)}</time></div><h1>${escape(item.title)}</h1><p class="activity-hero-summary">${escape(Public.intro(item.description))}</p><div class="activity-actions"><a class="button button-primary" href="#activity-story">Xem hành trình ↓</a><a class="button button-light" href="${Public.yearUrl(data.year)}#year-activities">← Nhật ký ${data.year}</a></div>`:`<div class="year-number">${data.year}</div><div class="year-intro"><p class="eyebrow">${escape(item.eyebrow)}</p><h1>${escape(item.title)}</h1><p>${escape(Public.intro(item.summary))}</p><p class="year-verse">${escape(item.verse)}</p></div>`;
  return {image,markup:`<section class="${type}-hero${image.src?' has-cover':''}" style="${Public.focusStyle(item.coverFocus)}"><div class="${type}-hero-bg">${photo}</div><div class="container ${type}-hero-content">${activity?`<nav class="activity-breadcrumb" aria-label="Đường dẫn"><a href="index.html">Trang chủ</a><span>/</span><a href="${Public.yearUrl(data.year)}#year-activities">Nhật ký ${data.year}</a><span>/</span><span>${escape(activity.type)}</span></nav>`:''}${copy}</div></section>`};
}
let pages=0;
for(const year of years) {
  const data=Schema.normalizeYear(JSON.parse(await read(`data/${year}.json`)));
  for(const activity of [null,...data.activities]) {
    const type=activity?'activity':'year';
    let html=await read(`${type}.html`);
    const {image,markup}=hero(data,activity);
    const title=activity?`${activity.title} — Teresa Youth Choir`:`${year} — Teresa Youth Choir`;
    const file=activity?Public.activityUrl(year,activity.id):Public.yearUrl(year);
    html=html.replace('<html lang="vi">','<html lang="vi" data-static-routes>')
      .replace(/<title>.*?<\/title>/,`<title>${escape(title)}</title>`)
      .replace(`id="${type}-loading"`,`id="${type}-loading" hidden`)
      .replace(`<div id="${type}-app" hidden></div>`,`<div id="${type}-app">${markup}</div>`);
    const boot=JSON.stringify({...data,publicYears:years}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    html=html.replace('</head>',`${image.src?`<link rel="preload" as="image" href="${escape(image.src)}" ${image.srcset?`imagesrcset="${escape(image.srcset)}" imagesizes="${sizes}"`:''} fetchpriority="high" />`:''}<script id="archive-bootstrap" type="application/json">${boot}</script><link rel="canonical" href="https://cadoangioitreteresa.org/${file.replace(/\.html$/,'')}" /></head>`);
    await writeFile(path.join(out,file),html);pages++;
  }
}
await writeFile(path.join(out,'_headers'),`/js/*\n  Cache-Control: public, max-age=86400\n/css/*\n  Cache-Control: public, max-age=86400\n/images/*\n  Cache-Control: public, max-age=31536000\n/data/*\n  Cache-Control: public, max-age=0, must-revalidate\n`);
console.log(`Built ${pages} pre-rendered year/event pages; photos reused from existing URLs.`);
