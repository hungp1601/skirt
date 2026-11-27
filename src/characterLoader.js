import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, smoothstep, gauss } from './math.js';
import { createLaceBandTexture } from './textures.js';

// =========================================================================
// GLB CHARACTER LOADER + 3D ARM-TUBE BRIDGING, CAP REMOVAL & 360° ENVELOPE SCANNER
// - Cắt bỏ mặt đáy phẳng tối màu tại mép cắt đùi GLB để nối chân không thấy vệt đen
// - Dò & nối cầu mượt 2 ống cánh tay từ vai -> cẳng tay -> ngón tay (kể cả đoạn chạm hông)
// - Nối đôi chân dưới chuẩn giải phẫu nữ sinh + khớp màu da GLB + giày Mary-Jane thanh lịch
// - Quét bao ngoài 360° sạch tay cho Tất (kèm viền ren đùi), Váy xếp ly và Áo thủy thủ
// =========================================================================

// Tách các vùng liên thông trên mặt cắt 2D (x, z)
function find2DComponents(pts, gridN = 64, halfSpan = 0.46) {
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

function finalizePolarEnvelope(radArr, NS, NA, minFloor = 0.035, smoothPasses = 1) {
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
  for (let p = 0; p < smoothPasses; p++) {
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
        out[s * NA + a] = Math.max(minFloor, radArr[s * NA + a] * 0.55 + (acc / w) * 0.45, acc / w);
      }
    }
    radArr.set(out);
  }
}

// Cắt nắp đáy và vành tam giác úp xuống ngay trên mặt cắt đùi, để chân nối che kín mép.
function stripFlatCutCapTriangles(model, yCut) {
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const yTrim = yCut + 0.020;

  model.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const geom = obj.geometry;
    const pos = geom.attributes.position;
    const mat = obj.matrixWorld;
    const index = geom.index;

    if (index) {
      const src = index.array;
      const kept = new Uint32Array(src.length);
      let out = 0;
      for (let i = 0; i < src.length; i += 3) {
        const a = src[i], b = src[i + 1], c = src[i + 2];
        v0.fromBufferAttribute(pos, a).applyMatrix4(mat);
        v1.fromBufferAttribute(pos, b).applyMatrix4(mat);
        v2.fromBufferAttribute(pos, c).applyMatrix4(mat);
        if (v0.y < yTrim || v1.y < yTrim || v2.y < yTrim) continue;
        const cy = (v0.y + v1.y + v2.y) / 3;
        e1.subVectors(v1, v0);
        e2.subVectors(v2, v0);
        nrm.crossVectors(e1, e2);
        if (cy < yCut + 0.028 && nrm.y < -0.45 * nrm.length()) continue;
        kept[out++] = a;
        kept[out++] = b;
        kept[out++] = c;
      }
      if (out < src.length) {
        geom.setIndex(new THREE.BufferAttribute(kept.subarray(0, out), 1));
      }
    }
  });
}

// Tạo alphaMap chuông mượt dọc (0 -> 1 -> 0) cho dải hòa trộn da 7.5cm xóa hoàn toàn cả vết cắt mờ!
function createSeamBlendAlphaMap() {
  const w = 16, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 = mép trên (GLB) -> 0.52 = ngay vạch ghép -> 1 = mép dưới (chân dưới)
    let a;
    if (v < 0.22)      a = smoothstep(0.0, 0.22, v);
    else if (v > 0.80) a = 1.0 - smoothstep(0.80, 1.0, v);
    else               a = 1.0;
    const byte = Math.floor(clamp(a, 0, 1) * 255);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      img.data[idx] = byte; img.data[idx + 1] = byte; img.data[idx + 2] = byte; img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Lấy mẫu màu da 360° theo từng góc quanh 2 đùi GLB ngay sát mép nối (ySeam) để khớp từng vùng sáng/tối mặt trong & ngoài đùi!
function sampleGLBThighSkinRings(model, ySeam, cutInfo, NA = 72) {
  const defaultHex = 0xc59d92;
  const fallbackRgb = [((defaultHex >> 16) & 255) / 255, ((defaultHex >> 8) & 255) / 255, (defaultHex & 255) / 255];
  const makeDefaultRing = () => {
    const arr = new Float32Array(NA * 3);
    for (let a = 0; a < NA; a++) {
      arr[a * 3] = fallbackRgb[0]; arr[a * 3 + 1] = fallbackRgb[1]; arr[a * 3 + 2] = fallbackRgb[2];
    }
    return arr;
  };
  const fallback = {
    hex: defaultHex,
    avgRgb: fallbackRgb,
    rings: { '-1': makeDefaultRing(), '1': makeDefaultRing() },
    roughness: 0.49
  };

  let foundMat = null;
  let foundMesh = null;
  model.traverse((obj) => {
    if (foundMesh || !obj.isMesh || !obj.geometry?.attributes?.uv) return;
    const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (m && m.map && m.map.image) {
      foundMat = m;
      foundMesh = obj;
    }
  });
  if (!foundMesh || !foundMat?.map?.image) return fallback;

  try {
    const img = foundMat.map.image;
    const cw = Math.min(512, img.width || 512);
    const ch = Math.min(512, img.height || 512);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch).data;

    const pos = foundMesh.geometry.attributes.position;
    const uv = foundMesh.geometry.attributes.uv;
    const mat = foundMesh.matrixWorld;
    const tmp = new THREE.Vector3();

    const sums = { '-1': new Float32Array(NA * 3), '1': new Float32Array(NA * 3) };
    const cnts = { '-1': new Int32Array(NA), '1': new Int32Array(NA) };
    let totR = 0, totG = 0, totB = 0, totCnt = 0;

    const step = Math.max(1, Math.floor(pos.count / 90000));
    for (let i = 0; i < pos.count; i += step) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(mat);
      if (tmp.y < ySeam + 0.014 || tmp.y > ySeam + 0.050) continue;
      const cL = cutInfo['-1'], cR = cutInfo['1'];
      const dL = Math.hypot(tmp.x - cL.midX, tmp.z - cL.midZ);
      const dR = Math.hypot(tmp.x - cR.midX, tmp.z - cR.midZ);
      if (Math.min(dL, dR) > 0.175) continue;
      const side = dL < dR ? '-1' : '1';
      const cUse = side === '-1' ? cL : cR;

      let u = uv.getX(i) % 1; if (u < 0) u += 1;
      let v = uv.getY(i) % 1; if (v < 0) v += 1;
      const px = clamp(Math.floor(u * (cw - 1)), 0, cw - 1);
      const py = clamp(Math.floor(v * (ch - 1)), 0, ch - 1);
      const idx = (py * cw + px) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if ((r + g + b) < 240) continue;

      let ang = Math.atan2(tmp.z - cUse.midZ, tmp.x - cUse.midX);
      if (ang < 0) ang += Math.PI * 2;
      const a = Math.floor((ang / (Math.PI * 2)) * NA) % NA;

      // Chuyển sRGB -> linear rồi cộng trung bình chính xác (đồng bộ với vertexColors Three.js)
      const col = new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear();
      // Nhích sáng nhẹ bù cho KHR_materials_specular=2 trên Material.001 của GLB
      col.multiplyScalar(1.06);
      sums[side][a * 3]     += col.r;
      sums[side][a * 3 + 1] += col.g;
      sums[side][a * 3 + 2] += col.b;
      cnts[side][a]++;

      totR += col.r; totG += col.g; totB += col.b; totCnt++;
    }

    if (totCnt > 30) {
      const avgRgb = [totR / totCnt, totG / totCnt, totB / totCnt];
      const rings = {};
      for (const side of ['-1', '1']) {
        const ring = new Float32Array(NA * 3);
        for (let a = 0; a < NA; a++) {
          if (cnts[side][a] > 0) {
            ring[a * 3]     = sums[side][a * 3] / cnts[side][a];
            ring[a * 3 + 1] = sums[side][a * 3 + 1] / cnts[side][a];
            ring[a * 3 + 2] = sums[side][a * 3 + 2] / cnts[side][a];
          } else {
            ring[a * 3] = avgRgb[0]; ring[a * 3 + 1] = avgRgb[1]; ring[a * 3 + 2] = avgRgb[2];
          }
        }
        // Làm mượt vòng màu 360° (2 lượt) để chuyển sắc mặt trong/ngoài đùi mịn như lụa
        for (let pass = 0; pass < 2; pass++) {
          const snap = new Float32Array(ring);
          for (let a = 0; a < NA; a++) {
            const aM = (a - 1 + NA) % NA, aP = (a + 1) % NA;
            for (let chI = 0; chI < 3; chI++) {
              ring[a * 3 + chI] = snap[aM * 3 + chI] * 0.25 + snap[a * 3 + chI] * 0.50 + snap[aP * 3 + chI] * 0.25;
            }
          }
        }
        rings[side] = ring;
      }
      const avgCol = new THREE.Color(avgRgb[0], avgRgb[1], avgRgb[2]).convertLinearToSRGB();
      return { hex: avgCol.getHex(), avgRgb, rings, roughness: 0.49 };
    }
  } catch (_) {
    // fallback if canvas tainted
  }
  return fallback;
}

