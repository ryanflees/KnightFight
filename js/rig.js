// Geometry + material helpers for the organic, "realistic" rider and horse.
import * as THREE from 'three';
import { rng } from './textures.js';

// Lofts a smooth tube through a list of stations. Each station:
//   { c: [x,y,z], rx, rt, rb, p? }  — rx = half-width (along X), rt / rb = extent on the
//   dorsal / ventral side, p = superellipse exponent (<1 boxier, 1 = ellipse).
// The ring frame keeps X fixed (bilateral symmetry); the dorsal axis U is perpendicular to the
// tangent within the YZ plane. Seam runs along the ventral side, ends are capped.
export function loft(stations, seg = 28, caps = [true, true]) {
  const n = stations.length;
  const C = stations.map((s) => new THREE.Vector3(...s.c));
  const pos = [], uv = [], idx = [];
  const T = new THREE.Vector3(), U = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const s = stations[i];
    T.subVectors(C[Math.min(n - 1, i + 1)], C[Math.max(0, i - 1)]); T.x = 0; T.normalize();
    U.set(0, T.z, -T.y);
    const p = s.p ?? 0.92;
    for (let j = 0; j <= seg; j++) {
      const th = -Math.PI / 2 + (j / seg) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const cx = Math.sign(c) * Math.pow(Math.abs(c), p), cy = Math.sign(sn) * Math.pow(Math.abs(sn), p);
      const ry = sn >= 0 ? s.rt : s.rb;
      const v = C[i].clone().addScaledVector(X, s.rx * cx).addScaledVector(U, ry * cy);
      pos.push(v.x, v.y, v.z);
      uv.push(j / seg, i / (n - 1));
    }
  }
  const R = seg + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * R + j, b = (i + 1) * R + j, c = a + 1, d = b + 1;
      idx.push(a, c, b, c, d, b);
    }
  }
  const addCap = (ring, start) => {
    const ci = pos.length / 3;
    const cc = C[ring];
    pos.push(cc.x, cc.y, cc.z); uv.push(0.5, start ? 0 : 1);
    for (let j = 0; j < seg; j++) {
      const a = ring * R + j, b = a + 1;
      if (start) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (caps[0]) addCap(0, true);
  if (caps[1]) addCap(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals so there's no visible line along the belly
  const nrm = g.attributes.normal;
  for (let i = 0; i < n; i++) {
    const a = i * R, b = i * R + seg;
    const v = new THREE.Vector3(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
    nrm.setXYZ(a, v.x, v.y, v.z); nrm.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

// Tapered limb segment spanning z ∈ [0, 1] (scale z to set length), for IK-driven bones.
export function boneGeo(r0, r1, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, seg, 3);
  // slight muscle bulge in the upper third
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5; // 0 at r0 end
    const k = 1 + Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.08;
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Hammered, slightly brushed steel: used as roughness + bump map.
let _steel = null;
export function steelMaps() {
  if (_steel) return _steel;
  const R = rng(91);
  const tex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { // brushing
      g.fillStyle = `rgba(${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},0)`;
      const v = Math.floor(70 + R() * 50);
      g.fillStyle = `rgba(${v},${v},${v},0.25)`;
      g.fillRect(R() * w, R() * h, 20 + R() * 60, 1);
    }
    for (let i = 0; i < 160; i++) { // hammer dents
      const x = R() * w, y = R() * h, r = 3 + R() * 9;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(40,40,40,0.35)'); grd.addColorStop(1, 'rgba(40,40,40,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, false);
  _steel = tex;
  return tex;
}

export function steelMaterial(color = '#c3c7cd', opts = {}) {
  const m = steelMaps();
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.95, roughness: 0.62, roughnessMap: m, bumpMap: m, bumpScale: 0.35,
    envMapIntensity: 1.25, ...opts,
  });
}

// Fabric: soft sheen at grazing angles reads as wool/velvet.
export function clothMaterial(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.92, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35),
    side: THREE.DoubleSide, ...opts,
  });
}

// Horse coat. kind: 'dapple' (grey) or 'bay'.
export function coatMaterial(base, kind) {
  let map = null;
  if (kind === 'dapple') {
    const R = rng(17);
    map = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      // soft darker mottling with lighter centres: dapples, not rings
      g.fillStyle = 'rgba(150,146,140,0.35)'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 520; i++) {
        const x = R() * w, y = R() * h, r = 5 + R() * 10;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.75)');
        grd.addColorStop(0.7, 'rgba(255,255,255,0.35)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    map.repeat.set(3, 2);
  } else {
    // subtle hair-direction streaks so the coat isn't flat plastic
    const R = rng(23);
    map = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        const v = 200 + Math.floor(R() * 55);
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.fillRect(R() * w, R() * h, 1, 4 + R() * 6);
      }
    });
    map.repeat.set(3, 3);
  }
  return new THREE.MeshPhysicalMaterial({
    color: base, map, roughness: 0.55, sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color(base).lerp(new THREE.Color('#fff6e8'), 0.5),
  });
}

// Long heraldic tabard / cape texture with a single central charge.
export function tabardTexture(bg, fg, trim) {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = trim; g.fillRect(0, h - 22, w, 22); g.fillRect(0, 0, w, 10);
    g.fillRect(14, 0, 6, h); g.fillRect(w - 20, 0, 6, h);
    const cx = w / 2, cy = h * 0.4, s = 78;
    g.fillStyle = fg;
    g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.42, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s * 0.42, cy); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx - s * 0.9, cy); g.lineTo(cx, cy - s * 0.17); g.lineTo(cx + s * 0.9, cy); g.lineTo(cx, cy + s * 0.17); g.closePath(); g.fill();
    // fabric weave noise
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
  });
}
