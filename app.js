const RADLAB_SAMPLE_PATH = 'data/radlab-iss-sample.json';
const STORAGE_KEY = 'beyond-pulse-demo-v1';
const MAX_HANDOFF_MEDIA_BYTES = 20 * 1024 * 1024;
const NASA_LINKS = {
  challenge: 'https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/',
  hazards: 'https://www.nasa.gov/hrp/hazards/',
  risks: 'https://www.nasa.gov/hrp/risks/',
  research: 'https://www.nasa.gov/hrp/',
  ultrasound: 'https://www.nasa.gov/glenn/glenn-expertise-space-exploration/human-health-performance/exploration-medical-technologies/flexible-ultrasound-system/',
  radlab: 'https://visualization.osdr.nasa.gov/radlab/gui/overview/',
  api: 'https://visualization.osdr.nasa.gov/radlab/api/?spacecraft=ISS&instrument=DosTel&timestamp%3E=2022-04-02T23%3A00&timestamp%3C2022-04-03T00%3A00&absorbed_dose_rate&format=json',
  exercise: 'https://www.nasa.gov/directorates/esdmd/hhp/exercise-physiology-and-countermeasures/',
  csaRadiation: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp',
  csaScience: 'https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp'
};

const baseState = {
  current: {},
  history: [],
  observations: [],
  wellbeingEntries: [],
  sensorProfiles: {},
  crewCheck: { key: 'none', at: null },
  tasks: {},
  remindedTasks: [],
  alertRules: null,
  alerts: [],
  scans: [],
  simulationEnabled: true,
  carePackets: [],
  latestMedia: null
};
const state = loadState();
persist(); // Write back the source-first migration so the old fictional timeline is removed.
let activeView = 'today';
let trendMetric = 'heart_rate';
let scenarioTrendMetric = 'heart_rate';
let radlab = null;
let radlabInstrument = 'DosTel1';
let radlabWindow = { start: '2022-04-02T23:00', end: '2022-04-03T00:00' };
let radlabLoading = false;
let radlabSnapshotLoaded = false;
let radlabError = '';
let eda = null;
let edaMissions = [];
let edaMission = 'RR-1';
let edaWindow = { start: '2014-09-21T00:00', end: '2014-09-22T00:00' };
let edaLoading = false;
let edaError = '';
let edaMetric = 'cabin_temperature';
let sensorConnections = {};
let currentMediaUrl = null;
let currentScanUrl = null;
let toastTimer;

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const merged = { ...baseState, ...stored };
    // Retain only measurements entered through recognized source adapters.
    merged.history = [];
    const acceptedSources = new Set(['ble_gatt','device_import','qus_export','radlab_api','eda_api']);
    merged.observations = Array.isArray(stored.observations) ? stored.observations.filter(item => item && item.value !== null && item.value !== '' && Number.isFinite(Number(item.value)) && acceptedSources.has(item?.source?.kind)) : [];
    merged.scans = Array.isArray(stored.scans) ? stored.scans.filter(scan => scan?.source === 'qus_export') : [];
    merged.wellbeingEntries = Array.isArray(stored.wellbeingEntries) ? stored.wellbeingEntries : [];
    merged.alerts = Array.isArray(stored.alerts) ? stored.alerts : [];
    merged.remindedTasks = Array.isArray(stored.remindedTasks) ? stored.remindedTasks : [];
    merged.alertRules = stored.alertRules && Array.isArray(stored.alertRules.rules) ? stored.alertRules : null;
    merged.sensorProfiles = stored.sensorProfiles && typeof stored.sensorProfiles === 'object' ? stored.sensorProfiles : {};
    merged.current = {};
    return merged;
  } catch { return structuredClone(baseState); }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function openHandoffStore() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Local attachment storage is unavailable'));
    const request = indexedDB.open('beyond-pulse-handoffs-v1', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('attachments')) request.result.createObjectStore('attachments');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local attachment storage'));
  });
}
async function saveHandoffAttachment(id, file) {
  const db = await openHandoffStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').put({ blob: file.slice(0, file.size, file.type), name: file.name, type: file.type, size: file.size }, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Could not save the attachment locally')); };
  });
}
async function getHandoffAttachment(id) {
  const db = await openHandoffStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attachments', 'readonly');
    const request = tx.objectStore('attachments').get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not read the local attachment'));
    tx.oncomplete = () => db.close();
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Could not read the local attachment')); };
  });
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function toast(message) {
  const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
function setView(view) {
  activeView = view;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  const labels = { today: 'HOME', trends: 'TRENDS', checkin: 'WELLNESS', bone: 'BODY HEALTH', radiation: 'ENVIRONMENT', routine: 'ACTIVITY', care: 'MEDICAL SUPPORT', sources: 'ABOUT' };
  document.getElementById('page-crumb').textContent = labels[view] || 'TODAY';
  render();
  document.getElementById('content').focus({ preventScroll: true });
}
function showModal(title, body) {
  const modal = document.getElementById('modal');
  document.getElementById('modal-body').innerHTML = `<h2>${title}</h2>${body}`;
  if (!modal.open) modal.showModal();
  document.getElementById('reminder-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const id = `custom-${Date.now()}`;
    state.customTasks = [...(state.customTasks || []), { id, time: document.getElementById('new-reminder-time').value, title: document.getElementById('new-reminder').value.trim(), detail: 'Personal browser-local reminder', group: 'Personal' }];
    persist(); modal.close(); render(); toast('Reminder saved on this device');
  });
}
function svgSpark(values, amber = false) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * 100).toFixed(1)},${(19 - (v - min) / span * 15).toFixed(1)}`).join(' ');
  return `<svg class="mini-line ${amber ? 'amber' : ''}" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
