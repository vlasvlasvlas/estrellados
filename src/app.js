import { BRIGHT_STARS } from "./stars-catalog.js";
import { collectVisibleStars, getObservationDate, starToSoundProfile } from "./astro.js";
import { SoundEngine } from "./sound-engine.js";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const PERFORMANCE_MIN_ALTITUDE_DEG = -90;
const FRAME_STAR_LIMIT = 900;
const FRAME_STAR_MAG_LIMIT = 6.8;
const MAP_PICK_RADIUS_PX = 28;
const MAP_DRAG_THRESHOLD_PX = 8;
const MAP_CLICK_SUPPRESS_MS = 240;
const TRAIL_LIMIT = 12;
const AUTO_REFRESH_MS = 4000;

const DEFAULT_LOCATION = {
  latitude: -34.6037,
  longitude: -58.3816,
  label: "Buenos Aires"
};

const DEFAULT_BPM_BY_MODE = {
  now: 68,
  "24h": 92,
  seasonal: 52
};

const BRIGHT_STARS_BY_NAME = new Map(
  BRIGHT_STARS.map((star) => [normalizeStarName(star.name), star])
);

const BRIGHT_STARS_BY_POSITION = BRIGHT_STARS.map((star) => ({
  star,
  raRad: star.raHours * 15 * DEG_TO_RAD,
  decRad: star.decDeg * DEG_TO_RAD
}));

const ESTIMATED_SPECTRAL_BANDS = [
  { type: "B", bvMin: -0.22, bvMax: -0.05, distanceMin: 90, distanceMax: 1800 },
  { type: "A", bvMin: -0.02, bvMax: 0.18, distanceMin: 24, distanceMax: 720 },
  { type: "F", bvMin: 0.18, bvMax: 0.48, distanceMin: 16, distanceMax: 420 },
  { type: "G", bvMin: 0.54, bvMax: 0.82, distanceMin: 10, distanceMax: 240 },
  { type: "K", bvMin: 0.82, bvMax: 1.28, distanceMin: 14, distanceMax: 340 },
  { type: "M", bvMin: 1.35, bvMax: 1.85, distanceMin: 24, distanceMax: 980 }
];

const BV_COLOR_STOPS = [
  { bv: -0.30, color: "#8fb4ff" },
  { bv: -0.08, color: "#bbceff" },
  { bv: 0.12, color: "#eef4ff" },
  { bv: 0.38, color: "#fff7ea" },
  { bv: 0.72, color: "#ffe4ad" },
  { bv: 1.10, color: "#ffc57d" },
  { bv: 1.48, color: "#ffab79" },
  { bv: 1.90, color: "#ff928f" }
];

const MODE_CONFIG = {
  now: { min: 0, max: 0, step: 1, label: "Tiempo real" },
  "24h": { min: -12, max: 12, step: 0.5, label: "{value} h" },
  seasonal: { min: -182, max: 182, step: 1, label: "{value} dias" }
};

const FULLSCREEN_ICON_ENTER = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 3H3v5"></path>
    <path d="M16 3h5v5"></path>
    <path d="M21 16v5h-5"></path>
    <path d="M3 16v5h5"></path>
  </svg>
`;

const FULLSCREEN_ICON_EXIT = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 3H3v6"></path>
    <path d="M15 3h6v6"></path>
    <path d="M21 15v6h-6"></path>
    <path d="M3 15v6h6"></path>
    <path d="M9 9L3 3"></path>
    <path d="M15 9l6-6"></path>
    <path d="M15 15l6 6"></path>
    <path d="M9 15l-6 6"></path>
  </svg>
`;

const state = {
  latitude: DEFAULT_LOCATION.latitude,
  longitude: DEFAULT_LOCATION.longitude,
  locationLabel: DEFAULT_LOCATION.label,
  mode: "now",
  offset: 0,
  arpType: "sequential",
  bpm: DEFAULT_BPM_BY_MODE.now,
  starsMode: "manual",
  enabledStarIds: new Set(),
  forceSilent: true,
  visibleStars: [],
  activeStars: [],
  frameStars: [],
  performerStars: [],
  selectedStarId: null,
  lastArpStarId: null,
  currentJump: null,
  arpTrail: [],
  lastListSignature: "",
  inspectorOpen: false
};

const dom = {
  mapInfo: document.querySelector("#map-info"),
  mapPanel: document.querySelector(".map-panel"),
  mapStage: document.querySelector("#map-stage"),
  starHotspots: document.querySelector("#star-hotspots"),
  starsMeta: document.querySelector("#stars-meta"),
  starsList: document.querySelector("#stars-list"),
  btnGps: document.querySelector("#btn-gps"),
  btnSoundToggle: document.querySelector("#btn-sound-toggle"),
  btnSoundMenu: document.querySelector("#btn-sound-menu"),
  btnRecenter: document.querySelector("#btn-recenter"),
  btnFullscreen: document.querySelector("#btn-fullscreen"),
  modeSelect: document.querySelector("#time-mode"),
  arpTypeSelect: document.querySelector("#arp-type"),
  offsetSlider: null,
  offsetLabel: null,
  bpm: document.querySelector("#bpm"),
  bpmDisplay: document.querySelector("#bpm-display"),
  voiceCount: document.querySelector("#voice-count"),
  summaryTitle: document.querySelector("#summary-title"),
  transportMeta: document.querySelector("#transport-meta"),
  status: document.querySelector("#status"),
  soundMenu: document.querySelector("#sound-menu"),
  soundMenuBackdrop: document.querySelector("#sound-menu-backdrop"),
  btnSoundMenuClose: document.querySelector("#btn-sound-menu-close"),
  soundNoteLevel: document.querySelector("#sound-note-level"),
  soundDroneLevel: document.querySelector("#sound-drone-level"),
  soundDelayLevel: document.querySelector("#sound-delay-level"),
  soundReverbLevel: document.querySelector("#sound-reverb-level"),
  voiceStrip: document.querySelector("#voice-strip"),
  inspector: document.querySelector("#star-inspector"),
  inspectorName: document.querySelector("#inspector-name"),
  inspectorSubtitle: document.querySelector("#inspector-subtitle"),
  inspectorBody: document.querySelector("#star-inspector .inspector-body"),
  inspectorMetrics: document.querySelector("#inspector-metrics"),
  inspectorSonic: document.querySelector("#inspector-sonic"),
  inspectorInfoPanel: document.querySelector("#inspector-info-panel"),
  inspectorClose: document.querySelector("#inspector-close"),
  inspectorToggle: document.querySelector("#inspector-toggle"),
  inspectorPlay: document.querySelector("#inspector-play"),
  inspectorDrone: document.querySelector("#inspector-drone")
};

const soundEngine = new SoundEngine();
let skyInstance = null;
let interactionRefreshTimeout = null;
let arpPulseTimeout = null;
let lastPulseId = null;
let jumpFlashTimeout = null;
let mapPointerDown = null;
let suppressMapClickUntil = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fmtCoord(value) {
  return Number(value).toFixed(3);
}

