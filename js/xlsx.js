// Ajout d'un levé au classeur Excel cumulatif "ADM_NouvLR_Connect-Cite_Deviation_Comparison".
// Travaille directement sur le XML du fichier (JSZip) pour préserver les graphiques,
// les zones de texte (+/-) et la mise en forme d'origine.
import { fmtChainage } from './alignment.js';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const HEADER_A = 'Levé NouvLR (fichier / date)';
const LEGACY_LABEL = 'Levé antérieur\n(nom et date non disponibles)';
const DATA_SHEET_RE = /^(HORIZONTAL|VERTICAL)_TRACK\s*0*(\d+)$/i;

// ---------- utilitaires de références ----------
export const colToIdx = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const idxToCol = (i) => { let s = ''; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const splitRef = (ref) => { const m = ref.match(/^([A-Z]+)(\d+)$/); return { col: colToIdx(m[1]), row: Number(m[2]) }; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const serialize = (doc) => { let s = new XMLSerializer().serializeToString(doc); if (!s.startsWith('<?xml')) s = XML_DECL + s; return s; };
const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && (n.localName || n.nodeName) === name);
const first = (el, name) => el.getElementsByTagName(name)[0] || null;
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
const resolve = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return out.join('/');
};
const relsPath = (p) => dirOf(p) + '_rels/' + p.slice(p.lastIndexOf('/') + 1) + '.rels';

async function readRels(zip, partPath) {
  const f = zip.file(relsPath(partPath));
  if (!f) return [];
  const doc = parse(await f.async('string'));
  return Array.from(doc.getElementsByTagName('Relationship')).map((r) => ({
    id: r.getAttribute('Id'), type: r.getAttribute('Type'), target: resolve(partPath, r.getAttribute('Target')),
  }));
}

