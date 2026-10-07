// The Gilded Tilt — game orchestration: render pipeline, state machine, input, cameras, HUD, replay.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildWorld, LIST } from './world.js';
import { Rider, LANCE } from './knight.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Recorder } from './replay.js';
import { classify, resolveStrike, AIController, DIFFICULTY, ZONES } from './combat.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const smooth = (t) => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;
const LANE = LIST.laneX;
const PELVIS_Y = 1.76;
const params = new URLSearchParams(location.search);
const FIXED_DT = params.get('fixed') ? 1 / (parseFloat(params.get('fixed')) || 30) : 0; // deterministic stepping for automated screenshots

// ------------------------------------------------------------------ renderer
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.25, 2000);
camera.position.set(-20, 20, 80);

const world = buildWorld(scene);

// Image-based lighting so the plate armour has something to reflect.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const g = new THREE.SphereGeometry(10, 32, 16);
  const cols = [];
  const p = g.attributes.position;
  const top = new THREE.Color('#7fa4c4'), hor = new THREE.Color('#f4e2bc'), bot = new THREE.Color('#7a5a36');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(bot, Math.pow(-y, 0.4));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sunBlob = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.2, 4) }));
  sunBlob.position.copy(world.sunOffset).normalize().multiplyScalar(8.5);
  env.add(sunBlob);
  scene.environment = pmrem.fromScene(env, 0.03).texture;
  scene.environmentIntensity = 0.55;
}

// Post: bloom → tone map → film grade (warm split-tone, vignette, grain).
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.55, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vig: { value: 0.32 }, hit: { value: 0 }, sat: { value: 1.06 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float vig; uniform float hit; uniform float sat; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, sat);
      // split-tone: teal shadows, amber highlights
      c += mix(vec3(-0.012,0.006,0.022), vec3(0.028,0.012,-0.022), smoothstep(0.15,0.85,l));
      // gentle S-curve
      c = mix(c, c*c*(3.0-2.0*c), 0.22);
      vec2 d = vUv - 0.5; d.x *= 1.25;
      float v = smoothstep(0.85, 0.2, length(d));
      c *= mix(1.0 - vig, 1.0, v);
      c = mix(c, vec3(0.55,0.06,0.03), hit * (1.0 - v) * 0.7);
      c += (hash(vUv * 1000.0 + time) - 0.5) * 0.025;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(gradePass);

const fx = new FX(scene);
const sound = new Sound();

// ------------------------------------------------------------------ riders
const player = new Rider({
  facing: 1, tabard: '#1d5650', charge: '#e9e4d2', trimCloth: '#d6ae52', trim: '#d6ae52', plume: '#2f8a7e',
  horseCoat: '#a29d96', coatKind: 'dapple', pointsColor: '#57524d', maneColor: '#3a3633', shieldKind: 'falcon', lanceA: '#ece5d0', lanceB: '#1d5650',
});
const opp = new Rider({
  facing: -1, tabard: '#97291f', charge: '#e1b74e', trimCloth: '#e1b74e', trim: '#d6ae52', plume: '#d24b3a',
  horseCoat: '#7a3f20', coatKind: 'bay', pointsColor: '#1f1712', maneColor: '#17110d', shieldKind: 'stag', lanceA: '#e1b74e', lanceB: '#97291f',
});
scene.add(player.root, opp.root);
for (const r of [player, opp]) {
  r.stamina = 1; r.braceHeldFor = 0; r.ax = 0; r.ay = 2.1; r.struck = false; r.result = null;
}
player.colors = ['#ece5d0', '#1d5650'];
player._dir = new THREE.Vector3(0.6, 0.08, 0.8).normalize();
player._swayDir = player._dir.clone();
opp.colors = ['#e1b74e', '#97291f'];

// Aim guide: faint outlines of the zones where the opposing knight will pass.
const ghost = new THREE.Group();
{
  const mat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.0, depthWrite: false });
  const circle = (r, n = 40) => {
    const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 1.1, 0)); }
    return new THREE.BufferGeometry().setFromPoints(pts);
  };
  const H = ZONES.helm, S = ZONES.shield, B = ZONES.body;
  const helm = new THREE.LineLoop(circle(H.r), mat('#ffd27a'));
  helm.position.set(-H.lx, PELVIS_Y + H.dy, 0);
  const sh = new THREE.Shape();
  sh.moveTo(-S.hw, S.hh); sh.lineTo(S.hw, S.hh); sh.lineTo(S.hw, 0); sh.quadraticCurveTo(S.hw * 0.9, -S.hh * 0.7, 0, -S.hh); sh.quadraticCurveTo(-S.hw * 0.9, -S.hh * 0.7, -S.hw, 0); sh.closePath();
  const shield = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sh.getPoints(16)), mat('#8fe0c8'));
  shield.position.set(-S.lx, PELVIS_Y + S.dy, 0);
  const bodyPts = [[-B.hw, -B.hh], [B.hw, -B.hh], [B.hw, B.hh], [-B.hw, B.hh]].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const body = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(bodyPts), mat('#8fe0c8'));
  body.position.set(-B.lx, PELVIS_Y + B.dy, 0);
  ghost.add(body, shield, helm);
  ghost.renderOrder = 5;
  player.root.add(ghost);
}
function setGhostOpacity(o) { ghost.children.forEach((c, i) => { c.material.opacity = o * (i === 2 ? 1 : 0.7); }); }

// ------------------------------------------------------------------ game state
const G = {
  state: 'loading', diff: DIFFICULTY.knight, pass: 0, score: { p: 0, o: 0 },
  simT: 0, timer: 0, slow: 0, shake: 0, paused: false, view: 'chase',
  rec: new Recorder(), lastRec: null, crossed: false, unhorsed: null, matchOver: false,
  announced: false, afterReplay: 'pass', crossZ: 0,
};
const ai = new AIController(G.diff);
const ROUNDS = [
  ['第一轮', 'THE OPENING COURSE'], ['第二轮', 'THE SECOND COURSE'], ['第三轮', 'THE FINAL COURSE'], ['加赛', 'SUDDEN DEATH'],
];

