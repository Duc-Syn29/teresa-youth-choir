import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
const require=createRequire(import.meta.url);
const tools=require('../js/public-tools.js');
const Schema=require('../js/schema.js');
test('cover positions stay bounded and survive normalization without changing prose',()=>{
 const focus=tools.focus({x:-20,y:145,mobileX:72,mobileY:40});
 assert.deepEqual(focus,{x:0,y:100,mobileX:72,mobileY:40});
 const year=Schema.normalizeYear({year:2026,overview:{title:'Năm',summary:'Giữ nguyên chữ',coverFocus:focus},activities:[{id:'event',title:'Tên',body:'Nội dung đầy đủ',coverFocus:focus}]});
 assert.deepEqual(year.overview.coverFocus,focus);assert.deepEqual(year.activities[0].coverFocus,focus);assert.equal(year.activities[0].body,'Nội dung đầy đủ');
 assert.equal(tools.focusStyle(focus),'--cover-position:0% 100%;--cover-mobile-position:72% 40%');
});
test('static routes round-trip and concise leads retain sentence boundaries',()=>{
 for(const path of ['nhat-ky-2026.html','nhat-ky-2026'])assert.equal(tools.route('/'+path).year,2026);
 const url=tools.activityUrl(2026,'2026-activity-1');assert.deepEqual(tools.route('/'+url),{year:2026,id:'2026-activity-1'});assert.equal(tools.route('/'+url.replace('.html','')).id,'2026-activity-1');
 assert.equal(tools.intro('Câu ngắn.'),'Câu ngắn.');
 const original='Một câu chuyện '+ 'đẹp '.repeat(90);const brief=tools.intro(original,180);assert.ok(brief.length<=180);assert.ok(brief.endsWith('…'));assert.ok(original.startsWith(brief.slice(0,-1)));
});
test('every canonical album root is protected by the cross-year reference index',()=>{
 const usage=JSON.parse(readFileSync(new URL('../data/media-usage.json',import.meta.url)));
 const roots=value=>{const result=new Set();function visit(item){if(typeof item==='string'){const m=/(?:^|\/)(media\/\d{4}\/[^/]+\/[^/?#\s]+)/.exec(decodeURIComponent(item));if(m)result.add(m[1]);}else if(Array.isArray(item))item.forEach(visit);else if(item&&typeof item==='object')Object.values(item).forEach(visit);}visit(value);return result;};
 for(const [year,record] of Object.entries(usage.years)){
  const data=JSON.parse(readFileSync(new URL(`../data/${year}.json`,import.meta.url)));
  assert.equal(record.revision,Number(data.meta?.revision||0));
  const manifests=[...(data.activities||[]).map(a=>a.album?.manifest),data.galleryAlbum?.manifest].filter(Boolean);
  const all=[data,...manifests.map(file=>JSON.parse(readFileSync(new URL('../'+file,import.meta.url))))];
  for(const root of roots(all))assert.ok(record.roots.includes(root),`${year}: ${root}`);
 }
});
