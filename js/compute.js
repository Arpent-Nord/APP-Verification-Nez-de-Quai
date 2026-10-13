// Calcul des écarts coffrage nez de quai vs alignement théorique et vs TQC du rail intérieur.
import { station, profile, fmtChainage } from './alignment.js';

export const DEFAULTS = {
  nomHTheo: 1.585,     // coffrage / axe théorique (m)
  nomHAsBuilt: 0.8675, // coffrage / point de jauge rail intérieur (m) = 1.585 - 1.435/2
  nomV: 0.980,         // coffrage / dessus de rail (m)
  tolH: 5,             // tolérance acceptation ΔH (mm)
  tolV: 5,             // tolérance acceptation ΔV (mm)
  codeRail: '178',
  codeCoffrage: '147',
};

const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10 + 0);

export function computeLeve(frt, alignments, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  const warnings = [];
  const pts = frt.points.filter((p) => p.code === P.codeRail || p.code === P.codeCoffrage);
  const missing = pts.filter((p) => !p.measured).map((p) => p.id);
  if (missing.length) warnings.push(`Points non mesurés (ignorés) : ${missing.join(', ')}`);

  // affectation de chaque point mesuré à la voie la plus proche
  const assigned = [];
  for (const p of pts.filter((q) => q.measured)) {
    let best = null;
    for (const al of alignments) {
      const st = station(al, p.E, p.N);
      if (!st.inside) continue;
      if (!best || Math.abs(st.off) < Math.abs(best.off)) best = { ...st, al };
    }
    if (!best || Math.abs(best.off) > 10) {
      warnings.push(`${p.id} : hors des alignements fournis (ignoré).`);
      continue;
    }
    assigned.push({ ...p, ch: best.ch, off: best.off, al: best.al, zTh: profile(best.al, best.ch) });
  }

  const tracks = [];
  for (const al of alignments) {
    const mine = assigned.filter((p) => p.al === al);
    const coff = mine.filter((p) => p.code === P.codeCoffrage).sort((a, b) => a.ch - b.ch);
    if (!coff.length) continue;
    const side = Math.sign(coff.reduce((s, p) => s + p.off, 0));
    const rails = mine.filter((p) => p.code === P.codeRail && Math.sign(p.off) === side).sort((a, b) => a.ch - b.ch);
    const railRows = rails.map((p) => ({
      ...p,
      dGauge: r1((Math.abs(p.off) - 1.435 / 2) * 1000),
      dZth: p.zTh === null ? null : r1((p.Z - p.zTh) * 1000),
    }));
    const rows = coff.map((c) => {
      const row = {
        id: c.id, N: c.N, E: c.E, Z: c.Z, ch: c.ch, chTxt: fmtChainage(c.ch, al.trackNo), off: c.off, zTh: c.zTh,
      };
      row.dHth = r1((Math.abs(c.off) - P.nomHTheo) * 1000);
      row.dVth = c.zTh === null ? null : r1((c.Z - c.zTh - P.nomV) * 1000);
      // rail TQC interpolé au chaînage du coffrage (contrôle à partir des coordonnées)
      if (rails.length >= 2) {
        let j = 0;
        while (j < rails.length - 2 && c.ch > rails[j + 1].ch) j++;
        const a = rails[j], b = rails[j + 1];
        const f = (c.ch - a.ch) / (b.ch - a.ch);
        row.railA = a.id; row.railB = b.id;
        row.extrap = c.ch < rails[0].ch ? rails[0].ch - c.ch : c.ch > rails[rails.length - 1].ch ? c.ch - rails[rails.length - 1].ch : 0;
        row.offRail = a.off + f * (b.off - a.off);
        row.zRail = a.Z + f * (b.Z - a.Z);
        row.dHabCoord = r1((Math.abs(c.off - row.offRail) - P.nomHAsBuilt) * 1000);
        row.dVabCoord = r1((c.Z - row.zRail - P.nomV) * 1000);
      } else {
        warnings.push(`${al.name} : moins de 2 points de rail TQC — as-built par coordonnées impossible.`);
      }
      // valeurs retenues : rapport FRT (instrument, pleine précision) si disponibles
      const rep = frt.report[c.id];
      if (rep && rep.ec !== null && rep.dz !== null) {
        row.ecFrt = rep.ec; row.dzFrt = rep.dz;
        row.dHab = r1((Math.abs(rep.ec) - P.nomHAsBuilt) * 1000);
        row.dVab = r1((rep.dz - P.nomV) * 1000);
        row.abSource = 'FRT';
      } else {
        row.dHab = row.dHabCoord ?? null;
        row.dVab = row.dVabCoord ?? null;
        row.abSource = 'coordonnées';
      }
      row.okH = row.dHab !== null && Math.abs(row.dHab) <= P.tolH + 1e-9;
      row.okV = row.dVab !== null && Math.abs(row.dVab) <= P.tolV + 1e-9;
      row.ok = row.okH && row.okV;
      if (row.extrap > 0.5) warnings.push(`${c.id} : rail TQC extrapolé sur ${row.extrap.toFixed(2)} m.`);
      return row;
    });
    tracks.push({
      al, trackNo: al.trackNo, label: `Voie ${al.trackNo}`, rows, rails: railRows,
      chMin: rows[0].ch, chMax: rows[rows.length - 1].ch,
      range: `${fmtChainage(rows[0].ch, al.trackNo)} à ${fmtChainage(rows[rows.length - 1].ch, al.trackNo)}`,
    });
  }
  tracks.sort((a, b) => a.trackNo - b.trackNo);
  const all = tracks.flatMap((t) => t.rows);
  return {
    params: P, meta: frt.meta, station: frt.station, closures: frt.closures, tracks, warnings,
    accepted: all.length > 0 && all.every((r) => r.ok),
    nCoffrage: all.length,
  };
}