const input = { ax: 0, ay: 0, brace: false, spur: false, rein: false };

// ------------------------------------------------------------------ HUD helpers
let annTimer = null;
function announce(small, big, sub = '', cls = '', ms = 1700) {
  const a = $('announce');
  $('annSmall').textContent = small; $('annBig').textContent = big; $('annSub').textContent = sub;
  a.className = 'show ' + cls;
  void a.offsetWidth; // restart animation
  a.className = 'show pop ' + cls;
  clearTimeout(annTimer);
  if (ms) annTimer = setTimeout(() => { a.className = cls; }, ms);
}
function hideAnnounce() { clearTimeout(annTimer); $('announce').className = ''; }
function pad(n) { return String(n).padStart(2, '0'); }
function updateScores(bump) {
  $('scoreP').textContent = pad(G.score.p);
  $('scoreO').textContent = pad(G.score.o);
  for (const k of bump || []) {
    const el = $(k === 'p' ? 'scoreP' : 'scoreO');
    el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 260);
  }
}
function updateRoundLabel() {
  const [cn, en] = ROUNDS[Math.min(G.pass, 3)];
  $('roundCn').textContent = cn; $('roundEn').textContent = en;
  const dots = $('roundDots'); dots.innerHTML = '';
  const n = G.pass >= 3 ? 4 : 3;
  for (let i = 0; i < n; i++) { const d = document.createElement('i'); if (i <= G.pass) d.className = 'on'; dots.appendChild(d); }
}
function showScreen(id, on = true) {
  $(id).classList.toggle('hidden', !on);
  if (id === 'passCard' || id === 'endCard') document.body.classList.toggle('carded', on);
}
function fade(on) { $('fade').classList.toggle('on', on); }

// ------------------------------------------------------------------ cameras
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
function chaseTarget(r, outPos, outLook) {
  r.root.updateMatrixWorld();
  outPos.copy(r.root.localToWorld(_v.set(-1.15, 3.45, -5.9)));
  outLook.copy(r.root.localToWorld(_w.set(0.7, 1.95, 10)));
}
function applyCam(pos, look, dt, k = 5) {
  if (!camState.init || k === Infinity) { camState.pos.copy(pos); camState.look.copy(look); camState.init = true; }
  else { camState.pos.lerp(pos, damp(k, dt)); camState.look.lerp(look, damp(k * 1.4, dt)); }
  camera.position.copy(camState.pos);
  if (G.shake > 0) {
    const s = G.shake * G.shake * 0.35;
    camera.position.add(_v.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
  }
  camera.lookAt(camState.look);
}
function helmCam() {
  player.helm.updateWorldMatrix(true, false);
  const p = player.helm.getWorldPosition(_v).add(_w.set(0, 0.02, 0.22));
  camera.position.copy(p);
  if (G.shake > 0) camera.position.x += (Math.random() - 0.5) * G.shake * 0.12;
  camera.lookAt(player.root.localToWorld(_w.set(0.9, 2.3, 30)));
}
function setView(v) {
  G.view = v;
  const helm = v === 'helm' && ['countdown', 'charge', 'runout'].includes(G.state);
  $('visor').classList.toggle('hidden', !helm);
  player.helm.visible = !helm;
}

// ------------------------------------------------------------------ pass lifecycle
function resetRiders() {
  player.reset(-LANE, -LIST.startZ);
  opp.reset(LANE, LIST.startZ);
  for (const r of [player, opp]) {
    r.stamina = 1; r.brace = 0; r.braceHeldFor = 0; r.struck = false; r.result = null;
    r.ax = 0; r.ay = PELVIS_Y + 0.4; r.lanceLower = 0;
    r.setAimDirection(new THREE.Vector3(0.5, 0.05, 0.85));
    r.animate(0);
  }
  G.crossed = false; G.unhorsed = null; G.announced = false; G.slow = 0;
}

function startMatch() {
  G.pass = 0; G.score = { p: 0, o: 0 }; G.matchOver = false;
  ai.diff = G.diff;
  updateScores();
  fx.clear();
  startPass(true);
}

function startPass(withIntro) {
  resetRiders();
  updateRoundLabel();
  ai.beginPass(G.pass, G.score.o - G.score.p);
  G.rec.reset();
  G.simT = 0;
  showScreen('hud'); showScreen('passCard', false); showScreen('endCard', false);
  $('hud').classList.remove('hidden');
  camState.init = false;
  if (withIntro) {
    G.state = 'intro'; G.timer = 0;
    const [cn, en] = ROUNDS[Math.min(G.pass, 3)];
    announce('比武大会', cn, en, '', 3200);
    sound.horn(false);
    world.cheer(0, 0.5);
    const cp = new THREE.Vector3(), cl = new THREE.Vector3();
    chaseTarget(player, cp, cl);
    G.introCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(26, 24, 62), new THREE.Vector3(8, 12, 18), new THREE.Vector3(-7, 5, -28), cp,
    ]);
    G.introLook = [new THREE.Vector3(0, 9, 96), new THREE.Vector3(0, 3, 10), cl];
  } else {
    G.state = 'countdown'; G.timer = 0; G.lastCount = -1;
  }
  setView(G.view);
}

function beginCharge() {
  G.state = 'charge'; G.simT = 0;
  document.body.classList.add('aiming');
}

