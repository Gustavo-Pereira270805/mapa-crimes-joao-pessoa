const CRIME_COLORS = {
  "Homicídio": "#ef4444",
  "Feminicídio": "#db2777",
  "Crime sexual": "#a855f7",
  "Sequestro": "#06b6d4",
  "Roubo/assalto": "#f59e0b",
  "Tiroteio/arma": "#f97316",
  "Tráfico/drogas": "#10b981",
  "Violência doméstica": "#ec4899",
  "Furto": "#eab308",
  "Operação policial": "#64748b"
};

const SEVERITY = {
  "Feminicídio": 11,
  "Homicídio": 10,
  "Crime sexual": 9,
  "Sequestro": 8,
  "Roubo/assalto": 7,
  "Tiroteio/arma": 6,
  "Tráfico/drogas": 5,
  "Violência doméstica": 4,
  "Furto": 3,
  "Operação policial": 1
};

const ALL_TYPES = Object.keys(CRIME_COLORS);
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const DATA = { incidents: [], bairros: null, context: null };
const state = {
  period: "365",
  types: new Set(ALL_TYPES),
  bairro: "all",
  mode: "points",
  visible: 12
};

let maxDate = new Date();
let map;
let pointsLayer;
let heatLayer;
let choroplethLayer = null;
let currentStats = new Map();
let currentFiltered = [];
let charts = { month: null, types: null, bairros: null };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(date, opts = { day: "2-digit", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("pt-BR", opts).format(date).replace(".", "");
}

function formatMonth(date) {
  return `${MONTHS[date.getMonth()]}/${String(date.getFullYear()).slice(-2)}`;
}

function countBy(list, key) {
  const out = {};
  for (const item of list) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

function topType(byType) {
  const entries = Object.entries(byType || {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1] || (SEVERITY[b[0]] || 0) - (SEVERITY[a[0]] || 0));
  return entries[0][0];
}

function topEntry(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0];
}

function typeColor(type) {
  return CRIME_COLORS[type] || "#64748b";
}

function cleanExcerpt(text) {
  return String(text || "")
    .replace(/^Imagem ilustrativa[^.]*\.\s*/i, "")
    .replace(/^Foto:[^.]*\.\s*/i, "")
    .replace(/^\(Foto:[^)]*\)\s*/i, "")
    .replace(/^Divulgação[^.]*\.\s*/i, "")
    .replace(/^Reprodução[^.]*\.\s*/i, "")
    .trim();
}

function badge(type) {
  return `<span class="badge" style="--badge:${typeColor(type)}">${escapeHtml(type)}</span>`;
}

function getFiltered() {
  const days = state.period === "all" ? null : Number(state.period);
  const cutoff = days ? new Date(maxDate.getTime() - days * 86400000) : null;
  return DATA.incidents.filter((inc) => {
    const d = new Date(inc.date);
    if (cutoff && d < cutoff) return false;
    if (!state.types.has(inc.tipo)) return false;
    if (state.bairro !== "all" && inc.bairro !== state.bairro) return false;
    return true;
  });
}

function computeStats(filtered) {
  const stats = new Map();
  for (const feature of DATA.bairros.features) {
    const p = feature.properties;
    stats.set(p.nome, {
      nome: p.nome,
      total: 0,
      byType: {},
      area: Number(p.area_km2) || 0,
      centro: p.centro,
      density: 0,
      topType: null
    });
  }
  for (const inc of filtered) {
    const s = stats.get(inc.bairro);
    if (!s) continue;
    s.total += 1;
    s.byType[inc.tipo] = (s.byType[inc.tipo] || 0) + 1;
  }
  for (const s of stats.values()) {
    s.density = s.area > 0 ? s.total / s.area : 0;
    s.topType = topType(s.byType);
  }
  return stats;
}

function densityColor(value, max) {
  if (!value || !max) return "#0e7490";
  const t = Math.log1p(value) / Math.log1p(max);
  const stops = [
    [14, 116, 144],
    [245, 158, 11],
    [239, 68, 68]
  ];
  const pos = Math.min(1, Math.max(0, t)) * 2;
  const i = Math.min(1, Math.floor(pos));
  const f = pos - i;
  const a = stops[i];
  const b = stops[i + 1];
  const rgb = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function initMap() {
  map = L.map("map", {
    zoomControl: false,
    attributionControl: true
  }).setView([-7.1195, -34.863], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ position: "bottomright", imperial: false }).addTo(map);

  pointsLayer = L.layerGroup();
  heatLayer = L.heatLayer([], {
    radius: 26,
    blur: 18,
    maxZoom: 14,
    minOpacity: 0.35,
    gradient: { 0.15: "#0e7490", 0.45: "#f59e0b", 0.75: "#ef4444", 1: "#fecaca" }
  });
}

