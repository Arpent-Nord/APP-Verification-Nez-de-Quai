// Petit graphique SVG (écarts en mm vs chaînage) avec bande de tolérance et info-bulle.
import { fmtChainage } from './alignment.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const niceStep = (span, target = 6) => {
  const raw = span / target; const p = 10 ** Math.floor(Math.log10(raw)); const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
};

let tip;
function showTip(evt, html) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); }
  tip.innerHTML = html; tip.hidden = false;
  const x = evt.clientX ?? evt.touches?.[0]?.clientX ?? 0, y = evt.clientY ?? evt.touches?.[0]?.clientY ?? 0;
  tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, x + 12) + 'px';
  tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + 'px';
}
const hideTip = () => { if (tip) tip.hidden = true; };

/**
 * series: [{ name, color, points: [{x, y, label}], marker: 'square'|'circle'|'dot', line: bool, faded: bool }]
 */
export function renderChart(fig, { title, series, tol, trackNo }) {
  fig.innerHTML = '';
  const cap = document.createElement('figcaption'); cap.textContent = title; fig.appendChild(cap);
  const W = Math.max(300, Math.round(fig.clientWidth || 640)), H = W < 480 ? 230 : 290, m = { l: 40, r: 12, t: 12, b: 34 };
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return;
  let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  if (x1 - x0 < 5) { x0 -= 2.5; x1 += 2.5; }
  const pad = (x1 - x0) * 0.04; x0 -= pad; x1 += pad;
  const ys = pts.map((p) => p.y).filter((v) => v !== null);
  let y0 = Math.min(-tol - 1, ...ys), y1 = Math.max(tol + 1, ...ys);
  const ystep = niceStep(y1 - y0, 6); y0 = Math.floor(y0 / ystep) * ystep; y1 = Math.ceil(y1 / ystep) * ystep;
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = (v) => m.t + (y1 - v) / (y1 - y0) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
  // bande de tolérance
  el('rect', { x: m.l, y: Y(tol), width: W - m.l - m.r, height: Y(-tol) - Y(tol), fill: 'var(--band)' }, svg);
  // grille horizontale + étiquettes
  for (let v = y0; v <= y1 + 1e-9; v += ystep) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: 'var(--line)', 'stroke-width': v === 0 ? 1.5 : 1 }, svg);
    const t = el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, svg); t.textContent = Math.round(v * 10) / 10;
  }
  for (const v of [tol, -tol]) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: 'var(--ok)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, svg);
  }
  const tl = el('text', { x: W - m.r - 4, y: Y(tol) - 4, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--ok)' }, svg); tl.textContent = `±${tol} mm`;
  // axe x (chaînages)
  const xstep = niceStep(x1 - x0, W < 480 ? 3 : 5);
  for (let v = Math.ceil(x0 / xstep) * xstep; v <= x1; v += xstep) {
    el('line', { x1: X(v), x2: X(v), y1: H - m.b, y2: H - m.b + 4, stroke: 'var(--muted)' }, svg);
    const t = el('text', { x: X(v), y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, svg);
    t.textContent = fmtChainage(v, trackNo).replace(/\.\d+$/, '');
  }
  const yl = el('text', { x: 12, y: m.t + (H - m.t - m.b) / 2, 'font-size': 11, fill: 'var(--muted)', transform: `rotate(-90 12 ${m.t + (H - m.t - m.b) / 2})`, 'text-anchor': 'middle' }, svg); yl.textContent = 'Écart (mm)';
  // séries
  for (const s of series) {
    const g = el('g', { opacity: s.faded ? 0.45 : 1 }, svg);
    const ptsOk = s.points.filter((p) => p.y !== null);
    if (s.line && ptsOk.length > 1) {
      el('polyline', { points: ptsOk.map((p) => `${X(p.x)},${Y(p.y)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': s.faded ? 1 : 2, 'stroke-linejoin': 'round' }, g);
    }
    for (const p of ptsOk) {
      const cx = X(p.x), cy = Y(p.y);
      let mk;
      if (s.marker === 'square') mk = el('rect', { x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, rx: 1.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, g);
      else if (s.marker === 'circle') mk = el('circle', { cx, cy, r: 4.5, fill: 'var(--surface)', stroke: s.color, 'stroke-width': 2 }, g);
      else mk = el('circle', { cx, cy, r: s.faded ? 2 : 3, fill: s.color }, g);
      const hit = el('circle', { cx, cy, r: 12, fill: 'transparent' }, g);
      const html = `<b>${s.name}</b><br>${p.label ? p.label + ' · ' : ''}${fmtChainage(p.x, trackNo)}<br>${p.y > 0 ? '+' : ''}${p.y} mm`;
      for (const t of [mk, hit]) {
        t.addEventListener('pointerenter', (e) => showTip(e, html));
        t.addEventListener('pointermove', (e) => showTip(e, html));
        t.addEventListener('pointerleave', hideTip);
        t.addEventListener('click', (e) => showTip(e, html));
      }
    }
  }
  fig.appendChild(svg);
  const lg = document.createElement('div'); lg.className = 'legend';
  for (const s of series) {
    const span = document.createElement('span');
    const sw = s.marker === 'circle' ? `border:2px solid ${s.color};background:transparent` : `background:${s.color}`;
    span.innerHTML = `<i style="${sw};${s.faded ? 'opacity:.45' : ''}"></i>${s.name}`;
    lg.appendChild(span);
  }
  const band = document.createElement('span'); band.innerHTML = `<i style="background:var(--band);border:1px dashed var(--ok)"></i>Tolérance ±${tol} mm`; lg.appendChild(band);
  fig.appendChild(lg);
}
document.addEventListener('scroll', hideTip, { passive: true });
