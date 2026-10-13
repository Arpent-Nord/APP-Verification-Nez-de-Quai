// Lecture d'un rapport FRT Leica (format "RAPPORT D'ARPENTAGE" texte).
// Retourne l'en-tête du levé, la station, les fermetures, les points et
// la section rapport (PM / Éc / d.Z) calculée par l'instrument.

const num = (s) => {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (t === '' || t.startsWith('---')) return null;
  const v = Number(t.replace(/^\+/, ''));
  return Number.isFinite(v) ? v : null;
};

export function parseFRT(text, fileName = '') {
  const lines = text.replace(/\r/g, '').split('\n');
  const meta = { fileName, job: '', date: '', heure: '', instrument: '', serial: '', scale: '' };
  const station = { name: '', N: null, E: null, Z: null, residual: null, backsights: [] };
  const closures = [];
  const points = [];
  const report = {};
  let inStation = false;
  let lastBacksight = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/^;\s*Date:\s*(\S+)/))) meta.date = m[1].replace(/\//g, '-');
    else if ((m = line.match(/^;\s*Heure:\s*(.+)$/))) meta.heure = m[1].replace(/\s+/g, '').trim();
    else if ((m = line.match(/^;\s*Job:\s*(\S+)/))) meta.job = m[1];
    else if ((m = line.match(/^;\s*Type d.Instrument:\s*(.+)$/))) meta.instrument = m[1].trim();
    else if ((m = line.match(/^;\s*Serial No\.:\s*(\S+)/))) meta.serial = m[1];
    else if ((m = line.match(/^;\s*Facteur .chelle:\s*(.+)$/))) meta.scale = m[1].trim();
    else if (/^;\s*Station install/.test(line)) inStation = true;
    else if (inStation && (m = line.match(/^;\s*(\S+)\s*,\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/)) && !station.name) {
      station.name = m[1]; station.N = num(m[2]); station.E = num(m[3]); station.Z = num(m[4]);
    } else if ((m = line.match(/^;\s*Vis.e arri.re/))) {
      lastBacksight = {};
    } else if (lastBacksight && !lastBacksight.name && (m = line.match(/^;\s*(\S+)\s*,\s*([-\d.]+),/))) {
      lastBacksight.name = m[1];
    } else if (lastBacksight && lastBacksight.name && (m = line.match(/^;\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Delta/))) {
      lastBacksight.dN = num(m[1]); lastBacksight.dE = num(m[2]); lastBacksight.dZ = num(m[3]);
      station.backsights.push(lastBacksight); lastBacksight = null;
    } else if ((m = line.match(/^;\s*(\S+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+R.siduel/))) {
      station.residual = { dN: num(m[2]), dE: num(m[3]), dZ: num(m[4]) };
      inStation = false;
    } else if ((m = line.match(/^;\s*(\S+)\s+d\.N:\s*([-\d.]+)\s+d\.E:\s*([-\d.]+)\s+(Cut|Fill)\s*([-+\d.]+).*?Pt\.Th.o:\s*(\S+)/))) {
      let dz = num(m[5]);
      if (dz !== null && m[4] === 'Cut' && dz > 0) dz = -dz;
      closures.push({ name: m[1], dN: num(m[2]), dE: num(m[3]), dZ: dz, ref: m[6] });
    } else if ((m = line.match(/^;\s*(\S+)\s+PM:\s*([-\d.]+)\s+\S+:\s*([-\d.]+)\s+d\.Z:\s*([-\d.]+)\s+(\S+)/))) {
      report[m[1]] = { pm: num(m[2]), ec: num(m[3]), dz: num(m[4]), code: m[5] };
    } else if (!line.startsWith(';') && (m = line.match(/^([^,;]+?)\s*,\s*([^,]*),\s*([^,]*),\s*([^,]*),(.*)$/))) {
      const id = m[1].trim();
      const rest = m[5];
      const cm = rest.match(/^\s*(\d*)_(\d+)?/);
      const attrs = (rest.match(/\*([^*\s][^*]*?)\s*(?=\*|$)/g) || []).map((s) => s.replace(/^\*/, '').trim()).filter(Boolean);
      points.push({
        id,
        N: num(m[2]), E: num(m[3]), Z: num(m[4]),
        code: cm ? cm[1] : '',
        line: cm && cm[2] ? cm[2] : '',
        attrs,
        measured: num(m[2]) !== null && num(m[3]) !== null,
      });
    }
  }
  if (!meta.job && fileName) meta.job = fileName.replace(/\.[^.]+$/, '').replace(/_modif$/i, '');
  return { meta, station, closures, points, report };
}
