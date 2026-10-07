// Procedurally-built horse + armoured knight with a procedural gallop cycle,
// couched lance, shield, impact recoil and a simple tumble simulation for unhorsing.
// Local frame: the rider faces +Z, up is +Y, the rider's LEFT is +X (shield side),
// the rider's RIGHT is -X (lance hand).
import * as THREE from 'three';
import { shieldTexture, lanceTexture, caparisonTexture } from './textures.js';

export const LANCE = { back: 0.9, front: 3.55, breakAt: 1.05 };
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
    const coat = std(o.horseCoat, { roughness: 0.7 });
    const dark = std(o.maneColor, { roughness: 0.9 });
    const hoofMat = std('#2a2420');
    const metal = std('#c7cbd1', { metalness: 0.92, roughness: 0.24, envMapIntensity: 1.2 });
    const darkMetal = std('#6d7178', { metalness: 0.85, roughness: 0.35 });
    const tabard = std(o.tabard, { roughness: 0.92, side: THREE.DoubleSide });
    const trim = std(o.trim, { metalness: 0.6, roughness: 0.4 });
    const leather = std('#5b3a22', { roughness: 0.8 });
    this.mats = { metal };

    // ---------------- horse ----------------
    const horse = new THREE.Group();
    this.root.add(horse);
    const body = new THREE.Group(); body.position.y = 1.24; horse.add(body);
    this.horseBody = body;
    const sph = new THREE.SphereGeometry(1, 20, 14);
    const add = (parent, geo, mat, p, s, r) => {
      const m = new THREE.Mesh(geo, mat);
      if (p) m.position.set(...p); if (s) m.scale.set(...s); if (r) m.rotation.set(...r);
      parent.add(m); return m;
    };
    add(body, sph, coat, [0, 0, 0], [0.4, 0.43, 0.9]);
    add(body, sph, coat, [0, 0.04, 0.58], [0.39, 0.44, 0.45]);
    add(body, sph, coat, [0, 0.03, -0.6], [0.41, 0.44, 0.5]);
    // neck + head
    const neck = new THREE.Group(); neck.position.set(0, 0.26, 0.86); body.add(neck); this.neck = neck;
    const neckGeo = new THREE.CylinderGeometry(0.13, 0.25, 1.0, 12); neckGeo.translate(0, 0.48, 0);
    add(neck, neckGeo, coat);
    const mane = new THREE.BoxGeometry(0.06, 0.9, 0.12); mane.translate(0, 0.5, -0.15);
    add(neck, mane, dark);
    const head = new THREE.Group(); head.position.set(0, 0.96, 0.02); neck.add(head); this.head = head;
    const headGeo = new THREE.CylinderGeometry(0.115, 0.07, 0.56, 10); headGeo.translate(0, -0.28, 0);
    add(head, headGeo, coat, null, [0.95, 1, 1.25]);
    add(head, sph, coat, [0, -0.03, -0.02], [0.13, 0.13, 0.15]);
    add(head, sph, coat, [0, -0.52, 0.0], [0.085, 0.09, 0.1]);
    add(head, sph, dark, [0, -0.57, 0.02], [0.065, 0.045, 0.08]);
    const earGeo = new THREE.ConeGeometry(0.04, 0.14, 5);
    add(head, earGeo, coat, [0.07, 0.08, -0.05], null, [-0.3, 0, 0.2]);
    add(head, earGeo, coat, [-0.07, 0.08, -0.05], null, [-0.3, 0, -0.2]);
    // chanfron (head armour) with a spike plume
    const chanGeo = new THREE.BoxGeometry(0.16, 0.5, 0.06); chanGeo.translate(0, -0.28, 0);
    add(head, chanGeo, metal, [0, 0, 0.13], null, [0.05, 0, 0]);
    add(head, new THREE.ConeGeometry(0.03, 0.18, 6), trim, [0, 0.03, 0.15], null, [0.5, 0, 0]);
    // tail
    const tail = new THREE.Group(); tail.position.set(0, 0.2, -1.05); body.add(tail); this.tail = tail;
    const tailGeo = new THREE.ConeGeometry(0.12, 0.85, 8); tailGeo.translate(0, -0.42, 0);
    add(tail, tailGeo, dark, null, null, [0.35, 0, 0]);
    // legs: [x, z, isFront, gait offset]
    this.legs = [];
    const legDefs = [[0.2, 0.62, true, 0.5], [-0.2, 0.62, true, 0.62], [0.2, -0.64, false, 0.0], [-0.2, -0.64, false, 0.12]];
    const upGeo = new THREE.CylinderGeometry(0.13, 0.08, 0.52, 9); upGeo.translate(0, -0.26, 0);
    const loGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.42, 8); loGeo.translate(0, -0.21, 0);
    const hoofGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.1, 8); hoofGeo.translate(0, -0.045, 0);
    for (const [x, z, front, off] of legDefs) {
      const hip = new THREE.Group(); hip.position.set(x, -0.18, z); body.add(hip);
      add(hip, upGeo, coat);
      const knee = new THREE.Group(); knee.position.y = -0.52; hip.add(knee);
      add(knee, loGeo, coat);
      const hoof = new THREE.Group(); hoof.position.y = -0.42; knee.add(hoof);
      add(hoof, hoofGeo, hoofMat);
      this.legs.push({ hip, knee, front, off, hoof });
    }
    // caparison (trapper) — a heraldic cloth skirt over the barrel
    const capTex = caparisonTexture(o.tabard, o.charge, o.trimCloth);
    capTex.repeat.set(2, 1);
    const capMat = std('#ffffff', { map: capTex, side: THREE.DoubleSide, roughness: 0.95 });
    const capGeo = new THREE.CylinderGeometry(1, 1.22, 0.78, 72, 4, true);
    // slight flare + hem wave so it reads as cloth rather than a drum
    {
      const p = capGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
        const k = (0.39 - y) / 0.78;
        const wav = 1 + Math.sin(a * 22) * 0.035 * k * k + Math.sin(a * 5) * 0.02 * k;
        p.setX(i, p.getX(i) * wav); p.setZ(i, p.getZ(i) * wav);
        if (y < -0.38) p.setY(i, y + (Math.round((a / TAU) * 72) % 2 ? 0.07 : 0));
      }
      capGeo.computeVertexNormals();
    }
    const cap = add(body, capGeo, capMat, [0, -0.14, -0.05], [0.47, 1, 1.2]);
    this.caparison = cap;
    // domed top over the back
    const domeGeo = new THREE.SphereGeometry(1, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    add(body, domeGeo, std(o.tabard, { roughness: 0.95 }), [0, 0.25, -0.05], [0.47, 0.25, 1.2]);
    add(body, new THREE.TorusGeometry(1, 0.035, 6, 40), std(o.trimCloth, { metalness: 0.4, roughness: 0.5 }), [0, 0.26, -0.05], [0.47, 1.2, 1], [Math.PI / 2, 0, 0]);
    // crinet (neck cloth) in the same livery
    const crin = new THREE.CylinderGeometry(0.15, 0.27, 0.75, 14, 1, true); crin.translate(0, 0.34, 0);
    add(neck, crin, std(o.tabard, { roughness: 0.95, side: THREE.DoubleSide }), [0, 0.02, -0.01], [1.06, 1, 1.08]);
    // saddle
    add(body, new THREE.BoxGeometry(0.46, 0.12, 0.6), leather, [0, 0.47, -0.05]);
    add(body, new THREE.BoxGeometry(0.44, 0.38, 0.08), leather, [0, 0.6, -0.36], null, [-0.15, 0, 0]);
    add(body, new THREE.BoxGeometry(0.4, 0.22, 0.08), leather, [0, 0.55, 0.24], null, [0.2, 0, 0]);

    // ---------------- knight ----------------
    const knight = new THREE.Group(); knight.position.set(0, 0.52, -0.05); body.add(knight);
    this.knight = knight;
    const torso = new THREE.Group(); knight.add(torso); this.torso = torso;
    // armoured thighs & greaves straddling the horse
    for (const s of [1, -1]) {
      const hip = new THREE.Vector3(s * 0.15, 0.05, 0);
      const knee = new THREE.Vector3(s * 0.36, -0.2, 0.38);
      const foot = new THREE.Vector3(s * 0.4, -0.72, 0.28);
      knight.add(cylBetween(hip, knee, 0.1, 0.09, metal));
      knight.add(cylBetween(knee, foot, 0.075, 0.065, metal));
      add(knight, sph, metal, knee.toArray(), [0.1, 0.1, 0.1]);
      add(knight, new THREE.BoxGeometry(0.11, 0.08, 0.26), darkMetal, [foot.x, foot.y - 0.03, foot.z + 0.07]);
    }
    // cuirass: a lathe-turned trunk (narrow waist, deep chest) reads far better than stacked spheres
    const cuiPts = [[0.17, 0.0], [0.2, 0.08], [0.215, 0.2], [0.26, 0.36], [0.275, 0.5], [0.25, 0.62], [0.16, 0.71], [0.1, 0.74]].map(([r, y]) => new THREE.Vector2(r, y));
    const cuiGeo = new THREE.LatheGeometry(cuiPts, 22);
    add(torso, cuiGeo, metal, [0, 0.02, 0], [1, 1, 0.82]);
    add(torso, new THREE.BoxGeometry(0.018, 0.42, 0.02), trim, [0, 0.44, 0.215], null, [-0.12, 0, 0]);
    // tassets + livery skirt
    add(torso, new THREE.CylinderGeometry(0.22, 0.3, 0.2, 16), darkMetal, [0, 0.0, 0], [1, 1, 0.85]);
    add(torso, new THREE.CylinderGeometry(0.27, 0.38, 0.34, 18, 1, true), tabard, [0, -0.05, 0], [1, 1, 0.9]);
    // tabard over the chest (front panel) and long cape down the back
    add(torso, new THREE.BoxGeometry(0.3, 0.3, 0.02), tabard, [0, 0.2, 0.2], null, [-0.05, 0, 0]);
    const capeGeo = new THREE.PlaneGeometry(0.62, 1.05, 4, 6); capeGeo.translate(0, -0.52, 0);
    this.cape = add(torso, capeGeo, tabard, [0, 0.72, -0.2], null, [0.18, 0, 0]);
    this.capeBase = capeGeo.attributes.position.array.slice();
    // gorget + pauldrons with lames
    add(torso, new THREE.CylinderGeometry(0.13, 0.17, 0.12, 14), metal, [0, 0.74, 0]);
    for (const s of [1, -1]) {
      add(torso, sph, metal, [s * 0.3, 0.57, 0], [0.19, 0.13, 0.2]);
      for (let i = 0; i < 2; i++) {
        add(torso, new THREE.TorusGeometry(0.15 - i * 0.02, 0.028, 6, 18), metal, [s * 0.33, 0.47 - i * 0.065, 0], null, [Math.PI / 2, 0, 0]);
      }
    }
    // helm
    const helm = new THREE.Group(); helm.position.set(0, 0.9, 0.01); torso.add(helm); this.helm = helm;
    add(helm, sph, metal, [0, 0.01, 0], [0.18, 0.2, 0.2]);
    add(helm, new THREE.CylinderGeometry(0.17, 0.2, 0.2, 16), metal, [0, -0.1, 0.01]);
    add(helm, new THREE.BoxGeometry(0.22, 0.03, 0.08), std('#14161a'), [0, 0.0, 0.17]); // eye slit
    add(helm, new THREE.ConeGeometry(0.13, 0.22, 12), metal, [0, -0.08, 0.17], [1, 0.62, 1], [Math.PI / 2, 0, 0]); // frog-mouth bevor
    add(helm, new THREE.TorusGeometry(0.025, 0.014, 4, 8), trim, [0, 0.2, 0]);
    const plumeMat = std(o.plume, { roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.ConeGeometry(0.06, 0.42, 5); g.translate(0, 0.21, 0);
      add(helm, g, plumeMat, [0, 0.19, -0.02], [1, 1, 0.55], [-0.5 - i * 0.18 + (i % 2) * 0.05, (i - 2.5) * 0.18, 0]);
    }
    // right arm (couching the lance under the armpit)
    const shoulderR = new THREE.Vector3(-0.3, 0.6, 0);
    const elbowR = new THREE.Vector3(-0.38, 0.34, -0.06);
    const handR = new THREE.Vector3(-0.3, 0.26, 0.3);
    torso.add(cylBetween(shoulderR, elbowR, 0.075, 0.07, metal));
    torso.add(cylBetween(elbowR, handR, 0.065, 0.06, metal));
    add(torso, sph, metal, elbowR.toArray(), [0.085, 0.085, 0.085]);
    add(torso, sph, darkMetal, handR.toArray(), [0.07, 0.07, 0.08]);
    // left arm + shield
    const shoulderL = new THREE.Vector3(0.3, 0.6, 0);
    const elbowL = new THREE.Vector3(0.4, 0.36, 0.08);
    const handL = new THREE.Vector3(0.3, 0.42, 0.28);
    torso.add(cylBetween(shoulderL, elbowL, 0.075, 0.07, metal));
    torso.add(cylBetween(elbowL, handL, 0.065, 0.06, metal));
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
      cp[i + 2] = cb[i + 2] - k * k * (0.25 + a * 0.6) + Math.sin(t * 9 + cb[i] * 4 + k * 5) * 0.04 * k * (0.3 + a);
    }
    this.cape.geometry.attributes.position.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();
    this.orientLance();
  }

  orientLance() {
    if (this.lance.parent !== this.lancePivot) return;
    // raised (upright) vs. couched (aimed) direction, both in the root frame
    const up = new THREE.Vector3(-0.12, 1, 0.35).normalize();
    const dir = up.lerp(this.aimDirLocal, this.lanceLower).normalize();
    const qRoot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    // add a little twist so the stripes don't look static; also recoil kicks the tip up
    if (this.recoil > 0) qRoot.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.recoil * 0.4));
    this.lanceRootQ.copy(qRoot);
    // convert root-frame orientation into the pivot's parent frame
    this.root.updateWorldMatrix(true, true);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const parentQ = this.lancePivot.parent.getWorldQuaternion(new THREE.Quaternion());
    this.lancePivot.quaternion.copy(parentQ.invert().multiply(rootQ).multiply(qRoot));
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
