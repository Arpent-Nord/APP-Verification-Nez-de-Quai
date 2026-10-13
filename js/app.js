import { parseFRT } from './frt.js';
import { readSie, fmtChainage } from './alignment.js';
import { computeLeve, DEFAULTS } from './compute.js';
import { appendLeve, readDataSheets } from './xlsx.js';
import { renderChart } from './chart.js';
import { saveAlignments, loadAlignments, forgetAlignments, loadParams, saveParams } from './store.js';

export const VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgn = (v) => (v === null || v === undefined ? '–' : (v > 0 ? '+' : '') + v.toFixed(1));

const state = { frt: null, sie: [], xlsx: null, xlsxName: '', history: null, result: null, out: null, outName: '' };
const PARAM_KEYS = ['tolH', 'tolV', 'nomHTheo', 'nomHAsBuilt', 'nomV', 'codeRail', 'codeCoffrage', 'mailTo'];
const sqlReady = window.initSqlJs({ locateFile: (f) => `vendor/${f}` });

// ---------- paramètres ----------
function applyParams(p) { for (const k of PARAM_KEYS) $(k).value = p[k] ?? ''; }
function readParams() {
  const p = {};
  for (const k of PARAM_KEYS) {
    const v = $(k).value.trim();
    p[k] = ['codeRail', 'codeCoffrage', 'mailTo'].includes(k) ? v : Number(v);
  }
  return p;
}
applyParams(loadParams({ ...DEFAULTS, mailTo: '' }));
for (const k of PARAM_KEYS) $(k).addEventListener('change', () => saveParams(readParams()));
$('resetParams').addEventListener('click', () => { applyParams({ ...DEFAULTS, mailTo: $('mailTo').value }); saveParams(readParams()); });
$('ver').textContent = VERSION;

// ---------- fichiers ----------
const readBuf = (f) => f.arrayBuffer();
function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); }
}
function mark(input, nameEl, text) {
  $(nameEl).textContent = text;
  $(input).closest('.file').classList.toggle('has', !!text && text !== 'Aucun fichier');
}
function refreshRun() { $('run').disabled = !(state.frt && state.sie.length); }
function showError(msg) { const e = $('error'); e.textContent = msg; e.hidden = !msg; if (msg) e.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

$('frt').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const frt = parseFRT(decodeText(await readBuf(f)), f.name);
    const n147 = frt.points.filter((p) => p.code).length;
    if (!n147) throw new Error('Aucun point codé trouvé dans ce fichier : est-ce bien un rapport FRT ?');
    state.frt = frt; mark('frt', 'frtName', `${f.name} – levé ${frt.meta.job} du ${frt.meta.date}`); showError('');
  } catch (err) { state.frt = null; mark('frt', 'frtName', 'Aucun fichier'); showError(err.message); }
  refreshRun();
});

async function setAlignments(files, remember) {
  const SQL = await sqlReady;
  const als = [];
  for (const f of files) als.push(readSie(SQL, new Uint8Array(f.bytes), f.name));
  state.sie = als;
  mark('sie', 'sieName', als.map((a) => `${a.fileName} → Voie ${a.trackNo} (${a.name})`).join('\n'));
  if (remember) { await saveAlignments(files); showStored(files); }
  refreshRun();
}
$('sie').addEventListener('change', async (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  try { await setAlignments(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await readBuf(f) }))), $('rememberSie').checked); showError(''); }
  catch (err) { state.sie = []; mark('sie', 'sieName', 'Aucun fichier'); showError('Alignement illisible : ' + err.message); refreshRun(); }
});
function showStored(files) {
  $('storedSie').hidden = !files.length;
  $('storedSieText').textContent = files.length ? `Mémorisés : ${files.map((f) => f.name).join(', ')}` : '';
}
$('forgetSie').addEventListener('click', async () => { await forgetAlignments(); showStored([]); });
loadAlignments().then(async (files) => {
  if (!files.length) return;
  showStored(files);
  try { await setAlignments(files, false); } catch (err) { console.warn(err); }
});

