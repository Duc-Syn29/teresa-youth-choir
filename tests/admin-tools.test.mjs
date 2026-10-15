import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Tools=createRequire(import.meta.url)('../js/admin-tools.js');
test('photo search matches captions and filenames without accents',()=>{
 const images=[{caption:'Ảnh trao quà Hương La',filename:'IMG_1234.CR2'},{caption:'Thánh lễ',filename:'IMG_5678.jpg'}];
 assert.equal(Tools.filterPhotos(images,'huong la')[0],images[0]);
 assert.equal(Tools.filterPhotos(images,'1234')[0],images[0]);
 assert.equal(Tools.filterPhotos(images,'không tồn tại').length,0);
});
test('readiness differentiates missing fields and a preview that still needs checking',()=>{
 assert.deepEqual(Tools.readiness({},false),['Thiếu tên','Thiếu ngày','Thiếu nội dung','Chưa chọn bìa','Chưa có ảnh','Chưa xem trước trong phiên này']);
 assert.deepEqual(Tools.readiness({title:'A',date:'2026',body:'B',coverImage:'photo',images:[{}]},true),[]);
});
test('draft comparison preserves complete prose and image metadata for the selected event',()=>{
 const local={year:2026,overview:{title:'Trên máy'},activities:[{id:'a',title:'A',body:'Mọi chữ\nđều được giữ.',images:[{id:'p',caption:'Chú thích'}]}]};
 const remote={year:2026,overview:{title:'Đồng bộ'},activities:[{id:'a',title:'A khác',body:'Bản kia'},{id:'b',title:'B'}]};
 const choices=Object.fromEntries(Tools.draftBlocks(local,remote).map(block=>[block.id,block.id==='event:a'?'local':'remote']));
 const merged=Tools.mergeDraft(local,remote,choices);
 assert.equal(merged.overview.title,'Đồng bộ');assert.deepEqual(merged.activities[0],local.activities[0]);assert.equal(merged.activities[1].id,'b');assert.equal(remote.activities[0].body,'Bản kia');
 assert.throws(()=>Tools.mergeDraft(local,remote,{}),/Hãy chọn/);
});
test('choosing a deleted event respects the deletion rather than silently restoring it',()=>{
 const local={year:2026,activities:[]},remote={year:2026,activities:[{id:'a',title:'A'}]};
 assert.equal(Tools.mergeDraft(local,remote,{'event:a':'local'}).activities.length,0);
});
test('event storage counts a shared asset once across album photos and the cover',()=>{
 const assets=[{id:'root',keys:['media/2026/shared/abc/original.webp','media/2026/shared/abc/thumb.webp'],variants:2,bytes:300}];
 const photo={id:'media/2026/shared/abc/original.webp',src:'https://api.test/media/media/2026/shared/abc/original.webp?v=1'};
 const value=Tools.eventStorage({images:[photo,photo],coverImage:photo},assets,(media)=>media.src);
 assert.equal(value.photos,1);assert.equal(value.variants,2);assert.equal(value.bytes,300);
});

test('year album photos and their manifest are chosen together during draft comparison',()=>{
 const local={year:2026,activities:[],gallery:[{id:'local'}],galleryAlbum:{manifest:'local.json'}},remote={year:2026,activities:[],gallery:[{id:'remote'}],galleryAlbum:{manifest:'remote.json'}};
 const blocks=Tools.draftBlocks(local,remote);assert.equal(blocks.length,1);
 const merged=Tools.mergeDraft(local,remote,{[blocks[0].id]:'local'});assert.deepEqual(merged.gallery,local.gallery);assert.deepEqual(merged.galleryAlbum,local.galleryAlbum);
});
