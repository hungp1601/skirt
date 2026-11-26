import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, smoothstep, gauss } from './math.js';

// =========================================================================
// GLB CHARACTER LOADER + 3D ARM-TUBE EXCLUSION & 360° ENVELOPE SCANNER
// - Tự phát hiện & tách trọn 2 cánh tay / bàn tay (không bao giờ đè váy hay áo lên tay)
// - Tự nối liền chân dưới + giày nữ sinh khớp sát mép cắt đùi GLB (BloJpn.glb)
// - Quét bao ngoài 360° chính xác cho Tất, Váy xếp ly và Áo nữ sinh
// =========================================================================

// Tách các vùng liên thông trên mặt cắt 2D (x, z)
function find2DComponents(pts, gridN = 60, halfSpan = 0.46) {
  const grid = new Uint8Array(gridN * gridN);
  const cellPts = new Map();
  const invSpan = gridN / (halfSpan * 2);

  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], z = pts[i + 2];
    const gx = Math.floor((x + halfSpan) * invSpan);
    const gz = Math.floor((z + halfSpan) * invSpan);
    if (gx < 0 || gx >= gridN || gz < 0 || gz >= gridN) continue;
    const key = gz * gridN + gx;
    grid[key] = 1;
    let arr = cellPts.get(key);
    if (!arr) { arr = []; cellPts.set(key, arr); }
    arr.push(i);
  }

  const vis = new Uint8Array(gridN * gridN);
  const comps = [];
  const stack = [];

  for (let gz = 0; gz < gridN; gz++) {
    for (let gx = 0; gx < gridN; gx++) {
      const start = gz * gridN + gx;
      if (!grid[start] || vis[start]) continue;
      vis[start] = 1;
      stack.length = 0;
      stack.push(start);

      let cells = 0, sumX = 0, sumZ = 0, pCnt = 0;
      let mnX = 1e9, mxX = -1e9, mnZ = 1e9, mxZ = -1e9;
      const vertIndices = [];

      while (stack.length > 0) {
        const cur = stack.pop();
        cells++;
        const cz0 = Math.floor(cur / gridN);
        const cx0 = cur - cz0 * gridN;
        const idxList = cellPts.get(cur);
        if (idxList) {
          for (let k = 0; k < idxList.length; k++) {
            const vi = idxList[k];
            const px = pts[vi], pz = pts[vi + 2];
            sumX += px; sumZ += pz; pCnt++;
            if (px < mnX) mnX = px; if (px > mxX) mxX = px;
            if (pz < mnZ) mnZ = pz; if (pz > mxZ) mxZ = pz;
            vertIndices.push(vi);
          }
        }
        for (let dz = -1; dz <= 1; dz++) {
          const nz = cz0 + dz;
          if (nz < 0 || nz >= gridN) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx0 + dx;
            if (nx < 0 || nx >= gridN) continue;
            const nKey = nz * gridN + nx;
            if (grid[nKey] && !vis[nKey]) {
              vis[nKey] = 1;
              stack.push(nKey);
            }
          }
        }
      }

      if (cells >= 3 && pCnt > 0) {
        comps.push({
          cells,
          cx: sumX / pCnt,
          cz: sumZ / pCnt,
          midX: (mnX + mxX) * 0.5,
          midZ: (mnZ + mxZ) * 0.5,
          rx: (mxX - mnX) * 0.5,
          rz: (mxZ - mnZ) * 0.5,
          vertIndices
        });
      }
    }
  }
  comps.sort((a, b) => b.cells - a.cells);
  return comps;
}

function smooth1D(arr, passes = 1) {
  let cur = new Float32Array(arr);
  const n = cur.length;
  for (let p = 0; p < passes; p++) {
    const nxt = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, w = 0;
      for (let k = -2; k <= 2; k++) {
        const j = clamp(i + k, 0, n - 1);
        const wt = 3 - Math.abs(k);
        s += cur[j] * wt; w += wt;
      }
      nxt[i] = s / w;
    }
    cur = nxt;
  }
  return cur;
}

function finalizePolarEnvelope(radArr, NS, NA, minFloor = 0.035) {
  for (let s = 0; s < NS; s++) {
    let sum = 0, cnt = 0;
    for (let a = 0; a < NA; a++) {
      if (radArr[s * NA + a] > 0.015) { sum += radArr[s * NA + a]; cnt++; }
    }
    const fb = cnt > 0 ? sum / cnt : 0.10;
    for (let a = 0; a < NA; a++) {
      if (radArr[s * NA + a] < 0.015) radArr[s * NA + a] = fb;
    }
  }
  const out = new Float32Array(radArr.length);
  for (let s = 0; s < NS; s++) {
    for (let a = 0; a < NA; a++) {
      let acc = 0, w = 0;
      for (let ds = -1; ds <= 1; ds++) {
        const sj = clamp(s + ds, 0, NS - 1);
        for (let da = -1; da <= 1; da++) {
          const aj = (a + da + NA) % NA;
          const wt = (ds === 0 && da === 0) ? 4 : ((ds === 0 || da === 0) ? 2 : 1);
          acc += radArr[sj * NA + aj] * wt;
          w += wt;
        }
      }
      out[s * NA + a] = Math.max(minFloor, radArr[s * NA + a], acc / w);
    }
  }
  radArr.set(out);
}

