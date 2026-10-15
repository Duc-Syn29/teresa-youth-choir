/* Extract a camera-generated JPEG preview locally. No RAW file leaves the device. */
(function (root) {
  'use strict';
  const RAW_EXTENSIONS = /\.(cr2|cr3|nef|nrw|arw|dng|raf|rw2|orf|pef|srw)$/i;
  const MAX_RAW_BYTES = 100 * 1024 * 1024;
  function isRaw(file) { return RAW_EXTENSIONS.test(file?.name || ''); }
  function jpegAt(bytes, start) {
    let cursor = start + 2, width = 0, height = 0;
    const limit = Math.min(bytes.length, start + 30 * 1024 * 1024);
    while (cursor + 1 < limit) {
      if (bytes[cursor++] !== 255) return null;
      while (bytes[cursor] === 255) cursor++;
      const marker = bytes[cursor++];
      if (marker === 217) return width && height ? { start, end: cursor, width, height } : null;
      if (marker === 216 || marker === 0) return null;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (cursor + 2 > limit) return null;
      const length = bytes[cursor] * 256 + bytes[cursor + 1];
      if (length < 2 || cursor + length > limit) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) {
        height = bytes[cursor + 3] * 256 + bytes[cursor + 4];
        width = bytes[cursor + 5] * 256 + bytes[cursor + 6];
      }
      cursor += length;
      if (marker === 218) {
        while (cursor + 1 < limit) {
          if (bytes[cursor] !== 255) { cursor++; continue; }
          const next = bytes[cursor + 1];
          if (next === 0 || (next >= 208 && next <= 215)) { cursor += 2; continue; }
          break;
        }
      }
    }
    return null;
  }
  function orientation(bytes) {
    if (bytes.length < 8) return 1;
    const little = bytes[0] === 73 && bytes[1] === 73;
    if (!little && !(bytes[0] === 77 && bytes[1] === 77)) return 1;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(2, little) !== 42) return 1;
    const offset = view.getUint32(4, little);
    if (offset + 2 > bytes.length) return 1;
    const count = Math.min(view.getUint16(offset, little), 1024);
    for (let index = 0; index < count; index++) {
      const position = offset + 2 + index * 12;
      if (position + 12 > bytes.length) break;
      if (view.getUint16(position, little) === 274 && view.getUint16(position + 2, little) === 3 && view.getUint32(position + 4, little) === 1) {
        const value = view.getUint16(position + 8, little);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
    return 1;
  }
  function findPreview(bytes) {
    let best = null;
    for (let start = 0; start + 3 < bytes.length; start++) {
      if (bytes[start] !== 255 || bytes[start + 1] !== 216 || bytes[start + 2] !== 255) continue;
      const candidate = jpegAt(bytes, start);
      if (candidate && Math.max(candidate.width, candidate.height) >= 1280 && Math.min(candidate.width, candidate.height) >= 256 && (!best || candidate.width * candidate.height > best.width * best.height)) best = candidate;
    }
    return best && { ...best, orientation: orientation(bytes) };
  }
  async function extract(file) {
    if (!isRaw(file)) return file;
    if (file.size > MAX_RAW_BYTES) throw new Error('Ảnh RAW lớn hơn 100 MB. Hãy xuất JPG rồi thêm lại.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preview = findPreview(bytes);
    if (!preview) throw new Error('RAW này không có ảnh xem trước đủ lớn. Hãy xuất JPG từ phần mềm máy ảnh rồi thêm lại.');
    const result = new File([bytes.slice(preview.start, preview.end)], file.name.replace(RAW_EXTENSIONS, '-raw-preview.jpg'), { type: 'image/jpeg', lastModified: file.lastModified });
    Object.defineProperty(result, 'rawOrientation', { value: preview.orientation });
    return result;
  }
  const api = { isRaw, findPreview, extract, MAX_RAW_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TeresaRaw = api;
})(typeof window !== 'undefined' ? window : globalThis);
