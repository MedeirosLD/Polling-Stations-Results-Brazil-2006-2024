const DATA_BASE_URL = 'resultados_geo/';

// CACHE SIMPLES PARA CANDIDATOS (VERSÃO SIMPLIFICADA)
let CANDIDATES_CACHE = new Map();

let ZIP_INDEX = null;
let STATE_ZIP_INDEX = null;
let ZIP_READERS = (typeof LRUCache === 'function')
  ? new LRUCache(8)
  : new Map(); // Cache de leitores ZIP: URL -> BlobReader
let OFFICIAL_TOTALS_PROMISE = null; // Promise deduplication for official totals
let SQL_JS_PROMISE = null;
let GPKG_2006_DB_PROMISE = null;
let GPKG_2010_DB_PROMISE = null;
let GPKG_2008_DB_PROMISE = null;
let GPKG_2014_DB_PROMISE = null;
let GPKG_2018_DB_PROMISE = null;
let GPKG_2012_DB_PROMISE = null;
let GPKG_2016_DB_PROMISE = null;
let GPKG_2020_DB_PROMISE = null;
let GPKG_2024_DB_PROMISE = null;
let GPKG_2022_DB_PROMISE = null;
let GENERAL_2006_BASE_CACHE = new Map();
let CENSO_2006_CACHE = new Map();
let GENERAL_2010_BASE_CACHE = new Map();
let CENSO_2010_CACHE = new Map();
let GENERAL_2014_BASE_CACHE = new Map();
let CENSO_2014_CACHE = new Map();
let GENERAL_2018_BASE_CACHE = new Map();
let CENSO_2018_CACHE = new Map();
let MUNICIPAL_2008_BASE_CACHE = new Map();
let CENSO_2008_CACHE = new Map();
let MUNICIPAL_2012_BASE_CACHE = new Map();
let CENSO_2012_CACHE = new Map();
let MUNICIPAL_2016_BASE_CACHE = new Map();
let CENSO_2016_CACHE = new Map();
let MUNICIPAL_2020_BASE_CACHE = new Map();
let CENSO_2020_CACHE = new Map();
let MUNICIPAL_2024_BASE_CACHE = new Map();
let CENSO_2024_CACHE = new Map();
let GENERAL_2022_BASE_CACHE = new Map();
let CENSO_2022_CACHE = new Map();
let TURNOUT_REFERENCE_INDEX_CACHE = new Map();
let FEATURE_TURNOUT_CACHE = new WeakMap();
let CURRENT_VISIBLE_FEATURES_CACHE = [];
let CURRENT_VISIBLE_PROPS_CACHE = [];

function getCacheSize(cacheLike) {
  if (!cacheLike) return 0;
  if (typeof cacheLike.size === 'function') return cacheLike.size();
  return cacheLike.size || 0;
}

function forEachCacheEntry(cacheLike, callback) {
  if (!cacheLike || typeof callback !== 'function') return;
  if (typeof cacheLike.forEach === 'function') {
    cacheLike.forEach(callback);
    return;
  }
  if (cacheLike.cache && typeof cacheLike.cache.forEach === 'function') {
    cacheLike.cache.forEach(callback);
  }
}