function popupHtml(inc) {
  const date = formatDate(new Date(inc.date));
  return `
    <div class="popup-type" style="--badge:${typeColor(inc.tipo)}">${escapeHtml(inc.tipo)}</div>
    <h3 class="popup-title">${escapeHtml(inc.title)}</h3>
    <div class="popup-meta">
      <span>${escapeHtml(inc.bairro)}</span>
      <span>·</span>
      <span>${date}</span>
      <span>·</span>
      <span>${escapeHtml(inc.source)}</span>
    </div>
    <p class="popup-excerpt">${escapeHtml(cleanExcerpt(inc.excerpt))}</p>
    <a class="popup-link" href="${escapeHtml(inc.link)}" target="_blank" rel="noopener">Ler notícia original ↗</a>
  `;
}

function renderPoints(filtered) {
  pointsLayer.clearLayers();
  for (const inc of filtered) {
    const marker = L.circleMarker([inc.lat, inc.lng], {
      radius: 5,
      weight: 1,
      color: "rgba(6,10,18,.9)",
      fillColor: typeColor(inc.tipo),
      fillOpacity: 0.92
    });
    marker.bindPopup(popupHtml(inc), { maxWidth: 340, minWidth: 260 });
    marker.bindTooltip(`${escapeHtml(inc.tipo)} · ${escapeHtml(inc.bairro)}`, {
      direction: "top",
      offset: [0, -4],
      opacity: 0.95
    });
    pointsLayer.addLayer(marker);
  }
  pointsLayer.addTo(map);
}

function renderHeat(filtered) {
  const pts = filtered.map((inc) => [inc.lat, inc.lng, 0.65]);
  if (!L.heatLayer) {
    renderPoints(filtered);
    return;
  }
  heatLayer.setLatLngs(pts);
  heatLayer.addTo(map);
}

function neighborhoodTooltip(s, mode) {
  const counts = Object.entries(s.byType).sort((a, b) => b[1] - a[1]);
  const lines = counts.slice(0, 4).map(([t, n]) => `${escapeHtml(t)}: <strong>${n}</strong>`).join("<br>");
  const density = s.area ? s.density.toFixed(1) : "—";
  return `
    <strong>${escapeHtml(s.nome)}</strong><br>
    ${s.total} notícia${s.total === 1 ? "" : "s"} · ${density}/km²<br>
    ${mode === "predominant" ? `Predominante: <strong>${escapeHtml(s.topType || "—")}</strong><br>` : ""}
    ${lines || "Sem registros"}
  `;
}

function renderChoropleth(filtered, mode) {
  const stats = currentStats;
  const maxDensity = Math.max(...Array.from(stats.values()).map((s) => s.density), 0);

  if (choroplethLayer) {
    map.removeLayer(choroplethLayer);
    choroplethLayer = null;
  }

  choroplethLayer = L.geoJSON(DATA.bairros, {
    style(feature) {
      const s = stats.get(feature.properties.nome);
      if (!s || s.total === 0) {
        return {
          fillColor: "#1e293b",
          fillOpacity: 0.16,
          color: "rgba(148,163,184,.18)",
          weight: 1,
          dashArray: "3 4"
        };
      }
      return {
        fillColor: mode === "predominant" ? typeColor(s.topType) : densityColor(s.density, maxDensity),
        fillOpacity: 0.78,
        color: "rgba(255,255,255,.2)",
        weight: 1
      };
    },
    onEachFeature(feature, layer) {
      const s = stats.get(feature.properties.nome);
      if (!s) return;
      layer.bindTooltip(neighborhoodTooltip(s, mode), {
        sticky: true,
        direction: "top",
        opacity: 1,
        className: "neighborhood-tooltip"
      });
      layer.on("mouseover", () => layer.setStyle({ weight: 2, fillOpacity: 0.92 }));
      layer.on("mouseout", () => {
        if (choroplethLayer) choroplethLayer.resetStyle(layer);
      });
      layer.on("click", () => {
        state.bairro = s.nome;
        state.visible = 12;
        const select = $("#bairro");
        if (select) select.value = s.nome;
        render();
      });
    }
  }).addTo(map);

  // bring points above the choropleth if the user wants to see them
  if (pointsLayer) pointsLayer.remove();
}