// Dò trọn quỹ đạo 3D của 2 cánh tay (từ vai xuống bàn tay/ngón tay), tự nối cầu mượt qua đoạn chạm hông!
function detectArmTubes(allVerts, yOffset, modelH) {
  const waistY = yOffset + modelH * 0.43; // ~1.816 (eo tách rõ 3 khối: thân + 2 tay)
  const sliceAt = (y, halfBand = 0.014) => {
    const pts = [];
    for (let i = 0; i < allVerts.length; i += 3) {
      if (Math.abs(allVerts[i + 1] - y) < halfBand) {
        pts.push(allVerts[i], allVerts[i + 1], allVerts[i + 2]);
      }
    }
    return pts;
  };

  const wComps = find2DComponents(sliceAt(waistY, 0.018), 64, 0.46);
  const seeds = wComps.slice(1)
    .filter(c => c.rx < 0.095 && c.rz < 0.095 && c.cells >= 8)
    .sort((a, b) => a.midX - b.midX); // [0] = viewer-left (-X), [1] = viewer-right (+X)
  if (seeds.length < 2) return [];

  const torsoSeed = wComps[0];
  const armSamples = [[], []];

  // Quét từng lát cắt từ tay dưới (yOffset + 0.08) lên đến nách (yOffset + modelH * 0.54)
  for (let armIdx = 0; armIdx < 2; armIdx++) {
    const seed = seeds[armIdx];
    const sideSign = armIdx === 0 ? -1 : 1;

    // 1. Dò từ eo lên (đến nách ~1.93) và từ eo xuống (đến cổ tay/bàn tay ~1.26)
    for (const dir of [-1, 1]) {
      let tx = seed.midX, tz = seed.midZ;
      let vx = 0, vz = 0;
      let missed = 0;
      for (let step = 0; step < 30; step++) {
        const y = waistY + dir * step * 0.024;
        if (y < yOffset + 0.06 || y > yOffset + modelH * 0.56) break;
        const cs = find2DComponents(sliceAt(y, 0.012), 68, 0.46);
        const predX = tx + vx * Math.min(missed + 1, 6);
        const predZ = tz + vz * Math.min(missed + 1, 6);
        const searchR = 0.085 + missed * 0.016;
        let best = null, bestD = searchR;
        // Ở vùng thấp (y < yOffset + 0.25), đùi tách thành 2 khối lớn nên bỏ mọi khối lớn (rx > 0.085)
        for (let ci = 0; ci < cs.length; ci++) {
          const cp = cs[ci];
          if (cp.rx > 0.088 || cp.rz > 0.088 || cp.cells < 5) continue;
          // Phải ở đúng bên cánh tay đang dò
          if ((cp.midX - torsoSeed.midX) * sideSign < 0.05 && y > yOffset + 0.20) continue;
          const d = Math.hypot(cp.midX - predX, cp.midZ - predZ);
          if (d < bestD) { bestD = d; best = cp; }
        }
        if (best) {
          const rAvg = (best.rx + best.rz) * 0.5;
          const rMax = Math.max(best.rx, best.rz);
          armSamples[armIdx].push({ y, x: best.midX, z: best.midZ, r: rAvg, rMax });
          if (step > 0 && missed === 0) {
            vx = vx * 0.55 + (best.midX - tx) * 0.45;
            vz = vz * 0.55 + (best.midZ - tz) * 0.45;
          } else if (missed > 0) {
            vx = (best.midX - tx) / (missed + 1) * 0.5;
            vz = (best.midZ - tz) / (missed + 1) * 0.5;
          }
          tx = best.midX; tz = best.midZ;
          missed = 0;
        } else {
          missed++;
        }
      }
    }

    // 2. Dò bổ sung chắc chắn cụm bàn tay ở vùng đùi trên (y = 1.27..1.46) để luôn có điểm neo dưới khi cẳng tay chạm hông!
    for (const handY of [yOffset + 0.13, yOffset + 0.17, yOffset + 0.22, yOffset + 0.26]) {
      const cs = find2DComponents(sliceAt(handY, 0.014), 68, 0.46);
      let best = null, bestScore = -1e9;
      for (const cp of cs) {
        if (cp.rx > 0.085 || cp.rz > 0.085 || cp.cells < 6) continue;
        // Bàn tay nằm phía ngoài xa tâm cơ thể
        const latProj = (cp.midX - torsoSeed.midX) * sideSign;
        if (latProj < 0.14) continue;
        if (latProj > bestScore) { bestScore = latProj; best = cp; }
      }
      if (best) {
        const exists = armSamples[armIdx].some(p => Math.abs(p.y - handY) < 0.015);
        if (!exists) {
          armSamples[armIdx].push({
            y: handY,
            x: best.midX,
            z: best.midZ,
            r: (best.rx + best.rz) * 0.5,
            rMax: Math.max(best.rx, best.rz)
          });
        }
      }
    }

    armSamples[armIdx].sort((a, b) => a.y - b.y);
  }

  return armSamples.map((arr, armIdx) => {
    const clean = [];
    for (const p of arr) {
      if (!clean.length || Math.abs(p.y - clean[clean.length - 1].y) > 0.008) clean.push(p);
    }
    const n = clean.length;
    const pLow = clean[0];
    const pHigh = clean[n - 1];
    const pRef = clean[Math.max(0, n - 4)];
    const dyUp = Math.max(0.03, pHigh.y - pRef.y);
    // Bắp tay trên đi gần thẳng đứng lên vai (chỉ hơi chụm nhẹ vào khớp vai)
    const slopeXUp = clamp((pHigh.x - pRef.x) / dyUp * 0.42, -0.18, 0.18);
    const slopeZUp = clamp((pHigh.z - pRef.z) / dyUp * 0.42, -0.18, 0.18);
    const yShoulderTop = yOffset + modelH * 0.71;

    const evalArm = (y) => {
      if (y <= pLow.y) {
        const d = pLow.y - y;
        return {
          x: pLow.x,
          z: pLow.z,
          r: Math.max(0.032, pLow.r - d * 0.18),
          rMax: Math.max(0.042, pLow.rMax - d * 0.12),
          active: d < 0.085
        };
      }
      if (y >= pHigh.y) {
        const d = y - pHigh.y;
        const frac = clamp(d / Math.max(0.08, yShoulderTop - pHigh.y), 0, 1);
        return {
          x: pHigh.x + slopeXUp * d,
          z: pHigh.z + slopeZUp * d,
          r: Math.min(0.068, pHigh.r + frac * 0.012),
          rMax: Math.min(0.078, pHigh.rMax + frac * 0.016),
          active: y <= yShoulderTop + 0.04
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

    return { sideSign: armIdx === 0 ? -1 : 1, clean, pHigh, pLow, evalArm };
  });
}

// Tính bán kính tối đa từ tâm thân (cx, cz) theo góc theta trước khi chạm mặt trong của 2 cánh tay
function createArmLimitFn(arms) {
  return (cx, cz, y, theta, margin = 0.004) => {
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
        if (hitDist > 0.06 && hitDist < limit) limit = hitDist;
      }
    }
    return limit;
  };
}

// Quét bao ngoài 360° trên tập đỉnh đã tách sạch 2 cánh tay (torsoVerts)
// Hỗ trợ bustBridgeTheta để làm phẳng/bắc cầu khe ngực tự nhiên giúp áo sơ mi không bị hở/lõm hay xuyên áo lót
function scanCleanBodyEnvelope(torsoVerts, yTop, yBot, NS, NA, maxRadius = 0.30, options = {}) {
  const { bustBridgeTheta = null, bustBand = null, coreCenter = null, shedHairTheta = null } = options;
  const span = Math.max(0.05, yTop - yBot);
  const buckets = Array.from({ length: NS }, () => []);

  for (let i = 0; i < torsoVerts.length; i += 3) {
    const y = torsoVerts[i + 1];
    if (y < yBot - 0.014 || y > yTop + 0.014) continue;
    const s = clamp(Math.floor(((yTop - y) / span) * NS), 0, NS - 1);
    buckets[s].push(torsoVerts[i], y, torsoVerts[i + 2]);
  }

  let cxArr = new Float32Array(NS);
  let czArr = new Float32Array(NS);
  for (let s = 0; s < NS; s++) {
    const pts = buckets[s];
    let usedCore = false;
    // Tâm thân lấy từ các điểm gần lõi, không kéo theo mái tóc phía sau
    if (coreCenter && pts.length) {
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < pts.length; i += 3) {
        if (Math.hypot(pts[i] - coreCenter.x, pts[i + 2] - coreCenter.z) > 0.16) continue;
        sx += pts[i]; sz += pts[i + 2]; n++;
      }
      if (n >= 12) {
        cxArr[s] = sx / n;
        czArr[s] = sz / n;
        usedCore = true;
      }
    }
    if (!usedCore) {
      let mnX = 1e9, mxX = -1e9, mnZ = 1e9, mxZ = -1e9;
      for (let i = 0; i < pts.length; i += 3) {
        if (pts[i] < mnX) mnX = pts[i]; if (pts[i] > mxX) mxX = pts[i];
        if (pts[i + 2] < mnZ) mnZ = pts[i + 2]; if (pts[i + 2] > mxZ) mxZ = pts[i + 2];
      }
      cxArr[s] = pts.length ? (mnX + mxX) * 0.5 : (s > 0 ? cxArr[s - 1] : 0);
      czArr[s] = pts.length ? (mnZ + mxZ) * 0.5 : (s > 0 ? czArr[s - 1] : 0);
    }
  }
  cxArr = smooth1D(cxArr, 2);
  czArr = smooth1D(czArr, 2);

  const radArr = new Float32Array(NS * NA);
  const hairBins = shedHairTheta != null ? new Array(NS * NA) : null;
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
      if (r > radArr[s * NA + a0]) radArr[s * NA + a0] = r;
      if (r > radArr[s * NA + a1]) radArr[s * NA + a1] = r;
      if (hairBins && Math.cos(ang - shedHairTheta) < -0.45) {
        const key = s * NA + a0;
        (hairBins[key] || (hairBins[key] = [])).push(r);
      }
    }
  }
  finalizePolarEnvelope(radArr, NS, NA, 0.055, 2);

  // Bắc cầu lồi nhẹ qua khe ngực trước để vải áo căng tự nhiên qua vòng 1 (không lõm sâu hoặc xuyên áo lót)
  if (bustBridgeTheta !== null) {
    const yLo = bustBand ? bustBand[0] : (yBot + span * 0.30);
    const yHi = bustBand ? bustBand[1] : (yTop - span * 0.12);
    for (let s = 0; s < NS; s++) {
      const y = yTop - (s / (NS - 1)) * span;
      if (y < yLo || y > yHi) continue;
      // Làm căng lồi theo dây cung giữa các đỉnh ngực trong dải góc ±55° quanh mặt trước
      const row = new Float32Array(NA);
      for (let a = 0; a < NA; a++) row[a] = radArr[s * NA + a];
      for (let a = 0; a < NA; a++) {
        const ang = (a / NA) * Math.PI * 2;
        const cosDiff = Math.cos(ang - bustBridgeTheta);
        if (cosDiff < 0.45) continue;
        // Tìm giá trị bắc cầu từ các góc lân cận ±3..±8 bước để nâng khe ngực lên tự nhiên
        let bestBridge = row[a];
        for (let spanA = 2; spanA <= 7; spanA++) {
          const aL = (a - spanA + NA) % NA;
          const aR = (a + spanA) % NA;
          const avgLR = (row[aL] + row[aR]) * 0.5 * Math.cos((spanA / NA) * Math.PI * 2 * 0.65);
          if (avgLR > bestBridge) bestBridge = avgLR;
        }
        const blend = smoothstep(0.45, 0.85, cosDiff);
        radArr[s * NA + a] = row[a] * (1 - blend * 0.88) + bestBridge * (blend * 0.88);
      }
    }
  }

  // Tóc dài là lớp vỏ ngoài sau lưng. Lấy bán kính da trước khe hở đó để áo ôm lưng, không ôm tóc.
  if (hairBins && shedHairTheta != null) {
    for (let s = 0; s < NS; s++) {
      for (let a = 0; a < NA; a++) {
        const ang = (a / NA) * Math.PI * 2;
        if (Math.cos(ang - shedHairTheta) > -0.5) continue;
        const list = hairBins[s * NA + a];
        if (!list || list.length < 8) continue;
        list.sort((p, q) => p - q);
        let bestGap = 0, cut = -1;
        const i0 = Math.floor(list.length * 0.2);
        const i1 = Math.max(i0 + 1, Math.floor(list.length * 0.9));
        for (let i = i0; i < i1 && i < list.length - 1; i++) {
          const gap = list[i + 1] - list[i];
          if (gap > bestGap) { bestGap = gap; cut = i; }
        }
        const p40 = list[Math.floor(list.length * 0.4)];
        const p90 = list[Math.min(list.length - 1, Math.floor(list.length * 0.9))];
        let bodyR = null;
        if (bestGap >= 0.006 && cut >= 0) bodyR = list[cut];
        else if (p90 - p40 >= 0.012) bodyR = p40;
        if (bodyR != null && bodyR > 0.04) radArr[s * NA + a] = bodyR;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const out = new Float32Array(radArr);
      for (let s = 0; s < NS; s++) {
        for (let a = 0; a < NA; a++) {
          const ang = (a / NA) * Math.PI * 2;
          if (Math.cos(ang - shedHairTheta) > -0.45) continue;
          let acc = 0, w = 0;
          for (let ds = -1; ds <= 1; ds++) {
            const sj = clamp(s + ds, 0, NS - 1);
            for (let da = -1; da <= 1; da++) {
              const aj = (a + da + NA) % NA;
              const nang = (aj / NA) * Math.PI * 2;
              if (Math.cos(nang - shedHairTheta) > -0.35) continue;
              const wt = (ds === 0 && da === 0) ? 4 : 2;
              acc += radArr[sj * NA + aj] * wt;
              w += wt;
            }
          }
          if (w > 0) out[s * NA + a] = acc / w;
        }
      }
      radArr.set(out);
    }
  }

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

// Tạo đôi giày Mary-Jane nữ sinh Nhật thanh mảnh, thon gọn, ôm sát cổ chân & đúng hướng bàn chân
function buildMaryJaneShoe(shoeMat, buckleMat, yawAngle) {
  const shoe = new THREE.Group();
  shoe.rotation.y = yawAngle;

  // 1. Thân giày thon dáng almond-toe (loft từ gót z=-0.068 đến mũi z=+0.135)
  const stations = [
    { z: -0.068, yBot: 0.018, yTop: 0.084, w: 0.024 },
    { z: -0.052, yBot: 0.016, yTop: 0.096, w: 0.035 },
    { z: -0.025, yBot: 0.015, yTop: 0.090, w: 0.039 },
    { z:  0.005, yBot: 0.014, yTop: 0.078, w: 0.038 },
    { z:  0.042, yBot: 0.012, yTop: 0.074, w: 0.042 },
    { z:  0.082, yBot: 0.011, yTop: 0.048, w: 0.043 },
    { z:  0.112, yBot: 0.012, yTop: 0.037, w: 0.034 },
    { z:  0.130, yBot: 0.015, yTop: 0.027, w: 0.019 },
    { z:  0.138, yBot: 0.018, yTop: 0.022, w: 0.006 }
  ];
  const segU = 28;
  const verts = [], indices = [];
  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    const yc = (st.yBot + st.yTop) * 0.5;
    const ry = (st.yTop - st.yBot) * 0.5;
    for (let u = 0; u <= segU; u++) {
      const ang = (u / segU) * Math.PI * 2;
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      // Mặt đáy phẳng gọn, mặt trên bo tròn mượt như da bóng thật
      const yOff = sinA >= 0 ? Math.pow(sinA, 0.85) * ry : -Math.pow(-sinA, 0.55) * ry;
      const x = cosA * st.w;
      const y = yc + yOff;
      verts.push(x, y, st.z);
    }
  }
  const stride = segU + 1;
  for (let s = 0; s < stations.length - 1; s++) {
    for (let u = 0; u < segU; u++) {
      const a = s * stride + u, b = a + 1, c = (s + 1) * stride + u, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Đóng mũi & gót mượt (hướng normal ra ngoài)
  const heelIdx = verts.length / 3;
  verts.push(0, 0.040, -0.072);
  for (let u = 0; u < segU; u++) indices.push(heelIdx, u + 1, u);

  const toeIdx = verts.length / 3;
  verts.push(0, 0.020, 0.141);
  const lastRow = (stations.length - 1) * stride;
  for (let u = 0; u < segU; u++) indices.push(lastRow + u, lastRow + u + 1, toeIdx);

  const upperGeo = new THREE.BufferGeometry();
  upperGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  upperGeo.setIndex(indices);
  upperGeo.computeVertexNormals();
  const upperMesh = new THREE.Mesh(upperGeo, shoeMat);
  shoe.add(upperMesh);

  // 2. Đế giày thon mảnh + gót thấp thanh lịch (1.8cm)
  const soleShape = new THREE.Shape();
  soleShape.moveTo(0, -0.068);
  soleShape.bezierCurveTo(0.036, -0.068, 0.042, -0.025, 0.039, 0.010);
  soleShape.bezierCurveTo(0.044, 0.055, 0.046, 0.105, 0.024, 0.134);
  soleShape.bezierCurveTo(0.012, 0.143, -0.012, 0.143, -0.024, 0.134);
  soleShape.bezierCurveTo(-0.046, 0.105, -0.044, 0.055, -0.039, 0.010);
  soleShape.bezierCurveTo(-0.042, -0.025, -0.036, -0.068, 0, -0.068);

  const soleGeo = new THREE.ExtrudeGeometry(soleShape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 2
  });
  soleGeo.rotateX(Math.PI / 2);
  const soleMesh = new THREE.Mesh(soleGeo, shoeMat);
  soleMesh.position.set(0, 0.014, 0);
  shoe.add(soleMesh);

  const heelGeo = new THREE.CylinderGeometry(0.028, 0.024, 0.018, 20);
  const heelMesh = new THREE.Mesh(heelGeo, shoeMat);
  heelMesh.scale.set(1.12, 1.0, 1.25);
  heelMesh.position.set(0, 0.009, -0.036);
  shoe.add(heelMesh);

  // 3. Quai Mary-Jane thanh mảnh ôm mu bàn chân + khóa kim loại nhỏ
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.0055, 10, 26, Math.PI), shoeMat);
  strap.position.set(0, 0.044, 0.028);
  strap.rotation.y = Math.PI * 0.5;
  strap.rotation.x = 0.28;
  strap.scale.set(0.88, 1.02, 1.04);
  shoe.add(strap);

  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.011, 0.011), buckleMat);
  buckle.position.set(0.038, 0.056, 0.030);
  shoe.add(buckle);

  shoe.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return shoe;
}