// ====== LOADING HELPERS ======
function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (dom.btnLoadData && btn === dom.btnLoadData) {
    STATE.isLoadingDataset = !!isLoading;
  }
  if (isLoading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function setChipLoading(chip, isLoading) {
  if (!chip) return;
  if (isLoading) {
    chip.classList.add('loading');
  } else {
    chip.classList.remove('loading');
  }
}

function setSectionLoading(section, isLoading) {
  if (!section) return;
  if (isLoading) {
    section.classList.add('loading');
  } else {
    section.classList.remove('loading');
  }
}

function fadeContent(element, callback) {
  if (!element) {
    if (callback) callback();
    return;
  }
  element.classList.add('fading');
  setTimeout(() => {
    if (callback) callback();
    element.classList.remove('fading');
  }, 200);
}

function showSkeletonCards(container, count = 4) {
  if (!container) return;
  let html = '<div class="grid">';
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton-card"></div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function showToast(message, type = 'info', duration = 3000) {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Auto remove
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showMapLoading(message = 'Carregando dados...', progress = null) {
  if (!dom.mapLoader) return;
  dom.mapLoader.textContent = message;
  dom.mapLoader.classList.add('visible');
  if (progress === null || progress === undefined) {
    dom.mapLoader.dataset.progressMode = 'indeterminate';
    dom.mapLoader.style.removeProperty('--loader-progress');
    return;
  }
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  dom.mapLoader.dataset.progressMode = 'determinate';
  dom.mapLoader.style.setProperty('--loader-progress', `${safeProgress}%`);
}

function updateMapLoading(message, progress = null) {
  if (!dom.mapLoader) return;
  if (message) dom.mapLoader.textContent = message;
  if (progress === null || progress === undefined) {
    dom.mapLoader.dataset.progressMode = 'indeterminate';
    dom.mapLoader.style.removeProperty('--loader-progress');
    return;
  }
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  dom.mapLoader.dataset.progressMode = 'determinate';
  dom.mapLoader.style.setProperty('--loader-progress', `${safeProgress}%`);
}

function hideMapLoading() {
  if (!dom.mapLoader) return;
  dom.mapLoader.classList.remove('visible');
  dom.mapLoader.dataset.progressMode = 'indeterminate';
  dom.mapLoader.style.removeProperty('--loader-progress');
}

function markFiltersDirty() {
  STATE.hasPendingFilterChanges = true;
  if (typeof updateApplyButtonText === 'function') {
    updateApplyButtonText();
  }
}

function clearPendingFilterChanges() {
  STATE.hasPendingFilterChanges = false;
  if (typeof updateApplyButtonText === 'function') {
    updateApplyButtonText();
  }
}

function clearZipCache() {
  resetTurnoutReferenceIndexes();
  FEATURE_TURNOUT_CACHE = new WeakMap();
  CURRENT_VISIBLE_FEATURES_CACHE = [];
  CURRENT_VISIBLE_PROPS_CACHE = [];
  // Limpeza profunda de leitores de ZIP
  const readerCount = getCacheSize(ZIP_READERS);
  if (readerCount > 0) {
    console.log(`Cleaning ${readerCount} cached ZIP readers...`);
    forEachCacheEntry(ZIP_READERS, (reader) => {
      // Tenta fechar streams abertos (importante para Blobs/HTTPRange)
      if (reader && typeof reader.close === 'function') {
        try { reader.close(); } catch (e) { console.warn("Erro ao fechar reader:", e); }
      }
    });
    ZIP_READERS.clear();
  }

  // Limpa também detalhes de candidatos que podem ser pesados
  CANDIDATE_DETAILS = null;
  CANDIDATE_DETAILS_PROMISE = null;
  GENERAL_2006_BASE_CACHE.clear();
  CENSO_2006_CACHE.clear();
  GENERAL_2010_BASE_CACHE.clear();
  CENSO_2010_CACHE.clear();
  GENERAL_2014_BASE_CACHE.clear();
  CENSO_2014_CACHE.clear();
  GENERAL_2018_BASE_CACHE.clear();
  CENSO_2018_CACHE.clear();
  MUNICIPAL_2008_BASE_CACHE.clear();
  CENSO_2008_CACHE.clear();
  MUNICIPAL_2012_BASE_CACHE.clear();
  CENSO_2012_CACHE.clear();
  MUNICIPAL_2020_BASE_CACHE.clear();
  CENSO_2020_CACHE.clear();
  MUNICIPAL_2016_BASE_CACHE.clear();
  CENSO_2016_CACHE.clear();
  MUNICIPAL_2024_BASE_CACHE.clear();
  CENSO_2024_CACHE.clear();
  GENERAL_2022_BASE_CACHE.clear();
  CENSO_2022_CACHE.clear();

  if (GPKG_2006_DB_PROMISE) {
    GPKG_2006_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2006:", e); }
      }
    }).catch(() => { });
    GPKG_2006_DB_PROMISE = null;
  }

  if (GPKG_2010_DB_PROMISE) {
    GPKG_2010_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2010:", e); }
      }
    }).catch(() => { });
    GPKG_2010_DB_PROMISE = null;
  }

  if (GPKG_2008_DB_PROMISE) {
    GPKG_2008_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2008:", e); }
      }
    }).catch(() => { });
    GPKG_2008_DB_PROMISE = null;
  }

  if (GPKG_2018_DB_PROMISE) {
    GPKG_2018_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2018:", e); }
      }
    }).catch(() => { });
    GPKG_2018_DB_PROMISE = null;
  }

  if (GPKG_2014_DB_PROMISE) {
    GPKG_2014_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2014:", e); }
      }
    }).catch(() => { });
    GPKG_2014_DB_PROMISE = null;
  }

  if (GPKG_2012_DB_PROMISE) {
    GPKG_2012_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2012:", e); }
      }
    }).catch(() => { });
    GPKG_2012_DB_PROMISE = null;
  }

  if (GPKG_2020_DB_PROMISE) {
    GPKG_2020_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2020:", e); }
      }
    }).catch(() => { });
    GPKG_2020_DB_PROMISE = null;
  }

  if (GPKG_2016_DB_PROMISE) {
    GPKG_2016_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2016:", e); }
      }
    }).catch(() => { });
    GPKG_2016_DB_PROMISE = null;
  }

  if (GPKG_2024_DB_PROMISE) {
    GPKG_2024_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2024:", e); }
      }
    }).catch(() => { });
    GPKG_2024_DB_PROMISE = null;
  }

  if (GPKG_2022_DB_PROMISE) {
    GPKG_2022_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2022:", e); }
      }
    }).catch(() => { });
    GPKG_2022_DB_PROMISE = null;
  }

  // Força coleta de lixo se possível (indireto)
  console.log("Memory cleanup executed.");
}
let MUNICIPAL_DATA_INDEX = {};
let CANDIDATE_DETAILS = null; // Cache dos detalhes (JSON)
let CANDIDATE_DETAILS_PROMISE = null; // Promise do carregamento



