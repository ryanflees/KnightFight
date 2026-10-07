// Joust rules: hit zones, impact resolution, scoring and the opponent AI.
//
// Hit zones are expressed in the *target's* frame at the moment the lance tip
// crosses the target's chest plane:
//   lx — lateral offset, positive toward the target's LEFT (its shield side, facing the barrier)
//   dy — height above the target's pelvis
// The attacker's aim (ax, ay) maps onto that as lx = -ax, y = ay.

export const ZONES = {
  helm:   { name: '头盔', en: 'HELM',   lx: 0.0,  dy: 0.93, r: 0.2, points: 3 },
  shield: { name: '盾牌', en: 'SHIELD', lx: 0.40, dy: 0.40, hw: 0.25, hh: 0.37, points: 2 },
  body:   { name: '胸甲', en: 'BREASTPLATE', lx: -0.03, dy: 0.42, hw: 0.28, hh: 0.38, points: 2 },
  low:    { name: '腿甲', en: 'TASSETS', points: 1 },
};

export const DIFFICULTY = {
  squire:   { label: '侍从', aimErr: 0.24, braceSkill: 0.45, helmChance: 0.08, gallop: 12.5, sway: 1.15 },
  knight:   { label: '骑士', aimErr: 0.14, braceSkill: 0.72, helmChance: 0.22, gallop: 13.6, sway: 1.0 },
  champion: { label: '冠军', aimErr: 0.07, braceSkill: 0.92, helmChance: 0.38, gallop: 14.6, sway: 0.85 },
};

// Which zone (if any) a point lies in. Returns {zone, q} where q ∈ [0,1] is how square the hit is.
export function classify(lx, dy) {
  const H = ZONES.helm;
  const dh = Math.hypot(lx - H.lx, (dy - H.dy) * 0.9);
  if (dh < H.r) return { zone: 'helm', q: 1 - dh / H.r };
  const S = ZONES.shield;
  // heater shield: narrower toward the bottom point
  const sy = (dy - S.dy) / S.hh;
  const taper = sy < 0 ? 1 + sy * 0.55 : 1;
  const sx = (lx - S.lx) / (S.hw * Math.max(0.25, taper));
  if (Math.abs(sx) < 1 && Math.abs(sy) < 1) return { zone: 'shield', q: 1 - Math.max(Math.abs(sx), Math.abs(sy)) * 0.85 };
  const B = ZONES.body;
  const bx = (lx - B.lx) / B.hw, by = (dy - B.dy) / B.hh;
  if (Math.abs(bx) < 1 && Math.abs(by) < 1) return { zone: 'body', q: 1 - Math.max(Math.abs(bx), Math.abs(by)) * 0.9 };
  if (dy > -0.35 && dy < 0.06 && Math.abs(lx) < 0.45) return { zone: 'low', q: 0.3 };
  return { zone: null, q: 0 };
}

// Effective brace = how firmly the rider is set in the saddle right now.
export function effectiveBrace(r) { return r.brace * (0.35 + 0.65 * r.stamina); }

// Resolve one lance strike.
//   hit: result of classify()
//   att/def: { speed, brace, stamina, braceHeldFor }
// Returns { zone, broke, points, unhorse, power, label, perfect }
export function resolveStrike(hit, att, def, rand = Math.random) {
  if (!hit.zone) return { zone: null, broke: false, points: 0, unhorse: false, power: 0, label: '落空', en: 'MISS' };
  const closing = att.speed + def.speed;
  const speedF = Math.min(1.25, Math.max(0.45, closing / 27));
  const attB = effectiveBrace(att), defB = effectiveBrace(def);
  // perfect brace: set within ~0.9 s of impact and not tired
  const perfect = att.brace > 0.95 && att.braceHeldFor > 0.05 && att.braceHeldFor < 0.95 && att.stamina > 0.45;
  const power = speedF * (0.5 + 0.5 * attB) * (perfect ? 1.15 : 1);
  const zone = hit.zone;
  let broke = false, points = 0;
  if (zone === 'low') {
    points = 1;
  } else {
    const breakScore = hit.q * 0.65 + power * 0.55 + (rand() - 0.5) * 0.18;
    broke = breakScore > (zone === 'helm' ? 0.62 : 0.7);
    points = broke ? ZONES[zone].points : 1;
  }
  // unhorsing
  const zoneW = { helm: 1.25, body: 1.05, shield: 0.85, low: 0.25 }[zone];
  const push = power * zoneW * (0.45 + 0.55 * hit.q);
  const stability = 0.38 + 0.62 * defB;
  const unhorse = push - stability > 0.12 + rand() * 0.18;
  const zn = ZONES[zone];
  const label = unhorse ? `落马！击中${zn.name}` : broke ? `碎枪！击中${zn.name}` : `擦过${zn.name}`;
  const en = unhorse ? 'UNHORSED' : broke ? `LANCE BROKEN · ${zn.en}` : `GLANCING BLOW · ${zn.en}`;
  return { zone, broke, points, unhorse, power, label, en, perfect, q: hit.q };
}

function gauss(r = Math.random) {
  return (r() + r() + r() + r() - 2) / 2; // approx N(0, ~0.58)
}

// Opponent brain. Picks a target each pass, aims with error + sway, and times its brace.
export class AIController {
  constructor(diff) { this.diff = diff; }
  beginPass(passIndex, scoreDiff) {
    const d = this.diff;
    // gets bolder when behind
    const boldness = d.helmChance + (scoreDiff < 0 ? 0.15 : 0) + passIndex * 0.03;
    const goHelm = Math.random() < boldness;
    const tz = goHelm ? ZONES.helm : (Math.random() < 0.75 ? ZONES.shield : ZONES.body);
    this.targetLx = tz.lx + gauss() * d.aimErr;
    this.targetDy = tz.dy + gauss() * d.aimErr;
    // brace timing
    const skilled = Math.random() < d.braceSkill;
    this.braceLead = skilled ? 0.45 + Math.random() * 0.45 : (Math.random() < 0.5 ? 1.8 + Math.random() * 1.2 : 0.12);
    this.spurTime = 1 + Math.random() * 1.5;
    this.wobbleSeed = Math.random() * 100;
  }
  // returns desired { lx, dy, brace, spur }
  think(t, eta) {
    const corr = Math.max(0, Math.min(1, (eta - 0.3) / 3)); // re-aims less as it gets close
    return {
      lx: this.targetLx + Math.sin(t * 0.9 + this.wobbleSeed) * 0.12 * corr,
      dy: this.targetDy + Math.cos(t * 0.7 + this.wobbleSeed) * 0.1 * corr,
      brace: eta < this.braceLead && eta > -0.4,
      spur: t > this.spurTime,
    };
  }
}
