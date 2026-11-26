import * as THREE from 'three';
import { clamp, smoothstep, gauss, createTileableNoise } from './math.js';

// =========================================================================
// PROCEDURAL PBR TEXTURES & STUDIO SOFTBOX ENVIRONMENT
// =========================================================================

// 2-ply twisted braided nylon yarn textures (albedo, fuzzy alpha, cylindrical normal, roughness)
export function createBraidedYarnTextures() {
  const w = 128, h = 256;
  const colorC = document.createElement('canvas'); colorC.width = w; colorC.height = h;
  const alphaC = document.createElement('canvas'); alphaC.width = w; alphaC.height = h;
  const normC  = document.createElement('canvas'); normC.width  = w; normC.height  = h;
  const roughC = document.createElement('canvas'); roughC.width = w; roughC.height = h;

  const cCtx = colorC.getContext('2d');
  const aCtx = alphaC.getContext('2d');
  const nCtx = normC.getContext('2d');
  const rCtx = roughC.getContext('2d');

  const cImg = cCtx.createImageData(w, h);
  const aImg = aCtx.createImageData(w, h);
  const nImg = nCtx.createImageData(w, h);
  const rImg = rCtx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const s = (u - 0.5) * 2;
      const dist = Math.abs(s);

      const twistPhase = v * Math.PI * 12;
      const ply1 = Math.sin(twistPhase + s * 2.8);
      const ply2 = Math.sin(twistPhase * 2.0 - s * 4.2);
      const edgeRipple = 0.045 * Math.sin(twistPhase * 2);
      const effectiveDist = dist / (0.88 + edgeRipple);

      const microNoise = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const fuzz = Math.abs(microNoise) * 0.14;
      const alphaRaw = clamp(1.0 - smoothstep(0.72, 1.0, effectiveDist - fuzz * 0.25), 0, 1);

      const nzBase = Math.sqrt(Math.max(0.05, 1.0 - clamp(s * s * 0.92, 0, 0.95)));
      const bumpU = 0.26 * Math.cos(twistPhase + s * 2.8) + 0.10 * ply2;
      const bumpV = 0.30 * Math.cos(twistPhase + s * 2.8);
      let nx = s * 0.85 + bumpU;
      let ny = bumpV;
      let nz = nzBase;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen; ny /= nLen; nz /= nLen;

      const groove = 0.5 + 0.5 * ply1;
      const coreShade = 0.72 + 0.28 * nzBase;
      const val = clamp((0.76 + 0.24 * groove) * coreShade, 0.35, 1.0);
      const cByte = Math.floor(val * 255);
      const rough = clamp(0.42 + (1 - groove) * 0.28 + dist * 0.15, 0.25, 0.92);
      const rByte = Math.floor(rough * 255);

      const idx = (y * w + x) * 4;
      cImg.data[idx] = cByte; cImg.data[idx + 1] = cByte; cImg.data[idx + 2] = cByte; cImg.data[idx + 3] = 255;

      const aByte = Math.floor(alphaRaw * 255);
      aImg.data[idx] = aByte; aImg.data[idx + 1] = aByte; aImg.data[idx + 2] = aByte; aImg.data[idx + 3] = 255;

      nImg.data[idx]     = Math.floor((nx * 0.5 + 0.5) * 255);
      nImg.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      nImg.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      nImg.data[idx + 3] = 255;

      rImg.data[idx] = rByte; rImg.data[idx + 1] = rByte; rImg.data[idx + 2] = rByte; rImg.data[idx + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  aCtx.putImageData(aImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const mk = (canvas, isSRGB = false) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (isSRGB) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    map: mk(colorC, true),
    alphaMap: mk(alphaC),
    normalMap: mk(normC),
    roughnessMap: mk(roughC)
  };
}

// Knitted interlocking knot texture
export function createKnotTextures() {
  const size = 64;
  const aC = document.createElement('canvas'); aC.width = size; aC.height = size;
  const nC = document.createElement('canvas'); nC.width = size; nC.height = size;
  const aCtx = aC.getContext('2d');
  const nCtx = nC.getContext('2d');
  const aImg = aCtx.createImageData(size, size);
  const nImg = nCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const ny = (y / (size - 1)) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = (x / (size - 1)) * 2 - 1;
      const r = Math.hypot(nx * 1.08, ny * 0.96);
      const a = clamp(1 - smoothstep(0.62, 0.96, r), 0, 1);
      const nz = Math.sqrt(Math.max(0.05, 1 - clamp(r * r, 0, 0.95)));
      const cross = 0.16 * Math.sin((nx + ny) * 6.0);
      const idx = (y * size + x) * 4;
      const ab = Math.floor(a * 255);
      aImg.data[idx] = ab; aImg.data[idx + 1] = ab; aImg.data[idx + 2] = ab; aImg.data[idx + 3] = 255;
      nImg.data[idx] = Math.floor(((nx * 0.7 + cross) * 0.5 + 0.5) * 255);
      nImg.data[idx + 1] = Math.floor(((ny * 0.7 - cross) * 0.5 + 0.5) * 255);
      nImg.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      nImg.data[idx + 3] = 255;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);
  return {
    alphaMap: new THREE.CanvasTexture(aC),
    normalMap: new THREE.CanvasTexture(nC)
  };
}

