import fs from 'node:fs';
import { mkdirSync } from 'node:fs'; mkdirSync(new URL('./out', import.meta.url).pathname, { recursive: true });
import { createRequire } from 'node:module';
import { parseFRT } from '../js/frt.js';
import { readSie } from '../js/alignment.js';
import { computeLeve } from '../js/compute.js';
const require = createRequire(import.meta.url);
const initSqlJs = require((process.env.NM || new URL('../node_modules', import.meta.url).pathname) + '/sql.js/dist/sql-wasm.js');
const U = process.env.DATA || new URL('./data', import.meta.url).pathname;
const SQL = await initSqlJs({ locateFile: (f) => new URL('../vendor/' + f, import.meta.url).pathname });
const frt = parseFRT(fs.readFileSync(U + '/261009ADM2RC163_modif.txt', 'latin1'), '261009ADM2RC163_modif.txt');
console.log(frt.meta, frt.station, frt.closures, Object.keys(frt.report).length, frt.points.length);
const als = ['V1ADM.sie', 'V3ADM.sie'].map((f) => readSie(SQL, fs.readFileSync(U + '/' + f), f));
const t0 = Date.now();
const res = computeLeve(frt, als);
console.log('ms', Date.now() - t0, 'accepted', res.accepted, res.warnings);
for (const t of res.tracks) {
  console.log(t.label, t.range);
  for (const r of t.rows) console.log(r.id, r.ch.toFixed(4), r.dHth, r.dVth, r.dHab, r.dVab, r.dHabCoord, r.dVabCoord, r.railA, r.railB, r.ok);
  for (const r of t.rails) console.log('  rail', r.id, r.ch.toFixed(3), r.dGauge, r.dZth);
}
fs.writeFileSync(new URL('./out/engine.json', import.meta.url).pathname, JSON.stringify(res.tracks.map(t=>t.rows), null, 1));