// Dò quỹ đạo 3D của cả 2 cánh tay (từ vai xuống bàn tay) kể cả khi cẳng tay chạm nhẹ vào hông
function detectArmTubes(allVerts, yOffset, modelH) {
  const waistY = yOffset + modelH * 0.43;
  const wPts = [];
  for (let i = 0; i < allVerts.length; i += 3) {
    if (Math.abs(allVerts[i + 1] - waistY) < 0.02) wPts.push(allVerts[i], allVerts[i + 1], allVerts[i + 2]);
  }
  const wComps = find2DComponents(wPts, 60, 0.46);
  const seeds = wComps.slice(1)
    .filter(c => c.rx < 0.09 && c.rz < 0.09 && c.cells >= 10)
    .sort((a, b) => b.midX - a.midX);
  if (seeds.length < 2) return [];

  const armSamples = [[], []];
  for (let armIdx = 0; armIdx < 2; armIdx++) {
    const seed = seeds[armIdx];
    for (const dir of [-1, 1]) {
      let tx = seed.midX, tz = seed.midZ;
      let vx = 0, vz = 0;
      let missed = 0;
      for (let step = 0; step < 26; step++) {
        const y = waistY + dir * step * 0.026;
        if (y < yOffset + 0.04 || y > yOffset + modelH * 0.62) break;
        const pts = [];
        for (let i = 0; i < allVerts.length; i += 3) {
          if (Math.abs(allVerts[i + 1] - y) < 0.015) pts.push(allVerts[i], allVerts[i + 1], allVerts[i + 2]);
        }
        const cs = find2DComponents(pts, 60, 0.46);
        // Dự đoán vị trí cánh tay khi đi qua đoạn chạm nhẹ vào hông để nối tiếp xuống cổ tay/bàn tay
        const predX = tx + vx * (missed + 1);
        const predZ = tz + vz * (missed + 1);
        const searchR = 0.09 + missed * 0.014;
        let best = null, bestD = searchR;
        for (const cp of cs.slice(1)) {
          if (cp.rx > 0.085 || cp.rz > 0.085 || cp.cells < 8) continue;
          const d = Math.hypot(cp.midX - predX, cp.midZ - predZ);
          if (d < bestD) { bestD = d; best = cp; }
        }
        if (best) {
          const rAvg = (best.rx + best.rz) * 0.5;
          const rMax = Math.max(best.rx, best.rz);
          armSamples[armIdx].push({ y, x: best.midX, z: best.midZ, r: rAvg, rMax });
          if (step > 0 && missed === 0) {
            vx = vx * 0.5 + (best.midX - tx) * 0.5;
            vz = vz * 0.5 + (best.midZ - tz) * 0.5;
          }
          tx = best.midX; tz = best.midZ;
          missed = 0;
        } else {
          missed++;
        }
      }
    }
    armSamples[armIdx].sort((a, b) => a.y - b.y);
  }

  return armSamples.map(arr => {
    const clean = [];
    for (const p of arr) {
      if (!clean.length || Math.abs(p.y - clean[clean.length - 1].y) > 0.005) clean.push(p);
    }
    const n = clean.length;
    const pA = clean[Math.max(0, n - 4)];
    const pB = clean[n - 1];
    const dy = Math.max(0.02, pB.y - pA.y);
    const slopeX = (pB.x - pA.x) / dy;
    const slopeZ = (pB.z - pA.z) / dy;

    const evalArm = (y) => {
      if (y <= clean[0].y) {
        const d = clean[0].y - y;
        return {
          x: clean[0].x,
          z: clean[0].z,
          r: Math.max(0.028, clean[0].r - d * 0.35),
          rMax: Math.max(0.032, clean[0].rMax - d * 0.35),
          active: d < 0.06
        };
      }
      if (y >= pB.y) {
        const d = y - pB.y;
        return {
          x: pB.x + slopeX * d * 0.72,
          z: pB.z + slopeZ * d * 0.72,
          r: Math.min(0.066, pB.r + d * 0.05),
          rMax: Math.min(0.072, pB.rMax + d * 0.05),
          active: d < 0.36
        };
      }
      let lo = 0;
      while (lo < n - 2 && clean[lo + 1].y < y) lo++;
      const a = clean[lo], b = clean[lo + 1];
      const f = (y - a.y) / Math.max(1e-4, b.y - a.y);
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        r: a.r + (b.r - a.r) * f,
        rMax: a.rMax + (b.rMax - a.rMax) * f,
        active: true
      };
    };
    return { clean, evalArm };
  });
}

