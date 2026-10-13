// Alignements de voie GEDO (.sie = base SQLite).
// axiselem : éléments en plan (azimut en gon, rayon + = virage à droite)
// valigelem : profil en long (PIV + rayon de courbe verticale parabolique)

const GON = Math.PI / 200;

export function readSie(SQL, bytes, fileName = '') {
  const db = new SQL.Database(bytes);
  const q = (sql) => {
    const r = db.exec(sql);
    return r.length ? r[0].values : [];
  };
  const name = (q('select name from track')[0] || [fileName])[0];
  const H = q('select type,chai,east,north,dir,lenght,srad,erad from axiselem order by id')
    .map(([type, ch, e, n, dir, len, r1, r2]) => ({ type, ch, e, n, dir, len, r1, r2 }));
  const V = q('select chai,elev,rad from valigelem order by seq').map(([ch, z, r]) => ({ ch, z, r }));
  db.close();
  if (!H.length) throw new Error(`${fileName} : aucun élément en plan (axiselem) trouvé.`);
  return buildAlignment(name, H, V, fileName);
}

export function buildAlignment(name, H, V, fileName = '', step = 0.005) {
  const S = [], E = [], N = [], A = [];
  let closure = 0;
  for (let i = 0; i < H.length; i++) {
    const el = H[i];
    if (!(el.len > 0)) continue;
    const k1 = el.r1 ? 1 / el.r1 : 0;
    const k2 = el.r2 ? 1 / el.r2 : 0;
    const m = Math.max(2, Math.floor(el.len / step) + 1);
    const ds = el.len / (m - 1);
    let az = el.dir * GON, x = el.e, y = el.n;
    let kPrev = k1;
    for (let j = 0; j < m; j++) {
      const s = j * ds;
      if (j > 0) {
        const k = k1 + (k2 - k1) * s / el.len;
        const azNew = az + (k + kPrev) / 2 * ds;
        x += (Math.sin(azNew) + Math.sin(az)) / 2 * ds;
        y += (Math.cos(azNew) + Math.cos(az)) / 2 * ds;
        az = azNew; kPrev = k;
      }
      S.push(el.ch + s); E.push(x); N.push(y); A.push(az);
    }
    const nx = H[i + 1];
    if (nx) closure = Math.max(closure, Math.hypot(x - nx.e, y - nx.n));
  }
  const align = {
    name, fileName, H, V,
    S: Float64Array.from(S), E: Float64Array.from(E), N: Float64Array.from(N), A: Float64Array.from(A),
    closure,
    chStart: S[0], chEnd: S[S.length - 1],
  };
  align.trackNo = Math.floor(align.chStart / 1e6);
  return align;
}

// Chaînage et déport (+ = à droite du sens des chaînages croissants)
export function station(al, e, n) {
  const { S, E, N, A } = al;
  let best = 0, bd = Infinity;
  // recherche grossière puis fine
  const stride = 50;
  for (let i = 0; i < S.length; i += stride) {
    const d = (E[i] - e) ** 2 + (N[i] - n) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const lo = Math.max(0, best - stride), hi = Math.min(S.length - 1, best + stride);
  for (let i = lo; i <= hi; i++) {
    const d = (E[i] - e) ** 2 + (N[i] - n) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const de = e - E[best], dn = n - N[best];
  const t = de * Math.sin(A[best]) + dn * Math.cos(A[best]);
  const o = de * Math.cos(A[best]) - dn * Math.sin(A[best]);
  const inside = best > 0 && best < S.length - 1;
  return { ch: S[best] + t, off: o, inside };
}

// Élévation du profil en long (dessus de rail) au chaînage ch
export function profile(al, ch) {
  const pv = al.V;
  if (!pv || pv.length === 0) return null;
  if (pv.length === 1) return pv[0].z;
  const g = [];
  for (let j = 0; j < pv.length - 1; j++) g.push((pv[j + 1].z - pv[j].z) / (pv[j + 1].ch - pv[j].ch));
  let j = 0;
  while (j < pv.length - 2 && ch > pv[j + 1].ch) j++;
  let z = pv[j].z + g[j] * (ch - pv[j].ch);
  for (let k = 1; k < pv.length - 1; k++) {
    const R = pv[k].r;
    if (R && R < 1e7) {
      const dg = g[k] - g[k - 1];
      const T = R * Math.abs(dg) / 2;
      if (T > 0 && ch >= pv[k].ch - T && ch <= pv[k].ch + T) {
        const x = ch - (pv[k].ch - T);
        z = pv[k].z - g[k - 1] * T + g[k - 1] * x + dg / (4 * T) * x * x;
      }
    }
  }
  return z;
}

export function fmtChainage(ch, trackNo) {
  const v = ch - (trackNo ?? Math.floor(ch / 1e6)) * 1e6;
  const km = Math.floor(v / 1000);
  const m = v - km * 1000;
  return `${km}+${m.toFixed(2).padStart(6, '0')}`;
}