// ---------- styles ----------
class Styles {
  constructor(doc) {
    this.doc = doc; this.cache = new Map();
    const ss = doc.documentElement;
    const need = (name, before) => {
      let el = first(ss, name);
      if (!el) { el = doc.createElementNS(NS_MAIN, name); el.setAttribute('count', '0'); ss.insertBefore(el, before ? first(ss, before) : null); }
      return el;
    };
    this.numFmts = need('numFmts', 'fonts');
    this.fonts = need('fonts'); this.fills = need('fills'); this.borders = need('borders'); this.cellXfs = need('cellXfs');
    this.nextFmt = Math.max(163, ...Array.from(this.numFmts.getElementsByTagName('numFmt')).map((n) => Number(n.getAttribute('numFmtId')))) + 1;
  }
  _append(parent, xml) {
    const frag = parse(`<x xmlns="${NS_MAIN}">${xml}</x>`).documentElement.firstChild;
    const node = this.doc.importNode(frag, true);
    parent.appendChild(node);
    const n = kids(parent, node.localName || node.nodeName).length;
    parent.setAttribute('count', String(n));
    return n - 1;
  }
  xf(o = {}) {
    const key = JSON.stringify(o);
    if (this.cache.has(key)) return this.cache.get(key);
    let fontId = 0, fillId = 0, borderId = 0, numFmtId = 0;
    if (o.bold || o.italic || o.size || o.color) {
      fontId = this._append(this.fonts, `<font>${o.bold ? '<b/>' : ''}${o.italic ? '<i/>' : ''}<sz val="${o.size || 11}"/>${o.color ? `<color rgb="FF${o.color}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`);
    }
    if (o.fill) fillId = this._append(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fill}"/><bgColor indexed="64"/></patternFill></fill>`);
    if (o.border) {
      const s = (on) => (on ? '<color rgb="FF808080"/>' : '');
      const b = o.border; // chaîne parmi l r t b
      const side = (n, on) => (on ? `<${n} style="thin">${s(true)}</${n}>` : `<${n}/>`);
      borderId = this._append(this.borders, `<border>${side('left', b.includes('l'))}${side('right', b.includes('r'))}${side('top', b.includes('t'))}${side('bottom', b.includes('b'))}<diagonal/></border>`);
    }
    if (o.numFmt) {
      const builtin = { '0.00': 2, '0': 1, General: 0 };
      if (builtin[o.numFmt] !== undefined) numFmtId = builtin[o.numFmt];
      else { numFmtId = this.nextFmt++; this._append(this.numFmts, `<numFmt numFmtId="${numFmtId}" formatCode="${esc(o.numFmt)}"/>`); }
    }
    const align = o.wrap || o.h || o.v ? `<alignment${o.h ? ` horizontal="${o.h}"` : ''}${o.v ? ` vertical="${o.v}"` : ''}${o.wrap ? ' wrapText="1"' : ''}/>` : '';
    const idx = this._append(this.cellXfs, `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}${numFmtId ? ' applyNumberFormat="1"' : ''}${align ? ' applyAlignment="1"' : ''}>${align}</xf>`);
    this.cache.set(key, idx);
    return idx;
  }
}

// ---------- feuille ----------
class Sheet {
  constructor(doc, sst) {
    this.doc = doc; this.sst = sst;
    this.sheetData = first(doc, 'sheetData');
    this.rows = new Map();
    for (const r of kids(this.sheetData, 'row')) this.rows.set(Number(r.getAttribute('r')), r);
  }
  cellEl(ref) {
    const { row } = splitRef(ref);
    const r = this.rows.get(row);
    if (!r) return null;
    return kids(r, 'c').find((c) => c.getAttribute('r') === ref) || null;
  }
  value(ref) {
    const c = this.cellEl(ref);
    if (!c) return null;
    const t = c.getAttribute('t');
    if (t === 'inlineStr') return Array.from(c.getElementsByTagName('t')).map((x) => x.textContent).join('');
    const v = first(c, 'v');
    if (!v) return null;
    if (t === 's') return this.sst[Number(v.textContent)] ?? '';
    if (t === 'str' || t === 'e') return v.textContent;
    if (t === 'b') return v.textContent === '1';
    const n = Number(v.textContent);
    return Number.isFinite(n) ? n : v.textContent;
  }
  style(ref) { const c = this.cellEl(ref); return c ? c.getAttribute('s') : null; }
  row(n) {
    let r = this.rows.get(n);
    if (!r) { r = this.doc.createElementNS(NS_MAIN, 'row'); r.setAttribute('r', String(n)); this.rows.set(n, r); this.sheetData.appendChild(r); }
    return r;
  }
  clear(predicate) {
    for (const [rn, r] of this.rows) for (const c of kids(r, 'c')) { const { col } = splitRef(c.getAttribute('r')); if (predicate(rn, col)) r.removeChild(c); }
  }
  set(ref, value, style) {
    const { row } = splitRef(ref);
    const r = this.row(row);
    const old = kids(r, 'c').find((c) => c.getAttribute('r') === ref);
    if (old) r.removeChild(old);
    if (value === null || value === undefined) { if (style == null) return; }
    const c = this.doc.createElementNS(NS_MAIN, 'c');
    c.setAttribute('r', ref);
    if (style !== null && style !== undefined && style !== '') c.setAttribute('s', String(style));
    if (value !== null && value !== undefined) {
      if (typeof value === 'object' && value.f) {
        const f = this.doc.createElementNS(NS_MAIN, 'f'); f.textContent = value.f; c.appendChild(f);
        if (value.v !== undefined && value.v !== null) {
          if (typeof value.v === 'string') c.setAttribute('t', 'str');
          const v = this.doc.createElementNS(NS_MAIN, 'v'); v.textContent = String(value.v); c.appendChild(v);
        }
      } else if (typeof value === 'number') {
        const v = this.doc.createElementNS(NS_MAIN, 'v'); v.textContent = String(value); c.appendChild(v);
      } else {
        c.setAttribute('t', 'inlineStr');
        const is = this.doc.createElementNS(NS_MAIN, 'is'); const t = this.doc.createElementNS(NS_MAIN, 't');
        t.setAttribute('xml:space', 'preserve'); t.textContent = String(value); is.appendChild(t); c.appendChild(is);
      }
    }
    r.appendChild(c);
  }
  finalize() {
    // tri des lignes et des cellules, dimension
    const rowsSorted = [...this.rows.entries()].sort((a, b) => a[0] - b[0]);
    let maxCol = 1, maxRow = 1;
    for (const [rn, r] of rowsSorted) {
      r.removeAttribute('spans');
      const cells = kids(r, 'c').sort((a, b) => splitRef(a.getAttribute('r')).col - splitRef(b.getAttribute('r')).col);
      for (const c of cells) { r.removeChild(c); r.appendChild(c); maxCol = Math.max(maxCol, splitRef(c.getAttribute('r')).col); }
      if (cells.length || r.attributes.length > 1) maxRow = Math.max(maxRow, rn);
      this.sheetData.removeChild(r);
      this.sheetData.appendChild(r);
    }
    const dim = first(this.doc, 'dimension');
    if (dim) dim.setAttribute('ref', `A1:${idxToCol(maxCol)}${maxRow}`);
  }
  merges() {
    const mc = first(this.doc, 'mergeCells');
    return mc ? kids(mc, 'mergeCell').map((m) => m.getAttribute('ref')) : [];
  }
  setMerges(refs) {
    let mc = first(this.doc, 'mergeCells');
    if (!mc) {
      mc = this.doc.createElementNS(NS_MAIN, 'mergeCells');
      const ws = this.doc.documentElement;
      // mergeCells se place juste après sheetData (ou sheetProtection/... ignorés ici)
      const after = ['sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews']
        .map((n) => first(ws, n)).filter(Boolean).pop() || this.sheetData;
      ws.insertBefore(mc, after.nextSibling);
    }
    while (mc.firstChild) mc.removeChild(mc.firstChild);
    for (const ref of refs) { const m = this.doc.createElementNS(NS_MAIN, 'mergeCell'); m.setAttribute('ref', ref); mc.appendChild(m); }
    mc.setAttribute('count', String(refs.length));
    if (!refs.length) mc.parentNode.removeChild(mc);
  }
}

// décale toutes les colonnes d'une feuille de +1 (conversion du gabarit d'origine)
function shiftSheetColumns(sheet) {
  const shift = (ref) => ref.replace(/([A-Z]+)(\d+)/g, (_, c, r) => idxToCol(colToIdx(c) + 1) + r);
  for (const r of sheet.rows.values()) { r.removeAttribute('spans'); for (const c of kids(r, 'c')) c.setAttribute('r', shift(c.getAttribute('r'))); }
  sheet.setMerges(sheet.merges().map(shift));
  for (const cf of Array.from(sheet.doc.getElementsByTagName('conditionalFormatting'))) cf.setAttribute('sqref', shift(cf.getAttribute('sqref')));
  const cols = first(sheet.doc, 'cols');
  if (cols) {
    for (const c of kids(cols, 'col').reverse()) { c.setAttribute('min', String(Number(c.getAttribute('min')) + 1)); c.setAttribute('max', String(Number(c.getAttribute('max')) + 1)); }
  }
  for (const pane of Array.from(sheet.doc.getElementsByTagName('selection'))) {
    if (pane.getAttribute('sqref')) pane.setAttribute('sqref', shift(pane.getAttribute('sqref')));
    if (pane.getAttribute('activeCell')) pane.setAttribute('activeCell', shift(pane.getAttribute('activeCell')));
  }
}
function setColWidth(sheet, colIdx, width) {
  let cols = first(sheet.doc, 'cols');
  if (!cols) { cols = sheet.doc.createElementNS(NS_MAIN, 'cols'); sheet.doc.documentElement.insertBefore(cols, sheet.sheetData); }
  const existing = kids(cols, 'col').find((c) => Number(c.getAttribute('min')) <= colIdx && Number(c.getAttribute('max')) >= colIdx);
  if (existing && existing.getAttribute('min') === existing.getAttribute('max')) { existing.setAttribute('width', String(width)); existing.setAttribute('customWidth', '1'); return; }
  const c = sheet.doc.createElementNS(NS_MAIN, 'col');
  c.setAttribute('min', String(colIdx)); c.setAttribute('max', String(colIdx)); c.setAttribute('width', String(width)); c.setAttribute('customWidth', '1');
  const after = kids(cols, 'col').find((x) => Number(x.getAttribute('min')) > colIdx);
  cols.insertBefore(c, after || null);
}

// ---------- lecture des blocs existants ----------
function readBlocks(sheet) {
  const aMerges = sheet.merges().filter((m) => /^A\d+:A\d+$/.test(m)).map((m) => { const [a, b] = m.split(':'); return { r1: splitRef(a).row, r2: splitRef(b).row }; });
  const maxRow = Math.max(1, ...sheet.rows.keys());
  const covered = new Map();
  aMerges.forEach((m, i) => { for (let r = m.r1; r <= m.r2; r++) covered.set(r, i); });
  const blocks = aMerges.map((m) => ({ label: String(sheet.value(`A${m.r1}`) ?? ''), theo: [], ab: [] }));
  let loose = null;
  for (let r = 2; r <= maxRow; r++) {
    const b = sheet.value(`B${r}`), c = sheet.value(`C${r}`), d = sheet.value(`D${r}`), e = sheet.value(`E${r}`);
    const has = typeof b === 'number' || typeof d === 'number';
    let blk;
    if (covered.has(r)) { blk = blocks[covered.get(r)]; loose = null; }
    else if (has) {
      const lab = sheet.value(`A${r}`);
      if (!loose || (lab && String(lab) !== loose.label)) { loose = { label: lab ? String(lab) : '(sans étiquette)', theo: [], ab: [] }; blocks.push(loose); }
      blk = loose;
    } else continue;
    if (typeof b === 'number') blk.theo.push([b, typeof c === 'number' ? c : null]);
    if (typeof d === 'number') blk.ab.push([d, typeof e === 'number' ? e : null]);
  }
  const cc = [];
  for (let r = 2; r <= maxRow; r++) { const f = sheet.value(`F${r}`), g = sheet.value(`G${r}`); if (typeof f === 'number') cc.push([f, typeof g === 'number' ? g : null]); }
  return { blocks: blocks.filter((b) => b.theo.length || b.ab.length), cc };
}

const blockMin = (b) => Math.min(...b.theo.map((x) => x[0]), ...b.ab.map((x) => x[0]));
const blockMax = (b) => Math.max(...b.theo.map((x) => x[0]), ...b.ab.map((x) => x[0]));

// ---------- graphiques ----------
function updateChartXml(xml, sheetName, ends, zeroCol) {
  let out = xml.replace(/<c:f>([^<]*)<\/c:f>/g, (m, f) => {
    const mm = f.match(/^'?(.*?)'?!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/);
    if (!mm) return m;
    const col = mm[2];
    const end = ends[col];
    if (end === undefined) return m;
    return `<c:f>'${sheetName.replace(/'/g, "''")}'!$${col}$${mm[3]}:$${col}$${end}</c:f>`;
  });
  out = out.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, '');
  out = out.replace(/<c:dispBlanksAs val="gap"\/>/, '<c:dispBlanksAs val="span"/>');
  if (zeroCol && !out.includes(`$${zeroCol.x}$2:$${zeroCol.x}$3`)) {
    const n = (out.match(/<c:ser>/g) || []).length;
    const ser = `<c:ser><c:idx val="${n}"/><c:order val="${n}"/><c:tx><c:v>Zéro</c:v></c:tx><c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
      + `<c:xVal><c:numRef><c:f>'${sheetName}'!$${zeroCol.x}$2:$${zeroCol.x}$3</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>'${sheetName}'!$${zeroCol.y}$2:$${zeroCol.y}$3</c:f></c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
    const i = out.lastIndexOf('</c:ser>') + '</c:ser>'.length;
    out = out.slice(0, i) + ser + out.slice(i);
    out = out.replace(/(<c:legendPos val="[^"]*"\/>)/, `$1<c:legendEntry><c:idx val="${n}"/><c:delete val="1"/></c:legendEntry>`);
  }
  return out;
}

function shiftDrawingXml(xml) {
  return xml.replace(/<xdr:(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g, (a) => {
    if (/prst="line"/.test(a) && !/<c:chart\b/.test(a)) return ''; // ligne 0 dessinée à la main -> remplacée par une série
    return a.replace(/<xdr:col>(\d+)<\/xdr:col>/g, (_, c) => `<xdr:col>${Number(c) + 1}</xdr:col>`);
  });
}

// ---------- onglet de calculs ----------
function calcSheetXml(res, S) {
  const st = {
    title: S.xf({ bold: true, size: 14 }), bold: S.xf({ bold: true }), italic: S.xf({ italic: true }),
    hdr: S.xf({ bold: true, fill: 'DDEBF7', border: 'lrtb', wrap: true, h: 'center', v: 'center' }),
    txt: S.xf({ border: 'lrtb' }),
    in3: S.xf({ color: '0000FF', border: 'lrtb', numFmt: '0.000' }), in4: S.xf({ color: '0000FF', border: 'lrtb', numFmt: '0.0000' }),
    f4: S.xf({ border: 'lrtb', numFmt: '0.0000' }), f1: S.xf({ border: 'lrtb', numFmt: '0.0' }),
    ok: S.xf({ border: 'lrtb', bold: true, color: '006100', fill: 'C6EFCE', h: 'center' }),
    nok: S.xf({ border: 'lrtb', bold: true, color: '9C0006', fill: 'FFC7CE', h: 'center' }),
    const: S.xf({ color: '0000FF', numFmt: '0.0000' }), tol: S.xf({ color: '0000FF', numFmt: '0.0' }),
  };
  const cells = []; // [ref, value, style]
  const put = (ref, v, s) => cells.push([ref, v, s]);
  const P = res.params, m = res.meta, stn = res.station;
  put('A1', `Contrôle coffrage nez de quai – calculs NouvLR – levé ${m.job}`, st.title);
  const fmt = (x) => (x === null || x === undefined ? '' : (x >= 0 ? '+' : '') + x.toFixed(3));
  const info = [
    ['Nom du levé', m.job], ['Fichier FRT', m.fileName], ['Date du levé', m.date], ['Heure', m.heure],
    ['Instrument', `${m.instrument} – s/n ${m.serial}`], ["Facteur d'échelle", m.scale],
    ['Station', `${stn.name} (station libre sur ${stn.backsights.map((b) => b.name).join(', ')}) – résiduel ${stn.residual ? `${stn.residual.dN.toFixed(3)} / ${stn.residual.dE.toFixed(3)} / ${stn.residual.dZ.toFixed(3)}` : 'n/d'}`],
    ['Fermetures', res.closures.map((c) => `${c.ref} : dN ${fmt(c.dN)}, dE ${fmt(c.dE)}, dZ ${fmt(c.dZ)}`).join('  |  ') || 'aucune'],
    ...res.tracks.map((t) => [`Alignement voie ${t.trackNo}`, `${t.al.name} (${t.al.fileName})`]),
    ...res.tracks.map((t) => [`Chaînages contrôlés V${t.trackNo}`, t.range]),
    ['Verdict coulée', res.accepted ? `ACCEPTÉ – tous les écarts as-built ≤ ±${P.tolH} mm (H) et ±${P.tolV} mm (V)` : `REFUSÉ – écart(s) as-built hors tolérance ±${P.tolH} mm (H) / ±${P.tolV} mm (V)`],
    ['Généré le', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ];
  let r = 3;
  for (const [k, v] of info) { put(`A${r}`, k, st.bold); put(`B${r}`, v, k === 'Verdict coulée' ? (res.accepted ? st.ok : st.nok) : null); r++; }
  r++;
  const cRow = r; // constantes
  put(`A${r}`, 'Valeurs nominales et tolérances', st.bold); r++;
  const consts = [['Déport horizontal coffrage / axe théorique (m)', P.nomHTheo, st.const], ['Déport horizontal coffrage / point de jauge rail intérieur as-built (m)', P.nomHAsBuilt, st.const], ['Déport vertical coffrage / dessus de rail (m)', P.nomV, st.const], ['Tolérance ΔH as-built (± mm)', P.tolH, st.tol], ['Tolérance ΔV as-built (± mm)', P.tolV, st.tol]];
  const cref = {};
  consts.forEach(([k, v, s], i) => { put(`A${r}`, k, null); put(`C${r}`, v, s); cref[i] = `$C$${r}`; r++; });
  r++;
  put(`A${r}`, 'Points de coffrage (code ' + P.codeCoffrage + ')', st.bold); r++;
  const H = ['Voie', 'Point coffrage', 'Nord (m)', 'Est (m)', 'Z coffrage (m)', 'Chaînage (m)', 'Chaînage', 'Déport / axe théorique (m)', 'Z théorique dessus rail (m)',
    'Rail TQC avant', 'Rail TQC après', 'Déport rail TQC interpolé (m)', 'Z rail TQC interpolé (m)', 'ΔH vs théorique (mm)', 'ΔV vs théorique (mm)',
    'ΔH vs as-built (mm) – retenu', 'ΔV vs as-built (mm) – retenu', 'Éc FRT / ligne rail (m)', 'd.Z FRT / ligne rail (m)', 'ΔH as-built coord. arrondies (mm)', 'ΔV as-built coord. arrondies (mm)', 'Source as-built', 'Verdict'];
  H.forEach((h, i) => put(`${idxToCol(i + 1)}${r}`, h, st.hdr));
  const hdrRow = r; r++;
  const coffStart = r;
  const railRowOf = {};
  const nCoff = res.tracks.reduce((s, t) => s + t.rows.length, 0);
  const railStart = coffStart + nCoff + 4;
  let rr = railStart;
  for (const t of res.tracks) for (const p of t.rails) railRowOf[p.id] = rr++;
  for (const t of res.tracks) {
    for (const x of t.rows) {
      const a = railRowOf[x.railA], b = railRowOf[x.railB];
      put(`A${r}`, `Voie ${t.trackNo}`, st.txt); put(`B${r}`, x.id, st.txt);
      put(`C${r}`, x.N, st.in3); put(`D${r}`, x.E, st.in3); put(`E${r}`, x.Z, st.in3);
      put(`F${r}`, x.ch, st.in3); put(`G${r}`, x.chTxt, st.txt);
      put(`H${r}`, x.off, st.in4); put(`I${r}`, x.zTh, st.in4);
      if (a && b) {
        put(`J${r}`, { f: `B${a}`, v: x.railA }, st.txt); put(`K${r}`, { f: `B${b}`, v: x.railB }, st.txt);
        put(`L${r}`, { f: `H${a}+(F${r}-F${a})/(F${b}-F${a})*(H${b}-H${a})`, v: x.offRail }, st.f4);
        put(`M${r}`, { f: `E${a}+(F${r}-F${a})/(F${b}-F${a})*(E${b}-E${a})`, v: x.zRail }, st.f4);
        put(`T${r}`, { f: `ROUND((ABS(H${r}-L${r})-${cref[1]})*1000,1)`, v: x.dHabCoord }, st.f1);
        put(`U${r}`, { f: `ROUND((E${r}-M${r}-${cref[2]})*1000,1)`, v: x.dVabCoord }, st.f1);
      }
      put(`N${r}`, { f: `ROUND((ABS(H${r})-${cref[0]})*1000,1)`, v: x.dHth }, st.f1);
      put(`O${r}`, { f: `ROUND((E${r}-I${r}-${cref[2]})*1000,1)`, v: x.dVth }, st.f1);
      if (x.abSource === 'FRT') {
        put(`R${r}`, x.ecFrt, st.in3); put(`S${r}`, x.dzFrt, st.in3);
        put(`P${r}`, { f: `ROUND((ABS(R${r})-${cref[1]})*1000,1)`, v: x.dHab }, st.f1);
        put(`Q${r}`, { f: `ROUND((S${r}-${cref[2]})*1000,1)`, v: x.dVab }, st.f1);
      } else {
        put(`P${r}`, { f: `T${r}`, v: x.dHab }, st.f1); put(`Q${r}`, { f: `U${r}`, v: x.dVab }, st.f1);
      }
      put(`V${r}`, x.abSource, st.txt);
      put(`W${r}`, { f: `IF(AND(ABS(P${r})<=${cref[3]},ABS(Q${r})<=${cref[4]}),"CONFORME","HORS TOLÉRANCE")`, v: x.ok ? 'CONFORME' : 'HORS TOLÉRANCE' }, x.ok ? st.ok : st.nok);
      r++;
    }
  }
  r = railStart - 2;
  put(`A${r}`, `Points rail intérieur TQC (code ${P.codeRail} – track shoe, point de jauge) vs alignement théorique`, st.bold); r++;
  ['Voie', 'Point rail', 'Nord (m)', 'Est (m)', 'Z rail (m)', 'Chaînage (m)', 'Chaînage', 'Déport / axe théorique (m)', 'Z théorique dessus rail (m)', 'Écart déport vs ½ écartement 0.7175 (mm)', 'Écart Z vs théorique (mm)']
    .forEach((h, i) => put(`${idxToCol(i + 1)}${r}`, h, st.hdr));
  const railHdr = r; r++;
  for (const t of res.tracks) for (const p of t.rails) {
    put(`A${r}`, `Voie ${t.trackNo}`, st.txt); put(`B${r}`, p.id, st.txt);
    put(`C${r}`, p.N, st.in3); put(`D${r}`, p.E, st.in3); put(`E${r}`, p.Z, st.in3);
    put(`F${r}`, p.ch, st.in3); put(`G${r}`, fmtChainage(p.ch, t.trackNo), st.txt);
    put(`H${r}`, p.off, st.in4); put(`I${r}`, p.zTh, st.in4);
    put(`J${r}`, { f: `ROUND((ABS(H${r})-0.7175)*1000,1)`, v: p.dGauge }, st.f1);
    put(`K${r}`, { f: `ROUND((E${r}-I${r})*1000,1)`, v: p.dZth }, st.f1);
    r++;
  }
  r++;
  const notes = [
    'Méthode / conventions :',
    '• Chaînage et déport calculés par projection perpendiculaire sur l\'alignement en plan de la voie la plus proche (fichiers GEDO .sie). Déport + = à droite du sens des chaînages croissants.',
    '• Z théorique = profil en long de l\'alignement (dessus de rail).',
    '• As-built retenu (P-Q) : Éc et d.Z calculés par l\'instrument vs la ligne du rail intérieur TQC (rapport FRT, pleine précision). À défaut : comparaison par coordonnées (T-U).',
    '• Colonnes T-U (contrôle) : comparaison refaite à partir des coordonnées publiées arrondies au mm (rail interpolé entre les points TQC) – écart possible ±1 mm dû à l\'arrondi.',
    '• ΔH (mm) = (distance horizontale mesurée − nominale) × 1000 → + = coffrage plus éloigné de la voie que prévu, − = trop près.',
    '• ΔV (mm) = (Z coffrage − Z référence − 0.980) × 1000 → + = coffrage trop haut, − = trop bas.',
    '• Cellules en bleu = valeurs mesurées / calculées hors Excel (levé FRT + alignements) ; les autres sont des formules.',
    ...res.warnings.map((w) => '• Avertissement : ' + w),
  ];
  notes.forEach((n, i) => put(`A${r + i}`, n, i === 0 ? st.bold : st.italic));

  // XML
  const byRow = new Map();
  for (const [ref, v, s] of cells) { const { row } = splitRef(ref); if (!byRow.has(row)) byRow.set(row, []); byRow.get(row).push([ref, v, s]); }
  const cellXml = ([ref, v, s]) => {
    const sa = s !== null && s !== undefined ? ` s="${s}"` : '';
    if (v === null || v === undefined || v === '') return `<c r="${ref}"${sa}/>`;
    if (typeof v === 'number') return `<c r="${ref}"${sa}><v>${v}</v></c>`;
    if (typeof v === 'object') {
      const vv = v.v === null || v.v === undefined ? '' : typeof v.v === 'string' ? `<v>${esc(v.v)}</v>` : `<v>${v.v}</v>`;
      return `<c r="${ref}"${sa}${typeof v.v === 'string' ? ' t="str"' : ''}><f>${esc(v.f)}</f>${vv}</c>`;
    }
    return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const rowsXml = [...byRow.keys()].sort((a, b) => a - b).map((rn) => {
    const cs = byRow.get(rn).sort((a, b) => splitRef(a[0]).col - splitRef(b[0]).col);
    const ht = rn === hdrRow || rn === railHdr ? ' ht="48" customHeight="1"' : '';
    return `<row r="${rn}"${ht}>${cs.map(cellXml).join('')}</row>`;
  }).join('');
  const widths = [24, 17, 13, 12, 11, 14, 12, 13, 13, 12, 12, 13, 13, 11, 11, 13, 13, 12, 12, 13, 13, 12, 16];
  const colsXml = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const maxRow = Math.max(...byRow.keys());
  return XML_DECL + `<worksheet xmlns="${NS_MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:W${maxRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${colsXml}</cols><sheetData>${rowsXml}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

// ---------- point d'entrée ----------
export async function appendLeve(JSZip, data, res) {
  const zip = await JSZip.loadAsync(data);
  const wbPath = 'xl/workbook.xml';
  const wbXml = await zip.file(wbPath).async('string');
  const wbRels = await readRels(zip, wbPath);
  const wbDoc = parse(wbXml);
  const sheetsInfo = Array.from(wbDoc.getElementsByTagName('sheet')).map((s) => ({
    name: s.getAttribute('name'), sheetId: Number(s.getAttribute('sheetId')),
    rid: s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'),
  }));
  for (const s of sheetsInfo) s.path = (wbRels.find((r) => r.id === s.rid) || {}).target;

  const sst = [];
  const sstFile = zip.file('xl/sharedStrings.xml');
  if (sstFile) {
    const d = parse(await sstFile.async('string'));
    for (const si of Array.from(d.getElementsByTagName('si'))) sst.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join(''));
  }
  const stylesDoc = parse(await zip.file('xl/styles.xml').async('string'));
  const S = new Styles(stylesDoc);

  const job = res.meta.job;
  const report = { sheets: [], converted: false };
  const dataSheets = sheetsInfo.filter((s) => DATA_SHEET_RE.test(s.name));
  if (!dataSheets.length) throw new Error('Aucun onglet HORIZONTAL_TRACK / VERTICAL_TRACK trouvé dans le classeur.');

  const aStyle = {
    top: S.xf({ bold: true, wrap: true, h: 'center', v: 'center', border: 'lrt' }),
    mid: S.xf({ bold: true, wrap: true, h: 'center', v: 'center', border: 'lr' }),
    bot: S.xf({ bold: true, wrap: true, h: 'center', v: 'center', border: 'lrb' }),
    one: S.xf({ bold: true, wrap: true, h: 'center', v: 'center', border: 'lrtb' }),
  };
  const zeroHdr = S.xf({ italic: true, size: 9, color: '808080' });

  for (const si of dataSheets) {
    const [, kindRaw, tno] = si.name.match(DATA_SHEET_RE);
    const kind = kindRaw.toUpperCase().startsWith('H') ? 'H' : 'V';
    const trackNo = Number(tno);
    const sheetXml = await zip.file(si.path).async('string');
    const doc = parse(sheetXml);
    const sheet = new Sheet(doc, sst);
    const sheetRels = await readRels(zip, si.path);
    const drawingRel = sheetRels.find((r) => r.type.endsWith('/drawing'));
    let chartPaths = [];
    if (drawingRel) chartPaths = (await readRels(zip, drawingRel.target)).filter((r) => r.type.endsWith('/chart')).map((r) => r.target);

    // conversion du gabarit d'origine (sans colonne A "Levé")
    const a1 = String(sheet.value('A1') ?? '');
    let legacy = false;
    if (!a1.startsWith('Levé')) {
      legacy = true; report.converted = true;
      const hdrStyle = sheet.style('A1');
      shiftSheetColumns(sheet);
      sheet.set('A1', HEADER_A, hdrStyle);
      setColWidth(sheet, 1, 26);
      // les données existantes deviennent un bloc "levé antérieur"
      let last = 1;
      for (let r = 2; r <= Math.max(...sheet.rows.keys()); r++) if (typeof sheet.value(`B${r}`) === 'number' || typeof sheet.value(`D${r}`) === 'number') last = r;
      if (last >= 2) { sheet.set('A2', LEGACY_LABEL, aStyle.top); sheet.setMerges([...sheet.merges(), `A2:A${last}`]); }
      if (drawingRel) zip.file(drawingRel.target, shiftDrawingXml(await zip.file(drawingRel.target).async('string')));
    }

    const { blocks, cc } = readBlocks(sheet);
    if (blocks.some((b) => b.label.split('\n')[0].trim() === job)) throw new Error(`Le levé ${job} est déjà présent dans l'onglet ${si.name}.`);
    const tr = res.tracks.find((t) => t.trackNo === trackNo);
    if (tr) {
      blocks.push({
        label: `${job}\n${res.meta.date}\nch. ${tr.range}`,
        theo: tr.rows.map((x) => [Math.round(x.ch * 100) / 100, kind === 'H' ? x.dHth : x.dVth]),
        ab: tr.rows.map((x) => [Math.round(x.ch * 100) / 100, kind === 'H' ? x.dHab : x.dVab]),
        isNew: true,
      });
    }
    blocks.sort((a, b) => blockMin(a) - blockMin(b));

    // styles des cellules de données (repris de l'existant)
    const dataStyle = {};
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G']) {
      let s = null;
      for (let r = 2; r <= 40 && s === null; r++) if (sheet.cellEl(`${col}${r}`)) s = sheet.style(`${col}${r}`);
      dataStyle[col] = s;
    }
    // effacer A:G (lignes >= 2) et les fusions de la colonne A
    sheet.clear((rn, col) => rn >= 2 && col <= 7);
    sheet.setMerges(sheet.merges().filter((m) => !/^A\d+:A\d+$/.test(m)));

    let row = 2; const merges = [];
    let theoEnd = 1, abEnd = 1;
    for (const b of blocks) {
      b.start = row;
      const h = Math.max(b.theo.length, b.ab.length, 1);
      b.theo.forEach(([ch, d], i) => { sheet.set(`B${row + i}`, ch, dataStyle.B); if (d !== null) sheet.set(`C${row + i}`, d, dataStyle.C); theoEnd = Math.max(theoEnd, row + i); });
      b.ab.forEach(([ch, d], i) => { sheet.set(`D${row + i}`, ch, dataStyle.D); if (d !== null) sheet.set(`E${row + i}`, d, dataStyle.E); abEnd = Math.max(abEnd, row + i); });
      if (h === 1) sheet.set(`A${row}`, b.label, aStyle.one);
      else {
        sheet.set(`A${row}`, b.label, aStyle.top);
        for (let i = 1; i < h - 1; i++) sheet.set(`A${row + i}`, null, aStyle.mid);
        sheet.set(`A${row + h - 1}`, null, aStyle.bot);
        merges.push(`A${row}:A${row + h - 1}`);
      }
      row += h;
    }
    sheet.setMerges([...sheet.merges(), ...merges]);
    // Connect-Cité : alignée sur le premier bloc qui atteint son chaînage de départ
    let ccEnd = 1;
    if (cc.length) {
      const ccMin = cc[0][0];
      const tgt = blocks.find((b) => blockMax(b) >= ccMin - 1.0);
      let r0 = tgt ? tgt.start : row;
      cc.forEach(([ch, d], i) => { sheet.set(`F${r0 + i}`, ch, dataStyle.F); if (d !== null) sheet.set(`G${r0 + i}`, d, dataStyle.G); });
      ccEnd = r0 + cc.length - 1;
    }
    // ligne 0 du graphique (AA/AB)
    const allCh = [...blocks.flatMap((b) => [...b.theo, ...b.ab].map((x) => x[0])), ...cc.map((x) => x[0])];
    sheet.set('AA1', 'Ligne 0 (graphique) – chaînage', zeroHdr); sheet.set('AB1', 'Delta (mm)', zeroHdr);
    sheet.set('AA2', Math.round((Math.min(...allCh) - 2) * 100) / 100); sheet.set('AA3', Math.round((Math.max(...allCh) + 2) * 100) / 100);
    sheet.set('AB2', 0); sheet.set('AB3', 0);
    setColWidth(sheet, 27, 26);
    sheet.finalize();
    zip.file(si.path, serialize(doc));

    const ends = { B: theoEnd, C: theoEnd, D: abEnd, E: abEnd, F: ccEnd, G: ccEnd };
    if (legacy) { // références d'origine A..F -> B..G
      for (const cp of chartPaths) {
        let x = await zip.file(cp).async('string');
        x = x.replace(/<c:f>([^<]*)<\/c:f>/g, (m, f) => `<c:f>${f.replace(/\$([A-Z]+)\$/g, (_, c) => `$${idxToCol(colToIdx(c) + 1)}$`)}</c:f>`);
        zip.file(cp, x);
      }
    }
    for (const cp of chartPaths) {
      const x = await zip.file(cp).async('string');
      zip.file(cp, updateChartXml(x, si.name, ends, { x: 'AA', y: 'AB' }));
    }
    report.sheets.push({ name: si.name, trackNo, kind, added: tr ? tr.rows.length : 0, blocks: blocks.map((b) => ({ label: b.label, start: b.start, n: Math.max(b.theo.length, b.ab.length), isNew: !!b.isNew })), ccStart: cc.length ? ccEnd - cc.length + 1 : null });
  }

  // nouvel onglet de calculs
  let calcName = `Calculs ${job}`.replace(/[[\]:*?/\\]/g, '_').slice(0, 31);
  if (sheetsInfo.some((s) => s.name.toLowerCase() === calcName.toLowerCase())) throw new Error(`L'onglet « ${calcName} » existe déjà dans le classeur.`);
  const nums = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/).map((f) => Number(f.name.match(/(\d+)\.xml$/)[1]));
  const newPath = `xl/worksheets/sheet${Math.max(0, ...nums) + 1}.xml`;
  zip.file(newPath, calcSheetXml(res, S));
  zip.file('xl/styles.xml', serialize(stylesDoc));

  // workbook.xml, rels, content types
  const relsFile = relsPath(wbPath);
  let relsXml = await zip.file(relsFile).async('string');
  const rIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const newRid = `rId${Math.max(0, ...rIds) + 1}`;
  relsXml = relsXml.replace('</Relationships>', `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/${newPath}"/></Relationships>`);
  zip.file(relsFile, relsXml);
  const newSheetId = Math.max(...sheetsInfo.map((s) => s.sheetId)) + 1;
  let wbOut = wbXml;
  wbOut = wbOut.replace(/<\/sheets>/, `<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="${esc(calcName)}" sheetId="${newSheetId}" r:id="${newRid}"/></sheets>`);
  if (/<calcPr\b[^>]*\/>/.test(wbOut)) wbOut = wbOut.replace(/<calcPr\b([^>]*)\/>/, (m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
  else if (/<calcPr\b/.test(wbOut)) wbOut = wbOut.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
  else wbOut = wbOut.replace(/(<\/definedNames>|<\/sheets>)(?![\s\S]*<\/definedNames>)/, `$1<calcPr fullCalcOnLoad="1"/>`);
  zip.file(wbPath, wbOut);
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace('</Types>', `<Override PartName="/${newPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file('[Content_Types].xml', ct);
  zip.remove('xl/calcChain.xml');

  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  report.calcSheet = calcName;
  return { bytes: out, report };
}

// Lecture simple (pour la visualisation) : valeurs des onglets de données
export async function readDataSheets(JSZip, data) {
  const zip = await JSZip.loadAsync(data);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const wbRels = await readRels(zip, 'xl/workbook.xml');
  const doc = parse(wbXml);
  const sst = [];
  const sstFile = zip.file('xl/sharedStrings.xml');
  if (sstFile) { const d = parse(await sstFile.async('string')); for (const si of Array.from(d.getElementsByTagName('si'))) sst.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join('')); }
  const out = [];
  for (const s of Array.from(doc.getElementsByTagName('sheet'))) {
    const name = s.getAttribute('name');
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = (wbRels.find((r) => r.id === rid) || {}).target;
    const sheet = new Sheet(parse(await zip.file(path).async('string')), sst);
    const maxRow = Math.max(1, ...sheet.rows.keys());
    const merges = sheet.merges();
    const grid = [];
    for (let r = 1; r <= Math.min(maxRow, 2000); r++) {
      const row = [];
      for (let c = 1; c <= 23; c++) row.push(sheet.value(`${idxToCol(c)}${r}`));
      grid.push(row);
    }
    out.push({ name, grid, merges, isData: DATA_SHEET_RE.test(name) });
  }
  return out;
}