// Tính bán kính tối đa từ tâm thân (cx, cz) theo góc theta trước khi chạm mặt trong của 2 cánh tay
function createArmLimitFn(arms) {
  return (cx, cz, y, theta, margin = 0.005) => {
    const ux = Math.cos(theta), uz = Math.sin(theta);
    let limit = 0.48;
    for (let k = 0; k < arms.length; k++) {
      const a = arms[k].evalArm(y);
      if (!a.active) continue;
      const dx = a.x - cx, dz = a.z - cz;
      const proj = dx * ux + dz * uz;
      if (proj <= 0) continue;
      const perpSq = (dx * dx + dz * dz) - proj * proj;
      const rad = a.r + margin;
      if (perpSq < rad * rad) {
        const hitDist = proj - Math.sqrt(rad * rad - perpSq);
        if (hitDist > 0.05 && hitDist < limit) limit = hitDist;
      }
    }
    return limit;
  };
}

// Quét bao ngoài 360° trên tập đỉnh đã tách sạch 2 cánh tay (torsoOnlyVerts)
function scanCleanBodyEnvelope(torsoVerts, yTop, yBot, NS, NA, maxRadius = 0.30) {
  const span = Math.max(0.05, yTop - yBot);
  const buckets = Array.from({ length: NS }, () => []);

  for (let i = 0; i < torsoVerts.length; i += 3) {
    const y = torsoVerts[i + 1];
    if (y < yBot - 0.015 || y > yTop + 0.015) continue;
    const s = clamp(Math.floor(((yTop - y) / span) * NS), 0, NS - 1);
    buckets[s].push(torsoVerts[i], y, torsoVerts[i + 2]);
  }

  let cxArr = new Float32Array(NS);
  let czArr = new Float32Array(NS);
  for (let s = 0; s < NS; s++) {
    const pts = buckets[s];
    let mnX = 1e9, mxX = -1e9, mnZ = 1e9, mxZ = -1e9;
    for (let i = 0; i < pts.length; i += 3) {
      if (pts[i] < mnX) mnX = pts[i]; if (pts[i] > mxX) mxX = pts[i];
      if (pts[i + 2] < mnZ) mnZ = pts[i + 2]; if (pts[i + 2] > mxZ) mxZ = pts[i + 2];
    }
    cxArr[s] = pts.length ? (mnX + mxX) * 0.5 : (s > 0 ? cxArr[s - 1] : 0);
    czArr[s] = pts.length ? (mnZ + mxZ) * 0.5 : (s > 0 ? czArr[s - 1] : 0);
  }
  cxArr = smooth1D(cxArr, 2);
  czArr = smooth1D(czArr, 2);

  const radArr = new Float32Array(NS * NA);
  for (let s = 0; s < NS; s++) {
    const pts = buckets[s];
    const cx = cxArr[s], cz = czArr[s];
    for (let i = 0; i < pts.length; i += 3) {
      const dx = pts[i] - cx, dz = pts[i + 2] - cz;
      const r = Math.hypot(dx, dz);
      if (r > maxRadius) continue;
      let ang = Math.atan2(dz, dx);
      if (ang < 0) ang += Math.PI * 2;
      const af = (ang / (Math.PI * 2)) * NA;
      const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA;
      // Ghi đúng lát cắt s để không làm phồng phần eo hẹp từ ngực/hông lân cận
      if (r > radArr[s * NA + a0]) radArr[s * NA + a0] = r;
      if (r > radArr[s * NA + a1]) radArr[s * NA + a1] = r;
    }
  }
  finalizePolarEnvelope(radArr, NS, NA, 0.055);

  let maxRx = 0.18, maxRz = 0.16;
  const rxArr = new Float32Array(NS), rzArr = new Float32Array(NS);
  for (let s = 0; s < NS; s++) {
    let sx = 0, sz = 0;
    for (let a = 0; a < NA; a++) {
      const ang = (a / NA) * Math.PI * 2;
      const rr = radArr[s * NA + a];
      sx = Math.max(sx, Math.abs(Math.cos(ang) * rr));
      sz = Math.max(sz, Math.abs(Math.sin(ang) * rr));
    }
    rxArr[s] = sx; rzArr[s] = sz;
    if (sx > maxRx) maxRx = sx;
    if (sz > maxRz) maxRz = sz;
  }

  return {
    yTop,
    yBot,
    NS,
    NA,
    cxArr,
    czArr,
    radArr,
    cx: cxArr[Math.floor(NS * 0.45)],
    cz: czArr[Math.floor(NS * 0.45)],
    waistRx: rxArr[0],
    waistRz: rzArr[0],
    hipRx: maxRx,
    hipRz: maxRz,
    slices: { NS, cx: cxArr, cz: czArr, rx: rxArr, rz: rzArr }
  };
}