function finishCrossing() {
  if (G.announced) return;
  G.announced = true;
  const rp = player.result, ro = opp.result;
  const big = rp && rp.zone ? rp.label : '落空';
  const sub = ro && ro.zone ? `赤鹿骑士 · ${ro.label}` : '赤鹿骑士 · 落空';
  const cls = rp && rp.unhorse ? 'gold' : (ro && ro.unhorse ? 'red' : (rp && rp.points >= 2 ? 'gold' : ''));
  const small = rp && rp.points ? `+${rp.points} 分` : (ro && ro.points ? '' : '双方落空');
  announce(small, big, sub, cls, 2300);
  if (!(rp && rp.zone) && !(ro && ro.zone)) { sound.groan(); }
}

function endPassToCard() {
  document.body.classList.remove('aiming');
  const rp = player.result || { label: '落空', points: 0 }, ro = opp.result || { label: '落空', points: 0 };
  $('pcKicker').textContent = `${ROUNDS[Math.min(G.pass, 3)][0]} · 结果`;
  $('pcYou').textContent = rp.zone ? rp.label : '落空';
  $('pcFoe').textContent = ro.zone ? ro.label : '落空';
  $('pcYouPts').textContent = rp.unhorse ? '胜' : `+${rp.points}`;
  $('pcFoePts').textContent = ro.unhorse ? '胜' : `+${ro.points}`;
  const notes = [];
  if (rp.perfect) notes.push('完美稳身 —— 冲击力提升');
  if (player.result && player.result.zone && !player.result.broke && !player.result.unhorse) notes.push('枪未折断：稳身更早或命中更正，才能碎枪');
  if (ro.zone && player._braceAtImpact < 0.3) notes.push('被击中时没有稳身 —— 撞击前约半秒按住 SPACE');
  if (player._staminaAtImpact < 0.3) notes.push('体力不支：稳身按得太早了');
  $('pcNote').textContent = notes.join(' · ');
  // match decided?
  let over = false;
  if (G.unhorsed) over = true;
  else if (G.pass >= 2 && G.score.p !== G.score.o) over = true;
  else if (G.pass >= 3) over = true;
  G.matchOver = over;
  $('btnNext').innerHTML = over ? '比武结果 <kbd>Enter</kbd>' : '下一轮 <kbd>Enter</kbd>';
  G.state = 'passCard';
  showScreen('passCard');
  $('reticle').classList.add('hidden');
  $('foeTag').classList.add('hidden');
}

function nextFromCard() {
  showScreen('passCard', false);
  if (G.matchOver) { showEnd(); return; }
  G.pass++;
  fade(true);
  setTimeout(() => { startPass(false); fade(false); }, 450);
}

function showEnd() {
  G.state = 'end';
  showScreen('endCard');
  const p = G.score.p, o = G.score.o;
  let title, sub, kick;
  if (G.unhorsed === 'o') { title = '胜利'; sub = 'YOU UNHORSED THE RED STAG'; kick = '赤鹿骑士落马'; }
  else if (G.unhorsed === 'p') { title = '落马'; sub = 'THE DUST TASTES OF IRON'; kick = '你被挑落马下'; }
  else if (G.unhorsed === 'both') { title = '同归'; sub = 'BOTH KNIGHTS FELL'; kick = '双双落马'; }
  else if (p > o) { title = '胜利'; sub = 'THE GILDED LANCE IS YOURS'; kick = '以分数取胜'; }
  else if (p < o) { title = '败北'; sub = 'THE RED STAG TAKES THE DAY'; kick = '以分数落败'; }
  else { title = '平局'; sub = 'HONOUR SHARED'; kick = '势均力敌'; }
  $('ecTitle').textContent = title; $('ecSub').textContent = sub; $('ecKicker').textContent = `比武结束 · ${kick}`;
  $('ecP').textContent = p; $('ecO').textContent = o;
  $('ecNote').textContent = `难度：${G.diff.label} · 共 ${G.pass + 1} 轮`;
  const win = title === '胜利';
  if (win) { sound.horn(true); sound.cheer(1.4); world.cheer(0, 1); fx.confetti(camera.position.z + 8, 600); }
}

// ------------------------------------------------------------------ simulation
const tmpHand = new THREE.Vector3(), tmpTip = new THREE.Vector3(), tmpPel = new THREE.Vector3();

function aimDirFor(r, ax, ay) {
  r.handWorld(tmpHand);
  r.root.worldToLocal(tmpHand);
  const dx = 2 * LANE + ax - tmpHand.x, dy = ay - tmpHand.y;
  const L = LANCE.front;
  const dz = Math.sqrt(Math.max(0.4, L * L - dx * dx - dy * dy));
  return _v.set(dx, dy, dz).normalize();
}

