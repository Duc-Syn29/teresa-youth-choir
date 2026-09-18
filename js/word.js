/* Xuất nhật ký năm sang DOCX và đọc nội dung cơ bản từ DOCX để nhập bài viết. */
(function () {
  "use strict";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const xmlEscape = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" })[char]);
  const xmlDecode = (value) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const crcTable = (() => Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; }))();
  const crc32 = (bytes) => { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; };
  const u16 = (value) => [value & 255, (value >>> 8) & 255];
  const u32 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  const concat = (parts) => { const total = parts.reduce((size, part) => size + part.length, 0); const result = new Uint8Array(total); let offset = 0; parts.forEach((part) => { result.set(part, offset); offset += part.length; }); return result; };

  function zip(files) {
    const local = []; const central = []; let offset = 0;
    files.forEach(({ name, content }) => {
      const nameBytes = encoder.encode(name); const data = encoder.encode(content); const crc = crc32(data);
      const localHeader = new Uint8Array([
        80, 75, 3, 4,
        ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0),
      ]);
      local.push(localHeader, nameBytes, data);
      central.push(new Uint8Array([
        80, 75, 1, 2,
        ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset),
      ]), nameBytes);
      offset += localHeader.length + nameBytes.length + data.length;
    });
    const centralBytes = concat(central);
    return new Blob([concat([...local, centralBytes, new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(centralBytes.length), ...u32(offset), 0, 0])])], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  const paragraph = (text, style = "") => {
    const lines = String(text || "").split(/\r?\n/);
    const runs = lines.map((line, index) => `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`).join("");
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs}</w:p>`;
  };

  function exportYear(data) {
    const activityText = (data.activities || []).flatMap((activity) => [
      paragraph(`${activity.date} · ${activity.type}`, "Heading2"), paragraph(activity.title, "Heading1"), paragraph(activity.description || ""), paragraph(activity.body || ""), paragraph(""),
    ]).join("");
    const listItemText = (item) => {
      if (typeof item === "string") return item;
      const attribution = [item?.name, item?.role].filter(Boolean).join(" · ");
      const content = item?.quote || item?.title || item?.text || "";
      return attribution && content ? `${attribution}: ${content}` : attribution || content;
    };
    const listSection = (title, items = []) => items.length
      ? [paragraph(title, "Heading1"), ...items.map((item) => paragraph(`• ${listItemText(item)}`))].join("")
      : "";
    const body = [
      paragraph(`TERESA YOUTH CHOIR — NHẬT KÝ ${data.year}`, "Title"),
      paragraph(data.overview.title, "Heading1"),
      paragraph(data.overview.summary),
      paragraph(data.overview.longDescription),
      data.overview.verse ? paragraph(data.overview.verse) : "",
      listSection("THÀNH TỰU", data.achievements),
      listSection("THỬ THÁCH", data.challenges),
      paragraph("HOẠT ĐỘNG TRONG NĂM", "Heading1"),
      activityText,
      listSection("LỜI CHIA SẺ", data.sharing),
    ].join("");
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const files = [
      { name: "[Content_Types].xml", content: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>" },
      { name: "_rels/.rels", content: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>" },
      { name: "word/_rels/document.xml.rels", content: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>" },
      { name: "word/styles.xml", content: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Aptos\" w:hAnsi=\"Aptos\"/><w:sz w:val=\"22\"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:basedOn w:val=\"Normal\"/><w:rPr><w:b/><w:sz w:val=\"40\"/></w:rPr></w:style><w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/><w:basedOn w:val=\"Normal\"/><w:rPr><w:b/><w:color w:val=\"087FA4\"/><w:sz w:val=\"30\"/></w:rPr></w:style><w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/><w:basedOn w:val=\"Normal\"/><w:rPr><w:b/><w:color w:val=\"4E7180\"/><w:sz w:val=\"23\"/></w:rPr></w:style></w:styles>" },
      { name: "word/document.xml", content: documentXml },
    ];
    return zip(files);
  }

  async function readDocx(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer); let directory = -1;
    for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) if (view.getUint32(index, true) === 0x06054b50) { directory = view.getUint32(index + 16, true); break; }
    if (directory < 0) throw new Error("Không nhận ra tệp DOCX. Hãy chọn tệp .docx từ Microsoft Word.");
    let pointer = directory;
    while (view.getUint32(pointer, true) === 0x02014b50) {
      const method = view.getUint16(pointer + 10, true); const compressedSize = view.getUint32(pointer + 20, true); const nameLength = view.getUint16(pointer + 28, true); const extraLength = view.getUint16(pointer + 30, true); const commentLength = view.getUint16(pointer + 32, true); const localOffset = view.getUint32(pointer + 42, true); const name = decoder.decode(bytes.slice(pointer + 46, pointer + 46 + nameLength));
      if (name === "word/document.xml") {
        const localNameLength = view.getUint16(localOffset + 26, true); const localExtraLength = view.getUint16(localOffset + 28, true); const packed = bytes.slice(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
        let xmlBytes = packed;
        if (method === 8) {
          if (!window.DecompressionStream) throw new Error("Trình duyệt này chưa hỗ trợ nhập DOCX. Hãy dùng Chrome hoặc Edge phiên bản mới.");
          xmlBytes = new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
        }
        const xml = decoder.decode(xmlBytes);
        return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => xmlDecode([...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((part) => part[1]).join(""))).filter(Boolean).join("\n\n");
      }
      pointer += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error("Không tìm thấy nội dung văn bản trong tệp DOCX.");
  }

  function downloadWordYear(data) {
    const link = document.createElement("a"); link.href = URL.createObjectURL(exportYear(data)); link.download = `teresa-youth-choir-${data.year}.docx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  window.TeresaWord = { downloadWordYear, readDocx, buildYearDocx: exportYear };
})();