// Nối liền đôi chân dưới mượt mà + giày nữ sinh đen cho model cắt ngang đùi (BloJpn.glb)
function buildSeamlessLowerLegsAndProfile(scene, allVerts, yCut, modelH, skinTex, skinSSSUniform) {
  const NA = 72;
  // Quét lát mỏng 2.6cm sát mép cắt dưới để tách đúng 2 đùi và bỏ đầu ngón tay
  const cutPts = [];
  const upPts = [];
  for (let i = 0; i < allVerts.length; i += 3) {
    const y = allVerts[i + 1];
    if (y >= yCut && y <= yCut + 0.026) cutPts.push(allVerts[i], y, allVerts[i + 2]);
    else if (y >= yCut + 0.055 && y <= yCut + 0.085) upPts.push(allVerts[i], y, allVerts[i + 2]);
  }
  const comps = find2DComponents(cutPts, 56, 0.46).filter(c => c.rx > 0.055 && c.rz > 0.055);
  const thighComps = comps.slice(0, 2).sort((a, b) => a.midX - b.midX);
  const leftComp = thighComps[0] || { midX: -0.18, midZ: 0.04, rx: 0.125, rz: 0.13 };
  const rightComp = thighComps[1] || { midX: 0.09, midZ: 0.14, rx: 0.11, rz: 0.115 };

  // Theo dõi tâm 2 đùi ở cao độ +7cm để phần tất trên đùi GLB nghiêng đúng theo đùi thật
  const upComps = find2DComponents(upPts, 56, 0.46).filter(c => c.rx > 0.06 && c.rz > 0.06).slice(0, 2).sort((a, b) => a.midX - b.midX);
  const upLeft = upComps[0] || leftComp;
  const upRight = upComps[1] || rightComp;

  const cutInfo = { '-1': leftComp, '1': rightComp };
  const upInfo = { '-1': upLeft, '1': upRight };
  const cutRad = { '-1': new Float32Array(NA), '1': new Float32Array(NA) };

  for (const side of ['-1', '1']) {
    const cp = cutInfo[side];
    const arr = cutRad[side];
    if (cp.vertIndices) {
      for (let k = 0; k < cp.vertIndices.length; k++) {
        const vi = cp.vertIndices[k];
        const dx = cutPts[vi] - cp.midX;
        const dz = cutPts[vi + 2] - cp.midZ;
        const r = Math.hypot(dx, dz);
        if (r > 0.22) continue;
        let ang = Math.atan2(dz, dx);
        if (ang < 0) ang += Math.PI * 2;
        const a = Math.floor((ang / (Math.PI * 2)) * NA) % NA;
        if (r > arr[a]) arr[a] = r;
      }
    }
    let avg = 0, cnt = 0;
    for (let a = 0; a < NA; a++) if (arr[a] > 0.02) { avg += arr[a]; cnt++; }
    const fb = cnt > 0 ? avg / cnt : 0.115;
    for (let a = 0; a < NA; a++) if (arr[a] < 0.02) arr[a] = fb;
    const sm = new Float32Array(NA);
    for (let a = 0; a < NA; a++) {
      let acc = 0, w = 0;
      for (let d = -2; d <= 2; d++) {
        const wt = 3 - Math.abs(d);
        acc += arr[(a + d + NA) % NA] * wt; w += wt;
      }
      sm[a] = acc / w;
    }
    arr.set(sm);
  }

  const evalLegCenter = (sideKey, y) => {
    const cp = cutInfo[sideKey];
    if (y > yCut) {
      const up = upInfo[sideKey];
      const f = clamp((y - yCut) / 0.07, 0, 1);
      return {
        cx: cp.midX + (up.midX - cp.midX) * f,
        cz: cp.midZ + (up.midZ - cp.midZ) * f
      };
    }
    const sgn = sideKey === '-1' ? -1 : 1;
    const u = clamp((yCut - y) / Math.max(0.1, yCut - 0.02), 0, 1);
    const cx = cp.midX + sgn * (-0.015 * smoothstep(0.0, 0.45, u) + 0.012 * smoothstep(0.55, 1.0, u));
    const cz = cp.midZ
      + 0.024 * gauss(u, 0.34, 0.18)
      - 0.028 * gauss(u, 0.65, 0.18)
      - 0.025 * smoothstep(0.0, 0.9, u)
      + 0.055 * smoothstep(0.88, 1.0, u);
    return { cx, cz };
  };

  const evalLowerRadius = (sideKey, y, theta) => {
    const sgn = sideKey === '-1' ? -1 : 1;
    const u = clamp((yCut - y) / Math.max(0.1, yCut - 0.02), 0, 1);
    let ang = theta % (Math.PI * 2);
    if (ang < 0) ang += Math.PI * 2;
    const af = (ang / (Math.PI * 2)) * NA;
    const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA, at = af - Math.floor(af);
    const rCut = cutRad[sideKey][a0] * (1 - at) + cutRad[sideKey][a1] * at;

    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const knee = gauss(u, 0.36, 0.10);
    const calf = gauss(u, 0.60, 0.16);
    const ankle = gauss(u, 0.90, 0.08);
    const foot = smoothstep(0.88, 1.0, u);

    const rx = 0.056 + 0.032 * (1 - smoothstep(0.0, 0.45, u)) + 0.008 * knee + 0.020 * calf - 0.013 * ankle + 0.006 * foot;
    const rz = 0.058 + 0.034 * (1 - smoothstep(0.0, 0.45, u)) + 0.010 * knee + 0.024 * calf - 0.013 * ankle + 0.038 * foot;
    let rAna = Math.hypot(cosT * rx, sinT * rz);
    rAna += Math.max(0, -sinT) * 0.014 * calf;
    rAna += Math.max(0, sinT) * 0.006 * knee;
    rAna += Math.max(0, sgn * cosT) * 0.006 * (1 - smoothstep(0.0, 0.5, u));

    const blend = smoothstep(0.0, 0.30, u);
    return rCut * (1 - blend) + rAna * blend;
  };

  const legSkinMat = new THREE.MeshPhysicalMaterial({
    color: 0xeec4b3,
    map: skinTex.map,
    roughnessMap: skinTex.roughnessMap,
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(0.035, 0.035),
    roughness: 0.54,
    metalness: 0.0,
    sheen: 0.20,
    sheenRoughness: 0.68,
    sheenColor: new THREE.Color(0xffe9df),
    envMapIntensity: 0.55
  });
  legSkinMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSssColor = skinSSSUniform;
    shader.fragmentShader =
      'uniform vec3 uSssColor;\n' +
      shader.fragmentShader.replace(
        '#include <lights_physical_pars_fragment>',
        THREE.ShaderChunk.lights_physical_pars_fragment.replace(
          'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
          `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
           float wrapNdotL = clamp( ( dot( geometryNormal, directLight.direction ) + 0.42 ) / 1.42, 0.0, 1.0 );
           float sssBand = pow( wrapNdotL, 1.6 ) * ( 1.0 - clamp( dot( geometryNormal, directLight.direction ), 0.0, 1.0 ) );
           reflectedLight.directDiffuse += directLight.color * material.diffuseColor * uSssColor * sssBand * 0.24;`
        )
      );
  };

  const shoeMat = new THREE.MeshPhysicalMaterial({
    color: 0x161217,
    roughness: 0.24,
    metalness: 0.08,
    clearcoat: 0.65,
    clearcoatRoughness: 0.20
  });

  const lowerLegGroup = new THREE.Group();
  for (const sideKey of ['-1', '1']) {
    const segY = 72, segR = 56;
    const yStart = yCut + 0.03;
    const yEnd = 0.025;
    const verts = [], uvs = [], indices = [];

    for (let r = 0; r <= segY; r++) {
      const f = r / segY;
      const y = yStart - f * (yStart - yEnd);
      const { cx, cz } = evalLegCenter(sideKey, Math.min(y, yCut));
      const tuck = y > yCut ? 1.0 - smoothstep(yCut, yStart, y) * 0.04 : 1.0;
      for (let c = 0; c <= segR; c++) {
        const u = c / segR;
        const theta = u * Math.PI * 2;
        const rad = evalLowerRadius(sideKey, Math.min(y, yCut), theta) * tuck;
        verts.push(cx + Math.cos(theta) * rad, y, cz + Math.sin(theta) * rad);
        uvs.push(u, f);
      }
    }
    const stride = segR + 1;
    for (let r = 0; r < segY; r++) {
      for (let c = 0; c < segR; c++) {
        const a = r * stride + c, b = a + 1, cc = (r + 1) * stride + c, d = cc + 1;
        indices.push(a, cc, b, b, cc, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const legMesh = new THREE.Mesh(geo, legSkinMat);
    legMesh.castShadow = true;
    legMesh.receiveShadow = true;
    lowerLegGroup.add(legMesh);

    const footPos = evalLegCenter(sideKey, 0.06);
    const shoe = new THREE.Group();
    shoe.position.set(footPos.cx, 0, footPos.cz);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.215), shoeMat);
    sole.position.set(0, 0.011, 0.042);
    shoe.add(sole);

    const upper = new THREE.Mesh(new THREE.SphereGeometry(0.056, 20, 14), shoeMat);
    upper.scale.set(0.92, 0.72, 1.95);
    upper.position.set(0, 0.045, 0.045);
    shoe.add(upper);

    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.049, 0.0085, 8, 22, Math.PI), shoeMat);
    strap.position.set(0, 0.068, 0.022);
    strap.rotation.y = Math.PI * 0.5;
    shoe.add(strap);

    shoe.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    lowerLegGroup.add(shoe);
  }
  scene.add(lowerLegGroup);

  // Tất bắt đầu từ yCut + 0.085 (nằm gọn ngay dưới gấu váy nơi 2 đùi tách rời hoàn toàn) xuống cổ giày
  const legYTop = yCut + 0.085;
  const legYBot = 0.115;
  const legSpan = legYTop - legYBot;
  const NS = 64;
  const cxArr = { '-1': new Float32Array(NS), '1': new Float32Array(NS) };
  const czArr = { '-1': new Float32Array(NS), '1': new Float32Array(NS) };
  const radArr = { '-1': new Float32Array(NS * NA), '1': new Float32Array(NS * NA) };

  for (const sideKey of ['-1', '1']) {
    for (let s = 0; s < NS; s++) {
      const y = legYTop - (s / (NS - 1)) * legSpan;
      const { cx, cz } = evalLegCenter(sideKey, y);
      cxArr[sideKey][s] = cx;
      czArr[sideKey][s] = cz;
      for (let a = 0; a < NA; a++) {
        const theta = (a / NA) * Math.PI * 2;
        radArr[sideKey][s * NA + a] = evalLowerRadius(sideKey, Math.min(y, yCut), theta);
      }
    }
  }

  for (let i = 0; i < allVerts.length; i += 3) {
    const x = allVerts[i], y = allVerts[i + 1], z = allVerts[i + 2];
    if (y < yCut - 0.008 || y > legYTop + 0.015) continue;
    const cL = evalLegCenter('-1', y);
    const cR = evalLegCenter('1', y);
    const dL = Math.hypot(x - cL.cx, z - cL.cz);
    const dR = Math.hypot(x - cR.cx, z - cR.cz);
    if (Math.min(dL, dR) > 0.18) continue;
    const sideKey = dL < dR ? '-1' : '1';
    const cUse = sideKey === '-1' ? cL : cR;
    const sf = clamp((legYTop - y) / legSpan, 0, 1) * (NS - 1);
    const s0 = Math.floor(sf), s1 = Math.min(NS - 1, s0 + 1);
    const dx = x - cUse.cx, dz = z - cUse.cz;
    const r = Math.hypot(dx, dz);
    if (r > 0.175) continue;
    let ang = Math.atan2(dz, dx);
    if (ang < 0) ang += Math.PI * 2;
    const af = (ang / (Math.PI * 2)) * NA;
    const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA;
    const arr = radArr[sideKey];
    for (const ss of [s0, s1]) {
      if (r > arr[ss * NA + a0]) arr[ss * NA + a0] = r;
      if (r > arr[ss * NA + a1]) arr[ss * NA + a1] = r;
    }
  }

  // Chỉ làm mượt vùng đùi trên giao với GLB (y >= yCut - 0.02), giữ nguyên bán kính da chính xác 100% ở chân dưới để tất bó sát tuyệt đối
  const cutSliceLimit = clamp(Math.ceil(((legYTop - (yCut - 0.025)) / legSpan) * NS), 4, NS - 1);
  for (const sideKey of ['-1', '1']) {
    const arr = radArr[sideKey];
    const tmpOut = new Float32Array(arr);
    for (let s = 0; s <= cutSliceLimit; s++) {
      for (let a = 0; a < NA; a++) {
        let acc = 0, w = 0;
        for (let ds = -1; ds <= 1; ds++) {
          const sj = clamp(s + ds, 0, NS - 1);
          for (let da = -1; da <= 1; da++) {
            const aj = (a + da + NA) % NA;
            const wt = (ds === 0 && da === 0) ? 4 : ((ds === 0 || da === 0) ? 2 : 1);
            acc += arr[sj * NA + aj] * wt; w += wt;
          }
        }
        tmpOut[s * NA + a] = Math.max(0.036, arr[s * NA + a], acc / w);
      }
    }
    arr.set(tmpOut);
  }

  return {
    legSkinMat,
    legProfile: {
      yTop: legYTop,
      yBot: legYBot,
      ySpan: legSpan,
      NS,
      NA,
      cxArr,
      czArr,
      radArr,
      tMin: 0.02,
      tMax: 0.98,
      tightLeg: true
    }
  };
}

