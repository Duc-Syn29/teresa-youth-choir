import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function wordApi() {
  const window = {};
  vm.runInNewContext(read("js/word.js"), { window, TextEncoder, TextDecoder, Blob, Response, setTimeout });
  return window.TeresaWord;
}

test("exported Word document is a structurally valid ZIP and can be read back", async () => {
  const data = JSON.parse(read("data/2020.json"));
  const api = wordApi();
  const blob = api.buildYearDocx(data);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  assert.ok(end >= 0, "missing ZIP end-of-central-directory record");
  assert.equal(view.getUint16(end + 10, true), 5);
  const centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  const text = await api.readDocx({ arrayBuffer: async () => bytes.buffer });
  assert.match(text, /TERESA YOUTH CHOIR/);
  assert.match(text, /Tĩnh tâm tại Đan viện Biển Đức Thiên Hà/);
  assert.match(text, /THÀNH TỰU/);
  assert.match(text, /Giuse Phạm Văn Tĩnh · Trưởng ca đoàn 2020/);
});