// CORES E PARTIDOS
const PARTY_COLORS = new Map(Object.entries({
  'AVANTE': '#2eacb2', 'CIDADANIA': '#ec008c', 'DC': '#c89721', 'DEM': '#8CC63E',
  'MDB': '#009959', 'MOBILIZA': '#DD3333', 'NOVO': '#ec671c', 'PAN': '#ffff00',
  'PASART': '#0000FF', 'PCB': '#a8231c', 'PCDOB': '#800314', 'PCO': '#9F030A',
  'PDS': '#0067A5', 'PDT': '#FE8E6D', 'PEN': '#4AA561', 'PGT': '#006600',
  'PH': '#FF8511', 'PHS': '#8A191E', 'PJ': '#01369E', 'PL': '#30306C',
  'PMN': '#CF7676', 'PN': '#008000', 'PODE': '#00d663', 'PP': '#3672c9',
  'PPL': '#9ACD32', 'PROS': '#f48c24', 'PRTB': '#245ba0', 'PSB': '#FFCC00',
  'PSC': '#006f41', 'PSD': '#ffa400', 'PSDB': '#0096ff', 'PSL': '#054577',
  'PSOL': '#68018D', 'PST': '#9370DB', 'PSTU': '#c92127', 'PT': '#C0122D',
  'PTB': '#005533', 'PTC': '#01369eff', 'PTN': '#00d663', 'PTR': '#0047AB',
  'PV': '#01652F', 'REDE': '#3ca08c', 'REPUBLICANOS': '#005CA9', 'SOLIDARIEDADE': '#f37021',
  'UNIÃO': '#01f6fe', 'UP': '#000000', 'ARENA': '#4034B2', 'PMDB': '#009959',
  'PRB': '#005CA9', 'PT DO B': '#2eacb2', 'PFL': '#8CC63E', 'PSP46': '#533e40',
  'MISSÃO': '#FCBD27', 'PATRIOTA': '#316635', 'TOSSUP': '#cbd5e1', 'PPS': '#ec008c', 'PR': '#30306C', 'PC DO B': '#b4251d', 'PSDC': '#c89721',
  'PRD': '#007c3c', 'SD': '#f37021', 'PRONA': '#34b233', 'PRP': '#006db8', 'PMB': '#8e2a4e', 'Agir': '#9370db', 'AGIR': '#9370db'
}));