const metricMeta = {
  heart_rate: { name: 'Heart rate', unit: 'bpm', icon: '♡', decimals: 0 },
  spo2: { name: 'Blood oxygen', unit: '%', icon: '◉', decimals: 1 },
  body_temperature: { name: 'Sensor temperature', unit: '°C', icon: '⌖', decimals: 2 },
  respiration: { name: 'Respiration', unit: 'breaths/min', icon: '≈', decimals: 1 },
  sleep: { name: 'Sleep duration', unit: 'h', icon: '☾', decimals: 1 },
  resting_pulse: { name: 'Resting pulse', unit: 'bpm', icon: '♡', decimals: 0 },
  hrv: { name: 'HRV', unit: 'ms', icon: '⌁', decimals: 1 },
  exercise_minutes: { name: 'Exercise', unit: 'min', icon: '↗', decimals: 0 },
  rr_interval: { name: 'RR interval', unit: 'ms', icon: '⌁', decimals: 0 },
  energy_expended: { name: 'Sensor energy', unit: 'kJ', icon: '↗', decimals: 1 },
  systolic_bp: { name: 'Systolic pressure', unit: 'mmHg', icon: '↗', decimals: 0 },
  diastolic_bp: { name: 'Diastolic pressure', unit: 'mmHg', icon: '↘', decimals: 0 },
  mean_bp: { name: 'Mean pressure', unit: 'mmHg', icon: '↔', decimals: 0 },
  muscle_mass: { name: 'Muscle mass · device-reported', unit: 'kg', icon: '◒', decimals: 2 },
  muscle_percentage: { name: 'Muscle percentage · device-reported', unit: '%', icon: '◒', decimals: 1 },
  fat_free_mass: { name: 'Fat-free mass · device-reported', unit: 'kg', icon: '◒', decimals: 2 },
  soft_lean_mass: { name: 'Soft lean mass · device-reported', unit: 'kg', icon: '◒', decimals: 2 },
  body_water_mass: { name: 'Body water mass · device-reported', unit: 'kg', icon: '◌', decimals: 2 },
  body_fat_percentage: { name: 'Body fat · device-reported', unit: '%', icon: '◒', decimals: 1 },
  body_weight: { name: 'Body mass · device-reported', unit: 'kg', icon: '⌖', decimals: 2 },
  basal_metabolism: { name: 'Basal metabolism · device-reported', unit: 'kJ', icon: '↗', decimals: 0 },
  body_impedance: { name: 'Body impedance · device-reported', unit: 'Ω', icon: '⌁', decimals: 1 },
  body_height: { name: 'Height · device-reported', unit: 'm', icon: '↕', decimals: 2 },
  body_mass_index: { name: 'Body mass index · device-reported', unit: 'kg/m²', icon: '◒', decimals: 1 },
  treadmill_speed: { name: 'Treadmill speed · device-reported', unit: 'km/h', icon: '↗', decimals: 1 },
  treadmill_cadence: { name: 'Treadmill cadence · device-reported', unit: 'steps/min', icon: '↻', decimals: 0 },
  treadmill_distance: { name: 'Treadmill distance · device-reported', unit: 'm', icon: '↗', decimals: 0 },
  treadmill_incline: { name: 'Treadmill incline · device-reported', unit: '%', icon: '↗', decimals: 1 },
  treadmill_elevation_gain: { name: 'Elevation gain · device-reported', unit: 'm', icon: '↕', decimals: 1 },
  treadmill_average_speed: { name: 'Average treadmill speed', unit: 'km/h', icon: '↗', decimals: 1 },
  treadmill_pace: { name: 'Treadmill pace · time/500 m', unit: 's/500 m', icon: '◷', decimals: 0 },
  treadmill_average_pace: { name: 'Average treadmill pace · time/500 m', unit: 's/500 m', icon: '◷', decimals: 0 },
  treadmill_elevation_loss: { name: 'Elevation loss', unit: 'm', icon: '↕', decimals: 1 },
  fitness_energy_per_hour: { name: 'Fitness energy rate', unit: 'kcal/h', icon: '↗', decimals: 0 },
  fitness_energy_per_minute: { name: 'Fitness energy rate', unit: 'kcal/min', icon: '↗', decimals: 1 },
  fitness_met: { name: 'Fitness MET', unit: 'MET', icon: '◉', decimals: 1 },
  treadmill_elapsed_time: { name: 'Exercise elapsed time', unit: 'min', icon: '◷', decimals: 1 },
  treadmill_remaining_time: { name: 'Exercise remaining time', unit: 'min', icon: '◷', decimals: 1 },
  treadmill_force: { name: 'Treadmill belt force', unit: 'N', icon: '↗', decimals: 0 },
  treadmill_power: { name: 'Treadmill power', unit: 'W', icon: '↗', decimals: 0 },
  qus_speed_of_sound: { name: 'Ultrasound speed of sound', unit: 'm/s', icon: '⌬', decimals: 1 },
  cabin_temperature: { name: 'ISS environment temperature', unit: '°C', icon: '⌖', decimals: 1 },
  cabin_humidity: { name: 'ISS relative humidity', unit: '%', icon: '◌', decimals: 1 },
  cabin_co2: { name: 'ISS CO₂', unit: 'ppm', icon: '◍', decimals: 0 },
  absorbed_dose_rate: { name: 'Absorbed dose rate', unit: 'μGy/h', icon: '✳', decimals: 3 },
  dose_equivalent_rate: { name: 'Dose-equivalent rate', unit: 'μSv/h', icon: '✳', decimals: 3 },
  particle_flux: { name: 'Particle flux', unit: 'cm⁻² sr⁻¹ s⁻¹', icon: '✳', decimals: 3 }
};
const SIMULATION_SOURCE = 'Maya · NASA-inspired simulation';
const SCENARIO_END_UTC = Date.parse('2026-11-15T12:00:00Z');
function scenarioSeries(metric = null) {
  const now = SCENARIO_END_UTC;
  const samples = [];
  const add = (key, value, timestamp) => {
    if (metric && metric !== key) return;
    samples.push({
      metric: key, value: Number(value), unit: metricMeta[key]?.unit || '',
      measuredAt: new Date(timestamp).toISOString(), receivedAt: new Date(timestamp).toISOString(),
      sourceKind: 'simulation', sourceLabel: SIMULATION_SOURCE, quality: 'illustrative', flags: [],
      context: { profile: 'Maya', scenario: 'orbital-crew-health', synthetic: true, window: '7-day demonstration' }
    });
  };
  for (let index = 0; index < 14; index++) {
    const time = now - (13 - index) * 12 * 60 * 60 * 1000 - 5 * 60 * 1000;
    const heartRate = 68 + 3.2 * Math.sin(index * 0.68) + 1.1 * Math.cos(index * 1.16);
    add('heart_rate', heartRate, time);
    add('resting_pulse', 61 + 2.2 * Math.sin(index * 0.39), time);
    add('rr_interval', 60000 / heartRate + 8 * Math.sin(index * 1.7), time);
    add('spo2', 97.3 + 0.45 * Math.sin(index * 0.53) + 0.18 * Math.cos(index * 0.91), time);
    add('body_temperature', 36.62 + 0.11 * Math.sin(index * 0.48) + 0.035 * Math.cos(index * 1.1), time);
    add('respiration', 14.1 + 0.85 * Math.sin(index * 0.62) + 0.25 * Math.cos(index * 1.35), time);
    add('hrv', 49 + 5.2 * Math.sin(index * 0.57) + 2.3 * Math.cos(index * 0.31), time);
    add('systolic_bp', 116 + 4.2 * Math.sin(index * 0.49), time);
    add('diastolic_bp', 74 + 3.1 * Math.cos(index * 0.56), time);
    add('mean_bp', 88 + 3.3 * Math.sin(index * 0.51 + 0.4), time);
    add('energy_expended', 9100 + 450 * Math.sin(index * 0.3), time);
    add('cabin_temperature', 22.5 + 0.65 * Math.sin(index * 0.39), time);
    add('cabin_humidity', 45 + 2.2 * Math.cos(index * 0.46), time);
    add('cabin_co2', 1530 + 105 * Math.sin(index * 0.42) + 35 * Math.cos(index * 0.77), time);
    add('absorbed_dose_rate', 4.2 + 0.48 * Math.sin(index * 0.31), time);
    add('dose_equivalent_rate', 18.2 + 2.1 * Math.sin(index * 0.31) + 0.8 * Math.cos(index * 0.83), time);
    add('particle_flux', 0.12 + 0.025 * Math.cos(index * 0.59), time);
  }
  for (let index = 0; index < 7; index++) {
    const time = now - (6 - index) * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000;
    const exercise = 66 + 13 * Math.sin(index * 0.83) + 5 * Math.cos(index * 1.1);
    const speed = 8.1 + 0.55 * Math.sin(index * 0.67);
    add('sleep', 7.15 + 0.5 * Math.sin(index * 0.92) - 0.12 * Math.cos(index * 0.42), time);
    add('exercise_minutes', exercise, time);
    add('treadmill_speed', speed, time);
    add('treadmill_average_speed', speed - 0.2, time);
    add('treadmill_cadence', 158 + 6 * Math.sin(index * 0.75), time);
    add('treadmill_distance', speed * exercise / 60 * 1000, time);
    add('treadmill_incline', 1 + 0.3 * Math.sin(index * 0.6), time);
    add('treadmill_elevation_gain', speed * exercise / 60 * 10, time);
    add('treadmill_elevation_loss', 0, time);
    add('treadmill_pace', 3600 / (speed * 2), time);
    add('treadmill_average_pace', 3600 / ((speed - 0.2) * 2), time);
    add('fitness_energy_per_hour', 520 + 35 * Math.sin(index * 0.65), time);
    add('fitness_energy_per_minute', 8.7 + 0.6 * Math.sin(index * 0.65), time);
    add('fitness_met', 7.2 + 0.5 * Math.sin(index * 0.58), time);
    add('treadmill_elapsed_time', exercise, time);
    add('treadmill_remaining_time', 0, time);
    add('treadmill_force', 185 + 10 * Math.cos(index * 0.43), time);
    add('treadmill_power', 235 + 18 * Math.sin(index * 0.56), time);
  }
  for (let index = 0; index < 4; index++) {
    const time = now - (3 - index) * 48 * 60 * 60 * 1000 - 60 * 60 * 1000;
    const mass = 67.2 + 0.3 * Math.sin(index * 0.8);
    const muscle = 41.8 - index * 0.08 + 0.04 * Math.sin(index);
    add('body_weight', mass, time);
    add('body_height', 1.72, time);
    add('body_mass_index', mass / (1.72 * 1.72), time);
    add('muscle_mass', muscle, time);
    add('muscle_percentage', muscle / mass * 100, time);
    add('fat_free_mass', 52.4 - index * 0.04, time);
    add('soft_lean_mass', 50.8 - index * 0.04, time);
    add('body_water_mass', 36.5 + 0.12 * Math.sin(index), time);
    add('body_fat_percentage', 21.8 + 0.25 * Math.sin(index * 0.7), time);
    add('basal_metabolism', 5850 + 35 * Math.sin(index), time);
    add('body_impedance', 508 + 8 * Math.cos(index * 0.6), time);
  }
  for (let index = 0; index < 3; index++) {
    const time = now - (2 - index) * 72 * 60 * 60 * 1000 - 30 * 60 * 1000;
    add('qus_speed_of_sound', 1542 + 2.8 * Math.sin(index * 1.2), time);
  }
  return samples.sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
}
function metricSeries(metric) {
  const series = state.observations.filter(item => item.metric === metric && Number.isFinite(Number(item.value))).map(item => ({
    metric, value: Number(item.value), unit: item.unit || metricMeta[metric]?.unit || '',
    measuredAt: item.measuredAt || null, receivedAt: item.receivedAt || null,
    sourceKind: item.source?.kind || 'unknown', sourceLabel: item.source?.label || 'Unknown source',
    quality: item.quality?.state || 'unknown', flags: item.quality?.flags || [], context: item.context || {}
  }));
  if (metric === 'qus_speed_of_sound') state.scans.forEach((scan, index) => {
    series.push({ metric, value: Number(scan.sos), unit: 'm/s', measuredAt: scan.measuredAt || null, receivedAt: scan.receivedAt || null, sourceKind: 'qus_export', sourceLabel: `QUS export · ${scan.device || 'device not reported'}`, quality: scan.quality || 'unknown', flags: [], context: { bodySite: scan.site || null, sourceTime: scan.sourceTime || null, timeBasis: scan.timeBasis || null }, sequence: index });
  });
  if (metric === 'absorbed_dose_rate' || metric === 'dose_equivalent_rate' || metric === 'particle_flux') {
    const field = metric === 'particle_flux' ? 'flux' : metric;
    (radlab?.records || []).forEach(row => {
      if (row[field] === null || row[field] === undefined || row[field] === '') return;
      const value = Number(row[field]);
      if (Number.isFinite(value)) series.push({ metric, value, unit: metricMeta[metric].unit, measuredAt: archiveUtc(row.timestamp), receivedAt: radlab.fetched_at_utc || null, sourceKind: 'radlab_api', sourceLabel: `NASA RadLab · ${row.instrument_id || 'ISS instrument'}`, quality: 'valid', flags: [], context: { spacecraft: 'ISS', module: row.module || null, latitudeDeg: Number(row.latitude) || null, longitudeDeg: Number(row.longitude) || null, altitudeKm: Number(row.altitude) || null, magneticB: Number(row.B) || null, magneticL: Number(row.L) || null, instrumentId: row.instrument_id || null } });
    });
  }
  const edaField = { cabin_temperature: 'temperature_iss', cabin_humidity: 'humidity_iss', cabin_co2: 'co2_iss' }[metric];
  if (edaField) (eda?.records || []).forEach(row => {
    if (row[edaField] === null || row[edaField] === undefined || row[edaField] === '') return;
    const value = Number(row[edaField]);
    if (Number.isFinite(value)) series.push({ metric, value, unit: metricMeta[metric].unit, measuredAt: archiveUtc(row.time), receivedAt: eda.fetched_at_utc || null, sourceKind: 'eda_api', sourceLabel: `NASA EDA archive · ${eda.mission}`, quality: 'valid', flags: [], context: { mission: eda.mission, groundValue: row[edaField.replace('_iss', '_ground')] ?? null } });
  });
  return series.sort((a, b) => Date.parse(a.measuredAt || a.receivedAt || 0) - Date.parse(b.measuredAt || b.receivedAt || 0) || (a.sequence || 0) - (b.sequence || 0));
}
function latestSignal(metric) { return metricSeries(metric).at(-1) || null; }
function archiveUtc(raw) {
  if (!raw) return null;
  const value = String(raw).trim().replace(' ', 'T');
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
}
function historyData() { return state.observations.slice().sort((a, b) => Date.parse(a.measuredAt || a.receivedAt || 0) - Date.parse(b.measuredAt || b.receivedAt || 0)); }
function observationTimeline() {
  const rows = Object.keys(metricMeta).flatMap(metric => metricSeries(metric));
  const unique = new Map(rows.map(row => [`${row.metric}:${row.value}:${row.measuredAt || row.receivedAt}:${row.sourceKind}:${row.sourceLabel}`, row]));
  return [...unique.values()].sort((a,b) => (Date.parse(a.measuredAt || a.receivedAt || '') || 0) - (Date.parse(b.measuredAt || b.receivedAt || '') || 0));
}
function trendSummary() {
  const liveCount = state.observations.filter(item => item.source?.kind === 'ble_gatt').length;
  const archiveCount = (radlab?.records?.length || 0) + (eda?.records?.length || 0);
  return { liveCount, archiveCount, metrics: Object.keys(metricMeta).filter(metric => metricSeries(metric).length) };
}
function chartSvg(values, { baseline, unit = '', labels = null, color = '#7de0c3', id = 'chart', height = 168 } = {}) {
  if (!values.length) return '';
  const W = 720, H = height, L = 42, R = 9, T = 12, B = 25, PW = W - L - R, PH = H - T - B;
  let lo = Math.min(...values, baseline ?? Infinity), hi = Math.max(...values, baseline ?? -Infinity);
  const pad = Math.max((hi - lo) * .2, .5); lo -= pad; hi += pad;
  const x = i => L + (values.length === 1 ? PW / 2 : (i / (values.length - 1)) * PW);
  const y = v => T + (hi - v) / (hi - lo) * PH;
  const coords = values.map((v, i) => [x(i), y(v)]);
  const d = coords.map(([cx, cy], i) => `${i ? 'L' : 'M'}${cx.toFixed(1)},${cy.toFixed(1)}`).join(' ');
  const area = `${d} L ${coords.at(-1)[0].toFixed(1)},${(T + PH).toFixed(1)} L ${L},${(T + PH).toFixed(1)} Z`;
  const xLabels = (labels || ['Start', '25%', '50%', '75%', 'Latest']).map((label, i, arr) => `<text class="chart-label" text-anchor="${i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}" x="${L + i / (arr.length - 1 || 1) * PW}" y="${H - 5}">${esc(label)}</text>`).join('');
  const grid = [0, 1, 2, 3].map(i => { const gy = T + (PH * i / 3); const val = hi - (hi - lo) * i / 3; const precision = unit === '' ? 2 : (unit === 'h' || unit === 'L' || unit === '°C' ? 1 : 0); return `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}"/><text class="chart-label" x="0" y="${gy + 3}">${val.toFixed(precision)}</text>`; }).join('');
  const points = coords.map(([cx, cy], i) => `<circle class="chart-point ${i === coords.length - 1 ? 'last' : ''}" cx="${cx}" cy="${cy}" r="${i === coords.length - 1 ? 4 : 2.2}"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(id)} trend chart"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}${baseline != null ? `<line class="chart-baseline" x1="${L}" x2="${W - R}" y1="${y(baseline)}" y2="${y(baseline)}"/>` : ''}<path class="chart-area" d="${area}"/><path class="chart-line" pathLength="1" d="${d}" style="stroke:${color}"/>${points}${xLabels}</svg>`;
}
function heading(kicker, title, description, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow"><span class="line"></span>${kicker}</div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
function signalFreshness(signal) {
  if (!signal) return 'UNAVAILABLE';
  if (signal.sourceKind === 'simulation') return 'SIMULATED';
  if (signal.sourceKind === 'radlab_api' || signal.sourceKind === 'eda_api') return 'ARCHIVE';
  if (signal.sourceKind === 'crew_log') return 'CREW LOG';
  if (signal.sourceKind === 'device_import' || signal.sourceKind === 'qus_export') return 'IMPORTED';
  const age = Date.now() - Date.parse(signal.receivedAt || '');
  return age < 30000 ? 'LIVE' : 'STALE';
}
function sampleTime(signal) {
  const value = signal?.measuredAt || signal?.receivedAt;
  if (!value) return signal?.sourceKind === 'crew_log' ? 'Time not recorded' : 'No sample yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time not recorded';
  const utcLabel = date.toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' });
  if (signal.sourceKind === 'simulation') return `${utcLabel} UTC · scenario time`;
  if (signal.measuredAt) return `${utcLabel} UTC · source time`;
  const received = `${utcLabel} UTC · received time`;
  return signal.context?.sourceTime ? `${received} · device time ${signal.context.sourceTime} (${signal.context.timeBasis || 'timezone not supplied'})` : received;
}
function metricCard(key) {
  const m = metricMeta[key], signal = latestSignal(key), status = signalFreshness(signal);
  const value = signal ? `${Number(signal.value).toFixed(m.decimals)}<span class="metric-unit"> ${esc(signal.unit || m.unit)}</span>` : '—';
  const detail = signal ? `${status} · ${esc(signal.sourceLabel)}<br>${esc(sampleTime(signal))}${signal.quality === 'questionable' ? '<br>Device flagged this reading for review.' : ''}` : 'No reading · connect or import a source';
  return `<article class="card metric"><div class="metric-top"><span>${esc(m.name)}</span><span class="metric-glyph">${m.icon}</span></div><div class="metric-value" data-signal-value="${key}">${value}</div><div class="metric-foot" data-signal-meta="${key}">${detail}</div></article>`;
}
const sensorSpecs = {
  heart_rate: { label: 'Heart-rate monitor', service: 'heart_rate', characteristic: 'heart_rate_measurement' },
  spo2: { label: 'Pulse oximeter', service: 'pulse_oximeter', characteristic: 'plx_continuous_measurement' },
  body_temperature: { label: 'Temperature sensor', service: 'health_thermometer', characteristic: 'temperature_measurement' },
  systolic_bp: { label: 'Blood-pressure monitor', service: 'blood_pressure', characteristic: 'blood_pressure_measurement' },
  muscle_mass: { label: 'Body-composition monitor', service: 'body_composition', characteristic: 'body_composition_measurement' },
  body_weight: { label: 'Weight scale', service: 'weight_scale', characteristic: 'weight_measurement' },
  treadmill_speed: { label: 'Fitness machine', service: 'fitness_machine', characteristic: 'treadmill_data' }
};
function sensorConnectionCard(metric) {
  const spec = sensorSpecs[metric], profile = state.sensorProfiles[metric], connection = sensorConnections[metric];
  const connected = !!connection?.device?.gatt?.connected;
  const supported = !!navigator.bluetooth && window.isSecureContext;
  const stateLabel = connected ? 'CONNECTED' : profile ? 'RECONNECT' : supported ? 'NOT LINKED' : 'UNSUPPORTED HERE';
  return `<article class="card sensor-connect-card"><div class="sensor-connect-top"><b>${esc(spec.label)}</b><span class="tag ${connected ? 'mint' : ''}">${stateLabel}</span></div><p>${profile && !connected ? `${esc(profile.name)} · reconnect when ready` : connected ? `${esc(connection.device.name || spec.label)} · streaming locally` : `Compatible Bluetooth LE ${esc(spec.label.toLowerCase())}`}</p>${profile?.batteryPercent != null ? `<small>Device battery · ${profile.batteryPercent}%</small>` : ''}<button class="button small ${connected ? 'ghost' : 'primary'}" data-sensor-connect="${metric}" ${supported ? '' : 'disabled'}>${connected ? 'Disconnect' : 'Connect'}</button>${!supported ? '<small>Bluetooth pairing requires a supported Chromium browser on localhost or HTTPS.</small>' : ''}</article>`;
}
function appendObservation({ metric, value, unit, sourceKind, sourceLabel, serviceUuid, characteristicUuid, measuredAt = null, quality = 'valid', flags = [], context = {}, sampleId = null }) {
  if (!metricMeta[metric] || value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return;
  const receivedAt = new Date().toISOString();
  const observation = {
    id: crypto.randomUUID(), sampleId: sampleId || crypto.randomUUID(), metric, value: Number(value), unit: unit || metricMeta[metric].unit,
    measuredAt, receivedAt, source: { kind: sourceKind, label: sourceLabel, serviceUuid, characteristicUuid },
    quality: { state: quality, flags }, context, parserVersion: 'beyond-pulse-adapters-v1'
  };
  state.observations.push(observation);
  state.observations = state.observations.slice(-5000);
  applyConfiguredRules({ metric, value: observation.value, unit: observation.unit, measuredAt, receivedAt, sourceKind, sourceLabel }, true);
  persist();
  refreshSignalReadout(metric);
}
function refreshSignalReadout(metric) {
  const signal = latestSignal(metric), meta = metricMeta[metric];
  if (!signal || !meta) return;
  document.querySelectorAll(`[data-signal-value="${metric}"]`).forEach(node => { node.innerHTML = `${Number(signal.value).toFixed(meta.decimals)}<span class="metric-unit"> ${esc(signal.unit || meta.unit)}</span>`; });
  document.querySelectorAll(`[data-signal-meta="${metric}"]`).forEach(node => { node.innerHTML = `${signalFreshness(signal)} · ${esc(signal.sourceLabel)}<br>${esc(sampleTime(signal))}${signal.quality === 'questionable' ? '<br>Device flagged this reading for review.' : ''}`; });
  document.querySelectorAll('#generate-ai-summary').forEach(button => { button.disabled = aiInputObservations().length === 0; });
}
function signedMantissa(value, bits) {
  const signBit = 1 << (bits - 1), modulus = 1 << bits;
  return value & signBit ? value - modulus : value;
}
function decodeSfloat16(view, offset) {
  if (offset + 2 > view.byteLength) throw new Error('Incomplete pulse-oximeter packet');
  const raw = view.getUint16(offset, true), mantissaRaw = raw & 0x0fff;
  if ([0x07ff, 0x0800, 0x0801, 0x07fe, 0x0802].includes(mantissaRaw)) return null;
  const mantissa = signedMantissa(mantissaRaw, 12), exponent = signedMantissa(raw >> 12, 4);
  const value = mantissa * (10 ** exponent);
  return Number.isFinite(value) ? value : null;
}
function decodeTemperatureFloat(view, offset) {
  if (offset + 4 > view.byteLength) throw new Error('Incomplete thermometer packet');
  const raw = view.getUint32(offset, true), mantissaRaw = raw & 0x00ffffff;
  if ([0x007fffff, 0x00800000, 0x00800001, 0x007ffffe, 0x00800002].includes(mantissaRaw)) return null;
  const mantissa = signedMantissa(mantissaRaw, 24), exponent = signedMantissa(raw >>> 24, 8);
  const value = mantissa * (10 ** exponent);
  return Number.isFinite(value) ? value : null;
}
function parseHeartRate(value, deviceName, bodySite = null) {
  if (value.byteLength < 2) throw new Error('Incomplete heart-rate packet');
  const flags = value.getUint8(0); let offset = 1;
  const bpm = flags & 1 ? (value.byteLength >= 3 ? value.getUint16(offset, true) : NaN) : value.getUint8(offset);
  offset += flags & 1 ? 2 : 1;
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 300) throw new Error('Invalid heart-rate value');
  const contactSupported = !!(flags & 0x04), contactDetected = !!(flags & 0x02), qualityFlags = [];
  if (contactSupported && !contactDetected) qualityFlags.push('sensor_contact_not_detected');
  appendObservation({ metric: 'heart_rate', value: bpm, unit: 'bpm', sourceKind: 'ble_gatt', sourceLabel: `BLE heart-rate monitor · ${deviceName || 'unnamed device'}`, serviceUuid: '0x180D', characteristicUuid: '0x2A37', quality: qualityFlags.length ? 'questionable' : 'valid', flags: qualityFlags, context: bodySite ? { bodySite } : {} });
  if (flags & 0x08) {
    if (offset + 2 > value.byteLength) throw new Error('Incomplete energy-expended field');
    appendObservation({ metric: 'energy_expended', value: value.getUint16(offset, true), unit: 'kJ', sourceKind: 'ble_gatt', sourceLabel: `BLE heart-rate monitor · ${deviceName || 'unnamed device'}`, serviceUuid: '0x180D', characteristicUuid: '0x2A37', quality: qualityFlags.length ? 'questionable' : 'valid', flags: qualityFlags, context: bodySite ? { bodySite } : {} });
    offset += 2;
  }
  if (flags & 0x10) {
    let index = 0;
    while (offset + 2 <= value.byteLength) {
      const intervalMs = value.getUint16(offset, true) * 1000 / 1024; offset += 2;
      appendObservation({ metric: 'rr_interval', value: intervalMs, unit: 'ms', sourceKind: 'ble_gatt', sourceLabel: `BLE heart-rate monitor · ${deviceName || 'unnamed device'}`, serviceUuid: '0x180D', characteristicUuid: '0x2A37', quality: qualityFlags.length ? 'questionable' : 'valid', flags: qualityFlags, context: { ...(bodySite ? { bodySite } : {}), intervalIndex: index++, basis: 'device-reported RR interval; not an HRV estimate' } });
    }
    if (offset !== value.byteLength) throw new Error('Malformed RR-interval field');
  }
}
function parseBloodPressure(value, deviceName) {
  if (value.byteLength < 7) throw new Error('Incomplete blood-pressure packet');
  const flags = value.getUint8(0); let offset = 1;
  let systolic = decodeSfloat16(value, offset), diastolic = decodeSfloat16(value, offset + 2), mean = decodeSfloat16(value, offset + 4); offset += 6;
  const unit = flags & 0x01 ? 'kPa' : 'mmHg';
  const factor = unit === 'kPa' ? 7.50062 : 1;
  const qualityFlags = [];
  let deviceTime = null;
  if (flags & 0x02) {
    const stamp = parseBluetoothDateTime(value, offset); offset = stamp.offset;
    // This device timestamp has no timezone; retain it as device time rather than UTC.
    deviceTime = stamp.raw;
  }
  if (flags & 0x04) {
    const pulse = decodeSfloat16(value, offset); offset += 2;
    if (pulse !== null) appendObservation({ metric: 'heart_rate', value: pulse, unit: 'bpm', sourceKind: 'ble_gatt', sourceLabel: `BLE blood-pressure monitor · ${deviceName || 'unnamed device'}`, serviceUuid: '0x1810', characteristicUuid: '0x2A35' });
  }
  if (flags & 0x08) offset += 1;
  if (flags & 0x10) {
    if (offset + 2 > value.byteLength) throw new Error('Incomplete blood-pressure quality status');
    const status = value.getUint16(offset, true); offset += 2;
    if (status) qualityFlags.push(`measurement_status_0x${status.toString(16)}`);
  }
  if (offset !== value.byteLength) throw new Error('Unexpected trailing blood-pressure data');
  const readings = [['systolic_bp', systolic], ['diastolic_bp', diastolic], ['mean_bp', mean]];
  readings.forEach(([metric, reading]) => { if (reading !== null) appendObservation({ metric, value: reading * factor, unit: 'mmHg', sourceKind: 'ble_gatt', sourceLabel: `BLE blood-pressure monitor · ${deviceName || 'unnamed device'}`, serviceUuid: '0x1810', characteristicUuid: '0x2A35', quality: qualityFlags.some(flag => flag.startsWith('measurement_status_')) ? 'questionable' : 'valid', flags: qualityFlags, context: { sourceUnit: unit, ...(deviceTime ? { sourceTime: deviceTime, timeBasis: 'device-local; timezone not supplied' } : {}) } }); });
}
function parseBodyComposition(value, deviceName) {
  if (value.byteLength < 4) throw new Error('Incomplete body-composition packet');
  const flags = value.getUint16(0, true); let offset = 2;
  if (flags & 0x1000) throw new Error('This record uses multiple packets; import the complete device export instead.');
  const imperial = !!(flags & 0x0001), massFactor = imperial ? 0.45359237 : 1;
  const bodyFat = value.getUint16(offset, true) / 10; offset += 2;
  let sourceTime = null;
  if (flags & 0x0002) { const stamp = parseBluetoothDateTime(value, offset); sourceTime = stamp.raw; offset = stamp.offset; }
  if (flags & 0x0004) offset += 1; // User ID is deliberately discarded.
  const records = [];
  const readU16 = () => { if (offset + 2 > value.byteLength) throw new Error('Incomplete body-composition field'); const result = value.getUint16(offset, true); offset += 2; return result; };
  if (flags & 0x0008) records.push(['basal_metabolism', readU16(), 'kJ']);
  if (flags & 0x0010) records.push(['muscle_percentage', readU16() / 10, '%']);
  if (flags & 0x0020) records.push(['muscle_mass', readU16() * (imperial ? 0.01 : 0.005) * massFactor, 'kg']);
  if (flags & 0x0040) records.push(['fat_free_mass', readU16() * (imperial ? 0.01 : 0.005) * massFactor, 'kg']);
  if (flags & 0x0080) records.push(['soft_lean_mass', readU16() * (imperial ? 0.01 : 0.005) * massFactor, 'kg']);
  if (flags & 0x0100) records.push(['body_water_mass', readU16() * (imperial ? 0.01 : 0.005) * massFactor, 'kg']);
  if (flags & 0x0200) records.push(['body_impedance', readU16() / 10, 'Ω']);
  if (flags & 0x0400) records.push(['body_weight', readU16() * (imperial ? 0.01 : 0.005) * massFactor, 'kg']);
  if (flags & 0x0800) records.push(['body_height', readU16() * (imperial ? 0.00254 : 0.001), 'm']);
  if (offset !== value.byteLength) throw new Error('Unexpected trailing body-composition data');
  records.unshift(['body_fat_percentage', bodyFat, '%']);
  const sampleId = crypto.randomUUID(), unit = imperial ? 'imperial' : 'SI';
  records.forEach(([metric, reading, readingUnit]) => appendObservation({ metric, value: reading, unit: readingUnit, sampleId, sourceKind: 'ble_gatt', sourceLabel: `BLE body-composition device · ${deviceName || 'unnamed device'}`, serviceUuid: '0x181B', characteristicUuid: '0x2A9C', context: { sourceUnit: unit, ...(sourceTime ? { sourceTime, timeBasis: 'device-local; timezone not supplied' } : {}) } }));
}
function parseWeightScale(value, deviceName) {
  if (value.byteLength < 3) throw new Error('Incomplete weight-scale packet');
  const flags = value.getUint8(0); let offset = 1;
  const imperial = !!(flags & 0x01), weightRaw = value.getUint16(offset, true); offset += 2;
  const weightKg = weightRaw * (imperial ? 0.01 * 0.45359237 : 0.005);
  let sourceTime = null;
  if (flags & 0x02) { const stamp = parseBluetoothDateTime(value, offset); sourceTime = stamp.raw; offset = stamp.offset; }
  if (flags & 0x04) offset += 1; // User ID is deliberately discarded.
  let bmi = null, heightM = null;
  if (flags & 0x08) {
    if (offset + 4 > value.byteLength) throw new Error('Incomplete weight-scale BMI/height fields');
    bmi = value.getUint16(offset, true) / 10; offset += 2;
    const heightRaw = value.getUint16(offset, true); offset += 2;
    heightM = heightRaw * (imperial ? 0.00254 : 0.001);
  }
  if (offset !== value.byteLength) throw new Error('Unexpected trailing weight-scale data');
  const sampleId = crypto.randomUUID(), source = `BLE weight scale · ${deviceName || 'unnamed device'}`;
  const context = { sourceUnit: imperial ? 'imperial' : 'SI', ...(sourceTime ? { sourceTime, timeBasis: 'device-local; timezone not supplied' } : {}) };
  appendObservation({ metric: 'body_weight', value: weightKg, unit: 'kg', sourceKind: 'ble_gatt', sourceLabel: source, serviceUuid: '0x181D', characteristicUuid: '0x2A9D', sampleId, context });
  if (bmi !== null) appendObservation({ metric: 'body_mass_index', value: bmi, unit: 'kg/m²', sourceKind: 'ble_gatt', sourceLabel: source, serviceUuid: '0x181D', characteristicUuid: '0x2A9D', sampleId, context });
  if (heightM !== null) appendObservation({ metric: 'body_height', value: heightM, unit: 'm', sourceKind: 'ble_gatt', sourceLabel: source, serviceUuid: '0x181D', characteristicUuid: '0x2A9D', sampleId, context });
}
function parseFitnessMachineTreadmill(value, deviceName) {
  if (value.byteLength < 2) throw new Error('Incomplete treadmill-data packet');
  const flags = value.getUint16(0, true); let offset = 2;
  const records = [];
  // If bit 0 (More Data) is clear, instantaneous speed is present.
  const requireBytes = count => { if (offset + count > value.byteLength) throw new Error('Incomplete treadmill-data field'); };
  const readU24 = () => { requireBytes(3); const result = value.getUint8(offset) | (value.getUint8(offset + 1) << 8) | (value.getUint8(offset + 2) << 16); offset += 3; return result; };
  if (!(flags & 0x0001)) { requireBytes(2); records.push(['treadmill_speed', value.getUint16(offset, true) * 0.01]); offset += 2; }
  if (flags & 0x0002) { requireBytes(2); records.push(['treadmill_average_speed', value.getUint16(offset, true) * 0.01]); offset += 2; }
  if (flags & 0x0004) records.push(['treadmill_distance', readU24()]);
  if (flags & 0x0008) { requireBytes(4); records.push(['treadmill_incline', value.getInt16(offset, true) * 0.1]); offset += 4; } // Incline and ramp-angle fields.
  if (flags & 0x0010) { requireBytes(4); records.push(['treadmill_elevation_gain', value.getUint16(offset, true) * 0.1]); records.push(['treadmill_elevation_loss', value.getUint16(offset + 2, true) * 0.1]); offset += 4; }
  if (flags & 0x0020) { requireBytes(2); records.push(['treadmill_pace', value.getUint16(offset, true)]); offset += 2; }
  if (flags & 0x0040) { requireBytes(2); records.push(['treadmill_average_pace', value.getUint16(offset, true)]); offset += 2; }
  if (flags & 0x0080) { requireBytes(5); records.push(['energy_expended', value.getUint16(offset, true) * 4.184]); records.push(['fitness_energy_per_hour', value.getUint16(offset + 2, true)]); records.push(['fitness_energy_per_minute', value.getUint8(offset + 4)]); offset += 5; }
  if (flags & 0x0100) { requireBytes(1); records.push(['heart_rate', value.getUint8(offset)]); offset += 1; }
  if (flags & 0x0200) { requireBytes(1); records.push(['fitness_met', value.getUint8(offset) * 0.1]); offset += 1; }
  if (flags & 0x0400) { requireBytes(2); records.push(['treadmill_elapsed_time', value.getUint16(offset, true) / 60]); offset += 2; }
  if (flags & 0x0800) { requireBytes(2); records.push(['treadmill_remaining_time', value.getUint16(offset, true) / 60]); offset += 2; }
  if (flags & 0x1000) { requireBytes(4); records.push(['treadmill_force', value.getInt16(offset, true)]); records.push(['treadmill_power', value.getInt16(offset + 2, true)]); offset += 4; }
  requireBytes(0);
  if (offset !== value.byteLength) throw new Error('Unexpected or incomplete treadmill-data fields');
  if (!records.length) return; // Fragment carries no supported optional field.
  const sampleId = crypto.randomUUID();
  records.forEach(([metric, reading]) => appendObservation({ metric, value: reading, unit: metricMeta[metric].unit, sampleId, sourceKind: 'ble_gatt', sourceLabel: `BLE fitness machine · ${deviceName || 'unnamed device'}`, serviceUuid: '0x1826', characteristicUuid: '0x2ACD' }));
}
function parseBluetoothDateTime(value, offset) {
  if (offset + 7 > value.byteLength) throw new Error('Incomplete pulse-oximeter timestamp');
  const parts = [value.getUint16(offset, true), value.getUint8(offset + 2), value.getUint8(offset + 3), value.getUint8(offset + 4), value.getUint8(offset + 5), value.getUint8(offset + 6)];
  const raw = `${String(parts[0]).padStart(4,'0')}-${String(parts[1]).padStart(2,'0')}-${String(parts[2]).padStart(2,'0')} ${String(parts[3]).padStart(2,'0')}:${String(parts[4]).padStart(2,'0')}:${String(parts[5]).padStart(2,'0')} (device time; timezone not supplied)`;
  return { raw, offset: offset + 7 };
}
function statusNames(value, mapping) { return mapping.filter(([bit]) => value & (1 << bit)).map(([, name]) => name); }
function parsePulseOximeter(value, deviceName, spotCheck = false) {
  if (value.byteLength < 1) throw new Error('Incomplete pulse-oximeter packet');
  const flags = value.getUint8(0); let offset = 1;
  const readPair = () => { const spo2 = decodeSfloat16(value, offset); const pulse = decodeSfloat16(value, offset + 2); offset += 4; return { spo2, pulse }; };
  const normal = readPair(), variants = { normal };
  if (!spotCheck && (flags & 0x01)) variants.fast = readPair();
  if (!spotCheck && (flags & 0x02)) variants.slow = readPair();
  let sourceTime = null;
  if (spotCheck && (flags & 0x01)) { const time = parseBluetoothDateTime(value, offset); sourceTime = time.raw; offset = time.offset; }
  let measurementStatus = 0, deviceStatus = 0;
  if (spotCheck ? (flags & 0x02) : (flags & 0x04)) {
    if (offset + 2 > value.byteLength) throw new Error('Incomplete pulse-oximeter measurement status');
    measurementStatus = value.getUint16(offset, true); offset += 2;
  }
  if (spotCheck ? (flags & 0x04) : (flags & 0x08)) {
    if (offset + 3 > value.byteLength) throw new Error('Incomplete pulse-oximeter sensor status');
    deviceStatus = value.getUint8(offset) | (value.getUint8(offset + 1) << 8) | (value.getUint8(offset + 2) << 16); offset += 3;
  }
  if (flags & (spotCheck ? 0x08 : 0x10)) offset += 2;
  if (offset > value.byteLength) throw new Error('Malformed pulse-oximeter packet');
  if (offset !== value.byteLength) throw new Error('Unexpected trailing pulse-oximeter data');
  const preferred = [variants.slow, variants.fast, variants.normal].find(pair => pair && (pair.spo2 !== null || pair.pulse !== null));
  if (!preferred) throw new Error('No valid SpO₂ or pulse value in this packet');
  const measurementFlags = statusNames(measurementStatus, [[5,'measurement_ongoing'],[6,'early_estimated_data'],[9,'stored_measurement'],[10,'demonstration_data'],[11,'test_data'],[12,'calibration_ongoing'],[13,'measurement_unavailable'],[14,'questionable_measurement'],[15,'invalid_measurement']]);
  const deviceFlags = statusNames(deviceStatus, [[0,'display_update_ongoing'],[1,'equipment_malfunction'],[2,'signal_processing_irregularity'],[3,'inadequate_signal'],[4,'poor_signal'],[5,'low_perfusion'],[6,'erratic_signal'],[7,'nonpulsatile_signal'],[8,'questionable_pulse'],[9,'signal_analysis_ongoing'],[10,'sensor_interference'],[11,'sensor_unconnected'],[12,'unknown_sensor'],[13,'sensor_displaced'],[14,'sensor_malfunction'],[15,'sensor_disconnected']]);
  const statusFlags = [...measurementFlags, ...deviceFlags];
  const invalid = measurementFlags.includes('measurement_unavailable') || measurementFlags.includes('invalid_measurement');
  const quality = statusFlags.length ? 'questionable' : 'valid';
  if (!invalid) {
    const sampleId = crypto.randomUUID(), context = { selectedProfile: variants.slow ? 'slow (motion-resistant)' : variants.fast ? 'fast response' : 'normal', variants: Object.fromEntries(Object.entries(variants).map(([key,pair]) => [key, { spo2: pair.spo2, pulse: pair.pulse }])), ...(sourceTime ? { sourceTime, timeBasis: 'device-local; timezone not supplied' } : {}), ...(spotCheck && (flags & 0x10) ? { deviceClock: 'not set' } : {}) };
    const characteristicUuid = spotCheck ? '0x2A5E' : '0x2A5F';
    if (preferred.spo2 !== null) appendObservation({ metric: 'spo2', value: preferred.spo2, unit: '%', sampleId, sourceKind: 'ble_gatt', sourceLabel: `BLE pulse oximeter · ${deviceName || 'unnamed device'}`, serviceUuid: '0x1822', characteristicUuid, quality, flags: statusFlags, context });
    if (preferred.pulse !== null) appendObservation({ metric: 'heart_rate', value: preferred.pulse, unit: 'bpm', sampleId, sourceKind: 'ble_gatt', sourceLabel: `BLE pulse oximeter · ${deviceName || 'unnamed device'}`, serviceUuid: '0x1822', characteristicUuid, quality, flags: statusFlags, context });
  }
}
function parseThermometer(value, deviceName) {
  if (value.byteLength < 5) throw new Error('Incomplete thermometer packet');
  const flags = value.getUint8(0); let offset = 1;
  let celsius = decodeTemperatureFloat(value, offset); offset += 4;
  if (celsius === null) throw new Error('Thermometer reported an invalid value');
  if (flags & 0x01) celsius = (celsius - 32) * 5 / 9;
  let deviceLocalTime = null, temperatureType = null;
  if (flags & 0x02) {
    if (offset + 7 > value.byteLength) throw new Error('Incomplete device time field');
    const year = value.getUint16(offset, true), month = value.getUint8(offset + 2), day = value.getUint8(offset + 3), hour = value.getUint8(offset + 4), minute = value.getUint8(offset + 5), second = value.getUint8(offset + 6);
    deviceLocalTime = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')} (device local time; timezone not supplied)`;
    offset += 7;
  }
  if (flags & 0x04) { if (offset >= value.byteLength) throw new Error('Incomplete temperature type field'); temperatureType = value.getUint8(offset); }
  appendObservation({ metric: 'body_temperature', value: celsius, unit: '°C', sourceKind: 'ble_gatt', sourceLabel: `BLE thermometer · ${deviceName || 'unnamed device'}`, serviceUuid: '0x1809', characteristicUuid: '0x2A1C', context: { ...(deviceLocalTime ? { sourceTime: deviceLocalTime, timeBasis: 'device-local; timezone not supplied' } : {}), ...(temperatureType === null ? {} : { temperatureType }) } });
}
async function disconnectSensor(metric) {
  const connection = sensorConnections[metric];
  if (connection?.device?.gatt?.connected) connection.device.gatt.disconnect();
  delete sensorConnections[metric];
  if (activeView === 'checkin') render();
}
async function connectSensor(metric) {
  const spec = sensorSpecs[metric];
  if (!navigator.bluetooth || !window.isSecureContext) return toast('This browser does not support Bluetooth pairing here. Import a sensor file instead.');
  if (sensorConnections[metric]?.device?.gatt?.connected) return disconnectSensor(metric);
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [spec.service] }], optionalServices: ['battery_service'] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(spec.service);
    let characteristic, characteristicUuid = spec.characteristic;
    if (metric === 'spo2') {
      try { characteristic = await service.getCharacteristic('plx_continuous_measurement'); }
      catch { characteristic = await service.getCharacteristic('plx_spot_check_measurement'); characteristicUuid = '0x2A5E'; }
    } else characteristic = await service.getCharacteristic(spec.characteristic);
    let bodySite = null;
    if (metric === 'heart_rate') {
      try {
        const location = await service.getCharacteristic('body_sensor_location');
        const codes = ['Other', 'Chest', 'Wrist', 'Finger', 'Hand', 'Ear lobe', 'Foot'];
        bodySite = codes[(await location.readValue()).getUint8(0)] || null;
      } catch { /* Optional standard characteristic. */ }
    }
    const onMeasurement = event => {
      try {
        if (metric === 'heart_rate') parseHeartRate(event.target.value, device.name, bodySite);
        else if (metric === 'spo2') parsePulseOximeter(event.target.value, device.name, characteristicUuid === '0x2A5E');
        else if (metric === 'systolic_bp') parseBloodPressure(event.target.value, device.name);
        else if (metric === 'muscle_mass') parseBodyComposition(event.target.value, device.name);
        else if (metric === 'body_weight') parseWeightScale(event.target.value, device.name);
        else if (metric === 'treadmill_speed') parseFitnessMachineTreadmill(event.target.value, device.name);
        else parseThermometer(event.target.value, device.name);
      } catch (error) { toast(`${spec.label}: ${error.message}`); }
    };
    characteristic.addEventListener('characteristicvaluechanged', onMeasurement);
    await characteristic.startNotifications();
    sensorConnections[metric] = { device, characteristic, onMeasurement };
    state.sensorProfiles[metric] = { name: device.name || spec.label, connectedAt: new Date().toISOString(), service: spec.service };
    try {
      const batteryService = await server.getPrimaryService('battery_service');
      const battery = await batteryService.getCharacteristic('battery_level');
      state.sensorProfiles[metric].batteryPercent = (await battery.readValue()).getUint8(0);
    } catch { /* Battery service is optional. */ }
    device.addEventListener('gattserverdisconnected', () => {
      delete sensorConnections[metric];
      persist();
      if (activeView === 'checkin') render();
    });
    persist(); render(); toast(`${spec.label} connected locally`);
  } catch (error) {
    if (error.name !== 'NotFoundError') toast(`${spec.label} connection failed: ${error.message}`);
  }
}
function taskItems() {
  return [...(state.crewPlan || []), ...(state.customTasks || [])];
}
function routineList(limit = 3) {
  return taskItems().slice(0, limit).map(item => {
    const done = !!state.tasks[item.id];
    const timeLabel = item.time ? `${esc(item.time)}${/^\d{1,2}:\d{2}$/.test(item.time) ? ' UTC' : ''}` : 'TIME NOT SET';
    return `<div class="routine-item ${done ? 'completed' : ''}"><button class="routine-check ${done ? 'done' : ''}" data-task="${esc(item.id)}" aria-label="${done ? 'Mark incomplete' : 'Mark complete'} ${esc(item.title)}">${done ? '✓' : ''}</button><div class="routine-copy"><b>${esc(item.title)}</b><small>${esc(item.detail)}</small></div><span class="routine-time">${timeLabel}</span></div>`;
  }).join('');
}
function checkDueReminders() {
  const now = new Date(), dayKey = now.toISOString().slice(0, 10), minute = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
  const reminded = new Set(state.remindedTasks || []);
  const before = reminded.size;
  for (const item of taskItems()) {
    const scheduled = String(item.time || '').match(/^(\d{1,2}:\d{2})(?:\s*UTC)?$/i)?.[1];
    const reminderKey = `${dayKey}:${item.id}`;
    if (!scheduled || scheduled !== minute || state.tasks[item.id] || reminded.has(reminderKey)) continue;
    toast(`Scheduled reminder · ${item.title}`);
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Beyond Pulse · crew plan', { body: item.title });
    reminded.add(reminderKey);
  }
  if (reminded.size !== before) { state.remindedTasks = [...reminded].slice(-1000); persist(); }
}
function updateRoutineCount() {
  const remaining = taskItems().filter(t => !state.tasks[t.id]).length;
  const badge = document.getElementById('routine-count'); if (badge) badge.textContent = remaining;
}
function applyConfiguredRules(observation, notifyCrew = false) {
  if (!Array.isArray(state.alertRules?.rules)) return;
  state.alerts = Array.isArray(state.alerts) ? state.alerts : [];
  for (const rule of state.alertRules.rules.filter(candidate => candidate.metric === observation.metric)) {
    if (observation.unit && observation.unit !== rule.unit) continue;
    const outside = (rule.min != null && observation.value < rule.min) || (rule.max != null && observation.value > rule.max);
    const alertId = String(rule.id);
    let current = state.alerts.find(item => item.ruleId === alertId && item.status === 'open');
    if (!outside) {
      if (current) { current.status = 'resolved'; current.resolvedAt = observation.receivedAt || new Date().toISOString(); }
      continue;
    }
    const isNew = !current;
    const boundary = rule.min != null && observation.value < rule.min ? 'below' : 'above';
    const threshold = boundary === 'below' ? rule.min : rule.max;
    if (!current) { current = { id: crypto.randomUUID(), ruleId: alertId, createdAt: observation.receivedAt || new Date().toISOString(), status: 'open' }; state.alerts.push(current); }
    Object.assign(current, {
      metric: observation.metric, value: observation.value, unit: observation.unit || metricMeta[observation.metric].unit,
      boundary, threshold, measuredAt: observation.measuredAt || null, receivedAt: observation.receivedAt || new Date().toISOString(),
      sourceKind: observation.sourceKind, sourceLabel: observation.sourceLabel || 'Source not reported',
      severity: rule.severity, ruleName: rule.name, notifyRoles: rule.notifyRoles || []
    });
    if (notifyCrew && isNew) {
      toast(`Mission rule triggered · ${rule.name}`);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Beyond Pulse · rule triggered', { body: `${metricMeta[observation.metric].name} matched ${rule.name}. Review the configured mission procedure.` });
    }
  }
  state.alerts = state.alerts.slice(-200);
}
function recalculateConfiguredAlerts() {
  state.alerts = [];
  const records = [
    ...state.observations.map(item => ({ metric: item.metric, value: Number(item.value), unit: item.unit, measuredAt: item.measuredAt, receivedAt: item.receivedAt, sourceKind: item.source?.kind, sourceLabel: item.source?.label })),
    ...state.scans.map(scan => ({ metric: 'qus_speed_of_sound', value: Number(scan.sos), unit: 'm/s', measuredAt: scan.measuredAt, receivedAt: scan.receivedAt, sourceKind: 'qus_export', sourceLabel: `QUS export · ${scan.device || 'device not reported'}` }))
  ].filter(item => Number.isFinite(item.value) && ['ble_gatt', 'device_import', 'qus_export'].includes(item.sourceKind))
    .sort((a, b) => Date.parse(a.measuredAt || a.receivedAt || 0) - Date.parse(b.measuredAt || b.receivedAt || 0));
  records.forEach(item => applyConfiguredRules(item, false));
}
function ruleAlertsCard() {
  const active = (state.alerts || []).filter(item => item.status === 'open').slice(-5).reverse();
  if (!active.length) return '';
  return `<article class="card alert-review-card"><div class="card-header"><div><div class="eyebrow">MISSION RULE MATCH</div><h2>${active.length} reading(s) need review</h2></div><span class="tag amber">LOCAL ALERT</span></div>${active.map(alert => `<div class="alert-review-row"><b>${esc(alert.ruleName)} · ${esc(metricMeta[alert.metric]?.name || alert.metric)}</b><span>${Number(alert.value).toFixed(metricMeta[alert.metric]?.decimals ?? 1)} ${esc(alert.unit)} · ${esc(alert.boundary)} configured bound ${esc(alert.threshold)}</span><small>${esc(alert.sourceLabel)} · ${esc(alert.notifyRoles.join(', ') || 'reviewers not specified')} · routing not connected</small><button class="button small ghost" data-alert-handoff="${esc(alert.id)}">Prepare local handoff</button></div>`).join('')}</article>`;
}
function deviceQualityCard() {
  const flagged = Object.keys(metricMeta).map(metric => latestSignal(metric)).filter(row => row && row.quality === 'questionable' && ['ble_gatt','device_import','qus_export'].includes(row.sourceKind));
  if (!flagged.length) return '';
  return `<article class="card alert-review-card quality-notice"><div class="card-header"><div><div class="eyebrow">DEVICE DATA QUALITY</div><h2>${flagged.length} signal(s) have source quality flags</h2></div><span class="tag amber">REVIEW SOURCE</span></div>${flagged.map(row => `<div class="alert-review-row"><b>${esc(metricMeta[row.metric]?.name || row.metric)}</b><span>${esc(row.flags?.join(', ') || 'Device marked the record for review')}</span><small>${esc(row.sourceLabel)} · ${esc(sampleTime(row))}</small></div>`).join('')}</article>`;
}
function scenarioMetricName(metric) {
  return (metricMeta[metric]?.name || metric).replace(' · device-reported', '').replace(/^ISS /, 'Cabin ');
}
function scenarioMetricCard(metric) {
  const rows = scenarioSeries(metric), latest = rows.at(-1), meta = metricMeta[metric];
  if (!latest || !meta) return '';
  const note = metric === 'qus_speed_of_sound' ? 'Illustrative SOS only · no bone-density result' : ['dose_equivalent_rate','absorbed_dose_rate','particle_flux'].includes(metric) ? 'Scenario environment · not personal crew dose' : metric.startsWith('cabin_') ? 'Synthetic cabin context' : '7-day illustrative series';
  return `<article class="scenario-metric"><div class="scenario-metric-head"><span>${esc(scenarioMetricName(metric))}</span><span class="tag simulation-tag">SIM</span></div><div class="scenario-value">${Number(latest.value).toFixed(meta.decimals)}<small>${esc(latest.unit)}</small></div>${svgSpark(rows.map(row => row.value), metric === 'dose_equivalent_rate')}<small class="scenario-metric-note">${esc(note)}</small></article>`;
}
function localScenarioBrief() {
  const pulse = scenarioSeries('resting_pulse').map(row => row.value);
  const sleep = scenarioSeries('sleep').map(row => row.value);
  const exercise = scenarioSeries('exercise_minutes').map(row => row.value);
  const qus = scenarioSeries('qus_speed_of_sound').at(-1);
  const co2 = scenarioSeries('cabin_co2').at(-1);
  const average = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  return `7-day snapshot: resting pulse ${Math.min(...pulse).toFixed(0)}–${Math.max(...pulse).toFixed(0)} bpm; sleep average ${average(sleep).toFixed(1)} h; ${exercise.reduce((sum, value) => sum + value, 0).toFixed(0)} min exercise logged. Latest QUS SOS ${qus.value.toFixed(1)} m/s; cabin CO₂ ${co2.value.toFixed(0)} ppm. Simulation only · no medical assessment.`;
}
function renderScenarioDashboard() {
  if (!state.simulationEnabled) return `<section class="scenario-shell card scenario-paused"><div><div class="eyebrow"><span class="line"></span>MAYA'S MISSION PROFILE</div><h2>Simulation paused</h2></div><button class="button primary" data-action="simulation-toggle">Resume</button></section>`;
  const records = scenarioSeries();
  const sleep = scenarioSeries('sleep');
  const sleepDelta = sleep.at(-1).value - sleep[0].value;
  const stages = [
    { n: '01', name: 'Signal intake', state: `${records.length} SIMULATED POINTS`, detail: 'Vitals, movement and environment.' },
    { n: '02', name: 'Mission context', state: 'MISSION DAY 142', detail: 'Maya · seven-day view.' },
    { n: '03', name: 'Trend watch', state: 'TREND ONLY', detail: `Sleep span ${sleepDelta >= 0 ? '+' : ''}${sleepDelta.toFixed(1)} h.` },
    { n: '04', name: 'Crew brief', state: 'READY', detail: 'Summary prepared for Maya.' }
  ];
  const brief = localScenarioBrief();
  const metrics = ['heart_rate','spo2','body_temperature','respiration','hrv','sleep','exercise_minutes','muscle_mass','qus_speed_of_sound','cabin_temperature','cabin_humidity','cabin_co2','dose_equivalent_rate'];
  const visibleMetrics = new Set(metrics);
  const additionalMetrics = Object.keys(metricMeta).filter(key => scenarioSeries(key).length && !visibleMetrics.has(key));
  return `<section class="scenario-shell card"><div class="scenario-top"><div><div class="eyebrow"><span class="line"></span>MAYA · MISSION DAY 142</div><h2>Mission health</h2></div><button class="button small ghost" data-action="simulation-toggle">Pause</button></div>
    <div class="scenario-warning"><span class="scenario-warning-mark">!</span><div><b>NASA-INSPIRED SIMULATION</b><small>Fictional demo values created by Beyond Pulse · not NASA data or a crew medical record.</small></div></div>
    <div class="agent-flow">${stages.map((stage, index) => `<article class="agent-stage"><span class="agent-index">${stage.n}</span><div class="agent-copy"><b>${esc(stage.name)}</b><span class="agent-state">${esc(stage.state)}</span><small>${esc(stage.detail)}</small></div>${index < stages.length - 1 ? '<span class="agent-link" aria-hidden="true">›</span>' : ''}</article>`).join('')}</div>
    <div class="scenario-summary"><span class="assistant-mark">SI</span><div><b>MISSION BRIEF · MAYA</b><p>${esc(brief)}</p></div><span class="tag simulation-tag">SIMULATED</span></div>
    <div class="scenario-ai-actions"><button id="generate-scenario-ai" class="button small ghost" disabled>Generate AI brief</button><span id="scenario-ai-status" class="source-caveat">Optional OpenAI summary · consent required</span></div><div id="scenario-ai-output" class="ai-summary-output" hidden></div>
    <div class="scenario-metric-grid">${metrics.map(scenarioMetricCard).join('')}</div>
    <details class="scenario-extra"><summary>Additional scenario signals <span>${additionalMetrics.length} more</span></summary><div class="scenario-metric-grid">${additionalMetrics.map(scenarioMetricCard).join('')}</div></details>
    <div class="scenario-foot"><span>7-DAY SCENARIO · MAYA</span><span>Not for clinical decisions</span></div></section>`;
}
function scenarioTrendPanel() {
  if (!state.simulationEnabled) return '';
  const options = ['heart_rate','spo2','systolic_bp','diastolic_bp','hrv','sleep','exercise_minutes','treadmill_speed','muscle_mass','body_weight','qus_speed_of_sound','cabin_temperature','cabin_humidity','cabin_co2','absorbed_dose_rate','dose_equivalent_rate','particle_flux'];
  if (!options.includes(scenarioTrendMetric)) scenarioTrendMetric = 'heart_rate';
  const meta = metricMeta[scenarioTrendMetric], rows = scenarioSeries(scenarioTrendMetric);
  const recent = rows.slice(-12).reverse().map(row => `<div class="observation-row scenario-observation"><b>${esc(scenarioMetricName(scenarioTrendMetric))}</b><span>${Number(row.value).toFixed(meta.decimals)} ${esc(row.unit)}</span><span>${esc(sampleTime(row))}</span><span>${esc(row.sourceLabel)}</span><span class="tag simulation-tag">SIMULATED</span></div>`).join('');
  return `<article class="card panel scenario-trends"><div class="card-header"><div><div class="eyebrow">7-DAY SIMULATION</div><h2>Maya's trends</h2></div><div class="field scenario-trend-select"><label for="scenario-trend-select">SIGNAL</label><select id="scenario-trend-select">${options.map(key => `<option value="${key}" ${key === scenarioTrendMetric ? 'selected' : ''}>${esc(scenarioMetricName(key))}</option>`).join('')}</select></div></div>${chartSvg(rows.map(row => row.value), { baseline: null, unit: meta.unit, labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 7'], id: `${scenarioMetricName(scenarioTrendMetric)} synthetic scenario trend` })}<details class="record-register"><summary>View ${rows.length} sample points</summary><div class="observation-row observation-head"><b>SIGNAL</b><b>VALUE</b><b>TIME</b><b>SOURCE</b><b>TYPE</b></div>${recent}</details></article>`;
}
function aiInputObservations() {
  const rows = Object.keys(metricMeta).flatMap(metric => metricSeries(metric))
    .filter(row => ['ble_gatt', 'device_import', 'qus_export', 'radlab_api', 'eda_api'].includes(row.sourceKind))
    .sort((a, b) => Date.parse(a.measuredAt || a.receivedAt || '') - Date.parse(b.measuredAt || b.receivedAt || ''));
  const unique = new Map(rows.map(row => [`${row.metric}:${row.measuredAt || row.receivedAt}:${row.sourceLabel}`, row]));
  return [...unique.values()].slice(-120).map(row => {
    const source = ({ ble_gatt: 'Bluetooth sensor', device_import: 'Imported device file', qus_export: 'QUS device export', radlab_api: 'NASA RadLab archive', eda_api: 'NASA EDA archive' })[row.sourceKind] || 'Source record';
    return {
      metric: row.metric, value: row.value, unit: row.unit, measured_at: row.measuredAt,
      received_at: row.receivedAt, source, source_kind: row.sourceKind,
      quality: row.quality, flags: row.flags, context: row.context
    };
  });
}
function intelligenceBox() {
  const rows = aiInputObservations();
  const latest = rows.at(-1);
  const copy = latest
    ? `${rows.length} sourced measurements available. Latest: ${metricMeta[latest.metric]?.name || latest.metric} ${Number(latest.value).toFixed(2)} ${latest.unit} · ${latest.source}.`
    : 'No sensor or archive readings are loaded yet. Connect a compatible monitor or open NASA mission data.';
  return `<article class="card assistant-box"><div class="assistant-top"><span class="assistant-mark">SI</span><div><b>Signal Intelligence</b><small>SOURCE-AWARE · NON-DIAGNOSTIC</small></div><span class="tag" style="margin-left:auto">${rows.length ? `${rows.length} READINGS` : 'WAITING FOR DATA'}</span></div><p class="brief-copy">${esc(copy)}</p><p class="source-caveat">It reports what the sources show and when. It does not diagnose or set medical thresholds.</p><div class="field ai-mode-field"><label for="ai-mode">BRIEF TYPE</label><select id="ai-mode"><option value="crew_brief">Crew summary</option><option value="trend_review">Trend comparison</option><option value="data_quality">Data quality</option></select></div><div id="ai-summary-output" class="ai-summary-output" hidden></div><div class="brief-actions"><button id="generate-ai-summary" class="button small primary" ${rows.length ? '' : 'disabled'}>Prepare AI brief</button><button class="button small ghost" data-view-jump="trends">Open trends</button></div><span id="ai-status" class="source-caveat">${rows.length ? 'Cloud AI is optional and requires a review step.' : 'Connect a source to enable a data-grounded brief.'}</span></article>`;
}
function trendCard(key, title = 'Source measurement trend') {
  const meta = metricMeta[key], series = metricSeries(key), values = series.map(item => item.value);
  if (!series.length) return `<article class="card trend-card"><h2>${esc(title)}</h2><p>No samples from a connected or imported source.</p></article>`;
  const firstTime = sampleTime(series[0]), lastTime = sampleTime(series.at(-1));
  return `<article class="card trend-card"><div class="card-header"><div><h2 class="card-title">${esc(title)}</h2><p class="card-subtitle">${esc(meta.name)} · ${series.length} source records</p></div><span class="tag">${esc(signalFreshness(series.at(-1)))}</span></div>${chartSvg(values, { baseline: null, unit: meta.unit, labels: ['Start', '25%', '50%', '75%', 'Latest'], id: `${meta.name} source readings` })}<div class="trend-callout"><span class="callout-mark">•</span><span>${esc(series[0].sourceLabel)}<br>${esc(firstTime)} → ${esc(lastTime)}<br>Visualization only; no clinical threshold applied.</span></div></article>`;
}

