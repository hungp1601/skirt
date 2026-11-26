// =========================================================================
// MATH UTILITIES & UNIFIED LEG SURFACE (Supports Analytical OR Scanned GLB!)
// =========================================================================
export let LEG_Y_TOP = 1.62;
export let LEG_Y_BOT = 0.02;
export let LEG_Y_SPAN = LEG_Y_TOP - LEG_Y_BOT;

let customProfile = null;

export function setCustomLegProfile(profile) {
  customProfile = profile;
  if (profile) {
    LEG_Y_TOP = profile.yTop;
    LEG_Y_BOT = profile.yBot;
    LEG_Y_SPAN = profile.ySpan;
  } else {
    LEG_Y_TOP = 1.62;
    LEG_Y_BOT = 0.02;
    LEG_Y_SPAN = 1.60;
  }
}

export function getCustomLegProfile() {
  return customProfile;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

export function smoothstep(e0, e1, x) {
  const u = clamp((x - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
}

export function gauss(x, mean, sigma) {
  const d = (x - mean) / sigma;
  return Math.exp(-0.5 * d * d);
}

export function legYFromT(t) {
  return LEG_Y_TOP - clamp(t, 0, 1) * LEG_Y_SPAN;
}

export function legTFromY(y) {
  return clamp((LEG_Y_TOP - y) / LEG_Y_SPAN, 0, 1);
}

export function getLegCenter(side, t) {
  const ct = clamp(t, 0, 1);
  const y = legYFromT(ct);

  if (customProfile) {
    const key = side < 0 ? '-1' : '1';
    const f = ct * (customProfile.NS - 1);
    const s0 = Math.floor(f);
    const s1 = Math.min(customProfile.NS - 1, s0 + 1);
    const frac = f - s0;
    const cx = customProfile.cxArr[key][s0] * (1 - frac) + customProfile.cxArr[key][s1] * frac;
    const cz = customProfile.czArr[key][s0] * (1 - frac) + customProfile.czArr[key][s1] * frac;
    return { cx, y, cz };
  }

  const cx = side * (
    0.146
    + 0.022 * (1 - smoothstep(0.0, 0.36, ct))
    - 0.017 * gauss(ct, 0.42, 0.16)
    + 0.015 * smoothstep(0.75, 1.0, ct)
  );
  const footShift = smoothstep(0.86, 1.0, ct) * 0.085;
  const cz =
    0.014 * gauss(ct, 0.42, 0.12)
    - 0.023 * gauss(ct, 0.64, 0.14)
    + footShift;
  return { cx, y, cz };
}

export function getLegSkinRadius(side, t, theta) {
  const ct = clamp(t, 0, 1);

  if (customProfile) {
    const key = side < 0 ? '-1' : '1';
    const { NS, NA, radArr } = customProfile;
    const arr = radArr[key];
    const sf = ct * (NS - 1);
    const s0 = Math.floor(sf);
    const s1 = Math.min(NS - 1, s0 + 1);
    const st = sf - s0;

    let ang = theta % (Math.PI * 2);
    if (ang < 0) ang += Math.PI * 2;
    const af = (ang / (Math.PI * 2)) * NA;
    const a0 = Math.floor(af) % NA;
    const a1 = (a0 + 1) % NA;
    const at = af - Math.floor(af);

    const r00 = arr[s0 * NA + a0], r01 = arr[s0 * NA + a1];
    const r10 = arr[s1 * NA + a0], r11 = arr[s1 * NA + a1];
    const r0 = r00 + (r01 - r00) * at;
    const r1 = r10 + (r11 - r10) * at;
    return Math.max(0.032, r0 + (r1 - r0) * st);
  }

  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const thighEnv = 1 - smoothstep(0.0, 0.46, ct);
  const kneeEnv = gauss(ct, 0.42, 0.075);
  const calfEnv = gauss(ct, 0.62, 0.125);
  const anklePinch = gauss(ct, 0.88, 0.062);
  const footBlend = smoothstep(0.87, 1.0, ct);

  const rx = 0.057
    + 0.070 * Math.pow(thighEnv, 0.84)
    + 0.011 * kneeEnv
    + 0.025 * calfEnv
    - 0.014 * anklePinch
    + 0.008 * footBlend;

  const rz = 0.059
    + 0.078 * Math.pow(thighEnv, 0.87)
    + 0.014 * kneeEnv
    + 0.033 * calfEnv
    - 0.012 * anklePinch
    + 0.056 * footBlend;

  const denom = Math.hypot(cosT / rx, sinT / rz) || 1;
  let r = 1 / denom;

  r += 0.0065 * kneeEnv * Math.max(0, sinT);
  r -= 0.0055 * kneeEnv * Math.max(0, -sinT);
  r += 0.011 * calfEnv * Math.max(0, -sinT);
  const innerSide = Math.max(0, -side * cosT);
  r += 0.006 * thighEnv * innerSide;
  if (footBlend > 0.01 && sinT < 0) {
    r -= 0.018 * footBlend * (-sinT);
  }

  return Math.max(0.028, r);
}

export function sampleLegSurface(side, t, theta, radialOffset = 0) {
  const { cx, y, cz } = getLegCenter(side, t);
  const r = getLegSkinRadius(side, t, theta) + radialOffset;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return { x: cx + r * cosT, y, z: cz + r * sinT, nx: cosT, ny: 0, nz: sinT, cx, cz, r };
}

export function createTileableNoise(seed = 1337) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const gridSize = 64;
  const g = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < g.length; i++) g[i] = rand();

  const sample = (x, y, periodX, periodY) => {
    const px = Math.min(gridSize, periodX);
    const py = Math.min(gridSize, periodY);
    const gx = ((x % px) + px) % px;
    const gy = ((y % py) + py) % py;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const ix1 = (ix + 1) % px, iy1 = (iy + 1) % py;
    const v00 = g[iy * gridSize + ix];
    const v10 = g[iy * gridSize + ix1];
    const v01 = g[iy1 * gridSize + ix];
    const v11 = g[iy1 * gridSize + ix1];
    const nx0 = v00 + (v10 - v00) * ux;
    const nx1 = v01 + (v11 - v01) * ux;
    return nx0 + (nx1 - nx0) * uy;
  };

  const fbm = (u, v, baseFreqX, baseFreqY, octaves = 4) => {
    let sum = 0, amp = 0.5, norm = 0, fx = baseFreqX, fy = baseFreqY;
    for (let o = 0; o < octaves; o++) {
      sum += sample(u * fx, v * fy, fx, fy) * amp;
      norm += amp;
      amp *= 0.5;
      fx *= 2;
      fy *= 2;
    }
    return sum / norm;
  };

  return { sample, fbm };
}
