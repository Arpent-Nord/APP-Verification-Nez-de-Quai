import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NM = process.env.NM || new URL('../node_modules', import.meta.url).pathname;
const { DOMParser, XMLSerializer } = require(NM + '/@xmldom/xmldom');
globalThis.DOMParser = DOMParser; globalThis.XMLSerializer = XMLSerializer;
const JSZip = require(NM + '/jszip');
const initSqlJs = require(NM + '/sql.js/dist/sql-wasm.js');
const { parseFRT } = await import('../js/frt.js');
const { readSie } = await import('../js/alignment.js');
const { computeLeve } = await import('../js/compute.js');
const { appendLeve } = await import('../js/xlsx.js');
const U = process.env.DATA || new URL('./data', import.meta.url).pathname, OUT = process.env.OUT || new URL('./out', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const SQL = await initSqlJs({ locateFile: (f) => new URL('../vendor/' + f, import.meta.url).pathname });
// levé synthétique : tous les points déplacés de 70 m dans le sens des chaînages, ΔZ coffrage +4 mm
let txt = fs.readFileSync(U + '/261009ADM2RC163_modif.txt', 'latin1').replace(/261009ADM2RC163/g, '261020ADM2RC999').replace('2026/10/09', '2026/10/20');
const az = 197.568297 * Math.PI / 200, d = 70;
txt = txt.replace(/^(6282630\d\d\s*,)([\d.]+),\s*([\d.]+),\s*([-\d.]+),(\s*(\d+)_)/gm, (m, a, n, e, z, rest, code) =>
  `${a}${(+n + d * Math.cos(az)).toFixed(3)}, ${(+e + d * Math.sin(az)).toFixed(3)}, ${(+z + (code === '147' ? 0.004 : 0)).toFixed(3)},${rest}`);
txt = txt.replace(/d\.Z:\s*([\d.]+)/g, (m, v) => `d.Z:  ${(+v + 0.004).toFixed(3)}`);
const frt = parseFRT(txt, '261020ADM2RC999.txt');
const als = ['V1ADM.sie', 'V3ADM.sie'].map((f) => readSie(SQL, fs.readFileSync(U + '/' + f), f));
const res = computeLeve(frt, als);
console.log('accepted', res.accepted, res.tracks.map(t => t.range + ' ' + t.rows.map(r => r.dVab).join(',')));
const { bytes, report } = await appendLeve(JSZip, fs.readFileSync(process.env.SECOND_BASE || OUT + '/from_base.xlsx'), res);
fs.writeFileSync(OUT + '/second.xlsx', bytes);
console.log(JSON.stringify(report.sheets.map(s => [s.name, s.blocks.map(b => b.label.split('\n')[0] + '@' + b.start + 'x' + b.n), s.ccStart])), report.calcSheet);
