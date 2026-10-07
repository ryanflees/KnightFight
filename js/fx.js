// Particle effects: lance splinters, hoof dust, impact flash.
import * as THREE from 'three';
import { softDotTexture } from './textures.js';

const MAX_SPLINTERS = 260;
const MAX_DUST = 240;
const MAX_CONFETTI = 700;
const CONFETTI_COLORS = ['#c4483b', '#1f6f63', '#e1b74e', '#f1e8d2', '#4b2a5e'];

export class FX {
  constructor(scene) {
    this.scene = scene;
    // splinters — instanced thin boxes with simple physics, they stay on the ground afterwards
    const g = new THREE.BoxGeometry(0.035, 0.035, 1);
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
    this.spl = new THREE.InstancedMesh(g, m, MAX_SPLINTERS);
    this.spl.castShadow = true;
    this.spl.frustumCulled = false;
    this.splData = [];
    for (let i = 0; i < MAX_SPLINTERS; i++) {
      this.splData.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), len: 0.3, rest: false });
      this.spl.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.spl.setColorAt(i, new THREE.Color('#ffffff'));
    }
    this.splIdx = 0;
    scene.add(this.spl);

    // dust — pooled sprites
    const tex = softDotTexture();
    this.dust = [];
    for (let i = 0; i < MAX_DUST; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: '#d8b98a', transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.dust.push({ s, life: 0, max: 1, v: new THREE.Vector3(), grow: 1 });
    }
    this.dustIdx = 0;

    // impact flash
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#fff2c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLife = 0;
    // confetti — fluttering paper squares thrown from the stands
    const cg = new THREE.PlaneGeometry(0.14, 0.09);
    this.conf = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), MAX_CONFETTI);
    this.conf.frustumCulled = false;
    this.confData = [];
    const col = new THREE.Color();
    for (let i = 0; i < MAX_CONFETTI; i++) {
      this.confData.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), ph: Math.random() * 10, spin: new THREE.Vector3() });
      this.conf.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.conf.setColorAt(i, col.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
    }
    scene.add(this.conf);
    this.confIdx = 0;
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3();
  }

  // a burst from both grandstands around z
  confetti(z, count = 400) {
    for (let n = 0; n < count; n++) {
      const d = this.confData[this.confIdx]; this.confIdx = (this.confIdx + 1) % MAX_CONFETTI;
      const side = n % 2 ? 1 : -1;
      d.p.set(side * (7 + Math.random() * 4), 4 + Math.random() * 2.5, z + (Math.random() - 0.5) * 30);
      d.v.set(-side * (2 + Math.random() * 4), 4 + Math.random() * 5, (Math.random() - 0.5) * 3);
      d.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      d.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      d.life = 7 + Math.random() * 3;
    }
  }

  clear() {
    for (let i = 0; i < MAX_CONFETTI; i++) { this.confData[i].life = 0; this.conf.setMatrixAt(i, this._m.makeScale(0, 0, 0)); }
    this.conf.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_SPLINTERS; i++) {
      this.splData[i].alive = false;
      this.spl.setMatrixAt(i, this._m.makeScale(0, 0, 0));
    }
    this.spl.instanceMatrix.needsUpdate = true;
    for (const d of this.dust) { d.life = 0; d.s.visible = false; }
    this.flash.visible = false; this.flashLife = 0;
  }

  // Shatter a lance at `pos`, flying roughly along `dir` (world). Colours alternate the lance stripes.
  splinter(pos, dir, colors, count = 70) {
    const c = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const i = this.splIdx; this.splIdx = (this.splIdx + 1) % MAX_SPLINTERS;
      const d = this.splData[i];
      d.alive = true; d.rest = false;
      d.p.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2));
      const spread = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9 + 0.1, (Math.random() - 0.5)).multiplyScalar(7);
      d.v.copy(dir).multiplyScalar(4 + Math.random() * 6).add(spread);
      d.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      d.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      d.len = n < 6 ? 0.5 + Math.random() * 0.7 : 0.06 + Math.random() * 0.3;
      this.spl.setColorAt(i, c.set(Math.random() < 0.15 ? '#e7d3a6' : colors[n % colors.length]));
    }
    this.spl.instanceColor.needsUpdate = true;
  }

  puff(pos, vel, size = 0.8, life = 1.2, color = '#d6b585', opacity = 0.42) {
    const d = this.dust[this.dustIdx]; this.dustIdx = (this.dustIdx + 1) % MAX_DUST;
    d.s.position.copy(pos);
    d.v.copy(vel);
    d.life = d.max = life;
    d.size = size; d.grow = 1.8 + Math.random();
    d.op = opacity;
    d.s.material.color.set(color);
    d.s.visible = true;
  }

  impactFlash(pos, size = 2.2) {
    this.flash.position.copy(pos);
    this.flash.visible = true;
    this.flashLife = 0.25; this.flashSize = size;
    for (let i = 0; i < 10; i++) {
      this.puff(pos, new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3), 0.5, 0.9, '#efe2c4', 0.5);
    }
  }

  update(dt) {
    const m = this._m, s = this._s, q = new THREE.Quaternion();
    let dirty = false;
    for (let i = 0; i < MAX_SPLINTERS; i++) {
      const d = this.splData[i];
      if (!d.alive || d.rest) continue;
      dirty = true;
      d.v.y -= 9.81 * dt;
      d.v.multiplyScalar(Math.pow(0.6, dt));
      d.p.addScaledVector(d.v, dt);
      const wl = d.w.length();
      if (wl > 0.01) d.q.premultiply(q.setFromAxisAngle(d.w.clone().divideScalar(wl), wl * dt));
      if (d.p.y < 0.03) {
        d.p.y = 0.03;
        d.v.y *= -0.25; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.4);
        // lie flat once slow
        if (d.v.lengthSq() < 0.2) {
          const e = new THREE.Euler().setFromQuaternion(d.q, 'YXZ');
          d.q.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
          d.rest = true;
        }
      }
      s.set(1, 1, d.len);
      this.spl.setMatrixAt(i, m.compose(d.p, d.q, s));
    }
    if (dirty) this.spl.instanceMatrix.needsUpdate = true;

    for (const d of this.dust) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.s.visible = false; continue; }
      const k = 1 - d.life / d.max;
      d.s.position.addScaledVector(d.v, dt);
      d.v.multiplyScalar(Math.pow(0.3, dt));
      d.v.y += 0.4 * dt;
      const sz = d.size * (1 + k * d.grow);
      d.s.scale.set(sz, sz, sz);
      d.s.material.opacity = d.op * Math.sin(Math.PI * Math.min(1, k * 1.3 + 0.08)) * (1 - k);
    }
    let confDirty = false;
    const one = this._s.set(1, 1, 1);
    for (let i = 0; i < MAX_CONFETTI; i++) {
      const d = this.confData[i];
      if (d.life <= 0) continue;
      confDirty = true;
      d.life -= dt;
      if (d.p.y > 0.02) {
        // paper: strong drag, slow terminal fall, side-to-side flutter
        d.v.y -= 9.81 * dt;
        d.v.multiplyScalar(Math.pow(0.08, dt));
        d.v.y = Math.max(d.v.y, -1.1);
        d.ph += dt * 4;
        d.p.x += Math.sin(d.ph) * dt * 0.6;
        d.p.addScaledVector(d.v, dt);
        const w = d.spin.length();
        d.q.premultiply(q.setFromAxisAngle(d.spin.clone().divideScalar(w), w * dt));
      } else { d.p.y = 0.02; }
      if (d.life <= 0) { this.conf.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      this.conf.setMatrixAt(i, m.compose(d.p, d.q, one));
    }
    if (confDirty) this.conf.instanceMatrix.needsUpdate = true;
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      const k = Math.max(0, this.flashLife / 0.25);
      this.flash.material.opacity = k;
      const sz = this.flashSize * (1.6 - k * 0.6);
      this.flash.scale.set(sz, sz, sz);
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }
}
