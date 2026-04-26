// ═══════════════════════════════════════════════
//  EPP DETECTOR — app.js
//  Roboflow Workspace : jas-workspace
//  Project           : epp_seguridad
//  Model Version     : 1
// ═══════════════════════════════════════════════

// ── CONFIG ──────────────────────────────────────
const ROBOFLOW_PROJECT = 'epps_project';
const ROBOFLOW_VERSION = '1';

const EPP_CLASSES = {
  'botas':    { name: 'Botas',    icon: '👢', required: true  },
  'casco':    { name: 'Casco',    icon: '🪖', required: true  },
  'chaleco':  { name: 'Chaleco',  icon: '🦺', required: true  },
  'mascara':  { name: 'Máscara',  icon: '😷', required: true  },
  'orejeras': { name: 'Orejeras', icon: '🎧', required: true  },
  'persona':  { name: 'Persona',  icon: '👤', required: false },
};

const REQUIRED_IDS = Object.entries(EPP_CLASSES)
  .filter(([, v]) => v.required)
  .map(([k]) => k);

const BOX_COLORS = {
  required : '#10B981',   // green  → required EPP detected
  optional : '#3B82F6',   // blue   → persona
  missing  : '#EF4444',   // red    → no EPP at all (border)
};

// ── STATE ────────────────────────────────────────
let apiKey           = '';
let confidenceThresh = 0.60;
let detectionInterval= 1500;
let detectionTimer   = null;
let cameraActive     = false;
let isDetecting      = false;
const INPUT_W = 640, INPUT_H = 480;

// ── DOM REFS ─────────────────────────────────────
const video          = document.getElementById('video');
const overlay        = document.getElementById('overlay');
const ctx            = overlay.getContext('2d');
const cameraWrapper  = document.getElementById('camera-wrapper');
const placeholder    = document.getElementById('camera-placeholder');
const scanLine       = document.getElementById('scan-line');
const noDetOverlay   = document.getElementById('no-detection-overlay');

const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');

const accessCard     = document.getElementById('access-card');
const accessIcon     = document.getElementById('access-icon');
const accessLabel    = document.getElementById('access-label');
const accessSublabel = document.getElementById('access-sublabel');

const missingAlert   = document.getElementById('missing-alert');
const missingList    = document.getElementById('missing-list');

const eppGrid        = document.getElementById('epp-grid');
const eppCounter     = document.getElementById('epp-counter');
const progressBar    = document.getElementById('progress-bar');
const progressLabel  = document.getElementById('progress-label');

const detectionsCount= document.getElementById('detections-count');
const lastUpdate     = document.getElementById('last-update');
const intervalDisplay= document.getElementById('interval-display');
const confidenceDisplay = document.getElementById('confidence-display');

// Buttons
const startBtn       = document.getElementById('start-camera-btn');
const stopBtn        = document.getElementById('stop-camera-btn');
const settingsBtn    = document.getElementById('settings-btn');
const modalOverlay   = document.getElementById('modal-overlay');
const closeModalBtn  = document.getElementById('close-modal-btn');
const cancelModalBtn = document.getElementById('cancel-modal-btn');
const saveConfigBtn  = document.getElementById('save-config-btn');
const togglePassBtn  = document.getElementById('toggle-password');
const apiKeyInput    = document.getElementById('api-key-input');
const confInput      = document.getElementById('confidence-input');
const confValue      = document.getElementById('confidence-value');
const intervalInput  = document.getElementById('interval-input');

// ── BUILD EPP CARDS ──────────────────────────────
function buildEppCards() {
  eppGrid.innerHTML = '';
  Object.entries(EPP_CLASSES).forEach(([id, epp]) => {
    if (!epp.required) return;
    const card = document.createElement('div');
    card.className = 'epp-card';
    card.id = `epp-card-${id}`;
    card.innerHTML = `
      <div class="epp-card-icon">${epp.icon}</div>
      <div class="epp-card-info">
        <span class="epp-card-name">${epp.name}</span>
        <span class="epp-card-conf" id="epp-conf-${id}">—</span>
      </div>
      <div class="epp-card-badge" id="epp-badge-${id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>`;
    eppGrid.appendChild(card);
  });
}
buildEppCards();

// ── LOAD / SAVE CONFIG ───────────────────────────
function loadConfig() {
  apiKey            = localStorage.getItem('epp_apikey') || '';
  confidenceThresh  = parseFloat(localStorage.getItem('epp_confidence') || '0.60');
  detectionInterval = parseInt(localStorage.getItem('epp_interval')   || '1500', 10);
  apiKeyInput.value = apiKey;
  confInput.value   = Math.round(confidenceThresh * 100);
  confValue.textContent = confInput.value + '%';
  intervalInput.value   = detectionInterval;
  confidenceDisplay.textContent = confInput.value + '%';
  intervalDisplay.textContent   = (detectionInterval / 1000).toFixed(1) + 's';
}

