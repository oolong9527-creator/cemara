'use strict';

// ── DOM ──
const video         = document.getElementById('video');
const flash         = document.getElementById('flash');
const cameraView    = document.getElementById('camera-view');
const previewView   = document.getElementById('preview-view');
const errorView     = document.getElementById('error-view');
const errorMsg      = document.getElementById('error-msg');
const canvas        = document.getElementById('canvas');
const btnCapture    = document.getElementById('btn-capture');
const btnFlip       = document.getElementById('btn-flip');
const btnRetake     = document.getElementById('btn-retake');
const btnDownload   = document.getElementById('btn-download');
const btnRetry      = document.getElementById('btn-retry');
const bgPills       = document.querySelectorAll('[data-bg]');
const fmtPills      = document.querySelectorAll('[data-fmt]');
const sizePills     = document.querySelectorAll('[data-size]');
const slSmooth      = document.getElementById('sl-smooth');
const slBrightness  = document.getElementById('sl-brightness');
const slWarmth      = document.getElementById('sl-warmth');
const valSmooth     = document.getElementById('val-smooth');
const valBrightness = document.getElementById('val-brightness');
const valWarmth     = document.getElementById('val-warmth');
const segLoading    = document.getElementById('seg-loading');

// ── State ──
let stream      = null;
let facingMode  = 'user';
let rawCanvas   = null;   // original captured square image
let whiteCanvas = null;   // person composited over white bg
let segmenter   = null;
let segReady    = false;

// 35×45mm @ 600 DPI → 827×1063 px
const SIZE_PRESETS = {
  '2inch': { w: 827,  h: 1063 },
  '1200':  { w: 1200, h: 1200 },
  '2000':  { w: 2000, h: 2000 },
  '0':     null,                  // original square
};

const cfg = {
  whiteBg:    false,
  smooth:     0,
  brightness: 0,
  warmth:     0,
  format:     'jpeg',
  sizeKey:    '2inch',
};

// ── Camera ──────────────────────────────────────────────────────────────────

async function startCamera() {
  stopStream();
  showView('camera');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    });
    video.srcObject = stream;
  } catch (err) {
    showError(buildErrorMessage(err));
  }
}

function stopStream() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
}

// ── Capture ─────────────────────────────────────────────────────────────────

function capturePhoto() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;

  triggerFlash();

  const size = Math.min(vw, vh);
  rawCanvas = document.createElement('canvas');
  rawCanvas.width = rawCanvas.height = size;
  const ctx = rawCanvas.getContext('2d');

  if (facingMode === 'user') {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, (vw - size) / 2, (vh - size) / 2, size, size, -size, 0, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(video, (vw - size) / 2, (vh - size) / 2, size, size, 0, 0, size, size);
  }

  resetEdits();

  setTimeout(() => {
    stopStream();
    renderPreview();
    showView('preview');
  }, 130);
}

function resetEdits() {
  whiteCanvas = null;
  cfg.whiteBg = false;
  cfg.smooth = cfg.brightness = cfg.warmth = 0;
  slSmooth.value = slBrightness.value = slWarmth.value = '0';
  valSmooth.textContent = valBrightness.textContent = valWarmth.textContent = '0';
  bgPills.forEach(p => p.classList.toggle('active', p.dataset.bg === 'original'));
}

function triggerFlash() {
  flash.classList.remove('pop');
  void flash.offsetWidth;
  flash.classList.add('pop');
}

// ── Edit pipeline ────────────────────────────────────────────────────────────

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

function applyPixelAdjustments(ctx, w, h, brightness, warmth) {
  if (!brightness && !warmth) return;
  const id = ctx.getImageData(0, 0, w, h);
  const d  = id.data;
  const b  = brightness * 0.8;
  const wm = warmth * 0.4;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = clamp(d[i]   + b + wm);
    d[i+1] = clamp(d[i+1] + b);
    d[i+2] = clamp(d[i+2] + b - wm);
  }
  ctx.putImageData(id, 0, 0);
}

// Crop the square source to match outW:outH aspect ratio
function cropSource(src, outW, outH) {
  const s = src.width;
  const aspect = outW / outH;
  let sx, sy, sw, sh;
  if (aspect <= 1) {
    sw = Math.round(s * aspect);
    sh = s;
    sx = Math.round((s - sw) / 2);
    sy = 0;
  } else {
    sw = s;
    sh = Math.round(s / aspect);
    sx = 0;
    sy = Math.round((s - sh) / 2);
  }
  return { sx, sy, sw, sh };
}

async function buildEditedCanvas(outW, outH) {
  const src = (cfg.whiteBg && whiteCanvas) ? whiteCanvas : rawCanvas;
  const { sx, sy, sw, sh } = cropSource(rawCanvas, outW, outH);

  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d');

  if (cfg.whiteBg && whiteCanvas) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    // Crop whiteCanvas the same way
    const wc = whiteCanvas;
    const tmp2 = document.createElement('canvas');
    tmp2.width = outW; tmp2.height = outH;
    const tc2 = tmp2.getContext('2d');
    tc2.fillStyle = '#ffffff';
    tc2.fillRect(0, 0, outW, outH);
    tc2.drawImage(wc, sx, sy, sw, sh, 0, 0, outW, outH);
    ctx.drawImage(tmp2, 0, 0);
  } else {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH);
  }

  // Smoothing blur
  const blurPx = (cfg.smooth / 100) * 3.5 * (Math.min(outW, outH) / 1000);
  if (blurPx > 0.25 && 'filter' in ctx) {
    const tmp = document.createElement('canvas');
    tmp.width = outW; tmp.height = outH;
    const tc  = tmp.getContext('2d');
    tc.filter = `blur(${blurPx.toFixed(2)}px)`;
    tc.drawImage(out, 0, 0);
    ctx.clearRect(0, 0, outW, outH);
    if (cfg.whiteBg) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, outW, outH); }
    ctx.drawImage(tmp, 0, 0);
  }

  applyPixelAdjustments(ctx, outW, outH, cfg.brightness, cfg.warmth);
  return out;
}