// Nối liền đôi chân dưới chuẩn giải phẫu + khớp màu da 360° GLB + dải hòa trộn xóa vết cắt + giày Mary-Jane + viền ren tất đùi
function buildSeamlessLowerLegsAndProfile(scene, model, torsoVerts, yCut, modelH, skinTex, skinSSSUniform) {
  const NA = 72;
  // Mép nối sạch nằm ngay tại ySeam = yCut + 0.006 (đã cắt bỏ hoàn toàn hàng tam giác nắp đáy normal tối!)
  const ySeam = yCut + 0.006;

  // Quét lát mỏng sát ySeam (ySeam .. ySeam+0.012) & lát cao hơn (+0.042) trên torsoVerts ĐÃ SẠCH TAY!
  const cutPts = [];
  const upPts = [];
  for (let i = 0; i < torsoVerts.length; i += 3) {
    const y = torsoVerts[i + 1];
    if (y >= ySeam && y <= ySeam + 0.012) cutPts.push(torsoVerts[i], y, torsoVerts[i + 2]);
    else if (y >= ySeam + 0.036 && y <= ySeam + 0.052) upPts.push(torsoVerts[i], y, torsoVerts[i + 2]);
  }
  const comps = find2DComponents(cutPts, 60, 0.46).filter(c => c.rx > 0.055 && c.rz > 0.055);
  const thighComps = comps.slice(0, 2).sort((a, b) => a.midX - b.midX);
  const leftComp = thighComps[0] || { midX: -0.188, midZ: 0.042, rx: 0.125, rz: 0.132 };
  const rightComp = thighComps[1] || { midX: 0.092, midZ: 0.140, rx: 0.110, rz: 0.112 };

  const upComps = find2DComponents(upPts, 60, 0.46)
    .filter(c => c.rx > 0.06 && c.rz > 0.06)
    .slice(0, 2)
    .sort((a, b) => a.midX - b.midX);
  const upLeft = upComps[0] || leftComp;
  const upRight = upComps[1] || rightComp;

  const cutInfo = { '-1': leftComp, '1': rightComp };
  const upInfo = { '-1': upLeft, '1': upRight };
  const cutRad = { '-1': new Float32Array(NA), '1': new Float32Array(NA) };
  const upRad  = { '-1': new Float32Array(NA), '1': new Float32Array(NA) };

  // Lấy mẫu bảng màu da 360° ngay quanh mép nối đùi GLB!
  const glbSkinInfo = sampleGLBThighSkinRings(model, ySeam, cutInfo, NA);

  // Tính độ nghiêng & tốc độ thuôn bán kính thật của 2 đùi GLB tại mép nối ySeam để nối tiếp tuyến C1 tuyệt đối!
  const thighSlope = {};
  for (const side of ['-1', '1']) {
    const cp = cutInfo[side];
    const up = upInfo[side];
    thighSlope[side] = {
      dxDy: clamp((up.midX - cp.midX) / 0.038, -0.35, 0.35),
      dzDy: clamp((up.midZ - cp.midZ) / 0.038, -0.35, 0.35)
    };
    const fillRing = (comp, ptsArr, outArr) => {
      if (comp.vertIndices) {
        for (let k = 0; k < comp.vertIndices.length; k++) {
          const vi = comp.vertIndices[k];
          const dx = ptsArr[vi] - comp.midX;
          const dz = ptsArr[vi + 2] - comp.midZ;
          const r = Math.hypot(dx, dz);
          if (r > 0.20) continue;
          let ang = Math.atan2(dz, dx);
          if (ang < 0) ang += Math.PI * 2;
          const a = Math.floor((ang / (Math.PI * 2)) * NA) % NA;
          if (r > outArr[a]) outArr[a] = r;
        }
      }
      let avg = 0, cnt = 0;
      for (let a = 0; a < NA; a++) if (outArr[a] > 0.02) { avg += outArr[a]; cnt++; }
      const fb = cnt > 0 ? avg / cnt : 0.115;
      for (let a = 0; a < NA; a++) if (outArr[a] < 0.02) outArr[a] = fb;
      const sm = new Float32Array(NA);
      for (let a = 0; a < NA; a++) {
        let acc = 0, w = 0;
        for (let d = -1; d <= 1; d++) {
          const wt = 2 - Math.abs(d);
          acc += outArr[(a + d + NA) % NA] * wt; w += wt;
        }
        sm[a] = acc / w;
      }
      outArr.set(sm);
    };
    fillRing(cp, cutPts, cutRad[side]);
    fillRing(up, upPts, upRad[side]);
  }

  // Hướng xoay tự nhiên của 2 bàn chân/đầu gối khớp tư thế contrapposto của nhân vật GLB
  const legYaw = { '-1': -0.22, '1': -0.10 };
  const legFloorY = 0.042;

  const evalLegCenter = (sideKey, y) => {
    const cp = cutInfo[sideKey];
    const sl = thighSlope[sideKey];
    if (y >= ySeam) {
      const dy = y - ySeam;
      return {
        cx: cp.midX + sl.dxDy * dy,
        cz: cp.midZ + sl.dzDy * dy
      };
    }
    const sgn = sideKey === '-1' ? -1 : 1;
    const dyDown = ySeam - y;
    const u = clamp(dyDown / Math.max(0.1, ySeam - legFloorY), 0, 1);

    // Tiếp tuyến C1 ngay dưới ySeam, sau đó duỗi thẳng thanh thoát xuống gối, bắp chân và cổ chân
    const tangDecay = Math.min(dyDown, 0.14) * (1 - smoothstep(0.0, 0.28, u) * 0.45);
    const yaw = legYaw[sideKey];
    const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
    const latX = Math.cos(yaw), latZ = -Math.sin(yaw);

    const kneeShift = 0.012 * gauss(u, 0.34, 0.15);
    const calfBack = -0.020 * gauss(u, 0.62, 0.16);
    const stanceAlign = -0.014 * smoothstep(0.10, 0.88, u);
    const footFwd = 0.028 * smoothstep(0.88, 1.0, u);
    const fwdOff = kneeShift + calfBack + stanceAlign + footFwd;
    const latOff = sgn * (-0.014 * smoothstep(0.05, 0.42, u) + 0.010 * smoothstep(0.55, 0.96, u));

    const cx = cp.midX - sl.dxDy * tangDecay * 0.42 + fwdX * fwdOff + latX * latOff;
    const cz = cp.midZ - sl.dzDy * tangDecay * 0.42 + fwdZ * fwdOff + latZ * latOff;
    return { cx, cz };
  };

  const sampleRingVal = (arr, theta) => {
    let ang = theta % (Math.PI * 2);
    if (ang < 0) ang += Math.PI * 2;
    const af = (ang / (Math.PI * 2)) * NA;
    const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA, at = af - Math.floor(af);
    return arr[a0] * (1 - at) + arr[a1] * at;
  };

  const sampleRingColor = (sideKey, theta) => {
    const ring = glbSkinInfo.rings[sideKey];
    let ang = theta % (Math.PI * 2);
    if (ang < 0) ang += Math.PI * 2;
    const af = (ang / (Math.PI * 2)) * NA;
    const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA, at = af - Math.floor(af);
    return [
      ring[a0 * 3]     * (1 - at) + ring[a1 * 3]     * at,
      ring[a0 * 3 + 1] * (1 - at) + ring[a1 * 3 + 1] * at,
      ring[a0 * 3 + 2] * (1 - at) + ring[a1 * 3 + 2] * at
    ];
  };

  const evalLowerRadius = (sideKey, y, theta) => {
    const sgn = sideKey === '-1' ? -1 : 1;
    const rCut = sampleRingVal(cutRad[sideKey], theta);
    const rUp = sampleRingVal(upRad[sideKey], theta);
    const drDy = clamp((rUp - rCut) / 0.038, -0.05, 0.25);

    // Phía trên ySeam (vùng dải hòa trộn Seam Bridge): bám sát đúng độ nở thực của đùi GLB!
    if (y >= ySeam) {
      return rCut + drDy * (y - ySeam);
    }

    const u = clamp((ySeam - y) / Math.max(0.1, ySeam - legFloorY), 0, 1);

    // Xoay góc theta về hệ tọa độ cục bộ của chân (sinL = +1 là mặt trước đầu gối, -1 là sau bắp chân)
    const localTheta = theta + legYaw[sideKey];
    const cosL = Math.cos(localTheta), sinL = Math.sin(localTheta);

    const thighTaper = 1 - smoothstep(0.0, 0.42, u);
    const lowerQuad  = gauss(u, 0.18, 0.14);
    const kneeCap    = gauss(u, 0.36, 0.080);
    const subKnee    = gauss(u, 0.45, 0.065);
    const calfCurve  = gauss(u, 0.60, 0.135);
    const ankleSlim  = gauss(u, 0.89, 0.085);
    const footEntry  = smoothstep(0.90, 1.0, u);

    const rx = 0.048
      + 0.056 * Math.pow(thighTaper, 0.82)
      + 0.008 * lowerQuad
      + 0.0085 * kneeCap
      - 0.0040 * subKnee
      + 0.0175 * calfCurve
      - 0.0115 * ankleSlim
      - 0.003 * footEntry;

    const rz = 0.051
      + 0.060 * Math.pow(thighTaper, 0.82)
      + 0.008 * lowerQuad
      + 0.0105 * kneeCap
      - 0.0032 * subKnee
      + 0.0225 * calfCurve
      - 0.0095 * ankleSlim
      + 0.014 * footEntry;

    let rAna = 1 / (Math.hypot(cosL / rx, sinL / rz) || 1);
    rAna += Math.max(0, sinL) * 0.0060 * kneeCap;
    rAna -= Math.max(0, -sinL) * 0.0055 * kneeCap;
    rAna += Math.max(0, -sinL) * 0.0145 * calfCurve;
    rAna += Math.max(0, sgn * cosL) * 0.0045 * gauss(u, 0.56, 0.12);
    rAna -= Math.max(0, Math.abs(cosL)) * 0.0035 * ankleSlim;

    // Tiếp tuyến C1 với tốc độ thuôn drDy của đùi GLB ngay tại ySeam rồi hòa mượt sang dáng giải phẫu!
    const rCont = rCut - drDy * Math.min(ySeam - y, 0.08);
    const blend = smoothstep(0.0, 0.44, u);
    return rCont * (1 - blend) + rAna * blend;
  };

  // Chất liệu da chân dưới dùng vertexColors 360° lấy mẫu trực tiếp từng góc từ texture đùi GLB -> khớp 100% sáng tối!
  const legSkinMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(0.014, 0.014),
    roughness: glbSkinInfo.roughness,
    metalness: 0.01,
    specularIntensity: 1.0,
    specularColor: new THREE.Color(0xfff5f0),
    sheen: 0.12,
    sheenRoughness: 0.72,
    sheenColor: new THREE.Color(0xfff2ec),
    envMapIntensity: 0.64
  });
  legSkinMat.userData.isVertexColoredGlbSkin = true;

  // Dải hòa trộn da 7.5cm mờ dần 2 đầu (alpha feathering 0 -> 1 -> 0) đồng nhất 100% vật liệu với legSkinMat để xóa cả vết cắt mờ!
  const seamBlendMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    alphaMap: createSeamBlendAlphaMap(),
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(0.014, 0.014),
    transparent: true,
    depthWrite: false,
    roughness: glbSkinInfo.roughness,
    metalness: 0.01,
    specularIntensity: 1.0,
    specularColor: new THREE.Color(0xfff5f0),
    sheen: 0.12,
    sheenRoughness: 0.72,
    sheenColor: new THREE.Color(0xfff2ec),
    envMapIntensity: 0.64,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2
  });
  legSkinMat.userData.seamBlendMat = seamBlendMat;

  const shoeMat = new THREE.MeshPhysicalMaterial({
    color: 0x151318,
    roughness: 0.22,
    metalness: 0.08,
    clearcoat: 0.78,
    clearcoatRoughness: 0.16,
    envMapIntensity: 0.85
  });
  const buckleMat = new THREE.MeshStandardMaterial({
    color: 0xdbe2ec,
    roughness: 0.24,
    metalness: 0.88
  });

  const lowerLegGroup = new THREE.Group();
  const lowerLegMeshes = [];
  const seamBlendMeshes = [];
  const avgRgb = glbSkinInfo.avgRgb;

  for (const sideKey of ['-1', '1']) {
    // 1. Thân chân dưới đặc (opaque, depthWrite=true) nối sát ySeam xuống bàn chân
    const segY = 78, segR = 64;
    const yStart = ySeam + 0.078;
    const yEnd = 0.016;
    const verts = [], colors = [], uvs = [], indices = [];

    for (let r = 0; r <= segY; r++) {
      const f = r / segY;
      const y = yStart - f * (yStart - yEnd);
      const { cx, cz } = evalLegCenter(sideKey, y);
      // Phần overlap 5mm trên ySeam khép cực nhẹ 0.4mm vào trong để kín tuyệt đối không bao giờ hở khe
      const tuck = y > ySeam ? (1.0 - smoothstep(ySeam, yStart, y) * 0.004) : 1.0;
      const colorFade = smoothstep(0.22, 0.78, f) * 0.28;
      for (let c = 0; c <= segR; c++) {
        const u = c / segR;
        const theta = u * Math.PI * 2;
        let rad = evalLowerRadius(sideKey, y, theta) * tuck;
        if (y < 0.10) rad *= 0.72 + 0.28 * smoothstep(0.016, 0.10, y);
        // Nổi 0.6mm để kín khe ghép, nhưng luôn nằm trong offset tất lưới (~1.7mm)
        // kẻo mặt trước đùi đè texture da lên sợi lưới.
        rad += 0.0006;
        verts.push(cx + Math.cos(theta) * rad, y, cz + Math.sin(theta) * rad);
        const rc = sampleRingColor(sideKey, theta);
        colors.push(
          rc[0] * (1 - colorFade) + avgRgb[0] * colorFade,
          rc[1] * (1 - colorFade) + avgRgb[1] * colorFade,
          rc[2] * (1 - colorFade) + avgRgb[2] * colorFade
        );
        uvs.push(u, f);
      }
    }
    const stride = segR + 1;
    for (let r = 0; r < segY; r++) {
      for (let c = 0; c < segR; c++) {
        const a = r * stride + c, b = a + 1, cc = (r + 1) * stride + c, d = cc + 1;
        indices.push(a, b, cc, b, d, cc);
      }
    }
    const lastRow = segY * stride;
    const capAt = evalLegCenter(sideKey, yEnd);
    const capI = verts.length / 3;
    verts.push(capAt.cx, yEnd - 0.006, capAt.cz + 0.012);
    const capCol = sampleRingColor(sideKey, Math.PI * 0.5);
    colors.push(capCol[0], capCol[1], capCol[2]);
    uvs.push(0.5, 1);
    for (let c = 0; c < segR; c++) indices.push(capI, lastRow + c + 1, lastRow + c);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const legMesh = new THREE.Mesh(geo, legSkinMat);
    legMesh.castShadow = true;
    legMesh.receiveShadow = true;
    lowerLegGroup.add(legMesh);
    lowerLegMeshes.push(legMesh);

    // 2. Dải cầu hòa trộn da 7.6cm (ySeam - 0.036 .. ySeam + 0.040) ôm mượt ngoài biên GLB thực +1.2mm -> xóa triệt để cả vết cắt mờ!
    const bSegY = 24, bSegR = 64;
    const bTop = ySeam + 0.086;
    const bBot = ySeam + 0.042;
    // Quét nhanh bán kính tối đa thực tế của GLB trong dải ySeam..bTop để dải hòa trộn không bao giờ bị mép GLB đâm xuyên
    const glbBandMax = new Float32Array((bSegY + 1) * NA);
    for (let i = 0; i < torsoVerts.length; i += 3) {
      const vx = torsoVerts[i], vy = torsoVerts[i + 1], vz = torsoVerts[i + 2];
      if (vy < ySeam - 0.002 || vy > bTop + 0.006) continue;
      const cAt = evalLegCenter(sideKey, vy);
      const dx = vx - cAt.cx, dz = vz - cAt.cz;
      const r = Math.hypot(dx, dz);
      if (r > 0.165) continue;
      const rf = clamp((bTop - vy) / (bTop - bBot), 0, 1) * bSegY;
      const r0 = Math.floor(rf), r1 = Math.min(bSegY, r0 + 1);
      let ang = Math.atan2(dz, dx); if (ang < 0) ang += Math.PI * 2;
      const a = Math.floor((ang / (Math.PI * 2)) * NA) % NA;
      if (r > glbBandMax[r0 * NA + a]) glbBandMax[r0 * NA + a] = r;
      if (r > glbBandMax[r1 * NA + a]) glbBandMax[r1 * NA + a] = r;
    }

    const bVerts = [], bCols = [], bUVs = [], bIdx = [];
    for (let r = 0; r <= bSegY; r++) {
      const f = r / bSegY; // 0 = trên (GLB) -> 1 = dưới (chân nối)
      const y = bTop - f * (bTop - bBot);
      const { cx, cz } = evalLegCenter(sideKey, y);
      for (let c = 0; c <= bSegR; c++) {
        const u = c / bSegR;
        const theta = u * Math.PI * 2;
        let ang = theta % (Math.PI * 2); if (ang < 0) ang += Math.PI * 2;
        const a0 = Math.floor((ang / (Math.PI * 2)) * NA) % NA;
        const rAna = evalLowerRadius(sideKey, y, theta);
        const rGlb = y >= ySeam - 0.004 ? glbBandMax[r * NA + a0] : 0;
        // Dải hòa trộn nằm dưới sợi lưới (offset tất ~1.7mm) để không phủ da lên mắt lưới khi nhìn chính diện
        const rad = Math.max(rAna, rGlb) + 0.0004;
        bVerts.push(cx + Math.cos(theta) * rad, y, cz + Math.sin(theta) * rad);
        const rc = sampleRingColor(sideKey, theta);
        bCols.push(rc[0], rc[1], rc[2]);
        bUVs.push(u, 1.0 - f);
      }
    }
    const bStride = bSegR + 1;
    for (let r = 0; r < bSegY; r++) {
      for (let c = 0; c < bSegR; c++) {
        const a = r * bStride + c, b = a + 1, cc = (r + 1) * bStride + c, d = cc + 1;
        bIdx.push(a, b, cc, b, d, cc);
      }
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bVerts, 3));
    bGeo.setAttribute('color', new THREE.Float32BufferAttribute(bCols, 3));
    bGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bUVs, 2));
    bGeo.setIndex(bIdx);
    bGeo.computeVertexNormals();
    const blendMesh = new THREE.Mesh(bGeo, seamBlendMat);
    blendMesh.renderOrder = 0;
    blendMesh.receiveShadow = true;
    lowerLegGroup.add(blendMesh);
    seamBlendMeshes.push(blendMesh);

    const footPos = evalLegCenter(sideKey, 0.068);
    const shoe = buildMaryJaneShoe(shoeMat, buckleMat, legYaw[sideKey]);
    shoe.position.set(footPos.cx, 0, footPos.cz);
    lowerLegGroup.add(shoe);
  }
  scene.add(lowerLegGroup);

  // Tất đùi bắt đầu ở yCut + 0.095 (~1.275, ngay dưới gấu váy xếp ly ~1.305) xuống gọn vào cổ giày (0.065)
  const legYTop = yCut + 0.095;
  const legYBot = 0.030;
  const legSpan = legYTop - legYBot;
  const NS = 68;
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
        let rr = evalLowerRadius(sideKey, Math.min(y, yCut), theta);
        if (y < 0.12) rr *= 0.62 + 0.38 * smoothstep(0.03, 0.12, y);
        radArr[sideKey][s * NA + a] = rr;
      }
    }
  }

  // Quét đùi trên GLB từ torsoVerts (ĐÃ LOẠI SẠCH BÀN TAY/NGÓN TAY nên không bao giờ bị gai lưới thò ra ngoài!)
  for (let i = 0; i < torsoVerts.length; i += 3) {
    const x = torsoVerts[i], y = torsoVerts[i + 1], z = torsoVerts[i + 2];
    if (y < yCut - 0.005 || y > legYTop + 0.015) continue;
    const cL = evalLegCenter('-1', y);
    const cR = evalLegCenter('1', y);
    const dL = Math.hypot(x - cL.cx, z - cL.cz);
    const dR = Math.hypot(x - cR.cx, z - cR.cz);
    if (Math.min(dL, dR) > 0.165) continue;
    const sideKey = dL < dR ? '-1' : '1';
    const cUse = sideKey === '-1' ? cL : cR;
    const sf = clamp((legYTop - y) / legSpan, 0, 1) * (NS - 1);
    const s0 = Math.floor(sf), s1 = Math.min(NS - 1, s0 + 1);
    const dx = x - cUse.cx, dz = z - cUse.cz;
    const r = Math.hypot(dx, dz);
    if (r > 0.162) continue;
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

  // Làm mượt vùng giao giữa đùi GLB và chân dưới (s <= cutSliceLimit) để tất bó sát tuyệt đối không gãy khúc
  const cutSliceLimit = clamp(Math.ceil(((legYTop - (yCut - 0.03)) / legSpan) * NS), 5, NS - 1);
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
        tmpOut[s * NA + a] = Math.max(0.036, acc / w, arr[s * NA + a] * 0.65 + (acc / w) * 0.35);
      }
    }
    arr.set(tmpOut);
  }

  // Viền ren & đai chun tinh tế ở miệng trên đôi tất đùi (tự đổi màu theo Đen / Đỏ rượu / Trắng!)
  const laceAlpha = createLaceBandTexture();
  const laceMat = new THREE.MeshPhysicalMaterial({
    color: 0x161a22,
    alphaMap: laceAlpha,
    transparent: true,
    alphaTest: 0.16,
    roughness: 0.56,
    sheen: 0.62,
    sheenColor: new THREE.Color(0x94a3b8),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide
  });

  const sampleBuiltLeg = (sideKey, t, theta, radialOff) => {
    const ct = clamp(t, 0, 1);
    const y = legYTop - ct * legSpan;
    const sf = ct * (NS - 1);
    const s0 = Math.floor(sf), s1 = Math.min(NS - 1, s0 + 1), st = sf - s0;
    const cx = cxArr[sideKey][s0] * (1 - st) + cxArr[sideKey][s1] * st;
    const cz = czArr[sideKey][s0] * (1 - st) + czArr[sideKey][s1] * st;
    let ang = theta % (Math.PI * 2); if (ang < 0) ang += Math.PI * 2;
    const af = (ang / (Math.PI * 2)) * NA;
    const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA, at = af - Math.floor(af);
    const arr = radArr[sideKey];
    const r0 = arr[s0 * NA + a0] * (1 - at) + arr[s0 * NA + a1] * at;
    const r1 = arr[s1 * NA + a0] * (1 - at) + arr[s1 * NA + a1] * at;
    const r = Math.max(0.035, r0 + (r1 - r0) * st) + radialOff;
    return { x: cx + Math.cos(theta) * r, y, z: cz + Math.sin(theta) * r };
  };

  for (const sideKey of ['-1', '1']) {
    const segU = 64, segV = 8;
    const tTop = 0.008, tBot = 0.056;
    const pos = [], uvs = [], idx = [];
    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV;
      const t = tTop + v * (tBot - tTop);
      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU;
        const pt = sampleBuiltLeg(sideKey, t, u * Math.PI * 2, 0.0032);
        pos.push(pt.x, pt.y, pt.z);
        uvs.push(u, 1 - v);
      }
    }
    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    lGeo.setIndex(idx);
    lGeo.computeVertexNormals();
    const lMesh = new THREE.Mesh(lGeo, laceMat);
    lMesh.renderOrder = 4;
    lowerLegGroup.add(lMesh);
  }

  return {
    legSkinMat,
    laceMat,
    lowerLegMeshes,
    seamBlendMeshes,
    legProfile: {
      yTop: legYTop,
      yBot: legYBot,
      ySpan: legSpan,
      NS,
      NA,
      cxArr,
      czArr,
      radArr,
      tMin: 0.022,
      tMax: 1,
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

const MODEL_CACHE_DB = 'fishnet-model-cache';
const MODEL_CACHE_STORE = 'models';

function openModelCacheDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(MODEL_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MODEL_CACHE_STORE)) {
          db.createObjectStore(MODEL_CACHE_STORE, { keyPath: 'url' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function readCachedModel(cacheKey) {
  const db = await openModelCacheDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readonly');
      const req = tx.objectStore(MODEL_CACHE_STORE).get(cacheKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch (_) {
      db.close();
      resolve(null);
    }
  });
}

async function writeCachedModel(record) {
  const db = await openModelCacheDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite');
      tx.objectStore(MODEL_CACHE_STORE).put(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch (_) {
      db.close();
      resolve();
    }
  });
}

async function deleteCachedModel(cacheKey) {
  const db = await openModelCacheDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite');
      tx.objectStore(MODEL_CACHE_STORE).delete(cacheKey);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch (_) {
      db.close();
      resolve();
    }
  });
}