const CUSTOM_CANDIDATE_COLORS = new Map();
const CUSTOM_COLORBLIND_CANDIDATE_COLORS = new Map();
const CUSTOM_COLORBLIND_PARTY_COLORS = new Map();
const COLORBLIND_AUTO_PARTY_COLORS = new Map();
let isColorblindMode = false;

const COLORBLIND_PARTY_COLORS = new Map(Object.entries({
  'PT': '#D55E00', 'PCDOB': '#8B5A00', 'PC DO B': '#8B5A00', 'PCB': '#6B4C00', 'PSTU': '#E69F00', 'PCO': '#9C3D00', 'UP': '#000000',
  'PL': '#0072B2', 'PR': '#0072B2', 'PDS': '#0072B2', 'PRONA': '#0072B2', 'PSL': '#00588A', 'PRTB': '#00588A', 'PATRIOTA': '#00588A',
  'PSDB': '#56B4E9', 'CIDADANIA': '#CC79A7', 'PPS': '#CC79A7',
  'MDB': '#D55E00', 'PMDB': '#D55E00', 'PV': '#009E73', 'REDE': '#44AA99', 'PODE': '#009E73',
  'PP': '#3366CC', 'PSD': '#E69F00', 'UNIÃO': '#0072B2', 'UNIÃƒO': '#0072B2', 'DEM': '#0072B2', 'PFL': '#0072B2',
  'PSB': '#F0E442', 'PDT': '#009E73', 'SOLIDARIEDADE': '#E69F00', 'SD': '#E69F00',
  'PSOL': '#882255', 'REPUBLICANOS': '#56B4E9', 'PRB': '#56B4E9',
  'NOVO': '#E69F00', 'AVANTE': '#44AA99', 'DC': '#999933', 'PSC': '#117733',
  'TOSSUP': '#999999'
}));

const COLORBLIND_SAFE_PALETTE = [
  '#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9',
  '#882255', '#000000', '#117733', '#332288', '#88CCEE', '#AA4499',
  '#44AA99', '#999933', '#DDCC77'
];
const COLORBLIND_MIN_DISTANCE = 82;

function getActiveCandidateColorMap() {
  return isColorblindMode ? CUSTOM_COLORBLIND_CANDIDATE_COLORS : CUSTOM_CANDIDATE_COLORS;
}

function normalizeColorblindPartyKey(partido) {
  const key = String(partido || '').toUpperCase();
  if (key === 'PMDB') return 'MDB';
  if (key === 'UNIÃƒO') return 'UNIÃO';
  return key;
}

function parseHexColor(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ];
}