function getOutputDims(forDisplay = false) {
  const preset = SIZE_PRESETS[cfg.sizeKey];
  if (!preset) return { w: rawCanvas.width, h: rawCanvas.width };
  if (!forDisplay) return { w: preset.w, h: preset.h };
  const maxPx = 900;
  const scale = Math.min(maxPx / preset.w, maxPx / preset.h, 1);
  return { w: Math.round(preset.w * scale), h: Math.round(preset.h * scale) };
}

async function renderPreview() {
  const { w, h } = getOutputDims(true);
  const out = await buildEditedCanvas(w, h);
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(out, 0, 0);
}

// ── Segmentation (MediaPipe) ─────────────────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initSegmenter() {
  if (segReady) return;
  if (typeof SelfieSegmentation === 'undefined') {
    await loadScript(
      'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js'
    );
  }
  segmenter = new SelfieSegmentation({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`,
  });
  segmenter.setOptions({ modelSelection: 1 });
  segmenter.onResults(() => {});
  await segmenter.initialize();
  segReady = true;
}

async function segmentOnce(imageSource) {
  return new Promise(resolve => {
    segmenter.onResults(r => resolve(r.segmentationMask));
    segmenter.send({ image: imageSource });
  });
}

async function applyWhiteBackground() {
  segLoading.classList.remove('hidden');
  try {
    await initSegmenter();
    const mask = await segmentOnce(rawCanvas);
    const size = rawCanvas.width;
    whiteCanvas = document.createElement('canvas');
    whiteCanvas.width = whiteCanvas.height = size;
    const ctx = whiteCanvas.getContext('2d');

    // Person layer (mask cuts out background)
    const person = document.createElement('canvas');
    person.width = person.height = size;
    const pc = person.getContext('2d');
    pc.drawImage(rawCanvas, 0, 0);
    pc.globalCompositeOperation = 'destination-in';
    pc.drawImage(mask, 0, 0, size, size);

    // White bg + person on top
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(person, 0, 0);
  } catch {
    showToast('背景移除需要網路，請確認連線後重試');
    cfg.whiteBg = false;
    bgPills.forEach(p => p.classList.toggle('active', p.dataset.bg === 'original'));
  } finally {
    segLoading.classList.add('hidden');
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '120px', left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(30,30,30,0.92)', color: '#fff',
    padding: '10px 20px', borderRadius: '20px',
    fontSize: '0.84rem', zIndex: 9999,
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.1)',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ── Download ─────────────────────────────────────────────────────────────────

async function downloadPhoto() {
  btnDownload.textContent = '處理中...';
  btnDownload.disabled = true;
  try {
    const { w, h } = getOutputDims(false);
    const out = await buildEditedCanvas(w, h);
    const mimeMap = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const extMap  = { jpeg: 'jpg', png: 'png', webp: 'webp' };
    const quality = cfg.format === 'jpeg' ? 0.93 : cfg.format === 'webp' ? 0.9 : undefined;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a  = document.createElement('a');
    a.download = `portrait-${ts}.${extMap[cfg.format]}`;
    a.href = out.toDataURL(mimeMap[cfg.format], quality);
    a.click();
  } finally {
    btnDownload.textContent = '儲存';
    btnDownload.disabled = false;
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function showView(name) {
  cameraView.classList.toggle('hidden',  name !== 'camera');
  previewView.classList.toggle('hidden', name !== 'preview');
  errorView.classList.toggle('hidden',   name !== 'error');
}

function showError(msg) { errorMsg.textContent = msg; showView('error'); }

function buildErrorMessage(err) {
  if (err.name === 'NotAllowedError')  return '相機存取被拒絕。\n請在瀏覽器設定中允許使用相機。';
  if (err.name === 'NotFoundError')    return '找不到相機裝置，請確認裝置有相機。';
  if (err.name === 'NotReadableError') return '相機正被其他應用使用，請關閉後重試。';
  return `無法啟動相機：${err.message || err.name}`;
}

// ── Event listeners ──────────────────────────────────────────────────────────

video.addEventListener('loadedmetadata', () => {
  video.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'none';
});

btnCapture.addEventListener('click', capturePhoto);
btnFlip.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});
btnRetake.addEventListener('click', startCamera);
btnDownload.addEventListener('click', downloadPhoto);
btnRetry.addEventListener('click', startCamera);

// Background
bgPills.forEach(btn => {
  btn.addEventListener('click', async () => {
    const wantWhite = btn.dataset.bg === 'white';
    if (wantWhite === cfg.whiteBg) return;
    cfg.whiteBg = wantWhite;
    bgPills.forEach(p => p.classList.toggle('active', p === btn));
    if (wantWhite && !whiteCanvas) await applyWhiteBackground();
    renderPreview();
  });
});

// Sliders
function bindSlider(el, key, valEl) {
  el.addEventListener('input', () => {
    cfg[key] = +el.value;
    valEl.textContent = el.value;
    renderPreview();
  });
}
bindSlider(slSmooth,     'smooth',     valSmooth);
bindSlider(slBrightness, 'brightness', valBrightness);
bindSlider(slWarmth,     'warmth',     valWarmth);

// Format pills
fmtPills.forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.format = btn.dataset.fmt;
    fmtPills.forEach(p => p.classList.toggle('active', p === btn));
  });
});

// Size pills
sizePills.forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.sizeKey = btn.dataset.size;
    sizePills.forEach(p => p.classList.toggle('active', p === btn));
    renderPreview();
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────────
startCamera();
