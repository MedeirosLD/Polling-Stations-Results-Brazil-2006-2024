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

function getColorForCandidate(nome, partido) {
  if (CUSTOM_CANDIDATE_COLORS.has(nome)) {
    return CUSTOM_CANDIDATE_COLORS.get(nome);
  }
  return PARTY_COLORS.get((partido || '').toUpperCase()) || DEFAULT_SWATCH;
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
let currentCidadeFilter = 'all';
let currentBairroFilter = 'all';
let currentLocalFilter = '';
let autoLoadTimer = null;
let autoLoadSequence = 0;
let autoLoadRunningSequence = 0;

const STATE = {
  mapTileLayer: null,
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
  municipalOfficialTotals: {},
  censusFilters: {
    rendaMin: null,
    rendaMax: null,

    // Raça
    racaVal: null,
    racaMode: 'Pct Preta',

    // Idade
    idadeVal: null,
    idadeMode: '16-24',

    // Gênero
    generoVal: null,
    generoMode: 'Pct Mulheres',

    // Escolaridade (Novo)
    escolaridadeVal: null,
    escolaridadeMode: 'Superior Completo',

    // Estado Civil (Novo)
    estadoCivilVal: null,
    estadoCivilMode: 'Solteiro',

    // Saneamento
    saneamentoVal: null,
    saneamentoMode: 'Pct Esgoto Inadequado'
  }
};

let uniqueCidades = new Set();
let uniqueBairros = new Set();
let dom = {};

// ====== MULTI-SELECTION GLOBALS ======
let isSelectorsActive = false;
let startSelectionPoint = null;
let selectionBoxElement = null; // DOM Element for the box
let isDragSelection = false; // Flag to track if last selection was drag

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