function simulateColorVision(rgb, type) {
  const matrices = {
    protanopia: [
      [0.56667, 0.43333, 0],
      [0.55833, 0.44167, 0],
      [0, 0.24167, 0.75833]
    ],
    deuteranopia: [
      [0.625, 0.375, 0],
      [0.7, 0.3, 0],
      [0, 0.3, 0.7]
    ],
    tritanopia: [
      [0.95, 0.05, 0],
      [0, 0.43333, 0.56667],
      [0, 0.475, 0.525]
    ]
  };
  const matrix = matrices[type];
  return matrix.map(row => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
}

function rgbDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function colorblindDistance(colorA, colorB) {
  const rgbA = parseHexColor(colorA);
  const rgbB = parseHexColor(colorB);
  if (!rgbA || !rgbB) return 999;
  const normalDistance = rgbDistance(rgbA, rgbB);
  const simulatedDistance = ['protanopia', 'deuteranopia', 'tritanopia']
    .map(type => rgbDistance(simulateColorVision(rgbA, type), simulateColorVision(rgbB, type)));
  return Math.min(normalDistance, ...simulatedDistance);
}

function getBestColorblindFallback(usedColors, preferredColor) {
  const candidates = [preferredColor, ...COLORBLIND_SAFE_PALETTE].filter(Boolean);
  let bestColor = candidates[0] || DEFAULT_SWATCH;
  let bestDistance = -1;

  candidates.forEach((candidate) => {
    const nearestDistance = usedColors.length
      ? Math.min(...usedColors.map(color => colorblindDistance(candidate, color)))
      : 999;
    if (nearestDistance > bestDistance) {
      bestColor = candidate;
      bestDistance = nearestDistance;
    }
  });

  return bestColor;
}

function getAutoColorblindPartyColor(partido) {
  const key = normalizeColorblindPartyKey(partido);
  if (!key) return DEFAULT_SWATCH;
  if (COLORBLIND_AUTO_PARTY_COLORS.has(key)) return COLORBLIND_AUTO_PARTY_COLORS.get(key);

  const preferredColor = COLORBLIND_PARTY_COLORS.get(key) || PARTY_COLORS.get(key) || DEFAULT_SWATCH;
  const usedColors = Array.from(COLORBLIND_AUTO_PARTY_COLORS.values());
  const isTooClose = usedColors.some(color => colorblindDistance(preferredColor, color) < COLORBLIND_MIN_DISTANCE);
  const color = isTooClose ? getBestColorblindFallback(usedColors, preferredColor) : preferredColor;

  COLORBLIND_AUTO_PARTY_COLORS.set(key, color);
  return color;
}

function resetColorblindAutoPalette() {
  COLORBLIND_AUTO_PARTY_COLORS.clear();
}

function getEffectivePartyColor(partido) {
  const key = normalizeColorblindPartyKey(partido);
  if (isColorblindMode) {
    if (CUSTOM_COLORBLIND_PARTY_COLORS.has(key)) return CUSTOM_COLORBLIND_PARTY_COLORS.get(key);
    return getAutoColorblindPartyColor(key);
  }
  return PARTY_COLORS.get(key) || DEFAULT_SWATCH;
}

function getColorForCandidate(nome, partido) {
  const customColors = getActiveCandidateColorMap();
  if (customColors.has(nome)) {
    return customColors.get(nome);
  }
  return getEffectivePartyColor(partido);
}

const DEFAULT_SWATCH = "#7a8699";

const UF_MAP = new Map([
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'],
  ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'],
  ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'],
  ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'], ['SE', 'Sergipe'],
  ['TO', 'Tocantins']
]);
const ALL_STATE_SIGLAS = Array.from(UF_MAP.keys()).filter(k => k !== 'BR');

const MAP_TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
};

// ====== STATE ======
let map, currentLayer, mapCanvasRenderer;
let allDataCache = new Map();
let currentDataCollection = {};
let currentDataCollection_2022 = {};
let selectedLocationIDs = new Set();
let currentTurno = 1;
let currentCargo = 'presidente_ord';
let currentOffice = 'presidente'; // 'presidente', 'governador', 'senador', 'deputado', 'prefeito'
let currentSubType = 'ord'; // 'ord' (Federal/Ord) or 'est' (Estadual) or 'sup'

let currentVizMode = 'vencedor';
const PRESIDENT_SHIFT_YEARS = [2006, 2010, 2014, 2018, 2022];
let presidentShiftFromYear = 2018;
let presidentShiftToYear = 2022;
let presidentShiftUserSelectedYears = false;
// Cache: nome_upper → id, rebuilt when cargo/data changes
let deputyNameToIdCache = {};