function renderToday() {
  const crewText = { none: 'Not checked today', logged: 'Check-in saved', okay: 'Feeling okay', changed: 'Something changed', support: 'Support requested' }[state.crewCheck?.key || 'none'];
  return `${heading('MISSION DAY 142', 'Mission health', 'Maya · crew overview', '<button class="button primary" data-view-jump="checkin">Daily check-in</button>')}
    <section class="grid top-grid"><article class="card hero-card maya-hero"><div class="hero-main"><div class="hero-copy"><div class="eyebrow"><span class="line"></span>MAYA · ORBITAL HEALTH</div><h2>Mission day 142</h2><p>Seven-day health and environment simulation.</p></div><div class="hero-status"><span></span>SIMULATION</div></div><div class="hero-foot"><small>MISSION PROFILE · MAYA</small><small>NASA-INSPIRED SCENARIO</small></div></article>
    <article class="card quick-check-card"><div class="card-header"><div><div class="eyebrow">WELLNESS</div><h2>How are you feeling?</h2></div><span class="tag">${esc(crewText.toUpperCase())}</span></div><div class="quick-check-actions"><button class="button small ghost" data-action="crew-status" data-status="okay">I'm okay</button><button class="button small ghost" data-action="crew-status" data-status="changed">Something changed</button><button class="button small warn" data-action="crew-status" data-status="support">Request support</button></div></article></section>
    ${renderScenarioDashboard()}
    <section class="grid bottom-grid"><article class="card mini-card" data-view-jump="bone"><span class="mini-icon">⌬</span><div class="mini-card-copy"><b>Body health</b><small>Bone, muscle & exercise</small></div><span class="mini-arrow">›</span></article><article class="card mini-card" data-view-jump="radiation"><span class="mini-icon amber">✳</span><div class="mini-card-copy"><b>Mission environment</b><small>Cabin & radiation context</small></div><span class="mini-arrow">›</span></article><article class="card mini-card" data-view-jump="routine"><span class="mini-icon blue">▦</span><div class="mini-card-copy"><b>Daily plan</b><small>Maya's activity log</small></div><span class="mini-arrow">›</span></article></section>`;
}