// Lance-tip IK target: the direction (rider root frame) that puts the tip under the cursor.
// The camera ray through the cursor is intersected with a sphere of lance length around the grip.
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2(), _rq = new THREE.Quaternion();
const AIM = { yawMin: -0.3, yawMax: 1.08, pitchMin: -0.42, pitchMax: 0.5 };
function cursorAimDir(r) {
  _ndc.set(clamp(input.ax, -1, 1), -clamp(input.ay, -1, 1));
  raycaster.setFromCamera(_ndc, camera);
  r.root.updateMatrixWorld(true);
  r.root.getWorldQuaternion(_rq).invert();
  const O = r.root.worldToLocal(raycaster.ray.origin.clone());
  const D = raycaster.ray.direction.clone().applyQuaternion(_rq);
  const H = r.root.worldToLocal(r.handWorld(new THREE.Vector3()));
  const L = LANCE.front;
  const f = O.clone().sub(H);
  const b = f.dot(D), disc = b * b - (f.lengthSq() - L * L);
  let P;
  if (disc >= 0) {
    // two candidate tip positions on the ray — take the one further down the lists
    const P1 = O.clone().addScaledVector(D, -b - Math.sqrt(disc));
    const P2 = O.clone().addScaledVector(D, -b + Math.sqrt(disc));
    P = P1.z > P2.z ? P1 : P2;
  } else {
    P = O.clone().addScaledVector(D, Math.max(0, -b)); // out of reach: point at the nearest spot
  }
  const dir = P.sub(H).normalize();
  const yaw = clamp(Math.atan2(dir.x, dir.z), AIM.yawMin, AIM.yawMax);
  const pitch = clamp(Math.asin(clamp(dir.y, -1, 1)), AIM.pitchMin, AIM.pitchMax);
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

function sway(r, t, swayK) {
  const sp = clamp(r.speed / 15, 0, 1.2);
  const amp = ((0.035 + 0.11 * sp) * (1 - 0.55 * r.brace) + 0.16 * Math.pow(1 - r.stamina, 2)) * swayK;
  const gait = Math.sin(r.phase * TAU) * 0.05 * sp;
  return [
    (Math.sin(t * 1.7 + r.facing) * 0.6 + Math.sin(t * 3.3 + 1) * 0.4) * amp,
    (Math.sin(t * 2.3 + 2 * r.facing) * 0.6 + Math.sin(t * 4.1) * 0.4) * amp + gait,
  ];
}

function braceStep(r, held, dt) {
  if (held && !r.unhorsed) {
    r.brace = Math.min(1, r.brace + dt / 0.22);
    r.braceHeldFor += dt;
    r.stamina = Math.max(0, r.stamina - dt * 0.55);
  } else {
    r.brace = Math.max(0, r.brace - dt / 0.25);
    r.braceHeldFor = 0;
    r.stamina = Math.min(1, r.stamina + dt * 0.28);
  }
  r.lean += (r.brace - r.lean) * damp(8, dt);
}

function eta() {
  const gap = (opp.z - player.z) - 2 * 3.0;
  const closing = Math.max(1, player.speed + opp.speed);
  return gap / closing;
}

function simulate(dt) {
  const t = G.simT;
  const charging = G.state === 'charge';
  const e = eta();
  const gap = opp.z - player.z;

  // ---- player control
  let target = 0;
  if (charging && !G.crossed) target = input.rein ? 7 : input.spur ? 15.2 : 11.5;
  else if (G.state === 'runout') target = G.crossedFor > 0.8 ? 0 : player.speed;
  if (player.unhorsed && G.state === 'runout') target = Math.max(0, player.speed - 1);
  player.speed += clamp(target - player.speed, -4.2 * dt, 3.3 * dt);
  braceStep(player, input.brace && G.state !== 'runout', dt);
  // aim: the tip chases the cursor (a heavy lance lags a little; bracing steadies but slows it)
  const [sx, sy] = sway(player, t, 1);
  player._dir.lerp(cursorAimDir(player), damp(player.brace > 0.5 ? 7 : 12, dt)).normalize();
  player._swayDir.copy(player._dir);
  player._swayDir.x += sx / 3.4; player._swayDir.y += sy / 3.4;
  player._swayDir.normalize();

  // ---- AI control
  const thought = ai.think(t, e);
  let oTarget = 0;
  if (charging && !G.crossed) oTarget = thought.spur ? G.diff.gallop : G.diff.gallop - 2.2;
  else if (G.state === 'runout') oTarget = G.crossedFor > 0.8 ? 0 : opp.speed;
  opp.speed += clamp(oTarget - opp.speed, -4.2 * dt, 3.3 * dt);
  braceStep(opp, thought.brace && G.state !== 'runout', dt);
  const [ox, oy] = sway(opp, t + 7, G.diff.sway);
  const kAimO = damp(opp.brace > 0.5 ? 3.5 : 6, dt);
  opp.ax += (-thought.lx - opp.ax) * kAimO;
  opp.ay += (PELVIS_Y + thought.dy - opp.ay) * kAimO;
  opp._aimAx = opp.ax + ox; opp._aimAy = opp.ay + oy;

  // ---- move + couch lances
  for (const r of [player, opp]) {
    r.place(r.x, r.z + r.speed * r.facing * dt);
    const lowerWanted = (charging && gap < 46) || (G.state === 'runout' && G.crossedFor < 0.6);
    r.lanceLower = clamp(r.lanceLower + (lowerWanted ? dt / 1.3 : -dt / 1.6), 0, 1);
    r.recoil = Math.max(0, r.recoil - dt * 1.6);
    r.root.updateMatrixWorld(true);
    r.setAimDirection(r === player ? player._swayDir : aimDirFor(r, r._aimAx, r._aimAy));
    r.animate(dt);
    r.stepTumblers(dt);
  }

  // ---- strikes
  if (charging || G.state === 'runout') {
    for (const [A, D, key] of [[player, opp, 'p'], [opp, player, 'o']]) {
      if (A.struck) continue;
      A.lanceTipWorld(tmpTip);
      const planeZ = D.z + D.facing * 0.28;
      if ((tmpTip.z - planeZ) * A.facing < 0) continue;
      A.struck = true;
      if (D.unhorsed || A.unhorsed || A.lanceLower < 0.6) { A.result = { zone: null, points: 0, label: '落空' }; continue; }
      D.knight.getWorldPosition(tmpPel);
      const lx = (tmpTip.x - D.x) * D.facing;
      const hit = classify(lx, tmpTip.y - tmpPel.y);
      const res = resolveStrike(hit, A, D);
      A.result = res;
      if (D === player) { player._braceAtImpact = player.brace; player._staminaAtImpact = player.stamina; }
      if (A === player) { player._staminaAtImpact = player.stamina; }
      applyStrike(A, D, key, res, tmpTip.clone());
    }
    if (!G.crossed && player.z > opp.z - 0.5) {
      G.crossed = true; G.crossedFor = 0; G.crossZ = (player.z + opp.z) / 2;
      G.rec.crossT = G.simT;
      for (const r of [player, opp]) if (!r.struck) { r.struck = true; r.result = { zone: null, points: 0, label: '落空' }; }
      setTimeout(finishCrossing, 120);
      G.state = 'runout';
      document.body.classList.remove('aiming');
    }
  }
  if (G.crossed) G.crossedFor += dt;

  // ---- footfalls → hoof sounds + dust
  for (const r of [player, opp]) {
    for (const leg of r.footfalls) {
      const d = camera.position.distanceTo(r.root.position);
      sound.hoof(clamp(1.4 / (1 + d / 7), 0, 0.7), r === player ? 0 : clamp((r.x - camera.position.x) * -0.2, -0.6, 0.6));
      if (r.speed > 5 && Math.random() < 0.85) {
        r.legs[leg].hoof.getWorldPosition(_w);
        _w.y = 0.15;
        fx.puff(_w, new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.4, -r.facing * r.speed * 0.12), 0.45 + Math.random() * 0.3, 1.3);
      }
    }
  }

  // crowd builds as the knights close
  if (charging) {
    const ex = clamp(1 - gap / 100, 0, 1);
    sound.crowd(ex * 0.8);
    world.cheer(0, 0.1 + ex * 0.35);
  }

  G.rec.push(G.simT, player.snapshot(), opp.snapshot());
  G.simT += dt;
}