// Soft feathered contact shadow texture projected onto skin directly below each strand
export function createContactShadowTexture() {
  const w = 64, h = 16;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0.0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.28, 'rgba(20,8,6,0.45)');
  grad.addColorStop(0.5, 'rgba(18,6,4,0.85)');
  grad.addColorStop(0.72, 'rgba(20,8,6,0.45)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Ultra-fine knitted nylon micro-weave normal map for sheer (non-fishnet) stockings
export function createSheerNylonNormalMap() {
  const size = 256;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wale = Math.sin((x / size) * Math.PI * 64);
      const course = Math.sin((y / size) * Math.PI * 96 + (x % 2) * 0.5);
      const nx = wale * 0.18;
      const ny = course * 0.14;
      const nz = Math.sqrt(Math.max(0.1, 1 - nx * nx - ny * ny));
      const idx = (y * size + x) * 4;
      img.data[idx]     = Math.floor((nx * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 26);
  tex.anisotropy = 8;
  return tex;
}

// Photorealistic silky human leg skin textures (smooth dermis, anatomical roughness, micro-velvet normal)
export function createSkinTextures() {
  const w = 512, h = 1024;
  const colC = document.createElement('canvas'); colC.width = w; colC.height = h;
  const rghC = document.createElement('canvas'); rghC.width = w; rghC.height = h;
  const cCtx = colC.getContext('2d');
  const rCtx = rghC.getContext('2d');
  const cImg = cCtx.createImageData(w, h);
  const rImg = rCtx.createImageData(w, h);

  const nMelanin = createTileableNoise(101);
  const nHemo    = createTileableNoise(202);
  const nOil     = createTileableNoise(404);

  const angDist = (a, b) => {
    const d = Math.abs(a - b);
    return d > 0.5 ? 1.0 - d : d;
  };

  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const dFront = angDist(u, 0.25);
      const dBack  = angDist(u, 0.75);
      const dInner = angDist(u, 0.50);

      const mel = nMelanin.fbm(u, t, 4, 8, 3) - 0.5;
      const hem = nHemo.fbm(u, t, 6, 12, 3) - 0.5;

      let r = 241, g = 205, b = 187;

      const skirtAO = (1 - smoothstep(0.0, 0.16, t)) * 0.09;
      const innerAO = gauss(dInner, 0, 0.15) * (1 - smoothstep(0.0, 0.44, t)) * 0.04;
      const shinGlow = gauss(dFront, 0, 0.13) * gauss(t, 0.62, 0.22) * 0.025;
      const thighGlow = gauss(dFront, 0, 0.16) * gauss(t, 0.24, 0.12) * 0.020;

      const kneeBlush = gauss(t, 0.42, 0.060) * gauss(dFront, 0, 0.15);
      const poplitealSoft = gauss(t, 0.425, 0.040) * gauss(dBack, 0, 0.15);
      const ankleBlush = gauss(t, 0.90, 0.070) * 0.35;
      const footBlush = smoothstep(0.92, 1.0, t) * 0.50;

      let kneeCrease = 0;
      if (poplitealSoft > 0.08) {
        const creaseWave = Math.exp(-Math.pow((t - 0.423) / 0.0055, 2));
        kneeCrease = creaseWave * gauss(dBack, 0, 0.09) * 0.032;
      }

      const coolHint = (
        gauss(dInner, 0, 0.16) * (1 - smoothstep(0.12, 0.48, t)) * 0.5 +
        gauss(dInner, 0, 0.15) * gauss(t, 0.88, 0.08) * 0.5
      ) * 0.018;

      r += mel * 4.5 + hem * 4.2;
      g += mel * 3.2 - hem * 2.6;
      b += mel * 2.0 - hem * 2.2;

      const blush = kneeBlush * 0.11 + ankleBlush * 0.06 + footBlush * 0.08;
      r += blush * 10;
      g -= blush * 15;
      b -= blush * 13;

      r -= coolHint * 24;
      b += coolHint * 12;

      const shade = 1.0 - skirtAO - innerAO - poplitealSoft * 0.038 - kneeCrease + shinGlow + thighGlow;
      r = clamp(r * shade, 48, 252);
      g = clamp(g * shade, 38, 244);
      b = clamp(b * shade, 34, 236);

      const idx = (y * w + x) * 4;
      cImg.data[idx] = r; cImg.data[idx + 1] = g; cImg.data[idx + 2] = b; cImg.data[idx + 3] = 255;

      const oilCloud = (nOil.fbm(u, t, 6, 12, 3) - 0.5) * 0.045;
      const rough = 0.53 + oilCloud - shinGlow * 1.1 - thighGlow * 0.8 + kneeBlush * 0.055 + poplitealSoft * 0.04;
      const rByte = Math.floor(clamp(rough, 0.44, 0.66) * 255);
      rImg.data[idx] = rByte; rImg.data[idx + 1] = rByte; rImg.data[idx + 2] = rByte; rImg.data[idx + 3] = 255;
    }
  }

  cCtx.putImageData(cImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const marks = [
    { x: w * 0.20, y: h * 0.28, r: 1.1, a: 0.16 },
    { x: w * 0.32, y: h * 0.59, r: 1.0, a: 0.13 }
  ];
  for (const m of marks) {
    const gMark = cCtx.createRadialGradient(m.x, m.y, 0.1, m.x, m.y, m.r * 2.0);
    gMark.addColorStop(0, `rgba(128, 86, 68, ${m.a})`);
    gMark.addColorStop(1, 'rgba(128, 86, 68, 0)');
    cCtx.fillStyle = gMark;
    cCtx.beginPath();
    cCtx.arc(m.x, m.y, m.r * 2.0, 0, Math.PI * 2);
    cCtx.fill();
  }

  // Ultra-fine microscopic velvet epidermis normal map
  const nw = 512, nh = 512;
  const heightField = new Float32Array(nw * nh);
  const nMicro = createTileableNoise(707);

  for (let y = 0; y < nh; y++) {
    const v = y / nh;
    for (let x = 0; x < nw; x++) {
      const u = x / nw;
      const g1 = nMicro.sample(u * 48, v * 48, 48, 48);
      const g2 = nMicro.sample(u * 64 + 17.3, v * 64 + 31.7, 64, 64);
      heightField[y * nw + x] = g1 * 0.55 + g2 * 0.45;
    }
  }

  const normC = document.createElement('canvas'); normC.width = nw; normC.height = nh;
  const nCtx = normC.getContext('2d');
  const nImg = nCtx.createImageData(nw, nh);
  const strength = 0.42;

  for (let y = 0; y < nh; y++) {
    const ym = (y - 1 + nh) % nh, yp = (y + 1) % nh;
    for (let x = 0; x < nw; x++) {
      const xm = (x - 1 + nw) % nw, xp = (x + 1) % nw;
      const tl = heightField[ym * nw + xm], tc = heightField[ym * nw + x], tr = heightField[ym * nw + xp];
      const ml = heightField[y * nw + xm],                                 mr = heightField[y * nw + xp];
      const bl = heightField[yp * nw + xm], bc = heightField[yp * nw + x], br = heightField[yp * nw + xp];

      const dX = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const dY = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      let nx = -dX * strength, ny = -dY * strength, nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const idx = (y * nw + x) * 4;
      nImg.data[idx]     = Math.floor((nx * 0.5 + 0.5) * 255);
      nImg.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      nImg.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      nImg.data[idx + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);

  const map = new THREE.CanvasTexture(colC);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rghC);
  roughnessMap.flipY = false;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  roughnessMap.anisotropy = 8;

  const normalMap = new THREE.CanvasTexture(normC);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(12, 32);
  normalMap.anisotropy = 8;

  return { map, roughnessMap, normalMap };
}

// Studio softbox PMREM environment map
export function createStudioSoftboxEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1b222e);

  const addSoftbox = (color, w, h, pos, lookAt) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    );
    mesh.position.set(...pos);
    mesh.lookAt(...lookAt);
    envScene.add(mesh);
  };

  addSoftbox(0xfff5ec, 4.8, 7.5, [-4.2, 2.2, 4.6], [0, 1.0, 0]);
  addSoftbox(0xffeadd, 4.6, 6.5, [4.6, 1.6, 3.8], [0, 1.0, 0]);
  addSoftbox(0xf7f5f2, 6.0, 5.0, [0, 6.0, 0.5], [0, 0, 0]);
  addSoftbox(0xffe9da, 2.8, 6.5, [3.8, 2.0, -4.2], [0, 1.0, 0]);
  addSoftbox(0xe4ecff, 2.5, 5.5, [-3.8, 1.8, -4.0], [0, 1.0, 0]);
  addSoftbox(0x524a46, 10, 10, [0, -3.5, 0], [0, 0, 0]);

  const rt = pmrem.fromScene(envScene, 0.068);
  pmrem.dispose();
  return rt.texture;
}