function updateLegend(mode, maxDensity) {
  const legend = $("#mapLegend");
  if (!legend) return;

  if (mode === "density" || mode === "heat") {
    const label = mode === "density" ? "Notícias por km²" : "Intensidade de notícias";
    legend.innerHTML = `
      <div class="legend-title">${label}</div>
      <div class="legend-gradient"></div>
      <div class="legend-scale"><span>menos</span><span>mais</span></div>
      <div class="legend-note">${mode === "density" ? "Escala logarítmica. Densidade = notícias ÷ área do bairro." : "Concentração estimada a partir dos pontos geocodificados."}</div>
    `;
    return;
  }

  const items = ALL_TYPES.map((type) => `
    <div class="legend-item"><span class="legend-swatch" style="--swatch:${typeColor(type)}"></span>${escapeHtml(type)}</div>
  `).join("");

  legend.innerHTML = `
    <div class="legend-title">${mode === "predominant" ? "Crime predominante" : "Tipo de crime"}</div>
    <div class="legend-items">${items}</div>
    <div class="legend-note">${mode === "predominant" ? "Cor = tipo mais frequente no bairro. Bairros sem registros em cinza." : "Cada ponto é uma notícia; a posição é aproximada dentro do bairro."}</div>
  `;
}

function renderMap(filtered) {
  if (!map) return;
  if (pointsLayer) pointsLayer.remove();
  if (heatLayer) heatLayer.remove();
  if (choroplethLayer) {
    map.removeLayer(choroplethLayer);
    choroplethLayer = null;
  }

  const mode = state.mode;
  if (mode === "points") {
    renderPoints(filtered);
    updateLegend("points");
  } else if (mode === "heat") {
    renderHeat(filtered);
    updateLegend("heat");
  } else {
    renderChoropleth(filtered, mode);
    const maxDensity = Math.max(...Array.from(currentStats.values()).map((s) => s.density), 0);
    updateLegend(mode, maxDensity);
  }

  const empty = $("#mapEmpty");
  if (empty) empty.hidden = filtered.length > 0;

  const titles = {
    points: ["Camada · pontos", "Ocorrências noticiadas"],
    predominant: ["Camada · crime predominante", "Crime mais comum por bairro"],
    density: ["Camada · densidade", "Notícias por km²"],
    heat: ["Camada · calor", "Concentração de notícias"]
  };
  const [eyebrow, title] = titles[mode] || titles.points;
  $("#mapEyebrow").textContent = eyebrow;
  $("#mapTitle").textContent = title;
  $("#mapCount").textContent = `${filtered.length} notícia${filtered.length === 1 ? "" : "s"}`;
}