function applyStrike(A, D, key, res, tip) {
  const dir = new THREE.Vector3(0, 0, A.facing);
  const ev = { type: 'impact', t: G.simT, pos: tip.toArray(), dir: dir.toArray(), broke: res.broke, colors: A.colors, power: res.power || 0, key, unhorse: res.unhorse, zone: res.zone };
  G.rec.event(ev);
  if (!res.zone) return;
  playImpactFx(ev, true);
  if (res.broke) A.setLanceBroken(true);
  A.recoil = res.broke ? 0.5 : 0.9;
  D.recoil = 0.6 + res.power * 0.5;
  if (key === 'p') G.score.p += res.points; else G.score.o += res.points;
  updateScores([key]);
  if (res.unhorse) {
    D.unhorse(scene, new THREE.Vector3(0, 2.2 + res.power, A.facing * (3 + res.power * 3)));
    G.unhorsed = G.unhorsed ? 'both' : (key === 'p' ? 'o' : 'p');
  }
  if (D === player) { $('vignette').classList.add('hit'); setTimeout(() => $('vignette').classList.remove('hit'), 380); G.hitFlash = 1; }
  // slow-motion beat on the first contact of the pass
  if (G.slow <= 0) G.slow = res.unhorse ? 1.6 : 1.0;
  G.shake = Math.max(G.shake, res.unhorse ? 1.4 : res.broke ? 1.0 : 0.6);
}

function playImpactFx(ev, withSound) {
  const pos = new THREE.Vector3().fromArray(ev.pos), dir = new THREE.Vector3().fromArray(ev.dir);
  fx.impactFlash(pos, ev.broke ? 2.6 : 1.4);
  if (ev.broke) fx.splinter(pos, dir, ev.colors, 80);
  else fx.splinter(pos, dir, ev.colors, 6);
  if (withSound) {
    sound.crash(0.6 + ev.power * 0.4, ev.broke);
    const side = ev.key === 'p' ? -1 : 1; // the crowd on the scorer's side roars loudest
    world.cheer(side, ev.unhorse ? 1.3 : ev.broke ? 1 : 0.6);
    world.cheer(-side, ev.unhorse ? 0.9 : 0.6);
    sound.cheer(ev.unhorse ? 1.5 : ev.broke ? 1 : 0.5);
  }
  if (ev.unhorse) fx.confetti(ev.pos[2], 500);
}

// ------------------------------------------------------------------ replay
const orbit = new OrbitControls(camera, canvas);
orbit.enabled = false;
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.48;
orbit.minDistance = 3; orbit.maxDistance = 140;
const R = { t: 0, playing: true, rate: 1, cam: 'auto', fired: new Set(), lastT: 0 };

function slowWindow() {
  const it = G.rec.impactT ?? G.rec.crossT;
  if (it == null) return null;
  return [it - 0.45, it + 0.8];
}

function enterReplay(after) {
  if (!G.rec.frames.length) return;
  G.afterReplay = after;
  G.state = 'replay';
  showScreen('passCard', false); showScreen('endCard', false);
  $('hud').classList.add('hidden');
  $('replayTop').classList.remove('hidden'); $('replayBar').classList.remove('hidden');
  $('visor').classList.add('hidden'); player.helm.visible = true;
  $('rpTitle').textContent = `第 ${G.pass + 1} 轮回放`;
  R.t = 0; R.lastT = 0; R.playing = true; R.fired.clear();
  fx.clear();
  const dur = G.rec.duration;
  const w = slowWindow();
  if (w) {
    $('rpSlow').style.left = `${(w[0] / dur) * 100}%`;
    $('rpSlow').style.width = `${((w[1] - w[0]) / dur) * 100}%`;
    $('rpMark').style.left = `${(((G.rec.impactT ?? G.rec.crossT)) / dur) * 100}%`;
  }
  $('rpPlay').textContent = '暂停回放';
  setReplayCam($('rpCam').value);
  camState.init = false;
}

function exitReplay() {
  $('replayTop').classList.add('hidden'); $('replayBar').classList.add('hidden');
  orbit.enabled = false;
  if (G.afterReplay === 'end') { G.state = 'end'; showScreen('endCard'); }
  else { G.state = 'passCard'; showScreen('passCard'); }
}

function setReplayCam(mode) {
  R.cam = mode;
  orbit.enabled = mode === 'free';
  if (mode === 'free') frameBoth();
}