function fmtStarValue(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function normalizeStarName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function shortName(value, max = 14) {
  if (!value) {
    return "Sin nombre";
  }
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function setStatus(message) {
  if (!dom.status) {
    return;
  }
  dom.status.textContent = `Estado: ${message}`;
}

function syncInspectorVisibility() {
  if (!dom.inspector) {
    return;
  }
  dom.inspector.hidden = !state.inspectorOpen;
}

function getDefaultBpmForMode(mode) {
  return DEFAULT_BPM_BY_MODE[mode] || DEFAULT_BPM_BY_MODE.now;
}

function syncSoundMenuButton() {
  if (!dom.btnSoundMenu) {
    return;
  }

  const ready = Boolean(soundEngine.audioContext);
  const open = Boolean(dom.soundMenu && !dom.soundMenu.hidden);
  dom.btnSoundMenu.classList.toggle("is-ready", ready);
  dom.btnSoundMenu.classList.toggle("is-open", open);
  dom.btnSoundMenu.setAttribute("aria-expanded", String(open));
  dom.btnSoundMenu.setAttribute(
    "aria-label",
    open
      ? "Cerrar mezcla de sonido"
      : (ready ? "Abrir mezcla de sonido" : "Activar sonido y abrir mezcla")
  );
  dom.btnSoundMenu.title = open
    ? "Cerrar mezcla de sonido"
    : (ready ? "Abrir mezcla de sonido" : "Activar sonido y abrir mezcla");
}

function syncSoundToggleButton() {
  if (!dom.btnSoundToggle) {
    return;
  }

  const muted = state.forceSilent;
  dom.btnSoundToggle.classList.toggle("is-muted", muted);
  dom.btnSoundToggle.setAttribute("aria-label", muted ? "Activar campo sonoro" : "Silenciar campo sonoro");
  dom.btnSoundToggle.title = muted ? "Activar campo sonoro" : "Silenciar campo sonoro";
}

function syncSoundMenuControls() {
  const mix = soundEngine.getMixState();

  if (dom.soundNoteLevel && document.activeElement !== dom.soundNoteLevel) {
    dom.soundNoteLevel.value = String(mix.noteLevel);
  }
  if (dom.soundDroneLevel && document.activeElement !== dom.soundDroneLevel) {
    dom.soundDroneLevel.value = String(mix.droneLevel);
  }
  if (dom.soundDelayLevel && document.activeElement !== dom.soundDelayLevel) {
    dom.soundDelayLevel.value = String(mix.delayLevel);
  }
  if (dom.soundReverbLevel && document.activeElement !== dom.soundReverbLevel) {
    dom.soundReverbLevel.value = String(mix.reverbLevel);
  }
}

function setSoundMenuOpen(open) {
  if (!dom.soundMenu) {
    return;
  }
  dom.soundMenu.hidden = !open;
  if (dom.soundMenuBackdrop) {
    dom.soundMenuBackdrop.hidden = !open;
  }
  document.body.classList.toggle("sound-menu-open", open);
  syncSoundMenuButton();
}

function isWithinSoundMenu(target) {
  return Boolean(target?.closest?.(".topbar-sound"));
}

async function ensureAudioReady() {
  const wasReady = Boolean(soundEngine.audioContext);
  await soundEngine.init();
  syncSoundMenuButton();
  syncSoundMenuControls();
  return !wasReady;
}

function getSpectralBase(spectral) {
  return (spectral || "G").trim().toUpperCase()[0] || "G";
}

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) {
    return { red: 167, green: 240, blue: 207 };
  }

  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(red, green, blue) {
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function mixHexColors(source, target, amount = 0.5) {
  const ratio = clamp(amount, 0, 1);
  const a = hexToRgb(source);
  const b = hexToRgb(target);

  return rgbToHex(
    a.red + (b.red - a.red) * ratio,
    a.green + (b.green - a.green) * ratio,
    a.blue + (b.blue - a.blue) * ratio
  );
}

function colorFromBvIndex(bv) {
  const value = clamp(Number(bv), BV_COLOR_STOPS[0].bv, BV_COLOR_STOPS[BV_COLOR_STOPS.length - 1].bv);

  for (let index = 0; index < BV_COLOR_STOPS.length - 1; index += 1) {
    const current = BV_COLOR_STOPS[index];
    const next = BV_COLOR_STOPS[index + 1];
    if (value >= current.bv && value <= next.bv) {
      const span = next.bv - current.bv || 1;
      const ratio = (value - current.bv) / span;
      return mixHexColors(current.color, next.color, ratio);
    }
  }

  return BV_COLOR_STOPS[BV_COLOR_STOPS.length - 1].color;
}

function getSpectralAccent(starOrSpectral, maybeBv = null) {
  const spectral = typeof starOrSpectral === "object" && starOrSpectral
    ? starOrSpectral.spectral
    : starOrSpectral;
  const bv = typeof starOrSpectral === "object" && starOrSpectral
    ? starOrSpectral.bv
    : maybeBv;

  if (Number.isFinite(bv)) {
    return colorFromBvIndex(bv);
  }

  const base = getSpectralBase(spectral);
  if (base === "O" || base === "B") {
    return "#9ec2ff";
  }
  if (base === "A") {
    return "#dae6ff";
  }
  if (base === "F") {
    return "#fff8ef";
  }
  if (base === "K") {
    return "#ffc78a";
  }
  if (base === "M") {
    return "#ff9a88";
  }
  return "#ffe6b8";
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashToUnitInterval(seed) {
  return (seed % 10000) / 10000;
}

function pickEstimatedSpectralBand(seedValue, mag) {
  const weights = mag <= 1.5
    ? [0.18, 0.24, 0.2, 0.16, 0.13, 0.09]
    : mag <= 3.5
      ? [0.11, 0.19, 0.2, 0.22, 0.17, 0.11]
      : [0.06, 0.14, 0.18, 0.25, 0.21, 0.16];

  let cursor = 0;
  for (let index = 0; index < ESTIMATED_SPECTRAL_BANDS.length; index += 1) {
    cursor += weights[index];
    if (seedValue <= cursor || index === ESTIMATED_SPECTRAL_BANDS.length - 1) {
      return ESTIMATED_SPECTRAL_BANDS[index];
    }
  }

  return ESTIMATED_SPECTRAL_BANDS[3];
}

function estimateFrameStarCatalogData(rawStar, resolvedName, mag) {
  const seed = hashString(`${rawStar.label}|${rawStar.ra.toFixed(6)}|${rawStar.dec.toFixed(6)}|${mag.toFixed(2)}`);
  const primary = hashToUnitInterval(seed);
  const secondary = hashToUnitInterval(seed >>> 8);
  const band = pickEstimatedSpectralBand(primary, mag);
  const bv = band.bvMin + (band.bvMax - band.bvMin) * secondary;
  const brightnessBias = clamp((FRAME_STAR_MAG_LIMIT - mag) / FRAME_STAR_MAG_LIMIT, 0, 1);
  const distanceSpread = band.distanceMin + (band.distanceMax - band.distanceMin) * (0.18 + (1 - brightnessBias) * 0.82);
  const distanceLy = distanceSpread * (0.72 + hashToUnitInterval(seed >>> 16) * 0.56);

  return {
    name: resolvedName,
    constellation: "Campo actual",
    distanceLy,
    spectral: band.type,
    bv,
    estimatedCatalogData: true
  };
}

function angularDistanceRad(raA, decA, raB, decB) {
  const deltaRa = (raA - raB) * Math.cos((decA + decB) * 0.5);
  const deltaDec = decA - decB;
  return Math.hypot(deltaRa, deltaDec);
}

function findBrightCatalogStarMatch(rawStar, translatedName, fallbackName) {
  const namedMatch = BRIGHT_STARS_BY_NAME.get(normalizeStarName(translatedName))
    || BRIGHT_STARS_BY_NAME.get(normalizeStarName(fallbackName));

  if (namedMatch) {
    return namedMatch;
  }

  let bestMatch = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of BRIGHT_STARS_BY_POSITION) {
    const distance = angularDistanceRad(rawStar.ra, rawStar.dec, entry.raRad, entry.decRad);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = entry.star;
    }
  }

  return bestDistance <= 0.012 ? bestMatch : null;
}

function resolveFrameStarCatalogData(rawStar, translatedName, fallbackName, mag, defaultName) {
  const catalogStar = findBrightCatalogStarMatch(rawStar, translatedName, fallbackName);
  if (catalogStar) {
    return {
      name: catalogStar.name,
      constellation: catalogStar.constellation,
      distanceLy: catalogStar.distanceLy,
      spectral: catalogStar.spectral,
      bv: catalogStar.bv,
      estimatedCatalogData: false
    };
  }

  return estimateFrameStarCatalogData(rawStar, defaultName, mag);
}

function getSpectralText(spectral) {
  const base = getSpectralBase(spectral);
  if (base === "O" || base === "B") {
    return "timbre incisivo";
  }
  if (base === "A" || base === "F") {
    return "timbre cristalino";
  }
  if (base === "K" || base === "M") {
    return "timbre terroso";
  }
  return "timbre redondo";
}

function getSpectralLabel(spectral) {
  const base = getSpectralBase(spectral);
  const labels = {
    O: "azulada muy caliente",
    B: "azul-blanca",
    A: "blanca",
    F: "blanco-amarilla",
    G: "amarilla",
    K: "naranja",
    M: "rojiza"
  };

  return labels[base] || "indefinida";
}

function getPanText(pan) {
  if (pan < -0.35) {
    return "izquierda";
  }
  if (pan > 0.35) {
    return "derecha";
  }
  return "centro";
}

function estimateAbsoluteMagnitude(star) {
  const distanceLy = Number(star?.distanceLy);
  if (!Number.isFinite(distanceLy) || distanceLy <= 0) {
    return null;
  }

  const distancePc = Math.max(distanceLy / 3.26156, 0.01);
  return star.mag - 5 * (Math.log10(distancePc) - 1);
}

function getIntrinsicLightFactor(star) {
  const absoluteMagnitude = estimateAbsoluteMagnitude(star);
  if (!Number.isFinite(absoluteMagnitude)) {
    return 0.45;
  }

  const luminosityRelativeToSun = Math.pow(10, (4.83 - absoluteMagnitude) / 2.5);
  return clamp(Math.log10(luminosityRelativeToSun + 1) / 4.6, 0, 1);
}

function hexToRgba(hex, alpha = 1) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) {
    return `rgba(167, 240, 207, ${alpha})`;
  }

  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getCurrentObservationDate() {
  return getObservationDate(state.mode, state.offset, new Date());
}