function renderKpis(filtered) {
  const typeCounts = countBy(filtered, "tipo");
  const bairroCounts = countBy(filtered, "bairro");
  const topT = topType(typeCounts);
  const topB = topEntry(bairroCounts);
  const dates = filtered.map((x) => new Date(x.date)).sort((a, b) => a - b);

  $("#kpiTotal").textContent = filtered.length.toLocaleString("pt-BR");
  $("#kpiPeriod").textContent = dates.length
    ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`
    : "sem dados no período";

  $("#kpiType").textContent = topT || "—";
  $("#kpiTypeCount").textContent = topT ? `${typeCounts[topT]} notícia${typeCounts[topT] === 1 ? "" : "s"}` : "sem dados";

  $("#kpiBairro").textContent = topB ? topB[0] : "—";
  $("#kpiBairroCount").textContent = topB ? `${topB[1]} notícia${topB[1] === 1 ? "" : "s"}` : "sem dados";

  $("#kpiCoverage").textContent = Object.keys(bairroCounts).length;
}

function renderFilterSummary(filtered) {
  const dates = filtered.map((x) => new Date(x.date)).sort((a, b) => a - b);
  const period = dates.length
    ? `${formatDate(dates[0], { day: "2-digit", month: "short", year: "2-digit" })} – ${formatDate(dates[dates.length - 1], { day: "2-digit", month: "short", year: "2-digit" })}`
    : "sem dados";
  const typeLabel = state.types.size === ALL_TYPES.length
    ? "todos os tipos"
    : `${state.types.size} tipo${state.types.size === 1 ? "" : "s"} selecionado${state.types.size === 1 ? "" : "s"}`;
  const bairroLabel = state.bairro === "all" ? "todos os bairros" : state.bairro;
  $("#filterSummary").innerHTML = `<strong>${filtered.length}</strong> notícia${filtered.length === 1 ? "" : "s"} · ${period}<br>${typeLabel} · ${bairroLabel}`;
}

function renderCharts(filtered) {
  if (typeof Chart === "undefined") return;

  Chart.defaults.color = "#93a4bd";
  Chart.defaults.font.family = "Inter, sans-serif";
  Chart.defaults.font.size = 10;
  Chart.defaults.borderColor = "rgba(148,163,184,.12)";

  // monthly series
  const monthCounts = {};
  for (const inc of filtered) {
    const d = new Date(inc.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthCounts[key] = (monthCounts[key] || 0) + 1;
  }
  const sortedKeys = Object.keys(monthCounts).sort();
  let labels = [];
  let values = [];
  if (sortedKeys.length) {
    const first = new Date(`${sortedKeys[0]}-01T00:00:00`);
    const last = new Date(`${sortedKeys[sortedKeys.length - 1]}-01T00:00:00`);
    const cursor = new Date(first);
    while (cursor <= last) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      labels.push(formatMonth(cursor));
      values.push(monthCounts[key] || 0);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  if (charts.month) charts.month.destroy();
  const monthCtx = $("#chartMonth").getContext("2d");
  const gradient = monthCtx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, "rgba(245,158,11,.32)");
  gradient.addColorStop(1, "rgba(245,158,11,0)");

  charts.month = new Chart(monthCtx, {
    type: "line",
    data: {
      labels: labels.length ? labels : ["Sem dados"],
      datasets: [{
        data: values.length ? values : [0],
        borderColor: "#f59e0b",
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#fbbf24",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { beginAtZero: true, grid: { color: "rgba(148,163,184,.08)" }, ticks: { precision: 0 } }
      }
    }
  });

  // types
  const typeCounts = countBy(filtered, "tipo");
  const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  if (charts.types) charts.types.destroy();
  charts.types = new Chart($("#chartTypes").getContext("2d"), {
    type: "bar",
    data: {
      labels: typeEntries.length ? typeEntries.map(([t]) => t) : ["Sem dados"],
      datasets: [{
        data: typeEntries.length ? typeEntries.map(([, n]) => n) : [0],
        backgroundColor: typeEntries.length ? typeEntries.map(([t]) => typeColor(t)) : ["#334155"],
        borderRadius: 5,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(148,163,184,.08)" }, ticks: { precision: 0 } },
        y: { grid: { display: false } }
      }
    }
  });

  // neighborhoods
  const bairroEntries = Object.entries(countBy(filtered, "bairro")).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (charts.bairros) charts.bairros.destroy();
  charts.bairros = new Chart($("#chartBairros").getContext("2d"), {
    type: "bar",
    data: {
      labels: bairroEntries.length ? bairroEntries.map(([b]) => b) : ["Sem dados"],
      datasets: [{
        data: bairroEntries.length ? bairroEntries.map(([, n]) => n) : [0],
        backgroundColor: "#22d3ee",
        borderRadius: 5,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(148,163,184,.08)" }, ticks: { precision: 0 } },
        y: { grid: { display: false } }
      }
    }
  });
}

function renderList(filtered) {
  const list = $("#incidentList");
  const visible = filtered.slice(0, state.visible);
  if (!visible.length) {
    list.innerHTML = `<div class="incident-card"><p class="incident-excerpt">Nenhuma notícia com os filtros atuais. Amplie o período ou selecione outros tipos.</p></div>`;
  } else {
    list.innerHTML = visible.map((inc) => `
      <article class="incident-card">
        <div class="incident-top">
          <span class="incident-date">${formatDate(new Date(inc.date), { day: "2-digit", month: "short", year: "numeric" })}</span>
          ${badge(inc.tipo)}
        </div>
        <h3 class="incident-title">${escapeHtml(inc.title)}</h3>
        <p class="incident-excerpt">${escapeHtml(cleanExcerpt(inc.excerpt))}</p>
        <div class="incident-foot">
          <span>${escapeHtml(inc.bairro)} · ${escapeHtml(inc.source)}</span>
          <a href="${escapeHtml(inc.link)}" target="_blank" rel="noopener">Ler notícia ↗</a>
        </div>
      </article>
    `).join("");
  }

  const btn = $("#showMore");
  btn.hidden = state.visible >= filtered.length;
  btn.textContent = `Mostrar mais (${Math.max(0, filtered.length - state.visible)})`;
}

function renderOfficial() {
  const grid = $("#officialGrid");
  if (!grid || !DATA.context) return;
  grid.innerHTML = DATA.context.oficial.map((item) => `
    <div class="official-card">
      <strong>${Number(item.valor).toLocaleString("pt-BR")}</strong>
      <span>${escapeHtml(item.indicador)}</span>
      <small>${escapeHtml(item.fonte)}</small>
      <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">Ver fonte ↗</a>
    </div>
  `).join("");
}

function render() {
  currentFiltered = getFiltered();
  currentStats = computeStats(currentFiltered);
  renderKpis(currentFiltered);
  renderFilterSummary(currentFiltered);
  renderMap(currentFiltered);
  renderCharts(currentFiltered);
  renderList(currentFiltered);
}

function populateFilters() {
  const typeList = $("#typeList");
  typeList.innerHTML = ALL_TYPES.map((type) => `
    <label class="type-check" style="--dot:${typeColor(type)}">
      <input type="checkbox" value="${escapeHtml(type)}" checked />
      <span class="type-dot"></span>
      <span>${escapeHtml(type)}</span>
      <span class="check">✓</span>
    </label>
  `).join("");

  typeList.addEventListener("change", (event) => {
    const input = event.target.closest("input[type=checkbox]");
    if (!input) return;
    if (input.checked) state.types.add(input.value);
    else state.types.delete(input.value);
    state.visible = 12;
    updateToggleAllLabel();
    render();
  });

  const bairroSelect = $("#bairro");
  const names = DATA.bairros.features.map((f) => f.properties.nome).sort((a, b) => a.localeCompare(b, "pt-BR"));
  bairroSelect.innerHTML = `<option value="all">Todos os bairros</option>` +
    names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  bairroSelect.addEventListener("change", () => {
    state.bairro = bairroSelect.value;
    state.visible = 12;
    render();
  });

  $("#period").addEventListener("change", (event) => {
    state.period = event.target.value;
    state.visible = 12;
    render();
  });

  $$(".seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      $$(".seg").forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });

  $("#resetFilters").addEventListener("click", () => {
    state.period = "365";
    state.types = new Set(ALL_TYPES);
    state.bairro = "all";
    state.mode = "points";
    state.visible = 12;
    $("#period").value = "365";
    $("#bairro").value = "all";
    $$(".seg").forEach((b) => b.classList.toggle("active", b.dataset.mode === "points"));
    $$("#typeList input").forEach((i) => { i.checked = true; });
    updateToggleAllLabel();
    render();
  });

  $("#toggleAllTypes").addEventListener("click", () => {
    const allSelected = state.types.size === ALL_TYPES.length;
    state.types = allSelected ? new Set() : new Set(ALL_TYPES);
    $$("#typeList input").forEach((i) => { i.checked = !allSelected; });
    state.visible = 12;
    updateToggleAllLabel();
    render();
  });

  $("#showMore").addEventListener("click", () => {
    state.visible += 12;
    renderList(currentFiltered);
  });

  $("#fitMap").addEventListener("click", () => {
    if (!map) return;
    const bounds = L.geoJSON(DATA.bairros).getBounds();
    map.fitBounds(bounds, { padding: [18, 18], maxZoom: 12 });
  });
}

function updateToggleAllLabel() {
  const btn = $("#toggleAllTypes");
  if (!btn) return;
  btn.textContent = state.types.size === ALL_TYPES.length ? "Desmarcar todos" : "Marcar todos";
}

async function init() {
  try {
    const [incidents, bairros, context] = await Promise.all([
      fetch("data/incidents.json").then((r) => {
        if (!r.ok) throw new Error(`incidents.json: ${r.status}`);
        return r.json();
      }),
      fetch("data/bairros.geojson").then((r) => {
        if (!r.ok) throw new Error(`bairros.geojson: ${r.status}`);
        return r.json();
      }),
      fetch("data/context.json").then((r) => {
        if (!r.ok) throw new Error(`context.json: ${r.status}`);
        return r.json();
      })
    ]);

    DATA.incidents = incidents;
    DATA.bairros = bairros;
    DATA.context = context;
    maxDate = new Date(Math.max(...incidents.map((i) => new Date(i.date).getTime())));

    $("#heroCount").textContent = incidents.length.toLocaleString("pt-BR");
    populateFilters();
    initMap();
    renderOfficial();
    render();
    updateToggleAllLabel();

    // fit to the municipality once the container has its final size
    const bounds = L.geoJSON(DATA.bairros).getBounds();
    setTimeout(() => {
      if (!map) return;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [18, 18], maxZoom: 12 });
    }, 350);
  } catch (error) {
    console.error(error);
    const mapEl = $("#map");
    if (mapEl) {
      mapEl.innerHTML = `<div style="padding:40px;color:#93a4bd;font-size:13px">Não foi possível carregar os dados do protótipo. Verifique se a pasta <code>data/</code> está publicada corretamente.</div>`;
    }
    $("#heroCount").textContent = "—";
  }
}

init();
