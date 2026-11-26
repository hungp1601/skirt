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
  ctx.fillStyle = '#18202e';
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.fillStyle = '#e8eef5';
  ctx.fillRect(0, h - 54, w, 10);
  ctx.fillRect(0, h - 29, w, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Texture áo sơ mi thủy thủ nữ sinh Nhật (trắng cotton + cổ xanh than viền trắng + nơ đỏ + túi ngực)
// Quy ước UV: u = 0.25 là mặt trước (+Z), u = 0.75 là mặt sau (-Z), v = 1 là cổ áo (canvas y=0), v = 0 là gấu áo (canvas y=h)
export function createSchoolShirtTexture() {
  const w = 1024, h = 1024;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // 1. Nền vải cotton poplin trắng ngà mềm mại
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#f7f8fc');
  bg.addColorStop(0.5, '#f2f4f9');
  bg.addColorStop(1, '#e8ecf5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Sợi dệt ngang/dọc cực mịn tạo chất vải thật
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = (y % 6 === 0) ? 'rgba(180,192,212,0.08)' : 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 4) {
    ctx.fillStyle = (x % 8 === 0) ? 'rgba(155,170,196,0.06)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, 0, 1, h);
  }

  const frontX = w * 0.25;
  const backX = w * 0.75;

  // 2. Đường nẹp khuy áo chính giữa mặt trước (u = 0.25) chạy dưới cổ chữ V
  ctx.fillStyle = 'rgba(220,226,238,0.52)';
  ctx.fillRect(frontX - 16, h * 0.10, 32, h * 0.90);
  ctx.strokeStyle = 'rgba(160,172,195,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(frontX - 16, h * 0.10); ctx.lineTo(frontX - 16, h);
  ctx.moveTo(frontX + 16, h * 0.10); ctx.lineTo(frontX + 16, h);
  ctx.stroke();

  // Hàng cúc ngọc trai nhỏ dọc nẹp áo
  for (let i = 0; i < 5; i++) {
    const by = h * (0.28 + i * 0.14);
    ctx.fillStyle = 'rgba(130,142,165,0.38)';
    ctx.beginPath(); ctx.arc(frontX + 1.5, by + 1.5, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fdfefe';
    ctx.beginPath(); ctx.arc(frontX, by, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8d2e2';
    ctx.beginPath(); ctx.arc(frontX - 2, by, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(frontX + 2, by, 1.2, 0, Math.PI * 2); ctx.fill();
  }

  // 3. Túi ngực trái có viền xanh than nhỏ
  const pX = w * 0.34, pY = h * 0.44, pW = 82, pH = 92;
  ctx.fillStyle = '#eef1f8';
  ctx.beginPath();
  ctx.moveTo(pX, pY); ctx.lineTo(pX + pW, pY);
  ctx.lineTo(pX + pW, pY + pH - 16);
  ctx.lineTo(pX + pW * 0.5, pY + pH);
  ctx.lineTo(pX, pY + pH - 16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,162,188,0.62)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#182236';
  ctx.fillRect(pX, pY, pW, 8);

  // 4. Cổ áo thủy thủ xanh than (Sailor Collar) liền khối ôm sát viền cổ chữ V (mesh đã cắt chữ V ở r=0)
  // - Lưng áo (u = 0.75): tà cổ vuông rủ xuống ~34% chiều cao lưng
  const backColW = w * 0.36;
  const backColH = h * 0.33;
  ctx.fillStyle = '#162033';
  ctx.fillRect(backX - backColW * 0.5, 0, backColW, backColH);

  // - Dải cổ thủy thủ chạy đều dọc mép trên (bám sát chữ V trước ngực và nối liền qua 2 vai ra lưng)
  ctx.fillStyle = '#162033';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h * 0.14);
  ctx.lineTo(backX + backColW * 0.5, h * 0.14);
  ctx.lineTo(backX + backColW * 0.5, backColH);
  ctx.lineTo(backX - backColW * 0.5, backColH);
  ctx.lineTo(backX - backColW * 0.5, h * 0.14);
  ctx.lineTo(frontX + 160, h * 0.14);
  ctx.lineTo(frontX, h * 0.24);
  ctx.lineTo(frontX - 160, h * 0.14);
  ctx.lineTo(0, h * 0.14);
  ctx.closePath();
  ctx.fill();

  // - Hai đường sọc trắng sắc nét chạy dọc mép dưới cổ thủy thủ (cả trước chữ V lẫn tà vuông sau lưng)
  const drawCollarStripe = (inset, lw) => {
    ctx.strokeStyle = '#eef3fa';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.14 - inset);
    ctx.lineTo(frontX - 160, h * 0.14 - inset);
    ctx.lineTo(frontX, h * 0.24 - inset);
    ctx.lineTo(frontX + 160, h * 0.14 - inset);
    ctx.lineTo(backX - backColW * 0.5 + inset, h * 0.14 - inset);
    ctx.lineTo(backX - backColW * 0.5 + inset, backColH - inset);
    ctx.lineTo(backX + backColW * 0.5 - inset, backColH - inset);
    ctx.lineTo(backX + backColW * 0.5 - inset, h * 0.14 - inset);
    ctx.lineTo(w, h * 0.14 - inset);
    ctx.stroke();
  };
  drawCollarStripe(14, 7);
  drawCollarStripe(28, 4.5);

  // 5. Viền gấu áo phía dưới nhẹ nhàng
  ctx.fillStyle = 'rgba(22,32,51,0.14)';
  ctx.fillRect(0, h - 18, w, 18);

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