function getAvailableStars() {
  if (state.performerStars.length) {
    return state.performerStars;
  }
  if (state.frameStars.length) {
    return state.frameStars;
  }
  if (state.activeStars.length) {
    return state.activeStars;
  }
  return state.visibleStars;
}

function sortStarsForPerformance(stars) {
  return stars.slice().sort((a, b) => {
    const azimuthDiff = a.azimuthDeg - b.azimuthDeg;
    if (Math.abs(azimuthDiff) >= 10) {
      return azimuthDiff;
    }

    const altitudeDiff = b.altitudeDeg - a.altitudeDeg;
    if (Math.abs(altitudeDiff) >= 8) {
      return altitudeDiff;
    }

    return a.mag - b.mag;
  });
}

function buildPerformerStars() {
  const projectedStars = state.frameStars.length
    ? state.frameStars
    : (state.activeStars.length ? state.activeStars : state.visibleStars);
  const preferredStars = projectedStars.filter((star) => star.altitudeDeg >= PERFORMANCE_MIN_ALTITUDE_DEG);
  return sortStarsForPerformance(preferredStars.length ? preferredStars : projectedStars);
}

function setStarsModeAll() {
  state.starsMode = "all";
  state.forceSilent = false;
  state.enabledStarIds.clear();
}

function seedManualModeWithVisibleField() {
  if (state.starsMode === "manual") {
    return;
  }
  state.starsMode = "manual";
  state.enabledStarIds = new Set(getAvailableStars().map((star) => star.id));
}

function isStarEnabled(starId) {
  if (state.starsMode === "all") {
    return getAvailableStars().some((star) => star.id === starId);
  }
  return state.enabledStarIds.has(starId);
}

function toggleStarEnabled(starId) {
  seedManualModeWithVisibleField();

  if (state.enabledStarIds.has(starId)) {
    state.enabledStarIds.delete(starId);
    return false;
  }

  state.enabledStarIds.add(starId);
  state.forceSilent = false;
  return true;
}

function disableAllStars() {
  state.starsMode = "manual";
  state.enabledStarIds.clear();
  state.forceSilent = true;
  state.lastArpStarId = null;
  state.arpTrail = [];
  soundEngine.stopAllDrones();
  soundEngine.updateArpPool([]);
  renderVoiceStrip();
  renderMapOverlay();
  renderInspector();
  syncStarsListVisualState();
  updateMapInfo();
  updateSummary();
  syncSoundToggleButton();
  setStatus("Campo sonoro apagado.");
}

function enableAllStars() {
  setStarsModeAll();
  refreshSkyState({ forceList: true });
  syncSoundToggleButton();
  setStatus("Todo el campo visible vuelve al flujo.");
}

function computeSoundPoolFromEnabled() {
  const availableStars = getAvailableStars();
  if (!availableStars.length) {
    return [];
  }

  if (state.starsMode === "all") {
    return availableStars.slice();
  }

  const manualPool = availableStars.filter((star) => state.enabledStarIds.has(star.id));
  if (manualPool.length) {
    return manualPool;
  }

  if (state.forceSilent) {
    return [];
  }

  return availableStars.slice();
}

function pruneFieldState() {
  const visibleIds = new Set(getAvailableStars().map((star) => star.id));

  if (state.starsMode === "manual") {
    state.enabledStarIds = new Set(
      Array.from(state.enabledStarIds).filter((starId) => visibleIds.has(starId))
    );
  }

  for (const starId of Array.from(soundEngine.activeDrones.keys())) {
    if (!visibleIds.has(starId)) {
      soundEngine.stopDroneById(starId, 0.55);
    }
  }

  state.arpTrail = state.arpTrail.filter((starId) => visibleIds.has(starId));

  if (state.currentJump) {
    const jumpVisible = visibleIds.has(state.currentJump.fromId) && visibleIds.has(state.currentJump.toId);
    if (!jumpVisible) {
      state.currentJump = null;
    }
  }

  if (state.lastArpStarId && !visibleIds.has(state.lastArpStarId)) {
    state.lastArpStarId = null;
  }

  if (state.selectedStarId && !visibleIds.has(state.selectedStarId)) {
    state.selectedStarId = getAvailableStars()[0]?.id || null;
  }
}

function pulseStar(starId, options = {}) {
  const fromArp = Boolean(options.fromArp);

  if (fromArp) {
    const previousStarId = state.lastArpStarId;
    if (previousStarId && previousStarId !== starId) {
      state.currentJump = {
        fromId: previousStarId,
        toId: starId
      };
    }
  }

  state.lastArpStarId = starId;
  lastPulseId = starId;

  if (fromArp) {
    state.arpTrail.unshift(starId);
    state.arpTrail = state.arpTrail.slice(0, TRAIL_LIMIT);
    renderVoiceStrip();
  }

  renderMapOverlay();
  syncStarsListVisualState();
  renderInspector();

  if (arpPulseTimeout) {
    clearTimeout(arpPulseTimeout);
  }

  arpPulseTimeout = window.setTimeout(() => {
    lastPulseId = null;
    renderMapOverlay();
    syncStarsListVisualState();
  }, 240);

  if (fromArp) {
    if (jumpFlashTimeout) {
      clearTimeout(jumpFlashTimeout);
    }
    jumpFlashTimeout = window.setTimeout(() => {
      state.currentJump = null;
      renderMapOverlay();
    }, 520);
  }
}

function updateOffsetUi() {
  if (!dom.offsetSlider || !dom.offsetLabel) {
    state.offset = 0;
    return;
  }

  const modeCfg = MODE_CONFIG[state.mode];
  dom.offsetSlider.min = String(modeCfg.min);
  dom.offsetSlider.max = String(modeCfg.max);
  dom.offsetSlider.step = String(modeCfg.step);

  if (state.mode === "now") {
    state.offset = 0;
    dom.offsetSlider.value = "0";
    dom.offsetSlider.disabled = true;
    dom.offsetLabel.textContent = modeCfg.label;
    return;
  }

  dom.offsetSlider.disabled = false;
  const current = Number(dom.offsetSlider.value);
  if (Number.isNaN(current) || current < modeCfg.min || current > modeCfg.max) {
    dom.offsetSlider.value = "0";
    state.offset = 0;
  } else {
    state.offset = current;
  }

  dom.offsetLabel.textContent = modeCfg.label.replace("{value}", String(state.offset));
}