function scanFullBodyProfile(allVerts, totalHeight) {
  const legYBot = totalHeight * 0.125;
  const legYTop = totalHeight * 0.435;
  const legSpan = legYTop - legYBot;
  const NS = 64, NA = 72;

  const legVerts = [];
  for (let i = 0; i < allVerts.length; i += 3) {
    const x = allVerts[i], y = allVerts[i + 1], z = allVerts[i + 2];
    if (Math.abs(x) > 0.36) continue;
    if (y >= legYBot - 0.02 && y <= legYTop + 0.02) legVerts.push(x, y, z);
  }

  const histBins = 40, hist = new Int32Array(histBins);
  for (let i = 0; i < legVerts.length; i += 3) {
    const x = legVerts[i], y = legVerts[i + 1];
    if (y < legYBot + legSpan * 0.20 || y > legYBot + legSpan * 0.78) continue;
    const b = Math.floor(((x + 0.20) / 0.40) * histBins);
    if (b >= 0 && b < histBins) hist[b]++;
  }
  let splitBin = 20, minHits = Infinity;
  for (let b = 13; b <= 27; b++) if (hist[b] < minHits) { minHits = hist[b]; splitBin = b; }
  const splitX = -0.20 + ((splitBin + 0.5) / histBins) * 0.40;

  const cxArr = { '-1': new Float32Array(NS), '1': new Float32Array(NS) };
  const czArr = { '-1': new Float32Array(NS), '1': new Float32Array(NS) };
  const cntArr = { '-1': new Int32Array(NS), '1': new Int32Array(NS) };

  for (let i = 0; i < legVerts.length; i += 3) {
    const x = legVerts[i], y = legVerts[i + 1], z = legVerts[i + 2];
    const s = Math.floor(clamp((legYTop - y) / legSpan, 0, 0.9999) * NS);
    const side = x < splitX ? '-1' : '1';
    cxArr[side][s] += x; czArr[side][s] += z; cntArr[side][s]++;
  }
  for (const side of ['-1', '1']) {
    for (let s = 0; s < NS; s++) {
      if (cntArr[side][s] > 0) { cxArr[side][s] /= cntArr[side][s]; czArr[side][s] /= cntArr[side][s]; }
      else if (s > 0) { cxArr[side][s] = cxArr[side][s - 1]; czArr[side][s] = czArr[side][s - 1]; }
    }
    cxArr[side] = smooth1D(cxArr[side], 1);
    czArr[side] = smooth1D(czArr[side], 1);
  }

  const radArr = { '-1': new Float32Array(NS * NA), '1': new Float32Array(NS * NA) };
  for (let i = 0; i < legVerts.length; i += 3) {
    const x = legVerts[i], y = legVerts[i + 1], z = legVerts[i + 2];
    const sf = clamp((legYTop - y) / legSpan, 0, 1) * (NS - 1);
    const s0 = Math.floor(sf), s1 = Math.min(NS - 1, s0 + 1), fr = sf - s0;
    const side = x < splitX ? '-1' : '1';
    const cx = cxArr[side][s0] * (1 - fr) + cxArr[side][s1] * fr;
    const cz = czArr[side][s0] * (1 - fr) + czArr[side][s1] * fr;
    const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz);
    if (r > 0.28) continue;
    let ang = Math.atan2(dz, dx);
    if (ang < 0) ang += Math.PI * 2;
    const af = (ang / (Math.PI * 2)) * NA;
    const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA;
    const arr = radArr[side];
    for (const ss of [s0, s1]) {
      if (r > arr[ss * NA + a0]) arr[ss * NA + a0] = r;
      if (r > arr[ss * NA + a1]) arr[ss * NA + a1] = r;
    }
  }
  for (const side of ['-1', '1']) finalizePolarEnvelope(radArr[side], NS, NA, 0.035);

  const skirtBounds = scanCleanBodyEnvelope(allVerts, totalHeight * 0.56, totalHeight * 0.35, 24, 72, 0.34);
  const shirtProfile = scanCleanBodyEnvelope(allVerts, totalHeight * 0.78, totalHeight * 0.54, 24, 72, 0.30);

  return {
    yTop: legYTop,
    yBot: legYBot,
    ySpan: legSpan,
    NS,
    NA,
    cxArr,
    czArr,
    radArr,
    tMin: 0.02,
    tMax: 0.98,
    skirtBounds,
    shirtProfile,
    maxRadiusBeforeArms: () => 0.48
  };
}

