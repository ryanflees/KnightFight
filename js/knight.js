// Procedurally-built horse + armoured knight with a procedural gallop cycle,
// couched lance, shield, impact recoil and a simple tumble simulation for unhorsing.
// Local frame: the rider faces +Z, up is +Y, the rider's LEFT is +X (shield side),
// the rider's RIGHT is -X (lance hand).
import * as THREE from 'three';
import { shieldTexture, lanceTexture, caparisonTexture } from './textures.js';
import { loft, boneGeo, steelMaterial, clothMaterial, coatMaterial, tabardTexture } from './rig.js';

export const LANCE = { back: 0.9, front: 3.55, breakAt: 1.05 };
const POLE_R = new THREE.Vector3(-0.75, -0.55, -0.45); // right elbow: out, down, back
const POLE_L = new THREE.Vector3(0.8, -0.5, -0.3);
const TAU = Math.PI * 2;

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });

function cylBetween(a, b, rTop, rBot, mat, seg = 10) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  g.translate(0, len / 2, 0);
  g.rotateX(Math.PI / 2); // +Y → +Z so lookAt works
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a);
  m.lookAt(b.clone().add(new THREE.Vector3(0, 0, 0)));
  return m;
}

function shadowAll(o) {
  o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

// Generic falling rigid body: integrates, bounces, then settles flat on the ground.
class Tumbler {
  constructor(obj, vel, ang, restY, flatAxis, yaw) {
    this.yaw = yaw;
    this.obj = obj; this.vel = vel; this.ang = ang; this.restY = restY;
    this.flatAxis = flatAxis; // local axis that should end up horizontal ... we settle 'up' to this
    this.settled = false; this.bounces = 0;
  }
  step(dt) {
    if (this.settled) return;
    const o = this.obj;
    this.vel.y -= 9.81 * dt;
    o.position.addScaledVector(this.vel, dt);
    const w = this.ang.length();
    if (w > 1e-4) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.ang.clone().divideScalar(w), w * dt);
      o.quaternion.premultiply(q);
    }
    if (o.position.y < this.restY) {
      o.position.y = this.restY;
      if (this.vel.y < 0) this.vel.y *= -0.28;
      this.vel.x *= 0.55; this.vel.z *= 0.55;
      this.ang.multiplyScalar(0.55);
      this.bounces++;
    }
    if (o.position.y <= this.restY + 0.02) {
      // ground friction + settle toward lying flat, keeping the current heading
      this.vel.x *= Math.pow(0.08, dt); this.vel.z *= Math.pow(0.08, dt);
      this.ang.multiplyScalar(Math.pow(0.02, dt));
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.flatAxis, this.yaw, 0, 'YXZ'));
      o.quaternion.slerp(target, 1 - Math.pow(0.04, dt));
      if (this.vel.lengthSq() < 0.01 && this.bounces > 1) this.settled = true;
    }
  }
}

export class Rider {
  constructor(opts) {
    this.opts = opts;
    this.root = new THREE.Group();
    this.x = 0; this.z = 0; this.facing = opts.facing; // +1 → +Z, -1 → -Z
    this.root.rotation.y = this.facing > 0 ? 0 : Math.PI;
    this.speed = 0; this.phase = Math.random(); this.lean = 0; this.recoil = 0; this.brace = 0;
    this.lanceLower = 0; // 0 = upright salute, 1 = couched
    this.lanceBroken = false; this.unhorsed = false;
    this.aimDirLocal = new THREE.Vector3(0.5, 0.05, 0.85).normalize();
    this.lanceRootQ = new THREE.Quaternion();
    this.tumblers = [];
    this.footfalls = [];
    this._prevLegPhases = [0, 0, 0, 0];
    this.build();
  }