function frameBoth() {
  const mid = player.root.position.clone().add(opp.root.position).multiplyScalar(0.5);
  mid.y = 1.6;
  const span = player.root.position.distanceTo(opp.root.position);
  orbit.target.copy(mid);
  camera.position.copy(mid).add(new THREE.Vector3(-0.55, 0.42, -0.35).normalize().multiplyScalar(Math.max(10, span * 0.9 + 6)));
  camState.pos.copy(camera.position); camState.look.copy(mid);
  orbit.update();
}

function replayStep(dtReal) {
  const dur = G.rec.duration;
  if (R.playing) {
    const w = slowWindow();
    const inSlow = w && R.t > w[0] && R.t < w[1];
    R.t += dtReal * R.rate * (inSlow ? 0.22 : 1);
    if (R.t >= dur) { R.t = dur; R.playing = false; $('rpPlay').textContent = '重新播放'; }
    $('rpSpeedLbl').textContent = inSlow ? `慢动作 · ${(R.rate * 0.22).toFixed(2)}×` : `正常播放 · ${R.rate}×`;
  }
  if (R.t < R.lastT - 1e-4) { fx.clear(); R.fired.clear(); }
  const s = G.rec.sample(R.t);
  player.applySnapshot(s.p, scene);
  opp.applySnapshot(s.o, scene);
  G.rec.events.forEach((ev, i) => {
    if (ev.t <= R.t && !R.fired.has(i)) {
      R.fired.add(i);
      if (ev.zone) playImpactFx(ev, R.t - ev.t < 0.2);
    }
  });
  const fxDt = R.playing ? (R.t - R.lastT) : 0;
  fx.update(Math.max(0, fxDt));
  R.lastT = R.t;
  $('rpScrub').value = String(Math.round((R.t / Math.max(0.01, dur)) * 1000));
  $('rpTime').textContent = `${R.t.toFixed(1)} / ${dur.toFixed(1)} 秒`;
  const it = G.rec.impactT ?? G.rec.crossT ?? dur;
  $('rpPhase').textContent = R.t < it - 0.25 ? '双方正在接近' : R.t < it + 0.5 ? '交锋！' : '冲过栏尾';

  // cameras
  const mid = _w.copy(player.root.position).add(opp.root.position).multiplyScalar(0.5);
  let mode = R.cam;
  if (mode === 'auto') mode = R.t < it - 1.5 ? 'track' : R.t < it + 1.4 ? 'impact' : (G.unhorsed === 'p' ? 'fallP' : G.unhorsed === 'o' ? 'fallO' : 'sideWide');
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  switch (mode) {
    case 'free':
      orbit.update();
      camState.pos.copy(camera.position); camState.look.copy(orbit.target);
      return;
    case 'player': chaseTarget(player, pos, look); break;
    case 'opp': chaseTarget(opp, pos, look); break;
    case 'side': pos.set(-6.6, 2.6, player.z - 3); look.set(0, 1.8, player.z + 6); break;
    case 'track': {
      // low tracking shot just ahead of the player's horse, looking back at it
      const pz = player.z;
      pos.set(-3.5, 1.25, pz + 6.5); look.set(-0.9, 1.9, pz);
      break;
    }
    case 'sideWide': pos.set(-9, 4.5, G.crossZ - 4); look.set(0, 1.6, G.crossZ + 4); break;
    case 'impact': {
      const a = 0.8 + (R.t - it) * 0.35;
      pos.set(-6.4 + Math.sin(a) * 0.3, 2.3, G.crossZ - 5.5 + (R.t - it) * 0.6);
      look.set(0.3, 2.0, G.crossZ + 0.3);
      break;
    }
    case 'fallP': case 'fallO': {
      const r = mode === 'fallP' ? player : opp;
      const k = r.knight.getWorldPosition(new THREE.Vector3());
      pos.set(k.x < 0 ? -5.5 : 5.5, 2.4, k.z - 4 * r.facing); look.copy(k);
      break;
    }
  }
  if (mode !== R.lastMode) { R.lastMode = mode; camState.init = false; }
  const fov = mode === 'impact' ? 34 : mode === 'track' ? 50 : 55;
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  applyCam(pos, look, dtReal, mode === 'track' ? 12 : 4);
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let wallT = 0;
const proj = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  let dtReal = Math.min(clock.getDelta(), 1 / 20);
  if (FIXED_DT) dtReal = FIXED_DT;
  wallT += dtReal;
  if (G.paused) { composer.render(); return; }

  // slow-mo envelope after contact
  let ts = 1;
  if (G.slow > 0) {
    G.slow -= dtReal;
    ts = G.slow > 0.35 ? 0.16 : 0.16 + (1 - G.slow / 0.35) * 0.84;
  }
  const dt = dtReal * ts;
  G.shake = Math.max(0, G.shake - dtReal * 2.2);
  G.hitFlash = Math.max(0, (G.hitFlash || 0) - dtReal * 2.5);

  switch (G.state) {
    case 'title': {
      // slow establishing orbit behind the title card
      const a = wallT * 0.05;
      camera.position.set(Math.sin(a) * 42, 16 + Math.sin(wallT * 0.1) * 3, Math.cos(a) * 42 - 4);
      camera.lookAt(0, 3, 10);
      player.animate(dtReal); opp.animate(dtReal);
      break;
    }
    case 'intro': {
      G.timer += dtReal;
      const T = 4.6;
      const f = smooth(clamp(G.timer / T, 0, 1));
      const p = G.introCurve.getPoint(f);
      const L = G.introLook;
      const look = f < 0.5 ? L[0].clone().lerp(L[1], smooth(f * 2)) : L[1].clone().lerp(L[2], smooth((f - 0.5) * 2));
      applyCam(p, look, dtReal, Infinity);
      player.animate(dtReal); opp.animate(dtReal);
      if (G.timer >= T) { G.state = 'countdown'; G.timer = 0; G.lastCount = -1; }
      break;
    }
    case 'countdown': {
      G.timer += dtReal;
      const n = Math.floor(G.timer / 0.85);
      if (n !== G.lastCount) {
        G.lastCount = n;
        if (n < 3) { announce('准备迎战', String(3 - n), '', '', 900); sound.drum(); }
        else { announce('', '冲锋！', 'CHARGE', 'gold', 1000); sound.horn(false); sound.whoosh(); world.cheer(0, 0.7); beginCharge(); }
      }
      player.animate(dtReal); opp.animate(dtReal);
      updateChaseCam(dtReal);
      break;
    }
    case 'charge':
    case 'runout': {
      simulate(dt);
      updateChaseCam(dtReal);
      if (G.state === 'runout' && G.crossedFor > 3.4) endPassToCard();
      break;
    }
    case 'passCard': case 'end': {
      // keep the world alive behind the card
      for (const r of [player, opp]) {
        r.speed = Math.max(0, r.speed - dtReal * 4);
        r.place(r.x, r.z + r.speed * r.facing * dtReal);
        r.animate(dtReal); r.stepTumblers(dtReal);
      }
      const k = (G.unhorsed === 'p' ? player : G.unhorsed === 'o' ? opp : null);
      if (k) {
        const kp = k.knight.getWorldPosition(new THREE.Vector3());
        applyCam(new THREE.Vector3(kp.x < 0 ? -6 : 6, 3.2, kp.z - 5 * k.facing), kp, dtReal, 1.5);
      } else {
        const a = wallT * 0.08;
        applyCam(new THREE.Vector3(-8 + Math.sin(a) * 2, 4, G.crossZ - 10), new THREE.Vector3(0, 1.8, G.crossZ + 6), dtReal, 1.2);
      }
      break;
    }
    case 'replay':
      replayStep(dtReal);
      break;
    case 'debug':
      player.animate(dtReal); opp.animate(dtReal);
      camState.look.copy(G.debugLook || camState.look);
      break;
  }

  if (G.state !== 'replay') fx.update(dt);
  world.update(wallT, dtReal);
  world.focusShadow(_v.copy(camState.look.lengthSq() ? camState.look : camera.position));
  updateHud(dtReal);
  gradePass.uniforms.time.value = wallT;
  gradePass.uniforms.hit.value = G.hitFlash || 0;
  composer.render();
}

