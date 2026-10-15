/* Small, deterministic helpers shared by the editor and its checks. */
(function (root) {
  'use strict';
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const searchText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
  function filterPhotos(images, query) { const value=searchText(query).trim(); return images.filter(image=>searchText([image.caption,image.alt,image.filename].filter(Boolean).join(' ')).includes(value)); }
  function readiness(activity, reviewed) {
    const issues=[];
    if (!String(activity.title || '').trim()) issues.push('Thiếu tên');
    if (!String(activity.date || '').trim()) issues.push('Thiếu ngày');
    if (!String(activity.body || activity.description || '').trim()) issues.push('Thiếu nội dung');
    if (!activity.coverImage) issues.push('Chưa chọn bìa');
    if (!(activity.images?.length || activity.album?.count)) issues.push('Chưa có ảnh');
    if (!reviewed) issues.push('Chưa xem trước trong phiên này');
    return issues;
  }
  function draftBlocks(local,remote) {
    const labels={overview:'Giới thiệu năm',leadership:'Ban điều hành',members:'Ca viên',gallery:'Album năm',galleryAlbum:'Thông tin album năm',yearMark:'Dấu ấn năm',achievements:'Thành tựu',challenges:'Thách thức',sharing:'Chia sẻ'};
    const blocks=[];
    if(!equal(local.gallery,remote.gallery)||!equal(local.galleryAlbum,remote.galleryAlbum)) blocks.push({id:'field:yearAlbum',label:'Album năm (ảnh và thông tin album)',fields:['gallery','galleryAlbum'],local:{gallery:clone(local.gallery),galleryAlbum:clone(local.galleryAlbum)},remote:{gallery:clone(remote.gallery),galleryAlbum:clone(remote.galleryAlbum)}});
    for(const key of new Set([...Object.keys(local),...Object.keys(remote)])) {
      if(['activities','year','schemaVersion','meta','gallery','galleryAlbum'].includes(key) || equal(local[key],remote[key])) continue;
      blocks.push({id:'field:'+key,label:labels[key]||key,local:clone(local[key]),remote:clone(remote[key]),key});
    }
    const l=new Map((local.activities||[]).map(a=>[a.id,a])),r=new Map((remote.activities||[]).map(a=>[a.id,a]));
    for(const id of new Set([...l.keys(),...r.keys()])) {
      if(equal(l.get(id),r.get(id)))continue;
      blocks.push({id:'event:'+id,label:(l.get(id)||r.get(id)).title||'Sự kiện chưa đặt tên',local:clone(l.get(id)),remote:clone(r.get(id)),activityId:id});
    }
    return blocks;
  }
  function mergeDraft(local,remote,choices) {
    const merged=clone(remote);const blocks=draftBlocks(local,remote);
    const events=new Map((merged.activities||[]).map(a=>[a.id,a]));
    for(const block of blocks) {
      if(!['local','remote'].includes(choices[block.id]))throw new Error('Hãy chọn bản cần giữ cho từng mục khác nhau.');
      const value=clone(block[choices[block.id]]);
      if(block.activityId){if(value)events.set(block.activityId,value);else events.delete(block.activityId);}
      else if(block.fields) { for(const key of block.fields) { if(value?.[key]===undefined)delete merged[key];else Object.defineProperty(merged,key,{value:clone(value[key]),enumerable:true,writable:true,configurable:true}); } }
      else if(value===undefined)delete merged[block.key];else Object.defineProperty(merged,block.key,{value,enumerable:true,writable:true,configurable:true});
    }
    merged.activities=[...events.values()];return merged;
  }
  function eventStorage(activity,assets,sourceOf) {
    const photos=[...(activity.images || activity.album?.preview || []),activity.coverImage].filter(Boolean);
    const matched=new Set();
    const unknown=new Set();
    for(const photo of photos){const values=[photo.id,...['thumbnail','medium','original'].map(v=>sourceOf(photo,v))].filter(Boolean).map(value=>{try{return decodeURIComponent(new URL(String(value),"https://archive.example/").pathname)}catch(_e){return String(value)}});
      let found=false;
      for(const asset of assets)if(asset.keys.some(key=>values.some(value=>value===key||value.endsWith('/'+key)))) { matched.add(asset.id);found=true; }
      if(!found)unknown.add(photo.id || sourceOf(photo,'original'));
    }
    const groups=assets.filter(asset=>matched.has(asset.id));
    return {unmatched:unknown.size,photos:groups.length,variants:groups.reduce((sum,asset)=>sum+asset.variants,0),bytes:groups.reduce((sum,asset)=>sum+asset.bytes,0),partial:Boolean(activity.album?.manifest&&!Array.isArray(activity.images))};
  }
  const api={searchText,filterPhotos,readiness,draftBlocks,mergeDraft,eventStorage};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TeresaAdminTools=api;
})(typeof window!=='undefined'?window:globalThis);
