// Core UI + generation logic
(function(){
  const TEX_W = 150, TEX_H = 150; // textures are 150 width, 150 height (grid stays on right)
  const CELL = 50; // each cell 50x50 in the right section (2 cols x 3 rows)

  let currentSpecIndex = 0;
  const assignments = {}; // { specId: [ {color: '#ff0000', section: 2}, ... ] }

  // DOM-based preview elements (replaces canvas drawing)
  let previewEl = null;
  let overlayGrid = null;

  function init(){
    renderSpecs();
    selectSpec(0);
    document.getElementById('saveBtn').addEventListener('click', onSave);
  }

  function renderSpecs(){
    const row = document.getElementById('specsRow');
    row.innerHTML = '';
    SPECS.forEach((s,i)=>{
      const el = document.createElement('div');
      el.className = 'spec-icon';
      el.title = s.name;
      el.innerHTML = `<img src="${s.icon}" alt="${s.name}">`;
      el.addEventListener('click',()=>selectSpec(i));
      row.appendChild(el);
    });
  }

  function selectSpec(index){
    currentSpecIndex = index;
    const row = document.getElementById('specsRow');
    Array.from(row.children).forEach((c,i)=>c.classList.toggle('selected', i===index));
    renderSpells();
    updatePreview();
  }

  function ensureAssignments(specId){
    if(!assignments[specId]){
      assignments[specId] = SPECS.find(s=>s.id===specId).spells.map(()=>({color:'#00ff00',section:null}));
    }
    return assignments[specId];
  }

  function renderSpells(){
    const spec = SPECS[currentSpecIndex];
    const list = document.getElementById('spellsList');
    list.innerHTML = '';
    const state = ensureAssignments(spec.id);

    spec.spells.forEach((spell,si)=>{
      const row = document.createElement('div');
      row.className = 'spell-row';

      const info = document.createElement('div');
      info.className = 'spell-info';
      info.innerHTML = `<img src="img/${spell.key}.jpg" alt=""><div class="spell-name">${spell.name}</div>`;

      const controls = document.createElement('div');
      controls.className = 'spell-controls';
      const colorIn = document.createElement('input');
      colorIn.type = 'color';
      colorIn.value = state[si].color || '#00ff00';
      colorIn.addEventListener('input',()=>{ state[si].color = colorIn.value; updatePreview(); });

      const select = document.createElement('select');
      const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = 'None';
      select.appendChild(noneOpt);
      for(let i=0;i<6;i++){ const opt=document.createElement('option'); opt.value=i; opt.textContent = `Section ${i+1}`; select.appendChild(opt); }
      select.value = state[si].section==null ? '' : state[si].section;
      select.addEventListener('change',()=>{ state[si].section = select.value===''?null:parseInt(select.value,10); updatePreview(); });

      controls.appendChild(colorIn);
      controls.appendChild(select);
      row.appendChild(info);
      row.appendChild(controls);
      list.appendChild(row);
    });
  }

  function updatePreview(){
    // ensure preview elements are cached
    if(!previewEl) previewEl = document.getElementById('preview');
    if(!overlayGrid) overlayGrid = document.getElementById('overlayGrid');

    const spec = SPECS[currentSpecIndex];
    const state = ensureAssignments(spec.id);

    // reset all cell backgrounds
    const cells = overlayGrid ? Array.from(overlayGrid.querySelectorAll('.grid-cell')) : [];
    cells.forEach(c=>{ const bg = c.querySelector('.cell-bg'); if(bg) bg.style.background = 'transparent'; });

    // apply assignments: set the cell background to the assigned color
    state.forEach(s=>{
      if(s.section==null) return;
      const cell = overlayGrid.querySelector(`.grid-cell[data-section="${s.section}"]`);
      if(cell){ const bg = cell.querySelector('.cell-bg'); if(bg) bg.style.background = (s.color||'#00ff00'); }
    });
  }

  // TGA writer: writes uncompressed 32-bit BGRA with top-left origin
  function canvasToTgaBlob(canvas){
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const idata = ctx.getImageData(0,0,w,h).data;
    const header = new Uint8Array(18);
    header[2] = 2; // uncompressed true-color
    header[12] = w & 0xFF; header[13] = (w>>8)&0xFF;
    header[14] = h & 0xFF; header[15] = (h>>8)&0xFF;
    header[16] = 32; // bits per pixel
    header[17] = 8 | 0x20; // 8 bits alpha, top-left origin

    const pixelData = new Uint8Array(w*h*4);
    // convert RGBA -> BGRA in top-left order
    for(let i=0, j=0;i<idata.length;i+=4,j+=4){
      pixelData[j+0] = idata[i+2]; // B
      pixelData[j+1] = idata[i+1]; // G
      pixelData[j+2] = idata[i+0]; // R
      pixelData[j+3] = idata[i+3]; // A
    }

    const out = new Uint8Array(header.length + pixelData.length);
    out.set(header,0); out.set(pixelData, header.length);
    return new Blob([out], {type:'application/octet-stream'});
  }

  // helper for rounded rectangles
  function roundRect(ctx, x, y, w, h, r, fill, stroke){
    if (typeof r === 'undefined') r = 5;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  async function onSave(){
    const spec = SPECS[currentSpecIndex];
    const state = ensureAssignments(spec.id);
    const zip = new JSZip();
    // for each assigned spell, create 100x150 texture with colored 50x50 at the section
    for(let i=0;i<spec.spells.length;i++){
      const s = state[i];
      const tex = document.createElement('canvas'); tex.width = TEX_W; tex.height = TEX_H;
      const tctx = tex.getContext('2d');
      // start fully transparent
      tctx.clearRect(0,0,TEX_W,TEX_H);
      if(s.section!=null){
        const col = s.color || '#00ff00';
        const colIndex = s.section;
        // grid occupies rightmost 2*CELL (100px). Offset so cells render on the right side
        const offsetX = TEX_W - (2 * CELL); // e.g. 150 - 100 = 50
        const cx = offsetX + (colIndex % 2) * CELL;
        const cy = Math.floor(colIndex / 2) * CELL;
        tctx.fillStyle = col;
        tctx.fillRect(cx, cy, CELL, CELL);
      }
      // produce a TGA even if fully transparent
      const blob = canvasToTgaBlob(tex);
      const filename = `${spec.spells[i].key}.tga`;
      zip.file(filename, blob);
    }

    const content = await zip.generateAsync({type:'blob'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `${spec.id || 'textures'}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function parseColor(hex){
    // returns {r,g,b,a} but we only need hex for fillStyle
    return hex;
  }

  // wire some updates - ensure init runs even if DOMContentLoaded already fired
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // redraw preview when window is visible/resized
  window.addEventListener('resize', updatePreview);

})();