function getDeputyIdByName(nome) {
  const key = nome.toUpperCase().trim();
  if (deputyNameToIdCache[key] !== undefined) return deputyNameToIdCache[key] || null;
  // Build cache on first miss
  deputyNameToIdCache = {};
  for (const [id, meta] of Object.entries(STATE.deputyMetadata || {})) {
    if (meta[0]) deputyNameToIdCache[meta[0].toUpperCase().trim()] = id;
  }
  return deputyNameToIdCache[key] || null;
}

let currentVizSize = 'comparecimento';
let currentVizColorStyle = 'gradient'; // 'static' or 'gradient'

// Estatísticas do candidato para modo Desempenho (calculadas ao mudar candidato)
let performanceModeStats = {
  candidato: null,
  minPct: 0,
  maxPct: 0,
  avgPct: 0,
  totalLocais: 0
};
// Filtro de porcentagem mínima para modo Desempenho
let performanceFilterMinPct = 0;
let currentMesorregiaoFilter = 'all';
let currentMicrorregiaoFilter = 'all';
let currentCidadeFilter = 'all';
let currentBairroFilter = 'all';
let currentLocalFilter = '';
let autoLoadTimer = null;
let autoLoadSequence = 0;
let autoLoadRunningSequence = 0;
let pendingMapViewportRestore = null;

function rememberMapViewportForNextLoad(force = false) {
  if (!map || typeof map.getCenter !== 'function' || typeof map.getZoom !== 'function') return;
  const zoom = map.getZoom();
  if (!force && zoom <= 7) return;

  const center = map.getCenter();
  if (!center) return;

  pendingMapViewportRestore = {
    center: { lat: center.lat, lng: center.lng },
    zoom
  };
}

function applyMapViewportAfterDataLoad(bounds, fitBoundsOptions = { animate: false, padding: [20, 20] }) {
  if (!map) return;

  const pending = pendingMapViewportRestore;
  pendingMapViewportRestore = null;

  if (pending?.center && Number.isFinite(pending.zoom)) {
    const nextCenter = L.latLng(pending.center.lat, pending.center.lng);
    if (!bounds || !bounds.isValid || !bounds.isValid() || bounds.contains(nextCenter)) {
      map.setView(nextCenter, pending.zoom, { animate: false });
      return;
    }
  }

  if (bounds?.isValid?.()) {
    map.fitBounds(bounds, fitBoundsOptions);
  }
}

const STATE = {
  mapTileLayer: null,
  autoLoadEnabled: false,
  hasPendingFilterChanges: false,
  isLoadingDataset: false,
  filterInaptos: false,
  isFilterAggregationActive: false,
  dataHas2T: {},
  dataHasInaptos: {},
  candidates: {},
  metrics: {},
  inaptos: {},
  currentElectionYear: '2022',
  currentElectionType: 'geral', // 'geral' ou 'municipal'
  spatialIndex2022: {
    presidente: null,
    governador: null,
    senador: null
  },
  currentMuniCode: null,
  generalOfficialTotals: {},
  generalOfficialTotalsByCity: {},
  municipalOfficialTotals: {},
  deputyResults: {},
  deputyMetadata: {},
  deputyAdjustments: {},
  deputyCache: {},
  deputyLookup: null,
  deputyLookupCargo: null,
  _partyPrefixCache: null,
  vereadorResults: {},
  vereadorMetadata: {},
  vereadorAdjustments: {},
  vereadorLookup: null,
  _vereadorPartyPrefixCache: null,
  censusFilters: {
    rendaMin: null,
    rendaMax: null,

    // Raça
    racaVal: null,
    racaMode: 'Pct Preta',

    // Idade
    idadeVal: null,
    idadeMode: '16-24',
    idadeGeneroMode: 'total',

    // Gênero
    generoVal: null,
    generoMode: 'Pct Mulheres',

    // Escolaridade (Novo)
    escolaridadeVal: null,
    escolaridadeMode: 'Superior Completo',
    escolaridadeGeneroMode: 'total',

    // Estado Civil (Novo)
    estadoCivilVal: null,
    estadoCivilMode: 'Solteiro',

    // Saneamento
    saneamentoVal: null,
    saneamentoMode: 'Pct Esgoto Inadequado'
  }
};