function renderTrends() {
  return `${heading('MAYA · TRENDS', 'Health trends', 'Seven-day mission simulation.')}${scenarioTrendPanel()}`;
}

function renderCheckin() {
  const last = state.wellbeingEntries.at(-1);
  return `${heading('MAYA · WELLNESS', 'Daily check-in', 'A quick personal update.')}
    <form id="checkin-form" class="card panel compact-checkin"><div class="card-header"><div><h2>Maya's check-in</h2><p class="card-subtitle">Optional · saved on this device</p></div><span class="tag">${last ? 'SAVED' : 'READY'}</span></div><div class="form-grid"><div class="field"><label for="energy-input">ENERGY · <span id="energy-value">${esc(last?.energy ?? 5)}</span> / 10</label><input id="energy-input" type="range" min="1" max="10" value="${esc(last?.energy ?? 5)}"></div><div class="field"><label for="mood-input">HOW DO YOU FEEL?</label><select id="mood-input">${['Steady', 'Good', 'Tired', 'Stressed', 'Low', 'Other'].map(mood => `<option ${last?.mood === mood ? 'selected' : ''}>${mood}</option>`).join('')}</select></div><div class="field" style="grid-column:1/-1"><label for="symptom-input">NOTE · OPTIONAL</label><textarea id="symptom-input" rows="3" placeholder="Add a note for your care team">${esc(last?.note || '')}</textarea></div></div><div class="form-actions"><button class="button primary" type="submit">Save check-in</button></div></form>`;
}