export function createLaceBandTexture() {
  const w = 512, h = 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, 34);

  const scallops = 8;
  const sw = w / scallops;
  for (let i = 0; i < scallops; i++) {
    const cx = (i + 0.5) * sw;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, 36, sw * 0.48, 0, Math.PI);
    ctx.stroke();

    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, 40, sw * 0.30, 0, Math.PI);
    ctx.stroke();

    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(cx + k * 8, 34);
      ctx.lineTo(cx, 36 + sw * 0.44);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, 54, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

export function createSkirtTexture() {
  const w = 512, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Deep tailored Japanese seifuku navy wool-twill base
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0.0, '#141c2b');
  bg.addColorStop(0.14, '#182234');
  bg.addColorStop(0.85, '#192336');
  bg.addColorStop(1.0, '#131b29');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle diagonal twill weave grain
  for (let y = 0; y < h; y += 2) {
    ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.045)';
    ctx.fillRect(x, 0, 1, h);
  }

  // Subtle vertical pleat crease depth (6 pleats per UV tile x 4 tiles = 24 pleats!)
  const pleatsPerTile = 6;
  const pw = w / pleatsPerTile;
  for (let p = 0; p < pleatsPerTile; p++) {
    const x0 = p * pw;
    const g = ctx.createLinearGradient(x0, 0, x0 + pw, 0);
    g.addColorStop(0.00, 'rgba(6, 10, 18, 0.34)');
    g.addColorStop(0.18, 'rgba(255, 255, 255, 0.05)');
    g.addColorStop(0.55, 'rgba(255, 255, 255, 0.02)');
    g.addColorStop(0.88, 'rgba(6, 10, 18, 0.22)');
    g.addColorStop(1.00, 'rgba(6, 10, 18, 0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, h * 0.12, pw, h * 0.88);
  }

  // Structured fitted waistband at top (0..11%) with clean topstitch line
  ctx.fillStyle = '#111826';
  ctx.fillRect(0, 0, w, h * 0.115);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, h * 0.108, w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, h * 0.115, w, 3);

  // Crisp twin ivory sailor hem stripes
  ctx.fillStyle = '#eef2f8';
  ctx.fillRect(0, h - 54, w, 10);
  ctx.fillRect(0, h - 30, w, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, h - 44, w, 2);
  ctx.fillRect(0, h - 22, w, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Texture cổ áo thủy thủ 3D (xanh than wool-twill + 2 viền sọc trắng ngà sắc nét)
export function createSailorCollarTexture() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#172236');
  bg.addColorStop(0.6, '#141e30');
  bg.addColorStop(1, '#101828');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Fine twill texture
  for (let x = 0; x < w; x += 3) {
    ctx.fillStyle = x % 6 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(x, 0, 1, h);
  }

  // Crisp twin ivory sailor stripes running parallel to outer edge (near bottom of collar UV v=0 -> canvas y=h)
  ctx.fillStyle = '#f2f5fb';
  ctx.fillRect(0, h - 58, w, 14);
  ctx.fillRect(0, h - 32, w, 10);

  // Delicate dark hem border
  ctx.fillStyle = '#0d1422';
  ctx.fillRect(0, h - 10, w, 10);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Texture tay áo ngắn thủy thủ (trắng cotton poplin + viền cổ tay xanh than 2 sọc trắng)
export function createSailorSleeveTexture() {
  const w = 512, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#f8f9fc');
  bg.addColorStop(0.75, '#f1f4f9');
  bg.addColorStop(1, '#e8edf6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? 'rgba(175,188,210,0.06)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, y, w, 1);
  }

  // Navy sailor cuff band at sleeve bottom (78%..100%) with twin ivory stripes
  ctx.fillStyle = '#151f33';
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  ctx.fillStyle = '#f1f5fb';
  ctx.fillRect(0, h * 0.835, w, 11);
  ctx.fillRect(0, h * 0.895, w, 9);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, h * 0.78, w, 3);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Texture áo sơ mi thủy thủ nữ sinh Nhật (vải cotton poplin trắng tinh tế, nẹp cúc ngọc trai, túi ngực)
