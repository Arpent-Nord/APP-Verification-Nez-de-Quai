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
const frt = parseFRT(fs.readFileSync(U + '/261009ADM2RC163_modif.txt', 'latin1'), '261009ADM2RC163_modif.txt');
const als = ['V1ADM.sie', 'V3ADM.sie'].map((f) => readSie(SQL, fs.readFileSync(U + '/' + f), f));
const res = computeLeve(frt, als);
for (const [name, src] of [['from_base', (process.env.BASE || U + '/base.xlsx')], ['from_template', (process.env.TPL || U + '/ADM_NouvLR_Connect-Cite_Deviation_Comparison.xlsx')]]) {
  const { bytes, report } = await appendLeve(JSZip, fs.readFileSync(src), res);
  fs.writeFileSync(`${OUT}/${name}.xlsx`, bytes);
  console.log(name, JSON.stringify(report.sheets.map(s => [s.name, s.blocks.map(b => b.start + ':' + b.n), s.ccStart])), report.converted, report.calcSheet);
}
// duplicate check
try { const { bytes } = await appendLeve(JSZip, fs.readFileSync(OUT + '/from_base.xlsx'), res); console.log('NO ERROR?!'); } catch (e) { console.log('dup ok:', e.message); }