function renderBone() {
  const scans = scenarioSeries('qus_speed_of_sound');
  const exercise = scenarioSeries('exercise_minutes').slice(-5).reverse();
  const bodyMetrics = ['muscle_mass','body_weight','body_fat_percentage','body_mass_index'].map(scenarioMetricCard).join('');
  const scanRows = scans.slice().reverse().map(scan => `<div class="qus-row"><b>QUS · simulation</b><span>${Number(scan.value).toFixed(1)} m/s</span><small>${esc(sampleTime(scan))}</small></div>`).join('');
  const exerciseRows = exercise.map((row, index) => `<div class="data-row"><b>Exercise · day ${7 - index}</b><span>${Number(row.value).toFixed(0)} min</span><span>${esc(sampleTime(row))}</span></div>`).join('');
  return `${heading('MAYA · BODY HEALTH', 'Bone & muscle', 'Illustrative crew-health trends.')}
    <section class="stack"><article class="card panel"><div class="card-header"><div><h2>Quantitative ultrasound</h2><p class="card-subtitle">Speed of sound · synthetic points</p></div><span class="tag simulation-tag">SIMULATED</span></div>${chartSvg(scans.map(row => row.value), { baseline: null, unit: 'm/s', labels: ['Day 1', 'Day 4', 'Day 7'], id: 'Maya simulated QUS speed of sound' })}<div class="qus-history">${scanRows}</div><p class="form-note">SOS only. No bone-density score is inferred.</p></article>
      <article class="card panel"><div class="card-header"><div><h2>Body composition</h2><span class="tag simulation-tag">SIMULATED</span></div></div><div class="scenario-metric-grid">${bodyMetrics}</div></article>
      <article class="card panel"><div class="card-header"><div><h2>Exercise log</h2><span class="tag simulation-tag">SIMULATED</span></div><button class="button small ghost" data-view-jump="routine">Open activity</button></div><div class="data-list">${exerciseRows}</div></article></section>`;
}

function groupedRadlab() {
  if (!radlab?.records?.length) return [];
  return radlab.records.filter(r => r.instrument_id === radlabInstrument && r.absorbed_dose_rate !== null && r.absorbed_dose_rate !== '' && Number.isFinite(Number(r.absorbed_dose_rate)));
}
function renderRadiationArchiveLegacy() {
  const rows = groupedRadlab(), values = rows.map(r => Number(r.absorbed_dose_rate));
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const min = values.length ? Math.min(...values) : null, max = values.length ? Math.max(...values) : null;
  const selectedRecords = (radlab?.records || []).filter(r => r.instrument_id === radlabInstrument).sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));
  const latest = selectedRecords.at(-1);
  const equivalentRows = selectedRecords.filter(r => r.dose_equivalent_rate !== null && r.dose_equivalent_rate !== '' && Number.isFinite(Number(r.dose_equivalent_rate)));
  const equivalentAvg = equivalentRows.length ? equivalentRows.reduce((sum, row) => sum + Number(row.dose_equivalent_rate), 0) / equivalentRows.length : null;
  const instrumentCount = id => radlab?.records?.filter(r => r.instrument_id === id).length || 0;
  const windowLabel = esc(radlab?.window_utc || 'Choose an archive window');
  const metaRows = latest ? [
    ['Recorded UTC', latest.timestamp || 'Not reported'], ['Instrument', latest.instrument_id || 'Not reported'],
    ['Dose-equivalent', latest.dose_equivalent_rate == null ? '—' : `${Number(latest.dose_equivalent_rate).toFixed(3)} μSv/h`],
    ['Particle flux', latest.flux == null ? '—' : `${Number(latest.flux).toFixed(3)} cm⁻² sr⁻¹ s⁻¹`],
    ['ISS position', latest.latitude == null || latest.longitude == null ? 'Not available' : `${Number(latest.latitude).toFixed(2)}°, ${Number(latest.longitude).toFixed(2)}°`],
    ['Altitude', latest.altitude == null ? '—' : `${Number(latest.altitude).toFixed(1)} km`],
    ['Magnetic context', latest.B == null ? '—' : `B ${Number(latest.B).toFixed(1)} nT · L ${latest.L ?? '—'}`]
  ].map(([label, value]) => `<div class="data-row"><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('') : '<div class="empty-state">Load NASA RadLab archive records to see instrument values.</div>';
  const missionList = edaMissions.length ? edaMissions.map(item => `<option value="${esc(item.name)}" ${item.name === edaMission ? 'selected' : ''}>${esc(item.title || item.name)}</option>`).join('') : `<option value="RR-1">${edaLoading ? 'Loading NASA mission catalog…' : 'RR-1 · Rodent Research 1'}</option>`;
  const edaRows = eda?.records || [];
  const environmentMetric = metricSeries(edaMetric);
  const environmentLatest = edaRows.at(-1);
  const edaSummary = environmentLatest ? `<div class="split-metrics"><div class="split-box"><small>ISS TEMPERATURE</small><b>${environmentLatest.temperature_iss == null ? '—' : `${Number(environmentLatest.temperature_iss).toFixed(1)} °C`}</b><small>GROUND ${environmentLatest.temperature_ground == null ? '—' : `${Number(environmentLatest.temperature_ground).toFixed(1)} °C`}</small></div><div class="split-box"><small>ISS RELATIVE HUMIDITY</small><b>${environmentLatest.humidity_iss == null ? '—' : `${Number(environmentLatest.humidity_iss).toFixed(1)} %`}</b><small>GROUND ${environmentLatest.humidity_ground == null ? '—' : `${Number(environmentLatest.humidity_ground).toFixed(1)} %`}</small></div><div class="split-box"><small>ISS CO₂</small><b>${environmentLatest.co2_iss == null ? '—' : `${Number(environmentLatest.co2_iss).toFixed(0)} ppm`}</b><small>GROUND ${environmentLatest.co2_ground == null ? '—' : `${Number(environmentLatest.co2_ground).toFixed(0)} ppm`}</small></div></div>` : '<div class="empty-state">No telemetry in this mission and time window.</div>';
  const milestones = [...new Set(edaRows.map(row => row.milestones).filter(value => value != null && String(value).trim()))].slice(0, 8);
  return `${heading('NASA DATA', 'Mission data', 'Two NASA archives · separately labeled from personal crew sensors.', '<span class="tag blue">ARCHIVE ONLY</span>')}
    <section class="stack mission-data-stack"><article class="card panel"><div class="card-header"><div><h2>ISS cabin & hardware environment</h2><p class="card-subtitle">NASA Environmental Data Application · archived mission telemetry</p></div><span class="tag">NASA EDA</span></div><div class="eda-controls"><div class="field"><label for="eda-mission">MISSION</label><select id="eda-mission">${missionList}</select></div><div class="field"><label for="eda-start">FROM · UTC</label><input id="eda-start" type="datetime-local" value="${esc(edaWindow.start)}"></div><div class="field"><label for="eda-end">TO · UTC</label><input id="eda-end" type="datetime-local" value="${esc(edaWindow.end)}"></div><button id="fetch-eda" class="button primary" ${edaLoading ? 'disabled' : ''}>${edaLoading ? 'Loading…' : 'Load mission window'}</button></div>${edaError ? `<p class="form-note">${esc(edaError)}</p>` : ''}${edaSummary}${milestones.length ? `<details class="quiet-details"><summary>Mission events · ${milestones.length}</summary><ul>${milestones.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>` : ''}<div class="card-header" style="margin-top:16px"><div><h3>Mission telemetry trend</h3><p class="card-subtitle">${eda ? `${eda.rows_returned} records · ${esc(eda.mission)} · ${esc(eda.window_utc)}` : 'Select a mission and UTC window'}</p></div><div class="field" style="width:220px"><label for="eda-signal">MEASUREMENT</label><select id="eda-signal"><option value="cabin_temperature" ${edaMetric === 'cabin_temperature' ? 'selected' : ''}>ISS temperature</option><option value="cabin_humidity" ${edaMetric === 'cabin_humidity' ? 'selected' : ''}>ISS humidity</option><option value="cabin_co2" ${edaMetric === 'cabin_co2' ? 'selected' : ''}>ISS CO₂</option></select></div></div>${environmentMetric.length ? chartSvg(environmentMetric.map(item => item.value), { baseline: null, unit: metricMeta[edaMetric].unit, labels: ['Start', '25%', '50%', '75%', 'Latest'], id: `${metricMeta[edaMetric].name} archive trend`, color: '#75d6b2', height: 145 }) : ''}<p class="form-note">${eda ? `Retrieved ${esc(eda.fetched_at_utc)} · recorded ${esc(environmentLatest?.time || 'time unavailable')}.` : 'Historical records only. This is not a current station air-quality feed.'}</p><details class="quiet-details"><summary>Source and limits</summary><p>${esc(eda?.caveat || 'NASA EDA telemetry is archival environmental context. It does not measure a current crew member or current cabin conditions.')}</p><a class="source-link" href="https://visualization.osdr.nasa.gov/eda/api_reference" target="_blank" rel="noreferrer">NASA EDA API guide ↗</a></details></article>
    <article class="card panel"><div class="card-header"><div><h2>Radiation environment</h2><p class="card-subtitle">NASA OSDR RadLab · ISS DosTel archived instrument records</p></div><span class="tag">NASA ARCHIVE</span></div><div class="radlab-controls"><div class="field"><label for="radlab-start">FROM · UTC</label><input id="radlab-start" type="datetime-local" value="${esc(radlabWindow.start)}"></div><div class="field"><label for="radlab-end">TO · UTC</label><input id="radlab-end" type="datetime-local" value="${esc(radlabWindow.end)}"></div><button id="fetch-radlab" class="button primary" ${radlabLoading ? 'disabled' : ''}>${radlabLoading ? 'Loading…' : 'Refresh RadLab'}</button><label class="button small ghost" for="radlab-file">Import archive JSON</label><input id="radlab-file" type="file" accept=".json,application/json" hidden></div>${radlabError ? `<p class="form-note">${esc(radlabError)}</p>` : ''}<div class="radlab-layout"><div><div class="card-header"><div><h3>Absorbed dose rate</h3><p class="card-subtitle">${esc(radlabInstrument)} · ${rows.length} records · ${windowLabel}</p></div></div>${rows.length ? `<div class="radiation-stat"><strong>${avg.toFixed(2)}</strong><span>μGy/h mean<br>${min.toFixed(2)} low · ${max.toFixed(2)} high</span></div>${chartSvg(values, { baseline: null, unit: 'μGy/h', labels: ['Start', '25%', '50%', '75%', 'Latest'], id: 'NASA archived environmental absorbed dose rate', color: '#91b9f8', height: 170 })}` : '<div class="empty-state">No NASA archive records loaded for this instrument window.</div>'}<div class="source-badges"><button class="button small ${radlabInstrument === 'DosTel1' ? 'primary' : 'ghost'}" data-instrument="DosTel1">DosTel1 · ${instrumentCount('DosTel1')}</button><button class="button small ${radlabInstrument === 'DosTel2' ? 'primary' : 'ghost'}" data-instrument="DosTel2">DosTel2 · ${instrumentCount('DosTel2')}</button></div></div><div class="stack"><div class="data-list">${metaRows}</div><p class="form-note">Retrieved ${esc(radlab?.fetched_at_utc || 'not yet queried')}. These are archived environmental measurements, not personal crew dose or current exposure.</p><details class="quiet-details"><summary>RadLab source</summary><a class="source-link" href="https://visualization.osdr.nasa.gov/radlab/gui/data-api/" target="_blank" rel="noreferrer">NASA RadLab API guide ↗</a></details></div></div></article></section>`;
}

function renderRadiation() {
  const environment = ['cabin_temperature','cabin_humidity','cabin_co2'];
  const radiation = ['absorbed_dose_rate','dose_equivalent_rate','particle_flux'];
  const dose = scenarioSeries('dose_equivalent_rate');
  const archiveRows = (radlab?.records || []).filter(row => row.instrument_id === 'DosTel1' && row.absorbed_dose_rate != null && Number.isFinite(Number(row.absorbed_dose_rate))).sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));
  const archiveValues = archiveRows.map(row => Number(row.absorbed_dose_rate));
  const archiveAverage = archiveValues.length ? archiveValues.reduce((sum, value) => sum + value, 0) / archiveValues.length : null;
  const archiveCard = radlabLoading ? '<div class="empty-state">Loading the bundled NASA archive sample…</div>' : archiveValues.length ? `<div class="radiation-stat"><strong>${archiveAverage.toFixed(2)}</strong><span>μGy/h mean<br>${archiveValues.length} records · DosTel1</span></div>${chartSvg(archiveValues, { baseline: null, unit: 'μGy/h', labels: ['23:00', '23:15', '23:30', '23:45', '23:59'], id: 'NASA RadLab historical ISS dose rate', color: '#91b9f8', height: 150 })}<p class="form-note">NASA RadLab archive · 2 Apr 2022. Historical instrument data, not Maya's dose or current ISS exposure.</p>` : `<div class="empty-state">${esc(radlabError || 'NASA archive sample is unavailable.')}</div>`;
  return `${heading('MAYA · MISSION ENVIRONMENT', 'Spacecraft environment', 'Cabin and radiation context · simulated.', '<span class="tag simulation-tag">SIMULATED</span>')}
    <section class="grid two-col"><article class="card panel"><div class="card-header"><div><h2>Cabin conditions</h2><p class="card-subtitle">Seven-day scenario</p></div></div><div class="scenario-metric-grid">${environment.map(scenarioMetricCard).join('')}</div></article>
    <article class="card panel"><div class="card-header"><div><h2>Radiation scenario</h2><p class="card-subtitle">Fictional context · not personal dose</p></div><span class="tag simulation-tag">SIM</span></div><div class="scenario-metric-grid">${radiation.map(scenarioMetricCard).join('')}</div>${chartSvg(dose.map(row => row.value), { baseline: null, unit: 'μSv/h', labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 7'], id: 'Maya simulated dose equivalent rate', color: '#91b9f8', height: 145 })}</article>
    <article class="card panel archive-reference"><div class="card-header"><div><h2>NASA RadLab · historical sample</h2><p class="card-subtitle">ISS DosTel instrument · 2 April 2022</p></div><span class="tag blue">NASA ARCHIVE</span></div>${archiveCard}</article></section>
    <div class="disclaimer"><b>NASA-inspired simulation.</b> Maya's readings are fictional. The RadLab chart is actual historical NASA archive data and is shown separately.</div>`;
}

function renderRoutine() {
  const list = taskItems();
  const exercise = scenarioSeries('exercise_minutes').slice(-5).reverse();
  const exerciseRows = exercise.map((row, index) => `<div class="data-row"><b>Day ${7 - index}</b><span>${Number(row.value).toFixed(0)} min</span><span>${esc(sampleTime(row))}</span></div>`).join('');
  return `${heading('MAYA · ACTIVITY', 'Daily plan', 'Exercise log and personal reminders.', '<button class="button primary" data-action="add-reminder">＋ Add reminder</button>')}
    <section class="grid two-col"><article class="card panel"><div class="card-header"><div><h2>Exercise log</h2><p class="card-subtitle">Maya · 7-day simulation</p></div><span class="tag simulation-tag">SIMULATED</span></div>${chartSvg(scenarioSeries('exercise_minutes').map(row => row.value), { baseline: null, unit: 'min', labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 7'], id: 'Maya simulated exercise minutes' })}<div class="data-list">${exerciseRows}</div></article>
    <article class="card panel"><div class="card-header"><div><h2>Personal reminders</h2><span class="tag">${list.length}</span></div><button class="button small ghost" data-action="add-reminder">＋ Add</button></div>${list.length ? `<div class="routine-list" style="margin-top:8px">${routineList(list.length)}</div>` : '<div class="empty-state">No reminders set.</div>'}<p class="form-note">Use Maya's assigned care plan for medication and exercise instructions.</p></article></section>`;
}