  build() {
    const o = this.opts;
    const coat = coatMaterial(o.horseCoat, o.coatKind);
    const points = new THREE.MeshPhysicalMaterial({ color: o.pointsColor || o.horseCoat, roughness: 0.6, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color('#b0a090') });
    const hair = std(o.maneColor, { roughness: 0.85 });
    const hoofMat = std('#2b2622', { roughness: 0.55 });
    const eyeMat = std('#0d0b0a', { roughness: 0.15, metalness: 0.2 });
    const metal = steelMaterial('#c4c8ce');
    const darkMetal = steelMaterial('#7d828a', { roughness: 0.5 });
    const gold = std(o.trim, { metalness: 1, roughness: 0.35 });
    const trim = gold;
    const leather = std('#4a2e1b', { roughness: 0.7 });
    const leatherDark = std('#2c1d13', { roughness: 0.75 });
    const tabard = clothMaterial(o.tabard);
    const tabardTex = clothMaterial('#ffffff', { map: tabardTexture(o.tabard, o.charge, o.trimCloth) });
    this.mats = { metal };
    const sph = new THREE.SphereGeometry(1, 24, 16);
    const add = (parent, geo, mat, p, s, r) => {
      const m = new THREE.Mesh(geo, mat);
      if (p) m.position.set(...p); if (s) m.scale.set(...s); if (r) m.rotation.set(...r);
      parent.add(m); return m;
    };

    // ================= horse =================
    const horse = new THREE.Group();
    this.root.add(horse);
    const body = new THREE.Group(); body.position.y = 1.24; horse.add(body);
    this.horseBody = body;
    // torso: croup → barrel → withers → breast
    add(body, loft([
      { c: [0, 0.2, -1.03], rx: 0.04, rt: 0.04, rb: 0.04 },
      { c: [0, 0.14, -0.97], rx: 0.22, rt: 0.24, rb: 0.3 },
      { c: [0, 0.1, -0.84], rx: 0.34, rt: 0.33, rb: 0.38 },
      { c: [0, 0.08, -0.62], rx: 0.39, rt: 0.36, rb: 0.4 },
      { c: [0, 0.02, -0.32], rx: 0.4, rt: 0.36, rb: 0.42 },
      { c: [0, 0.0, 0.0], rx: 0.42, rt: 0.38, rb: 0.44 },
      { c: [0, 0.02, 0.3], rx: 0.4, rt: 0.4, rb: 0.43 },
      { c: [0, 0.07, 0.56], rx: 0.35, rt: 0.38, rb: 0.42 },
      { c: [0, 0.05, 0.8], rx: 0.29, rt: 0.31, rb: 0.38 },
      { c: [0, 0.0, 0.94], rx: 0.2, rt: 0.22, rb: 0.28 },
      { c: [0, -0.03, 1.01], rx: 0.07, rt: 0.08, rb: 0.1 },
    ], 32), coat);
    // neck (pivot near the withers; its +Y runs up the crest)
    const neck = new THREE.Group(); neck.position.set(0, 0.25, 0.78); body.add(neck); this.neck = neck;
    const neckSt = [
      [0.0, -0.06, 0.27, 0.26, 0.33], [0.28, 0.0, 0.2, 0.2, 0.22], [0.56, 0.03, 0.15, 0.16, 0.14], [0.84, 0.01, 0.12, 0.13, 0.12], [0.97, 0.0, 0.08, 0.08, 0.08],
    ];
    add(neck, loft(neckSt.map(([y, z, rx, rt, rb]) => ({ c: [0, y, z], rx, rt, rb })), 28), coat);
    // mane: tufts along the crest
    const tuft = new THREE.BoxGeometry(0.03, 0.13, 0.11);
    for (let i = 0; i < 11; i++) {
      const y = 0.06 + i * 0.085;
      const k = Math.min(neckSt.length - 2, Math.floor(y / 0.28));
      const f = (y - neckSt[k][0]) / (neckSt[k + 1][0] - neckSt[k][0]);
      const dorsal = neckSt[k][3] + (neckSt[k + 1][3] - neckSt[k][3]) * f;
      const zc = neckSt[k][1] + (neckSt[k + 1][1] - neckSt[k][1]) * f;
      add(neck, tuft, hair, [(i % 2 ? 0.012 : -0.012), y, zc - dorsal - 0.02], null, [0.25, (i % 2 ? 0.15 : -0.15), 0]);
    }
    // head (+Y = poll end, extends along -Y toward the muzzle; +Z = forehead)
    const head = new THREE.Group(); head.position.set(0, 0.92, 0.02); neck.add(head); this.head = head;
    add(head, loft([
      { c: [0, 0.07, 0], rx: 0.06, rt: 0.06, rb: 0.06 },
      { c: [0, 0.02, -0.01], rx: 0.105, rt: 0.09, rb: 0.15 },
      { c: [0, -0.1, -0.01], rx: 0.11, rt: 0.095, rb: 0.16 },
      { c: [0, -0.24, 0.0], rx: 0.09, rt: 0.085, rb: 0.1 },
      { c: [0, -0.4, 0.01], rx: 0.078, rt: 0.072, rb: 0.08 },
      { c: [0, -0.52, 0.0], rx: 0.08, rt: 0.068, rb: 0.075 },
      { c: [0, -0.58, -0.01], rx: 0.055, rt: 0.05, rb: 0.055 },
    ], 24), coat);
    for (const s of [1, -1]) {
      add(head, sph, eyeMat, [s * 0.098, -0.08, 0.035], [0.022, 0.026, 0.026]);
      const ear = new THREE.ConeGeometry(0.035, 0.13, 8); ear.translate(0, 0.065, 0);
      add(head, ear, coat, [s * 0.055, 0.07, -0.01], [1, 1, 0.6], [-0.25, 0, -s * 0.25]);
      add(head, sph, eyeMat, [s * 0.04, -0.57, 0.04], [0.014, 0.02, 0.012]); // nostrils
    }
    add(head, new THREE.BoxGeometry(0.03, 0.12, 0.08), hair, [0, 0.05, 0.07], null, [0.6, 0, 0]); // forelock
    // bridle: browband, noseband, cheek straps, bit rings
    add(head, new THREE.TorusGeometry(0.115, 0.012, 6, 24), leatherDark, [0, -0.02, -0.01], [1, 1, 1.25], [Math.PI / 2, 0, 0]);
    add(head, new THREE.TorusGeometry(0.088, 0.013, 6, 24), leatherDark, [0, -0.4, 0.005], [1, 1, 0.98], [Math.PI / 2, 0, 0]);
    for (const s of [1, -1]) {
      add(head, new THREE.BoxGeometry(0.012, 0.42, 0.02), leatherDark, [s * 0.1, -0.22, -0.01], null, [0, 0, -s * 0.05]);
      add(head, new THREE.TorusGeometry(0.025, 0.006, 6, 12), metal, [s * 0.085, -0.5, -0.03], null, [0, Math.PI / 2, 0]);
    }
    this.bitLocal = [new THREE.Vector3(0.085, -0.5, -0.03), new THREE.Vector3(-0.085, -0.5, -0.03)];
    // chanfron: plate over the face with a gilt spike
    const chan = new THREE.CylinderGeometry(0.118, 0.088, 0.42, 16, 1, true, -1.15, 2.3);
    add(head, chan, metal, [0, -0.2, 0.0], [1, 1, 1.02]).material = metal;
    add(head, new THREE.ConeGeometry(0.018, 0.12, 8), gold, [0, -0.06, 0.12], null, [Math.PI / 2 - 0.3, 0, 0]);
    // tail
    const tail = new THREE.Group(); tail.position.set(0, 0.2, -1.0); body.add(tail); this.tail = tail;
    add(tail, loft([
      { c: [0, 0.02, 0], rx: 0.05, rt: 0.05, rb: 0.05 },
      { c: [0, -0.16, -0.02], rx: 0.07, rt: 0.08, rb: 0.07 },
      { c: [0, -0.45, -0.05], rx: 0.095, rt: 0.1, rb: 0.08 },
      { c: [0, -0.72, -0.03], rx: 0.07, rt: 0.07, rb: 0.06 },
      { c: [0, -0.86, 0.0], rx: 0.015, rt: 0.015, rb: 0.015 },
    ], 14), hair, null, null, [0.35, 0, 0]);
    // legs: [x, y, z, isFront, gait offset]
    this.legs = [];
    const legDefs = [[0.2, -0.2, 0.6, true, 0.5], [-0.2, -0.2, 0.6, true, 0.62], [0.21, -0.12, -0.7, false, 0.0], [-0.21, -0.12, -0.7, false, 0.12]];
    const frontUpper = loft([
      { c: [0, 0.06, 0], rx: 0.11, rt: 0.14, rb: 0.12 }, { c: [0, -0.22, 0.01], rx: 0.085, rt: 0.1, rb: 0.08 }, { c: [0, -0.48, 0], rx: 0.055, rt: 0.06, rb: 0.06 },
    ], 14, [true, true]);
    const hindUpper = loft([
      { c: [0, 0.1, 0], rx: 0.13, rt: 0.17, rb: 0.2 }, { c: [0, -0.24, -0.02], rx: 0.09, rt: 0.1, rb: 0.12 }, { c: [0, -0.52, -0.03], rx: 0.055, rt: 0.06, rb: 0.08 },
    ], 14, [true, true]);
    const cannon = loft([
      { c: [0, 0, 0], rx: 0.052, rt: 0.055, rb: 0.065 }, { c: [0, -0.18, 0], rx: 0.042, rt: 0.045, rb: 0.055 }, { c: [0, -0.36, 0], rx: 0.048, rt: 0.05, rb: 0.06 },
    ], 12, [true, true]);
    const pastern = new THREE.CylinderGeometry(0.042, 0.05, 0.11, 12); pastern.translate(0, -0.055, 0.015);
    const hoofG = new THREE.CylinderGeometry(0.058, 0.074, 0.08, 14); hoofG.translate(0, -0.15, 0.025);
    const joint = new THREE.SphereGeometry(1, 14, 10);
    for (const [x, y, z, front, off] of legDefs) {
      const hip = new THREE.Group(); hip.position.set(x, y, z); body.add(hip);
      add(hip, front ? frontUpper : hindUpper, coat);
      const knee = new THREE.Group(); knee.position.set(0, front ? -0.48 : -0.52, front ? 0 : -0.03); hip.add(knee);
      add(knee, joint, front ? coat : coat, null, [0.06, 0.065, front ? 0.068 : 0.085]);
      add(knee, cannon, points);
      const hoof = new THREE.Group(); hoof.position.y = -0.36; knee.add(hoof);
      add(hoof, joint, points, null, [0.055, 0.06, 0.065]);
      add(hoof, pastern, points);
      add(hoof, hoofG, hoofMat);
      this.legs.push({ hip, knee, front, off, hoof });
    }
    // --- tack: saddle cloth in livery, jousting saddle, girth, breast strap
    const capTex = caparisonTexture(o.tabard, o.charge, o.trimCloth); capTex.repeat.set(1.5, 1);
    const clothG = new THREE.CylinderGeometry(1, 1, 1.0, 40, 1, true, Math.PI - 1.95, 3.9); clothG.rotateX(Math.PI / 2);
    // hang the cloth: push the lower edges outward & down a touch
    { const p = clothG.attributes.position; for (let i = 0; i < p.count; i++) { if (p.getY(i) < 0) { p.setX(i, p.getX(i) * 1.05); } } clothG.computeVertexNormals(); }
    this.caparison = add(body, clothG, clothMaterial('#ffffff', { map: capTex }), [0, 0.0, -0.08], [0.455, 0.425, 1]);
    // saddle
    add(body, loft([
      { c: [0, 0.4, -0.35], rx: 0.2, rt: 0.06, rb: 0.03 }, { c: [0, 0.38, -0.05], rx: 0.22, rt: 0.05, rb: 0.03 }, { c: [0, 0.41, 0.25], rx: 0.18, rt: 0.06, rb: 0.03 },
    ], 16), leather);
    add(body, new THREE.CylinderGeometry(0.2, 0.22, 0.42, 20, 1, true, Math.PI * 0.5, Math.PI), leather, [0, 0.62, -0.28], [1, 1, 0.5]); // high cantle
    add(body, new THREE.BoxGeometry(0.36, 0.3, 0.06), leather, [0, 0.56, 0.27], null, [0.25, 0, 0]); // pommel plate
    add(body, new THREE.TorusGeometry(0.2, 0.015, 6, 20, Math.PI), gold, [0, 0.83, -0.3], [1, 1, 0.5], [Math.PI / 2, 0, Math.PI]);
    add(body, new THREE.TorusGeometry(1, 0.03, 6, 40), leatherDark, [0, 0.0, 0.12], [0.43, 0.45, 1], [0, Math.PI / 2, 0]); // girth
    add(body, new THREE.TorusGeometry(1, 0.025, 6, 40, Math.PI * 1.2), leatherDark, [0, 0.0, 0.62], [0.36, 0.3, 0.5], [Math.PI / 2 + 0.35, 0, Math.PI * 0.6 + Math.PI]); // breast strap
    // stirrups
    this.stirrups = [];
    for (const s of [1, -1]) {
      add(body, new THREE.BoxGeometry(0.012, 0.6, 0.04), leatherDark, [s * 0.4, 0.16, 0.18], null, [0, 0, s * 0.08]);
      add(body, new THREE.TorusGeometry(0.06, 0.011, 6, 16), metal, [s * 0.43, -0.17, 0.2], [1, 1.2, 1], [0, Math.PI / 2, 0]);
    }
    // reins (updated every frame from the bit to the left hand)
    const reinGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    this.reins = new THREE.Line(reinGeo, new THREE.LineBasicMaterial({ color: '#2a1a10' }));
    this.reins.frustumCulled = false;
    body.add(this.reins);

    // ================= knight =================
    const knight = new THREE.Group(); knight.position.set(0, 0.52, -0.05); body.add(knight);
    this.knight = knight;
    const torso = new THREE.Group(); knight.add(torso); this.torso = torso;
    // legs: cuisse, poleyn, greave, sabaton
    for (const s of [1, -1]) {
      const hipP = new THREE.Vector3(s * 0.14, 0.03, 0.04);
      const kneeP = new THREE.Vector3(s * 0.34, -0.2, 0.38);
      const ankle = new THREE.Vector3(s * 0.4, -0.66, 0.24);
      const place = (geo, a, b, mat) => {
        const m = new THREE.Mesh(geo, mat); const v = b.clone().sub(a);
        m.position.copy(a); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize()); m.scale.z = v.length();
        knight.add(m); return m;
      };
      place(boneGeo(0.1, 0.082), hipP, kneeP, metal);
      place(boneGeo(0.068, 0.05), kneeP, ankle, metal);
      add(knight, sph, metal, kneeP.toArray(), [0.085, 0.085, 0.09]);
      add(knight, new THREE.CylinderGeometry(0.07, 0.07, 0.012, 16), metal, [kneeP.x + s * 0.06, kneeP.y, kneeP.z], null, [0, 0, Math.PI / 2]); // knee wing
      const sab = new THREE.ConeGeometry(0.052, 0.28, 10); sab.rotateX(Math.PI / 2); sab.translate(0, 0, 0.1);
      add(knight, sab, darkMetal, [ankle.x, ankle.y - 0.04, ankle.z], [1, 0.6, 1]);
    }
    // fauld lames + tassets
    for (let i = 0; i < 3; i++) {
      add(torso, new THREE.CylinderGeometry(0.2 + i * 0.018, 0.215 + i * 0.018, 0.075, 22, 1, true), metal, [0, 0.06 - i * 0.065, 0.005], [1, 1, 0.82]);
    }
    for (const s of [1, -1]) {
      const tas = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 12, 1, true, -0.5, 1.0);
      add(torso, tas, metal, [s * 0.08, -0.13, 0.02], [0.55, 1, 1], [0.45, s * 0.35, 0]);
    }
    // surcoat skirt in livery
    const skirt = new THREE.CylinderGeometry(0.27, 0.4, 0.4, 24, 1, true);
    add(torso, skirt, tabard, [0, -0.1, -0.01], [1, 1, 0.92]);
    // cuirass
    const cuiPts = [[0.16, 0.0], [0.19, 0.07], [0.205, 0.17], [0.24, 0.3], [0.262, 0.42], [0.255, 0.52], [0.215, 0.61], [0.14, 0.67], [0.1, 0.7]].map(([r, y]) => new THREE.Vector2(r, y));
    add(torso, new THREE.LatheGeometry(cuiPts, 28), metal, [0, 0.04, 0.0], [1.04, 1, 0.82]);
    add(torso, new THREE.TorusGeometry(0.105, 0.014, 6, 20), gold, [0, 0.735, 0.0], [1, 0.82, 1], [Math.PI / 2, 0, 0]); // neck roll
    add(torso, new THREE.BoxGeometry(0.014, 0.38, 0.03), metal, [0, 0.42, 0.205], null, [-0.15, 0, 0]); // keel
    // gorget
    add(torso, new THREE.CylinderGeometry(0.12, 0.16, 0.09, 18), metal, [0, 0.76, 0.0]);
    add(torso, new THREE.CylinderGeometry(0.105, 0.125, 0.07, 18), metal, [0, 0.82, 0.005]);
    // pauldrons: domed caps with overlapping lames
    for (const s of [1, -1]) {
      const cap = new THREE.SphereGeometry(0.16, 20, 12, 0, TAU, 0, 1.75);
      add(torso, cap, metal, [s * 0.27, 0.6, 0.0], [1.05, 0.85, 1.15], [0, 0, -s * 0.35]);
      for (let i = 0; i < 3; i++) {
        const lame = new THREE.CylinderGeometry(0.13 - i * 0.012, 0.14 - i * 0.012, 0.055, 18, 1, true);
        add(torso, lame, metal, [s * (0.33 + i * 0.012), 0.5 - i * 0.05, 0], [1, 1, 1.05], [0, 0, -s * 0.5]);
      }
    }
    // heraldic tabard/cape on the back
    const capeGeo = new THREE.PlaneGeometry(0.58, 1.0, 5, 8); capeGeo.translate(0, -0.5, 0);
    this.cape = add(torso, capeGeo, tabardTex, [0, 0.74, -0.19], null, [0.16, Math.PI, 0]);
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.capeSign = -1; // plane faces backwards after the PI flip
    // frog-mouth jousting helm (Stechhelm)
    const helm = new THREE.Group(); helm.position.set(0, 0.9, 0.01); torso.add(helm); this.helm = helm;
    add(helm, sph, std('#050505', { roughness: 1 }), [0, 0.02, 0.0], [0.14, 0.14, 0.15]); // dark interior seen through the slit
    add(helm, new THREE.SphereGeometry(0.158, 26, 16, 0, TAU, 0, Math.PI * 0.52), metal, [0, 0.055, -0.01], [1, 1.12, 1.16]);
    const bevorPts = [[0.12, -0.21], [0.15, -0.14], [0.168, -0.06], [0.176, 0.0], [0.17, 0.03]].map(([r, y]) => new THREE.Vector2(r, y));
    add(helm, new THREE.LatheGeometry(bevorPts, 28), metal, [0, 0, 0.03], [0.98, 1, 1.22]);
    add(helm, new THREE.BoxGeometry(0.012, 0.03, 0.34), metal, [0, 0.235, -0.01]); // comb
    for (let i = 0; i < 6; i++) { // rivets
      const a = -0.9 + i * 0.36;
      add(helm, sph, gold, [Math.sin(a) * 0.17, 0.012, 0.03 + Math.cos(a) * 0.205], [0.009, 0.009, 0.009]);
    }
    for (let i = 0; i < 4; i++) add(helm, new THREE.BoxGeometry(0.004, 0.035, 0.018), std('#050505'), [-0.15, -0.08 - i * 0.025, 0.1], null, [0, 0.6, 0]); // breaths
    // feather crest
    const feather = new THREE.Shape();
    feather.moveTo(0, 0); feather.quadraticCurveTo(0.05, 0.18, 0.012, 0.44); feather.quadraticCurveTo(-0.035, 0.2, 0, 0);
    const fGeo = new THREE.ShapeGeometry(feather, 8);
    { const p = fGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -y * y * 0.9); } fGeo.computeVertexNormals(); }
    const plumeMat = clothMaterial(o.plume, { roughness: 1 });
    const plume2 = clothMaterial('#efe7d4', { roughness: 1 });
    add(helm, new THREE.CylinderGeometry(0.018, 0.024, 0.06, 10), gold, [0, 0.23, -0.06]);
    for (let i = 0; i < 9; i++) {
      add(helm, fGeo, i % 3 === 1 ? plume2 : plumeMat, [0, 0.25, -0.06], [1, 1, 1], [-0.35 - (i % 3) * 0.32, (i - 4) * 0.13, (i - 4) * 0.05]);
    }

    // arms — both solved with two-bone IK every frame
    this.shoulderR = new THREE.Vector3(-0.3, 0.6, 0);
    this.shoulderL = new THREE.Vector3(0.3, 0.6, 0);
    this.handBase = new THREE.Vector3(-0.3, 0.26, 0.3);
    this.handLBase = new THREE.Vector3(0.32, 0.4, 0.22);
    this.upperLen = 0.33; this.foreLen = 0.32;
    const mkArm = () => {
      const a = {
        upper: add(torso, boneGeo(0.072, 0.064), metal),
        fore: add(torso, boneGeo(0.062, 0.052), metal),
        couter: add(torso, sph, metal, null, [0.078, 0.078, 0.078]),
        wing: add(torso, new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16), metal),
        hand: new THREE.Group(),
      };
      torso.add(a.hand);
      add(a.hand, new THREE.CylinderGeometry(0.055, 0.075, 0.09, 14, 1, true), metal, [0, 0, -0.03], null, [Math.PI / 2, 0, 0]); // flared cuff
      add(a.hand, sph, darkMetal, [0, 0, 0.03], [0.055, 0.045, 0.075]);
      return a;
    };
    this.armR = mkArm(); this.armL = mkArm();
    // compatibility handles
    this.upperArm = this.armR.upper; this.foreArm = this.armR.fore; this.couter = this.armR.couter; this.gauntlet = this.armR.hand;
    const handR = this.handBase.clone();
    // shield on the left forearm
    const shield = new THREE.Group(); shield.position.set(0.42, 0.44, 0.18); torso.add(shield); this.shield = shield;
    const sh = new THREE.Shape();
    sh.moveTo(-0.26, 0.32); sh.lineTo(0.26, 0.32); sh.lineTo(0.26, 0.02);
    sh.quadraticCurveTo(0.24, -0.26, 0, -0.42); sh.quadraticCurveTo(-0.24, -0.26, -0.26, 0.02); sh.closePath();
    const shGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 10 });
    // remap UVs to the shield bounds so the heraldry fills the face
    const uv = shGeo.attributes.uv, pos = shGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 0.27) / 0.54, (pos.getY(i) + 0.43) / 0.76);
    const shMats = [std('#ffffff', { map: shieldTexture(o.shieldKind), roughness: 0.6 }), trim];
    const shMesh = new THREE.Mesh(shGeo, shMats);
    shield.add(shMesh);
    shield.rotation.set(-0.1, 0.95, 0.12);
    this.shieldMesh = shMesh;

    // lance: pivot at the right hand, shaft along +Z
    const lancePivot = new THREE.Group(); lancePivot.position.copy(handR); torso.add(lancePivot);
    this.lancePivot = lancePivot;
    const lance = new THREE.Group(); lancePivot.add(lance); this.lance = lance;
    const lTex = lanceTexture(o.lanceA, o.lanceB);
    const lMat = std('#ffffff', { map: lTex, roughness: 0.6 });
    const shaft = (z0, z1, r0, r1, mat) => {
      const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, 10); g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2);
      const m = new THREE.Mesh(g, mat); lance.add(m); return m;
    };
    shaft(-LANCE.back, -0.1, 0.035, 0.045, lMat);
    shaft(-0.1, LANCE.breakAt, 0.05, 0.062, lMat);
    const vamp = new THREE.ConeGeometry(0.17, 0.32, 14, 1, true); vamp.rotateX(Math.PI / 2); vamp.translate(0, 0, 0.12);
    const vm = new THREE.Mesh(vamp, std(o.trim, { metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide })); lance.add(vm);
    // long, breakable fore-section
    const fore = new THREE.Group(); lance.add(fore); this.lanceFore = fore;
    {
      const g = new THREE.CylinderGeometry(0.028, 0.06, LANCE.front - LANCE.breakAt, 10);
      g.rotateX(Math.PI / 2); g.translate(0, 0, (LANCE.front + LANCE.breakAt) / 2);
      fore.add(new THREE.Mesh(g, lMat));
      const tip = new THREE.ConeGeometry(0.045, 0.14, 6); tip.rotateX(Math.PI / 2); tip.translate(0, 0, LANCE.front + 0.05);
      fore.add(new THREE.Mesh(tip, darkMetal));
    }
    // jagged stump shown once the lance shatters
    const stump = new THREE.Group(); stump.visible = false; lance.add(stump); this.lanceStump = stump;
    for (let i = 0; i < 5; i++) {
      const g = new THREE.ConeGeometry(0.022, 0.18 + Math.random() * 0.2, 4);
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, std('#d9c49a'));
      const a = (i / 5) * TAU;
      m.position.set(Math.cos(a) * 0.03, Math.sin(a) * 0.03, LANCE.breakAt + 0.06);
      m.rotation.set(Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0);
      stump.add(m);
    }
    shadowAll(this.root);
    this.lanceTipLocal = new THREE.Vector3(0, 0, LANCE.front);
  }

  get pos() { return this.root.position; }

  place(x, z) {
    this.x = x; this.z = z;
    this.root.position.set(x, 0, z);
  }

  reset(x, z) {
    // restore anything that was detached by a fall
    for (const t of this.tumblers) t.obj.removeFromParent();
    this.tumblers = [];
    if (this.knight.parent !== this.horseBody) {
      this.horseBody.add(this.knight);
    }
    this.knight.position.set(0, 0.52, -0.05); this.knight.quaternion.identity();
    if (this.lance.parent !== this.lancePivot) this.lancePivot.add(this.lance);
    this.lance.position.set(0, 0, 0); this.lance.quaternion.identity();
    this.setLanceBroken(false);
    this.unhorsed = false;
    this.speed = 0; this.recoil = 0; this.lean = 0; this.brace = 0; this.lanceLower = 0;
    this.place(x, z);
  }

  setLanceBroken(b) {
    this.lanceBroken = b;
    this.lanceFore.visible = !b;
    this.lanceStump.visible = b;
  }

  // Desired lance direction expressed in the rider's root frame.
  setAimDirection(dirLocal) { this.aimDirLocal.copy(dirLocal).normalize(); }

  handWorld(out = new THREE.Vector3()) {
    this.lancePivot.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.lancePivot.matrixWorld);
  }
  lanceTipWorld(out = new THREE.Vector3()) {
    const tipZ = this.lanceBroken ? LANCE.breakAt : LANCE.front;
    this.lance.updateWorldMatrix(true, false);
    return out.set(0, 0, tipZ).applyMatrix4(this.lance.matrixWorld);
  }

  // Advances the procedural animation. `dt` is in sim-seconds.
  animate(dt) {
    const sp = this.speed;
    const freq = sp < 0.2 ? 0 : 0.9 + sp * 0.095; // strides per second
    this.phase = (this.phase + freq * dt) % 1;
    this.footfalls.length = 0;
    this.pose(dt);
  }

  // Sets every joint from the current state values (shared by live play and replay).
  pose(dt = 0) {
    const a = Math.min(1, this.speed / 7);
    const ph = this.phase;
    this.legs.forEach((L, i) => {
      const p = (ph + L.off) % 1;
      const s = Math.sin(p * TAU);
      L.hip.rotation.x = a * 0.62 * s;
      const bend = Math.max(0, Math.sin(p * TAU + 1.3));
      L.knee.rotation.x = (L.front ? 1 : -1) * a * 1.1 * bend * bend + (L.front ? 0.05 : -0.05);
      L.hoof.rotation.x = (L.front ? 0.6 : -0.3) * a * bend;
      // footfall detection for sound + dust
      const prev = this._prevLegPhases[i];
      if (a > 0.2 && prev < 0.3 && p >= 0.3) this.footfalls.push(i);
      this._prevLegPhases[i] = p;
    });
    const bob = Math.sin(ph * TAU) * 0.075 * a;
    this.horseBody.position.y = 1.24 + bob;
    this.horseBody.rotation.x = Math.sin(ph * TAU + 1.6) * 0.06 * a - this.recoil * 0.05;
    this.neck.rotation.x = 0.42 + Math.sin(ph * TAU + 0.8) * 0.12 * a + a * 0.12;
    this.head.rotation.x = -1.42 + a * 0.05;
    this.tail.rotation.x = 0.3 + a * 0.6 + Math.sin(ph * TAU * 2) * 0.08 * a;
    this.tail.rotation.z = Math.sin(ph * TAU) * 0.1;
    // rider absorbs the bob and leans into the charge
    if (this.knight.parent === this.horseBody) {
      this.knight.position.y = 0.52 - bob * 0.45;
      this.torso.rotation.x = this.lean * 0.32 + a * 0.05 - this.recoil * 0.55 + Math.sin(ph * TAU + 2.2) * 0.03 * a;
        this.torso.rotation.y = this.recoil * 0.4;
    }
    // shield tucks in when braced
    this.shield.rotation.y = 0.95 - this.brace * 0.2;
    // cape flutter
    const cp = this.cape.geometry.attributes.position.array, cb = this.capeBase;
    const t = performance.now() / 1000;
    for (let i = 0; i < cp.length; i += 3) {
      const k = -cb[i + 1];
      cp[i + 2] = cb[i + 2] - this.capeSign * k * k * (0.25 + a * 0.6) + Math.sin(t * 9 + cb[i] * 4 + k * 5) * 0.04 * k * (0.3 + a);
    }
    this.cape.geometry.attributes.position.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();
    this.orientLance();
    this.updateReins();
  }

  // Reins run from the bit rings to the left gauntlet (hidden once the rider is down).
  updateReins() {
    const attached = this.knight.parent === this.horseBody && this._handL;
    this.reins.visible = !!attached;
    if (!attached) return;
    const body = this.horseBody;
    body.updateWorldMatrix(true, true);
    const toBody = (obj, v) => body.worldToLocal(obj.localToWorld(v.clone()));
    const p = this.reins.geometry.attributes.position;
    const b0 = toBody(this.head, this.bitLocal[0]), b1 = toBody(this.head, this.bitLocal[1]);
    const h = toBody(this.torso, this._handL);
    p.setXYZ(0, b0.x, b0.y, b0.z); p.setXYZ(1, h.x, h.y, h.z); p.setXYZ(2, b1.x, b1.y, b1.z);
    p.needsUpdate = true;
  }

  orientLance() {
    if (this.lance.parent !== this.lancePivot) return;
    // raised (upright) vs. couched (aimed) direction, both in the root frame
    const up = new THREE.Vector3(-0.12, 1, 0.35).normalize();
    const dir = up.lerp(this.aimDirLocal, this.lanceLower).normalize();
    // the grip shifts with the aim: across the body when aiming left, up/down with pitch
    const hand = this.handBase.clone();
    hand.x += THREE.MathUtils.clamp(dir.x * 0.16, -0.06, 0.13) * this.lanceLower;
    hand.y += THREE.MathUtils.clamp(dir.y * 0.3, -0.1, 0.12) + (1 - this.lanceLower) * 0.08;
    hand.z += (1 - this.lanceLower) * -0.05 + this.recoil * -0.08;
    this.lancePivot.position.copy(hand);
    this.solveArm(this.armR, this.shoulderR, hand, POLE_R);
    const handL = this.handLBase.clone();
    handL.x -= this.brace * 0.04; handL.z -= this.recoil * 0.06;
    this.solveArm(this.armL, this.shoulderL, handL, POLE_L);
    this._handL = handL;

    const qRoot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    // recoil kicks the tip up
    if (this.recoil > 0) qRoot.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.recoil * 0.4));
    this.lanceRootQ.copy(qRoot);
    // convert root-frame orientation into the pivot's parent frame
    this.root.updateWorldMatrix(true, true);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const parentQ = this.lancePivot.parent.getWorldQuaternion(new THREE.Quaternion());
    this.lancePivot.quaternion.copy(parentQ.invert().multiply(rootQ).multiply(qRoot));
  }

  // Analytic two-bone IK (law of cosines) in the torso frame; `pole` picks where the elbow points.
  solveArm(arm, S, hand, pole0) {
    const a = this.upperLen, b = this.foreLen;
    const axis = hand.clone().sub(S);
    const d = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.02, a + b - 0.002);
    axis.normalize();
    const H = S.clone().addScaledVector(axis, d);
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const pole = pole0.clone();
    const perp = pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const E = S.clone().addScaledVector(axis, a * cosA).addScaledVector(perp, a * Math.sqrt(1 - cosA * cosA));
    const Z = new THREE.Vector3(0, 0, 1);
    const place = (mesh, from, to) => {
      const v = to.clone().sub(from);
      mesh.position.copy(from);
      mesh.quaternion.setFromUnitVectors(Z, v.clone().normalize());
      mesh.scale.set(1, 1, v.length());
    };
    place(arm.upper, S, E);
    place(arm.fore, E, H);
    arm.couter.position.copy(E);
    // couter wing faces outward along the elbow's bend direction
    arm.wing.position.copy(E).addScaledVector(perp, 0.05);
    arm.wing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), perp);
    arm.hand.position.copy(H);
    arm.hand.quaternion.setFromUnitVectors(Z, H.clone().sub(E).normalize());
  }

  // Knock the knight out of the saddle. `impulse` is a world-space velocity.
  unhorse(scene, impulse) {
    if (this.unhorsed) return;
    this.unhorsed = true;
    const k = this.knight;
    scene.attach(k);
    const v = new THREE.Vector3(this.facing * 0, 0, this.speed * this.facing).add(impulse);
    const spin = new THREE.Vector3(-this.facing * (4 + Math.random() * 2), (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
    const yaw = this.facing > 0 ? 0 : Math.PI;
    this.tumblers.push(new Tumbler(k, v, spin, 0.32, -Math.PI / 2, yaw + (Math.random() - 0.5) * 0.8));
    // the lance flies free
    scene.attach(this.lance);
    this.tumblers.push(new Tumbler(this.lance, v.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, 2, 0)),
      new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6), 0.06, 0, yaw + 1.2));
  }

  stepTumblers(dt) { for (const tb of this.tumblers) tb.step(dt); }

  // ---------- replay support ----------
  snapshot() {
    const s = {
      x: this.x, z: this.z, speed: this.speed, phase: this.phase, lean: this.lean, recoil: this.recoil,
      brace: this.brace, lower: this.lanceLower, broken: this.lanceBroken, unhorsed: this.unhorsed,
      aim: this.aimDirLocal.toArray(),
    };
    if (this.unhorsed) {
      s.kp = this.knight.position.toArray(); s.kq = this.knight.quaternion.toArray();
      s.lp = this.lance.position.toArray(); s.lq = this.lance.quaternion.toArray();
    }
    return s;
  }

  applySnapshot(s, scene) {
    this.place(s.x, s.z);
    this.speed = s.speed; this.phase = s.phase; this.lean = s.lean; this.recoil = s.recoil;
    this.brace = s.brace; this.lanceLower = s.lower; this.aimDirLocal.fromArray(s.aim);
    this.setLanceBroken(s.broken);
    if (s.unhorsed) {
      if (this.knight.parent !== scene) scene.add(this.knight);
      if (this.lance.parent !== scene) scene.add(this.lance);
      this.knight.position.fromArray(s.kp); this.knight.quaternion.fromArray(s.kq);
      this.lance.position.fromArray(s.lp); this.lance.quaternion.fromArray(s.lq);
      this.unhorsed = true;
    } else {
      if (this.knight.parent !== this.horseBody) { this.horseBody.add(this.knight); this.knight.quaternion.identity(); this.knight.position.set(0, 0.52, -0.05); }
      if (this.lance.parent !== this.lancePivot) { this.lancePivot.add(this.lance); this.lance.position.set(0, 0, 0); this.lance.quaternion.identity(); }
      this.unhorsed = false;
    }
    this.tumblers = [];
    const saved = this._prevLegPhases.slice();
    this.pose(0);
    this._prevLegPhases = saved;
  }
}