$('xlsx').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const buf = await readBuf(f);
    state.history = extractHistory(await readDataSheets(window.JSZip, buf.slice(0)));
    state.xlsx = buf; state.xlsxName = f.name; mark('xlsx', 'xlsxName', f.name); showError('');
  } catch (err) { state.xlsx = null; mark('xlsx', 'xlsxName', 'Aucun fichier'); showError('Excel illisible : ' + err.message); }
  updateXlsxHint();
  if (state.result) renderResults();
});

// historique (valeurs déjà au classeur) pour les graphiques
function extractHistory(sheets) {
  const h = {};
  for (const s of sheets.filter((x) => x.isData)) {
    const m = s.name.match(/^(HORIZONTAL|VERTICAL)_TRACK\s*0*(\d+)$/i);
    const key = `${m[1][0].toUpperCase()}${Number(m[2])}`;
    const off = String(s.grid[0]?.[0] ?? '').startsWith('Levé') ? 1 : 0;
    const theo = [], ab = [], cc = [];
    for (const row of s.grid.slice(1)) {
      const g = (i) => row[off + i];
      if (typeof g(0) === 'number' && typeof g(1) === 'number') theo.push({ x: g(0), y: Math.round(g(1) * 10) / 10 });
      if (typeof g(2) === 'number' && typeof g(3) === 'number') ab.push({ x: g(2), y: Math.round(g(3) * 10) / 10 });
      if (typeof g(4) === 'number' && typeof g(5) === 'number') cc.push({ x: g(4), y: Math.round(g(5) * 10) / 10 });
    }
    h[key] = { theo, ab, cc };
  }
  return h;
}

