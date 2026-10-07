// The tiltyard: lists, tilt barrier, grandstands with crowd, pavilions, castle and countryside.
// Coordinates: the joust runs along Z. The tilt barrier sits on x = 0.
// The player charges toward +Z (the castle) on the x < 0 side; the red stands are at x > 0.
import * as THREE from 'three';
import {
  rng, dirtTexture, grassTexture, stoneTexture, woodTexture, stripeTexture, bannerTexture, softDotTexture,
} from './textures.js';

export const LIST = {
  barrierHalf: 54,   // tilt barrier runs z ∈ [-54, 54]
  fenceX: 4.3,       // outer list fences
  laneX: 1.15,       // each rider's lane offset from the barrier
  startZ: 50,        // riders start at ∓startZ
};

const PALETTE = {
  red: '#a8382c', redDark: '#7b2620', teal: '#1f5a54', tealDark: '#17423f',
  cream: '#efe6cf', gold: '#d6ae52', wood: '#5a3d26', woodDark: '#3a2818',
};

// Collects repeated meshes and emits one InstancedMesh per (geometry, material) pair.
class Batcher {
  constructor() { this.groups = new Map(); }
  add(geo, mat, matrix, color) {
    const key = geo.uuid + mat.uuid;
    if (!this.groups.has(key)) this.groups.set(key, { geo, mat, items: [] });
    this.groups.get(key).items.push({ m: matrix.clone(), c: color });
  }
  build(parent, { cast = true, receive = true } = {}) {
    const out = [];
    for (const { geo, mat, items } of this.groups.values()) {
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        if (it.c) im.setColorAt(i, it.c);
      });
      im.castShadow = cast; im.receiveShadow = receive;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      parent.add(im);
      out.push(im);
    }
    this.groups.clear();
    return out;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function mtx(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z); _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