function updateChaseCam(dtReal) {
  if (G.view === 'helm') { helmCam(); camState.init = false; return; }
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  chaseTarget(player, pos, look);
  // drift wider after the crossing so you can see the result
  if (G.crossed) {
    const k = smooth(clamp(G.crossedFor / 1.5, 0, 1));
    pos.add(_v.set(-1.8 * k, 1.2 * k, -2.5 * k));
    if (G.unhorsed === 'o') look.lerp(opp.knight.getWorldPosition(_w), k * 0.85);
  }
  const fov = 54 + clamp(player.speed, 0, 16) * 0.55;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * damp(3, dtReal); camera.updateProjectionMatrix(); }
  applyCam(pos, look, dtReal, 6);
}

function updateHud() {
  if (!['countdown', 'charge', 'runout'].includes(G.state)) return;
  const kmh = Math.round(player.speed * 3.6);
  $('speedVal').textContent = kmh;
  $('speedBar').style.width = `${clamp(kmh / 60, 0, 1) * 100}%`;
  $('spurHint').classList.toggle('on', input.spur && G.state === 'charge');
  const lbl = $('stanceLbl');
  if (player.unhorsed) { lbl.textContent = '落马'; lbl.className = 'lbl tired'; }
  else if (player.stamina < 0.2 && input.brace) { lbl.textContent = '体力不支'; lbl.className = 'lbl tired'; }
  else if (player.brace > 0.6) { lbl.textContent = '稳身架枪'; lbl.className = 'lbl braced'; }
  else { lbl.textContent = '安坐鞍上'; lbl.className = 'lbl'; }
  $('stamBar').style.width = `${player.stamina * 100}%`;
  $('braceBar').style.width = `${player.brace * player.stamina * 100}%`;

  // reticle sits on the real lance tip, coloured by the zone it would strike when the foe passes;
  // a small dot marks the cursor so the lance's lag is readable
  const ret = $('reticle');
  const showRet = G.state === 'charge' && player.lanceLower > 0.4 && !player.struck;
  ret.classList.toggle('hidden', !showRet);
  $('aimCursor').classList.toggle('hidden', !showRet);
  const e = eta();
  player.lanceTipWorld(tmpTip);
  const tl = player.root.worldToLocal(tmpTip.clone());
  ghost.position.set(2 * LANE, 0, tl.z);
  if (showRet) {
    proj.copy(tmpTip).project(camera);
    ret.style.transform = `translate(${(proj.x * 0.5 + 0.5) * window.innerWidth}px, ${(-proj.y * 0.5 + 0.5) * window.innerHeight}px)`;
    $('aimCursor').style.transform = `translate(${(input.ax * 0.5 + 0.5) * window.innerWidth}px, ${(input.ay * 0.5 + 0.5) * window.innerHeight}px)`;
    const hit = classify(-(tl.x - 2 * LANE), tl.y - PELVIS_Y);
    ret.className = hit.zone === 'helm' ? 'helm' : hit.zone === 'shield' || hit.zone === 'body' ? 'shield' : hit.zone === 'low' ? '' : 'miss';
    $('retLabel').textContent = hit.zone ? `${ZONES[hit.zone].name} +${ZONES[hit.zone].points}` : '落空';
  }
  setGhostOpacity(G.state === 'charge' && !player.struck && G.view === 'chase' ? (0.2 + clamp((4.2 - e) / 2.5, 0, 1) * 0.4) * player.lanceLower : 0);

  // distance tag over the opponent
  const tag = $('foeTag');
  const dist = opp.z - player.z;
  const showTag = G.state !== 'runout' && dist > 14;
  tag.classList.toggle('hidden', !showTag);
  if (showTag) {
    opp.helm.getWorldPosition(proj); proj.y += 0.75;
    proj.project(camera);
    if (proj.z < 1) {
      tag.style.left = `${(proj.x * 0.5 + 0.5) * window.innerWidth}px`;
      tag.style.top = `${(-proj.y * 0.5 + 0.5) * window.innerHeight}px`;
      $('foeDist').textContent = `赤鹿骑士 · ${Math.round(dist)}m`;
    }
  }
}

