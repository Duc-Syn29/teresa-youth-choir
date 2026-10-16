/* Local photo selection: no network upload until the user confirms. */
(function (root) {
  'use strict';
  const MAX_PHOTOS = 50;
  function capacity(existingCount, selectedCount) {
    return { remaining: Math.max(0, MAX_PHOTOS - existingCount), valid: selectedCount > 0 && existingCount + selectedCount <= MAX_PHOTOS };
  }
  async function uniqueFiles(files) {
    const seen = new Set(), result = [];
    for (const file of files) {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2,'0')).join('');
      if (!seen.has(digest)) { seen.add(digest); result.push(file); }
    }
    return result;
  }
  function similar(a,b) { return a.length===64 && b.length===64 && [...a].reduce((total,value,index)=>total+Number(value!==b[index]),0)<=5; }
  async function choose(files, { existingCount = 0 } = {}) {
    if (!files.length) return [];
    const remaining = capacity(existingCount, 0).remaining;
    if (!remaining) throw new Error("Sự kiện đã đủ 50 ảnh. Hãy gỡ bớt ảnh trước khi thêm.");
    const escape = root.TeresaPublic.escapeHTML;
    const dialog = document.createElement('dialog');
    dialog.className = 'photo-selection-dialog';
    const selected = new Set(files.length <= remaining ? files.map((_,i)=>i) : []);
    const fingerprints=new Map();
    let page = 0, generation = 0, urls = [], checking = false;
    const release = () => { generation++; urls.forEach(url => URL.revokeObjectURL(url)); urls=[]; };
    dialog.innerHTML = `<h2>Chọn ảnh tiêu biểu</h2><p>Đã có ${existingCount} ảnh. Có thể thêm ${remaining} ảnh. Xem ảnh, bỏ ảnh mờ hoặc không liên quan rồi bấm tải.</p><p>RAW được xử lý trên thiết bị; chỉ ảnh đã tối ưu được đưa lên website.</p><p data-selection-status role="status"></p><div class="photo-selection-actions"><button type="button" data-select-all>Chọn tất cả</button><button type="button" data-select-none>Bỏ chọn tất cả</button></div><div class="photo-selection-grid"></div><div class="photo-selection-actions"><button type="button" data-prev>← Trước</button><span data-page></span><button type="button" data-next>Sau →</button></div><p data-selection-error role="alert"></p><div class="photo-selection-actions"><button type="button" data-cancel>Hủy</button><button type="button" class="button button-primary" data-confirm>Tối ưu & tải ảnh đã chọn</button></div>`;
    document.body.append(dialog);
    const update = () => {
      const count=selected.size, ok=capacity(existingCount,count).valid;
      dialog.querySelector('[data-selection-status]').textContent = `Đã chọn ${count} ảnh · Sau khi thêm: ${existingCount + count}/50 ảnh`;
      dialog.querySelector('[data-confirm]').disabled = !ok || checking;
      dialog.querySelector('[data-select-all]').disabled = files.length > remaining || checking;
      dialog.querySelector('[data-prev]').disabled = page === 0 || checking;
      dialog.querySelector('[data-next]').disabled = (page+1)*24 >= files.length || checking;
      dialog.querySelector('[data-page]').textContent = `${page+1}/${Math.ceil(files.length/24)}`;
      dialog.querySelectorAll('[data-file]').forEach(input => { input.checked=selected.has(Number(input.dataset.file)); input.disabled=checking || (!input.checked && selected.size >= remaining); });
    };
    const render = async () => {
      release(); const current = generation;
      const entries=files.slice(page*24,(page+1)*24);
      dialog.querySelector('.photo-selection-grid').innerHTML = entries.map((file,i)=>`<label><span class="photo-selection-preview" data-preview="${page*24+i}">Đang mở ảnh…</span><input type="checkbox" data-file="${page*24+i}" /> <span>${escape(file.name)}</span><small>${(file.size/1048576).toFixed(1)} MB nguồn</small><small data-similar="${page*24+i}"></small></label>`).join('');
      update();
      for (let i=0;i<entries.length;i++) {
        if (current!==generation || !dialog.open) return;
        const file=entries[i], slot=dialog.querySelector(`[data-preview="${page*24+i}"]`);
        try {
          if(file.size > (root.TeresaRaw?.isRaw(file) ? 100 : 25)*1048576) throw new Error('Tệp quá lớn');
          const source=root.TeresaRaw?.isRaw(file) ? await root.TeresaRaw.extract(file) : file;
          // Let the browser apply JPEG orientation, including an embedded RAW preview.
          const bitmap=await createImageBitmap(source, source.rawOrientation ? {imageOrientation:"none"} : {});
          if(current!==generation || !dialog.open) { bitmap.close(); return; }
          const scale=Math.min(1,320/Math.max(bitmap.width,bitmap.height));
          const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale)),orientation=source.rawOrientation || 1;
          const canvas=document.createElement('canvas');canvas.width=orientation>=5?height:width;canvas.height=orientation>=5?width:height;
          const context=canvas.getContext('2d');
          const matrices={2:[-1,0,0,1,width,0],3:[-1,0,0,-1,width,height],4:[1,0,0,-1,0,height],5:[0,1,1,0,0,0],6:[0,1,-1,0,height,0],7:[0,-1,-1,0,height,width],8:[0,-1,1,0,0,width]};
          if(matrices[orientation])context.transform(...matrices[orientation]);
          context.drawImage(bitmap,0,0,width,height);bitmap.close();
          const sample=document.createElement('canvas');sample.width=9;sample.height=8;const sampleContext=sample.getContext('2d',{willReadFrequently:true});sampleContext.drawImage(canvas,0,0,9,8);
          const pixels=sampleContext.getImageData(0,0,9,8).data;let hash='';
          const light=index=>pixels[index*4]*.299+pixels[index*4+1]*.587+pixels[index*4+2]*.114;
          for(let y=0;y<8;y++)for(let x=0;x<8;x++)hash+=light(y*9+x)>light(y*9+x+1)?'1':'0';
          const duplicate=[...fingerprints].find(([index,value])=>index!==page*24+i && similar(value,hash));
          fingerprints.set(page*24+i,hash);
          if(duplicate)dialog.querySelector(`[data-similar="${page*24+i}"]`).textContent=`Có thể gần giống ${files[duplicate[0]].name}. Hãy kiểm tra trước khi giữ cả hai.`;
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.65));
          if(current!==generation || !dialog.open) return;
          if(!blob) throw new Error('Không mở được ảnh');
          const url=URL.createObjectURL(blob);urls.push(url);
          const img=document.createElement('img');img.src=url;img.alt=file.name;slot.replaceChildren(img);
        } catch (_) { if(current===generation && slot) slot.textContent='Không xem trước được; hãy xuất JPG nếu tải lỗi.'; }
      }
    };
    return new Promise(resolve => {
      dialog.addEventListener('close',()=>{release();dialog.remove();resolve([]);},{once:true});
      dialog.addEventListener('cancel',event=>{if(checking)event.preventDefault();});
      dialog.querySelector('[data-cancel]').onclick=()=>{if(!checking)dialog.close();};
      dialog.querySelector('[data-select-all]').onclick=()=>{if(files.length<=remaining)files.forEach((_,i)=>selected.add(i));update();};
      dialog.querySelector('[data-select-none]').onclick=()=>{selected.clear();update();};
      dialog.querySelector('[data-prev]').onclick=()=>{page--;void render();};
      dialog.querySelector('[data-next]').onclick=()=>{page++;void render();};
      dialog.addEventListener('change',event=>{if(event.target.matches('[data-file]')){const i=Number(event.target.dataset.file);if(event.target.checked && selected.size<remaining)selected.add(i);else selected.delete(i);update();}});
      dialog.querySelector('[data-confirm]').onclick=async()=>{
        if(!capacity(existingCount,selected.size).valid || checking)return;
        checking=true;update();dialog.querySelector('[data-cancel]').disabled=true;dialog.querySelector('[data-select-none]').disabled=true;
        dialog.querySelector('[data-selection-status]').textContent='Đang kiểm tra tệp trùng trước khi tải…';
        try { const chosen=await uniqueFiles([...selected].map(i=>files[i])); resolve(chosen);dialog.close(); }
        catch (_) { checking=false;update();dialog.querySelector('[data-cancel]').disabled=false;dialog.querySelector('[data-select-none]').disabled=false;dialog.querySelector('[data-selection-error]').textContent='Chưa đọc được tệp. Hãy chọn ít ảnh hơn hoặc xuất JPG rồi thử lại.'; }
      };
      dialog.showModal();void render();
    });
  }
  const api={MAX_PHOTOS,capacity,uniqueFiles,similar,choose};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.TeresaPhotoPicker=api;
})(typeof window!=='undefined'?window:globalThis);