function getVersionFromHeaders(headers) {
  const etag = headers.get('etag');
  const lastMod = headers.get('last-modified');
  const len = headers.get('content-length');
  if (etag) return `etag:${etag}`;
  if (lastMod || len) return `meta:${lastMod || ''}|${len || ''}`;
  return '';
}

async function fetchRemoteVersion(url, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache', signal: ctrl.signal });
    if (!res.ok) return null;
    return getVersionFromHeaders(res.headers);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchModelBufferWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  const version = getVersionFromHeaders(res.headers);
  const total = Number(res.headers.get('content-length')) || 0;

  if (!res.body || !res.body.getReader) {
    const buffer = await res.arrayBuffer();
    if (onProgress) onProgress(1);
    return { buffer, version };
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (onProgress && total > 0) onProgress(Math.min(0.99, loaded / total));
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer: merged.buffer, version };
}

async function loadGLBArrayBuffer(url, { onProgress, onStatus } = {}) {
  const cacheKey = new URL(url, window.location.href).pathname;
  const cached = await readCachedModel(cacheKey);
  if (cached && cached.buffer instanceof ArrayBuffer && cached.buffer.byteLength > 0) {
    const remoteVersion = await fetchRemoteVersion(url);
    const isFresh = !remoteVersion || !cached.version || remoteVersion === cached.version;
    if (isFresh) {
      if (onStatus) onStatus('Đang mở model từ bộ nhớ đệm...');
      if (onProgress) onProgress(0.99);
      return { buffer: cached.buffer, fromCache: true, cacheKey };
    }
  }

  if (onStatus) onStatus('Đang tải model nhân vật 3D...');
  const { buffer, version } = await fetchModelBufferWithProgress(url, onProgress);
  await writeCachedModel({ url: cacheKey, version, buffer, savedAt: Date.now() });
  return { buffer, fromCache: false, cacheKey };
}