// ------------------------------------------------------------------ input
function setAimFromPointer(x, y) {
  input.ax = (x / window.innerWidth) * 2 - 1;
  input.ay = (y / window.innerHeight) * 2 - 1;
}
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') setAimFromPointer(e.clientX, e.clientY); });
canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) setAimFromPointer(t.clientX, t.clientY); }, { passive: true });
canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) setAimFromPointer(t.clientX, t.clientY); }, { passive: true });

window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'Space') return;
  switch (e.code) {
    case 'Space': input.brace = true; e.preventDefault(); if (G.state === 'intro') { G.timer = 99; } break;
    case 'KeyW': case 'ArrowUp': case 'ShiftLeft': case 'ShiftRight': input.spur = true; break;
    case 'KeyS': case 'ArrowDown': input.rein = true; break;
    case 'KeyV': setView(G.view === 'chase' ? 'helm' : 'chase'); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyH': toggleHelp(); break;
    case 'Escape': case 'KeyP':
      if (!$('help').classList.contains('hidden')) toggleHelp();
      else if (['intro', 'countdown', 'charge', 'runout'].includes(G.state)) togglePause();
      else if (G.state === 'replay') exitReplay();
      break;
    case 'KeyR': if (G.state === 'passCard') enterReplay('pass'); else if (G.state === 'end') enterReplay('end'); break;
    case 'Enter': case 'NumpadEnter':
      if (G.state === 'passCard') nextFromCard();
      else if (G.state === 'replay') exitReplay();
      else if (G.state === 'end') { showScreen('endCard', false); startMatch(); }
      else if (G.state === 'title') $('btnStart').click();
      break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'Space': input.brace = false; break;
    case 'KeyW': case 'ArrowUp': case 'ShiftLeft': case 'ShiftRight': input.spur = false; break;
    case 'KeyS': case 'ArrowDown': input.rein = false; break;
  }
});
window.addEventListener('blur', () => { input.brace = input.spur = input.rein = false; });
const holdBtn = (id, key) => {
  const el = $(id);
  const on = (v) => (e) => { e.preventDefault(); input[key] = v; el.classList.toggle('on', v); };
  el.addEventListener('pointerdown', on(true));
  el.addEventListener('pointerup', on(false));
  el.addEventListener('pointerleave', on(false));
};
holdBtn('tBrace', 'brace'); holdBtn('tSpur', 'spur');

function togglePause() {
  G.paused = !G.paused;
  showScreen('pause', G.paused);
  document.body.classList.toggle('aiming', !G.paused && G.state === 'charge');
}
function toggleHelp() {
  const open = $('help').classList.contains('hidden');
  showScreen('help', open);
  if (['intro', 'countdown', 'charge', 'runout'].includes(G.state)) { G.paused = open; }
}
function toggleMute() {
  sound.setMuted(!sound.muted);
  $('btnMute').textContent = sound.muted ? '静音' : '声音';
}

document.querySelectorAll('#diffPick button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#diffPick button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  G.diff = DIFFICULTY[b.dataset.d];
  sound.init(); sound.tick();
}));
$('btnStart').addEventListener('click', () => {
  sound.init();
  showScreen('title', false);
  startMatch();
});
$('btnHelp').addEventListener('click', toggleHelp);
$('btnHelpClose').addEventListener('click', toggleHelp);
$('btnMute').addEventListener('click', toggleMute);
$('btnView').addEventListener('click', () => setView(G.view === 'chase' ? 'helm' : 'chase'));
$('btnResume').addEventListener('click', togglePause);
$('btnRestart').addEventListener('click', () => { togglePause(); startMatch(); });
$('btnReplay').addEventListener('click', () => enterReplay('pass'));
$('btnNext').addEventListener('click', nextFromCard);
$('btnEndReplay').addEventListener('click', () => enterReplay('end'));
$('btnAgain').addEventListener('click', () => { showScreen('endCard', false); startMatch(); });
$('rpSkip').addEventListener('click', exitReplay);
$('rpPlay').addEventListener('click', () => {
  if (!R.playing && R.t >= G.rec.duration - 1e-3) { R.t = 0; R.lastT = 0; fx.clear(); R.fired.clear(); }
  R.playing = !R.playing;
  $('rpPlay').textContent = R.playing ? '暂停回放' : '继续回放';
});
$('rpCam').addEventListener('change', (e) => { setReplayCam(e.target.value); e.target.blur(); });
$('rpRate').addEventListener('change', (e) => { R.rate = parseFloat(e.target.value); e.target.blur(); });
$('rpFrame').addEventListener('click', () => { $('rpCam').value = 'free'; setReplayCam('free'); });
$('rpScrub').addEventListener('input', (e) => {
  R.playing = false; $('rpPlay').textContent = '继续回放';
  R.t = (parseInt(e.target.value, 10) / 1000) * G.rec.duration;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ boot
resetRiders();
// park the riders at their ends for the title shot
G.state = 'title';
showScreen('loading', false);
// test hook: ?autostart=1 skips the title (used for screenshots)
if (params.get('autostart')) { showScreen('title', false); startMatch(); }
window.__game = { G, R, player, opp, input, camera, ai, startMatch, enterReplay, setView };
frame();