function syncBpmUi() {
  if (dom.bpm) {
    dom.bpm.value = String(state.bpm);
  }
  dom.bpmDisplay.textContent = String(state.bpm);
}

function syncSkyViewport() {
  if (!skyInstance) {
    return;
  }

  if (typeof skyInstance.resize === "function") {
    skyInstance.resize();
  }

  if (typeof skyInstance.draw === "function") {
    skyInstance.draw();
  }
}

function scheduleSkyViewportSync(forceList = false) {
  requestAnimationFrame(() => {
    syncSkyViewport();
    refreshSkyState({ forceList });
  });

  window.setTimeout(() => {
    syncSkyViewport();
    refreshSkyState({ forceList });
  }, 140);
}

function pickCenterStar() {
  const observationDate = getCurrentObservationDate();
  const stars = collectVisibleStars(
    BRIGHT_STARS,
    observationDate,
    state.latitude,
    state.longitude,
    0
  );

  if (!stars.length) {
    return null;
  }

  const preferred = stars.find((star) => star.altitudeDeg >= 20 && star.altitudeDeg <= 78);
  return preferred || stars[0];
}

function recenterSkyToVisibleStar() {
  if (!skyInstance || typeof skyInstance.setRADec !== "function") {
    return false;
  }

  const centerStar = pickCenterStar();
  if (!centerStar) {
    return false;
  }

  skyInstance.setRADec(centerStar.raHours * 15, centerStar.decDeg);
  if (typeof skyInstance.draw === "function") {
    skyInstance.draw();
  }
  setStatus(`Encuadre recentrado en ${centerStar.name}.`);
  return true;
}

function getProjectedStar(star) {
  if (!skyInstance || typeof skyInstance.radec2xy !== "function") {
    return null;
  }

  const point = skyInstance.radec2xy(star.raHours * 15 * DEG_TO_RAD, star.decDeg * DEG_TO_RAD);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  const width = dom.mapStage.clientWidth;
  const height = dom.mapStage.clientHeight;
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
    return null;
  }

  return {
    ...star,
    mapX: point.x,
    mapY: point.y
  };
}

function getVirtualSkyStarIdentity(rawLabel) {
  return `vs-${String(rawLabel)}`;
}

function normalizeVirtualSkyCatalogStar(rawStar) {
  if (Array.isArray(rawStar)) {
    const [label, mag, ra, dec] = rawStar;
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
      return null;
    }

    return {
      label,
      mag: Number(mag),
      ra,
      dec
    };
  }

  if (
    !rawStar ||
    !Number.isFinite(rawStar.ra) ||
    !Number.isFinite(rawStar.dec)
  ) {
    return null;
  }

  return {
    label: rawStar.label,
    mag: Number(rawStar.mag),
    ra: rawStar.ra,
    dec: rawStar.dec
  };
}

function buildVirtualSkyMapStar(rawStar, fallbackName) {
  if (
    !skyInstance ||
    typeof skyInstance.coord2horizon !== "function" ||
    typeof skyInstance.radec2xy !== "function"
  ) {
    return null;
  }

  const horizontal = skyInstance.coord2horizon(rawStar.ra, rawStar.dec);
  if (!horizontal || !Number.isFinite(horizontal[0]) || !Number.isFinite(horizontal[1])) {
    return null;
  }

  const altitudeDeg = horizontal[0] * RAD_TO_DEG;

  const point = skyInstance.radec2xy(rawStar.ra, rawStar.dec);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  const width = dom.mapStage.clientWidth;
  const height = dom.mapStage.clientHeight;
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
    return null;
  }

  const fallbackId = `${rawStar.ra.toFixed(6)}:${rawStar.dec.toFixed(6)}`;
  const hipId = rawStar.label == null ? fallbackId : String(rawStar.label);
  const translatedName = skyInstance.starnames?.[hipId] || skyInstance.lang?.starnames?.[hipId];
  const mag = Number.isFinite(rawStar.mag) ? rawStar.mag : 4;
  const resolvedName = fallbackName || translatedName || `HIP ${hipId}`;
  const catalogData = resolveFrameStarCatalogData(rawStar, translatedName, fallbackName, mag, resolvedName);

  return {
    id: getVirtualSkyStarIdentity(hipId),
    name: catalogData.name || resolvedName,
    constellation: catalogData.constellation || "Campo actual",
    mag,
    distanceLy: catalogData.distanceLy,
    spectral: catalogData.spectral,
    bv: catalogData.bv,
    estimatedCatalogData: Boolean(catalogData.estimatedCatalogData),
    altitudeDeg,
    azimuthDeg: horizontal[1] * RAD_TO_DEG,
    mapX: point.x,
    mapY: point.y
  };
}

function buildFrameStars() {
  if (
    !skyInstance ||
    typeof skyInstance.radec2xy !== "function" ||
    typeof skyInstance.coord2horizon !== "function" ||
    (
      !Array.isArray(skyInstance.stars) ||
      !skyInstance.stars.length
    ) &&
    (
      !skyInstance.lookup ||
      !Array.isArray(skyInstance.lookup.star)
    )
  ) {
    return [];
  }

  const sourceStars = Array.isArray(skyInstance.stars) && skyInstance.stars.length
    ? skyInstance.stars
    : skyInstance.lookup.star;
  const frameStars = [];
  const seenIds = new Set();

  for (const sourceStar of sourceStars) {
    const rawStar = normalizeVirtualSkyCatalogStar(sourceStar);
    if (!rawStar) {
      continue;
    }

    const mag = Number(rawStar.mag);
    if (!Number.isFinite(mag) || mag > FRAME_STAR_MAG_LIMIT) {
      continue;
    }

    const frameStar = buildVirtualSkyMapStar(rawStar);
    if (!frameStar) {
      continue;
    }

    if (seenIds.has(frameStar.id)) {
      continue;
    }

    seenIds.add(frameStar.id);
    frameStars.push(frameStar);
  }

  frameStars.sort((a, b) => a.mag - b.mag);
  return frameStars.slice(0, FRAME_STAR_LIMIT);
}

function findNearestInteractiveStar(x, y) {
  const stars = getAvailableStars().filter(
    (star) => Number.isFinite(star.mapX) && Number.isFinite(star.mapY)
  );
  if (!stars.length) {
    return null;
  }

  let nearestStar = null;
  let nearestDistance = MAP_PICK_RADIUS_PX;

  for (const star of stars) {
    const distance = Math.hypot(star.mapX - x, star.mapY - y);
    if (distance < nearestDistance) {
      nearestStar = star;
      nearestDistance = distance;
    }
  }

  return nearestStar;
}

function shouldIgnoreMapClick() {
  return Date.now() < suppressMapClickUntil;
}

function getMapPoint(event) {
  const source = event.touches?.[0] || event.changedTouches?.[0] || event;
  const rect = dom.mapStage.getBoundingClientRect();
  return {
    x: source.clientX - rect.left,
    y: source.clientY - rect.top
  };
}

function getStarById(starId) {
  return state.performerStars.find((star) => star.id === starId) ||
    state.frameStars.find((star) => star.id === starId) ||
    state.activeStars.find((star) => star.id === starId) ||
    state.visibleStars.find((star) => star.id === starId);
}

function getSelectedStar() {
  if (!state.selectedStarId) {
    return null;
  }
  return getStarById(state.selectedStarId);
}