// Quy ước UV: u = 0.25 là mặt trước (+frontTheta), u = 0.75 là mặt sau, v = 1 là vai/cổ (canvas y=0), v = 0 là gấu áo (canvas y=h)
export function createSchoolShirtTexture() {
  const w = 1024, h = 1024;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // 1. Nền vải cotton poplin trắng ngà mềm mại, có chiều sâu tự nhiên
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0.0, '#f8f9fd');
  bg.addColorStop(0.45, '#f3f5fa');
  bg.addColorStop(0.82, '#ebeff7');
  bg.addColorStop(1.0, '#dde3ef');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const frontX = w * 0.25;

  // Đường chiết ly eo tinh tế (tailored princess darts) tạo phom ôm eo thon tự nhiên
  for (const dx of [-105, 105]) {
    const dartG = ctx.createLinearGradient(frontX + dx - 16, 0, frontX + dx + 16, 0);
    dartG.addColorStop(0.0, 'rgba(130,145,175,0)');
    dartG.addColorStop(0.5, 'rgba(130,145,175,0.13)');
    dartG.addColorStop(1.0, 'rgba(130,145,175,0)');
    ctx.fillStyle = dartG;
    ctx.fillRect(frontX + dx - 16, h * 0.42, 32, h * 0.56);
  }

  // Bóng đổ nhẹ ngay dưới đường cổ thủy thủ 3D để cổ áo nổi khối tự nhiên
  ctx.fillStyle = 'rgba(20,30,48,0.10)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h * 0.08);
  ctx.lineTo(frontX + 150, h * 0.08);
  ctx.lineTo(frontX, h * 0.16);
  ctx.lineTo(frontX - 150, h * 0.08);
  ctx.lineTo(0, h * 0.08);
  ctx.closePath();
  ctx.fill();

  // 2. Nẹp cúc áo thanh mảnh chính giữa mặt trước (u = 0.25) chạy dưới cổ chữ V
  ctx.fillStyle = 'rgba(222,228,240,0.48)';
  ctx.fillRect(frontX - 14, h * 0.12, 28, h * 0.88);
  ctx.strokeStyle = 'rgba(158,172,196,0.52)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(frontX - 14, h * 0.12); ctx.lineTo(frontX - 14, h);
  ctx.moveTo(frontX + 14, h * 0.12); ctx.lineTo(frontX + 14, h);
  ctx.stroke();

  // Hàng cúc ngọc trai nhỏ thanh lịch
  for (let i = 0; i < 4; i++) {
    const by = h * (0.34 + i * 0.155);
    ctx.fillStyle = 'rgba(120,134,160,0.34)';
    ctx.beginPath(); ctx.arc(frontX + 1.5, by + 1.5, 5.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fefeff';
    ctx.beginPath(); ctx.arc(frontX, by, 5.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c4cfe0';
    ctx.beginPath(); ctx.arc(frontX - 1.8, by, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(frontX + 1.8, by, 1.1, 0, Math.PI * 2); ctx.fill();
  }

  // 3. Túi ngực trái nhỏ gọn có viền xanh than thanh lịch
  const pX = w * 0.325, pY = h * 0.42, pW = 68, pH = 76;
  ctx.fillStyle = '#eff2f9';
  ctx.beginPath();
  ctx.moveTo(pX, pY); ctx.lineTo(pX + pW, pY);
  ctx.lineTo(pX + pW, pY + pH - 13);
  ctx.lineTo(pX + pW * 0.5, pY + pH);
  ctx.lineTo(pX, pY + pH - 13);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,162,188,0.58)';
  ctx.lineWidth = 2.0;
  ctx.stroke();
  ctx.fillStyle = '#162033';
  ctx.fillRect(pX, pY, pW, 7);

  // 4. Viền cổ trong xanh than mảnh bám sát chữ V (không bị hở trắng dưới mép cổ 3D)
  ctx.fillStyle = '#151f33';
  ctx.fillRect(0, 0, w, h * 0.032);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createConcreteFloorTexture() {
  const size = 512;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#737c89';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6500; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 1 + Math.random() * 14;
    const v = 95 + Math.floor(Math.random() * 48);
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 7},0.055)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStudioBackdropTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(256, 200, 18, 256, 256, 370);
  grad.addColorStop(0, '#324256');
  grad.addColorStop(0.45, '#1b2533');
  grad.addColorStop(1, '#0b1018');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Plain-weave cotton poplin normal + matte roughness map (for tailored schoolgirl shirt & sleeves)
export function createCottonWeaveMaps() {
  const size = 256;
  const nC = document.createElement('canvas'); nC.width = size; nC.height = size;
  const rC = document.createElement('canvas'); rC.width = size; rC.height = size;
  const nCtx = nC.getContext('2d');
  const rCtx = rC.getContext('2d');
  const nImg = nCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const noise = createTileableNoise(811);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sợi dệt mượt, biên độ thấp. Ô caro cứng sẽ vỡ thành ô vuông mờ khi zoom sát.
      const warp = Math.sin((x / size) * Math.PI * 2 * 36);
      const weft = Math.sin((y / size) * Math.PI * 2 * 36);
      const slub = (noise.fbm(x / size, y / size, 6, 6, 3) - 0.5) * 0.12;
      const nx = warp * 0.14 + slub * 0.2;
      const ny = weft * 0.14 - slub * 0.2;
      const height = 0.55 + warp * 0.04 + weft * 0.04;
      const nz = Math.sqrt(Math.max(0.15, 1 - nx * nx - ny * ny));
      const idx = (y * size + x) * 4;
      nImg.data[idx]     = Math.floor((nx * 0.5 + 0.5) * 255);
      nImg.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      nImg.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      nImg.data[idx + 3] = 255;

      // Matte woven cotton roughness (0.80..0.95)
      const rough = clamp(0.86 - (height - 0.5) * 0.12 + slub * 0.15, 0.76, 0.96);
      const rb = Math.floor(rough * 255);
      rImg.data[idx] = rb; rImg.data[idx + 1] = rb; rImg.data[idx + 2] = rb; rImg.data[idx + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const normalMap = new THREE.CanvasTexture(nC);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(42, 42);
  normalMap.anisotropy = 16;

  const roughnessMap = new THREE.CanvasTexture(rC);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(42, 42);
  roughnessMap.anisotropy = 8;

  return { normalMap, roughnessMap };
}

// Heavy diagonal 2/2 serge wool-twill normal + matte roughness map (for pleated skirt & sailor collar)
export function createWoolTwillMaps() {
  const size = 256;
  const nC = document.createElement('canvas'); nC.width = size; nC.height = size;
  const rC = document.createElement('canvas'); rC.width = size; rC.height = size;
  const nCtx = nC.getContext('2d');
  const rCtx = rC.getContext('2d');
  const nImg = nCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const noise = createTileableNoise(937);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Diagonal 45° twill rib (6px pitch) + subtle wool felt grain
      const diag = ((x + y) / 6) * Math.PI * 2;
      const cross = ((x - y) / 4) * Math.PI * 2;
      const woolFuzz = (noise.fbm(x / size, y / size, 10, 10, 3) - 0.5) * 0.28;
      const rib = Math.sin(diag);
      const nx = Math.cos(diag) * 0.36 + Math.cos(cross) * 0.10 + woolFuzz * 0.45;
      const ny = Math.cos(diag) * 0.36 - Math.cos(cross) * 0.10 - woolFuzz * 0.45;
      const nz = Math.sqrt(Math.max(0.15, 1 - nx * nx - ny * ny));

      const idx = (y * size + x) * 4;
      nImg.data[idx]     = Math.floor((nx * 0.5 + 0.5) * 255);
      nImg.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      nImg.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      nImg.data[idx + 3] = 255;

      // Heavy matte serge wool roughness (0.84..0.97)
      const rough = clamp(0.90 - rib * 0.05 + woolFuzz * 0.14, 0.80, 0.98);
      const rb = Math.floor(rough * 255);
      rImg.data[idx] = rb; rImg.data[idx + 1] = rb; rImg.data[idx + 2] = rb; rImg.data[idx + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const normalMap = new THREE.CanvasTexture(nC);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(22, 12);
  normalMap.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rC);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(22, 12);
  roughnessMap.anisotropy = 8;

  return { normalMap, roughnessMap };
}

// Feathered jagged woven-cloth torn edge texture (replaces thin stocking-like LineSegments!)
// v=0 (bottom/attached to intact fabric) -> opaque solid cloth; v=1 (outer torn tip) -> ragged cotton/wool fringe & uneven cloth teeth
export function createTornClothEdgeTexture(baseHex = '#eef1f8', rawEdgeHex = '#ffffff') {
  const w = 256, h = 128;
  const colC = document.createElement('canvas'); colC.width = w; colC.height = h;
  const alpC = document.createElement('canvas'); alpC.width = w; alpC.height = h;
  const cCtx = colC.getContext('2d');
  const aCtx = alpC.getContext('2d');

  // Subtle fabric color grading toward visible lighter raw torn weft/warp threads at tip
  const cGrad = cCtx.createLinearGradient(0, h, 0, 0);
  cGrad.addColorStop(0.0, baseHex);
  cGrad.addColorStop(0.42, baseHex);
  cGrad.addColorStop(0.76, rawEdgeHex);
  cGrad.addColorStop(1.0, rawEdgeHex);
  cCtx.fillStyle = cGrad;
  cCtx.fillRect(0, 0, w, h);

  // Crisp woven weft/warp grain & bright raw loose yarn highlights near ripped rim
  for (let y = 0; y < h; y += 3) {
    cCtx.fillStyle = y % 6 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.16)';
    cCtx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 4) {
    cCtx.fillStyle = 'rgba(255,255,255,0.14)';
    cCtx.fillRect(x, 0, 1, h * 0.55);
  }

  // Alpha: solid ragged cloth base with uneven torn teeth + short thick woven fringe (NOT spiderweb nylon!)
  aCtx.fillStyle = '#000';
  aCtx.fillRect(0, 0, w, h);

  let seed = 4219;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Solid jagged cloth teeth body with dramatic uneven rips + woven cotton/wool fringe (zero straight 90° edges!)
  aCtx.fillStyle = '#fff';
  aCtx.beginPath();
  aCtx.moveTo(0, h);
  for (let x = 0; x <= w; x += 3) {
    const wave =
      Math.sin((x / w) * Math.PI * 10) * 20 +
      Math.sin((x / w) * Math.PI * 24 + 1.1) * 14 +
      (rand() - 0.5) * 22;
    const yEdge = clamp(h * 0.56 + wave, h * 0.14, h * 0.86);
    aCtx.lineTo(x, yEdge);
  }
  aCtx.lineTo(w, h);
  aCtx.closePath();
  aCtx.fill();

  // Thick raw woven weft/warp cotton & wool tufts projecting past the jagged teeth
  for (let x = 0; x < w; x += 2) {
    const tuftH = 14 + rand() * 44;
    const yBase = h * 0.58 + (rand() - 0.5) * 24;
    aCtx.strokeStyle = `rgba(255,255,255,${0.62 + rand() * 0.38})`;
    aCtx.lineWidth = 1.6 + rand() * 2.2;
    aCtx.beginPath();
    aCtx.moveTo(x, yBase + 10);
    aCtx.lineTo(x + (rand() - 0.5) * 9, Math.max(2, yBase - tuftH));
    aCtx.stroke();
  }

  const map = new THREE.CanvasTexture(colC);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const alphaMap = new THREE.CanvasTexture(alpC);
  alphaMap.wrapS = THREE.RepeatWrapping;
  alphaMap.wrapT = THREE.ClampToEdgeWrapping;

  return { map, alphaMap };
}
