/** Compact reference index for photos reused across years; contains no image bytes. */
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function mediaRoots(value) {
  const roots=new Set();
  function visit(item) {
    if(typeof item==='string') {let decoded=item;try{decoded=decodeURIComponent(item);}catch{}const match=/(?:^|\/)(media\/\d{4}\/[^/]+\/[^/?#\s]+)/.exec(decoded);if(match)roots.add(match[1]);}
    else if(Array.isArray(item))item.forEach(visit);
    else if(item&&typeof item==='object')Object.values(item).forEach(visit);
  }
  visit(value);return [...roots].sort();
}
const index=JSON.parse(await readFile(path.join(root,'data/index.json'),'utf8'));
const usage={version:1,years:{}};
for(const entry of index.years) {
  const data=JSON.parse(await readFile(path.join(root,`data/${entry.year}.json`),'utf8'));
  const manifests=[...new Set([...(data.activities||[]).map(a=>a.album?.manifest||a.albumManifest),data.galleryAlbum?.manifest].filter(Boolean))];
  const contents=await Promise.all(manifests.map(file=>readFile(path.join(root,file),'utf8').then(JSON.parse)));
  usage.years[entry.year]={revision:Number(data.meta?.revision||0),roots:mediaRoots([data,...contents])};
}
await writeFile(path.join(root,'data/media-usage.json'),JSON.stringify(usage,null,2)+'\n');
console.log(`Indexed photo references in ${Object.keys(usage.years).length} years.`);
