'use strict';

const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const flash       = document.getElementById('flash');
const cameraView  = document.getElementById('camera-view');
const previewView = document.getElementById('preview-view');
const errorView   = document.getElementById('error-view');
const errorMsg    = document.getElementById('error-msg');
const btnCapture  = document.getElementById('btn-capture');
const btnFlip     = document.getElementById('btn-flip');
const btnRetake   = document.getElementById('btn-retake');
const btnDownload = document.getElementById('btn-download');
const btnRetry    = document.getElementById('btn-retry');

let stream = null;
let facingMode = 'user';

async function startCamera() {
  stopStream();
  showView('camera');

  const constraints = {
    video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1920 } },
    audio: false,
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
  } catch (err) {
    showError(buildErrorMessage(err));
  }
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

function triggerFlash() {
  flash.classList.remove('pop');
  void flash.offsetWidth;
  flash.classList.add('pop');
}

function capturePhoto() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  triggerFlash();

  const size = Math.min(vw, vh);
  const sx   = (vw - size) / 2;
  const sy   = (vh - size) / 2;

  canvas.width  = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');

  if (facingMode === 'user') {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, -size, 0, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
  }

  setTimeout(() => {
    stopStream();
    showView('preview');
  }, 150);
}

function downloadPhoto() {
  const link  = document.createElement('a');
  const ts    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  link.download = `portrait-${ts}.jpg`;
  link.href     = canvas.toDataURL('image/jpeg', 0.93);
  link.click();
}

function showView(name) {
  cameraView.classList.toggle('hidden',  name !== 'camera');
  previewView.classList.toggle('hidden', name !== 'preview');
  errorView.classList.toggle('hidden',   name !== 'error');
}

function showError(msg) {
  errorMsg.textContent = msg;
  showView('error');
}

function buildErrorMessage(err) {
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
    return '相機存取被拒絕。\n請在瀏覽器設定中允許使用相機後重試。';
  }
  if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
    return '找不到相機裝置。\n請確認裝置有相機並已連接。';
  }
  if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
    return '相機正在被其他應用程式使用中，請關閉後重試。';
  }
  return `無法啟動相機：${err.message || err.name}`;
}

video.addEventListener('loadedmetadata', () => {
  video.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
});

btnCapture.addEventListener('click', capturePhoto);

btnFlip.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});

btnRetake.addEventListener('click', startCamera);
btnDownload.addEventListener('click', downloadPhoto);
btnRetry.addEventListener('click', startCamera);

startCamera();