function saveConfig() {
  apiKey            = apiKeyInput.value.trim();
  confidenceThresh  = parseInt(confInput.value, 10) / 100;
  detectionInterval = parseInt(intervalInput.value, 10);
  localStorage.setItem('epp_apikey',     apiKey);
  localStorage.setItem('epp_confidence', confidenceThresh);
  localStorage.setItem('epp_interval',   detectionInterval);
  confidenceDisplay.textContent = Math.round(confidenceThresh * 100) + '%';
  intervalDisplay.textContent   = (detectionInterval / 1000).toFixed(1) + 's';
  if (detectionTimer) restartTimer();
  closeModal();
}

loadConfig();

// ── CAMERA ──────────────────────────────────────
async function startCamera() {
  if (!apiKey) { openModal(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }
    });
    video.srcObject = stream;
    await video.play();
    placeholder.style.display = 'none';
    stopBtn.style.display = 'flex';
    scanLine.classList.add('active');
    cameraActive = true;
    setStatus('active', 'Cámara activa');
    startDetectionLoop();
  } catch (err) {
    alert('No se pudo acceder a la cámara: ' + err.message);
  }
}

function stopCamera() {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  clearInterval(detectionTimer);
  detectionTimer = null;
  cameraActive = false;
  placeholder.style.display = 'flex';
  stopBtn.style.display = 'none';
  scanLine.classList.remove('active');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  noDetOverlay.classList.remove('visible');
  cameraWrapper.className = 'camera-wrapper';
  setStatus('', 'Cámara inactiva');
  resetStatus();
}

function restartTimer() {
  clearInterval(detectionTimer);
  detectionTimer = setInterval(runDetection, detectionInterval);
}

function startDetectionLoop() {
  runDetection();
  detectionTimer = setInterval(runDetection, detectionInterval);
}

// Resize overlay to match video display
function syncOverlay() {
  const rect = video.getBoundingClientRect();
  overlay.width  = rect.width  || video.offsetWidth;
  overlay.height = rect.height || video.offsetHeight;
}

// ── ROBOFLOW API CALL ────────────────────────────
async function runDetection() {
  if (!cameraActive || isDetecting || video.readyState < 2) return;
  isDetecting = true;
  setStatus('detecting', 'Detectando…');

  try {
    // Capture frame
    const cap = document.createElement('canvas');
    cap.width  = INPUT_W;
    cap.height = INPUT_H;
    cap.getContext('2d').drawImage(video, 0, 0, INPUT_W, INPUT_H);
    const base64 = cap.toDataURL('image/jpeg', 0.85).split(',')[1];

    const url = `https://detect.roboflow.com/${ROBOFLOW_PROJECT}/${ROBOFLOW_VERSION}?api_key=${apiKey}`;
    const res = await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body   : base64,
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    processResults(data);
  } catch (err) {
    console.error('Detection error:', err);
    setStatus('active', 'Error de detección');
  } finally {
    isDetecting = false;
    setStatus('active', 'Cámara activa');
  }
}

// ── PROCESS RESULTS ──────────────────────────────
function processResults(data) {
  const preds = (data.predictions || []).filter(
    p => p.confidence >= confidenceThresh && EPP_CLASSES[p.class] !== undefined
  );

  syncOverlay();
  drawBoxes(preds, data.image);

  // Which required EPPs are detected?
  const detectedIds  = new Set(preds.map(p => p.class));
  const missingIds   = REQUIRED_IDS.filter(id => !detectedIds.has(id));
  const detectedReq  = REQUIRED_IDS.filter(id => detectedIds.has(id));

  updateEppCards(preds, detectedIds);
  updateAccessIndicator(missingIds);
  updateProgress(detectedReq.length);

  // Bar info
  detectionsCount.textContent = `${preds.length}`;
  lastUpdate.textContent = new Date().toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

  // Camera border
  cameraWrapper.className = 'camera-wrapper';
  if (preds.length === 0 || missingIds.length === REQUIRED_IDS.length) {
    cameraWrapper.classList.add('no-epp');
    noDetOverlay.classList.add('visible');
  } else if (missingIds.length === 0) {
    cameraWrapper.classList.add('all-epp');
    noDetOverlay.classList.remove('visible');
  } else {
    cameraWrapper.classList.add('warn-epp');
    noDetOverlay.classList.remove('visible');
  }
}

// ── DRAW BOUNDING BOXES ──────────────────────────
function drawBoxes(preds, imageInfo) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const scaleX = overlay.width  / (imageInfo?.width  || INPUT_W);
  const scaleY = overlay.height / (imageInfo?.height || INPUT_H);

  preds.forEach(pred => {
    const epp    = EPP_CLASSES[pred.class];
    const color  = epp?.required ? BOX_COLORS.required : BOX_COLORS.optional;
    const label  = `${epp?.icon || ''} ${epp?.name || pred.class} ${Math.round(pred.confidence * 100)}%`;

    const x = (pred.x - pred.width  / 2) * scaleX;
    const y = (pred.y - pred.height / 2) * scaleY;
    const w = pred.width  * scaleX;
    const h = pred.height * scaleY;

    // Glow effect
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10;

    // Box border
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.strokeRect(x, y, w, h);

    // Corner accents
    const c = 12;
    ctx.lineWidth = 3;
    [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([cx,cy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + (cx===x ? c : -c), cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + (cy===y ? c : -c));
      ctx.stroke();
    });

    ctx.shadowBlur = 0;

    // Label background
    ctx.font = 'bold 12px Inter, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 26, tw + 10, 22);

    // Confidence bar inside label
    const barW = (pred.confidence * (tw + 10));
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y - 6, tw + 10, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x, y - 6, barW, 4);

    // Label text
    ctx.fillStyle = '#000';
    ctx.fillText(label, x + 5, y - 9);
  });
}

