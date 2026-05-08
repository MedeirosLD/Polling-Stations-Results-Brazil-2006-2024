
function resolveFeatureSelectionId(properties) {
  if (typeof getFeatureSelectionId === 'function') {
    return getFeatureSelectionId(properties);
  }

  if (typeof window !== 'undefined' && typeof window.getFeatureSelectionId === 'function') {
    return window.getFeatureSelectionId(properties);
  }

  if (!properties) return '';

  const readProp = (key) => {
    if (typeof getProp === 'function') return getProp(properties, key);
    if (typeof window !== 'undefined' && typeof window.getProp === 'function') {
      return window.getProp(properties, key);
    }
    return properties[key] ?? properties[String(key).toLowerCase()] ?? properties[String(key).toUpperCase()] ?? null;
  };

  const explicitId = readProp('id_unico') || readProp('local_id');
  if (explicitId !== null && explicitId !== undefined && String(explicitId).trim() !== '') {
    return String(explicitId).trim();
  }

  const parts = [
    readProp('sg_uf') || readProp('SG_UF') || '',
    readProp('cd_localidade_tse') || readProp('CD_MUNICIPIO') || readProp('cod_localidade_ibge') || '',
    readProp('nr_zona') || readProp('NR_ZONA') || '',
    readProp('nr_locvot') || readProp('nr_local_votacao') || readProp('NR_LOCAL_VOTACAO') || ''
  ].map(part => String(part || '').trim()).filter(Boolean);

  return parts.join('_');
}

function clearVizCandidateSelectionState() {
  if (!dom.selectVizCandidato) return;

  dom.selectVizCandidato.innerHTML = '';
  dom.selectVizCandidato.value = '';
  delete dom.selectVizCandidato.dataset.selectedDeputyId;

  const deputySearchInput = document.getElementById('deputySearchInput');
  const deputySearchResults = document.getElementById('deputySearchResults');
  if (deputySearchInput) deputySearchInput.value = '';
  if (deputySearchResults) {
    deputySearchResults.innerHTML = '';
    deputySearchResults.classList.remove('visible');
  }
}

function formatVizCandidateLabel(candidateData) {
  if (!candidateData) return '';
  if (candidateData.isLegenda) return `Voto de Legenda — ${candidateData.partido}`;
  return `${toTitleCase(candidateData.nome)} (${candidateData.partido}) • Nº ${candidateData.numero}`;
}

function getResolvedVisualizationCandidateId(candidatoKey, cargo = currentCargo) {
  if (typeof resolveVisualizationCandidateId === 'function') {
    return resolveVisualizationCandidateId(candidatoKey, cargo);
  }
  if (typeof window !== 'undefined' && typeof window.resolveVisualizationCandidateId === 'function') {
    return window.resolveVisualizationCandidateId(candidatoKey, cargo);
  }
  return null;
}

function getCandidateVotesForVisualization(votesMap, candidateId) {
  if (typeof getCandidateVotesFromMap === 'function') {
    return getCandidateVotesFromMap(votesMap, candidateId);
  }
  if (typeof window !== 'undefined' && typeof window.getCandidateVotesFromMap === 'function') {
    return window.getCandidateVotesFromMap(votesMap, candidateId);
  }
  if (!votesMap || candidateId === null || candidateId === undefined) return null;
  const rawId = String(candidateId).trim();
  if (Object.prototype.hasOwnProperty.call(votesMap, rawId)) {
    return parseInt(votesMap[rawId], 10) || 0;
  }
  return null;
}

function populateVizCandidatoDropdown(turno) {
  const previousValue = dom.selectVizCandidato.value;
  const previousDeputyId = dom.selectVizCandidato.dataset.selectedDeputyId || '';
  clearVizCandidateSelectionState();

  const deputySearchBox = document.getElementById('deputySearchBox');
  const deputySearchInput = document.getElementById('deputySearchInput');
  const deputySearchResults = document.getElementById('deputySearchResults');

  // Para deputados ou vereadores: usar o campo de busca em vez do select
  if (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador')) {
    const isVereador = currentCargo.startsWith('vereador');
    const isEstadual = !isVereador && currentCargo.includes('estadual');
    const typeKey = isVereador ? 'v' : (isEstadual ? 'e' : 'f');
    const resultStore = isVereador ? STATE.vereadorResults : STATE.deputyResults;
    const metaStore = isVereador ? STATE.vereadorMetadata : STATE.deputyMetadata;
    const inaptosList = isVereador
      ? (STATE.inaptos['vereador_ord']?.['1T'] || [])
      : (STATE.inaptos[currentCargo]?.['1T'] || []);

    // Lookup local_id → chave (zona_local para vereador, zona_muni_local para deputado)
    const lookupKey = isVereador ? 'vereadorLookup' : 'deputyLookup';
    const lookupCargoKey = isVereador ? 'vereadorLookupCargo' : 'deputyLookupCargo';
    if (!STATE[lookupKey] || STATE[lookupCargoKey] !== currentCargo) {
      const geojsonDep = currentDataCollection[currentCargo];
      if (geojsonDep && geojsonDep.features) {
        STATE[lookupKey] = new Map();
        STATE[lookupCargoKey] = currentCargo;
        geojsonDep.features.forEach(f => {
          const p = f.properties;
          const id = resolveFeatureSelectionId(p);
          const z = getProp(p, 'nr_zona');
          const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
          const m = getProp(p, 'cd_localidade_tse') || getProp(p, 'CD_MUNICIPIO');
          if (id && z && l) {
            const k = isVereador ? `${parseInt(z)}_${parseInt(l)}` : `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;
            STATE[lookupKey].set(id, k);
          }
        });
      }
    }

    // Garante cache de prefixos de partido
    const partyPrefixKey = isVereador ? '_vereadorPartyPrefixCache' : '_partyPrefixCache';
    if (!STATE[partyPrefixKey]) {
      STATE[partyPrefixKey] = {};
      for (const [cid, cmeta] of Object.entries(metaStore || {})) {
        if (cid.length > 2 && cmeta && cmeta[1] && !cmeta[1].toUpperCase().startsWith('PARTIDO ')) {
          const prefix = cid.substring(0, 2);
          if (!STATE[partyPrefixKey][prefix]) STATE[partyPrefixKey][prefix] = cmeta[1];
        }
      }
    }

    const totalVotesByCand = {};
    const processedKeys = new Set();

    const geojsonDep = currentDataCollection[currentCargo];
    const ids = Array.from(selectedLocationIDs);
    const shouldUseFilteredFeatures = ids.length === 0 && geojsonDep?.features?.length;
    const usarTodosVizDeputy = !isVereador && !shouldUseFilteredFeatures && STATE.isFilterAggregationActive &&
      STATE.currentElectionType === 'geral' &&
      currentCidadeFilter === 'all' &&
      ids.length > 100;

    if (usarTodosVizDeputy) {
      for (const [key, locData] of Object.entries(resultStore)) {
        const votes = locData[typeKey];
        if (!votes) continue;
        for (const [cid, v] of Object.entries(votes)) {
          if (cid === '95' || cid === '96') continue;
          totalVotesByCand[cid] = (totalVotesByCand[cid] || 0) + (parseInt(v) || 0);
        }
      }
    } else if (shouldUseFilteredFeatures) {
      const savedPerformanceFilter = performanceFilterMinPct;
      performanceFilterMinPct = 0;

      try {
        geojsonDep.features.forEach((feature) => {
          if (typeof filterFeature === 'function' && !filterFeature(feature)) return;

          const p = feature.properties;
          const z = getProp(p, 'nr_zona');
          const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
          const m = getProp(p, 'cd_localidade_tse') || getProp(p, 'CD_MUNICIPIO');
          if (!z || !l) return;

          const key = isVereador
            ? `${parseInt(z)}_${parseInt(l)}`
            : `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;

          if (!key || processedKeys.has(key)) return;
          processedKeys.add(key);

          const locData = resultStore[key];
          if (!locData) return;
          const votes = locData[typeKey];
          if (!votes) return;

          for (const [cid, v] of Object.entries(votes)) {
            if (cid === '95' || cid === '96') continue;
            totalVotesByCand[cid] = (totalVotesByCand[cid] || 0) + (parseInt(v) || 0);
          }
        });
      } finally {
        performanceFilterMinPct = savedPerformanceFilter;
      }
    } else {
      for (let i = 0; i < ids.length; i++) {
        const key = STATE[lookupKey] ? STATE[lookupKey].get(ids[i]) : null;
        if (!key || processedKeys.has(key)) continue;
        processedKeys.add(key);
        const locData = resultStore[key];
        if (!locData) continue;
        const votes = locData[typeKey];
        if (!votes) continue;
        for (const [cid, v] of Object.entries(votes)) {
          if (cid === '95' || cid === '96') continue;
          totalVotesByCand[cid] = (totalVotesByCand[cid] || 0) + (parseInt(v) || 0);
        }
      }
    }

    deputySearchCandList = Object.entries(metaStore || {})
      .filter(([id]) => totalVotesByCand[id] > 0)
      .filter(([id]) => !(STATE.filterInaptos && inaptosList.includes(id)))
      .map(([id, meta]) => {
        const isLegenda = id.length <= 2;
        let partido = meta[1] || '?';
        let nome = meta[0] || id;
        if (isLegenda) {
          const partidoResolvido = STATE[partyPrefixKey]?.[id];
          if (partidoResolvido) partido = normalizePartyAlias(partidoResolvido.toUpperCase());
          nome = `Voto de Legenda — ${partido}`;
        }
        return { id, nome, partido, status: meta[2] || '', votos: totalVotesByCand[id] || 0, numero: id, isLegenda };
      })
      .sort((a, b) => b.votos - a.votos);

    // Esconde select normal, mostra campo de busca
    dom.selectVizCandidato.style.display = 'none';
    if (deputySearchBox) {
      deputySearchBox.style.display = 'flex';
    }

    // Limpar busca anterior
    if (deputySearchInput) {
      deputySearchInput.value = '';
      deputySearchInput.placeholder = deputySearchCandList.length > 0
        ? `Buscar entre ${deputySearchCandList.length} candidatos (nome ou nº)...`
        : 'Nenhum candidato disponível';
      deputySearchInput.disabled = deputySearchCandList.length === 0;
    }
    if (deputySearchResults) {
      deputySearchResults.innerHTML = '';
      deputySearchResults.classList.remove('visible');
    }

    // Popular o select oculto com o primeiro candidato (fallback)
    if (deputySearchCandList.length > 0) {
      deputySearchCandList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = `${c.nome} (${c.partido})`;
        opt.textContent = `${c.nome} (${c.partido})`;
        opt.dataset.candidateId = c.id;
        dom.selectVizCandidato.appendChild(opt);
      });

      const selectedCandidate = deputySearchCandList.find(c =>
        c.id === previousDeputyId || `${c.nome} (${c.partido})` === previousValue
      ) || deputySearchCandList[0];

      if (selectedCandidate) {
        dom.selectVizCandidato.value = `${selectedCandidate.nome} (${selectedCandidate.partido})`;
        dom.selectVizCandidato.dataset.selectedDeputyId = selectedCandidate.id;
        if (deputySearchInput) deputySearchInput.value = formatVizCandidateLabel(selectedCandidate);
      }
    }

    // Inicializar event listeners para pesquisa (apenas uma vez)
    if (!deputySearchInitialized && deputySearchInput && deputySearchResults) {
      deputySearchInitialized = true;
      setupDeputySearch(deputySearchInput, deputySearchResults);
    }

    return;
  }

  // Não é deputado: esconde search box, mostra select
  dom.selectVizCandidato.style.display = '';
  if (deputySearchBox) deputySearchBox.style.display = 'none';

  // Eleições gerais/municipais: comportamento original
  const candidatos = STATE.candidates[currentCargo]?.[turno] || [];
  candidatos.forEach(key => {
    if (STATE.filterInaptos && (STATE.inaptos[currentCargo]?.[turno] || []).includes(key)) {
      return;
    }
    const cand = parseCandidateKey(key);
    const opt = document.createElement('option');
    opt.value = cand.key;
    opt.textContent = `${cand.nome} (${cand.partido})`;
    dom.selectVizCandidato.appendChild(opt);
  });

  if (dom.selectVizCandidato.options.length > 0) {
    const hasPrevious = Array.from(dom.selectVizCandidato.options).some(opt => opt.value === previousValue);
    dom.selectVizCandidato.value = hasPrevious ? previousValue : dom.selectVizCandidato.options[0].value;
  }
}

// ====== DEPUTY SEARCH LOGIC ======
function setupDeputySearch(input, resultsContainer) {
  const debouncedSearch = debounce((query) => {
    performDeputySearch(query, resultsContainer);
  }, 150);

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (query.length === 0) {
      resultsContainer.innerHTML = '';
      resultsContainer.classList.remove('visible');
      return;
    }
    debouncedSearch(query);
  });

  input.addEventListener('focus', (e) => {
    const query = e.target.value.trim();
    if (query.length === 0) {
      // Mostrar top 15 candidatos mais votados ao focar
      showTopDeputyCandidates(resultsContainer);
    } else {
      performDeputySearch(query, resultsContainer);
    }
  });

  // Fechar resultados ao clicar fora
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#deputySearchBox')) {
      resultsContainer.classList.remove('visible');
    }
  });

  // Navegação por teclado
  input.addEventListener('keydown', (e) => {
    const items = resultsContainer.querySelectorAll('.search-result-item');
    if (items.length === 0) return;

    let currentIdx = -1;
    items.forEach((item, i) => {
      if (item.classList.contains('highlighted')) currentIdx = i;
    });

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items.forEach(i => i.classList.remove('highlighted'));
      const next = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
      items[next].classList.add('highlighted');
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items.forEach(i => i.classList.remove('highlighted'));
      const prev = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
      items[prev].classList.add('highlighted');
      items[prev].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const highlighted = resultsContainer.querySelector('.search-result-item.highlighted');
      if (highlighted) {
        highlighted.click();
      } else if (items.length > 0) {
        items[0].click();
      }
    } else if (e.key === 'Escape') {
      resultsContainer.classList.remove('visible');
      input.blur();
    }
  });
}

function showTopDeputyCandidates(resultsContainer) {
  const top = deputySearchCandList.slice(0, 15);
  renderDeputySearchResults(top, resultsContainer, '');
}

function performDeputySearch(query, resultsContainer) {
  if (!query || deputySearchCandList.length === 0) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('visible');
    return;
  }

  const normalizedQuery = norm(query);
  const isNumericSearch = /^\d+$/.test(query.trim());

  let results;
  if (isNumericSearch) {
    // Busca por número: exata no início
    results = deputySearchCandList.filter(c =>
      c.numero.startsWith(query.trim())
    );
  } else {
    // Busca por nome: normalizada
    results = deputySearchCandList.filter(c => {
      const normalizedName = norm(c.nome);
      const normalizedParty = norm(c.partido);
      return normalizedName.includes(normalizedQuery) || normalizedParty.includes(normalizedQuery);
    });
  }

  // Limitar a 20 resultados
  results = results.slice(0, 20);

  renderDeputySearchResults(results, resultsContainer, query);
}