// Breaks up texture tiling with low-frequency world-space noise (tint + brightness).
function macroVary(mat, scale = 0.04, amt = 0.35, tint = [1.0, 0.92, 0.8]) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMacroPos;
        float mHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float mNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mHash(i), mHash(i+vec2(1,0)), f.x), mix(mHash(i+vec2(0,1)), mHash(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 mp = vMacroPos.xz * ${scale.toFixed(4)};
        float mn = mNoise(mp) * 0.55 + mNoise(mp * 2.7 + 13.0) * 0.3 + mNoise(mp * 7.3 + 5.0) * 0.15;
        diffuseColor.rgb *= mix(vec3(${tint.map((x) => x.toFixed(3)).join(',')}), vec3(1.0), 0.5 + 0.5 * mn) * (1.0 + (mn - 0.5) * ${amt.toFixed(3)});`);
  };
  return mat;
}

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: false, ...opts });
}

// A banner/flag mesh whose vertices ripple on the CPU (cheap; there are only a few dozen).
class Flag {
  constructor(w, h, mat, segX = 10, segY = 4, attachLeft = true) {
    this.geo = new THREE.PlaneGeometry(w, h, segX, segY);
    if (attachLeft) this.geo.translate(w / 2, 0, 0); else this.geo.translate(0, -h / 2, 0);
    this.base = this.geo.attributes.position.array.slice();
    this.w = w; this.h = h; this.attachLeft = attachLeft;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.castShadow = true;
    this.phase = Math.random() * 10;
  }
  update(t) {
    const p = this.geo.attributes.position.array, b = this.base;
    for (let i = 0; i < p.length; i += 3) {
      const x = b[i], y = b[i + 1];
      const k = this.attachLeft ? x / this.w : (-y / this.h); // 0 at the pole
      p[i + 2] = Math.sin(t * 3.2 + this.phase + (this.attachLeft ? x : -y) * 1.8) * 0.18 * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

export function buildWorld(scene) {
  const world = { flags: [], update: null };
  const R = rng(42);
  const batch = new Batcher();

  // ---------- sky, fog, light ----------
  const skyGeo = new THREE.SphereGeometry(900, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color('#4a7aa6') },
      mid: { value: new THREE.Color('#9cb9cf') },
      horizon: { value: new THREE.Color('#ecdcbc') },
      sunDir: { value: new THREE.Vector3(52, 46, 96).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.18, h));
        c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0,0.86,0.6) * (pow(s, 24.0) * 0.55 + pow(s, 4.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog('#dccdab', 110, 560);

  const hemi = new THREE.HemisphereLight('#cfdcea', '#8a6a42', 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe6c4', 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 300;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  world.sunOffset = new THREE.Vector3(52, 46, 96);
  world.sun = sun;
  // Shadow frustum follows whatever the camera is looking at.
  world.focusShadow = (focus) => {
    sun.target.position.copy(focus);
    sun.position.copy(focus).add(world.sunOffset);
  };

  // ---------- ground ----------
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), macroVary(std('#ffffff', { map: grassTexture() }), 0.02, 0.45, [1.08, 0.95, 0.7]));
  grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true;
  scene.add(grass);
  const dirtTex = dirtTexture();
  dirtTex.repeat.set(22, 38);
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(118, 200), macroVary(std('#ffffff', { map: dirtTex }), 0.06, 0.3, [0.92, 0.86, 0.8]));
  dirt.material.polygonOffset = true; dirt.material.polygonOffsetFactor = -2; dirt.material.polygonOffsetUnits = -2;
  dirt.rotation.x = -Math.PI / 2; dirt.position.set(0, 0.02, 4); dirt.receiveShadow = true;
  scene.add(dirt);
  // churned-up riding lanes
  const laneTex = dirtTexture(); laneTex.repeat.set(2, 30);
  for (const s of [-1, 1]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 118), std('#d2a971', { map: laneTex, transparent: true, opacity: 0.55 }));
    lane.material.polygonOffset = true; lane.material.polygonOffsetFactor = -4; lane.material.polygonOffsetUnits = -4;
    lane.rotation.x = -Math.PI / 2; lane.position.set(s * 2.2, 0.04, 0); lane.receiveShadow = true;
    scene.add(lane);
  }

  // ---------- shared materials ----------
  const woodMat = std('#ffffff', { map: woodTexture(PALETTE.wood) });
  const darkWoodMat = std('#ffffff', { map: woodTexture(PALETTE.woodDark) });
  const goldMat = std(PALETTE.gold, { metalness: 0.7, roughness: 0.35 });
  const creamMat = std(PALETTE.cream);
  const tealMat = std(PALETTE.teal);
  const redMat = std(PALETTE.red);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const finialGeo = new THREE.ConeGeometry(0.11, 0.24, 4);
  const ballGeo = new THREE.SphereGeometry(0.16, 12, 8);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);

  // ---------- tilt barrier ----------
  const B = LIST.barrierHalf;
  {
    const seg = 3.0;
    for (let z = -B; z < B - 0.01; z += seg) {
      const zc = z + seg / 2;
      const idx = Math.round((z + B) / seg);
      // cream upper board, team-coloured lower kick panel
      batch.add(boxGeo, creamMat, mtx(0, 0.98, zc, 0.12, 0.42, seg));
      batch.add(boxGeo, idx % 2 ? tealMat : redMat, mtx(0, 0.55, zc, 0.13, 0.44, seg));
      batch.add(boxGeo, darkWoodMat, mtx(0, 1.24, zc, 0.18, 0.1, seg));
    }
    for (let z = -B; z <= B + 0.01; z += 3.0) {
      batch.add(boxGeo, darkWoodMat, mtx(0, 0.68, z, 0.2, 1.36, 0.2));
      batch.add(finialGeo, goldMat, mtx(0, 1.48, z, 1, 1, 1, 0, Math.PI / 4, 0));
    }
  }

  // ---------- list fences ----------
  for (const s of [-1, 1]) {
    const x = s * LIST.fenceX;
    for (let z = -58; z <= 58.01; z += 2.5) {
      batch.add(boxGeo, darkWoodMat, mtx(x, 0.75, z, 0.18, 1.5, 0.18));
      batch.add(finialGeo, goldMat, mtx(x, 1.62, z, 1, 1, 1, 0, Math.PI / 4, 0));
      if (z < 58) {
        batch.add(boxGeo, woodMat, mtx(x, 1.18, z + 1.25, 0.1, 0.12, 2.5));
        batch.add(boxGeo, woodMat, mtx(x, 0.62, z + 1.25, 0.1, 0.12, 2.5));
      }
    }
    // end caps across the list so the lanes look closed
    for (const zEnd of [-58, 58]) {
      const span = LIST.fenceX;
      batch.add(boxGeo, woodMat, mtx(s * span / 2, 1.18, zEnd, span, 0.12, 0.1));
    }
  }

  // ---------- grandstands ----------
  const crowdItems = [];
  const crowdColors = ['#7a3b3b', '#b0623f', '#c99a5b', '#5d6f8a', '#6d5a7f', '#e4d6b6', '#4d6b5a', '#93705a', '#a64f5e', '#cfb68b', '#3f566e', '#8c8c74'];
  const skinColors = ['#f0d2b0', '#d9b089', '#b98c65', '#f4dcc2', '#8c6448'];
  const awningRed = std('#ffffff', { map: stripeTexture(PALETTE.red, PALETTE.cream, 10), side: THREE.DoubleSide });
  const awningTeal = std('#ffffff', { map: stripeTexture(PALETTE.teal, PALETTE.cream, 10), side: THREE.DoubleSide });
  const pennantGeo = new THREE.BufferGeometry();
  pennantGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.36, 0, 0, 0.36, 0, -0.85, 0], 3));
  pennantGeo.computeVertexNormals();
  const pennantMat = std('#ffffff', { side: THREE.DoubleSide });

  const segLen = 12.5, segGap = 1.0, segCount = 8;
  const standStart = -(segCount * segLen) / 2;
  for (const s of [-1, 1]) {
    const isRed = s > 0;
    const teamCol = new THREE.Color(isRed ? PALETTE.red : PALETTE.teal);
    const cream = new THREE.Color(PALETTE.cream);
    for (let k = 0; k < segCount; k++) {
      const z0 = standStart + k * segLen + segGap / 2;
      const z1 = z0 + segLen - segGap;
      const zc = (z0 + z1) / 2, L = z1 - z0;
      // front board
      batch.add(boxGeo, woodMat, mtx(s * 6.5, 0.65, zc, 0.14, 1.3, L));
      // stepped tiers + benches + spectators
      for (let i = 0; i < 4; i++) {
        const h = 0.55 + i * 0.6;
        const xc = s * (7.2 + i * 1.2);
        batch.add(boxGeo, darkWoodMat, mtx(xc, h / 2, zc, 1.2, h, L));
        batch.add(boxGeo, woodMat, mtx(xc + s * 0.25, h + 0.42, zc, 0.45, 0.08, L));
        for (let z = z0 + 0.35; z < z1 - 0.3; z += 0.48 + R() * 0.12) {
          if (R() < 0.12) continue; // a few empty seats
          crowdItems.push({
            x: xc + s * (0.12 + R() * 0.12), y: h + 0.46, z,
            body: crowdColors[Math.floor(R() * crowdColors.length)],
            skin: skinColors[Math.floor(R() * skinColors.length)],
            phase: R() * Math.PI * 2, side: s, scale: 0.9 + R() * 0.2,
          });
        }
      }
      // back wall
      batch.add(boxGeo, woodMat, mtx(s * 11.45, 2.3, zc, 0.15, 4.6, L));
      // awning posts
      for (const zp of [z0 + 0.1, z1 - 0.1]) {
        batch.add(boxGeo, darkWoodMat, mtx(s * 6.35, 2.55, zp, 0.2, 5.1, 0.2));
        batch.add(boxGeo, darkWoodMat, mtx(s * 11.6, 3.15, zp, 0.2, 6.3, 0.2));
      }
      // sloped striped awning (built as an individual mesh: needs the stripe UVs running across)
      const roofW = 5.5;
      const roofGeo = new THREE.PlaneGeometry(L, roofW);
      roofGeo.rotateZ(Math.PI / 2); // stripes run front-to-back
      const roof = new THREE.Mesh(roofGeo, isRed ? awningRed : awningTeal);
      roof.position.set(s * 9.0, 5.65, zc);
      roof.rotation.x = -Math.PI / 2;
      roof.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), s * Math.atan2(1.2, roofW));
      roof.castShadow = true; roof.receiveShadow = true;
      scene.add(roof);
      // bunting along the front edge
      let n = 0;
      for (let z = z0 + 0.4; z < z1 - 0.2; z += 0.78, n++) {
        batch.add(pennantGeo, pennantMat, mtx(s * 6.3, 5.0, z), n % 2 ? cream : teamCol);
      }
      // banner pole in front of each segment
      const px = s * 5.35;
      batch.add(cylGeo, darkWoodMat, mtx(px, 3.9, zc, 0.07, 7.8, 0.07));
      batch.add(ballGeo, goldMat, mtx(px, 7.9, zc));
      batch.add(boxGeo, darkWoodMat, mtx(px, 7.35, zc, 0.06, 0.06, 1.5));
      const bannerMat = std('#ffffff', { map: bannerTexture(isRed ? PALETTE.red : PALETTE.teal, PALETTE.cream), side: THREE.DoubleSide });
      const flag = new Flag(1.3, 2.6, bannerMat, 4, 10, false);
      flag.mesh.position.set(px + s * 0.05, 7.3, zc);
      flag.mesh.rotation.y = Math.PI / 2;
      flag.updateHanging = true;
      scene.add(flag.mesh);
      world.flags.push(flag);
    }
  }

  // Hanging banners use a dedicated wave (sway along z, stronger at the bottom).
  for (const f of world.flags) {
    if (!f.updateHanging) continue;
    f.update = function (t) {
      const p = this.geo.attributes.position.array, b = this.base;
      for (let i = 0; i < p.length; i += 3) {
        const y = b[i + 1];
        const k = Math.min(1, Math.max(0, -y / 2.6));
        p[i + 2] = Math.sin(t * 2.1 + this.phase + y * 1.4) * 0.16 * k;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.computeVertexNormals();
    };
  }

  // ---------- crowd (instanced, animated) ----------
  const bodyGeo = new THREE.CapsuleGeometry(0.16, 0.32, 3, 8);
  const headGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const crowdBodies = new THREE.InstancedMesh(bodyGeo, std('#ffffff', { roughness: 0.9 }), crowdItems.length);
  const crowdHeads = new THREE.InstancedMesh(headGeo, std('#ffffff', { roughness: 0.8 }), crowdItems.length);
  const col = new THREE.Color();
  crowdItems.forEach((c, i) => {
    crowdBodies.setColorAt(i, col.set(c.body));
    crowdHeads.setColorAt(i, col.set(c.skin));
  });
  crowdBodies.castShadow = crowdHeads.castShadow = true;
  crowdBodies.receiveShadow = true;
  scene.add(crowdBodies, crowdHeads);
  world.crowdCount = crowdItems.length;
  const excitement = { '-1': 0, '1': 0 };
  world.cheer = (side, amount) => {
    if (side === 0) { excitement['-1'] = Math.max(excitement['-1'], amount); excitement['1'] = Math.max(excitement['1'], amount); }
    else excitement[side] = Math.max(excitement[side], amount);
  };
  function updateCrowd(t, dt) {
    for (const k in excitement) excitement[k] = Math.max(0.08, excitement[k] - dt * 0.18);
    for (let i = 0; i < crowdItems.length; i++) {
      const c = crowdItems[i];
      const ex = excitement[c.side];
      const jump = Math.max(0, Math.sin(t * (5 + ex * 6) + c.phase)) * ex * 0.28;
      const sway = Math.sin(t * 1.3 + c.phase) * 0.03;
      const y = c.y + 0.32 * c.scale + jump;
      crowdBodies.setMatrixAt(i, mtx(c.x, y, c.z, c.scale, c.scale, c.scale, 0, 0, sway));
      crowdHeads.setMatrixAt(i, mtx(c.x + sway * 0.5, y + 0.43 * c.scale, c.z, c.scale, c.scale, c.scale));
    }
    crowdBodies.instanceMatrix.needsUpdate = true;
    crowdHeads.instanceMatrix.needsUpdate = true;
  }

  // ---------- pavilions (tents) ----------
  const tentWall = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const tentRoof = new THREE.ConeGeometry(1, 1, 10);
  const tentWallMat = std(PALETTE.cream, { side: THREE.DoubleSide });
  const doorMat = std('#3b2a1c');
  const tentSpots = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      tentSpots.push({ x: s * (17 + R() * 22), z: -70 + i * 17 + R() * 6, s });
    }
  }
  for (const t of tentSpots) {
    const r = 2.0 + R() * 1.2, h = 2.2 + R() * 0.6;
    const roofMat = (t.s > 0) === (R() > 0.2) ? redMat : tealMat;
    batch.add(tentWall, tentWallMat, mtx(t.x, h / 2, t.z, r, h, r));
    batch.add(tentRoof, roofMat, mtx(t.x, h + r * 0.55, t.z, r * 1.18, r * 1.1, r * 1.18));
    batch.add(boxGeo, doorMat, mtx(t.x - t.s * r * 0.98, h * 0.4, t.z, 0.05, h * 0.8, 0.8, 0, 0, 0));
    batch.add(cylGeo, darkWoodMat, mtx(t.x, h + r * 1.2, t.z, 0.04, 0.6, 0.04));
  }

  // ---------- castle ----------
  const stoneTex = stoneTexture(8, 4);
  const stoneMatFor = (sx, sy) => {
    const t = stoneTex.clone();
    t.needsUpdate = true;
    t.repeat.set(sx, sy);
    return std('#ffffff', { map: t, roughness: 0.95 });
  };
  const wallMat = stoneMatFor(10, 2);
  const towerMat = stoneMatFor(4, 4);
  const merlonMat = std('#d6c8a6', { roughness: 0.95 });
  const roofMat = std('#56706a', { roughness: 0.8, flatShading: true });
  const slitMat = std('#2b2620');
  const castleGroup = new THREE.Group();
  scene.add(castleGroup);

  function wallRun(x0, z0, x1, z1, h = 9, thick = 3) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    const geo = new THREE.BoxGeometry(thick, h, len);
    const m = new THREE.Mesh(geo, stoneMatFor(Math.max(1, len / 10), h / 4.5));
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.rotation.y = ang;
    m.castShadow = m.receiveShadow = true;
    castleGroup.add(m);
    // crenellations
    const n = Math.floor(len / 1.6);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const x = x0 + dx * f, z = z0 + dz * f;
      batch.add(boxGeo, merlonMat, mtx(x, h + 0.45, z, thick + 0.2, 0.9, 0.85, 0, ang, 0));
    }
  }
  function tower(x, z, r, h, coneH = r * 2.2, flag = true) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 18), towerMat);
    m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true;
    castleGroup.add(m);
    // corbelled top ring + merlons
    batch.add(cylGeo, merlonMat, mtx(x, h + 0.3, z, r * 1.12, 0.6, r * 1.12));
    const n = Math.max(8, Math.round(r * 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      batch.add(boxGeo, merlonMat, mtx(x + Math.sin(a) * r * 1.08, h + 0.95, z + Math.cos(a) * r * 1.08, 0.7, 0.8, 0.4, 0, a, 0));
    }
    if (coneH > 0) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 1.15, coneH, 14), roofMat);
      cone.position.set(x, h + 0.6 + coneH / 2, z); cone.castShadow = true;
      castleGroup.add(cone);
      if (flag) {
        const top = h + 0.6 + coneH;
        batch.add(cylGeo, darkWoodMat, mtx(x, top + 1.1, z, 0.05, 2.2, 0.05));
        const fmat = std('#ffffff', { map: bannerTexture(PALETTE.tealDark, PALETTE.cream), side: THREE.DoubleSide });
        const f = new Flag(1.6, 1.0, fmat, 8, 2, true);
        f.mesh.position.set(x, top + 1.7, z);
        f.mesh.rotation.y = -Math.PI / 2 + 0.3;
        castleGroup.add(f.mesh);
        world.flags.push(f);
      }
    }
    // arrow slits facing the lists
    for (let i = 0; i < 3; i++) {
      batch.add(boxGeo, slitMat, mtx(x, h * (0.3 + i * 0.22), z - r * 0.99, 0.18, 0.8, 0.1));
    }
  }

  // front (gate) wall at the far end of the lists
  const CZ = 98;
  wallRun(-60, CZ, -8, CZ, 10);
  wallRun(8, CZ, 60, CZ, 10);
  // gatehouse
  {
    const gh = new THREE.Mesh(new THREE.BoxGeometry(16, 13, 6), stoneMatFor(3, 3));
    gh.position.set(0, 6.5, CZ); gh.castShadow = gh.receiveShadow = true;
    castleGroup.add(gh);
    for (let i = 0; i < 9; i++) batch.add(boxGeo, merlonMat, mtx(-7.2 + i * 1.8, 13.45, CZ, 0.9, 0.9, 6.2));
    // arch + portcullis
    const archShape = new THREE.Shape();
    archShape.moveTo(-3, 0); archShape.lineTo(-3, 4.5); archShape.absarc(0, 4.5, 3, Math.PI, 0, true); archShape.lineTo(3, 0); archShape.lineTo(-3, 0);
    const arch = new THREE.Mesh(new THREE.ShapeGeometry(archShape, 16), std('#2d2318'));
    arch.position.set(0, 0, CZ - 3.02); arch.rotation.y = Math.PI;
    castleGroup.add(arch);
    const bars = std('#4a3a28', { metalness: 0.3, roughness: 0.6 });
    for (let i = -5; i <= 5; i++) batch.add(boxGeo, bars, mtx(i * 0.52, 3.4, CZ - 3.1, 0.12, 6.8 - Math.abs(i) * 0.08, 0.12));
    for (let j = 0; j < 7; j++) batch.add(boxGeo, bars, mtx(0, 0.6 + j * 0.95, CZ - 3.12, 5.8, 0.1, 0.1));
    const archTrim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.3, 6, 20, Math.PI), merlonMat);
    archTrim.position.set(0, 4.5, CZ - 3.05); castleGroup.add(archTrim);
  }
  tower(-9.5, CZ - 1, 3.6, 17);
  tower(9.5, CZ - 1, 3.6, 17);
  tower(-34, CZ, 3.2, 14);
  tower(34, CZ, 3.2, 14);
  tower(-60, CZ, 4.2, 15);
  tower(60, CZ, 4.2, 15);
  // keep behind the gate
  {
    const keep = new THREE.Mesh(new THREE.BoxGeometry(26, 20, 16), stoneMatFor(5, 4));
    keep.position.set(0, 10, CZ + 16); keep.castShadow = true;
    castleGroup.add(keep);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(17, 11, 4), roofMat);
    roof.position.set(0, 25.5, CZ + 16); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.65);
    castleGroup.add(roof);
    tower(-13, CZ + 9, 3.2, 26, 8);
    tower(13, CZ + 9, 3.2, 26, 8);
    tower(-13, CZ + 23, 3.0, 23, 7);
    tower(13, CZ + 23, 3.0, 23, 7);
    tower(0, CZ + 26, 3.4, 30, 9);
  }
  // curtain walls down both sides and across the back
  for (const s of [-1, 1]) {
    wallRun(s * 60, CZ, s * 60, -100, 8);
    tower(s * 60, 30, 3.6, 12, 0, false);
    tower(s * 60, -35, 3.6, 12, 0, false);
    tower(s * 60, -100, 4.2, 13);
  }
  wallRun(-60, -100, -6, -100, 8);
  wallRun(6, -100, 60, -100, 8);
  tower(-6, -100, 3.2, 12);
  tower(6, -100, 3.2, 12);

  // ---------- countryside ----------
  const hillMat = std('#9a9c7c', { flatShading: true, roughness: 1 });
  const farHillMat = std('#a9ab96', { flatShading: true, roughness: 1 });
  const hills = [
    [-260, 260, 160, 60], [40, 380, 220, 85], [300, 280, 170, 55], [-380, -40, 180, 50],
    [380, -60, 170, 48], [-200, -340, 200, 60], [180, -360, 220, 70], [-120, 470, 160, 70],
  ];
  for (const [x, z, r, h] of hills) {
    const g = new THREE.ConeGeometry(r, h, 9, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > -h / 2 + 0.1 && p.getY(i) < h / 2 - 0.1) {
        p.setX(i, p.getX(i) * (0.85 + R() * 0.3)); p.setZ(i, p.getZ(i) * (0.85 + R() * 0.3));
      }
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, Math.hypot(x, z) > 400 ? farHillMat : hillMat);
    m.position.set(x, h / 2 - 2, z);
    m.scale.y = 0.75;
    scene.add(m);
  }
  // lollipop trees
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6);
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leafMat = std('#8a9a52', { flatShading: true });
  const leafMat2 = std('#a2a85e', { flatShading: true });
  const trunkMat = std('#6b4f35');
  function tree(x, z, s) {
    batch.add(trunkGeo, trunkMat, mtx(x, 2.2 * s, z, s, 4.4 * s, s));
    const lm = R() > 0.5 ? leafMat : leafMat2;
    batch.add(leafGeo, lm, mtx(x, 5.4 * s, z, 2.2 * s, 2.6 * s, 2.2 * s));
    batch.add(leafGeo, lm, mtx(x + 1.1 * s, 4.6 * s, z + 0.4 * s, 1.5 * s, 1.6 * s, 1.5 * s));
    batch.add(leafGeo, lm, mtx(x - 0.9 * s, 4.8 * s, z - 0.5 * s, 1.4 * s, 1.5 * s, 1.4 * s));
  }
  for (let i = 0; i < 140; i++) {
    const a = R() * Math.PI * 2, d = 75 + R() * 120;
    const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d;
    if (Math.abs(x) < 66 && z > -106 && z < 150) continue;
    tree(x, z, 0.9 + R() * 0.8);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) tree(s * (46 + R() * 8), -88 + i * 9 + R() * 3, 0.8 + R() * 0.3);

  // ---------- royal box: a raised, gold-trimmed canopy at the centre of the red stands ----------
  {
    const x0 = 6.5, x1 = 12.2, zc = 0, L = 9;
    const royalMat = std('#4b2a5e', { roughness: 0.85, side: THREE.DoubleSide });
    const drape = std('#ffffff', { map: stripeTexture('#4b2a5e', '#d6ae52', 14), side: THREE.DoubleSide });
    for (const zp of [zc - L / 2, zc + L / 2]) for (const xp of [x0, x1]) {
      batch.add(boxGeo, goldMat, mtx(xp, 4.5, zp, 0.28, 9, 0.28));
      batch.add(ballGeo, goldMat, mtx(xp, 9.15, zp, 1.3, 1.3, 1.3));
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1), royalMat);
    roof.position.set((x0 + x1) / 2, 10.6, zc); roof.rotation.y = Math.PI / 4;
    roof.scale.set((x1 - x0) * 0.78, 3.0, L * 0.78); roof.castShadow = true;
    scene.add(roof);
    batch.add(ballGeo, goldMat, mtx((x0 + x1) / 2, 12.2, zc, 1.6, 1.6, 1.6));
    // valance (scalloped drape) around the canopy
    const val = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.4, 0.8, L + 0.4), drape);
    val.position.set((x0 + x1) / 2, 8.75, zc); val.castShadow = true;
    scene.add(val);
    // throne dais + two thrones
    batch.add(boxGeo, std('#7a2430'), mtx(9.4, 3.05, zc, 3.6, 0.1, 6));
    for (const zt of [-0.9, 0.9]) {
      batch.add(boxGeo, goldMat, mtx(10.2, 3.6, zt, 0.7, 1.0, 0.9));
      batch.add(boxGeo, royalMat, mtx(10.5, 4.35, zt, 0.15, 1.5, 0.9));
    }
    // royal banner hanging from the valance toward the lists
    const rb = new Flag(1.6, 2.4, std('#ffffff', { map: bannerTexture('#4b2a5e', '#e1b74e'), side: THREE.DoubleSide }), 4, 10, false);
    rb.mesh.position.set(x0 - 0.25, 8.4, zc); rb.mesh.rotation.y = Math.PI / 2;
    rb.updateHanging = true;
    scene.add(rb.mesh); world.flags.push(rb);
  }

  // ---------- props at the ends of the lists ----------
  const hayMat = std('#d8b665', { roughness: 1 });
  const barrelMat = std('#7a5232');
  const hoopMat = std('#3d3a36', { metalness: 0.6, roughness: 0.5 });
  const barrelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.95, 12);
  const hoopGeo = new THREE.TorusGeometry(0.4, 0.03, 4, 16);
  for (const zEnd of [-62, 62]) {
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = sx * (6 + i * 1.3 + R() * 0.3), z = zEnd + (R() - 0.5) * 2;
        batch.add(boxGeo, hayMat, mtx(x, 0.4, z, 1.2, 0.8, 0.8, 0, R() * 0.4, 0));
        if (R() > 0.4) batch.add(boxGeo, hayMat, mtx(x + 0.2, 1.2, z, 1.2, 0.8, 0.8, 0, R() * 0.6, 0));
      }
      const bx = sx * 10, bz = zEnd + Math.sign(zEnd) * 2;
      for (let i = 0; i < 3; i++) {
        const xx = bx + i * 0.85 * sx;
        batch.add(barrelGeo, barrelMat, mtx(xx, 0.48, bz));
        batch.add(hoopGeo, hoopMat, mtx(xx, 0.2, bz, 1, 1, 1, Math.PI / 2, 0, 0));
        batch.add(hoopGeo, hoopMat, mtx(xx, 0.76, bz, 1, 1, 1, Math.PI / 2, 0, 0));
      }
      // lance rack
      const rx = sx * 5.2, rz = zEnd - Math.sign(zEnd) * 1.5;
      batch.add(boxGeo, darkWoodMat, mtx(rx, 1.0, rz, 0.15, 0.12, 2.4));
      for (let i = 0; i < 5; i++) {
        batch.add(cylGeo, i % 2 ? redMat : tealMat, mtx(rx + 0.12, 1.9, rz - 1 + i * 0.5, 0.045, 3.8, 0.045, 0, 0, sx * 0.12));
      }
    }
  }

  // ---------- grass tufts outside the dirt ----------
  const tuftGeo = new THREE.ConeGeometry(0.18, 0.5, 4, 1);
  const tuftMats = [std('#8e9b4f', { flatShading: true }), std('#a7a65a', { flatShading: true }), std('#76863f', { flatShading: true })];
  for (let i = 0; i < 1600; i++) {
    const x = (R() - 0.5) * 240, z = (R() - 0.5) * 280 + 10;
    const inDirt = Math.abs(x) < 59 && z > -96 && z < 104;
    if (inDirt && R() > 0.04) continue;
    if (inDirt && Math.abs(x) < 15) continue;
    const sc = 0.6 + R() * 1.0;
    batch.add(tuftGeo, tuftMats[i % 3], mtx(x, 0.2 * sc, z, sc, sc, sc, (R() - 0.5) * 0.4, R() * 3, (R() - 0.5) * 0.4));
  }

  // ---------- clouds ----------
  {
    const [c, g] = (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; return [cv, cv.getContext('2d')]; })();
    for (let i = 0; i < 26; i++) {
      const x = 40 + R() * 176, y = 50 + R() * 40 - Math.abs(x - 128) * 0.15, r = 18 + R() * 30;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 16; i++) {
      const a = R() * Math.PI * 2, d = 520 + R() * 220;
      const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color().setHSL(0.09, 0.4, 0.9 + R() * 0.08), transparent: true, opacity: 0.55 + R() * 0.35, depthWrite: false, fog: false });
      const sp = new THREE.Sprite(m);
      sp.position.set(Math.cos(a) * d, 110 + R() * 120, Math.sin(a) * d);
      const w = 260 + R() * 220; sp.scale.set(w, w * 0.4, 1);
      scene.add(sp);
    }
  }

  batch.build(scene);

  // floating dust motes catching the sun
  const motesGeo = new THREE.BufferGeometry();
  const mp = [];
  for (let i = 0; i < 400; i++) mp.push((R() - 0.5) * 30, R() * 8, (R() - 0.5) * 120);
  motesGeo.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  const motes = new THREE.Points(motesGeo, new THREE.PointsMaterial({
    size: 0.09, map: softDotTexture(), transparent: true, opacity: 0.55, depthWrite: false, color: '#fff3d6',
  }));
  scene.add(motes);

  world.update = (t, dt) => {
    updateCrowd(t, dt);
    for (const f of world.flags) f.update(t);
    motes.position.y = Math.sin(t * 0.2) * 0.3;
    motes.rotation.y = Math.sin(t * 0.05) * 0.02;
  };
  return world;
}