function renderCare() {
  const packets = state.carePackets.slice().reverse();
  const supportBanner = state.crewCheck?.key === 'support' ? '<div class="checkin-banner"><span><b>Support requested.</b> Prepare a private handoff when you are ready.</span></div>' : '';
  const ruleStatus = state.alertRules ? `<p class="form-note">${esc(state.alertRules.name)} · v${esc(state.alertRules.version)} · ${state.alertRules.rules.length} rules loaded · shape checked, not medically verified.</p>` : '<p class="form-note">No clinical alert limits are active. The app will not invent medical thresholds.</p>';
  const activeAlerts = (state.alerts || []).filter(alert => alert.status === 'open').length;
  return `${heading('MEDICAL SUPPORT', 'Offline handoff', 'Stage a note on this device. Export it when an approved link is available.', `<span class="tag amber">LOCAL QUEUE</span>`)}${supportBanner}
    <section class="handoff-banner"><span class="handoff-icon">↗</span><div><b>Built for delayed communications</b><small>Your note, selected trends, and optional media stay here until you choose to export them.</small></div><span class="handoff-state">${packets.length ? `${packets.length} STAGED` : 'READY'}</span></section>
    <section class="grid two-col" style="margin-top:12px"><div class="stack"><article class="card panel"><div class="card-header"><div><h2>Mission alert rules</h2><p class="card-subtitle">Only use limits supplied by an authorized crew medical team.</p></div><label class="button small ghost" for="alert-rule-import">Import rule set<input id="alert-rule-import" type="file" accept=".json,application/json" hidden></label></div>${ruleStatus}<p class="form-note">${activeAlerts ? `${activeAlerts} active local rule alert(s).` : 'No active rule triggers.'} Alerts are visible here and on Home. A button prepares a reviewed handoff file; nothing routes to personnel automatically.</p><div class="form-note">Quality flags from the sensor are always shown separately. No medical default limits are embedded.</div></article><form id="care-form" class="card panel"><div class="form-grid"><div class="field"><label for="recipient">REVIEW FOR</label><select id="recipient"><option>Onboard medical officer</option><option>Flight surgeon · ground team</option><option>Private crew note</option></select></div><div class="field"><label for="care-urgency">REVIEW TIMING</label><select id="care-urgency"><option>Routine review</option><option ${state.crewCheck?.key === 'support' ? 'selected' : ''}>Request review soon</option></select></div><div class="field" style="grid-column:1/-1"><label for="care-note">WHAT CHANGED? · OPTIONAL</label><textarea id="care-note" rows="3" placeholder="Describe what you noticed and when."></textarea></div><div class="field" style="grid-column:1/-1"><label for="care-media">ADD PHOTO OR VIDEO · OPTIONAL</label><input class="media-input" id="care-media" type="file" accept="image/*,video/*"><video id="video-preview" class="preview" controls playsinline></video><img id="image-preview" class="preview" alt="Local image preview"><small>Up to 20 MB · stored locally with this handoff.</small></div></div>
      <div class="toggle-row"><label for="include-trends">Include recent health snapshot</label><input id="include-trends" class="toggle" type="checkbox" checked></div><div class="toggle-row"><label for="consent">I reviewed what will be included</label><input id="consent" class="toggle" type="checkbox"></div><div class="form-actions"><button class="button ghost" type="button" data-action="clear-care">Clear</button><button class="button primary" type="submit">Stage handoff</button></div><div class="form-note">Nothing is sent. You stay in control of the exported file.</div></form></div>
    <div class="stack"><article class="card panel"><div class="card-header"><div><h2>Local handoff queue</h2><p class="card-subtitle">Ready for your review and export</p></div><span class="tag">${packets.length}</span></div>${packets.length ? packets.map(packet => `<div class="queue-card handoff-queue-card" style="margin-top:9px"><div class="handoff-queue-top"><b>${esc(packet.recipient)} · ${esc(packet.priority)}</b><span class="tag amber">ON DEVICE</span></div><p>${esc(packet.note || 'No note added')}${packet.media ? `<br>▣ ${esc(packet.media)}` : ''}${packet.includeTrends ? '<br>＋ Recent health snapshot included' : ''}<br>${new Date(packet.created).toLocaleString()}</p><button class="button small primary" data-care-export="${esc(packet.id || packet.created)}">Export handoff file</button></div>`).join('') : '<div class="empty-state">No handoffs staged</div>'}</article></div></section>`;
}

function renderSourcesLegacy() {
  const sources = [
    { group: 'CHALLENGE', name: 'Health Monitoring Software for Space Missions', detail: 'The 2026 challenge asks teams to help astronauts monitor health and make better-informed decisions during missions.', url: NASA_LINKS.challenge, use: 'Defines the crew-facing mission-health goal.' },
    { group: 'NASA HRP', name: 'Risks of Human Spaceflight', detail: 'NASA tracks health risks including bone and muscle changes, radiation, sleep, behavioral health, and reduced fitness.', url: NASA_LINKS.risks, use: 'Shapes the health domains and countermeasure workflow.' },
    { group: 'NASA OSDR · CONNECTED ARCHIVE', name: 'Environmental Data Application (EDA)', detail: 'The public EDA API provides mission-level experimental telemetry including ISS/ground temperature, relative humidity, CO₂, and mission events. Data are historical and vary by mission.', url: 'https://visualization.osdr.nasa.gov/eda/api_reference', use: 'The Mission data view queries mission catalog and selected time windows at runtime.' },
    { group: 'NASA OSDR · CONNECTED ARCHIVE', name: 'RadLab data API', detail: 'The public RadLab API exposes DosTel instrument radiation rates, particle flux, timestamps, instrument identifiers, ISS position, altitude, and geomagnetic context.', url: 'https://visualization.osdr.nasa.gov/radlab/gui/data-api/', use: 'The Mission data view retrieves archived instrument records at runtime.' },
    { group: 'NASA TECHNOLOGY TRANSFER · DESIGN REFERENCE', name: 'Brahms & Ejenta remote health monitoring', detail: 'NASA reports that Brahms software was licensed to Ejenta, which adapted it for remote health monitoring. Beyond Pulse uses that source-aware collection and distribution idea as a design reference; this app does not run Brahms or connect to Ejenta or NASA flight systems.', url: 'https://www.nasa.gov/technology/tech-transfer-spinoffs/astronaut-artificial-intelligence-monitors-patients-at-home/', use: 'The local four-stage agent workflow is a Beyond Pulse prototype, demonstrated only with synthetic scenario values.' },
    { group: 'NASA EXPLORATION MEDICAL TECHNOLOGY', name: 'Flexible Ultrasound System', detail: 'NASA describes development of a flexible ultrasound capability for quantitative bone-health monitoring. The public resource does not provide an open probe protocol for this app.', url: NASA_LINKS.ultrasound, use: 'Body Health ingests device-exported QUS records, preserving source-reported SOS and metadata without converting them into a bone-density result.' },
    { group: 'NASA EXERCISE PHYSIOLOGY', name: 'Exercise Physiology and Countermeasures', detail: 'NASA research studies exercise countermeasures for spaceflight deconditioning.', url: NASA_LINKS.exercise, use: 'Crew plans and fitness reminders can be imported from an assigned schedule; no exercise prescription is invented.' },
    { group: 'CANADIAN SPACE AGENCY', name: 'Monitoring radiation for astronaut health', detail: 'CSA describes radiation instrumentation and research, including active neutron sensing.', url: NASA_LINKS.csaRadiation, use: 'Provides partner-agency context; it is not exposed here as a live sensor connection.' },
    { group: 'DEVICE INTEROPERABILITY', name: 'Bluetooth SIG health services', detail: 'This prototype includes standard BLE GATT adapters for heart rate, pulse oximetry, thermometry, blood pressure, body composition, weight scales, and treadmill fitness data.', url: 'https://www.bluetooth.com/specifications/specs/', use: 'Compatible devices can be paired locally. Device measurements remain labeled as device-reported; these are not NASA flight hardware interfaces.' }
  ];
  const sourceCards = sources.map(source => `<div class="source-item"><div class="eyebrow">${esc(source.group)}</div><a href="${source.url}" target="_blank" rel="noreferrer">${esc(source.name)} ↗</a><p>${esc(source.detail)}</p><p><b>Integration:</b> ${esc(source.use)}</p></div>`).join('');
  return `${heading('SYSTEM SOURCES', 'Data & interfaces', 'Reference material and the live integration boundary.', '<button class="button ghost" data-view-jump="today">Back to home</button>')}
    <div class="disclaimer"><b>Flight link status · not provisioned.</b> NASA EDA and RadLab are live public API queries of historical mission archives. Compatible BLE devices and QUS exports enter the same source-aware workspace. The challenge resources do not include a public private-crew biometrics feed or spacecraft command/telemetry credentials.</div>
    <section class="grid two-col" style="margin-top:14px"><article class="card panel"><div class="card-header"><div><h2>Connected data sources</h2><p class="card-subtitle">Public NASA APIs, standards-based sensor inputs, and archived experiment context</p></div><span class="tag mint">PROVENANCE SHOWN</span></div>${sourceCards}</article><div class="stack"><article class="card panel"><h2>What the system does with data</h2><div class="data-list"><div class="data-row"><b>Personal signals</b><span>Bluetooth or device export, each value time-stamped and source-labeled</span></div><div class="data-row"><b>QUS</b><span>Device-reported SOS only; no inferred bone-density score</span></div><div class="data-row"><b>Mission archives</b><span>EDA cabin/environment and RadLab radiation context; historical</span></div><div class="data-row"><b>Agent workflow</b><span>Four local prototype stages organize the synthetic scenario; no NASA/Ejenta connection</span></div><div class="data-row"><b>Signal Intelligence</b><span>Optional AI briefs for connected readings or, separately, synthetic demo values after consent</span></div><div class="data-row"><b>Medical handoff</b><span>Image/video and selected records are staged locally for review; nothing is transmitted</span></div></div></article><article class="card panel"><h2>Operational limits</h2><p>Beyond Pulse is an independent challenge prototype, not a NASA product or validated medical device. Synthetic scenario values are clearly marked and isolated from device, archive, alert, export, and handoff records. A real flight deployment needs NASA-authorized device protocols, mission alert rules, identity and encryption controls, and approved onboard/ground routing.</p><span class="tag">TEAM · BEYOND PULSE</span></article></div></section>`;
}

function renderSources() {
  const sources = [
    { group: 'NASA HUMAN RESEARCH', name: 'Human spaceflight health risks', url: NASA_LINKS.risks },
    { group: 'NASA ARCHIVE REFERENCE', name: 'Environmental Data Application', url: 'https://visualization.osdr.nasa.gov/eda/' },
    { group: 'NASA ARCHIVE REFERENCE', name: 'RadLab radiation archive', url: 'https://visualization.osdr.nasa.gov/radlab/gui/overview/' },
    { group: 'NASA TECHNOLOGY REFERENCE', name: 'Brahms & Ejenta overview', url: 'https://www.nasa.gov/technology/tech-transfer-spinoffs/astronaut-artificial-intelligence-monitors-patients-at-home/' },
    { group: 'NASA ULTRASOUND RESEARCH', name: 'Flexible Ultrasound System', url: NASA_LINKS.ultrasound },
    { group: 'NASA EXERCISE RESEARCH', name: 'Exercise physiology and countermeasures', url: NASA_LINKS.exercise }
  ];
  return `${heading('ABOUT', 'Beyond Pulse', 'Team Beyond Pulse · NASA Space Apps Challenge')}
    <section class="grid two-col"><article class="card panel"><h2>Design references</h2><div class="source-list">${sources.map(source => `<div class="source-item"><div class="eyebrow">${esc(source.group)}</div><a href="${source.url}" target="_blank" rel="noreferrer">${esc(source.name)} ↗</a></div>`).join('')}</div></article>
    <article class="card panel"><h2>Data in this demo</h2><p>Maya is a fictional crew profile. Health, exercise, ultrasound and environment values are generated for the simulation; they are not NASA measurements or a medical record.</p><p>NASA’s public EDA and RadLab resources are historical archives. They are not live astronaut sensor feeds.</p><p>Beyond Pulse is an independent prototype and is not endorsed or operated by NASA.</p></article></section>`;
}

function render() {
  const views = { today: renderToday, trends: renderTrends, checkin: renderCheckin, bone: renderBone, radiation: renderRadiation, routine: renderRoutine, care: renderCare, sources: renderSources };
  document.getElementById('content').innerHTML = (views[activeView] || renderToday)();
  updateRoutineCount();
  bindViewEvents();
  if (activeView === 'radiation' && !radlabSnapshotLoaded && !radlabLoading) loadRadLab();
}