// ---------- calcul ----------
$('run').addEventListener('click', () => {
  try {
    showError('');
    const P = readParams(); saveParams(P);
    state.result = computeLeve(state.frt, state.sie, P);
    if (!state.result.nCoffrage) throw new Error(`Aucun point de coffrage (code ${P.codeCoffrage}) n'a pu être rattaché aux alignements fournis.`);
    state.out = null; $('xlsxOut').hidden = true;
    renderResults();
    $('results').hidden = false;
    $('verdict').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { showError(err.message); }
});

function renderResults() {
  const R = state.result, P = R.params, m = R.meta, st = R.station;
  const bad = R.tracks.flatMap((t) => t.rows).filter((r) => !r.ok);
  $('verdict').className = 'verdict ' + (R.accepted ? 'ok' : 'bad');
  $('verdict').innerHTML = R.accepted
    ? `<span class="icon" aria-hidden="true">✔</span><div><div class="big">COULÉE ACCEPTÉE</div><div class="small">${R.nCoffrage} points de coffrage, tous dans ±${P.tolH} mm (H) et ±${P.tolV} mm (V) vs TQC as-built</div></div>`
    : `<span class="icon" aria-hidden="true">✖</span><div><div class="big">COULÉE REFUSÉE</div><div class="small">${bad.length} point(s) hors tolérance : ${bad.map((r) => esc(r.id)).join(', ')}</div></div>`;
  const clos = R.closures.map((c) => `${esc(c.ref)} : ${sgn(c.dN * 1000)} / ${sgn(c.dE * 1000)} / ${sgn(c.dZ * 1000)} mm`).join('<br>') || '–';
  $('summary').innerHTML = [
    ['Levé', `${esc(m.job)}`], ['Date / heure', `${esc(m.date)} ${esc(m.heure)}`], ['Instrument', `${esc(m.instrument)} ${m.serial ? 's/n ' + esc(m.serial) : ''}`],
    ['Station', `${esc(st.name)} – résiduel ${st.residual ? `${st.residual.dN.toFixed(3)} / ${st.residual.dE.toFixed(3)} / ${st.residual.dZ.toFixed(3)}` : 'n/d'}`],
    ['Fermetures (dN / dE / dZ)', clos],
    ...R.tracks.map((t) => [`Voie ${t.trackNo} – chaînages contrôlés`, esc(t.range)]),
  ].map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join('');
  $('warnings').innerHTML = R.warnings.map((w) => `<li>${esc(w)}</li>`).join('');

  const wrap = $('tracks'); wrap.innerHTML = '';
  for (const t of R.tracks) {
    const d = document.createElement('div'); d.className = 'track';
    const cls = (v, tol) => (v === null ? '' : Math.abs(v) > tol + 1e-9 ? 'out' : '');
    d.innerHTML = `<h3>Voie ${t.trackNo} <small>${esc(t.range)} · ${esc(t.al.name)}</small></h3>
      <div class="tablewrap"><table class="res"><thead><tr>
        <th>Point</th><th>Chaînage</th><th>ΔH as-built<br>(mm)</th><th>ΔV as-built<br>(mm)</th><th>Verdict</th><th>ΔH théo<br>(mm)</th><th>ΔV théo<br>(mm)</th><th>Source<br>as-built</th>
      </tr></thead><tbody>${t.rows.map((r) => `<tr>
        <td>${esc(r.id)}</td><td>${esc(r.chTxt)}</td>
        <td class="${cls(r.dHab, P.tolH)}">${sgn(r.dHab)}</td><td class="${cls(r.dVab, P.tolV)}">${sgn(r.dVab)}</td>
        <td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔ Conforme' : '✖ Hors tol.'}</td>
        <td>${sgn(r.dHth)}</td><td>${sgn(r.dVth)}</td><td>${esc(r.abSource)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="charts"><figure class="chart"></figure><figure class="chart"></figure></div>`;
    wrap.appendChild(d);
    const figs = d.querySelectorAll('figure');
    for (const [i, kind] of ['H', 'V'].entries()) {
      const hist = state.history?.[`${kind}${t.trackNo}`];
      const series = [];
      if (hist) {
        if (hist.cc.length) series.push({ name: 'Connect-Cité – théorique', color: 'var(--cc)', marker: 'dot', line: true, faded: true, points: hist.cc });
        if (hist.theo.length) series.push({ name: 'NouvLR antérieur – théorique', color: 'var(--theo)', marker: 'dot', line: true, faded: true, points: hist.theo });
        if (hist.ab.length) series.push({ name: 'NouvLR antérieur – as-built', color: 'var(--ab)', marker: 'dot', line: true, faded: true, points: hist.ab });
      }
      series.push({ name: `${m.job} – théorique`, color: 'var(--theo)', marker: 'circle', line: true, points: t.rows.map((r) => ({ x: r.ch, y: kind === 'H' ? r.dHth : r.dVth, label: r.id })) });
      series.push({ name: `${m.job} – as-built (TQC)`, color: 'var(--ab)', marker: 'square', line: true, points: t.rows.map((r) => ({ x: r.ch, y: kind === 'H' ? r.dHab : r.dVab, label: r.id })) });
      renderChart(figs[i], { title: `${kind === 'H' ? 'Horizontal' : 'Vertical'} – voie ${t.trackNo}`, series, tol: kind === 'H' ? P.tolH : P.tolV, trackNo: t.trackNo });
    }
  }
  updateXlsxHint();
}

// ---------- Excel ----------
function updateXlsxHint() {
  const ok = !!(state.xlsx && state.result);
  $('makeXlsx').disabled = !ok;
  $('xlsxHint').textContent = state.xlsx
    ? `Le levé sera ajouté à « ${state.xlsxName} » (nouvelle cellule fusionnée en colonne A et onglet « Calculs ${state.result?.meta.job ?? ''} »).`
    : 'Choisissez le dernier Excel cumulatif à l\'étape 1 pour générer l\'Excel.';
}

function outName() {
  const stem = state.xlsxName.replace(/\.xlsx$/i, '').replace(/_\d{6}[A-Z0-9]+(_fusion)?$/i, '');
  return `${stem}_${state.result.meta.job}.xlsx`;
}

$('makeXlsx').addEventListener('click', async () => {
  const btn = $('makeXlsx'); btn.disabled = true; btn.textContent = 'Génération…';
  try {
    showError('');
    const { bytes, report } = await appendLeve(window.JSZip, state.xlsx.slice(0), state.result);
    state.out = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    state.outName = outName();
    $('xlsxReport').textContent = `✔ ${state.outName} – ${report.sheets.reduce((s, x) => s + x.added, 0)} lignes ajoutées dans ${report.sheets.length} onglets + onglet « ${report.calcSheet} »${report.converted ? ' (gabarit d\'origine converti : colonne A ajoutée)' : ''}.`;
    $('xlsxOut').hidden = false;
    await renderPreview(bytes, report);
    $('xlsxOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { showError('Génération Excel impossible : ' + err.message); }
  btn.disabled = false; btn.textContent = 'Générer l\'Excel';
});

async function renderPreview(bytes, report) {
  const sheets = await readDataSheets(window.JSZip, bytes);
  const tabs = $('sheetTabs'); tabs.innerHTML = '';
  const show = (s) => {
    for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.name === s.name ? 'true' : 'false');
    const rep = report.sheets.find((x) => x.name === s.name);
    const nb = rep?.blocks.find((b) => b.isNew);
    const newRows = nb ? new Set(Array.from({ length: nb.n }, (_, i) => nb.start + i)) : new Set();
    const isCalc = s.name === report.calcSheet;
    let last = s.grid.length; while (last > 1 && s.grid[last - 1].every((v) => v === null || v === '')) last--;
    let lastCol = 0; s.grid.slice(0, last).forEach((r) => r.forEach((v, i) => { if (v !== null && v !== '') lastCol = Math.max(lastCol, i); }));
    const fmtv = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)) : v ?? '');
    const html = ['<table>', ...s.grid.slice(0, Math.min(last, 400)).map((r, i) => {
      const tag = i === 0 && !isCalc ? 'th' : 'td';
      const cls = newRows.has(i + 1) ? ' class="new"' : '';
      return `<tr>${r.slice(0, lastCol + 1).map((v) => `<${tag}${cls}>${esc(fmtv(v))}</${tag}>`).join('')}</tr>`;
    }), '</table>'].join('');
    $('sheetView').innerHTML = html;
  };
  for (const s of sheets) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = s.name; b.dataset.name = s.name; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => show(s)); tabs.appendChild(b);
  }
  show(sheets.find((s) => s.name === report.calcSheet) || sheets[0]);
}

function mailText() {
  const R = state.result, P = R.params;
  const lines = [
    `Contrôle coffrage nez de quai – levé ${R.meta.job} du ${R.meta.date}`,
    `Verdict : ${R.accepted ? 'COULÉE ACCEPTÉE' : 'COULÉE REFUSÉE'} (tolérance as-built ±${P.tolH} mm H / ±${P.tolV} mm V)`,
    '',
    ...R.tracks.flatMap((t) => [`Voie ${t.trackNo} (${t.range}) :`, ...t.rows.map((r) => `  ${r.id}  ${r.chTxt}  ΔH ${sgn(r.dHab)} mm  ΔV ${sgn(r.dVab)} mm  ${r.ok ? 'conforme' : 'HORS TOLÉRANCE'}`), '']),
    state.out ? `Fichier joint : ${state.outName}` : '',
  ];
  return lines.join('\n');
}
const subject = () => `Nez de quai – ${state.result.meta.job} – ${state.result.accepted ? 'ACCEPTÉ' : 'REFUSÉ'}`;

function download() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(state.out); a.download = state.outName;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function mailto() {
  const to = encodeURIComponent($('mailTo').value.trim());
  location.href = `mailto:${to}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(mailText())}`;
}
$('download').addEventListener('click', download);
$('mail').addEventListener('click', mailto);
$('share').addEventListener('click', async () => {
  const file = new File([state.out], state.outName, { type: state.out.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: subject(), text: mailText() }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  // repli : téléchargement + courriel prérempli (joindre le fichier manuellement)
  download();
  setTimeout(mailto, 600);
});

// hors ligne
const net = () => { $('offline').hidden = navigator.onLine; };
addEventListener('online', net); addEventListener('offline', net); net();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
