// Records rider snapshots every sim step and plays them back with interpolation.
import * as THREE from 'three';

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

function lerp(a, b, f) { return a + (b - a) * f; }

function interpSnap(a, b, f) {
  const o = {};
  for (const k in a) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number') {
      if (k === 'phase') {
        let d = vb - va; if (d < -0.5) d += 1; if (d > 0.5) d -= 1;
        o[k] = ((va + d * f) % 1 + 1) % 1;
      } else o[k] = lerp(va, vb, f);
    } else if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length === 4) {
        _qa.fromArray(va); _qb.fromArray(vb);
        o[k] = _qa.slerp(_qb, f).toArray();
      } else o[k] = va.map((x, i) => lerp(x, vb[i], f));
    } else {
      o[k] = f < 0.5 ? va : vb;
    }
  }
  // structural flags must come from a consistent frame
  if (a.unhorsed !== b.unhorsed) return f < 0.5 ? { ...a } : { ...b };
  return o;
}

export class Recorder {
  constructor() { this.reset(); }
  reset() { this.frames = []; this.events = []; this.impactT = null; }
  push(t, p, o) { this.frames.push({ t, p, o }); }
  event(e) {
    this.events.push(e);
    if (e.type === 'impact' && this.impactT === null) this.impactT = e.t;
  }
  get duration() { return this.frames.length ? this.frames[this.frames.length - 1].t : 0; }
  sample(t) {
    const F = this.frames;
    if (!F.length) return null;
    if (t <= F[0].t) return F[0];
    if (t >= F[F.length - 1].t) return F[F.length - 1];
    let lo = 0, hi = F.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F[mid].t <= t) lo = mid; else hi = mid; }
    const a = F[lo], b = F[hi];
    const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return { t, p: interpSnap(a.p, b.p, f), o: interpSnap(a.o, b.o, f) };
  }
}