async function loadRadLab() {
  if (radlabSnapshotLoaded || radlabLoading) return;
  radlabLoading = true;
  radlabSnapshotLoaded = true;
  try {
    const response = await fetch(RADLAB_SAMPLE_PATH, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Archive snapshot unavailable');
    radlab = { ...await response.json(), archive_snapshot: true };
  } catch (error) {
    radlab = null;
    radlabError = error.message;
  } finally {
    radlabLoading = false;
    if (activeView === 'radiation') render();
  }
}
async function fetchRadLab(silent = false) {
  if (radlabLoading) return;
  const start = document.getElementById('radlab-start')?.value || radlabWindow.start;
  const end = document.getElementById('radlab-end')?.value || radlabWindow.end;
  radlabWindow = { start, end };
  radlabLoading = true; radlabError = '';
  if (activeView === 'radiation') render();
  try {
    const params = new URLSearchParams({ start, end, instrument: 'DosTel' });
    const response = await fetch(`/api/radlab?${params}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `NASA query failed (${response.status})`);
    radlab = body;
    if (!silent) toast(`Fetched ${body.records.length} NASA RadLab archive rows`);
  } catch (error) {
    radlabError = `NASA query unavailable: ${error.message}. The bundled historical RadLab snapshot is retained and labeled as an archive.`;
    if (!silent) toast('NASA RadLab query unavailable · historical archive snapshot retained');
  } finally {
    radlabLoading = false;
    if (activeView === 'radiation') render();
  }
}
async function loadEdaMissions() {
  edaLoading = true; edaError = '';
  if (activeView === 'radiation') render();
  try {
    const response = await fetch('/api/eda/missions', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `NASA EDA query failed (${response.status})`);
    edaMissions = payload.missions || [];
    if (!edaMissions.some(item => item.name === edaMission)) edaMission = edaMissions[0]?.name || '';
    if (activeView === 'radiation') render();
    if (edaMission) await fetchEda(true);
  } catch (error) {
    edaError = error.message;
  } finally {
    edaLoading = false;
    if (activeView === 'radiation') render();
  }
}
async function fetchEda(silent = false) {
  if (edaLoading && !edaMissions.length) return;
  const mission = document.getElementById('eda-mission')?.value || edaMission;
  const start = document.getElementById('eda-start')?.value || edaWindow.start;
  const end = document.getElementById('eda-end')?.value || edaWindow.end;
  edaMission = mission; edaWindow = { start, end }; edaLoading = true; edaError = '';
  if (activeView === 'radiation') render();
  try {
    const params = new URLSearchParams({ mission, start, end });
    const response = await fetch(`/api/eda?${params}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `NASA EDA query failed (${response.status})`);
    eda = payload;
    if (!silent) toast(`Retrieved ${payload.records.length} NASA EDA archive records`);
  } catch (error) {
    edaError = error.message;
    if (!silent) toast(`NASA EDA archive unavailable: ${error.message}`);
  } finally {
    edaLoading = false;
    if (activeView === 'radiation') render();
  }
}
async function checkAIAvailability() {
  const label = document.getElementById('ai-status');
  const button = document.getElementById('generate-ai-summary');
  const scenarioButton = document.getElementById('generate-scenario-ai');
  const scenarioLabel = document.getElementById('scenario-ai-status');
  if (!label && !button && !scenarioButton) return;
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`AI status returned ${response.status}`);
    const status = await response.json();
    const model = status.ai_model === 'gpt-6.1-terra' ? 'GPT-6.1 Terra' : status.ai_model;
    if (label) label.textContent = status.ai_configured ? `${model} · selected readings only after consent` : 'AI unavailable';
    if (button) button.disabled = !status.ai_configured || aiInputObservations().length === 0;
    if (scenarioButton) scenarioButton.disabled = !status.ai_configured || !state.simulationEnabled;
    if (scenarioLabel) scenarioLabel.textContent = status.ai_configured ? `${model} · simulation only · review before sharing` : 'AI offline · local summary still available';
  } catch {
    if (label) label.textContent = 'AI service unavailable';
    if (button) button.disabled = true;
    if (scenarioButton) scenarioButton.disabled = true;
    if (scenarioLabel) scenarioLabel.textContent = 'AI unavailable · local scenario remains on this device';
  }
}
function generateAISummary() {
  const selected = aiInputObservations();
  if (!selected.length) return toast('Connect a sensor or load mission data first');
  const mode = document.getElementById('ai-mode')?.value || 'crew_brief';
  const sources = [...new Set(selected.map(item => item.source))].join(', ');
  showModal('Review AI data sharing', `<p><b>Provider:</b> OpenAI · ${esc(mode.replaceAll('_', ' '))}</p><p><b>Included:</b> ${selected.length} selected readings, units, source labels, timestamps, quality flags, and mission context where present.</p><p><b>Not included:</b> crew notes, mood, name, photos, videos, or medical-support drafts.</p><p><b>Sources:</b> ${esc(sources)}</p><label class="ai-consent-row"><input id="ai-share-consent" type="checkbox"> I consent to send these selected measurements to OpenAI for this summary.</label><div class="form-actions"><button class="button ghost" type="button" id="ai-cancel">Cancel</button><button class="button primary" type="button" id="ai-confirm" disabled>Send selected readings</button></div>`);
  const checkbox = document.getElementById('ai-share-consent');
  const confirm = document.getElementById('ai-confirm');
  checkbox?.addEventListener('change', () => { if (confirm) confirm.disabled = !checkbox.checked; });
  document.getElementById('ai-cancel')?.addEventListener('click', () => document.getElementById('modal').close());
  confirm?.addEventListener('click', () => {
    if (!checkbox?.checked) return;
    document.getElementById('modal').close();
    sendAISummary(selected, mode);
  });
}
function generateScenarioAISummary() {
  if (!state.simulationEnabled) return toast('Resume the synthetic scenario first');
  const summaryMetrics = ['heart_rate','spo2','body_temperature','respiration','sleep','exercise_minutes','qus_speed_of_sound','cabin_temperature','cabin_co2','dose_equivalent_rate'];
  const selected = summaryMetrics.flatMap(metric => scenarioSeries(metric).slice(-4)).map(row => ({
    metric: row.metric, value: row.value, unit: row.unit, measured_at: row.measuredAt,
    source: SIMULATION_SOURCE, source_kind: 'simulation', context: { profile: 'Maya', synthetic: true }
  }));
  showModal('Review simulated data sharing', `<p><b>Provider:</b> OpenAI · synthetic scenario summary</p><p><b>Included:</b> ${selected.length} generated demo values and their scenario labels/timestamps. These are not NASA data or a real astronaut record.</p><p><b>Not included:</b> connected device observations, NASA archives, check-in notes, name, photos, or videos.</p><label class="ai-consent-row"><input id="scenario-ai-share-consent" type="checkbox"> I consent to send these fictional scenario values to OpenAI for this demo brief.</label><div class="form-actions"><button class="button ghost" type="button" id="scenario-ai-cancel">Cancel</button><button class="button primary" type="button" id="scenario-ai-confirm" disabled>Send scenario values</button></div>`);
  const checkbox = document.getElementById('scenario-ai-share-consent');
  const confirm = document.getElementById('scenario-ai-confirm');
  checkbox?.addEventListener('change', () => { if (confirm) confirm.disabled = !checkbox.checked; });
  document.getElementById('scenario-ai-cancel')?.addEventListener('click', () => document.getElementById('modal').close());
  confirm?.addEventListener('click', () => {
    if (!checkbox?.checked) return;
    document.getElementById('modal').close();
    sendScenarioAISummary(selected, 'crew_brief');
  });
}
async function sendScenarioAISummary(selected, mode) {
  const output = document.getElementById('scenario-ai-output');
  const button = document.getElementById('generate-scenario-ai');
  const status = document.getElementById('scenario-ai-status');
  if (!output || !button || !selected.length) return;
  button.disabled = true; button.textContent = 'Preparing…';
  if (status) status.textContent = 'Sending only the fictional scenario values you approved…';
  try {
    const response = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, observations: selected, consent: true }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'AI scenario summary unavailable');
    output.textContent = `SIMULATION ONLY · synthetic Beyond Pulse scenario\n\n${result.summary}`;
    output.hidden = false;
    const model = result.model === 'gpt-6.1-terra' ? 'GPT-6.1 Terra' : result.model;
    if (status) status.textContent = `${model} · synthetic scenario only · ${new Date(result.created_at_utc).toLocaleTimeString()}`;
  } catch (error) {
    output.textContent = `LOCAL SUMMARY · SIMULATED DATA\n\n${localScenarioBrief()}`;
    output.hidden = false;
    if (status) status.textContent = /quota|billing/i.test(error.message) ? 'Cloud AI quota reached · local brief shown' : 'Cloud AI unavailable · local brief shown';
  } finally {
    button.disabled = false;
    button.textContent = 'Prepare AI scenario brief';
  }
}
async function sendAISummary(selected, mode) {
  const output = document.getElementById('ai-summary-output');
  const button = document.getElementById('generate-ai-summary');
  const status = document.getElementById('ai-status');
  if (!output || !button || !selected.length) return;
  button.disabled = true; button.textContent = 'Preparing…';
  if (status) status.textContent = 'Sending only the readings you approved…';
  try {
    const response = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, observations: selected, consent: true }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'AI summary unavailable');
    output.textContent = result.summary;
    output.hidden = false;
    const model = result.model === 'gpt-6.1-terra' ? 'GPT-6.1 Terra' : result.model;
    if (status) status.textContent = `${model} · selected source data · ${new Date(result.created_at_utc).toLocaleTimeString()}`;
  } catch (error) {
    if (status) status.textContent = `AI brief unavailable: ${error.message}`;
  } finally {
    button.disabled = aiInputObservations().length === 0;
    button.textContent = 'Prepare AI brief';
  }
}
function answerSI(question) {
  const q = question.toLowerCase();
  if (/bone|ultrasound|qus|scan/.test(q)) return 'Body Health records the speed-of-sound value, device-reported site and device time when an export provides them. It does not infer bone mineral density. NASA’s Flexible Ultrasound System is a developing capability, and this prototype has no flight probe protocol.';
  if (/radiation|radlab|dose|cabin|co2|humidity/.test(q)) return 'Mission data queries NASA RadLab radiation-instrument records and NASA EDA environmental mission telemetry. Both are historical archive data. They are not a live cabin feed, personal dosimeter, or individual crew exposure.';
  if (/sleep|pulse|heart|trend|pattern|why|alert|sensor/.test(q)) {
    const recent = historyData().slice(-12), flagged = recent.filter(row => row.quality?.state === 'questionable');
    if (!recent.length) return 'No personal sensor records are connected or imported yet. The workspace starts empty and does not make a health assessment without source data.';
    if (flagged.length) return `${flagged.length} recent record(s) carry a device quality flag. Review the source and timestamp, then repeat or follow the assigned crew protocol. This is a data-quality notice, not a diagnosis.`;
    return `${recent.length} recent source record(s) are available. The app shows each recorded value, time, and source; it has no mission-approved clinical alert thresholds installed and does not label readings normal or abnormal.`;
  }
  if (/doctor|share|image|video|send/.test(q)) return 'Medical Support can stage a note with an optional image or video and selected recent source data. It stays on this device until you export it; the app has no secure link to medical personnel or a ground system.';
  return 'I can explain connected Bluetooth readings, QUS exports, NASA archive data, data-quality flags, or the local medical handoff. I use only records shown in the workspace and do not diagnose or recommend treatment.';
}
function askSI() {
  const field = document.getElementById('ask-si'); if (!field || !field.value.trim()) return;
  showModal('Signal Intelligence · explanation', `<div class="assistant-answer">${esc(answerSI(field.value.trim()))}</div><p class="source-caveat">On-device source explanation · no diagnosis or clinical threshold.</p>`);
}
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const parseLine = line => {
    const cells = []; let cell = '', quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) { cell += '"'; index++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(cell.trim()); cell = ''; }
      else cell += char;
    }
    cells.push(cell.trim()); return cells;
  };
  const header = parseLine(lines[0]).map(value => value.toLowerCase().trim().replace(/[ -]+/g, '_'));
  return lines.slice(1).map(line => {
    const cells = parseLine(line), row = {};
    header.forEach((key, index) => { row[key] = cells[index] ?? ''; });
    return row;
  });
}
function normalizeKeys(row) {
  return row && typeof row === 'object' ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), value])) : row;
}
async function readDataFile(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a device export smaller than 10 MB.');
  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.csv')) return { rows: parseCsv(text), metadata: {} };
  const raw = JSON.parse(text);
  if (Array.isArray(raw)) return { rows: raw, metadata: {} };
  const parsed = normalizeKeys(raw);
  const rows = parsed.records || parsed.observations || parsed.measurements || parsed.sessions || parsed.scans || parsed.data;
  return { rows: Array.isArray(rows) ? rows : [parsed], metadata: parsed.metadata || parsed.device || parsed.probe || {} };
}
function explicitUtcTimestamp(raw) {
  if (typeof raw !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw.trim())) return null;
  const time = Date.parse(raw); return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
