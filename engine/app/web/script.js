(() => {
  const el = id => { const n = document.getElementById(id); if (!n) throw new Error(`#${id} missing`); return n; };

  // DOM
  const promptEl  = el("prompt");
  const maxNewEl  = el("maxNew");
  const layersEl  = el("layers");
  const viewModeEl= el("viewMode");
  const focusWrap = el("focusWrap");
  const focusSel  = el("focusLayer");
  const startBtn  = el("startBtn");
  const pauseBtn  = el("pauseBtn");
  const resumeBtn = el("resumeBtn");
  const clearBtn  = el("clearBtn");
  const statusEl  = el("status");
  const textEl    = el("text");
  const scrubber  = el("scrubber");
  const frameLbl  = el("frameLabel");
  const tokenLbl  = el("tokenLabel");
  const canvas    = el("pixelMap");
  const ctx       = canvas.getContext("2d");
  const tickerEl  = el("ticker");

  // State
  let ws = null;
  let frames = [];     // { pixel_map, side, text, token }
  let liveIndex = -1, curIndex = -1, playing = false;
  let nLayers = 12;    // will fetch from /meta
  let selectedLayers = []; // array of ABSOLUTE ints we request/show
  if (!canvas.style.width)  canvas.style.width  = "100%";
  if (!canvas.style.height) canvas.style.height = "100%";

  // Fetch model meta once (so "all" expands correctly and focus menu is filled)
  fetch(`/meta?model_id=gpt2&driver=tl_gpt`).then(r=>r.json()).then(meta => {
    if (meta?.n_layers) nLayers = meta.n_layers;
    refreshFocusOptions();
  }).catch(()=>{ /* fine, keep defaults */ });

  // UI actions
  startBtn.onclick  = () => startRun();
  pauseBtn.onclick  = () => { playing = false; updatePlayButtons(); };
  resumeBtn.onclick = () => { playing = true;  updatePlayButtons(); };
  clearBtn.onclick  = resetAll;
  viewModeEl.onchange = () => {
    focusWrap.style.display = (viewModeEl.value === "single") ? "" : "none";
  };

  scrubber.oninput = (e) => {
    const idx = parseInt(e.target.value || "0", 10);
    playing = false;
    updatePlayButtons();
    renderFrame(idx);
  };

window.addEventListener("keydown", (e) => {
    const targetTag = e.target.tagName.toLowerCase();
    const typing = targetTag === "input" || targetTag === "textarea";

    if (!typing) {
        if (e.code === "Space") { 
            e.preventDefault();
            playing ? pauseBtn.onclick() : resumeBtn.onclick();
        }
        else if (e.code === "ArrowRight") step(+1);
        else if (e.code === "ArrowLeft")  step(-1);
    }
});


  function refreshFocusOptions() {
    focusSel.innerHTML = "";
    for (let i=0;i<nLayers;i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Layer ${i}`;
      focusSel.appendChild(opt);
    }
  }

  function parseLayerSpec(spec, maxLayers) {
    const s = String(spec || "").trim().toLowerCase();
    if (s === "" || s === "all") return Array.from({length:maxLayers}, (_,i)=>i);
    // allow "0,3,6,9" and ranges "2-5,9,11"
    const out = new Set();
    for (const part of s.split(",")) {
      const p = part.trim();
      if (!p) continue;
      if (p.includes("-")) {
        const [a,b] = p.split("-").map(x=>parseInt(x.trim(),10));
        if (Number.isFinite(a) && Number.isFinite(b)) {
          const lo = Math.max(0, Math.min(a,b));
          const hi = Math.min(maxLayers-1, Math.max(a,b));
          for (let k=lo;k<=hi;k++) out.add(k);
        }
      } else {
        const v = parseInt(p,10);
        if (Number.isFinite(v) && v>=0 && v<maxLayers) out.add(v);
      }
    }
    return Array.from(out).sort((a,b)=>a-b);
  }

  function updatePlayButtons() {
    pauseBtn.disabled  = !playing || frames.length === 0;
    resumeBtn.disabled =  playing || frames.length === 0 || curIndex === liveIndex;
  }

  function resetAll() {
    try { ws?.close(); } catch {}
    ws = null;
    frames = [];
    liveIndex = curIndex = -1;
    playing = false;
    scrubber.min = 0; scrubber.max = 0; scrubber.value = 0;
    frameLbl.textContent = "Frame 0/0"; tokenLbl.textContent = "";
    textEl.textContent = ""; statusEl.textContent = "";
    ctx.clearRect(0,0,canvas.width, canvas.height);
    tickerEl.textContent = "";
    updatePlayButtons();
  }

  function startRun() {
    resetAll();

    const prompt = (promptEl.value || "").trim();
    if (!prompt) { alert("Enter a prompt"); return; }

    selectedLayers = parseLayerSpec(layersEl.value, nLayers);
    if (viewModeEl.value === "single") {
      const focus = parseInt(focusSel.value || "0", 10);
      if (!selectedLayers.includes(focus)) selectedLayers = [focus];
      else selectedLayers = [focus]; // show just that one
    }
    if (selectedLayers.length === 0) selectedLayers = [0]; // fallback

    ws = new WebSocket(`ws://${location.host}/ws/generate`);
    statusEl.textContent = "connecting…";
    startBtn.disabled = true;

    ws.onopen = () => {
      statusEl.textContent = "streaming";
      const cfg = {
        model_id: "gpt2",
        driver: "tl_gpt",
        prompt,
        max_new_tokens: parseInt(maxNewEl.value || "64", 10),
        topk: 5,
        select_layers: selectedLayers,   // summaries
        pixels: true,
        pixel_layers: selectedLayers     // pixel map matches selected set
      };
      ws.send(JSON.stringify(cfg));
      playing = true;
      updatePlayButtons();
      requestAnimationFrame(loop);
    };

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      const f = {
        pixel_map: m.pixel_map || null,
        side: m.pixel_side || null,
        text: m.text || "",
        token: m.generated_token || ""
      };
      frames.push(f);
      liveIndex = frames.length - 1;
      scrubber.max = liveIndex;

      if (playing) {
        renderFrame(liveIndex);
        scrubber.value = liveIndex;
      }
    };

    ws.onclose = () => {
      statusEl.textContent = "closed";
      playing = false; updatePlayButtons();
      startBtn.disabled = false;
    };
    ws.onerror = (e) => {
      console.error("WS error", e);
      statusEl.textContent = "error";
      startBtn.disabled = false;
    };
  }

  function step(d) {
    if (!frames.length) return;
    const idx = Math.max(0, Math.min(frames.length - 1, (curIndex < 0 ? 0 : curIndex) + d));
    renderFrame(idx);
    scrubber.value = idx;
  }

  function loop() {
    if (playing && curIndex < liveIndex) {
      renderFrame(curIndex + 1);
      scrubber.value = curIndex;
    }
    requestAnimationFrame(loop);
  }

  function renderFrame(idx) {
    if (idx < 0 || idx >= frames.length) return;
    curIndex = idx;
    const f = frames[idx];

    textEl.textContent = f.text;
    const tail = (f.text || "").slice(-150).replace(/\s+/g, ' ');
    tickerEl.textContent = tail;

    frameLbl.textContent = `Frame ${idx + 1}/${frames.length}`;
    tokenLbl.textContent = f.token ? `Token: ${JSON.stringify(f.token)}` : "";

    if (f.pixel_map && f.side) {
      const mode = (viewModeEl.value || "combined");
      if (mode === "tiled" && selectedLayers.length > 1) {
        drawTiledPixelMap(ctx, f.pixel_map, selectedLayers);
      } else if (mode === "single" && selectedLayers.length === 1) {
        // slice out the single layer and draw big
        const per = Math.floor(f.pixel_map.length / 1); // already only one layer in map
        drawPixelMap(ctx, f.pixel_map, Math.ceil(Math.sqrt(per)));
      } else {
        drawPixelMap(ctx, f.pixel_map, f.side);
      }
    }
    updatePlayButtons();
  }

  // -------- Rendering helpers --------

  // Combined view: percentile grayscale, scaled to canvas
  function drawPixelMap(ctx, pixels, side) {
    const cssW = canvas.clientWidth || 768;
    const cssH = canvas.clientHeight || 768;
    if (canvas.width !== cssW || canvas.height !== cssH) {
      canvas.width = cssW; canvas.height = cssH;
    }

    const arr = pixels.slice().sort((a,b)=>a-b);
    const q = (p)=> arr[Math.max(0, Math.min(arr.length-1, Math.floor(p*(arr.length-1))))];
    const lo = q(0.02), hi = q(0.98), den = Math.max(1e-9, hi - lo);

    const img = new ImageData(side, side);
    for (let i=0;i<pixels.length;i++){
      let t = (pixels[i] - lo)/den; if (t<0) t=0; if (t>1) t=1;
      const v = (t*255)|0;
      const o = i*4;
      img.data[o]=v; img.data[o+1]=v; img.data[o+2]=v; img.data[o+3]=255;
    }

    const off = document.createElement('canvas');
    off.width = side; off.height = side;
    off.getContext('2d').putImageData(img, 0, 0);

    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W/side, H/side);
    const dw = (side*scale)|0, dh = (side*scale)|0;
    const dx = ((W - dw)/2)|0, dy = ((H - dh)/2)|0;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(off, 0,0, side, side, dx, dy, dw, dh);
  }

  // Tiled-by-layer view (labels show ABSOLUTE layer numbers)
  function drawTiledPixelMap(ctx, pixels, layerIndices) {
    const layerCount = layerIndices.length;
    const total = pixels.length;
    const perLayer = Math.floor(total / layerCount);
    const cols = Math.ceil(Math.sqrt(layerCount));
    const rows = Math.ceil(layerCount / cols);
    const tileSide = Math.ceil(Math.sqrt(perLayer));

    const cssW = canvas.clientWidth || 768;
    const cssH = canvas.clientHeight || 768;
    if (canvas.width !== cssW || canvas.height !== cssH) {
      canvas.width = cssW; canvas.height = cssH;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,canvas.width, canvas.height);

    const pad = 10, labelH = 16;
    const cellW = Math.floor((canvas.width  - pad*(cols+1)) / cols);
    const cellH = Math.floor((canvas.height - pad*(rows+1)) / rows);
    const cellSize = Math.min(cellW, cellH);

    const arr = pixels.slice().sort((a,b)=>a-b);
    const q = (p)=> arr[Math.max(0, Math.min(arr.length-1, Math.floor(p*(arr.length-1))))];
    const lo = q(0.02), hi = q(0.98), den = Math.max(1e-9, hi - lo);

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileSide; tileCanvas.height = tileSide;
    const tctx = tileCanvas.getContext('2d');

    for (let i=0; i<layerCount; i++) {
      const start = i * perLayer;
      const end   = Math.min(start + perLayer, total);
      const slice = pixels.slice(start, end);

      const img = tctx.createImageData(tileSide, tileSide);
      for (let j=0;j<slice.length;j++){
        let t = (slice[j] - lo)/den; if (t<0) t=0; if (t>1) t=1;
        const v = (t*255)|0;
        const o = j*4;
        img.data[o]=v; img.data[o+1]=v; img.data[o+2]=v; img.data[o+3]=255;
      }
      tctx.putImageData(img, 0, 0);

      const cx = i % cols;
      const cy = Math.floor(i / cols);
      const dx = pad + cx * (cellSize + pad);
      const dy = pad + cy * (cellSize + pad);
      const inner = cellSize - labelH;

      ctx.fillStyle = "#0a0d14";
      ctx.fillRect(dx, dy, cellSize, cellSize);
      ctx.drawImage(tileCanvas, 0,0, tileSide, tileSide, dx, dy, inner, inner);
      ctx.strokeStyle = "#253046"; ctx.lineWidth = 2;
      ctx.strokeRect(dx+1, dy+1, inner-2, inner-2);

      ctx.fillStyle = "#9aa4b2";
      ctx.font = "12px ui-monospace, Menlo, monospace";
      ctx.fillText(`Layer ${layerIndices[i]}`, dx + 4, dy + inner + 13);
    }
  }
})();