export function loadGLBCharacter(scene, url, { skinTex, skinSSSUniform, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const isUpperBodyCut = (size.y / Math.max(size.x, 0.01)) < 2.45;
        const modelHeight = isUpperBodyCut ? 1.48 : 2.85;
        const yOffset = isUpperBodyCut ? 1.18 : 0.0;
        const totalHeight = yOffset + modelHeight;
        const scale = modelHeight / (size.y || 1);
        model.scale.setScalar(scale);

        model.updateMatrixWorld(true);
        let sumX = 0, sumZ = 0, cnt = 0;
        const tmp = new THREE.Vector3();
        const rawMinY = box.min.y * scale;

        model.traverse((obj) => {
          if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
          obj.castShadow = true;
          obj.receiveShadow = true;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (!m) continue;
            if ('envMapIntensity' in m) m.envMapIntensity = 0.62;
            m.needsUpdate = true;
          }
          const attr = obj.geometry.attributes.position;
          const step = Math.max(1, Math.floor(attr.count / 15000));
          for (let i = 0; i < attr.count; i += step) {
            tmp.fromBufferAttribute(attr, i).applyMatrix4(obj.matrixWorld);
            const hFrac = (tmp.y - rawMinY) / modelHeight;
            if (isUpperBodyCut) {
              if (hFrac > 0.35 && hFrac < 0.75) { sumX += tmp.x; sumZ += tmp.z; cnt++; }
            } else if (hFrac > 0.15 && hFrac < 0.55 && tmp.x > (box.min.x + size.x * 0.14) * scale) {
              sumX += tmp.x; sumZ += tmp.z; cnt++;
            }
          }
        });

        const bodyCenterX = cnt > 0 ? sumX / cnt : center.x * scale;
        const bodyCenterZ = cnt > 0 ? sumZ / cnt : center.z * scale;
        model.position.set(-bodyCenterX, yOffset - rawMinY, -bodyCenterZ);
        scene.add(model);
        model.updateMatrixWorld(true);

        const allVerts = [];
        model.traverse((obj) => {
          if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
          const attr = obj.geometry.attributes.position;
          const mat = obj.matrixWorld;
          const step = attr.count > 400000 ? 2 : 1;
          for (let i = 0; i < attr.count; i += step) {
            tmp.fromBufferAttribute(attr, i).applyMatrix4(mat);
            allVerts.push(tmp.x, tmp.y, tmp.z);
          }
        });

        let profile;
        let legSkinMat = null;

        if (isUpperBodyCut) {
          const built = buildSeamlessLowerLegsAndProfile(scene, allVerts, yOffset, modelHeight, skinTex, skinSSSUniform);
          legSkinMat = built.legSkinMat;

          // 1. Dò trọn 2 ống cánh tay (từ vai xuống bàn tay) để loại trừ hoàn toàn khỏi Áo & Váy
          const armTubes = detectArmTubes(allVerts, yOffset, modelHeight);
          const maxRadiusBeforeArms = createArmLimitFn(armTubes);

          const torsoVerts = [];
          for (let i = 0; i < allVerts.length; i += 3) {
            const x = allVerts[i], y = allVerts[i + 1], z = allVerts[i + 2];
            let isArm = false;
            for (let k = 0; k < armTubes.length; k++) {
              const a = armTubes[k].evalArm(y);
              if (a.active && Math.hypot(x - a.x, z - a.z) < a.rMax + 0.020) {
                isArm = true;
                break;
              }
            }
            if (!isArm) torsoVerts.push(x, y, z);
          }

          // 2. Quét bao ngoài thân trên (Áo nữ sinh) & hông/eo (Váy) hoàn toàn sạch tay
          const skirtBounds = scanCleanBodyEnvelope(
            torsoVerts,
            yOffset + modelHeight * 0.41,
            yOffset + modelHeight * 0.06,
            24,
            72,
            0.30
          );
          const shirtProfile = scanCleanBodyEnvelope(
            torsoVerts,
            yOffset + modelHeight * 0.70,
            yOffset + modelHeight * 0.38,
            26,
            72,
            0.28
          );

          // Tính hướng ngực trước (frontTheta) từ đường nối 2 vai/cánh tay để cổ áo & nơ nằm chính giữa ngực
          let frontTheta = Math.PI * 0.5;
          if (armTubes.length >= 2) {
            const yChest = yOffset + modelHeight * 0.54;
            const a0 = armTubes[0].evalArm(yChest);
            const a1 = armTubes[1].evalArm(yChest);
            const sdx = a0.x - a1.x;
            const sdz = a0.z - a1.z;
            if (Math.hypot(sdx, sdz) > 0.08) {
              frontTheta = Math.atan2(sdx, -sdz);
              if (Math.sin(frontTheta) < 0) frontTheta += Math.PI;
            }
          }
          shirtProfile.frontTheta = frontTheta;

          profile = {
            ...built.legProfile,
            skirtBounds,
            shirtProfile,
            armTubes,
            maxRadiusBeforeArms
          };
        } else {
          profile = scanFullBodyProfile(allVerts, totalHeight);
        }

        resolve({ model, profile, legSkinMat, totalHeight });
      },
      (evt) => {
        if (onProgress && evt.total > 0) onProgress(evt.loaded / evt.total);
      },
      (err) => reject(err)
    );
  });
}