const importedMetricAliases = {
  heart_rate: ['heart_rate', 'heart_rate_bpm', 'hr', 'pulse_bpm'],
  spo2: ['spo2', 'spo2_percent', 'oxygen_saturation', 'oxygen_percent'],
  body_temperature: ['body_temperature', 'body_temperature_c', 'temperature_c', 'temp_c'],
  muscle_mass: ['muscle_mass', 'muscle_mass_kg'],
  muscle_percentage: ['muscle_percentage', 'muscle_percent'],
  fat_free_mass: ['fat_free_mass', 'fat_free_mass_kg'],
  soft_lean_mass: ['soft_lean_mass', 'soft_lean_mass_kg'],
  body_water_mass: ['body_water_mass', 'body_water_kg'],
  body_fat_percentage: ['body_fat_percentage', 'body_fat_percent', 'fat_percent'],
  body_weight: ['body_weight', 'weight_kg', 'mass_kg'],
  body_mass_index: ['body_mass_index', 'bmi'],
  respiration: ['respiration', 'respiration_rate', 'breaths_per_minute'],
  systolic_bp: ['systolic_bp', 'systolic', 'systolic_mmhg'],
  diastolic_bp: ['diastolic_bp', 'diastolic', 'diastolic_mmhg'],
  mean_bp: ['mean_bp', 'mean_arterial_pressure', 'map_mmhg'],
  rr_interval: ['rr_interval', 'rr_interval_ms'],
  energy_expended: ['energy_expended', 'energy_expended_kj'],
  sleep: ['sleep', 'sleep_hours', 'sleep_duration_hours'],
  resting_pulse: ['resting_pulse', 'resting_heart_rate', 'rhr'],
  hrv: ['hrv', 'hrv_ms'],
  exercise_minutes: ['exercise_minutes', 'exercise_duration_min'],
  basal_metabolism: ['basal_metabolism', 'basal_metabolism_kj'],
  body_impedance: ['body_impedance', 'impedance_ohm', 'impedance_ohms'],
  body_height: ['body_height', 'height_m'],
  treadmill_speed: ['treadmill_speed', 'speed_kmh'],
  treadmill_average_speed: ['treadmill_average_speed', 'average_speed_kmh'],
  treadmill_distance: ['treadmill_distance', 'distance_m'],
  treadmill_incline: ['treadmill_incline', 'incline_percent'],
  treadmill_elevation_gain: ['treadmill_elevation_gain', 'elevation_gain_m'],
  treadmill_elevation_loss: ['treadmill_elevation_loss', 'elevation_loss_m'],
  fitness_met: ['fitness_met', 'met'],
  treadmill_elapsed_time: ['treadmill_elapsed_time', 'elapsed_minutes'],
  treadmill_remaining_time: ['treadmill_remaining_time', 'remaining_minutes'],
  treadmill_pace: ['treadmill_pace', 'pace_s_km'],
  treadmill_average_pace: ['treadmill_average_pace', 'average_pace_s_km'],
  fitness_energy_per_hour: ['fitness_energy_per_hour', 'energy_kcal_hour'],
  fitness_energy_per_minute: ['fitness_energy_per_minute', 'energy_kcal_minute'],
  treadmill_force: ['treadmill_force', 'force_newtons'],
  treadmill_power: ['treadmill_power', 'power_watts']
};
function normalizeImportedMeasurement(metric, value, rawUnit) {
  const unit = String(rawUnit || metricMeta[metric].unit).trim().toLowerCase().replace(/\s+/g, '');
  const canonical = metricMeta[metric].unit.toLowerCase().replace(/\s+/g, '');
  if (unit === canonical) return { value, unit: metricMeta[metric].unit };
  const sameUnitAliases = {
    body_temperature: ['c','celsius'],
    spo2: ['percent','percentage','pct'], muscle_percentage: ['percent','percentage','pct'], body_fat_percentage: ['percent','percentage','pct'],
    body_impedance: ['ohm','ohms'], body_mass_index: ['kg/m2']
  };
  if ((sameUnitAliases[metric] || []).includes(unit)) return { value, unit: metricMeta[metric].unit };
  const massMetrics = ['body_weight','muscle_mass','fat_free_mass','soft_lean_mass','body_water_mass'];
  if (massMetrics.includes(metric) && ['lb','lbs','pound','pounds'].includes(unit)) return { value: value * 0.45359237, unit: 'kg' };
  if (metric === 'body_height' && ['cm','centimeter','centimeters'].includes(unit)) return { value: value / 100, unit: 'm' };
  if (metric === 'body_height' && ['in','inch','inches'].includes(unit)) return { value: value * 0.0254, unit: 'm' };
  if (metric === 'body_temperature' && ['°f','f','fahrenheit'].includes(unit)) return { value: (value - 32) * 5 / 9, unit: '°C' };
  if (['systolic_bp','diastolic_bp','mean_bp'].includes(metric) && ['kpa'].includes(unit)) return { value: value * 7.50062, unit: 'mmHg' };
  if (['treadmill_speed','treadmill_average_speed'].includes(metric) && ['m/s','ms-1'].includes(unit)) return { value: value * 3.6, unit: 'km/h' };
  if (['treadmill_speed','treadmill_average_speed'].includes(metric) && ['mph','mi/h'].includes(unit)) return { value: value * 1.609344, unit: 'km/h' };
  if (metric === 'treadmill_distance' && ['km'].includes(unit)) return { value: value * 1000, unit: 'm' };
  if (metric === 'treadmill_distance' && ['mi','mile','miles'].includes(unit)) return { value: value * 1609.344, unit: 'm' };
  if (['energy_expended','basal_metabolism'].includes(metric) && ['kcal','calorie','calories'].includes(unit)) return { value: value * 4.184, unit: 'kJ' };
  return null;
}
async function importSensorFile(file) {
  const { rows } = await readDataFile(file), imported = [];
  if (rows.length > 5000) throw new Error('Use a sensor file with 5,000 rows or fewer.');
  const aliases = Object.entries(importedMetricAliases).flatMap(([metric, names]) => names.map(name => [name, metric]));
  for (const originalRow of rows) {
    const row = normalizeKeys(originalRow);
    if (!row || typeof row !== 'object') continue;
    const candidates = [];
    const named = String(row.metric || row.signal || row.measurement || '').toLowerCase().replace(/[ -]+/g, '_');
    const direct = aliases.find(([name]) => name === named)?.[1];
    if (direct) candidates.push([direct, row.value ?? row.reading ?? row.result]);
    else for (const [alias, metric] of aliases) if (row[alias] !== undefined) candidates.push([metric, row[alias]]);
    for (const [metric, raw] of candidates) {
      if (raw === '' || raw === null || raw === undefined) continue;
      const rawValue = Number(raw); if (!Number.isFinite(rawValue)) continue;
      const normalized = normalizeImportedMeasurement(metric, rawValue, row.unit);
      if (!normalized) continue;
      const { value, unit } = normalized;
      const receivedAt = new Date().toISOString();
      const sourceTime = String(row.measured_at || row.timestamp || row.time || '');
      const measuredAt = explicitUtcTimestamp(sourceTime);
      state.observations.push({ id: crypto.randomUUID(), sampleId: crypto.randomUUID(), metric, value, unit, measuredAt, receivedAt, source: { kind: 'device_import', label: 'Imported device file' }, quality: { state: row.quality === 'valid' || row.quality === 'questionable' ? row.quality : 'unknown', flags: Array.isArray(row.flags) ? row.flags.map(String).slice(0, 8) : [] }, context: sourceTime && !measuredAt ? { sourceTime, timeBasis: 'timezone not supplied' } : {}, parserVersion: 'beyond-pulse-import-v1' });
      imported.push(metric);
    }
  }
  if (!imported.length) throw new Error('No supported measurement fields found. Include a metric/value column or recognized signal columns.');
  state.observations = state.observations.slice(-5000); recalculateConfiguredAlerts(); persist();
  return imported.length;
}
function qusImportRecords(rows, metadata, fileName) {
  const sosFields = ['speed_of_sound_m_s', 'speed_of_sound', 'sos', 'sos_m_s', 'qus_sos'];
  return rows.map(originalRow => {
    const row = normalizeKeys(originalRow), cleanMetadata = normalizeKeys(metadata) || {};
    if (!row || typeof row !== 'object') return null;
    const raw = sosFields.map(key => row[key]).find(value => value !== undefined && value !== null && value !== '');
    const sos = Number(raw);
    if (!Number.isFinite(sos) || sos < 1000 || sos > 4000) return null;
    const sourceTime = String(row.measured_at || row.timestamp || row.time || row.date_time || '');
    const measuredAt = explicitUtcTimestamp(sourceTime);
    const site = row.body_site || row.site || row.scan_site || cleanMetadata.body_site || cleanMetadata.site || null;
    const device = row.device || row.device_name || row.probe || row.probe_name || cleanMetadata.name || cleanMetadata.device_name || cleanMetadata.probe || 'QUS device name not reported';
    const sourceQuality = String(row.quality || row.scan_quality || '');
    const rawQuality = sourceQuality.toLowerCase();
    const quality = ['valid', 'questionable'].includes(rawQuality) ? rawQuality : 'unknown';
    return { id: crypto.randomUUID(), sos, site: site ? String(site) : null, device: String(device), measuredAt, sourceTime: sourceTime && !measuredAt ? sourceTime : null, timeBasis: measuredAt ? 'UTC with source offset' : sourceTime ? 'timezone not supplied' : 'not reported', receivedAt: new Date().toISOString(), source: 'qus_export', quality, sourceQuality };
  }).filter(Boolean);
}
async function importQusFile(file) {
  const { rows, metadata } = await readDataFile(file);
  if (rows.length > 2000) throw new Error('Use a QUS file with 2,000 sessions or fewer.');
  const records = qusImportRecords(rows, metadata, file.name);
  if (!records.length) throw new Error('No device-reported speed-of-sound values were found in this export.');
  state.scans.push(...records); state.scans = state.scans.slice(-2000); recalculateConfiguredAlerts(); persist();
  return records.length;
}
async function importCrewPlanFile(file) {
  const { rows } = await readDataFile(file);
  if (rows.length > 300) throw new Error('Use a schedule with 300 activities or fewer.');
  const plan = rows.map(normalizeKeys).filter(row => row && typeof row === 'object' && String(row.title || row.activity || row.name || '').trim()).map(row => ({
    id: crypto.randomUUID(), time: String(row.time_utc || row.time || ''), title: String(row.title || row.activity || row.name).slice(0, 120),
    detail: String(row.detail || row.instruction || '').slice(0, 300), group: String(row.group || row.category || 'Crew plan').slice(0, 60)
  }));
  if (!plan.length) throw new Error('No activities found. Include a title column.');
  state.crewPlan = plan; persist(); return plan.length;
}
async function importAlertRuleFile(file) {
  if (file.size > 1024 * 1024) throw new Error('Choose a mission rules file smaller than 1 MB.');
  const parsed = JSON.parse(await file.text());
  const incoming = parsed.rules || parsed.alert_rules;
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > 100) throw new Error('Rule file must contain 1–100 rules in a rules array.');
  const allowed = new Set(Object.keys(metricMeta).filter(metric => !['cabin_temperature','cabin_humidity','cabin_co2','absorbed_dose_rate','dose_equivalent_rate','particle_flux'].includes(metric)));
  const rules = incoming.map((rule, index) => {
    const metric = String(rule.metric || '');
    const name = String(rule.name || rule.label || `Mission rule ${index + 1}`).trim().slice(0, 100);
    const minRaw = rule.min ?? rule.minimum ?? null, maxRaw = rule.max ?? rule.maximum ?? null;
    const min = minRaw === null || minRaw === '' ? null : Number(minRaw);
    const max = maxRaw === null || maxRaw === '' ? null : Number(maxRaw);
    if (!allowed.has(metric) || (min == null && max == null) || (min != null && !Number.isFinite(min)) || (max != null && !Number.isFinite(max)) || (min != null && max != null && min >= max)) throw new Error(`Rule ${index + 1} has an unsupported signal or invalid bounds.`);
    if (rule.unit && String(rule.unit) !== metricMeta[metric].unit) throw new Error(`Rule ${index + 1} unit must be ${metricMeta[metric].unit}.`);
    const roles = Array.isArray(rule.notify_roles) ? rule.notify_roles : Array.isArray(rule.notifyRoles) ? rule.notifyRoles : [];
    return { id: String(rule.id || `rule-${index + 1}`).slice(0, 80), metric, name, min, max, unit: metricMeta[metric].unit, severity: ['advisory','urgent'].includes(rule.severity) ? rule.severity : 'advisory', notifyRoles: roles.map(role => String(role).slice(0,60)).slice(0,5) };
  });
  state.alertRules = { name: String(parsed.name || parsed.title || 'Imported mission rule set').slice(0,100), version: String(parsed.version || 'unspecified').slice(0,30), importedAt: new Date().toISOString(), rules };
  recalculateConfiguredAlerts(); persist();
  return { count: rules.length, active: state.alerts.filter(alert => alert.status === 'open').length };
}
function exportSummary() {
  const payload = {
    product: 'Beyond Pulse', team: 'Beyond Pulse', created_utc: new Date().toISOString(),
    prototype_boundary: 'Source-connected prototype; not a validated medical device or NASA flight system.',
    source_observations: state.observations,
    nasa_archives: { radlab: radlab || null, eda: eda || null },
    qus_device_records: state.scans,
    subjective_checkins: state.wellbeingEntries.map(({ note, ...entry }) => entry),
    crew_check_status: state.crewCheck,
    assigned_plan: taskItems().map(task => ({ id: task.id, time: task.time, title: task.title, detail: task.detail, completed: !!state.tasks[task.id] })),
    alert_rule_set: state.alertRules || null,
    limitations: ['NASA public archive queries are historical mission data, not current crew biometrics.', 'Bluetooth adapters require compatible standard GATT devices; they are not NASA flight hardware.', 'QUS values are recorded as supplied and are not converted to bone density.', 'AI summaries are optional, source-grounded general-purpose summaries, not medical decisions.', 'No flight alert route or secure medical transmission is connected.']
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'beyond-pulse-health-snapshot.json'; link.click(); URL.revokeObjectURL(link.href);
  toast('Health snapshot downloaded to this device');
}
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function handoffSnapshotHtml(snapshot) {
  if (!snapshot) return '<p class="muted">No trend snapshot was selected.</p>';
  const observations = (snapshot.measurements || []).slice(-100);
  const rows = observations.map(item => `<tr><th>${esc(metricMeta[item.metric]?.name || item.metric)}</th><td>${esc(item.value)} ${esc(item.unit || '')}</td><td>${esc(item.measured_at || item.received_at || 'Time unavailable')}</td><td>${esc(item.source || item.source_kind || 'Source not reported')}</td></tr>`).join('');
  const wellbeing = (snapshot.wellbeing || []).map(item => `<tr><td>${esc(item.recorded_at)}</td><td>${esc(item.status || 'Check-in')}</td><td>${item.energy == null ? '—' : `${esc(item.energy)}/10`}</td><td>${esc(item.mood || '—')}</td></tr>`).join('');
  return `<p class="muted">${esc(snapshot.dataKind)} · crew-selected snapshot</p><h2>Source measurements · ${observations.length}</h2>${observations.length ? `<table><thead><tr><th>Signal</th><th>Value</th><th>Source time / received time</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No device or NASA archive records selected.</p>'}<h2>Wellbeing check-ins · ${snapshot.wellbeing?.length || 0}</h2>${wellbeing ? `<table><thead><tr><th>Recorded</th><th>Status</th><th>Energy</th><th>Feeling</th></tr></thead><tbody>${wellbeing}</tbody></table>` : '<p class="muted">None selected.</p>'}`;
}
async function exportCarePacket(packetId) {
  const packet = state.carePackets.find(item => item.id === packetId || (!item.id && item.created === packetId));
  if (!packet) return toast('This handoff is no longer in the local queue');
  let mediaMarkup = '<p class="muted">No media attached.</p>';
  let mediaNotice = '';
  if (packet.attachmentId) {
    try {
      const attachment = await getHandoffAttachment(packet.attachmentId);
      if (!attachment) throw new Error('Attachment not found');
      const dataUrl = `data:${attachment.type};base64,${bufferToBase64(await attachment.blob.arrayBuffer())}`;
      mediaMarkup = attachment.type.startsWith('video/')
        ? `<video controls preload="metadata" src="${dataUrl}"></video>`
        : `<img alt="Crew-selected attachment" src="${dataUrl}">`;
    } catch {
      mediaMarkup = '<p class="muted">The selected attachment is unavailable in this browser profile.</p>';
    }
  } else if (packet.media) {
    mediaNotice = `<p class="muted">Older draft lists “${esc(packet.media)}”, but its media file was not stored by that draft.</p>`;
  }
  const created = new Date(packet.created);
  const dateLabel = Number.isNaN(created.getTime()) ? 'date unavailable' : created.toISOString();
  const title = `Beyond Pulse · health handoff`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'"><title>${title}</title><style>body{margin:0;background:#eef3f5;color:#15242c;font:16px/1.5 system-ui,sans-serif}main{max-width:820px;margin:32px auto;padding:28px;background:#fff;border:1px solid #d6e0e3;border-radius:14px}header{border-bottom:1px solid #d6e0e3;padding-bottom:18px}h1{font-size:26px;margin:0}h2{font-size:17px;margin:25px 0 8px}p{white-space:pre-wrap}.muted{color:#546975;font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;border-bottom:1px solid #e0e8eb;padding:9px}th{color:#3b515c}img,video{display:block;max-width:100%;max-height:520px;margin-top:10px;border-radius:8px}footer{margin-top:26px;border-top:1px solid #d6e0e3;padding-top:14px;color:#546975;font-size:12px}</style></head><body><main><header><p class="muted">BEYOND PULSE · OFFLINE HANDOFF</p><h1>Health review note</h1><p class="muted">Prepared ${esc(dateLabel)} · ${esc(packet.recipient)} · ${esc(packet.priority)}</p></header><h2>What changed</h2><p>${esc(packet.note || 'No note added.')}</p>${handoffSnapshotHtml(packet.trendSnapshot)}<h2>Selected media</h2>${mediaMarkup}${mediaNotice}<footer>Portable review file created on this device. It has not been sent to a clinician or mission system. Share only through an approved, consented medical channel. ${esc(packet.dataKind || 'Beyond Pulse prototype data; not validated for medical decisions.')}</footer></main></body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `beyond-pulse-handoff-${Number.isNaN(created.getTime()) ? 'local' : created.toISOString().slice(0, 10)}.html`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Portable handoff exported to this device');
}
function bindViewEvents() {
  document.querySelectorAll('[data-view-jump]').forEach(el => el.addEventListener('click', () => setView(el.dataset.viewJump)));
  document.querySelectorAll('[data-action="simulation-toggle"]').forEach(el => el.addEventListener('click', () => { state.simulationEnabled = !state.simulationEnabled; persist(); render(); toast(state.simulationEnabled ? 'Synthetic mission scenario resumed' : 'Synthetic mission scenario paused'); }));
  document.getElementById('scenario-trend-select')?.addEventListener('change', event => { scenarioTrendMetric = event.target.value; render(); });
  document.querySelectorAll('[data-task]').forEach(el => el.addEventListener('click', () => { state.tasks[el.dataset.task] = !state.tasks[el.dataset.task]; persist(); render(); toast(state.tasks[el.dataset.task] ? 'Routine item recorded on this device' : 'Routine item reopened'); }));
  document.querySelectorAll('[data-action="crew-status"]').forEach(el => el.addEventListener('click', () => {
    const key = el.dataset.status;
    const at = new Date().toISOString();
    state.crewCheck = { key, at };
    state.wellbeingEntries.push({ id: crypto.randomUUID(), at, status: key });
    state.wellbeingEntries = state.wellbeingEntries.slice(-500); persist();
    if (key === 'changed') {
      setView('checkin');
      document.getElementById('symptom-input')?.focus();
      toast('Add a private note if you want');
    } else if (key === 'support') {
      setView('care');
      toast('Review draft opened · nothing was sent');
    } else {
      render(); toast('Wellbeing check saved on this device');
    }
  }));
  document.querySelectorAll('[data-action="export-summary"]').forEach(el => el.addEventListener('click', exportSummary));
  document.querySelectorAll('[data-care-export]').forEach(el => el.addEventListener('click', () => exportCarePacket(el.dataset.careExport)));
  document.querySelectorAll('[data-instrument]').forEach(el => el.addEventListener('click', () => { radlabInstrument = el.dataset.instrument; render(); }));
  document.getElementById('fetch-radlab')?.addEventListener('click', () => fetchRadLab(false));
  document.getElementById('generate-ai-summary')?.addEventListener('click', generateAISummary);
  document.getElementById('generate-scenario-ai')?.addEventListener('click', generateScenarioAISummary);
  if (document.getElementById('ai-status') || document.getElementById('scenario-ai-status')) checkAIAvailability();
  document.querySelectorAll('.mini-card').forEach(el => {
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setView(el.dataset.viewJump); } });
  });
  document.querySelectorAll('[data-action="enable-notifications"]').forEach(el => el.addEventListener('click', async () => {
    if (!('Notification' in window)) return toast('This browser does not support device notifications; in-app reminders still work.');
    const permission = await Notification.requestPermission();
    toast(permission === 'granted' ? 'Device reminders enabled' : 'Notifications not enabled; in-app reminders still work.');
  }));
  document.querySelectorAll('[data-alert-handoff]').forEach(el => el.addEventListener('click', () => {
    const alert = state.alerts.find(item => item.id === el.dataset.alertHandoff);
    if (!alert) return toast('This alert is no longer active');
    setView('care');
    const note = document.getElementById('care-note');
    if (note) note.value = `Configured mission rule: ${alert.ruleName}\n${metricMeta[alert.metric]?.name || alert.metric}: ${alert.value} ${alert.unit} (${alert.boundary} configured bound ${alert.threshold})\nSource: ${alert.sourceLabel}\nRecorded: ${alert.measuredAt || alert.receivedAt}\nConfigured reviewers: ${alert.notifyRoles.join(', ') || 'not specified'}\n\nReview against the assigned mission medical procedure.`;
    const priority = document.getElementById('care-urgency'); if (priority) priority.selectedIndex = Math.min(1, priority.options.length - 1);
    document.getElementById('consent')?.focus(); toast('Review the handoff before staging · nothing was transmitted');
  }));
  document.getElementById('alert-rule-import')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const result = await importAlertRuleFile(file); render(); toast(`${result.count} mission rule(s) loaded · ${result.active} active · shape checked only`); }
    catch (error) { toast(error.message); }
    finally { event.target.value = ''; }
  });
  document.getElementById('qus-connect-info')?.addEventListener('click', () => showModal('Quantitative ultrasound interface', '<p>This workspace accepts QUS records from a device export and keeps the device-supplied speed-of-sound value, site, quality, and time provenance.</p><p>NASA’s Flexible Ultrasound System is not exposed through a public flight-device protocol. Pairing a probe requires its approved interface documentation and hardware. No bone-density score is inferred here.</p>'));
  document.querySelectorAll('[data-action="add-reminder"]').forEach(el => el.addEventListener('click', () => {
    showModal('Add a personal reminder', `<p>Enter reminders only from your own assigned care or exercise plan. Times use UTC. Alerts appear while this app is open.</p><form id="reminder-form"><div class="form-grid"><div class="field"><label for="new-reminder">REMINDER</label><input id="new-reminder" required placeholder="Assigned activity or medication reminder"></div><div class="field"><label for="new-reminder-time">TIME · UTC · OPTIONAL</label><input id="new-reminder-time" type="time"></div></div><div class="form-actions"><button class="button primary">Save reminder</button></div></form>`);
  }));
  document.getElementById('trend-select')?.addEventListener('change', event => { trendMetric = event.target.value; render(); });
  document.getElementById('eda-signal')?.addEventListener('change', event => { edaMetric = event.target.value; render(); });
  document.getElementById('fetch-eda')?.addEventListener('click', () => fetchEda(false));
  document.getElementById('energy-input')?.addEventListener('input', event => { const label = document.getElementById('energy-value'); if (label) label.textContent = event.target.value; });
  document.getElementById('checkin-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const at = new Date().toISOString();
    state.wellbeingEntries.push({ id: crypto.randomUUID(), at, energy: Number(document.getElementById('energy-input').value), mood: document.getElementById('mood-input').value, note: document.getElementById('symptom-input').value.trim(), status: 'logged' });
    state.wellbeingEntries = state.wellbeingEntries.slice(-500); state.crewCheck = { key: 'logged', at }; persist(); setView('today'); toast('Check-in saved on this device');
  });
  document.getElementById('scan-file')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const count = await importQusFile(file); render(); toast(`${count} QUS record(s) imported with source metadata`); }
    catch (error) { toast(error.message); }
    finally { event.target.value = ''; }
  });
  document.getElementById('plan-import')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const count = await importCrewPlanFile(file); render(); toast(`${count} assigned plan item(s) loaded`); }
    catch (error) { toast(error.message); }
    finally { event.target.value = ''; }
  });
  document.getElementById('radlab-file')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.records) && Array.isArray(parsed.columns) && Array.isArray(parsed.data)) {
        parsed.records = parsed.data.map(row => Object.fromEntries(parsed.columns.map((column, index) => [column, row[index]])));
        parsed.window_utc = 'Imported RadLab API export';
      }
      if (!Array.isArray(parsed.records)) throw new Error(); radlab = parsed; render(); toast('Imported NASA RadLab archive records'); }
    catch { toast('Could not read this JSON. Use the bundled RadLab sample format.'); }
  });
  document.getElementById('care-media')?.addEventListener('change', event => {
    const file = event.target.files?.[0]; if (!file) return;
    const image = document.getElementById('image-preview'), video = document.getElementById('video-preview');
    if (currentMediaUrl) URL.revokeObjectURL(currentMediaUrl); currentMediaUrl = URL.createObjectURL(file);
    image.style.display = 'none'; video.style.display = 'none';
    if (file.type.startsWith('video/')) { video.src = currentMediaUrl; video.style.display = 'block'; }
    else if (file.type.startsWith('image/')) { image.src = currentMediaUrl; image.style.display = 'block'; }
    toast(`${file.name} previewed locally · not uploaded`);
  });
  document.getElementById('care-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!document.getElementById('consent').checked) { toast('Review the included information before staging'); return; }
    const media = document.getElementById('care-media').files?.[0];
    if (media && (!media.type.startsWith('image/') && !media.type.startsWith('video/'))) { toast('Choose an image or video file'); return; }
    if (media && media.size > MAX_HANDOFF_MEDIA_BYTES) { toast('Choose a media file under 20 MB'); return; }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Staging…';
    try {
      const id = crypto.randomUUID();
      if (media) await saveHandoffAttachment(id, media);
      const includeTrends = document.getElementById('include-trends').checked;
      const measurements = aiInputObservations().slice(-100);
      const wellbeing = state.wellbeingEntries.slice(-7).map(({ at, status, energy, mood }) => ({ recorded_at: at, status, energy, mood }));
      const dataKind = measurements.length ? 'Crew-selected source measurements' : 'No source measurements available';
      state.carePackets.push({
        id, recipient: document.getElementById('recipient').value, priority: document.getElementById('care-urgency').value,
        note: document.getElementById('care-note').value.trim(), includeTrends,
        trendSnapshot: includeTrends ? { measurements, wellbeing, qus: state.scans.slice(-20), dataKind } : null,
        attachmentId: media ? id : null, media: media?.name || null, mediaType: media?.type || null,
        mediaSize: media?.size || 0, dataKind, created: new Date().toISOString(), status: 'Queued locally; not transmitted'
      });
      persist(); render(); toast('Handoff staged on this device · nothing was sent');
    } catch {
      submit.disabled = false; submit.textContent = 'Stage handoff';
      toast('Could not stage this handoff locally. Try a smaller file or remove the attachment.');
    }
  });
  document.querySelectorAll('[data-action="clear-care"]').forEach(el => el.addEventListener('click', () => { document.getElementById('care-form').reset(); document.getElementById('image-preview').style.display = 'none'; document.getElementById('video-preview').style.display = 'none'; toast('Draft cleared from the form'); }));
  document.querySelectorAll('[data-action="reset-tasks"]').forEach(el => el.addEventListener('click', () => { state.tasks = {}; persist(); render(); toast('Plan progress cleared'); }));
  document.getElementById('ask-si-send')?.addEventListener('click', askSI);
  document.getElementById('ask-si')?.addEventListener('keydown', event => { if (event.key === 'Enter') askSI(); });
}

document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => setView(el.dataset.view)));
document.getElementById('help-button').addEventListener('click', () => {
  showModal('Beyond Pulse', `<p>Maya's profile uses a NASA-inspired simulation. Values shown on Home are fictional demo data.</p><p>AI summaries are optional and require your consent before the selected demo values are shared.</p><button class="button ghost" id="open-team-notes">About this demo</button>`);
  document.getElementById('open-team-notes')?.addEventListener('click', () => { document.getElementById('modal').close(); setView('sources'); });
});
document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal').close());
document.getElementById('modal').addEventListener('click', event => { if (event.target.id === 'modal') event.currentTarget.close(); });
document.getElementById('modal').addEventListener('close', () => { if (currentMediaUrl) { URL.revokeObjectURL(currentMediaUrl); currentMediaUrl = null; } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('service-worker.js').catch(() => {});
checkDueReminders();
window.setInterval(checkDueReminders, 15000);
render();
