// Procedural canvas textures — everything in the game is generated at runtime,
// so the project ships with zero image assets.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Small deterministic PRNG so the world looks the same on every load.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dirtTexture() {
  const [c, g] = canvas(512, 512);
  const r = rng(7);
  g.fillStyle = '#b98d55';
  g.fillRect(0, 0, 512, 512);
  // mottled patches
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = r() * 512, rad = 10 + r() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const light = r() > 0.5;
    grd.addColorStop(0, light ? 'rgba(214,174,118,0.16)' : 'rgba(140,100,58,0.14)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // grit
  for (let i = 0; i < 9000; i++) {
    const v = r();
    g.fillStyle = v > 0.5 ? `rgba(240,210,160,${0.25 * r()})` : `rgba(90,60,30,${0.3 * r()})`;
    g.fillRect(r() * 512, r() * 512, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // straw strands
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = r() * 512, a = r() * Math.PI, l = 4 + r() * 10;
    g.strokeStyle = `rgba(245,222,160,${0.35 + r() * 0.4})`;
    g.lineWidth = 0.8 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return toTexture(c, { repeat: [14, 40] });
}

export function grassTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(11);
  g.fillStyle = '#8f9a58';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(170,180,100,${r() * 0.4})` : `rgba(80,95,45,${r() * 0.4})`;
    g.fillRect(r() * 256, r() * 256, 1.5, 2 + r() * 3);
  }
  return toTexture(c, { repeat: [60, 60] });
}

export function stoneTexture(rows = 8, cols = 4) {
  const [c, g] = canvas(512, 512);
  const r = rng(3);
  g.fillStyle = '#b9ab8c';
  g.fillRect(0, 0, 512, 512);
  const bh = 512 / rows, bw = 512 / cols;
  for (let y = 0; y < rows; y++) {
    const off = (y % 2) * bw * 0.5;
    for (let x = -1; x < cols + 1; x++) {
      const px = x * bw + off, py = y * bh;
      const shade = 200 + Math.floor(r() * 35);
      g.fillStyle = `rgb(${shade + 10},${shade},${shade - 30})`;
      g.fillRect(px + 3, py + 3, bw - 6, bh - 6);
      // top highlight + bottom shadow give the low-poly brick bevel look
      g.fillStyle = 'rgba(255,248,228,0.35)';
      g.fillRect(px + 3, py + 3, bw - 6, 4);
      g.fillStyle = 'rgba(80,64,40,0.25)';
      g.fillRect(px + 3, py + bh - 8, bw - 6, 5);
      for (let k = 0; k < 20; k++) {
        g.fillStyle = `rgba(120,100,70,${r() * 0.15})`;
        g.fillRect(px + 3 + r() * (bw - 8), py + 3 + r() * (bh - 8), 2 + r() * 6, 2 + r() * 4);
      }
    }
  }
  return toTexture(c);
}

export function woodTexture(base = '#6b4a2e') {
  const [c, g] = canvas(128, 512);
  const r = rng(5);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(30,18,8,${0.08 + r() * 0.12})`;
    g.lineWidth = 1 + r() * 2;
    const x = r() * 128;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + r() * 8 - 4, 170, x + r() * 8 - 4, 340, x + r() * 6 - 3, 512);
    g.stroke();
  }
  return toTexture(c);
}

export function stripeTexture(c1, c2, stripes = 8) {
  const [c, g] = canvas(256, 64);
  const w = 256 / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? c2 : c1;
    g.fillRect(i * w, 0, w, 64);
  }
  return toTexture(c);
}

// Barber-pole stripes for the lance shaft.
export function lanceTexture(c1, c2) {
  const [c, g] = canvas(64, 256);
  g.fillStyle = c1;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = c2;
  for (let i = -4; i < 12; i++) {
    g.beginPath();
    const y = i * 32;
    g.moveTo(0, y); g.lineTo(64, y + 32); g.lineTo(64, y + 48); g.lineTo(0, y + 16);
    g.fill();
  }
  return toTexture(c, { repeat: [1, 3] });
}

function drawDiamondCharge(g, cx, cy, s, fg) {
  g.fillStyle = fg;
  g.beginPath();
  g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.45, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s * 0.45, cy);
  g.closePath(); g.fill();
  g.beginPath();
  g.moveTo(cx - s * 0.9, cy); g.lineTo(cx, cy - s * 0.18); g.lineTo(cx + s * 0.9, cy); g.lineTo(cx, cy + s * 0.18);
  g.closePath(); g.fill();
}

export function bannerTexture(bg, fg, trim = '#d8b45a') {
  const [c, g] = canvas(128, 256);
  g.fillStyle = bg; g.fillRect(0, 0, 128, 256);
  g.strokeStyle = trim; g.lineWidth = 6; g.strokeRect(8, 8, 112, 240);
  drawDiamondCharge(g, 64, 118, 52, fg);
  return toTexture(c, { repeat: [1, 1] });
}

// Heraldic shields. 'falcon' = player (green & silver), 'stag' = opponent (red & gold).
export function shieldTexture(kind) {
  const [c, g] = canvas(256, 320);
  if (kind === 'falcon') {
    g.fillStyle = '#1f5a4f'; g.fillRect(0, 0, 256, 320);
    g.fillStyle = '#d9dcd6'; // silver chevron
    g.beginPath(); g.moveTo(0, 230); g.lineTo(128, 110); g.lineTo(256, 230); g.lineTo(256, 280); g.lineTo(128, 160); g.lineTo(0, 280); g.closePath(); g.fill();
    // stylised falcon: wings + body
    g.fillStyle = '#e9e4d2';
    g.beginPath(); g.moveTo(128, 40); g.lineTo(160, 70); g.lineTo(215, 55); g.lineTo(170, 95); g.lineTo(140, 100); g.lineTo(128, 120);
    g.lineTo(116, 100); g.lineTo(86, 95); g.lineTo(41, 55); g.lineTo(96, 70); g.closePath(); g.fill();
  } else {
    g.fillStyle = '#9b2c22'; g.fillRect(0, 0, 256, 320);
    g.fillStyle = '#e1b74e';
    g.fillRect(0, 0, 256, 34); // gold chief
    // stag head: face + antlers
    g.beginPath(); g.moveTo(128, 250); g.lineTo(104, 170); g.lineTo(110, 140); g.lineTo(146, 140); g.lineTo(152, 170); g.closePath(); g.fill();
    g.lineWidth = 9; g.strokeStyle = '#e1b74e'; g.lineCap = 'round';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(128 + s * 16, 140); g.quadraticCurveTo(128 + s * 70, 120, 128 + s * 80, 60);
      g.moveTo(128 + s * 52, 122); g.lineTo(128 + s * 92, 108);
      g.moveTo(128 + s * 70, 96); g.lineTo(128 + s * 104, 70);
      g.moveTo(128 + s * 76, 74); g.lineTo(128 + s * 60, 50);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(30,20,10,0.6)'; g.lineWidth = 10; g.strokeRect(0, 0, 256, 320);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Horse caparison (trapper): base colour with a repeating heraldic charge and trim.
export function caparisonTexture(bg, fg, trim) {
  const [c, g] = canvas(512, 128);
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.fillStyle = trim; g.fillRect(0, 112, 512, 16);
  for (let i = 0; i < 4; i++) drawDiamondCharge(g, 64 + i * 128, 56, 28, fg);
  return toTexture(c);
}

export function softDotTexture() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