if (typeof window !== 'undefined') {
  window.rememberMapViewportForNextLoad = rememberMapViewportForNextLoad;
  window.applyMapViewportAfterDataLoad = applyMapViewportAfterDataLoad;
}

let uniqueCidades = new Set();
let uniqueBairros = new Set();
let dom = {};
let REGIONAL_FILTERS_PROMISE = null;
let REGIONAL_FILTERS_INDEX = {
  mesoByUf: new Map(),
  microByUf: new Map()
};

function getCurrentGeneralRegionalUF() {
  const uf = String(dom.selectUFGeneral?.value || '').toUpperCase();
  return (STATE.currentElectionType === 'geral' && uf && uf !== 'BR') ? uf : '';
}

function getFeatureMunicipioIdentity(props) {
  return {
    code: String(
      getProp(props, 'cod_localidade_ibge')
      || getProp(props, 'codigo_ibge')
      || getProp(props, 'COD_LOCALIDADE_IBGE')
      || ''
    ).trim(),
    slug: normalizeMunicipioSlug(getProp(props, 'nm_localidade'))
  };
}

function buildRegionalFilterIndex(rawByUf = {}) {
  const index = new Map();
  Object.entries(rawByUf || {}).forEach(([uf, regions]) => {
    const regionEntries = [];
    Object.entries(regions || {}).forEach(([regionName, municipios]) => {
      const municipioCodes = new Set();
      const municipioSlugs = new Set();
      (municipios || []).forEach((municipio) => {
        const code = String(municipio?.codigo_ibge || '').trim();
        const slug = normalizeMunicipioSlug(municipio?.nome_municipio);
        if (code) municipioCodes.add(code);
        if (slug) municipioSlugs.add(slug);
      });
      regionEntries.push({
        label: regionName,
        key: norm(regionName),
        municipioCodes,
        municipioSlugs
      });
    });
    index.set(String(uf || '').toUpperCase(), regionEntries.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')));
  });
  return index;
}

async function ensureRegionalFiltersLoaded() {
  if (REGIONAL_FILTERS_INDEX.mesoByUf.size && REGIONAL_FILTERS_INDEX.microByUf.size) return REGIONAL_FILTERS_INDEX;
  if (REGIONAL_FILTERS_PROMISE) return REGIONAL_FILTERS_PROMISE;

  REGIONAL_FILTERS_PROMISE = Promise.all([
    fetch('resultados_geo/municipios_por_mesorregiao.json').then((res) => {
      if (!res.ok) throw new Error('Falha ao carregar mesorregiões');
      return res.json();
    }),
    fetch('resultados_geo/municipios_por_microrregiao.json').then((res) => {
      if (!res.ok) throw new Error('Falha ao carregar microrregiões');
      return res.json();
    })
  ]).then(([mesoJson, microJson]) => {
    REGIONAL_FILTERS_INDEX = {
      mesoByUf: buildRegionalFilterIndex(mesoJson),
      microByUf: buildRegionalFilterIndex(microJson)
    };
    return REGIONAL_FILTERS_INDEX;
  });

  return REGIONAL_FILTERS_PROMISE;
}

function getRegionalEntries(kind, uf = getCurrentGeneralRegionalUF()) {
  const source = kind === 'micro' ? REGIONAL_FILTERS_INDEX.microByUf : REGIONAL_FILTERS_INDEX.mesoByUf;
  return source.get(String(uf || '').toUpperCase()) || [];
}

function getSelectedRegionalEntry(kind, uf = getCurrentGeneralRegionalUF()) {
  const filterValue = kind === 'micro' ? currentMicrorregiaoFilter : currentMesorregiaoFilter;
  if (filterValue === 'all') return null;
  return getRegionalEntries(kind, uf).find((entry) => entry.label === filterValue || entry.key === norm(filterValue)) || null;
}

function hasRegionalScopeFilters() {
  return currentMesorregiaoFilter !== 'all' || currentMicrorregiaoFilter !== 'all';
}

function matchesRegionalScope(props) {
  if (STATE.currentElectionType !== 'geral') return true;
  if (!hasRegionalScopeFilters()) return true;
  const uf = getCurrentGeneralRegionalUF();
  if (!uf) return false;

  const { code, slug } = getFeatureMunicipioIdentity(props);
  const mesoEntry = getSelectedRegionalEntry('meso', uf);
  if (mesoEntry) {
    const matchMeso = (code && mesoEntry.municipioCodes.has(code)) || (slug && mesoEntry.municipioSlugs.has(slug));
    if (!matchMeso) return false;
  }
  const microEntry = getSelectedRegionalEntry('micro', uf);
  if (microEntry) {
    const matchMicro = (code && microEntry.municipioCodes.has(code)) || (slug && microEntry.municipioSlugs.has(slug));
    if (!matchMicro) return false;
  }
  return true;
}

function matchesLocationFilters(props, options = {}) {
  const { ignoreCidade = false, ignoreBairro = false, ignoreLocal = false } = options;
  if (!matchesRegionalScope(props)) return false;
  if (!ignoreCidade && STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all') {
    if (!sameFilterText(getProp(props, 'nm_localidade'), currentCidadeFilter)) return false;
  }
  if (!ignoreBairro && currentBairroFilter !== 'all') {
    const bairro = getProp(props, 'ds_bairro');
    if (!bairro || !sameFilterText(bairro, currentBairroFilter)) return false;
  }
  if (!ignoreLocal) {
    const searchTxt = currentLocalFilter.trim();
    if (searchTxt.length > 2) {
      const nomeLocal = norm(getProp(props, 'nm_locvot'));
      if (!nomeLocal.includes(searchTxt)) return false;
    }
  }
  return true;
}

function sameFilterText(a, b) {
  return norm(a) === norm(b);
}

function getRegionalFilterSummaryLabel() {
  const parts = [];
  if (currentMesorregiaoFilter !== 'all') parts.push(`Mesorregião ${currentMesorregiaoFilter}`);
  if (currentMicrorregiaoFilter !== 'all') parts.push(`Microrregião ${currentMicrorregiaoFilter}`);
  return parts.join(' • ');
}

// ====== MULTI-SELECTION GLOBALS ======
let isSelectorsActive = false;
let startSelectionPoint = null;
let selectionBoxElement = null; // DOM Element for the box
let isDragSelection = false; // Flag to track if last selection was drag
let mobileAreaSelectionMode = false;
let mobileSelectionButton = null;
let mobileSelectionConfirmPanel = null;
let pendingMobileSelectionIDs = new Set();

// ====== FUNÇÃO DE LIMPEZA COMPLETA DE DEPUTADOS ======
function clearDeputyData() {
  STATE.deputyResults = {};
  STATE.deputyMetadata = {};
  STATE.deputyAdjustments = {};
  STATE.deputyCache = {};
  STATE.deputyLookup = null;
  STATE.deputyLookupCargo = null;
  STATE._partyPrefixCache = null; // Invalidate party prefix cache
  loadedDeputyState = { uf: null, types: new Set(), year: null };

  console.log('✓ Dados de deputados completamente limpos');
}

// ====== ESTADO E LIMPEZA DE VEREADORES ======
// Estrutura paralela à de deputados, mas chaveada por município
// STATE.vereadorResults[zona_local]  = { v: { candId: votes } }
// STATE.vereadorMetadata             = { candId: [nome, partido, status, colig, comp] }
// STATE.vereadorAdjustments          = { norm_comp: diff }
let loadedVereadorState = { uf: null, muniCode: null, year: null };

function clearVereadorData() {
  STATE.vereadorResults = {};
  STATE.vereadorMetadata = {};
  STATE.vereadorAdjustments = {};
  STATE.vereadorLookup = null;
  STATE._vereadorPartyPrefixCache = null;
  loadedVereadorState = { uf: null, muniCode: null, year: null };
  console.log('✓ Dados de vereadores completamente limpos');
}