function renderDeputySearchResults(results, container, query) {
  if (results.length === 0) {
    container.innerHTML = '<div class="search-result-item" style="color:var(--muted); cursor:default; justify-content:center;">Nenhum candidato encontrado</div>';
    container.classList.add('visible');
    return;
  }

  const selectedValue = dom.selectVizCandidato.value;
  const normalizedQuery = query ? norm(query) : '';
  const isNumericSearch = query ? /^\d+$/.test(query.trim()) : false;

  container.innerHTML = results.map((c, idx) => {
    const isSelected = selectedValue === `${c.nome} (${c.partido})`;
    const partyColor = colorForParty(c.partido);

    // Highlight match
    let displayName = toTitleCase(c.nome);
    let displayNumber = c.numero;

    if (query) {
      if (isNumericSearch) {
        // Highlight number match
        const matchLen = query.trim().length;
        displayNumber = `<strong>${c.numero.substring(0, matchLen)}</strong>${c.numero.substring(matchLen)}`;
      } else {
        // Highlight name match
        const nameNorm = norm(c.nome);
        const idx = nameNorm.indexOf(normalizedQuery);
        if (idx !== -1) {
          const original = c.nome;
          displayName = toTitleCase(original.substring(0, idx))
            + '<strong>' + toTitleCase(original.substring(idx, idx + query.length)) + '</strong>'
            + toTitleCase(original.substring(idx + query.length));
        }
      }
    }

    const isLegendaItem = c.isLegenda || (c.id && c.id.length <= 2);
    return `
      <div class="search-result-item ${isSelected ? 'selected' : ''}"
           data-candidate-id="${c.id}"
           style="${isLegendaItem ? `border-left:3px solid ${partyColor};` : ''}">
        <span class="search-result-name" style="${isLegendaItem ? `color:${partyColor}; font-weight:600;` : ''}">${displayName}</span>
        ${!isLegendaItem ? `<span class="search-result-number">${displayNumber}</span>` : ''}
        <span class="search-result-party" style="background:${partyColor}; color:#fff; border:none; font-weight:700; min-width:48px; text-align:center;">${c.partido}</span>
        <span style="font-size:10px; color:var(--muted); white-space:nowrap;">${c.votos.toLocaleString('pt-BR')} v.</span>
      </div>
    `;
  }).join('');

  container.classList.add('visible');

  // Adicionar click listeners
  container.querySelectorAll('.search-result-item[data-candidate-id]').forEach(item => {
    item.addEventListener('click', () => {
      const candId = item.dataset.candidateId;
      if (!candId) return;

      // Encontrar candidato na lista pelo ID
      const candData = deputySearchCandList.find(c => c.id === candId);
      if (!candData) return;

      const selectValue = `${candData.nome} (${candData.partido})`;

      dom.selectVizCandidato.value = selectValue;
      dom.selectVizCandidato.dataset.selectedDeputyId = candData.id;

      const input = document.getElementById('deputySearchInput');
      if (input) {
        const label = candData.isLegenda
          ? `Voto de Legenda — ${candData.partido}`
          : `${toTitleCase(candData.nome)} (${candData.partido}) • Nº ${candData.numero}`;
        input.value = label;
      }

      // Fechar dropdown
      container.classList.remove('visible');

      // Disparar evento de mudança
      dom.selectVizCandidato.dispatchEvent(new Event('change'));
    });
  });
}

// ====== MAP RENDERING ======

// Variável para guardar o listener de movimento
let moveEndListener = null;
let presidentShiftCanvasLayer = null;
let presidentShiftRenderToken = 0;
let PRESIDENT_SHIFT_TOOLTIP_CACHE = new Map();
const PRESIDENT_SHIFT_COLORS = {
  left: '#cf3339',
  right: '#1d7fbd'
};

function getPreviousPresidentRunoffYear(year) {
  const previousByYear = {
    2010: 2006,
    2014: 2010,
    2018: 2014,
    2022: 2018
  };
  return previousByYear[parseInt(year, 10)] || null;
}

function isPresidentShiftMode() {
  return currentVizMode === 'shift_presidente_2t';
}

function isPresidentShiftModeActive() {
  return isPresidentShiftMode()
    && String(currentCargo || '').startsWith('presidente')
    && currentTurno === 2
    && Number.isFinite(parseInt(presidentShiftFromYear, 10))
    && Number.isFinite(parseInt(presidentShiftToYear, 10))
    && parseInt(presidentShiftToYear, 10) !== parseInt(presidentShiftFromYear, 10);
}

function removePresidentShiftOverlay() {
  presidentShiftRenderToken++;
  PRESIDENT_SHIFT_TOOLTIP_CACHE = new Map();
  if (presidentShiftCanvasLayer && map?.hasLayer?.(presidentShiftCanvasLayer)) {
    map.removeLayer(presidentShiftCanvasLayer);
  }
  presidentShiftCanvasLayer = null;
}

function formatShiftPctPoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${(Math.abs(n) * 100).toFixed(1).replace('.', ',')} p.p.`;
}

function formatHistoryTurnPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(1).replace('.', ',')}%`;
}

function getPresidentShiftTooltipHtml(props, shiftInfo = null) {
  const nomeLocalRaw = getProp(props, 'nm_locvot') || 'Local';
  const nomeCidadeRaw = getProp(props, 'nm_localidade') || 'Cidade';
  const nomeLocal = escapeHtml(nomeLocalRaw);
  const nomeCidade = escapeHtml(nomeCidadeRaw);
  if (!isPresidentShiftModeActive() || !shiftInfo) {
    return `
      <div class="basic-map-tooltip">
        <strong>${nomeLocal}</strong>
        <small>${nomeCidade}</small>
      </div>
    `;
  }

  const toLeft = shiftInfo.shift > 0;
  const sideText = toLeft ? 'mais PT' : 'mais PSDB/Bolsonaro';
  const color = toLeft ? PRESIDENT_SHIFT_COLORS.left : PRESIDENT_SHIFT_COLORS.right;
  const current = shiftInfo.currentTurn || {};
  const previous = shiftInfo.previousTurn || {};

  return `
    <div class="shift-tooltip" style="--shift-color:${color}">
      <div class="shift-tooltip-head">
        <strong>${nomeLocal}</strong>
        <small>${nomeCidade}</small>
      </div>
      <div class="shift-tooltip-swing">
        <span class="shift-tooltip-arrow">${toLeft ? '←' : '→'}</span>
        <span><b>${formatShiftPctPoints(shiftInfo.shift)}</b> ${sideText}</span>
      </div>
      <div class="shift-tooltip-results">
        <div class="shift-tooltip-row">
          <span>${escapeHtml(shiftInfo.currentYear)}</span>
          <strong>${escapeHtml(current.vencedor || '-')}</strong>
          <em>${escapeHtml(current.partido || '')}</em>
          <b>${formatHistoryTurnPct(current.pct)}</b>
        </div>
        <div class="shift-tooltip-row muted">
          <span>${escapeHtml(shiftInfo.previousYear)}</span>
          <strong>${escapeHtml(previous.vencedor || '-')}</strong>
          <em>${escapeHtml(previous.partido || '')}</em>
          <b>${formatHistoryTurnPct(previous.pct)}</b>
        </div>
      </div>
    </div>
  `;
}

function getMapFeatureTooltipHtml(props, shiftInfo = null) {
  try {
    if (isPresidentShiftModeActive()) {
      return getPresidentShiftTooltipHtml(props, shiftInfo);
    }

    const nomeLocalRaw = getProp(props, 'nm_locvot') || 'Local';
    const nomeCidadeRaw = getProp(props, 'nm_localidade') || 'Cidade';
    const nomeCidade = escapeHtml(nomeCidadeRaw);
    const renderScrollText = (value, options = {}) => {
      const text = String(value || '').trim() || '-';
      const label = options.titleCase ? toTitleCase(text) : text;
      const escapedLabel = escapeHtml(label);
      const tag = options.tag || 'span';
      const threshold = options.threshold || 30;
      const shouldMarquee = text.length >= threshold;
      const className = `map-tooltip-scroll${shouldMarquee ? ' is-marquee' : ''}`;
      const copy = shouldMarquee ? `<span class="map-tooltip-scroll-copy">${escapedLabel}</span>` : '';
      return `<${tag} class="${className}" title="${escapeAttribute(label)}"><span class="map-tooltip-scroll-track">${escapedLabel}${copy}</span></${tag}>`;
    };

    let metricHtml = '';
    let accentColor = '#2563eb';
    let toneLabel = 'Mapa';

  if (isVictoryMarginMode()) {
    const info = getVictoryMarginInfoForFeature(props);
    if (info) {
      accentColor = info.color || accentColor;
      toneLabel = 'Margem de vitoria';
      const party = info.party ? `<span class="map-tooltip-party">${escapeHtml(info.party)}</span>` : '';
      metricHtml = `
        <div class="map-tooltip-result">
          <div class="map-tooltip-candidate">
            <span class="map-tooltip-dot"></span>
            ${renderScrollText(info.label, { titleCase: true, threshold: 24 })}
            ${party}
          </div>
          <div class="map-tooltip-value">
            <span>Margem</span>
            <b>${formatPctPointsOne(info.marginPct)}</b>
          </div>
        </div>
      `;
    }
  } else if (currentVizMode.startsWith('desempenho')) {
    const info = getPerformanceInfoForFeature(props);
    const candidato = dom.selectVizCandidato?.value || '';
    if (info && candidato) {
      const parsed = parseCandidateKey(candidato);
      accentColor = getColorForCandidate(parsed.nome, parsed.partido);
      toneLabel = 'Desempenho';
      metricHtml = `
        <div class="map-tooltip-result">
          <div class="map-tooltip-candidate">
            <span class="map-tooltip-dot"></span>
            ${renderScrollText(parsed.nome, { titleCase: true, threshold: 24 })}
          </div>
          <div class="map-tooltip-value">
            <span>Votos no local</span>
            <b>${formatPctOne(info.pct)}</b>
          </div>
        </div>
      `;
    }
  } else if (currentVizMode.startsWith('vencedor')) {
    const info = getWinnerLegendInfoForProps(props);
    if (info) {
      accentColor = info.color || accentColor;
      toneLabel = 'Vencedor local';
      metricHtml = `
        <div class="map-tooltip-result compact">
          <div class="map-tooltip-candidate">
            <span class="map-tooltip-dot"></span>
            ${renderScrollText(info.label, { titleCase: true, threshold: 24 })}
          </div>
        </div>
      `;
    }
  } else if (isIseMapMode()) {
    const info = getSocioMapMetricForProps(props);
    if (info) {
      accentColor = getIseMapColor(info);
      toneLabel = info.kind === 'factor' ? (info.groupLabel || 'MÃ©trica') : 'ISE no mapa';
      metricHtml = `
        <div class="map-tooltip-result">
          <div class="map-tooltip-candidate">
            <span class="map-tooltip-dot"></span>
            <span>${info.kind === 'factor' ? info.label : (ISE_MAP_LABELS[info.tercil] || 'Classe')}</span>
          </div>
          <div class="map-tooltip-value">
            <span>${info.valueLabel || 'Valor'}</span>
            <b>${info.kind === 'factor' ? formatSocioMetricValue(info.rawValue, info.factorDef) : info.score.toFixed(1).replace('.', ',')}</b>
          </div>
        </div>
      `;
    }
  }

    return `
      <div class="basic-map-tooltip" style="--tooltip-accent:${accentColor};">
        <div class="map-tooltip-head">
          <div>
            ${renderScrollText(nomeLocalRaw, { tag: 'strong', threshold: 20 })}
            <small>${nomeCidade}</small>
          </div>
          <span class="map-tooltip-mode">${toneLabel}</span>
        </div>
        ${metricHtml}
      </div>
    `;
  } catch (error) {
    const fallbackLocal = escapeHtml(getProp(props, 'nm_locvot') || 'Local');
    const fallbackCidade = escapeHtml(getProp(props, 'nm_localidade') || 'Cidade');
    return `
      <div class="basic-map-tooltip">
        <div class="map-tooltip-head">
          <div>
            <strong>${fallbackLocal}</strong>
            <small>${fallbackCidade}</small>
          </div>
        </div>
      </div>
    `;
  }
}