export async function loadGLBCharacter(scene, url, { skinTex, skinSSSUniform, onProgress, onStatus } = {}) {
  const loader = new GLTFLoader();
  const basePath = url.slice(0, url.lastIndexOf('/') + 1);

  const parseGLTF = (buffer) => new Promise((resolve, reject) => {
    loader.parse(buffer, basePath, resolve, reject);
  });

  let gltf;
  const { buffer, fromCache, cacheKey } = await loadGLBArrayBuffer(url, { onProgress, onStatus });
  try {
    gltf = await parseGLTF(buffer);
  } catch (parseErr) {
    if (!fromCache) throw parseErr;
    await deleteCachedModel(cacheKey);
    if (onStatus) onStatus('Đang tải lại model nhân vật 3D...');
    const fresh = await fetchModelBufferWithProgress(url, onProgress);
    await writeCachedModel({ url: cacheKey, version: fresh.version, buffer: fresh.buffer, savedAt: Date.now() });
    gltf = await parseGLTF(fresh.buffer);
  }

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

        // Xóa bỏ nắp đáy phẳng tối màu ở mép cắt đùi để chân nối mượt không còn viền đen
        if (isUpperBodyCut) {
          stripFlatCutCapTriangles(model, yOffset);
        }

        const allVerts = [];
        const normMat = new THREE.Matrix3();
        const tmpN = new THREE.Vector3();
        model.traverse((obj) => {
          if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
          const attr = obj.geometry.attributes.position;
          const nAttr = obj.geometry.attributes.normal;
          const mat = obj.matrixWorld;
          normMat.getNormalMatrix(mat);
          const step = attr.count > 400000 ? 2 : 1;
          for (let i = 0; i < attr.count; i += step) {
            tmp.fromBufferAttribute(attr, i).applyMatrix4(mat);
            if (isUpperBodyCut && tmp.y < yOffset + 0.005 && nAttr) {
              tmpN.fromBufferAttribute(nAttr, i).applyMatrix3(normMat).normalize();
              if (tmpN.y < -0.65) continue;
            }
            allVerts.push(tmp.x, tmp.y, tmp.z);
          }
        });

        let profile;
        let legSkinMat = null;
        let laceMat = null;
        let lowerLegMeshes = [];
        let seamBlendMeshes = [];

        if (isUpperBodyCut) {
          // 1. Dò trọn 2 ống cánh tay (từ vai xuống ngón tay, tự nối cầu mượt qua đoạn chạm hông)
          const armTubes = detectArmTubes(allVerts, yOffset, modelHeight);
          const maxRadiusBeforeArms = createArmLimitFn(armTubes);

          // Tính hướng ngực trước (frontTheta) và trục ngang vai từ 2 cánh tay ở ngang eo
          let frontTheta = Math.PI * 0.5;
          let uLatX = 1, uLatZ = 0;
          if (armTubes.length >= 2) {
            const yWaist = yOffset + modelHeight * 0.43;
            const aL = armTubes[0].evalArm(yWaist);
            const aR = armTubes[1].evalArm(yWaist);
            const sdx = aR.x - aL.x;
            const sdz = aR.z - aL.z;
            const len = Math.hypot(sdx, sdz);
            if (len > 0.08) {
              uLatX = sdx / len;
              uLatZ = sdz / len;
              // Vector pháp tuyến hướng về phía trước (+Z)
              let fx = -uLatZ, fz = uLatX;
              if (fz < 0) { fx = -fx; fz = -fz; }
              frontTheta = Math.atan2(fz, fx);
            }
          }

          // 2. Lọc sạch 100% đỉnh của 2 cánh tay, cẳng tay, bàn tay và ngón tay ra khỏi thân/hông/đùi
          //    Dùng trục ngang vai (uLat) để bảo vệ lõi sườn/ngực (|lat| <= 0.142) khỏi bị ăn lẹm, đồng thời cắt sạch bắp tay hai bên!
          const yWaistRef = yOffset + modelHeight * 0.43;
          let wCx = 0, wCz = 0;
          if (armTubes.length >= 2) {
            const aL = armTubes[0].evalArm(yWaistRef);
            const aR = armTubes[1].evalArm(yWaistRef);
            wCx = (aL.x + aR.x) * 0.5;
            wCz = (aL.z + aR.z) * 0.5;
          }

          const torsoVerts = [];
          for (let i = 0; i < allVerts.length; i += 3) {
            const x = allVerts[i], y = allVerts[i + 1], z = allVerts[i + 2];
            let isArm = false;
            const latProj = (x - wCx) * uLatX + (z - wCz) * uLatZ;
            const insideCoreRibcage = y > yOffset + modelHeight * 0.46 && Math.abs(latProj) < 0.142;
            if (!insideCoreRibcage) {
              for (let k = 0; k < armTubes.length; k++) {
                const a = armTubes[k].evalArm(y);
                if (!a.active) continue;
                const pad = y > yOffset + modelHeight * 0.48 ? 0.018 : 0.028;
                if (Math.hypot(x - a.x, z - a.z) < a.rMax + pad) {
                  isArm = true;
                  break;
                }
              }
            }
            if (!isArm) torsoVerts.push(x, y, z);
          }

          // 2B. Quét trực tiếp bao 3D vai + bắp tay trên thật từ GLB cho 2 tay áo ngắn thủy thủ (phủ kín chỏm vai & dây áo lót!)
          const sleeveProfiles = [];
          if (armTubes.length >= 2) {
            const slTop = yOffset + modelHeight * 0.728; // ~2.257 (phủ trọn đỉnh vai/cơ delta)
            const slBot = yOffset + modelHeight * 0.555; // ~2.001 (cửa tay áo ngắn nữ sinh)
            const slSpan = slTop - slBot;
            const sNS = 18, sNA = 40;
            for (let k = 0; k < 2; k++) {
              const arm = armTubes[k];
              const cxArr = new Float32Array(sNS);
              const czArr = new Float32Array(sNS);
              const radArr = new Float32Array(sNS * sNA);
              for (let s = 0; s < sNS; s++) {
                const f = s / (sNS - 1);
                const y = slTop - f * slSpan;
                const a = arm.evalArm(y);
                // Trên đỉnh vai (y > 2.20), tâm bắp tay dịch nhẹ vào phía cổ theo độ dốc tự nhiên của bờ vai
                const topSlope = smoothstep(yOffset + modelHeight * 0.685, slTop, y);
                cxArr[s] = a.x + (wCx - a.x) * topSlope * 0.22;
                czArr[s] = a.z + (wCz - a.z) * topSlope * 0.22;
                const fbR = Math.max(0.050, a.r + 0.004) * (1 - topSlope * 0.25);
                for (let angI = 0; angI < sNA; angI++) radArr[s * sNA + angI] = fbR;
              }
              for (let i = 0; i < allVerts.length; i += 3) {
                const vx = allVerts[i], vy = allVerts[i + 1], vz = allVerts[i + 2];
                if (vy < slBot - 0.012 || vy > slTop + 0.010) continue;
                const sf = clamp((slTop - vy) / slSpan, 0, 1) * (sNS - 1);
                const s0 = Math.floor(sf), s1 = Math.min(sNS - 1, s0 + 1);
                const dx = vx - cxArr[s0], dz = vz - czArr[s0];
                const r = Math.hypot(dx, dz);
                if (r > 0.088) continue;
                // Tránh quét nhầm phần tóc/cổ gần trục giữa thân
                if (Math.hypot(vx - wCx, vz - wCz) < 0.135) continue;
                let ang = Math.atan2(dz, dx); if (ang < 0) ang += Math.PI * 2;
                const af = (ang / (Math.PI * 2)) * sNA;
                const a0 = Math.floor(af) % sNA, a1 = (a0 + 1) % sNA;
                for (const ss of [s0, s1]) {
                  if (r > radArr[ss * sNA + a0]) radArr[ss * sNA + a0] = r;
                  if (r > radArr[ss * sNA + a1]) radArr[ss * sNA + a1] = r;
                }
              }
              finalizePolarEnvelope(radArr, sNS, sNA, 0.044, 2);
              sleeveProfiles.push({ yTop: slTop, yBot: slBot, NS: sNS, NA: sNA, cxArr, czArr, radArr });
            }
          }

          // 3. Xây đôi chân dưới giải phẫu khớp màu da 360° GLB + dải hòa trộn xóa vết cắt + giày Mary-Jane + viền ren tất
          const built = buildSeamlessLowerLegsAndProfile(
            scene,
            model,
            torsoVerts,
            yOffset,
            modelHeight,
            skinTex,
            skinSSSUniform
          );
          legSkinMat = built.legSkinMat;
          laceMat = built.laceMat;
          lowerLegMeshes = built.lowerLegMeshes;
          seamBlendMeshes = built.seamBlendMeshes;

          // 4. Quét bao ngoài hông/eo (Váy xếp ly) & thân trên (Áo nữ sinh) hoàn toàn sạch tay!
          const skirtBounds = scanCleanBodyEnvelope(
            torsoVerts,
            yOffset + modelHeight * 0.415, // ~1.794 (eo tự nhiên)
            yOffset + modelHeight * 0.085, // ~1.306 (gấu váy ngay trên viền ren tất đùi)
            28,
            72,
            0.29
          );
          const shirtProfile = scanCleanBodyEnvelope(
            torsoVerts,
            yOffset + modelHeight * 0.720, // ~2.246 (phủ kín vai & dây áo lót!)
            yOffset + modelHeight * 0.390, // ~1.757 (gấu áo sơ vin gọn bên trong cạp váy!)
            28,
            72,
            0.25,
            {
              bustBridgeTheta: frontTheta,
              bustBand: [yOffset + modelHeight * 0.48, yOffset + modelHeight * 0.67],
              shedHairTheta: frontTheta
            }
          );
          shirtProfile.frontTheta = frontTheta;
          shirtProfile.uLatX = uLatX;
          shirtProfile.uLatZ = uLatZ;

          // Quét bao ngoài 360° chính xác cho cổ, mặt & đầu (dùng làm proxy chạm da không bị lệch tâm hay hụt đầu)
          const headProfile = scanCleanBodyEnvelope(
            allVerts,
            totalHeight,
            yOffset + modelHeight * 0.69,
            18,
            36,
            0.28
          );

          profile = {
            ...built.legProfile,
            skirtBounds,
            shirtProfile,
            headProfile,
            armTubes,
            sleeveProfiles,
            maxRadiusBeforeArms
          };
        } else {
          profile = scanFullBodyProfile(allVerts, totalHeight);
        }

        return { model, profile, legSkinMat, laceMat, lowerLegMeshes, seamBlendMeshes, totalHeight };
}