function focusStarCard(starId) {
  const card = dom.starsList.querySelector(`.star-card[data-star-id="${starId}"]`);
  if (!card) {
    return;
  }

  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setSelectedStar(star, options = {}) {
  if (!star) {
    return;
  }

  const shouldScroll = Boolean(options.scroll);
  state.selectedStarId = star.id;

  if (shouldScroll) {
    focusStarCard(star.id);
  }

  renderInspector();
  renderMapOverlay();
  syncStarsListVisualState();
}

function openInspectorForStar(star, options = {}) {
  if (!star) {
    return;
  }

  state.inspectorOpen = true;
  setSelectedStar(star, options);
  if (dom.inspectorBody) {
    dom.inspectorBody.scrollTop = 0;
  }
  syncInspectorVisibility();
}

function closeInspector() {
  state.inspectorOpen = false;
  syncInspectorVisibility();
}

function syncSelectedStar() {
  const selected = getSelectedStar();
  if (selected) {
    return selected;
  }

  const fallback = getAvailableStars()[0] || state.visibleStars[0] || null;
  if (fallback) {
    state.selectedStarId = fallback.id;
  }
  return fallback;
}

function getMapOverlayContext() {
  const canvas = dom.starHotspots;
  const context = canvas?.getContext?.("2d");
  if (!canvas || !context) {
    return null;
  }

  const width = Math.max(1, Math.round(dom.mapStage.clientWidth));
  const height = Math.max(1, Math.round(dom.mapStage.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { context };
}

function drawTrailLayer(context) {
  const points = state.arpTrail
    .map((starId) => getStarById(starId))
    .filter((star) => star && Number.isFinite(star.mapX) && Number.isFinite(star.mapY));

  if (state.currentJump) {
    const fromStar = getStarById(state.currentJump.fromId);
    const toStar = getStarById(state.currentJump.toId);
    if (fromStar && toStar && Number.isFinite(fromStar.mapX) && Number.isFinite(toStar.mapX)) {
      context.save();
      context.beginPath();
      context.lineCap = "round";
      context.lineWidth = 5.2;
      context.strokeStyle = "rgba(255, 233, 188, 0.94)";
      context.shadowBlur = 16;
      context.shadowColor = "rgba(255, 210, 130, 0.8)";
      context.moveTo(fromStar.mapX, fromStar.mapY);
      context.lineTo(toStar.mapX, toStar.mapY);
      context.stroke();
      context.restore();
    }
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const alpha = clamp(0.66 - index * 0.05, 0.1, 0.66);
    const strokeWidth = clamp(4.4 - index * 0.2, 1.3, 4.4);

    context.beginPath();
    context.lineCap = "round";
    context.lineWidth = strokeWidth;
    context.strokeStyle = `rgba(255, 166, 188, ${alpha.toFixed(2)})`;
    context.moveTo(current.mapX, current.mapY);
    context.lineTo(next.mapX, next.mapY);
    context.stroke();
  }

  for (const [index, point] of points.entries()) {
    const radius = clamp(7.2 - index * 0.24, 2.4, 7.2);
    const alpha = clamp(0.94 - index * 0.05, 0.12, 0.94);
    context.save();
    context.beginPath();
    context.fillStyle = `rgba(255, 235, 242, ${alpha.toFixed(2)})`;
    context.shadowBlur = 16;
    context.shadowColor = "rgba(255, 123, 174, 0.66)";
    context.arc(point.mapX, point.mapY, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function renderVoiceStrip() {
  const trailStars = state.arpTrail
    .map((starId) => getStarById(starId))
    .filter(Boolean);

  if (!trailStars.length) {
    dom.voiceStrip.innerHTML = `
      <article class="voice-chip">
        <strong>Esperando pulso</strong>
        <span>${getAvailableStars().length} en set</span>
        <small>${state.bpm} bpm · listo</small>
      </article>
    `;
    return;
  }

  dom.voiceStrip.innerHTML = trailStars.slice(0, TRAIL_LIMIT).map((star, index) => {
    const accent = getSpectralAccent(star);
    const isCurrent = star.id === state.lastArpStarId;
    const isSelected = star.id === state.selectedStarId;
    const isDroneActive = soundEngine.activeDrones.has(star.id);

    return `
      <button class="voice-chip${isCurrent ? " is-current" : ""}${isSelected ? " is-selected" : ""}" style="--voice-accent:${accent}" data-action="inspect-voice" data-star-id="${star.id}" type="button">
        <strong>${shortName(star.name, 15)}</strong>
        <span>${index + 1} · ${fmtStarValue(star.altitudeDeg, 0)}°</span>
        <small>${isDroneActive ? "drone" : "step"} · ${fmtStarValue(star.mag)}</small>
      </button>
    `;
  }).join("");
}

function drawStarLayer(context) {
  const fieldStars = getAvailableStars().filter(
    (star) => Number.isFinite(star.mapX) && Number.isFinite(star.mapY)
  );
  if (!fieldStars.length) {
    return;
  }

  for (const star of fieldStars) {
    const size = clamp(10.6 - star.mag * 0.92, 4.8, 11.6);
    const apparentAlpha = clamp(1.05 - star.mag / 6.8, 0.24, 1);
    const intrinsicFactor = getIntrinsicLightFactor(star);
    const radius = size * 0.48;
    const isDroneActive = soundEngine.activeDrones.has(star.id);
    const enabled = isStarEnabled(star.id);
    const isSelected = star.id === state.selectedStarId;
    const isCurrent = star.id === state.lastArpStarId;
    const isPulse = star.id === lastPulseId;
    const accent = getSpectralAccent(star);
    const glowTint = mixHexColors(accent, "#d7fff3", 0.18);
    const coreTint = mixHexColors(accent, "#ffffff", 0.62);
    const baseAlpha = enabled
      ? clamp(apparentAlpha * 0.72 + intrinsicFactor * 0.34, 0.24, 1)
      : clamp(apparentAlpha * 0.18 + intrinsicFactor * 0.08, 0.08, 0.28);
    const glowRadius = radius * (isPulse ? 4.4 : isSelected ? 3.8 : isCurrent ? 3.2 : isDroneActive ? 3.6 : 2.4);
    const glowAlpha = isPulse
      ? 0.92
      : isSelected
        ? 0.64
        : isCurrent
          ? 0.52
          : isDroneActive
            ? 0.7
            : clamp(baseAlpha * 0.34 + intrinsicFactor * 0.18, 0.14, 0.74);

    context.beginPath();
    context.fillStyle = isDroneActive
      ? `rgba(255, 205, 138, ${Math.max(glowAlpha, 0.44)})`
      : hexToRgba(glowTint, glowAlpha);
    context.arc(star.mapX, star.mapY, glowRadius, 0, Math.PI * 2);
    context.fill();

    if (isSelected || isCurrent) {
      context.beginPath();
      context.lineWidth = isSelected ? 1.8 : 1.2;
      context.strokeStyle = isSelected
        ? "rgba(255, 255, 255, 0.92)"
        : "rgba(255, 236, 186, 0.78)";
      context.arc(star.mapX, star.mapY, radius + (isSelected ? 5.2 : 3.2), 0, Math.PI * 2);
      context.stroke();
    }

    context.beginPath();
    context.fillStyle = isDroneActive
      ? `rgba(255, 242, 225, ${Math.max(baseAlpha, 0.88)})`
      : hexToRgba(coreTint, Math.min(1, baseAlpha + 0.12));
    context.arc(star.mapX, star.mapY, radius, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.fillStyle = isDroneActive
      ? "rgba(255, 178, 94, 0.96)"
      : hexToRgba(accent, enabled ? 0.9 : 0.32);
    context.arc(star.mapX, star.mapY, Math.max(1.4, radius * 0.54), 0, Math.PI * 2);
    context.fill();
  }
}

function renderMapOverlay() {
  const overlay = getMapOverlayContext();
  if (!overlay) {
    return;
  }

  drawTrailLayer(overlay.context);
  drawStarLayer(overlay.context);
}

function buildListSignature() {
  const signature = getAvailableStars()
    .map((star) => star.id)
    .join(",");
  return `${signature}|${state.mode}|${state.offset}|${fmtCoord(state.latitude)}|${fmtCoord(state.longitude)}`;
}

function renderStarsList(force = false) {
  const fieldStars = getAvailableStars();
  if (!fieldStars.length) {
    dom.starsList.innerHTML = "<p class=\"empty\">No hay estrellas disponibles en el cuadro actual.</p>";
    state.lastListSignature = "";
    return;
  }

  const signature = buildListSignature();
  if (!force && signature === state.lastListSignature) {
    syncStarsListVisualState();
    return;
  }

  state.lastListSignature = signature;

  dom.starsList.innerHTML = fieldStars.map((star) => `
    <article class="star-card" data-star-id="${star.id}">
      <button class="star-card-button" data-action="select" data-star-id="${star.id}">
        <div class="star-card-head">
          <h3>${star.name}</h3>
          <span class="star-card-state" data-role="state"></span>
        </div>
        <div class="star-data">
          <span>${star.constellation}</span>
          <span>Altitud ${fmtStarValue(star.altitudeDeg)}°</span>
          <span>Magnitud ${fmtStarValue(star.mag)}</span>
        </div>
      </button>
    </article>
  `).join("");

  syncStarsListVisualState();
}

function syncStarsListVisualState() {
  for (const card of dom.starsList.querySelectorAll(".star-card")) {
    const starId = card.dataset.starId;
    const isSelected = starId === state.selectedStarId;
    const isCurrent = starId === state.lastArpStarId;
    const enabled = isStarEnabled(starId);
    const isDroneActive = soundEngine.activeDrones.has(starId);
    const stateNode = card.querySelector("[data-role='state']");

    card.classList.toggle("is-selected", isSelected);
    card.classList.toggle("is-current", isCurrent);
    card.classList.toggle("is-disabled", !enabled);

    if (stateNode) {
      if (isDroneActive) {
        stateNode.textContent = "drone";
      } else if (isCurrent) {
        stateNode.textContent = "arpegio";
      } else if (enabled) {
        stateNode.textContent = "visible";
      } else {
        stateNode.textContent = "afuera";
      }
    }
  }
}

function renderInspector() {
  const star = syncSelectedStar();
  if (!star) {
    dom.inspectorName.textContent = "Toca una estrella";
    dom.inspectorSubtitle.textContent = "Sin seleccion.";
    dom.inspectorMetrics.innerHTML = "";
    dom.inspectorSonic.innerHTML = "<p>Sin datos.</p>";
    if (dom.inspectorInfoPanel) {
      dom.inspectorInfoPanel.innerHTML = "<p class=\"inspector-info-empty\">Selecciona una estrella para ver su ficha.</p>";
    }
    dom.inspectorToggle.disabled = true;
    dom.inspectorPlay.disabled = true;
    dom.inspectorDrone.disabled = true;
    return;
  }

  const profile = starToSoundProfile(star);
  const soundDescription = soundEngine.describeStar(star);
  const enabled = isStarEnabled(star.id);
  const isDroneActive = soundEngine.activeDrones.has(star.id);
  const usesEstimatedCatalogData = Boolean(star.estimatedCatalogData);

  dom.inspector.style.setProperty("--inspector-accent", getSpectralAccent(star));
  dom.inspectorName.textContent = star.name;
  dom.inspectorSubtitle.textContent = `${star.constellation} · ${enabled ? "en flujo" : "fuera"}`;
  dom.inspectorMetrics.innerHTML = `
    <span class="metric-pill">Altitud ${fmtStarValue(star.altitudeDeg)}°</span>
    <span class="metric-pill">Azimut ${fmtStarValue(star.azimuthDeg)}°</span>
    <span class="metric-pill">Magnitud ${fmtStarValue(star.mag)}</span>
    <span class="metric-pill">Espectral ${star.spectral}</span>
    <span class="metric-pill">Distancia ${fmtStarValue(star.distanceLy, 1)} ly</span>
  `;
  dom.inspectorSonic.innerHTML = `
    <span class="metric-pill">${getSpectralText(star.spectral)}</span>
    <span class="metric-pill">Paneo ${getPanText(profile.pan)}</span>
    <span class="metric-pill">Frecuencia ${Math.round(soundDescription.frequencyHz)} hz</span>
    <span class="metric-pill">Brillo ${Math.round(soundDescription.brightness * 100)}%</span>
  `;
  if (dom.inspectorInfoPanel) {
    dom.inspectorInfoPanel.innerHTML = `
      <section class="inspector-info-section">
        <div class="inspector-info-title">Datos de la estrella</div>
        <div class="inspector-info-grid">
          <div class="inspector-info-row"><span>Altitud</span><strong>${fmtStarValue(star.altitudeDeg)}° sobre el horizonte</strong></div>
          <div class="inspector-info-row"><span>Azimut</span><strong>${fmtStarValue(star.azimuthDeg)}° · ${getPanText(profile.pan)}</strong></div>
          <div class="inspector-info-row"><span>Magnitud aparente</span><strong>${fmtStarValue(star.mag)} · regula brillo</strong></div>
          <div class="inspector-info-row"><span>Tipo espectral</span><strong>${star.spectral} · ${getSpectralLabel(star.spectral)}</strong></div>
          <div class="inspector-info-row"><span>Color visible</span><strong>sale de temperatura estelar / indice B-V</strong></div>
          <div class="inspector-info-row"><span>Distancia</span><strong>${fmtStarValue(star.distanceLy, 1)} años luz</strong></div>
          <div class="inspector-info-row"><span>Halo visual</span><strong>mezcla brillo aparente e intensidad intrinseca</strong></div>
        </div>
      </section>
      <section class="inspector-info-section">
        <div class="inspector-info-title">Como se vuelve sonido</div>
        <div class="inspector-info-grid">
          <div class="inspector-info-row"><span>Altitud</span><strong>mueve la base tonal a ${Math.round(soundDescription.frequencyHz)} hz</strong></div>
          <div class="inspector-info-row"><span>Azimut</span><strong>paneo ${getPanText(profile.pan)}</strong></div>
          <div class="inspector-info-row"><span>Magnitud</span><strong>brillo ${Math.round(soundDescription.brightness * 100)}%</strong></div>
          <div class="inspector-info-row"><span>Tipo espectral</span><strong>define el timbre</strong></div>
          <div class="inspector-info-row"><span>Distancia + color B-V</span><strong>modulan filtro, vibrato y armonicos</strong></div>
        </div>
        <p class="inspector-info-note">El color del punto en el mapa sigue temperatura estelar: tipo espectral e indice B-V. La distancia no define ese color; influye mucho mas en brillo aparente y en la estimacion del caracter de la estrella.</p>
        <p class="inspector-info-note">La transparencia ya no depende solo de magnitud aparente: el nucleo sigue lo que ves en el cielo y el halo incorpora una estimacion de luminosidad intrinseca derivada de magnitud + distancia.</p>
        <p class="inspector-info-note">Hoy el motor usa altitud, azimut, magnitud, distancia, tipo espectral y color B-V. No usa masa real porque ese dato no está disponible de forma consistente en el catalogo actual.</p>
        ${usesEstimatedCatalogData ? "<p class=\"inspector-info-note\">En estrellas del campo amplio de VirtualSky, distancia, tipo espectral y color B-V pueden estar estimados para mantener el mapeo continuo del cielo.</p>" : ""}
      </section>
    `;
  }
  dom.inspectorToggle.disabled = false;
  dom.inspectorPlay.disabled = false;
  dom.inspectorDrone.disabled = false;
  dom.inspectorToggle.textContent = enabled ? "Fuera" : "Dentro";
  dom.inspectorToggle.classList.toggle("is-active", enabled);
  dom.inspectorDrone.textContent = isDroneActive ? "Detener drone" : "Drone";
  dom.inspectorDrone.classList.toggle("is-active", isDroneActive);
}

function updateStarsMeta(observationDate) {
  const dateText = observationDate.toLocaleString("es-AR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  const fieldStars = getAvailableStars().length;
  dom.starsMeta.textContent = `${fieldStars} estrellas · ${dateText}`;
}

function updateMapInfo() {
  const fieldStars = getAvailableStars().length;
  const poolCount = computeSoundPoolFromEnabled().length;

  dom.mapInfo.textContent =
    `${state.locationLabel} · set ${fieldStars} · arpegio ${poolCount}`;
}

function updateSummary() {
  const fieldStars = getAvailableStars().length;

  dom.voiceCount.textContent = String(fieldStars);
  dom.summaryTitle.textContent = "";
  dom.transportMeta.textContent = "";
  dom.transportMeta.hidden = true;
  syncSoundToggleButton();
}

async function playStarFromInteraction(star, sourceLabel) {
  setSelectedStar(star, { scroll: sourceLabel === "panel" });
  await ensureAudioReady();
  pulseStar(star.id);
  await soundEngine.playStar(star);
  setStatus(`${star.name} sonando.`);
}

function toggleStarFromInteraction(star, sourceLabel) {
  setSelectedStar(star, { scroll: sourceLabel === "panel" });
  const enabled = toggleStarEnabled(star.id);

  if (!enabled && soundEngine.activeDrones.has(star.id)) {
    soundEngine.stopDroneById(star.id, 0.5);
  }

  state.forceSilent = false;
  refreshSkyState({ forceList: false });
  setStatus(`${star.name} ${enabled ? "entra" : "sale"} del flujo.`);
}

async function toggleDroneFromInteraction(star, sourceLabel) {
  setSelectedStar(star, { scroll: sourceLabel === "panel" });
  await ensureAudioReady();
  const isActive = await soundEngine.toggleDrone(star);
  renderMapOverlay();
  syncStarsListVisualState();
  renderInspector();
  renderVoiceStrip();
  setStatus(`${star.name}: drone ${isActive ? "on" : "off"}.`);
}

function toggleSelectedStarInFlow() {
  const star = getSelectedStar();
  if (!star) {
    return;
  }

  const enabled = toggleStarEnabled(star.id);
  if (!enabled && soundEngine.activeDrones.has(star.id)) {
    soundEngine.toggleDrone(star).catch(() => {});
  }
  state.forceSilent = false;
  refreshSkyState({ forceList: false });
  setStatus(`${star.name} ${enabled ? "entra" : "sale"}.`);
}

async function onStarsPanelClick(event) {
  const target = event.target.closest("button[data-action='select']");
  if (!target) {
    return;
  }

  const star = getStarById(target.dataset.starId);
  if (!star) {
    return;
  }

  toggleStarFromInteraction(star, "panel");
}

async function onMapStageClick(event) {
  if (shouldIgnoreMapClick()) {
    return;
  }

  if (event.detail > 1) {
    return;
  }

  const { x, y } = getMapPoint(event);
  const star = findNearestInteractiveStar(x, y);
  if (!star) {
    return;
  }

  if (event.shiftKey) {
    await toggleDroneFromInteraction(star, "mapa");
    return;
  }

  openInspectorForStar(star);
}

async function onMapStageDoubleClick(event) {
  const { x, y } = getMapPoint(event);
  const star = findNearestInteractiveStar(x, y);
  if (!star) {
    return;
  }

  await toggleDroneFromInteraction(star, "mapa");
}

function onVoiceStripClick(event) {
  const target = event.target.closest("[data-action='inspect-voice']");
  if (!target) {
    return;
  }

  const star = getStarById(target.dataset.starId);
  if (!star) {
    return;
  }

  openInspectorForStar(star);
}

function refreshSkyState(options = {}) {
  const forceList = Boolean(options.forceList);
  const observationDate = getCurrentObservationDate();

  if (skyInstance && typeof skyInstance.setClock === "function") {
    if (state.mode === "now") {
      skyInstance.setClock("now");
    } else {
      skyInstance.setClock(observationDate);
    }
  }

  state.visibleStars = collectVisibleStars(
    BRIGHT_STARS,
    observationDate,
    state.latitude,
    state.longitude,
    0
  );

  if (skyInstance && typeof skyInstance.radec2xy === "function") {
    state.activeStars = state.visibleStars
      .map((star) => getProjectedStar(star))
      .filter(Boolean);
  } else {
    state.activeStars = state.visibleStars.slice();
  }

  state.frameStars = buildFrameStars();
  state.performerStars = buildPerformerStars();

  pruneFieldState();
  syncSelectedStar();

  soundEngine.updateArpPool(computeSoundPoolFromEnabled());
  soundEngine.setBpm(state.bpm);
  soundEngine.setArpType(state.arpType);

  updateStarsMeta(observationDate);
  updateMapInfo();
  updateSummary();
  renderInspector();
  renderMapOverlay();
  renderVoiceStrip();
  renderStarsList(forceList);
}

function resetSkyMap() {
  const container = document.querySelector("#starmap");
  container.innerHTML = "";

  if (!window.S || typeof window.S.virtualsky !== "function") {
    setStatus("VirtualSky no pudo cargarse. Revisar conexion a internet.");
    return;
  }

  skyInstance = window.S.virtualsky({
    id: "starmap",
    projection: "gnomic",
    fov: 95,
    magnitude: FRAME_STAR_MAG_LIMIT,
    latitude: state.latitude,
    longitude: state.longitude,
    background: "rgb(4,10,20)",
    color: "rgb(237,245,255)",
    negative: false,
    constellations: false,
    constellationlabels: false,
    showstarlabels: true,
    showplanets: true,
    showplanetlabels: true,
    showgalaxy: true,
    gradient: true,
    keyboard: true,
    mouse: true,
    live: false,
    lang: "es"
  });

  recenterSkyToVisibleStar();
}

function syncSkyObserverLocation() {
  if (!skyInstance) {
    resetSkyMap();
    return Boolean(skyInstance);
  }

  if (typeof skyInstance.setGeo === "function") {
    skyInstance.setGeo(`${state.latitude},${state.longitude}`);
  } else {
    if (typeof skyInstance.setLatitude === "function") {
      skyInstance.setLatitude(state.latitude);
    }
    if (typeof skyInstance.setLongitude === "function") {
      skyInstance.setLongitude(state.longitude);
    }
  }

  if (typeof skyInstance.resize === "function") {
    skyInstance.resize();
  }

  return recenterSkyToVisibleStar();
}

async function requestGeolocation() {
  if (!("geolocation" in navigator)) {
    setStatus("Tu navegador no soporta geolocalizacion.");
    return;
  }

  setStatus("Solicitando permiso de ubicacion...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.latitude = position.coords.latitude;
      state.longitude = position.coords.longitude;
      state.locationLabel = "GPS";

      const synced = syncSkyObserverLocation();
      if (!synced) {
        setStatus("No fue posible actualizar el cielo con GPS.");
        return;
      }
      refreshSkyState({ forceList: true });
      setStatus(`Ubicacion cargada (${fmtCoord(state.latitude)}, ${fmtCoord(state.longitude)}).`);
    },
    (error) => {
      if (error.code === 1) {
        setStatus("Permiso de ubicacion denegado. Usando ubicacion base.");
      } else {
        setStatus("No fue posible obtener GPS. Usando ubicacion base.");
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}

function isMapFullscreen() {
  const activeEl = document.fullscreenElement || document.webkitFullscreenElement;
  return Boolean(activeEl && (activeEl === dom.mapStage || dom.mapStage.contains(activeEl)));
}

function syncFullscreenButton() {
  const active = isMapFullscreen();
  dom.btnFullscreen.innerHTML = active ? FULLSCREEN_ICON_EXIT : FULLSCREEN_ICON_ENTER;
  dom.btnFullscreen.setAttribute("aria-label", active ? "Salir fullscreen" : "Entrar fullscreen");
  dom.btnFullscreen.title = active ? "Salir fullscreen" : "Entrar fullscreen";
  dom.btnFullscreen.setAttribute("aria-pressed", String(active));
}

async function toggleFullscreen() {
  try {
    if (isMapFullscreen()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } else if (dom.mapStage.requestFullscreen) {
      await dom.mapStage.requestFullscreen();
    } else if (dom.mapStage.webkitRequestFullscreen) {
      dom.mapStage.webkitRequestFullscreen();
    }
    syncFullscreenButton();
    scheduleSkyViewportSync(true);
  } catch {
    setStatus("El navegador no permitio fullscreen.");
  }
}

function bindEvents() {
  dom.btnGps.addEventListener("click", requestGeolocation);

  dom.btnSoundMenu.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!dom.soundMenu.hidden) {
      setSoundMenuOpen(false);
      return;
    }

    const activated = await ensureAudioReady();
    setSoundMenuOpen(true);
    if (activated) {
      setStatus("Motor sonoro activo.");
    }
  });

  dom.soundMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  dom.btnSoundMenuClose?.addEventListener("click", (event) => {
    event.stopPropagation();
    setSoundMenuOpen(false);
  });

  dom.soundMenuBackdrop?.addEventListener("pointerdown", () => {
    setSoundMenuOpen(false);
  });

  dom.btnSoundToggle.addEventListener("click", async () => {
    if (state.forceSilent) {
      await ensureAudioReady();
      enableAllStars();
      return;
    }

    disableAllStars();
  });

  dom.arpTypeSelect.addEventListener("change", () => {
    state.arpType = dom.arpTypeSelect.value;
    soundEngine.setArpType(state.arpType);
    refreshSkyState({ forceList: false });
  });

  dom.btnFullscreen.addEventListener("click", () => {
    toggleFullscreen();
  });

  dom.btnRecenter.addEventListener("click", () => {
    const ok = recenterSkyToVisibleStar();
    if (!ok) {
      setStatus("No fue posible recentrar el encuadre.");
      return;
    }
    refreshSkyState({ forceList: true });
  });

  dom.modeSelect.addEventListener("change", () => {
    state.mode = dom.modeSelect.value;
    updateOffsetUi();
    if (dom.bpm?.dataset.user !== "1") {
      state.bpm = getDefaultBpmForMode(state.mode);
      syncBpmUi();
    }
    refreshSkyState({ forceList: true });
  });

  if (dom.offsetSlider) {
    dom.offsetSlider.addEventListener("input", () => {
      state.offset = Number(dom.offsetSlider.value);
      const modeCfg = MODE_CONFIG[state.mode];
      if (dom.offsetLabel) {
        dom.offsetLabel.textContent = modeCfg.label.replace("{value}", String(state.offset));
      }
      refreshSkyState({ forceList: true });
    });
  }

  dom.soundNoteLevel.addEventListener("input", (event) => {
    soundEngine.setNoteLevel(event.target.value);
  });

  dom.soundDroneLevel.addEventListener("input", (event) => {
    soundEngine.setDroneLevel(event.target.value);
  });

  dom.soundDelayLevel.addEventListener("input", (event) => {
    soundEngine.setDelayLevel(event.target.value);
  });

  dom.soundReverbLevel.addEventListener("input", (event) => {
    soundEngine.setReverbLevel(event.target.value);
  });

  if (dom.bpm) {
    dom.bpm.addEventListener("input", (event) => {
      dom.bpm.dataset.user = "1";
      state.bpm = Number(event.target.value) || state.bpm;
      syncBpmUi();
      soundEngine.setBpm(state.bpm);
      updateSummary();
    });
  }

  dom.starsList.addEventListener("click", (event) => {
    onStarsPanelClick(event).catch(() => {
      setStatus("No se pudo tocar la estrella. Activa audio y reintenta.");
    });
  });

  dom.voiceStrip.addEventListener("click", (event) => {
    onVoiceStripClick(event);
  });

  dom.mapStage.addEventListener("click", (event) => {
    onMapStageClick(event).catch(() => {
      setStatus("No se pudo tocar una estrella del mapa.");
    });
  });

  dom.mapStage.addEventListener("dblclick", (event) => {
    onMapStageDoubleClick(event).catch(() => {
      setStatus("No se pudo alternar drone en el mapa.");
    });
  });

  dom.inspectorToggle.addEventListener("click", () => {
    toggleSelectedStarInFlow();
  });

  dom.inspectorClose?.addEventListener("click", () => {
    closeInspector();
  });

  dom.inspectorPlay.addEventListener("click", () => {
    const star = getSelectedStar();
    if (!star) {
      return;
    }
    playStarFromInteraction(star, "inspector").catch(() => {
      setStatus("No se pudo tocar la estrella seleccionada.");
    });
  });

  dom.inspectorDrone.addEventListener("click", () => {
    const star = getSelectedStar();
    if (!star) {
      return;
    }
    toggleDroneFromInteraction(star, "inspector").catch(() => {
      setStatus("No se pudo alternar el drone seleccionado.");
    });
  });

  const scheduleInteractionRefresh = () => {
    if (interactionRefreshTimeout) {
      clearTimeout(interactionRefreshTimeout);
    }
    interactionRefreshTimeout = window.setTimeout(() => {
      refreshSkyState({ forceList: false });
    }, 90);
  };

  dom.mapStage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button[data-star-id]")) {
      mapPointerDown = null;
      return;
    }

    const { x, y } = getMapPoint(event);
    mapPointerDown = { x, y, moved: false };
  });

  dom.mapStage.addEventListener("pointermove", (event) => {
    if (!mapPointerDown) {
      return;
    }

    const { x, y } = getMapPoint(event);
    if (Math.hypot(x - mapPointerDown.x, y - mapPointerDown.y) >= MAP_DRAG_THRESHOLD_PX) {
      mapPointerDown.moved = true;
      scheduleInteractionRefresh();
    }
  });

  dom.mapStage.addEventListener("pointerup", () => {
    if (mapPointerDown?.moved) {
      suppressMapClickUntil = Date.now() + MAP_CLICK_SUPPRESS_MS;
      scheduleInteractionRefresh();
    }
    mapPointerDown = null;
  });

  dom.mapStage.addEventListener("pointercancel", () => {
    mapPointerDown = null;
  });

  dom.mapStage.addEventListener("wheel", scheduleInteractionRefresh, { passive: true });
  dom.mapStage.addEventListener("mouseup", scheduleInteractionRefresh);
  dom.mapStage.addEventListener("touchend", scheduleInteractionRefresh);

  document.addEventListener("fullscreenchange", () => {
    syncFullscreenButton();
    scheduleSkyViewportSync(true);
  });

  document.addEventListener("webkitfullscreenchange", () => {
    syncFullscreenButton();
    scheduleSkyViewportSync(true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setSoundMenuOpen(false);
      closeInspector();
    }
  });

  window.addEventListener("resize", () => {
    scheduleSkyViewportSync(true);
  });
}

function startAutoRefresh() {
  setInterval(() => {
    if (document.hidden) {
      return;
    }
    refreshSkyState({ forceList: false });
  }, AUTO_REFRESH_MS);
}

function boot() {
  updateOffsetUi();
  syncBpmUi();
  syncSoundMenuButton();
  syncSoundMenuControls();
  setSoundMenuOpen(false);
  syncInspectorVisibility();
  resetSkyMap();
  refreshSkyState({ forceList: true });
  soundEngine.setArpStepCallback((star) => {
    pulseStar(star.id, { fromArp: true });
  });
  bindEvents();
  syncFullscreenButton();
  startAutoRefresh();
}

boot();