function createPresidentShiftCanvasLayer() {
  return L.Layer.extend({
    initialize(options = {}) {
      L.setOptions(this, options);
      this._data = [];
      this._redraw = this._redraw.bind(this);
      this._animateZoom = this._animateZoom.bind(this);
    },
    onAdd(targetMap) {
      this._map = targetMap;
      this._canvas = L.DomUtil.create('canvas', 'president-shift-canvas leaflet-zoom-animated');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      this._canvas.style.zIndex = 450;
      this._canvas.style.transformOrigin = '0 0';
      targetMap.getPanes().overlayPane.appendChild(this._canvas);
      this._redraw();
    },
    onRemove(targetMap) {
      if (this._canvas?.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      this._map = null;
    },
    getEvents() {
      const events = {
        resize: this._redraw,
        moveend: this._redraw,
        zoomend: this._redraw
      };
      if (this._map?.options?.zoomAnimation && L.Browser.any3d) {
        events.zoomanim = this._animateZoom;
      }
      return events;
    },
    setData(data) {
      this._data = Array.isArray(data) ? data : [];
      this._redraw();
    },
    _animateZoom(event) {
      if (!this._map || !this._canvas) return;
      const scale = this._map.getZoomScale(event.zoom);
      const offset = this._map._latLngBoundsToNewLayerBounds(
        this._map.getBounds(),
        event.zoom,
        event.center
      ).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },
    _redraw() {
      if (!this._map || !this._canvas) return;
      const size = this._map.getSize();
      const topLeft = this._map.containerPointToLayerPoint([0, 0]);
      if (L.DomUtil.setTransform) {
        L.DomUtil.setTransform(this._canvas, topLeft, 1);
      } else {
        L.DomUtil.setPosition(this._canvas, topLeft);
      }

      const ratio = window.devicePixelRatio || 1;
      this._canvas.width = Math.max(1, Math.round(size.x * ratio));
      this._canvas.height = Math.max(1, Math.round(size.y * ratio));
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;

      const ctx = this._canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      const zoom = this._map.getZoom() || 7;
      const zoomCompact = Math.max(0.58, Math.min(1, 0.58 + ((zoom - 6) * 0.09)));

      (this._data || []).forEach((item) => {
        const point = this._map.latLngToContainerPoint(item.latlng);
        if (point.x < -40 || point.y < -40 || point.x > size.x + 40 || point.y > size.y + 40) return;

        const absShift = Math.abs(item.shift);
        if (!Number.isFinite(absShift) || absShift < 0.002) return;

        const isLeft = item.shift > 0;
        const color = isLeft ? PRESIDENT_SHIFT_COLORS.left : PRESIDENT_SHIFT_COLORS.right;
        const baseLength = Math.max(5, Math.min(20, 4 + (absShift * 58)));
        const length = baseLength * zoomCompact;
        const head = Math.max(3, Math.min(5.8, length * 0.34));
        const lineWidth = Math.max(0.75, Math.min(1.9, 0.75 + (absShift * 4.8))) * zoomCompact;
        const dx = isLeft ? -length : length;
        const dy = -length * 0.28;
        const startX = point.x - dx / 2;
        const startY = point.y - dy / 2;
        const endX = point.x + dx / 2;
        const endY = point.y + dy / 2;
        const angle = Math.atan2(dy, dx);
        const headAngle = Math.PI / 7;

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = Math.max(0.38, Math.min(0.84, 0.38 + absShift * 1.55));
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - head * Math.cos(angle - headAngle),
          endY - head * Math.sin(angle - headAngle)
        );
        ctx.lineTo(
          endX - head * Math.cos(angle + headAngle),
          endY - head * Math.sin(angle + headAngle)
        );
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
  });
}

async function updatePresidentShiftOverlay() {
  if (!isPresidentShiftModeActive() || !currentLayer?.eachLayer || typeof window.resolvePresidentRunoffShiftForProps !== 'function') {
    removePresidentShiftOverlay();
    return;
  }

  const token = ++presidentShiftRenderToken;
  const baseYear = parseInt(presidentShiftFromYear, 10);
  const compareYear = parseInt(presidentShiftToYear, 10);
  const currentYear = Math.max(baseYear, compareYear);
  const previousYear = Math.min(baseYear, compareYear);
  const candidates = [];

  currentLayer.eachLayer((layer) => {
    const props = layer?.feature?.properties;
    const latlng = typeof layer?.getLatLng === 'function' ? layer.getLatLng() : null;
    if (props && latlng) candidates.push({ props, latlng });
  });

  const data = [];
  const tooltipCache = new Map();
  for (let index = 0; index < candidates.length; index++) {
    if (token !== presidentShiftRenderToken) return;
    const item = candidates[index];
    try {
      const shift = await window.resolvePresidentRunoffShiftForProps(item.props, currentYear, previousYear);
      if (shift && Number.isFinite(shift.shift)) {
        const id = resolveFeatureSelectionId(item.props);
        data.push({ latlng: item.latlng, shift: shift.shift });
        if (id) tooltipCache.set(id, shift);
      }
    } catch (error) {
      if (index === 0) console.warn('[Shift presidencial] Histórico indisponível:', error);
    }
  }

  if (token !== presidentShiftRenderToken) return;
  PRESIDENT_SHIFT_TOOLTIP_CACHE = tooltipCache;
  if (!presidentShiftCanvasLayer) {
    const ShiftLayer = createPresidentShiftCanvasLayer();
    presidentShiftCanvasLayer = new ShiftLayer();
  }
  if (!map.hasLayer(presidentShiftCanvasLayer)) presidentShiftCanvasLayer.addTo(map);
  presidentShiftCanvasLayer.setData(data);
}

function applyFiltersAndRedraw() {
  if (typeof resetColorblindAutoPalette === 'function') resetColorblindAutoPalette();
  if (isPresidentShiftMode()) {
    removePresidentShiftOverlay();
  }

  // Limpeza PROFUNDA das camadas
  if (currentLayer) {
    try {
      // Remove todos os event listeners antes de limpar
      currentLayer.off();
      // Limpa todas as sub-camadas
      currentLayer.clearLayers();
      // Remove do mapa
      map.removeLayer(currentLayer);
    } catch (e) {
      console.warn("Erro ao limpar camada:", e);
    }
    currentLayer = null;
  }
  ISE_MAP_SCORE_CACHE = new WeakMap();

  if (moveEndListener) {
    map.off('moveend', moveEndListener);
    moveEndListener = null;
  }

  const geojson = currentDataCollection[currentCargo];
  if (!geojson) {
    removePresidentShiftOverlay();
    updateMapVizLegend();
    return;
  }

  // O renderer canvas do Leaflet pode ter sido desalojado durante trocas
  // rápidas de eleição/cargo. Se ele ficou órfão, recriamos antes de renderizar.
  if (!mapCanvasRenderer || mapCanvasRenderer._map !== map) {
    mapCanvasRenderer = L.canvas({ padding: 0.5, tolerance: 10 });
  }

  // Recalcular estatísticas do candidato se estiver no modo Desempenho
  if (currentVizMode.startsWith('desempenho') && dom.selectVizCandidato?.value) {
    const candidatoKey = dom.selectVizCandidato.value;
    performanceModeStats = calculateCandidateStats(candidatoKey) || {
      candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
    };
    updatePerformanceStatsUI();
  }

  updateAvailabilityBars(geojson);

  // Precomputa vencedores de vereador se necessário
  if (currentCargo.startsWith('vereador') && STATE.vereadorResults && Object.keys(STATE.vereadorResults).length > 0) {
    precomputeVereadorWinners();
  }

  currentLayer = L.geoJSON(geojson, {
    renderer: mapCanvasRenderer,
    pointToLayer: createPointLayer,
    style: getFeatureStyle,
    onEachFeature: onEachFeature,
    filter: filterFeature
  }).addTo(map);

  CURRENT_VISIBLE_FEATURES_CACHE = [];
  CURRENT_VISIBLE_PROPS_CACHE = [];
  currentLayer.eachLayer((layer) => {
    const feature = layer?.feature;
    const props = feature?.properties;
    if (!feature || !props) return;
    CURRENT_VISIBLE_FEATURES_CACHE.push(feature);
    CURRENT_VISIBLE_PROPS_CACHE.push(props);
  });
  updateMapVizLegend();

  // Call ISE Panel update
  if (typeof window.updateISEPanel === 'function') {
    window.updateISEPanel(currentLayer, currentCargo, currentTurno);
  }

  syncResultsPanelToCurrentView();
  updatePresidentShiftOverlay();

  if (STATE.isLoadingDataset) {
    clearPendingFilterChanges();
  }
}



// --- HELPER FUNCTIONS (Extraídas para reaproveitar nos dois modos) ---

function createPointLayer(feature, latlng) {
  return L.circleMarker(latlng, { radius: getPointRadiusForFeature(feature) });
}

const DEFAULT_POINT_FILL_OPACITY = 0.8;
const VICTORY_MARGIN_NEUTRAL = '#ffe873';
const ISE_MAP_COLORS = {
  baixo: '#d8cff2',
  medio: '#8b63c7',
  alto: '#35106f'
};
const ISE_MAP_COLORBLIND_COLORS = {
  baixo: '#d8e7f5',
  medio: '#6d8fc3',
  alto: '#1f3b73'
};
const ISE_MAP_LABELS = {
  baixo: 'Classe baixa',
  medio: 'Classe média',
  alto: 'Classe alta'
};
const SOCIO_METRIC_FALLBACK_COLOR = '#2563eb';
const SOCIO_METRIC_MAX_CURRENCY = 6000;
let ISE_MAP_SCORE_CACHE = new WeakMap();

function isVictoryMarginMode() {
  return currentVizMode === 'margem_vitoria' || currentVizMode.startsWith('margem_vitoria');
}

function isIseMapMode() {
  return currentVizMode === 'ise_mapa' || currentVizMode.startsWith('ise_mapa');
}

function getIseMapPalette() {
  return isColorblindMode ? ISE_MAP_COLORBLIND_COLORS : ISE_MAP_COLORS;
}

function getActiveSocioMapFactor() {
  const state = window.SOCIAL_MAP_STATE || { groupId: 'ise', factorId: 'ise' };
  if (!state || !state.groupId || state.groupId === 'ise') return null;
  const groups = window.SOCIAL_MAP_FACTORS || {};
  const group = groups[state.groupId];
  const factor = group?.factors?.find((item) => item.id === state.factorId);
  if (!group || !factor) return null;
  return { groupId: state.groupId, group, factor };
}

function classifyIseScore(score) {
  if (score <= 30) return 'baixo';
  if (score <= 60) return 'medio';
  return 'alto';
}

function getIseRangeLabel(tercil) {
  if (tercil === 'baixo') return '0-30';
  if (tercil === 'medio') return '30-60';
  return '60-100';
}

function formatSocioMetricValue(value, factorDef = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (factorDef?.isCurrency) {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function getSocioMetricPropVal(props, keys) {
  for (const key of keys || []) {
    const direct = props?.[key];
    if (direct !== undefined && direct !== null && direct !== '') return ensureNumber(String(direct).replace(',', '.'));
    const upper = String(key).toUpperCase();
    for (const propKey in props || {}) {
      if (String(propKey).toUpperCase() === upper) return ensureNumber(String(props[propKey]).replace(',', '.'));
    }
  }
  return 0;
}

function getSocioFactorValueForProps(props, factorDef) {
  if (!props || !factorDef) return -1;
  if (factorDef.id === 'renda_media') {
    const renda = getSocioMetricPropVal(props, factorDef.keys || ['Renda Media', 'RENDA MEDIA', 'renda']);
    return renda > 0 ? renda : -1;
  }
  if (factorDef.id === 'turnout') {
    const stats = typeof window.getFeatureTurnoutStats === 'function'
      ? window.getFeatureTurnoutStats(props, currentCargo, currentTurno)
      : null;
    return stats && stats.pct !== null ? stats.pct : -1;
  }
  if (factorDef.ageRange) {
    const [minAge, maxAge] = factorDef.ageRange;
    let sum = 0;
    let total = 0;
    for (const key in props) {
      if (!/anos/i.test(key) || /^Pct/i.test(key)) continue;
      const value = ensureNumber(props[key]);
      if (value <= 0) continue;
      const match = key.match(/(\d+)/);
      if (!match) continue;
      const age = parseInt(match[1], 10);
      total += value;
      if (age >= minAge && age <= maxAge) sum += value;
    }
    if (total === 0) {
      for (const key in props) {
        if (!String(key).startsWith('Pct ') || !String(key).includes('anos')) continue;
        const value = ensureNumber(props[key]);
        if (value <= 0) continue;
        const match = key.match(/(\d+)/);
        if (!match) continue;
        const age = parseInt(match[1], 10);
        total += value;
        if (age >= minAge && age <= maxAge) sum += value;
      }
    }
    return total > 0 ? (sum / total) * 100 : -1;
  }
  if (factorDef.id === 'mulheres' || factorDef.id === 'homens') {
    const homens = getSocioMetricPropVal(props, ['MASCULINO', 'HOMENS', 'Homens']);
    const mulheres = getSocioMetricPropVal(props, ['FEMININO', 'MULHERES', 'Mulheres']);
    const total = homens + mulheres;
    if (total > 0) return ((factorDef.id === 'mulheres' ? mulheres : homens) / total) * 100;
    const homensPct = getSocioMetricPropVal(props, ['Pct Homens']);
    const mulheresPct = getSocioMetricPropVal(props, ['Pct Mulheres']);
    const totalPct = homensPct + mulheresPct;
    return totalPct > 0 ? ((factorDef.id === 'mulheres' ? mulheresPct : homensPct) / totalPct) * 100 : -1;
  }
  if (['solteiro', 'casado', 'divorciado', 'separado', 'viuvo'].includes(factorDef.id)) {
    const values = {
      solteiro: getSocioMetricPropVal(props, ['SOLTEIRO', 'Solteiro']),
      casado: getSocioMetricPropVal(props, ['CASADO', 'Casado']),
      divorciado: getSocioMetricPropVal(props, ['DIVORCIADO', 'Divorciado']),
      separado: getSocioMetricPropVal(props, ['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado']),
      viuvo: getSocioMetricPropVal(props, ['VIÚVO', 'VIUVO', 'Viúvo', 'Viuvo'])
    };
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    return total > 0 ? (values[factorDef.id] / total) * 100 : -1;
  }
  if (['analfabeto', 'le_escreve', 'fund_incomp', 'fund_comp', 'med_incomp', 'med_comp', 'sup_incomp', 'sup_comp'].includes(factorDef.id)) {
    const values = {
      analfabeto: getSocioMetricPropVal(props, ['ANALFABETO', 'Analfabeto']),
      le_escreve: getSocioMetricPropVal(props, ['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve']),
      fund_incomp: getSocioMetricPropVal(props, ['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO']),
      fund_comp: getSocioMetricPropVal(props, ['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO']),
      med_incomp: getSocioMetricPropVal(props, ['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO']),
      med_comp: getSocioMetricPropVal(props, ['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO']),
      sup_incomp: getSocioMetricPropVal(props, ['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO']),
      sup_comp: getSocioMetricPropVal(props, ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo'])
    };
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    return total > 0 ? (values[factorDef.id] / total) * 100 : -1;
  }
  const value = getSocioMetricPropVal(props, factorDef.keys || []);
  return value >= 0 ? value : -1;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseHexColor(hex) {
  let value = String(hex || '').trim();
  if (!value.startsWith('#')) return null;
  if (value.length === 4) {
    value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  const num = parseInt(value.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (channel) => Math.round(clampNumber(channel, 0, 255)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixRgb(a, b, t) {
  const ratio = clampNumber(t, 0, 1);
  return {
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio
  };
}

function getSocioMetricPalette(metricInfo = null) {
  const baseColor = getSocioMetricBaseColor(metricInfo);
  return {
    baixo: getSocioMetricGradientColor(baseColor, 12),
    medio: getSocioMetricGradientColor(baseColor, 50),
    alto: getSocioMetricGradientColor(baseColor, 92)
  };
}

function getSocioMetricBaseColor(metricInfo = null) {
  if (isColorblindMode) return '#2563eb';
  if (!metricInfo || metricInfo.kind === 'ise') return '#7c3aed';
  return metricInfo.groupColor || SOCIO_METRIC_FALLBACK_COLOR;
}

function getSocioMetricGradientColor(baseColorHex, pct) {
  if (typeof getUniversalGradientColor === 'function') {
    return getUniversalGradientColor(baseColorHex, pct);
  }

  const base = parseHexColor(baseColorHex) || parseHexColor(SOCIO_METRIC_FALLBACK_COLOR);
  const white = { r: 255, g: 255, b: 255 };
  const dark = { r: 30, g: 30, b: 35 };
  const value = clampNumber(pct, 0, 100);
  if (value < 50) {
    return rgbToHex(mixRgb(white, base, value / 50));
  }
  return rgbToHex(mixRgb(base, dark, (value - 50) / 50));
}

function getVictoryMarginColor(baseColorHex, marginPct) {
  const base = parseHexColor(baseColorHex);
  const neutral = parseHexColor(VICTORY_MARGIN_NEUTRAL);
  if (!base || !neutral) return baseColorHex || DEFAULT_SWATCH;

  const margin = clampNumber(marginPct, 0, 65);
  const towardWinner = Math.pow(clampNumber(margin / 35, 0, 1), 1.12);
  const narrowMarginTint = mixRgb(neutral, base, 0.34);
  let color = mixRgb(narrowMarginTint, base, towardWinner);

  if (margin > 35) {
    const darken = clampNumber((margin - 35) / 30, 0, 1) * 0.38;
    color = mixRgb(color, { r: 28, g: 28, b: 32 }, darken);
  }

  return rgbToHex(color);
}

function getVictoryMarginPct(winnerVotes, runnerUpVotes, totalVotes) {
  const total = Number(totalVotes) || 0;
  if (total <= 0) return 0;
  const marginVotes = Math.max(0, (Number(winnerVotes) || 0) - (Number(runnerUpVotes) || 0));
  return (marginVotes / total) * 100;
}

function formatPctOne(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function formatPctPointsOne(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(1).replace('.', ',')} p.p.`;
}

function getIseMapScoreForProps(props) {
  if (!props) return null;
  if (ISE_MAP_SCORE_CACHE.has(props)) {
    const cached = ISE_MAP_SCORE_CACHE.get(props);
    if (cached) cached.tercil = classifyIseScore(cached.score);
    return cached;
  }

  const read = (keys) => {
    for (const key of keys) {
      const val = getProp(props, key);
      if (val !== null && val !== undefined && val !== '') return ensureNumber(val);
    }
    return 0;
  };

  const renda = read(['Renda Media', 'RENDA MEDIA', 'renda']);
  if (renda <= 0) {
    ISE_MAP_SCORE_CACHE.set(props, null);
    return null;
  }

  const esgGeral = read(['Pct Esgoto Rede Geral']);
  const esgFossa = read(['Pct Fossa Septica', 'Pct Fossa Séptica']);
  const esgInad = read(['Pct Esgoto Inadequado']);
  const esgTotal = esgGeral + esgFossa + esgInad;
  const esgotoFinal = esgTotal > 0 ? (esgGeral / esgTotal) * 100 : esgGeral;

  const supComp = read(['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo']);
  const analf = read(['ANALFABETO', 'Analfabeto']);
  const le = read(['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve']);
  const fi = read(['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO']);
  const fc = read(['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO']);
  const mi = read(['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO']);
  const mc = read(['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO']);
  const si = read(['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO']);
  const totalEsc = supComp + analf + le + fi + fc + mi + mc + si;
  const pctSup = totalEsc > 0 ? (supComp / totalEsc) * 100 : 0;

  let idade25_59 = 0;
  let totalIdade = 0;
  for (const key in props) {
    if (!/anos/i.test(key) || /^Pct/i.test(key)) continue;
    const value = ensureNumber(props[key]);
    if (value <= 0) continue;
    const match = key.match(/(\d+)/);
    if (!match) continue;
    const age = parseInt(match[1], 10);
    totalIdade += value;
    if (age >= 25 && age <= 59) idade25_59 += value;
  }
  const pctIdade = totalIdade > 0 ? (idade25_59 / totalIdade) * 100 : 0;

  const nRenda = Math.min((renda / 6000) * 100, 100);
  const score = clampNumber((nRenda * 0.40) + (pctSup * 0.40) + (esgotoFinal * 0.15) + (pctIdade * 0.05), 0, 100);
  const tercil = classifyIseScore(score);
  const result = { score, tercil, renda, pctSup, esgotoFinal, pctIdade };
  ISE_MAP_SCORE_CACHE.set(props, result);
  return result;
}

function getSocioMapMetricForProps(props) {
  const factorSelection = getActiveSocioMapFactor();
  if (!factorSelection) {
    const iseInfo = getIseMapScoreForProps(props);
    return iseInfo ? { ...iseInfo, kind: 'ise', label: 'Índice ISE', valueLabel: 'Nota ISE' } : null;
  }

  const { group, factor } = factorSelection;
  const value = getSocioFactorValueForProps(props, factor);
  if (!Number.isFinite(Number(value)) || Number(value) < 0) return null;

  const score = factor.isCurrency
    ? clampNumber((Number(value) / SOCIO_METRIC_MAX_CURRENCY) * 100, 0, 100)
    : clampNumber(Number(value), 0, 100);
  const tercil = score <= 33.333 ? 'baixo' : (score <= 66.666 ? 'medio' : 'alto');

  return {
    kind: 'factor',
    score,
    rawValue: Number(value),
    tercil,
    label: factor.label,
    groupLabel: group.label,
    groupColor: group.color,
    factorDef: factor,
    valueLabel: factor.isCurrency ? 'Valor' : 'Percentual'
  };
}

function getIseMapColor(scoreInfo) {
  if (!scoreInfo) return '#9ca3af';
  return getSocioMetricGradientColor(getSocioMetricBaseColor(scoreInfo), scoreInfo.score);
}

function getVictoryMarginInfoForFeature(props) {
  if (!props) return null;

  if (currentCargo.startsWith('vereador')) {
    const data = getVereadorFeatureData(props);
    if (!data || data.total <= 0) return null;
    if (STATE.vereadorViewMode === 'party' && data.winningParty) {
      return {
        label: data.winningParty,
        party: data.winningParty,
        color: colorForParty(data.winningParty),
        marginPct: getVictoryMarginPct(data.winningPartyVotes, data.runnerUpPartyVotes, data.total)
      };
    }
    if (!data.winner) return null;
    const meta = STATE.vereadorMetadata[data.winner] || [];
    const label = meta[0] || data.winner;
    const party = meta[1] || '';
    return {
      label,
      party,
      color: getColorForCandidate(label, party),
      marginPct: getVictoryMarginPct(data.winnerVotes, data.runnerUpVotes, data.total)
    };
  }

  if (currentCargo.startsWith('deputado')) {
    const data = getDeputyFeatureData(props);
    if (!data || data.total <= 0) return null;
    if (STATE.deputyViewMode === 'party' && data.winningParty) {
      return {
        label: data.winningParty,
        party: data.winningParty,
        color: colorForParty(data.winningParty),
        marginPct: getVictoryMarginPct(data.winningPartyVotes, data.runnerUpPartyVotes, data.total)
      };
    }
    if (!data.winner) return null;
    const meta = STATE.deputyMetadata[data.winner] || [];
    const label = meta[0] || data.winner;
    const party = meta[1] || '';
    return {
      label,
      party,
      color: getColorForCandidate(label, party),
      marginPct: getVictoryMarginPct(data.winnerVotes, data.runnerUpVotes, data.total)
    };
  }

  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);
  if (totalValidos <= 0) return null;
  const { vencedor, segundo } = getTopTwoCandidates(props, currentCargo, turnoKey, STATE.filterInaptos);
  const color = getColorForCandidate(vencedor.nome, vencedor.partido);
  return {
    label: vencedor.nome,
    party: vencedor.partido,
    color,
    marginPct: getVictoryMarginPct(vencedor.votos, segundo.votos, totalValidos)
  };
}

function getPerformanceInfoForFeature(props) {
  if (!props || !currentVizMode.startsWith('desempenho')) return null;
  const candidato = dom.selectVizCandidato?.value;
  if (!candidato) return null;

  if (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador')) {
    const data = currentCargo.startsWith('vereador')
      ? getVereadorFeatureData(props)
      : getDeputyFeatureData(props);
    if (!data || data.total <= 0 || !data.votes) return null;
    const candId = getResolvedVisualizationCandidateId(candidato, currentCargo);
    const votos = candId ? getCandidateVotesForVisualization(data.votes, candId) : null;
    if (votos === null) return null;
    return { pct: (votos / data.total) * 100 };
  }

  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);
  if (totalValidos <= 0) return null;
  return { pct: (ensureNumber(getProp(props, candidato)) / totalValidos) * 100 };
}

function getWinnerLegendInfoForProps(props) {
  if (!props) return null;
  if (currentCargo.startsWith('vereador')) {
    const data = getVereadorFeatureData(props);
    if (!data || data.total <= 0) return null;
    if (STATE.vereadorViewMode === 'party' && data.winningParty) {
      return { label: data.winningParty, color: colorForParty(data.winningParty) };
    }
    if (!data.winner) return null;
    const meta = STATE.vereadorMetadata[data.winner] || [];
    const label = meta[0] || data.winner;
    return { label, color: getColorForCandidate(label, meta[1] || '') };
  }
  if (currentCargo.startsWith('deputado')) {
    const data = getDeputyFeatureData(props);
    if (!data || data.total <= 0) return null;
    if (STATE.deputyViewMode === 'party' && data.winningParty) {
      return { label: data.winningParty, color: colorForParty(data.winningParty) };
    }
    if (!data.winner) return null;
    const meta = STATE.deputyMetadata[data.winner] || [];
    const label = meta[0] || data.winner;
    return { label, color: getColorForCandidate(label, meta[1] || '') };
  }
  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const winner = getVencedor(props, currentCargo, turnoKey, STATE.filterInaptos);
  if (!winner || !winner.nome || winner.nome === 'N/D') return null;
  return { label: winner.nome, color: getColorForCandidate(winner.nome, winner.partido) };
}

function updateMapVizLegend() {
  const legend = document.getElementById('mapVizLegend');
  if (!legend) return;
  updateMapVizLegendPosition(legend);

  if (!currentLayer || isPresidentShiftModeActive()) {
    legend.hidden = true;
    legend.innerHTML = '';
    return;
  }

  const propsList = CURRENT_VISIBLE_PROPS_CACHE || [];
  if (isVictoryMarginMode()) {
    const sample = propsList.map(getVictoryMarginInfoForFeature).find(Boolean);
    const sampleColor = sample?.color || '#2563eb';
    const narrowColor = getVictoryMarginColor(sampleColor, 2);
    const midColor = getVictoryMarginColor(sampleColor, 16);
    const highColor = getVictoryMarginColor(sampleColor, 45);
    legend.hidden = false;
    legend.innerHTML = `
      <div class="map-viz-legend-title">Margem de vitoria</div>
      <div class="map-viz-legend-note">A cor indica o vencedor; a intensidade indica a vantagem sobre o 2o colocado.</div>
      <div class="map-viz-legend-scale" style="--legend-gradient:linear-gradient(90deg, ${narrowColor}, ${midColor}, ${highColor});"></div>
      <div class="map-viz-legend-labels">
        <span>Estreita</span>
        <span>Ampla</span>
      </div>
      <div class="map-viz-legend-items margin-items">
        <span class="map-viz-legend-item">
          <span class="map-viz-legend-swatch" style="--swatch:${narrowColor};"></span>
          <span>Estreita &lt;5 p.p.</span>
        </span>
        <span class="map-viz-legend-item">
          <span class="map-viz-legend-swatch" style="--swatch:${midColor};"></span>
          <span>Moderada</span>
        </span>
        <span class="map-viz-legend-item">
          <span class="map-viz-legend-swatch" style="--swatch:${highColor};"></span>
          <span>Ampla &gt;30 p.p.</span>
        </span>
      </div>
    `;
    return;
  }

  if (currentVizMode.startsWith('desempenho') && performanceModeStats.candidato) {
    const candidato = dom.selectVizCandidato?.value || '';
    const parsed = parseCandidateKey(candidato);
    const baseColor = getColorForCandidate(parsed.nome, parsed.partido);
    const min = performanceModeStats.minPct || 0;
    const max = performanceModeStats.maxPct || 0;
    const gradientStops = [10, 35, 60, 85]
      .map((pct) => `${getUniversalGradientColor(baseColor, pct)} ${pct}%`)
      .join(', ');
    legend.hidden = false;
    legend.innerHTML = `
      <div class="map-viz-legend-title">Desempenho do candidato</div>
      <div class="map-viz-legend-note">Locais mais escuros concentram maior percentual do candidato selecionado.</div>
      <div class="map-viz-legend-scale" style="--legend-gradient:linear-gradient(90deg, ${gradientStops});"></div>
      <div class="map-viz-legend-labels">
        <span>${formatPctOne(min)}</span>
        <span>${formatPctOne(max)}</span>
      </div>
    `;
    return;
  }

  if (isIseMapMode()) {
    const activeFactor = getActiveSocioMapFactor();
    const legendMetric = activeFactor
      ? {
        kind: 'factor',
        label: activeFactor.factor.label,
        groupLabel: activeFactor.group.label,
        groupColor: activeFactor.group.color,
        factorDef: activeFactor.factor
      }
      : { kind: 'ise', label: 'Índice ISE' };
    const palette = getSocioMetricPalette(legendMetric);
    const isFactor = legendMetric.kind === 'factor';
    legend.hidden = false;
    legend.innerHTML = `
      <div class="map-viz-legend-title">${isFactor ? legendMetric.label : 'ISE no mapa'}</div>
      <div class="map-viz-legend-note">${isFactor ? `Locais coloridos por ${legendMetric.groupLabel.toLowerCase()} no eleitorado.` : 'Modo experimental: locais coloridos pela nota socioeconômica composta (0-100).'}</div>
      <div class="map-viz-legend-scale" style="--legend-gradient:linear-gradient(90deg, ${palette.baixo}, ${palette.medio}, ${palette.alto});"></div>
      <div class="map-viz-legend-labels">
        <span>${isFactor ? 'Menor' : 'Baixa'}</span>
        <span>${isFactor ? 'Médio' : 'Média'}</span>
        <span>${isFactor ? 'Maior' : 'Alta'}</span>
      </div>
      <div class="map-viz-legend-items margin-items">
        <span class="map-viz-legend-item"><span class="map-viz-legend-swatch" style="--swatch:${palette.baixo};"></span><span>${isFactor ? formatSocioMetricValue(0, legendMetric.factorDef) : getIseRangeLabel('baixo')}</span></span>
        <span class="map-viz-legend-item"><span class="map-viz-legend-swatch" style="--swatch:${palette.medio};"></span><span>${isFactor ? formatSocioMetricValue(legendMetric.factorDef?.isCurrency ? SOCIO_METRIC_MAX_CURRENCY / 2 : 50, legendMetric.factorDef) : getIseRangeLabel('medio')}</span></span>
        <span class="map-viz-legend-item"><span class="map-viz-legend-swatch" style="--swatch:${palette.alto};"></span><span>${isFactor ? `${formatSocioMetricValue(legendMetric.factorDef?.isCurrency ? SOCIO_METRIC_MAX_CURRENCY : 100, legendMetric.factorDef)}+` : getIseRangeLabel('alto')}</span></span>
      </div>
    `;
    return;
    legend.innerHTML = `
      <div class="map-viz-legend-title">ISE no mapa</div>
      <div class="map-viz-legend-note">Modo experimental: locais coloridos pela nota socioeconômica composta (0-100).</div>
      <div class="map-viz-legend-scale" style="--legend-gradient:linear-gradient(90deg, ${palette.baixo}, ${palette.medio}, ${palette.alto});"></div>
      <div class="map-viz-legend-labels">
        <span>Baixa</span>
        <span>Média</span>
        <span>Alta</span>
      </div>
      <div class="map-viz-legend-items margin-items">
        <span class="map-viz-legend-item"><span class="map-viz-legend-swatch" style="--swatch:${palette.baixo};"></span><span>${getIseRangeLabel('baixo')}</span></span>
        <span class="map-viz-legend-item"><span class="map-viz-legend-swatch" style="--swatch:${palette.medio};"></span><span>${getIseRangeLabel('medio')}</span></span>
        <span class="map-viz-legend-item"><span class="map-viz-legend-swatch" style="--swatch:${palette.alto};"></span><span>${getIseRangeLabel('alto')}</span></span>
      </div>
    `;
    return;
  }

  legend.hidden = true;
  legend.innerHTML = '';
}

function updateMapVizLegendPosition(legend = document.getElementById('mapVizLegend')) {
  if (!legend || !map) return;
  const rightPanel = document.getElementById('sideRightPanel');
  const mapPanel = document.getElementById('mapPanel');
  if (!rightPanel || !mapPanel || rightPanel.classList.contains('panel-collapsed')) {
    legend.style.setProperty('--map-legend-right', '14px');
    return;
  }

  const panelRect = rightPanel.getBoundingClientRect();
  const mapRect = mapPanel.getBoundingClientRect();
  const overlapsMap = panelRect.width > 0 && panelRect.left < mapRect.right && panelRect.right > mapRect.left;
  const rightOffset = overlapsMap ? Math.max(14, mapRect.right - panelRect.left + 14) : 14;
  legend.style.setProperty('--map-legend-right', `${Math.round(rightOffset)}px`);
}

window.refreshSocioMetricMap = function () {
  ISE_MAP_SCORE_CACHE = new WeakMap();
  if (currentLayer && isIseMapMode()) {
    currentLayer.eachLayer((layer) => {
      if (layer?.feature && typeof layer.setStyle === 'function') {
        layer.setStyle(getFeatureStyle(layer.feature));
      }
    });
  }
  updateMapVizLegend();
};

function getPointRadiusForFeature(feature) {
  let radius = 7;

  if (currentVizSize === 'comparecimento') {
    const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
    let comparecimento = getFeatureComparecimentoCount(feature.properties, currentCargo, turnoKey);

    // Fallback para cargos com 2o turno quando o turno ativo nao tiver comparecimento mapeado.
    if (comparecimento === 0 && STATE.dataHas2T[currentCargo]) {
      const fallbackTurnoKey = turnoKey === '2T' ? '1T' : '2T';
      comparecimento = getFeatureComparecimentoCount(feature.properties, currentCargo, fallbackTurnoKey);
    }

    const logComp = Math.log10(Math.max(1, comparecimento));
    let pctLog = (logComp - 2) / (4 - 2);
    pctLog = Math.max(0, Math.min(1, pctLog));
    radius = 3 + (8 * pctLog);
  }

  return radius;
}

function shouldFullRedrawOnTurnChange() {
  return currentVizMode.startsWith('desempenho') && performanceFilterMinPct > 0;
}

function refreshTurnDependentUI() {
  if (!currentDataCollection[currentCargo]) return;

  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';

  if (currentVizMode.startsWith('desempenho')) {
    populateVizCandidatoDropdown(turnoKey);
  }

  if (shouldFullRedrawOnTurnChange()) {
    applyFiltersAndRedraw();
    return;
  }

  if (currentVizMode.startsWith('desempenho') && dom.selectVizCandidato?.value) {
    const candidatoKey = dom.selectVizCandidato.value;
    performanceModeStats = calculateCandidateStats(candidatoKey) || {
      candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
    };
    updatePerformanceStatsUI();
  }

  if (currentLayer?.eachLayer) {
    currentLayer.eachLayer((layer) => {
      const feature = layer?.feature;
      if (!feature) return;

      if (typeof layer.setStyle === 'function') {
        layer.setStyle(getFeatureStyle(feature));
      }

      if (typeof layer.setRadius === 'function') {
        layer.setRadius(getPointRadiusForFeature(feature));
      }
    });
  }

  if (typeof window.updateISEPanel === 'function') {
    window.updateISEPanel(currentLayer, currentCargo, currentTurno);
  }

  syncResultsPanelToCurrentView();
  updatePresidentShiftOverlay();
  updateMapVizLegend();
}


function filterFeature(feature) {
  const props = feature.properties;

  // Filtro de Presídios/Locais Especiais (Exclusão Global)
  const nomeLocalForExclusion = norm(getProp(props, 'nm_locvot'));
  const exclusoes = ['PRISAO', 'PENITENCIARIA', 'PENINTENCIARI', 'DETENCAO', 'INTERNATO', 'CDP ', 'PRESIDIO', 'FUNDACAO CASA', 'FUND. CASA', 'UI-', 'UNID. DE INT', 'PENAL'];
  for (let kw of exclusoes) {
    if (nomeLocalForExclusion.includes(kw)) {
      return false;
    }
  }

  // Filtro de 2T Vazio
  // Filtro de 2T Vazio
  let comparecimento_1t = 0;

  comparecimento_1t = getFeatureComparecimentoCount(props, currentCargo, '1T');

  if (comparecimento_1t === 0) {
    if (STATE.dataHas2T[currentCargo] && !currentCargo.startsWith('deputado')) {
      const comparecimento_2t = getFeatureComparecimentoCount(props, currentCargo, '2T');
      if (comparecimento_2t === 0) return false;
    } else {
      return false;
    }
  }

  if (!matchesLocationFilters(props)) return false;

  // --- FILTRO DE DESEMPENHO (porcentagem mínima) ---
  if (currentVizMode.startsWith('desempenho') && performanceFilterMinPct > 0) {
    const candidatoKey = dom.selectVizCandidato?.value;
    if (candidatoKey) {
      if (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador')) {
        const isVereador = currentCargo.startsWith('vereador');
        const typeKey = isVereador ? 'v' : (currentCargo.includes('estadual') ? 'e' : 'f');
        const candId = getResolvedVisualizationCandidateId(candidatoKey, currentCargo);
        if (candId) {
          const z = parseInt(getProp(props, 'nr_zona'));
          const l = parseInt(getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao'));
          const m = parseInt(getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO'));
          const hasValidKey = !isNaN(z) && !isNaN(l) && (isVereador || !isNaN(m));
          if (hasValidKey) {
            const resultKey = isVereador ? `${z}_${l}` : `${z}_${m}_${l}`;
            const resultStore = isVereador ? STATE.vereadorResults : STATE.deputyResults;
            const allRes = resultStore[resultKey];
            const votes = allRes?.[typeKey];
            if (votes) {
              let total = 0;
              for (const [cid, v] of Object.entries(votes)) {
                if (cid !== '95' && cid !== '96') total += parseInt(v) || 0;
              }
              if (total > 0) {
                const candidateVotes = getCandidateVotesForVisualization(votes, candId) || 0;
                const pctCand = (candidateVotes / total) * 100;
                if (pctCand < performanceFilterMinPct) return false;
              }
            }
          }
        }
      } else {
        const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
        const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);
        if (totalValidos > 0) {
          const votosCand = ensureNumber(getProp(props, candidatoKey));
          const pctCand = (votosCand / totalValidos) * 100;
          if (pctCand < performanceFilterMinPct) return false;
        }
      }
    }
  }

  // --- FILTROS CENSITÁRIOS ---

  // 1. Renda (Direto)
  const renda = ensureNumber(getProp(props, 'Renda Media'));
  if (STATE.censusFilters.rendaMin !== null && renda < STATE.censusFilters.rendaMin) return false;
  if (STATE.censusFilters.rendaMax !== null && renda > STATE.censusFilters.rendaMax) return false;


  // Helper para somar chaves variadas
  const getVal = (candidates) => {
    for (const key of candidates) {
      if (props[key] !== undefined) return ensureNumber(props[key]);

      const upperKey = String(key).toUpperCase();
      for (const propKey in props) {
        if (String(propKey).toUpperCase() === upperKey) {
          return ensureNumber(props[propKey]);
        }
      }
    }

    return 0;
  };

  const ageGenderOrder = [
    ['16-24', 0], ['16-24', 1], ['16-24', 2], ['16-24', 3], ['16-24', 4],
    ['16-24', 5], ['25-34', 6], ['25-34', 7], ['35-44', 8], ['35-44', 9],
    ['45-59', 10], ['45-59', 11], ['45-59', 12], ['60-74', 13], ['60-74', 14],
    ['60-74', 15], ['75-100', 16], ['75-100', 17], ['75-100', 18],
    ['75-100', 19], ['75-100', 20], ['75-100', 21]
  ];
  const educationGenderModes = {
    'Analfabeto': 0,
    'Lê e Escreve': 1,
    'Fund. Incomp.': 2,
    'Fund. Completo': 3,
    'Médio Incomp.': 4,
    'Médio Completo': 5,
    'Superior Incompleto': 6,
    'Superior Completo': 7
  };

  const calcAgeGenderPct = (mode, gender) => {
    if (gender === 'total') return null;
    const data = props.IDADE_GENERO;
    if (!data || !Array.isArray(data.M) || !Array.isArray(data.F)) return null;

    let num = 0;
    let den = 0;
    for (const [bucket, index] of ageGenderOrder) {
      const male = ensureNumber(data.M[index]);
      const female = ensureNumber(data.F[index]);
      den += male + female;
      if (bucket === mode) num += gender === 'F' ? female : male;
    }
    if (den < 10) return null;
    return (num / den) * 100;
  };

  const calcEducationGenderPct = (mode, gender) => {
    if (gender === 'total') return null;
    const data = props.ESCOLARIDADE_GENERO;
    if (!data || !Array.isArray(data.M) || !Array.isArray(data.F)) return null;

    const index = educationGenderModes[mode];
    if (index === undefined) return null;

    const den = data.M.reduce((sum, value) => sum + ensureNumber(value), 0)
      + data.F.reduce((sum, value) => sum + ensureNumber(value), 0);
    if (den < 10) return null;

    const num = gender === 'F' ? ensureNumber(data.F[index]) : ensureNumber(data.M[index]);
    return (num / den) * 100;
  };

  // Helper de checagem genérica Pct ou Absoluto Calculado
  const checkDynamic = (filterVal, filterMode, type) => {
    if (filterVal === null) return true;

    // Se for Modo Legacy (2006) ou se o dado já vier como Pct explícito:
    // (Ainda precisamos suportar Pct direto para Raça e Saneamento)

    // Raça & Saneamento (Sempre Pct)
    if (type === 'raca' || type === 'saneamento') {
      const propVal = ensureNumber(getProp(props, filterMode));
      return propVal >= filterVal;
    }

    // Para Gênero, Idade, Escolaridade, Civil: Calcular dinamicamente
    let numerator = 0;
    let denominator = 0;

    // Gênero
    if (type === 'genero') {
      const h = getVal(['MASCULINO', 'HOMENS', 'Homens', 'Pct Homens']);
      const m = getVal(['FEMININO', 'MULHERES', 'Mulheres', 'Pct Mulheres']);

      // Fallback para legacy Pct direto se não tiver absoluto
      // Se tiver Pct Homens e Pct Mulheres, getVal retornará eles.
      // Se for Pct, a soma deve ser ~100 (ou perto). Se for Absoluto, soma é pop.

      const total = h + m;
      if (total === 0) return false;

      // Se for Pct, total é ~100.
      // filterVal é 0-100.

      // 'Pct Mulheres' vs 'Pct Homens'
      if (filterMode === 'Pct Mulheres') numerator = m;
      else numerator = h;

      const pct = (numerator / total) * 100;
      return pct >= filterVal;
    }

    // Estado Civil
    else if (type === 'estadocivil') {
      const s = getVal(['SOLTEIRO', 'Solteiro', 'Pct Solteiro']);
      const c = getVal(['CASADO', 'Casado', 'Pct Casado']);
      const d = getVal(['DIVORCIADO', 'Divorciado', 'Pct Divorciado']);
      const v = getVal(['VIÚVO', 'VIUVO', 'Viúvo', 'Pct Viúvo']);
      const sep = getVal(['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado', 'Pct Separado']);

      // Detecção de Modo Percentual (Legacy)
      // Se a soma for significativamente < da população total esperada (em absolutos) ou se for ~100
      // Mas melhor: verificar se usamos keys de Pct
      const isPct = (props['Pct Solteiro'] !== undefined || props['Pct Casado'] !== undefined);

      let den;
      let num;

      if (isPct) den = 100;
      else den = s + c + d + v + sep;

      if (den === 0) return false;

      if (filterMode === 'Solteiro') num = s;
      else if (filterMode === 'Casado') num = c;
      else if (filterMode === 'Divorciado') num = d;
      else if (filterMode === 'Viúvo') num = v;
      else num = sep;

      return (num / den * 100) >= filterVal;
    }
    else if (type === 'escolaridade') {
      const educationGenderMode = STATE.censusFilters.escolaridadeGeneroMode || 'total';
      if (educationGenderMode !== 'total') {
        const scopedPct = calcEducationGenderPct(filterMode, educationGenderMode);
        return scopedPct !== null && scopedPct >= filterVal;
      }

      const ana = getVal(['ANALFABETO', 'Analfabeto', 'Pct Analfabeto']);
      const le = getVal(['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve', 'Pct Lê e Escreve']);
      const fi = getVal(['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO', 'Pct Fundamental Incompleto']);
      const fc = getVal(['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO', 'Pct Fundamental Completo']);
      const mi = getVal(['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO', 'Pct Médio Incompleto']);
      const mc = getVal(['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO', 'Pct Médio Completo']);
      const si = getVal(['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO', 'Pct Superior Incompleto']);
      const sc = getVal(['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Pct Superior Completo']);

      const isPct = (props['Pct Analfabeto'] !== undefined || props['Pct Médio Completo'] !== undefined);

      let den;
      let num;

      if (isPct) den = 100;
      else den = ana + le + fi + fc + mi + mc + si + sc;

      if (den === 0) return false;

      if (filterMode.includes('Analfabeto')) num = ana;
      else if (filterMode.includes('Lê')) num = le;
      else if (filterMode === 'Fund. Incomp.') num = fi;
      else if (filterMode === 'Fund. Completo') num = fc;
      else if (filterMode === 'Médio Incomp.') num = mi;
      else if (filterMode === 'Médio Completo') num = mc;
      else if (filterMode === 'Superior Incompleto') num = si;
      else if (filterMode === 'Superior Completo') num = sc;

      return (num / den * 100) >= filterVal;
    }

    // Idade
    if (type === 'idade') {
      const ageGenderMode = STATE.censusFilters.idadeGeneroMode || 'total';
      if (ageGenderMode !== 'total') {
        const scopedPct = calcAgeGenderPct(filterMode, ageGenderMode);
        return scopedPct !== null && scopedPct >= filterVal;
      }

      // Calcular buckets
      let buckets = { '16-24': 0, '25-34': 0, '35-44': 0, '45-59': 0, '60-74': 0, '75-100': 0 };
      let totalAge = 0;

      // Varredura para montar buckets desta feature
      for (const key in props) {
        if (key.match(/anos/i) && !key.match(/^Pct/i)) {
          const v = ensureNumber(props[key]);
          if (v === 0) continue;
          const match = key.match(/(\d+)/);
          if (match) {
            const age = parseInt(match[1]);
            totalAge += v;
            if (age >= 16 && age <= 24) buckets['16-24'] += v;
            else if (age >= 25 && age <= 34) buckets['25-34'] += v;
            else if (age >= 35 && age <= 44) buckets['35-44'] += v;
            else if (age >= 45 && age <= 59) buckets['45-59'] += v;
            else if (age >= 60 && age <= 74) buckets['60-74'] += v;
            else if (age >= 75) buckets['75-100'] += v;
          }
        } else if (key.startsWith('Pct ') && key.includes('anos')) {
          // Tratamento Legacy Pct
          // Se cair aqui, totalAge será soma de PCTS (~100).
          // filterMode será comparado com a soma das PCTs do bucket.
          const val = ensureNumber(props[key]);
          const match = key.match(/(\d+)/);
          if (match) {
            const age = parseInt(match[1]);
            // buckets... (simplificado, mas ok se assumirmos que ou tem absoluto ou tem pct)
            totalAge += val; // Isso vai dar ~100
            if (age >= 16 && age <= 24) buckets['16-24'] += val;
            else if (age >= 25 && age <= 34) buckets['25-34'] += val;
            else if (age >= 35 && age <= 44) buckets['35-44'] += val;
            else if (age >= 45 && age <= 59) buckets['45-59'] += val;
            else if (age >= 60 && age <= 74) buckets['60-74'] += val;
            else if (age >= 75) buckets['75-100'] += val;
          }
        }
      }

      if (totalAge === 0) return false;
      numerator = buckets[filterMode] || 0;
      const valCalc = (numerator / totalAge) * 100;
      return valCalc >= filterVal;
    }

    return true;
  };

  if (!checkDynamic(STATE.censusFilters.racaVal, STATE.censusFilters.racaMode, 'raca')) return false;
  if (!checkDynamic(STATE.censusFilters.generoVal, STATE.censusFilters.generoMode, 'genero')) return false;
  if (!checkDynamic(STATE.censusFilters.saneamentoVal, STATE.censusFilters.saneamentoMode, 'saneamento')) return false;

  if (!checkDynamic(STATE.censusFilters.idadeVal, STATE.censusFilters.idadeMode, 'idade')) return false;
  if (!checkDynamic(STATE.censusFilters.escolaridadeVal, STATE.censusFilters.escolaridadeMode, 'escolaridade')) return false;
  if (!checkDynamic(STATE.censusFilters.estadoCivilVal, STATE.censusFilters.estadoCivilMode, 'estadocivil')) return false;

  return true;
}


function getDeputyFeatureData(props) {
  const z = getProp(props, 'nr_zona');
  const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
  const m = getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO'); // New part of key

  if (!z || !l || !m) return null;

  // FIX: Convert to int to avoid float-to-string mismatch (e.g. NR_ZONA=9.0 -> "9.0" vs "9")
  const id = `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;
  const allRes = STATE.deputyResults[id];
  if (!allRes) return null;

  const isEstadual = currentCargo.includes('estadual');
  const typeKey = isEstadual ? 'e' : 'f';

  const votes = allRes[typeKey];
  if (!votes) return null;

  // Build cached map: 2-digit prefix -> real party acronym (e.g., '45' -> 'PSDB')
  // This resolves legend vote party names like 'PARTIDO 45' to actual acronyms
  if (!STATE._partyPrefixCache) {
    STATE._partyPrefixCache = {};
    for (const [cid, cmeta] of Object.entries(STATE.deputyMetadata || {})) {
      if (cid.length > 2 && cmeta && cmeta[1] && !cmeta[1].toUpperCase().startsWith('PARTIDO ')) {
        const prefix = cid.substring(0, 2);
        if (!STATE._partyPrefixCache[prefix]) {
          STATE._partyPrefixCache[prefix] = cmeta[1];
        }
      }
    }
  }

  let maxV = -1;
  let secondV = -1;
  let winner = null;
  let total = 0;

  // Party
  const partyVotes = {};
  let maxPartyV = -1;
  let secondPartyV = -1;
  let winningParty = null;

  for (const [cand, v] of Object.entries(votes)) {
    if (STATE.filterInaptos && (STATE.inaptos[currentCargo]?.['1T'] || []).includes(cand)) {
      continue; // Filter out inactive candidates
    }

    const vi = parseInt(v);
    if (cand === '95' || cand === '96') {
      // blank/null
    } else {
      total += vi;

      // Only real candidates (IDs > 2 digits) compete for winner
      // Legend votes (2-digit IDs like '45') are excluded from candidate winner
      if (cand.length > 2) {
        if (vi > maxV) {
          secondV = maxV;
          maxV = vi;
          winner = cand;
        } else if (vi > secondV) {
          secondV = vi;
        }
      }

      const meta = STATE.deputyMetadata[cand];
      if (meta) {
        let party = meta[1];
        // Resolve generic party names ('PARTIDO XX') to actual acronyms for party aggregation
        if (party && party.toUpperCase().startsWith('PARTIDO ')) {
          const prefix = cand.substring(0, 2);
          if (STATE._partyPrefixCache[prefix]) {
            party = STATE._partyPrefixCache[prefix];
          }
        }
        partyVotes[party] = (partyVotes[party] || 0) + vi;
      }
    }
  }

  for (const [party, v] of Object.entries(partyVotes)) {
    if (v > maxPartyV) {
      secondPartyV = maxPartyV;
      maxPartyV = v;
      winningParty = party;
    } else if (v > secondPartyV) {
      secondPartyV = v;
    }
  }

  return {
    total,
    winner,
    winnerVotes: maxV,
    runnerUpVotes: Math.max(0, secondV),
    winningParty,
    winningPartyVotes: maxPartyV,
    runnerUpPartyVotes: Math.max(0, secondPartyV),
    votes
  };
}

function getVereadorFeatureData(props) {
  if (!STATE._vereadorPartyPrefixCache) {
    STATE._vereadorPartyPrefixCache = {};
    for (const [cid, cmeta] of Object.entries(STATE.vereadorMetadata || {})) {
      if (cid.length > 2 && cmeta && cmeta[1] && !cmeta[1].toUpperCase().startsWith('PARTIDO ')) {
        const prefix = cid.substring(0, 2);
        if (!STATE._vereadorPartyPrefixCache[prefix]) {
          STATE._vereadorPartyPrefixCache[prefix] = cmeta[1];
        }
      }
    }
  }

  // Usa valores precomputados por precomputeVereadorWinners
  const total = props['_VTOTAL_'] !== undefined ? parseInt(props['_VTOTAL_']) : undefined;
  const winner = props['_VWINNER_'] !== undefined ? props['_VWINNER_'] : undefined;
  const winnerVotes = props['_VWVOTES_'] !== undefined ? parseInt(props['_VWVOTES_']) : -1;

  if (total === undefined) {
    // Fallback: calcula na hora se precompute ainda nao rodou
    const TYPE_KEY = 'v';
    const z = getProp(props, 'nr_zona');
    const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
    if (!z || !l) return null;
    const key = `${parseInt(z)}_${parseInt(l)}`;
    const locData = STATE.vereadorResults[key];
    if (!locData || !locData[TYPE_KEY]) return null;
    const votes = locData[TYPE_KEY];
    let tot = 0, win = null, winV = -1, secondV = -1;
    const partyVotes = {};
    let maxPartyV = -1;
    let secondPartyV = -1;
    let winningParty = null;
    for (const [cid, v] of Object.entries(votes)) {
      if (cid === '95' || cid === '96') continue;
      if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cid)) continue;
      const vi = parseInt(v) || 0;
      tot += vi;
      if (cid.length > 2) {
        if (vi > winV) {
          secondV = winV;
          winV = vi;
          win = cid;
        } else if (vi > secondV) {
          secondV = vi;
        }
      }

      const meta = STATE.vereadorMetadata[cid];
      if (meta) {
        let party = meta[1];
        if (party && party.toUpperCase().startsWith('PARTIDO ')) {
          const prefix = cid.substring(0, 2);
          if (STATE._vereadorPartyPrefixCache[prefix]) {
            party = STATE._vereadorPartyPrefixCache[prefix];
          }
        }
        partyVotes[party] = (partyVotes[party] || 0) + vi;
      }
    }

    for (const [party, v] of Object.entries(partyVotes)) {
      if (v > maxPartyV) {
        secondPartyV = maxPartyV;
        maxPartyV = v;
        winningParty = party;
      } else if (v > secondPartyV) {
        secondPartyV = v;
      }
    }
    return {
      total: tot,
      winner: win,
      winnerVotes: winV,
      runnerUpVotes: Math.max(0, secondV),
      winningParty,
      winningPartyVotes: maxPartyV,
      runnerUpPartyVotes: Math.max(0, secondPartyV),
      votes
    };
  }

  // Recupera votes map para modo desempenho
  const z = getProp(props, 'nr_zona');
  const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
  let votes = null;
  if (z && l) {
    const key = `${parseInt(z)}_${parseInt(l)}`;
    const locData = STATE.vereadorResults[key];
    if (locData && locData['v']) votes = locData['v'];
  }

  let winningParty = null;
  let runnerUpVotes = -1;
  let winningPartyVotes = -1;
  let runnerUpPartyVotes = -1;
  if (votes) {
    const partyVotes = {};
    let maxPartyV = -1;
    let secondPartyV = -1;
    let maxCandV = -1;
    let secondCandV = -1;

    for (const [cid, v] of Object.entries(votes)) {
      if (cid === '95' || cid === '96') continue;
      if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cid)) continue;
      const vi = parseInt(v) || 0;

      if (cid.length > 2) {
        if (vi > maxCandV) {
          secondCandV = maxCandV;
          maxCandV = vi;
        } else if (vi > secondCandV) {
          secondCandV = vi;
        }
      }

      const meta = STATE.vereadorMetadata[cid];
      if (!meta) continue;

      let party = meta[1];
      if (party && party.toUpperCase().startsWith('PARTIDO ')) {
        const prefix = cid.substring(0, 2);
        if (STATE._vereadorPartyPrefixCache[prefix]) {
          party = STATE._vereadorPartyPrefixCache[prefix];
        }
      }

      partyVotes[party] = (partyVotes[party] || 0) + vi;
    }

    for (const [party, v] of Object.entries(partyVotes)) {
      if (v > maxPartyV) {
        secondPartyV = maxPartyV;
        maxPartyV = v;
        winningParty = party;
      } else if (v > secondPartyV) {
        secondPartyV = v;
      }
    }
    runnerUpVotes = secondCandV;
    winningPartyVotes = maxPartyV;
    runnerUpPartyVotes = secondPartyV;
  }

  return {
    total,
    winner,
    winnerVotes,
    runnerUpVotes: Math.max(0, runnerUpVotes),
    winningParty,
    winningPartyVotes,
    runnerUpPartyVotes: Math.max(0, runnerUpPartyVotes),
    votes
  };
}


function getFeatureStyle(feature) {
  const props = feature.properties;
  let fillColor = DEFAULT_SWATCH;
  let outlineColor = DEFAULT_SWATCH;
  let fillOpacity = DEFAULT_POINT_FILL_OPACITY;
  let pctVal = 0;

  if (isPresidentShiftModeActive()) {
    return {
      stroke: false,
      fillColor: 'transparent',
      fillOpacity: 0,
      opacity: 0
    };
  }

  if (isIseMapMode()) {
    const scoreInfo = getSocioMapMetricForProps(props);
    const localId = resolveFeatureSelectionId(props);
    if (selectedLocationIDs.has(localId) && !STATE.isFilterAggregationActive) {
      return { stroke: false, fillColor: 'var(--accent)', fillOpacity: DEFAULT_POINT_FILL_OPACITY, opacity: 1 };
    }
    if (!scoreInfo) {
      return { stroke: false, fillColor: '#9ca3af', fillOpacity: 0.22, opacity: 1 };
    }
    const palette = getSocioMetricPalette(scoreInfo);
    return {
      stroke: true,
      color: palette[scoreInfo.tercil] || '#9ca3af',
      weight: 1,
      opacity: 0.7,
      fillColor: getIseMapColor(scoreInfo),
      fillOpacity: 0.86
    };
  }

  // SPECIAL HANDLING FOR DEPUTIES AND VEREADORES
  const isDeputy = currentCargo.startsWith('deputado');
  const isVereador = currentCargo.startsWith('vereador');

  if (isVereador) {
    const depData = getVereadorFeatureData(props);
    if (!depData || depData.total === 0) {
      return { stroke: false, fillColor: '#888888', fillOpacity: 0.2, opacity: 1 };
    }
    const {
      total,
      winner,
      winnerVotes,
      runnerUpVotes,
      winningParty,
      winningPartyVotes,
      runnerUpPartyVotes
    } = depData;
    let fillColor = DEFAULT_SWATCH, outlineColor = DEFAULT_SWATCH, fillOpacity = DEFAULT_POINT_FILL_OPACITY, pctVal = 0;

    if (isVictoryMarginMode()) {
      if (STATE.vereadorViewMode === 'party' && winningParty) {
        outlineColor = colorForParty(winningParty);
        pctVal = getVictoryMarginPct(winningPartyVotes, runnerUpPartyVotes, total);
        fillColor = getVictoryMarginColor(outlineColor, pctVal);
      } else if (winner) {
        const meta = STATE.vereadorMetadata[winner];
        outlineColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
        pctVal = getVictoryMarginPct(winnerVotes, runnerUpVotes, total);
        fillColor = getVictoryMarginColor(outlineColor, pctVal);
      }
    } else if (currentVizMode.startsWith('vencedor') || isPresidentShiftMode()) {
      if (STATE.vereadorViewMode === 'party') {
        if (winningParty) {
          fillColor = colorForParty(winningParty);
          pctVal = 100;
        }
      } else if (winner) {
        const meta = STATE.vereadorMetadata[winner];
        fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
        pctVal = (total > 0) ? (winnerVotes / total) * 100 : 0;
      }
    } else if (currentVizMode.startsWith('desempenho')) {
      const candidatoKey = dom.selectVizCandidato.value;
      if (candidatoKey && depData.votes) {
        const candId = getResolvedVisualizationCandidateId(candidatoKey, currentCargo);
        const cv = candId ? getCandidateVotesForVisualization(depData.votes, candId) : null;
        if (candId && cv !== null) {
          pctVal = (total > 0) ? (cv / total) * 100 : 0;
          const isLegendaCand = candId.length <= 2;
          if (isLegendaCand) {
            const partidoReal = STATE._vereadorPartyPrefixCache?.[candId] || '';
            fillColor = colorForParty(normalizePartyAlias(partidoReal.toUpperCase())) || DEFAULT_SWATCH;
          } else {
            const meta = STATE.vereadorMetadata[candId];
            fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
          }
          if (performanceModeStats.candidato) {
            fillColor = getRelativeGradientColor(fillColor, pctVal, performanceModeStats.minPct, performanceModeStats.maxPct);
            fillOpacity = cv > 0 ? 1 : 0.1;
          } else { fillOpacity = cv > 0 ? 1 : 0.1; }
        } else { fillColor = '#888888'; fillOpacity = 0.15; }
      }
    }
    if (currentVizColorStyle === 'gradient' && (currentVizMode.startsWith('vencedor') || isPresidentShiftMode()))
      fillColor = getUniversalGradientColor(fillColor, pctVal);

    const localId = resolveFeatureSelectionId(props);
    if (selectedLocationIDs.has(localId) && !STATE.isFilterAggregationActive)
      return { stroke: false, fillColor: 'var(--accent)', fillOpacity: DEFAULT_POINT_FILL_OPACITY, opacity: 1 };
    return {
      stroke: isVictoryMarginMode(),
      color: outlineColor,
      weight: isVictoryMarginMode() ? 1.15 : 0,
      opacity: isVictoryMarginMode() ? 0.78 : 1,
      fillColor,
      fillOpacity
    };
  }

  if (isDeputy || currentCargo.startsWith('deputado')) {
    const depData = getDeputyFeatureData(props);
    if (!depData || depData.total === 0) {
      // No data or 0 votes
      return {
        stroke: false,
        fillColor: '#888888',
        fillOpacity: 0.2, // Dim
        opacity: 1
      };
    }

    const {
      total,
      winner,
      winnerVotes,
      runnerUpVotes,
      winningParty,
      winningPartyVotes,
      runnerUpPartyVotes
    } = depData;

    if (isVictoryMarginMode()) {
      if (STATE.deputyViewMode === 'party' && winningParty) {
        outlineColor = colorForParty(winningParty);
        pctVal = getVictoryMarginPct(winningPartyVotes, runnerUpPartyVotes, total);
        fillColor = getVictoryMarginColor(outlineColor, pctVal);
      } else if (winner) {
        const meta = STATE.deputyMetadata[winner];
        const party = meta ? meta[1] : '';
        const name = meta ? meta[0] : winner;
        outlineColor = getColorForCandidate(name, party);
        pctVal = getVictoryMarginPct(winnerVotes, runnerUpVotes, total);
        fillColor = getVictoryMarginColor(outlineColor, pctVal);
      }
    } else if (currentVizMode.startsWith('vencedor') || isPresidentShiftMode()) {
      if (STATE.deputyViewMode === 'party') {
        if (winningParty) {
          fillColor = colorForParty(winningParty);
          pctVal = 100; // Solid party color
        }
      } else {
        // Candidate Mode - winner is always a real candidate (legend votes excluded)
        if (winner) {
          const meta = STATE.deputyMetadata[winner];
          const party = meta ? meta[1] : '';
          const name = meta ? meta[0] : winner;
          fillColor = getColorForCandidate(name, party);
          pctVal = (total > 0) ? (winnerVotes / total) * 100 : 0;
        }
      }
    } else if (currentVizMode.startsWith('desempenho')) {
      const candidatoKey = dom.selectVizCandidato.value;
      if (candidatoKey && depData.votes) {
        const candId = getResolvedVisualizationCandidateId(candidatoKey, currentCargo);
        const candVotes = candId ? getCandidateVotesForVisualization(depData.votes, candId) : null;

        if (candId && candVotes !== null) {
          pctVal = (depData.total > 0) ? (candVotes / depData.total) * 100 : 0;

          const isLegendaCand = candId.length <= 2;
          if (isLegendaCand) {
            const partidoReal = STATE._partyPrefixCache?.[candId] || '';
            fillColor = colorForParty(normalizePartyAlias(partidoReal.toUpperCase())) || DEFAULT_SWATCH;
          } else {
            const meta = STATE.deputyMetadata[candId];
            fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
          }

          if (performanceModeStats.candidato) {
            fillColor = getRelativeGradientColor(fillColor, pctVal, performanceModeStats.minPct, performanceModeStats.maxPct);
            fillOpacity = candVotes > 0 ? 1 : 0.1;
          } else {
            fillOpacity = candVotes > 0 ? 1 : 0.1;
          }
        } else {
          fillColor = '#888888';
          fillOpacity = 0.15;
        }
      }
    }

    // Gradient Logic (only for vencedor mode; desempenho applies its own gradient above)
    if (currentVizColorStyle === 'gradient' && (currentVizMode.startsWith('vencedor') || isPresidentShiftMode())) {
      fillColor = getUniversalGradientColor(fillColor, pctVal);
    }

    const localId = resolveFeatureSelectionId(props);
    if (selectedLocationIDs.has(localId) && !STATE.isFilterAggregationActive) {
      return { stroke: false, fillColor: 'var(--accent)', fillOpacity: DEFAULT_POINT_FILL_OPACITY, opacity: 1 };
    }

    return {
      stroke: isVictoryMarginMode(),
      color: outlineColor,
      weight: isVictoryMarginMode() ? 1.15 : 0,
      opacity: isVictoryMarginMode() ? 0.78 : 1,
      fillColor: fillColor,
      fillOpacity: fillOpacity
    };
  }

  // --- STANDARD LOGIC FOR GENERAL ELECTIONS ---
  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);

  // 1. Determine Base Color and Percentage based on Mode
  if (isVictoryMarginMode()) {
    const { vencedor, segundo } = getTopTwoCandidates(props, currentCargo, turnoKey, STATE.filterInaptos);
    fillColor = getColorForCandidate(vencedor.nome, vencedor.partido);
    outlineColor = fillColor;
    pctVal = getVictoryMarginPct(vencedor.votos, segundo.votos, totalValidos);
    fillColor = getVictoryMarginColor(fillColor, pctVal);

  } else if (currentVizMode.startsWith('vencedor') || isPresidentShiftMode()) {
    const { nome, partido, votos } = getVencedor(props, currentCargo, turnoKey, STATE.filterInaptos);
    fillColor = getColorForCandidate(nome, partido);
    pctVal = (totalValidos > 0) ? (votos / totalValidos) * 100 : 0;

  } else if (currentVizMode.startsWith('desempenho')) {
    const candidato = dom.selectVizCandidato.value;
    if (candidato) {
      const votosCand = ensureNumber(getProp(props, candidato));
      pctVal = (totalValidos > 0) ? (votosCand / totalValidos) * 100 : 0;

      const match = candidato.match(/\((.*?)\)/);
      fillColor = match ? colorForParty(match[1]) : DEFAULT_SWATCH;
    }
  }

  // 2. Apply Style Logic (Static vs Gradient)
  // No modo Desempenho, SEMPRE usar escala adaptativa baseada em min/max do candidato
  if (currentVizMode.startsWith('desempenho') && performanceModeStats.candidato) {
    fillColor = getRelativeGradientColor(
      fillColor,
      pctVal,
      performanceModeStats.minPct,
      performanceModeStats.maxPct
    );
    fillOpacity = DEFAULT_POINT_FILL_OPACITY;
  } else if (currentVizColorStyle === 'gradient' && !isVictoryMarginMode()) {
    fillColor = getUniversalGradientColor(fillColor, pctVal);
    fillOpacity = DEFAULT_POINT_FILL_OPACITY;
  } else {
    fillOpacity = DEFAULT_POINT_FILL_OPACITY;
    if (currentVizMode.startsWith('desempenho') && pctVal === 0) {
      fillOpacity = 0.1;
    }
  }

  const localId = resolveFeatureSelectionId(props);

  if (selectedLocationIDs.has(localId) && !STATE.isFilterAggregationActive) {
    return {
      stroke: false,
      fillColor: 'var(--accent)',
      fillOpacity: DEFAULT_POINT_FILL_OPACITY,
      opacity: 1
    };
  }

  return {
    stroke: isVictoryMarginMode(),
    color: outlineColor,
    weight: isVictoryMarginMode() ? 1.15 : 0,
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    opacity: isVictoryMarginMode() ? 0.78 : 1
  };
}

function getVotosValidos(props, cargo, turno, filtrarInaptos) {
  if (!props) return { totalValidos: 0, votosInaptos: 0 };

  if (cargo && cargo.startsWith('deputado')) {
    return { totalValidos: ensureNumber(props['_TOTAL_']), votosInaptos: 0 };
  }

  const candidatos = STATE.candidates[cargo]?.[turno] || [];
  let somaVotosCandidatos = 0;
  let votosInaptos = 0;

  candidatos.forEach(key => {
    const votos = ensureNumber(getProp(props, key));
    somaVotosCandidatos += votos;
    if (filtrarInaptos && (STATE.inaptos[cargo]?.[turno] || []).includes(key)) {
      votosInaptos += votos;
    }
  });

  const totalValidos = filtrarInaptos ? (somaVotosCandidatos - votosInaptos) : somaVotosCandidatos;
  return { totalValidos: totalValidos, votosInaptos: votosInaptos };
}

function getTopTwoCandidates(props, cargo, turno, filtrarInaptos) {
  const candidatos = STATE.candidates[cargo]?.[turno] || [];
  let winnerKey = null;
  let runnerKey = null;
  let winnerVotes = -1;
  let runnerVotes = -1;

  candidatos.forEach(key => {
    if (filtrarInaptos && (STATE.inaptos[cargo]?.[turno] || []).includes(key)) return;
    const votos = ensureNumber(getProp(props, key));
    if (votos > winnerVotes) {
      runnerVotes = winnerVotes;
      runnerKey = winnerKey;
      winnerVotes = votos;
      winnerKey = key;
    } else if (votos > runnerVotes) {
      runnerVotes = votos;
      runnerKey = key;
    }
  });

  const vencedor = winnerKey
    ? { ...parseCandidateKey(winnerKey), votos: winnerVotes }
    : { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };
  const segundo = runnerKey
    ? { ...parseCandidateKey(runnerKey), votos: runnerVotes }
    : { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };

  return { vencedor, segundo };
}

function getVencedor(props, cargo, turno, filtrarInaptos) {
  if (cargo && cargo.startsWith('deputado')) {
    return {
      nome: props['VENCEDOR'] || 'N/D',
      partido: props['PARTIDO_VENCEDOR'] || 'N/D',
      votos: ensureNumber(props['_WINNER_VOTES_']),
      status: 'N/D'
    };
  }

  const candidatos = STATE.candidates[cargo]?.[turno];
  if (!candidatos) return { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };

  let maxVotos = -1;
  let vencedorKey = null;

  candidatos.forEach(key => {
    if (filtrarInaptos && (STATE.inaptos[cargo]?.[turno] || []).includes(key)) {
      return;
    }
    const votos = ensureNumber(getProp(props, key));
    if (votos > maxVotos) {
      maxVotos = votos;
      vencedorKey = key;
    }
  });

  if (vencedorKey) {
    const cand = parseCandidateKey(vencedorKey);
    return { ...cand, votos: maxVotos };
  }
  return { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };
}

// ====== MAP INTERACTION ======

function onEachFeature(feature, layer) {
  const props = feature.properties;
  layer.bindTooltip(() => {
    const id = resolveFeatureSelectionId(props);
    return getMapFeatureTooltipHtml(props, PRESIDENT_SHIFT_TOOLTIP_CACHE.get(id));
  }, { sticky: true, className: 'feature-map-tooltip' });
  layer.on('mouseover', async () => {
    if (!isPresidentShiftModeActive() || typeof window.resolvePresidentRunoffShiftForProps !== 'function') return;
    const id = resolveFeatureSelectionId(props);
    if (!id || PRESIDENT_SHIFT_TOOLTIP_CACHE.has(id)) return;
    try {
      const baseYear = parseInt(presidentShiftFromYear, 10);
      const compareYear = parseInt(presidentShiftToYear, 10);
      const currentYear = Math.max(baseYear, compareYear);
      const previousYear = Math.min(baseYear, compareYear);
      const shift = await window.resolvePresidentRunoffShiftForProps(props, currentYear, previousYear);
      if (!shift || !Number.isFinite(shift.shift)) return;
      PRESIDENT_SHIFT_TOOLTIP_CACHE.set(id, shift);
      if (typeof layer.setTooltipContent === 'function') {
        layer.setTooltipContent(getMapFeatureTooltipHtml(props, shift));
      }
    } catch (error) {
      // Tooltip continua no formato simples.
    }
  });
  layer.on('click', onFeatureClick);
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (typeof updateMapVizLegendPosition === 'function') updateMapVizLegendPosition();
  });
  window.addEventListener('mouseup', () => {
    if (typeof updateMapVizLegendPosition === 'function') updateMapVizLegendPosition();
  });
}

function onFeatureClick(e) {
  const layer = e.target;
  const props = layer.feature.properties;
  const id = resolveFeatureSelectionId(props);

  const isShiftClick = e.originalEvent.shiftKey;

  if (!isShiftClick) {
    if (selectedLocationIDs.size === 1 && selectedLocationIDs.has(id)) {
      selectedLocationIDs.clear();
    } else {
      selectedLocationIDs.clear();
      selectedLocationIDs.add(id);
    }
  } else {
    if (selectedLocationIDs.has(id)) selectedLocationIDs.delete(id);
    else selectedLocationIDs.add(id);
  }

  if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  isDragSelection = false; // Is manual click
  updateApplyButtonText();
  updateSelectionUI(false);
}

function clearSelection(updateMap = true) {
  selectedLocationIDs.clear();
  STATE.isFilterAggregationActive = false;

  if (updateMap && currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  dom.resultsBox.classList.add('section-hidden');
  dom.resultsContent.innerHTML = '<div style="text-align:center; padding: 20px; color:var(--muted);"><p style="margin-bottom:8px">ðŸ‘†</p>Clique no mapa ou use filtros para ver resultados.</div>';
  dom.resultsMetrics.innerHTML = '';
  dom.summaryGrid.innerHTML = '';
  dom.resultsTitle.textContent = 'Resultados da Seleção';
  dom.resultsSubtitle.textContent = '';
  if (dom.btnLocateSelection) dom.btnLocateSelection.style.display = 'none';
  // Reset Unified View
  dom.unifiedResultsContainer.classList.remove('hidden');
  updateNeighborhoodProfileUI();
}

function focusSelectionOnMap(options = {}) {
  if (!map || !currentLayer || !selectedLocationIDs.size) return false;

  const selectedLayers = [];
  currentLayer.eachLayer?.((layer) => {
    const props = layer?.feature?.properties;
    if (!props) return;
    const id = resolveFeatureSelectionId(props);
    if (selectedLocationIDs.has(id)) selectedLayers.push(layer);
  });

  if (!selectedLayers.length) return false;

  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] : null;
  if (singleLayer && typeof singleLayer.getLatLng === 'function') {
    const latlng = singleLayer.getLatLng();
    if (!latlng) return false;
    const targetZoom = Math.max(map.getZoom() || 0, options.singleZoom || 16);
    map.flyTo(latlng, targetZoom, { animate: true, duration: 0.6 });
    if (typeof singleLayer.openTooltip === 'function') singleLayer.openTooltip();
    return true;
  }

  const bounds = L.latLngBounds([]);
  selectedLayers.forEach((layer) => {
    if (typeof layer.getBounds === 'function') {
      bounds.extend(layer.getBounds());
    } else if (typeof layer.getLatLng === 'function') {
      bounds.extend(layer.getLatLng());
    }
  });

  if (!bounds.isValid()) return false;

  map.flyToBounds(bounds, {
    animate: true,
    duration: 0.6,
    padding: options.padding || [32, 32],
    maxZoom: options.maxZoom || 16
  });
  return true;
}

function focusCurrentLayerOnMap(options = {}) {
  if (!map || !currentLayer) return false;

  const bounds = currentLayer.getBounds?.();
  if (!bounds?.isValid?.()) return false;

  map.flyToBounds(bounds, {
    animate: true,
    duration: 0.6,
    padding: options.padding || [32, 32],
    maxZoom: options.maxZoom || 16
  });
  return true;
}

function syncResultsPanelToCurrentView() {
  if (!currentDataCollection[currentCargo]) return;

  if (selectedLocationIDs.size > 0) {
    updateSelectionUI(STATE.isFilterAggregationActive);
    return;
  }

  const visibleFeatures = CURRENT_VISIBLE_FEATURES_CACHE || [];
  if (!visibleFeatures.length) {
    dom.resultsBox.classList.remove('section-hidden');
    dom.resultsTitle.textContent = 'Sem resultados';
    dom.resultsSubtitle.textContent = 'Nenhum local corresponde ao estado atual dos filtros';
    if (dom.btnLocateSelection) dom.btnLocateSelection.style.display = 'none';
    dom.resultsContent.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted);">Nenhum local encontrado.</div>';
    dom.resultsMetrics.innerHTML = '';
    dom.summaryGrid.innerHTML = '';
    updateNeighborhoodProfileUI();
    return;
  }

  selectedLocationIDs.clear();
  visibleFeatures.forEach((feature) => {
    const id = resolveFeatureSelectionId(feature.properties);
    if (id) selectedLocationIDs.add(id);
  });

  updateSelectionUI(true);
}

function getAllFeaturesForAggregation() {
  // Retorna TODAS as features que passam pelos filtros atuais
  // Não apenas as visíveis no viewport
  const geojson = currentDataCollection[currentCargo];
  if (!geojson || !geojson.features) return [];

  return geojson.features.filter(f => filterFeature(f));
}

// ====== SHIFT+DRAG SELECTION LOGIC ======
function setupBoxSelection() {
  const mapContainer = map.getContainer();

  // Create Visual Box Element
  selectionBoxElement = document.createElement('div');
  selectionBoxElement.classList.add('selection-box');
  mapContainer.appendChild(selectionBoxElement);

  // Note: We use the map container for events to capture drags over the map
  mapContainer.addEventListener('mousedown', handleMouseDown, true);
  window.addEventListener('mousemove', handleMouseMove); // Window to catch drags outside map
  window.addEventListener('mouseup', handleMouseUp);

  setupMobileAreaSelectionControls(mapContainer);
  mapContainer.addEventListener('touchstart', handleMobileSelectionTouchStart, { passive: false });
  mapContainer.addEventListener('touchmove', handleMobileSelectionTouchMove, { passive: false });
  mapContainer.addEventListener('touchend', handleMobileSelectionTouchEnd, { passive: false });
  mapContainer.addEventListener('touchcancel', cancelMobileAreaSelection, { passive: false });
}

function handleMouseDown(e) {
  // Only activate if SHIFT is pressed
  if (!e.shiftKey) return;

  // Only Left Click
  if (e.button !== 0) return;

  if (!currentLayer) return;

  isSelectorsActive = true;

  // Disable Map Dragging while selecting to avoid conflicts
  map.dragging.disable();
  if (map.boxZoom) map.boxZoom.disable();

  // Get start point relative to container
  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();

  startSelectionPoint = clampPointToMap({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  });

  // Reset and Show Box
  updateSelectionBox(startSelectionPoint.x, startSelectionPoint.y, 0, 0);
  selectionBoxElement.style.display = 'block';

  // Prevent default text selection and Leaflet's native Shift+box zoom.
  e.preventDefault();
  e.stopPropagation();
}

function setupMobileAreaSelectionControls(mapContainer) {
  if (mobileSelectionButton) return;

  mobileSelectionButton = document.createElement('button');
  mobileSelectionButton.type = 'button';
  mobileSelectionButton.className = 'mobile-area-select-btn';
  mobileSelectionButton.textContent = 'Selecionar area';
  mobileSelectionButton.title = 'Desenhar uma area no mapa';
  mapContainer.appendChild(mobileSelectionButton);

  mobileSelectionConfirmPanel = document.createElement('div');
  mobileSelectionConfirmPanel.className = 'mobile-selection-confirm hidden';
  mobileSelectionConfirmPanel.innerHTML = `
    <div class="mobile-selection-confirm-text" id="mobileSelectionConfirmText">0 locais encontrados</div>
    <div class="mobile-selection-confirm-actions">
      <button type="button" class="button ghost" data-mobile-selection-action="cancel">Cancelar</button>
      <button type="button" class="button primary" data-mobile-selection-action="confirm">Selecionar</button>
    </div>
  `;
  mapContainer.appendChild(mobileSelectionConfirmPanel);

  mobileSelectionButton.addEventListener('click', () => {
    setMobileAreaSelectionMode(!mobileAreaSelectionMode);
  });

  mobileSelectionConfirmPanel.addEventListener('click', (event) => {
    const action = event.target.closest('[data-mobile-selection-action]')?.dataset.mobileSelectionAction;
    if (action === 'confirm') confirmMobileAreaSelection();
    if (action === 'cancel') cancelMobileAreaSelection();
  });
}

function setMobileAreaSelectionMode(active) {
  mobileAreaSelectionMode = !!active;
  pendingMobileSelectionIDs.clear();

  if (mobileSelectionButton) {
    mobileSelectionButton.classList.toggle('active', mobileAreaSelectionMode);
    mobileSelectionButton.textContent = mobileAreaSelectionMode ? 'Desenhe no mapa' : 'Selecionar area';
  }

  if (mobileSelectionConfirmPanel) {
    mobileSelectionConfirmPanel.classList.add('hidden');
  }

  const mapContainer = map?.getContainer?.();
  if (mapContainer) {
    mapContainer.classList.toggle('mobile-area-selection-active', mobileAreaSelectionMode);
  }

  if (!mobileAreaSelectionMode) {
    isSelectorsActive = false;
    if (selectionBoxElement) selectionBoxElement.style.display = 'none';
    if (map?.dragging) map.dragging.enable();
    if (map?.boxZoom) map.boxZoom.enable();
  } else {
    if (!currentLayer) {
      showToast('Carregue dados antes de selecionar uma area.', 'info', 2200);
      setMobileAreaSelectionMode(false);
    } else {
      showToast('Arraste no mapa para desenhar a area de selecao.', 'info', 2200);
    }
  }
}

function getTouchPointInMap(touch) {
  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();
  return clampPointToMap({
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top
  });
}

function handleMobileSelectionTouchStart(e) {
  if (!mobileAreaSelectionMode || !currentLayer) return;
  if (e.touches.length !== 1) return;
  if (e.target.closest('.mobile-area-select-btn, .mobile-selection-confirm')) return;

  e.preventDefault();
  isSelectorsActive = true;
  pendingMobileSelectionIDs.clear();

  map.dragging.disable();
  if (map.boxZoom) map.boxZoom.disable();

  startSelectionPoint = getTouchPointInMap(e.touches[0]);
  updateSelectionBox(startSelectionPoint.x, startSelectionPoint.y, 0, 0);
  selectionBoxElement.style.display = 'block';
}

function handleMobileSelectionTouchMove(e) {
  if (!mobileAreaSelectionMode || !isSelectorsActive || e.touches.length !== 1) return;

  e.preventDefault();
  const current = getTouchPointInMap(e.touches[0]);
  const x = Math.min(startSelectionPoint.x, current.x);
  const y = Math.min(startSelectionPoint.y, current.y);
  const width = Math.abs(current.x - startSelectionPoint.x);
  const height = Math.abs(current.y - startSelectionPoint.y);

  updateSelectionBox(x, y, width, height);
}

function handleMobileSelectionTouchEnd(e) {
  if (!mobileAreaSelectionMode || !isSelectorsActive) return;

  e.preventDefault();
  isSelectorsActive = false;
  selectionBoxElement.style.display = 'none';

  const changedTouch = e.changedTouches?.[0];
  if (!changedTouch) {
    cancelMobileAreaSelection();
    return;
  }

  const endPoint = getTouchPointInMap(changedTouch);
  const dist = Math.sqrt(Math.pow(endPoint.x - startSelectionPoint.x, 2) + Math.pow(endPoint.y - startSelectionPoint.y, 2));
  if (dist < 12) {
    showToast('Arraste para desenhar uma area maior.', 'info', 1800);
    setMobileAreaSelectionMode(false);
    return;
  }

  const minX = Math.min(startSelectionPoint.x, endPoint.x);
  const maxX = Math.max(startSelectionPoint.x, endPoint.x);
  const minY = Math.min(startSelectionPoint.y, endPoint.y);
  const maxY = Math.max(startSelectionPoint.y, endPoint.y);

  const bounds = L.latLngBounds(
    map.containerPointToLatLng(L.point(minX, minY)),
    map.containerPointToLatLng(L.point(maxX, maxY))
  );

  pendingMobileSelectionIDs = getFeatureIdsInBounds(bounds);
  showMobileSelectionConfirmation();
}

function showMobileSelectionConfirmation() {
  if (!pendingMobileSelectionIDs.size) {
    showToast('Nenhum local encontrado nessa area.', 'info', 2000);
    setMobileAreaSelectionMode(false);
    return;
  }

  const text = mobileSelectionConfirmPanel?.querySelector('#mobileSelectionConfirmText');
  if (text) {
    text.textContent = `${pendingMobileSelectionIDs.size} ${pendingMobileSelectionIDs.size === 1 ? 'local encontrado' : 'locais encontrados'}`;
  }
  mobileSelectionConfirmPanel?.classList.remove('hidden');
}

function confirmMobileAreaSelection() {
  if (!pendingMobileSelectionIDs.size) {
    cancelMobileAreaSelection();
    return;
  }

  selectedLocationIDs.clear();
  pendingMobileSelectionIDs.forEach(id => selectedLocationIDs.add(id));
  pendingMobileSelectionIDs.clear();
  isDragSelection = true;
  updateSelectionUI(false);
  if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  setMobileAreaSelectionMode(false);

  if (typeof window.mobileShowPanel === 'function' && window.innerWidth <= 768) {
    window.mobileShowPanel('right');
  }
}

function cancelMobileAreaSelection(e) {
  if (e?.preventDefault) e.preventDefault();
  pendingMobileSelectionIDs.clear();
  setMobileAreaSelectionMode(false);
}

function handleMouseMove(e) {
  if (!isSelectorsActive) return;

  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();

  const currentPoint = clampPointToMap({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  });
  const currentX = currentPoint.x;
  const currentY = currentPoint.y;

  // Calculate box geometry
  const x = Math.min(startSelectionPoint.x, currentX);
  const y = Math.min(startSelectionPoint.y, currentY);
  const width = Math.abs(currentX - startSelectionPoint.x);
  const height = Math.abs(currentY - startSelectionPoint.y);

  updateSelectionBox(x, y, width, height);
}

function handleMouseUp(e) {
  if (!isSelectorsActive) return;

  isSelectorsActive = false;
  selectionBoxElement.style.display = 'none';

  // Re-enable Map Dragging
  map.dragging.enable();
  if (map.boxZoom) map.boxZoom.enable();

  // Perform Final Selection Logic
  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();
  const endPoint = clampPointToMap({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  });
  const endX = endPoint.x;
  const endY = endPoint.y;

  // If drag was very small, treat as click and let standard Shift+Click handler work? 
  // Standard Shift+Click is handled by Leaflet layer click.
  // We should only process BLOCK selection if distance > threshold.
  const dist = Math.sqrt(Math.pow(endX - startSelectionPoint.x, 2) + Math.pow(endY - startSelectionPoint.y, 2));

  if (dist < 8) {
    // It was just a click. Leaflet's 'click' event on the layer will handle it.
    // We do nothing here to avoid double-processing or clearing.
    // But wait: mousedown preventDefault() might have blocked it?
    // No, we only prevented default text selection. Leaflet events usually fire.
    return;
  }

  // Convert pixel Bounds to LatLng Bounds
  const b = selectionBoxElement.getBoundingClientRect();
  // Relative to viewport, but we need points relative to map container for containerPointToLatLng.
  // Actually, easier: use the start/end points we tracked relative to container.

  const minX = Math.min(startSelectionPoint.x, endX);
  const maxX = Math.max(startSelectionPoint.x, endX);
  const minY = Math.min(startSelectionPoint.y, endY);
  const maxY = Math.max(startSelectionPoint.y, endY);

  if ((maxX - minX) < 8 || (maxY - minY) < 8) return;

  const p1 = L.point(minX, minY);
  const p2 = L.point(maxX, maxY);

  const bounds = L.latLngBounds(
    map.containerPointToLatLng(p1),
    map.containerPointToLatLng(p2)
  );

  selectFeaturesInBounds(bounds);
}

function updateSelectionBox(x, y, w, h) {
  selectionBoxElement.style.left = x + 'px';
  selectionBoxElement.style.top = y + 'px';
  selectionBoxElement.style.width = w + 'px';
  selectionBoxElement.style.height = h + 'px';
}

function clampPointToMap(point) {
  const size = map?.getSize?.();
  const maxX = Math.max(0, (size?.x || 0));
  const maxY = Math.max(0, (size?.y || 0));

  return {
    x: Math.max(0, Math.min(maxX, Number(point?.x) || 0)),
    y: Math.max(0, Math.min(maxY, Number(point?.y) || 0))
  };
}

function isValidSelectionBounds(bounds) {
  if (!bounds || !bounds.isValid?.()) return false;
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  return [south, north, west, east].every(Number.isFinite)
    && north > south
    && east > west
    && bounds.intersects(map.getBounds());
}

function selectFeaturesInBounds(bounds) {
  if (!isValidSelectionBounds(bounds)) return;

  const ids = getFeatureIdsInBounds(bounds);
  let addedCount = 0;

  ids.forEach(id => {
    selectedLocationIDs.add(id);
    addedCount++;
  });

  if (addedCount > 0) {
    isDragSelection = true;
    updateSelectionUI(false); // Treat as manual selection
    // Force style update for newly selected items
    if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  }
}

function getFeatureIdsInBounds(bounds) {
  const ids = new Set();
  if (!currentLayer) return ids;
  if (!isValidSelectionBounds(bounds)) return ids;

  // Recursive helper to find features in bounds
  const findInBounds = (layerNode) => {
    if (!layerNode) return;

    // If it's a marker/point with position
    if (layerNode.getLatLng) {
      if (bounds.contains(layerNode.getLatLng())) {
        const props = layerNode.feature && layerNode.feature.properties;
        if (props) {
          const id = resolveFeatureSelectionId(props);
          if (id) ids.add(id);
        }
      }
    }
    // If it's a group (LayerGroup or GeoJSON)
    else if (layerNode.eachLayer) {
      layerNode.eachLayer(child => findInBounds(child));
    }
  };

  findInBounds(currentLayer);
  return ids;
}


// Função auxiliar para gerar o texto do título baseado nos filtros ativos
function getActiveCensusFilterLabel() {
  const f = STATE.censusFilters;

  // 1. Filtro de Renda
  if (f.rendaMin !== null || f.rendaMax !== null) {
    const min = (f.rendaMin || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    const max = f.rendaMax ? (f.rendaMax).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : 'Máx (+R$ 10k)';
    return `Renda Média: ${min} a ${max}`;
  }

  // 2. Filtro de Raça/Cor
  if (f.racaVal > 0) {
    // Remove o "Pct" para ficar mais bonito (ex: "Pct Preta" vira "População Preta")
    const label = f.racaMode.replace('Pct ', 'População ');
    return `${label}: Acima de ${f.racaVal}%`;
  }

  // 3. Filtro de Idade
  if (f.idadeVal > 0) {
    const gender = f.idadeGeneroMode === 'F' ? ' feminino' : (f.idadeGeneroMode === 'M' ? ' masculino' : '');
    return `Idade${gender} ${f.idadeMode}: Acima de ${f.idadeVal}% dos eleitores`;
  }

  // 4. Filtro de Gênero
  if (f.generoVal > 0) {
    const label = f.generoMode.replace('Pct ', ''); // "Mulheres" ou "Homens"
    return `Gênero (${label}): Acima de ${f.generoVal}%`;
  }

  // 5. Filtro de Escolaridade
  if (f.escolaridadeVal > 0) {
    const gender = f.escolaridadeGeneroMode === 'F' ? ' feminino' : (f.escolaridadeGeneroMode === 'M' ? ' masculino' : '');
    return `Escolaridade${gender} (${f.escolaridadeMode}): Acima de ${f.escolaridadeVal}%`;
  }

  // 6. Filtro de Estado Civil
  if (f.estadoCivilVal > 0) {
    return `Estado Civil (${f.estadoCivilMode}): Acima de ${f.estadoCivilVal}%`;
  }

  // 7. Filtro de Saneamento
  if (f.saneamentoVal > 0) {
    const label = f.saneamentoMode.replace('Pct ', '');
    return `Saneamento (${label}): Acima de ${f.saneamentoVal}%`;
  }

  return null; // Nenhum filtro censitário ativo
}