// ── UPDATE EPP CARDS ─────────────────────────────
function updateEppCards(preds, detectedIds) {
  const bestConf = {};
  preds.forEach(p => {
    if (!bestConf[p.class] || p.confidence > bestConf[p.class])
      bestConf[p.class] = p.confidence;
  });

  REQUIRED_IDS.forEach(id => {
    const card  = document.getElementById(`epp-card-${id}`);
    const badge = document.getElementById(`epp-badge-${id}`);
    const conf  = document.getElementById(`epp-conf-${id}`);
    if (!card) return;

    if (detectedIds.has(id)) {
      card.className  = 'epp-card detected';
      conf.textContent = `Confianza: ${Math.round(bestConf[id] * 100)}%`;
      badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>`;
    } else {
      card.className  = 'epp-card missing';
      conf.textContent = 'No detectado';
      badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>`;
    }
  });
}

// ── ACCESS INDICATOR ─────────────────────────────
function updateAccessIndicator(missingIds) {
  accessCard.className = 'access-card';
  missingAlert.style.display = 'none';

  if (missingIds.length === 0) {
    accessCard.classList.add('permitted');
    accessIcon.textContent   = '✅';
    accessLabel.textContent  = 'ACCESO PERMITIDO';
    accessSublabel.textContent = 'Todos los EPPs están correctamente puestos';

  } else if (missingIds.length === 1) {
    const epp = EPP_CLASSES[missingIds[0]];
    accessCard.classList.add('warning');
    accessIcon.textContent   = '⚠️';
    accessLabel.textContent  = `FALTA ${epp.name.toUpperCase()}`;
    accessSublabel.textContent = `Por favor colócate el/la ${epp.name.toLowerCase()} para continuar`;
    showMissingList(missingIds);

  } else {
    accessCard.classList.add('denied');
    accessIcon.textContent   = '🚫';
    accessLabel.textContent  = 'ACCESO DENEGADO';
    accessSublabel.textContent = `Faltan ${missingIds.length} EPPs requeridos`;
    showMissingList(missingIds);
  }
}

function showMissingList(missingIds) {
  missingAlert.style.display = 'block';
  missingList.innerHTML = missingIds.map(id => {
    const epp = EPP_CLASSES[id];
    return `<div class="missing-item">
      <span class="missing-item-icon">${epp.icon}</span>
      <span>${epp.name} de seguridad</span>
    </div>`;
  }).join('');
}

// ── PROGRESS ─────────────────────────────────────
function updateProgress(detected) {
  const total = REQUIRED_IDS.length;
  const pct   = Math.round((detected / total) * 100);
  progressBar.style.width     = pct + '%';
  progressLabel.textContent   = `${detected} de ${total} EPPs detectados`;
  eppCounter.textContent      = `${detected} / ${total}`;
}

// ── STATUS DOT ───────────────────────────────────
function setStatus(type, text) {
  statusDot.className = 'status-dot' + (type ? ` ${type}` : '');
  statusText.textContent = text;
}

function resetStatus() {
  REQUIRED_IDS.forEach(id => {
    const card  = document.getElementById(`epp-card-${id}`);
    const badge = document.getElementById(`epp-badge-${id}`);
    const conf  = document.getElementById(`epp-conf-${id}`);
    if (card)  card.className  = 'epp-card';
    if (conf)  conf.textContent = '—';
    if (badge) badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>`;
  });
  accessCard.className    = 'access-card';
  accessIcon.textContent  = '⏳';
  accessLabel.textContent = 'EN ESPERA';
  accessSublabel.textContent = 'Inicie la cámara para detectar EPPs';
  missingAlert.style.display = 'none';
  updateProgress(0);
  detectionsCount.textContent = '—';
  lastUpdate.textContent      = '—';
}

// ── MODAL ────────────────────────────────────────
function openModal()  { modalOverlay.classList.add('open'); }
function closeModal() { modalOverlay.classList.remove('open'); }

// ── EVENTS ──────────────────────────────────────
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
settingsBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);
saveConfigBtn.addEventListener('click', saveConfig);

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});

togglePassBtn.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

confInput.addEventListener('input', () => {
  confValue.textContent = confInput.value + '%';
});

// Resize overlay when window resizes
window.addEventListener('resize', () => {
  if (cameraActive) syncOverlay();
});

// ── INIT ─────────────────────────────────────────
// Abrir modal de configuración si no hay API Key guardada
if (!localStorage.getItem('epp_apikey')) {
  setTimeout(() => openModal(), 600);
}
