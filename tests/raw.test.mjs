import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Raw = createRequire(import.meta.url)('../js/raw.js');
const jpeg = (width,height) => new Uint8Array([255,216,255,192,0,8,8,height>>8,height&255,width>>8,width&255,1,255,218,0,2,1,2,255,0,3,255,217]);
test('RAW preview extraction selects the largest JPEG and ignores small thumbnails', () => {
 const small=jpeg(160,120), large=jpeg(5184,3456);
 const bytes=new Uint8Array(small.length+large.length+5);bytes.set(small,0);bytes.set(large,small.length+5);
 const found=Raw.findPreview(bytes);assert.equal(found.width,5184);assert.equal(found.height,3456);assert.equal(found.end-found.start,large.length);
});
test('truncated or thumbnail-only RAW previews are rejected', () => {
 assert.equal(Raw.findPreview(jpeg(160,120)),null);assert.equal(Raw.findPreview(jpeg(5184,3456).slice(0,-2)),null);
});
