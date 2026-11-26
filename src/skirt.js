import * as THREE from 'three';
import { appState } from './config.js';
import { clamp, smoothstep, getCustomLegProfile, legTFromY, getLegCenter, getLegSkinRadius } from './math.js';
import {
  createSkirtTexture,
  createWoolTwillMaps,
  createTornClothEdgeTexture
} from './textures.js';
import { getPelvisCrossSection } from './upperBody.js';
import { sound } from './audio.js';

// =========================================================================
// TAILORED & TEARABLE 360° PLEATED SCHOOLGIRL MINI-SKIRT
// - Cạp váy ôm gọn eo tự nhiên (bên ngoài gấu áo sơ mi, không bao giờ z-fighting)
// - Dáng chữ A xòe đều 360° với 24 nếp xếp ly sắc nét, ôm lướt hông hoàn hảo không xuyên da
// - Va chạm toàn chiều cao với thân/hông & 2 đùi, kéo giãn & xé rách tự do
// =========================================================================
export class TearablePleatedSkirt {
  constructor(scene, fiberDust) {
    this.scene = scene;
    this.fiberDust = fiberDust;
    this.isSkirt = true;
    this.side = 0;
    this.NU = 96;
    this.NV = 22;
    const prof = getCustomLegProfile();
    this.skirtBounds = prof ? prof.skirtBounds : null;
    this.yTop = this.skirtBounds ? this.skirtBounds.yTop : 1.88;
    this.yBot = this.skirtBounds ? this.skirtBounds.yBot : 1.38;
    this.pleats = 24;

    const woolMaps = createWoolTwillMaps();
    const tornTex = createTornClothEdgeTexture('#182234', '#7e90ad');

    this.skirtMaterial = new THREE.MeshPhysicalMaterial({
      map: createSkirtTexture(),
      normalMap: woolMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: woolMaps.roughnessMap,
      roughness: 0.92,
      metalness: 0.0,
      sheen: 0.16,
      sheenRoughness: 0.84,
      sheenColor: new THREE.Color(0x475569),
      envMapIntensity: 0.30,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });
    this.tornEdgeMaterial = new THREE.MeshStandardMaterial({
      map: tornTex.map,
      alphaMap: tornTex.alphaMap,
      normalMap: woolMaps.normalMap,
      normalScale: new THREE.Vector2(0.60, 0.60),
      roughness: 0.96,
      metalness: 0.0,
      alphaTest: 0.18,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide
    });

    this.numNodes = this.NU * (this.NV + 1);
    this.pos = new Float32Array(this.numNodes * 3);
    this.prevPos = new Float32Array(this.numNodes * 3);
    this.restPos = new Float32Array(this.numNodes * 3);
    this.pinned = new Uint8Array(this.numNodes);
    this.intactDegree = new Uint8Array(this.numNodes);
    this.brokenDegree = new Uint8Array(this.numNodes);
    this.isAwake = true;
    this.sleepFrames = 0;

    this.numRenderVerts = (this.NU + 1) * (this.NV + 1);
    this.renderPos = new Float32Array(this.numRenderVerts * 3);
    this.renderUVs = new Float32Array(this.numRenderVerts * 2);

    this.initParticlesAndSprings();

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.renderPos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.renderUVs, 2));
    this.mesh = new THREE.Mesh(this.geo, this.skirtMaterial);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData.cloth = this;
    this.hullMesh = this.mesh;
    scene.add(this.mesh);

    this.tornEdgeGeo = new THREE.BufferGeometry();
    this.tornEdgeMesh = new THREE.Mesh(this.tornEdgeGeo, this.tornEdgeMaterial);
    this.tornEdgeMesh.frustumCulled = false;
    this.tornEdgeMesh.castShadow = true;
    this.tornEdgeMesh.receiveShadow = true;
    scene.add(this.tornEdgeMesh);

    this.rebuildIndices();
    this.updateVisualGeometry();
    this.geo.computeBoundingSphere();
    this.setVisible(appState.showSkirt);
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    this.tornEdgeMesh.visible = visible;
  }

  pIdx(r, c) {
    return r * this.NU + ((c % this.NU + this.NU) % this.NU);
  }

  sampleGlbSkirtHull(vDown, theta = 0) {
    const sb = this.skirtBounds;
    if (sb && sb.radArr) {
      const { NS, NA, cxArr, czArr, radArr } = sb;
      const sf = clamp(vDown, 0, 1) * (NS - 1);
      const s0 = Math.floor(sf);
      const s1 = Math.min(NS - 1, s0 + 1);
      const st = sf - s0;
      const cx = cxArr[s0] * (1 - st) + cxArr[s1] * st;
      const cz = czArr[s0] * (1 - st) + czArr[s1] * st;

      let ang = theta % (Math.PI * 2);
      if (ang < 0) ang += Math.PI * 2;
      const af = (ang / (Math.PI * 2)) * NA;
      const a0 = Math.floor(af) % NA;
      const a1 = (a0 + 1) % NA;
      const at = af - Math.floor(af);
      const r0 = radArr[s0 * NA + a0] * (1 - at) + radArr[s0 * NA + a1] * at;
      const r1 = radArr[s1 * NA + a0] * (1 - at) + radArr[s1 * NA + a1] * at;
      return { cx, cz, r: Math.max(0.08, r0 * (1 - st) + r1 * st) };
    }
    const sl = sb.slices;
    const f = clamp(vDown, 0, 1) * (sl.NS - 1);
    const s0 = Math.floor(f);
    const s1 = Math.min(sl.NS - 1, s0 + 1);
    const fr = f - s0;
    const rx = sl.rx[s0] * (1 - fr) + sl.rx[s1] * fr;
    const rz = sl.rz[s0] * (1 - fr) + sl.rz[s1] * fr;
    return {
      cx: sl.cx[s0] * (1 - fr) + sl.cx[s1] * fr,
      cz: sl.cz[s0] * (1 - fr) + sl.cz[s1] * fr,
      rx,
      rz,
      r: Math.hypot(Math.cos(theta) * rx, Math.sin(theta) * rz)
    };
  }

  initParticlesAndSprings() {
    const sb = this.skirtBounds;
    const prof = getCustomLegProfile();
    const armLimitFn = prof && prof.maxRadiusBeforeArms ? prof.maxRadiusBeforeArms : null;
    const runningPolar = new Float32Array(this.NU);
    let runningRx = 0;
    let runningRz = 0;

    // Tính trước bao chữ A đơn điệu mượt theo từng góc (cạp ôm eo -> lướt êm qua hông -> xòe nhẹ ở gấu)
    const usePolar = !!(sb && sb.radArr);
    const gridR = usePolar ? new Float32Array((this.NV + 1) * this.NU) : null;
    const minBodyR = usePolar ? new Float32Array((this.NV + 1) * this.NU) : null;
    if (usePolar) {
      for (let r = 0; r <= this.NV; r++) {
        const vDown = r / this.NV;
        const y = this.yTop - vDown * (this.yTop - this.yBot);
        // Cạp váy (0..0.11): ôm gọn +11.2mm sát gấu áo sơ vin (không bao giờ hở mép trắng); thân váy xòe chữ A mượt
        const waistEase = 0.0112;
        const hipClear = 0.0125 * smoothstep(0.05, 0.32, vDown);
        const aLineFlare = Math.pow(Math.max(0, vDown - 0.12) / 0.88, 1.05) * 0.032;

        for (let c = 0; c < this.NU; c++) {
          const theta = (c / this.NU) * Math.PI * 2;
          const h = this.sampleGlbSkirtHull(vDown, theta);
          const hardFloor = h.r + (r <= 2 ? 0.0112 : 0.0185);
          minBodyR[r * this.NU + c] = hardFloor;
          const rawTarget = h.r + waistEase + hipClear + aLineFlare;
          // Dáng váy chữ A thả rủ tự nhiên từ vòng hông xuống gấu, tránh gấp khúc/vểnh mép ở 2 hàng cuối
          runningPolar[c] = r === 0 ? rawTarget : Math.max(runningPolar[c] + 0.0008, rawTarget);
          let rad = runningPolar[c];
          if (armLimitFn) {
            const lim = armLimitFn(h.cx, h.cz, y, theta, 0.004);
            rad = Math.min(rad, Math.max(hardFloor, lim));
          }
          gridR[r * this.NU + c] = Math.max(hardFloor, rad);
        }
      }
      // Làm mượt theo cả chu vi lẫn chiều dọc NHƯNG LUÔN GIỮ >= minBodyR để 100% không bao giờ xuyên da/đồ lót!
      for (let pass = 0; pass < 3; pass++) {
        const snap = new Float32Array(gridR);
        for (let r = 0; r <= this.NV; r++) {
          for (let c = 0; c < this.NU; c++) {
            const cM1 = (c - 1 + this.NU) % this.NU;
            const cP1 = (c + 1) % this.NU;
            const rM1 = Math.max(0, r - 1);
            const rP1 = Math.min(this.NV, r + 1);
            const horiz = snap[r * this.NU + cM1] * 0.25 + snap[r * this.NU + c] * 0.50 + snap[r * this.NU + cP1] * 0.25;
            const vert = r >= 2 ? (snap[rM1 * this.NU + c] * 0.25 + horiz * 0.50 + snap[rP1 * this.NU + c] * 0.25) : horiz;
            gridR[r * this.NU + c] = Math.max(minBodyR[r * this.NU + c], vert);
          }
        }
      }
    }

    for (let r = 0; r <= this.NV; r++) {
      const vDown = r / this.NV; // 0 = cạp eo -> 1 = gấu váy xòe
      const vTex = 1.0 - vDown;
      const y = this.yTop - vDown * (this.yTop - this.yBot);

      let cx = 0, cz = 0, baseRx = 0, baseRz = 0, backGlute = 0;
      if (!usePolar) {
        if (sb && sb.slices) {
          const h = this.sampleGlbSkirtHull(vDown, 0);
          cx = h.cx; cz = h.cz;
          runningRx = Math.max(runningRx, h.rx + 0.018 + Math.pow(vDown, 0.95) * 0.062);
          runningRz = Math.max(runningRz, h.rz + 0.018 + Math.pow(vDown, 0.95) * 0.056);
          baseRx = runningRx; baseRz = runningRz;
        } else {
          const pel = getPelvisCrossSection(Math.max(1.50, y));
          backGlute = pel.backGlute;
          baseRx = pel.rx + 0.012 + Math.pow(vDown, 0.92) * 0.095;
          baseRz = pel.rz + 0.012 + Math.pow(vDown, 0.92) * 0.082;
        }
      }

      // Nếp ly sắc nét bắt đầu nở ra ngay dưới cạp váy (vDown > 0.11)
      const pleatEnv = smoothstep(0.09, 0.35, vDown);

      for (let c = 0; c < this.NU; c++) {
        const u = c / this.NU;
        const theta = u * Math.PI * 2;
        const cosT = Math.cos(theta), sinT = Math.sin(theta);

        // Nếp xếp ly dao (knife-pleat): sắc nét, đều tay, rủ thẳng không vểnh gấu
        const ph = (u * this.pleats) % 1.0;
        const knife = ph < 0.72 ? (ph / 0.72) : ((1.0 - ph) / 0.28);
        const pleatWave = knife * 0.0080 * pleatEnv * (0.55 + 0.45 * vDown);
        const hemWave = vDown * (knife - 0.5) * 0.0032;

        let x, z;
        if (usePolar) {
          const h = this.sampleGlbSkirtHull(vDown, theta);
          const rad = gridR[r * this.NU + c] + pleatWave;
          x = h.cx + cosT * rad;
          z = h.cz + sinT * rad;
        } else {
          const backOff = Math.max(0, -sinT) * backGlute * 0.95;
          x = cx + cosT * (baseRx + pleatWave);
          z = cz + sinT * (baseRz + backOff + pleatWave);
        }
        const i = r * this.NU + c;
        const i3 = i * 3;
        this.pos[i3] = this.prevPos[i3] = this.restPos[i3] = x;
        this.pos[i3 + 1] = this.prevPos[i3 + 1] = this.restPos[i3 + 1] = y + hemWave;
        this.pos[i3 + 2] = this.prevPos[i3 + 2] = this.restPos[i3 + 2] = z;
        // Ghim chặt dải cạp váy (r <= 2) để cạp váy luôn đứng dáng, ôm eo không bao giờ xệ
        this.pinned[i] = r <= 2 ? 1 : 0;
      }

      for (let c = 0; c <= this.NU; c++) {
        const vi = r * (this.NU + 1) + c;
        this.renderUVs[vi * 2] = (c / this.NU) * 4;
        this.renderUVs[vi * 2 + 1] = vTex;
      }
    }

    const sA = [], sB = [], sRest = [], sType = [], sRand = [];
    this.horizSpring = new Int32Array((this.NV + 1) * this.NU).fill(-1);
    this.vertSpring = new Int32Array(this.NV * this.NU).fill(-1);
    this.diagSpring = new Int32Array(this.NV * this.NU).fill(-1);
    this.cellTorn = new Uint8Array(this.NV * this.NU);

    const addSpring = (a, b, type) => {
      const dx = this.restPos[b * 3] - this.restPos[a * 3];
      const dy = this.restPos[b * 3 + 1] - this.restPos[a * 3 + 1];
      const dz = this.restPos[b * 3 + 2] - this.restPos[a * 3 + 2];
      const idx = sA.length;
      sA.push(a); sB.push(b); sRest.push(Math.hypot(dx, dy, dz)); sType.push(type);
      sRand.push(0.94 + Math.random() * 0.12);
      this.intactDegree[a]++;
      this.intactDegree[b]++;
      return idx;
    };

    for (let r = 0; r <= this.NV; r++) {
      for (let c = 0; c < this.NU; c++) {
        this.horizSpring[r * this.NU + c] = addSpring(this.pIdx(r, c), this.pIdx(r, c + 1), 0);
      }
    }
    for (let r = 0; r < this.NV; r++) {
      for (let c = 0; c < this.NU; c++) {
        this.vertSpring[r * this.NU + c] = addSpring(this.pIdx(r, c), this.pIdx(r + 1, c), 1);
      }
    }
    for (let r = 0; r < this.NV; r++) {
      for (let c = 0; c < this.NU; c++) {
        this.diagSpring[r * this.NU + c] = addSpring(this.pIdx(r, c), this.pIdx(r + 1, c + 1), 2);
      }
    }

    this.numStrands = sA.length;
    this.sA = new Int32Array(sA);
    this.sB = new Int32Array(sB);
    this.sRest = new Float32Array(sRest);
    this.sType = new Uint8Array(sType);
    this.sRand = new Float32Array(sRand);
    this.sBroken = new Uint8Array(this.numStrands);
    this.sNotch = new Float32Array(this.numStrands);
    this.sFatigue = new Float32Array(this.numStrands);
    this.brokenStrands = 0;
  }

  wake() {
    this.isAwake = true;
    this.sleepFrames = 0;
  }

  repair() {
    for (let i = 0; i < this.numNodes * 3; i++) {
      this.pos[i] = this.restPos[i];
      this.prevPos[i] = this.restPos[i];
    }
    this.sBroken.fill(0);
    this.sNotch.fill(0);
    this.sFatigue.fill(0);
    this.cellTorn.fill(0);
    this.brokenDegree.fill(0);
    this.intactDegree.fill(0);
    for (let s = 0; s < this.numStrands; s++) {
      this.intactDegree[this.sA[s]]++;
      this.intactDegree[this.sB[s]]++;
    }
    this.brokenStrands = 0;
    this.isAwake = true;
    this.sleepFrames = 0;
    this.rebuildIndices();
    this.updateVisualGeometry();
    this.geo.computeBoundingSphere();
  }

  tearCell(r, c) {
    if (r < 0 || r >= this.NV) return;
    const cc = ((c % this.NU) + this.NU) % this.NU;
    const ci = r * this.NU + cc;
    if (this.cellTorn[ci]) return;
    this.cellTorn[ci] = 1;
    // Cắt lò xo chéo qua ô vải rách để vạt váy len tách rời thành miếng vải thật (không bị lưới kiểu tất!)
    const ds = this.diagSpring[ci];
    if (ds >= 0 && !this.sBroken[ds]) {
      this.sBroken[ds] = 1;
      this.intactDegree[this.sA[ds]] = Math.max(0, this.intactDegree[this.sA[ds]] - 1);
      this.intactDegree[this.sB[ds]] = Math.max(0, this.intactDegree[this.sB[ds]] - 1);
    }
  }

  rebuildIndices() {
    // Dọn các ô tam giác mồ côi để vết xé tạo thành đường rách liền mạch & vạt váy rủ tự nhiên
    for (let pass = 0; pass < 2; pass++) {
      for (let r = 0; r < this.NV; r++) {
        for (let c = 0; c < this.NU; c++) {
          const ci = r * this.NU + c;
          if (this.cellTorn[ci]) continue;
          const cL = (c - 1 + this.NU) % this.NU;
          const cR = (c + 1) % this.NU;
          const tUp = r > 0 && this.cellTorn[(r - 1) * this.NU + c];
          const tDn = r < this.NV - 1 && this.cellTorn[(r + 1) * this.NU + c];
          const tL = this.cellTorn[r * this.NU + cL];
          const tR = this.cellTorn[r * this.NU + cR];
          const tornNeighbors = (tUp ? 1 : 0) + (tDn ? 1 : 0) + (tL ? 1 : 0) + (tR ? 1 : 0);
          if (tornNeighbors >= 3 || (tL && tR) || (tUp && tDn)) this.tearCell(r, c);
        }
      }
    }

    const indices = [];
    const stride = this.NU + 1;
    for (let r = 0; r < this.NV; r++) {
      for (let c = 0; c < this.NU; c++) {
        if (this.cellTorn[r * this.NU + c]) continue;
        const cL = (c - 1 + this.NU) % this.NU;
        const cR = (c + 1) % this.NU;
        const tUp = r > 0 && this.cellTorn[(r - 1) * this.NU + c];
        const tDn = r < this.NV - 1 && this.cellTorn[(r + 1) * this.NU + c];
        const tL = this.cellTorn[r * this.NU + cL];
        const tR = this.cellTorn[r * this.NU + cR];

        const a = r * stride + c;
        const b = a + 1;
        const cc = (r + 1) * stride + c;
        const d = cc + 1;

        // Vát chéo góc ô vải tiếp giáp 2 cạnh rách để xóa hoàn toàn bậc thang vuông 90°!
        if (tUp && tR)      indices.push(a, d, cc);
        else if (tUp && tL) indices.push(b, d, cc);
        else if (tDn && tR) indices.push(a, b, cc);
        else if (tDn && tL) indices.push(a, b, d);
        else                indices.push(a, b, cc, b, d, cc);
      }
    }
    this.geo.setIndex(indices);
    if (this.geo.attributes.position && this.renderPos[0] !== 0) {
      this.geo.computeBoundingSphere();
    }
  }

  breakSpring(sIdx, newlyBroken) {
    if (this.sBroken[sIdx]) return;
    this.sBroken[sIdx] = 1;
    this.brokenStrands++;

    const a = this.sA[sIdx], b = this.sB[sIdx];
    const a3 = a * 3, b3 = b * 3;
    const ax = this.pos[a3], ay = this.pos[a3 + 1], az = this.pos[a3 + 2];
    const bx = this.pos[b3], by = this.pos[b3 + 1], bz = this.pos[b3 + 2];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz) || 0.0001;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;

    this.intactDegree[a] = Math.max(0, this.intactDegree[a] - 1);
    this.intactDegree[b] = Math.max(0, this.intactDegree[b] - 1);
    this.brokenDegree[a]++;
    this.brokenDegree[b]++;

    const recoil = 0.0095;
    if (!this.pinned[a]) {
      this.pos[a3] -= ux * recoil; this.pos[a3 + 1] -= uy * recoil; this.pos[a3 + 2] -= uz * recoil;
    }
    if (!this.pinned[b]) {
      this.pos[b3] += ux * recoil; this.pos[b3 + 1] += uy * recoil; this.pos[b3 + 2] += uz * recoil;
    }

    const r = Math.floor(a / this.NU), c = a % this.NU;
    if (this.sType[sIdx] === 0) {
      // Xé dọc theo nếp ly váy len -> đường rách dài dứt khoát dọc thân váy!
      if (r < this.NV) this.tearCell(r, c);
      if (r > 0) this.tearCell(r - 1, c);
      if (r > 1) this.sNotch[this.horizSpring[(r - 1) * this.NU + c]] = Math.min(0.68, this.sNotch[this.horizSpring[(r - 1) * this.NU + c]] + 0.40);
      if (r < this.NV) this.sNotch[this.horizSpring[(r + 1) * this.NU + c]] = Math.min(0.68, this.sNotch[this.horizSpring[(r + 1) * this.NU + c]] + 0.40);
    } else if (this.sType[sIdx] === 1) {
      const cL = (c - 1 + this.NU) % this.NU, cR = (c + 1) % this.NU;
      this.tearCell(r, c);
      this.tearCell(r, cL);
      if (r < this.NV) {
        this.sNotch[this.vertSpring[r * this.NU + cL]] = Math.min(0.60, this.sNotch[this.vertSpring[r * this.NU + cL]] + 0.32);
        this.sNotch[this.vertSpring[r * this.NU + cR]] = Math.min(0.60, this.sNotch[this.vertSpring[r * this.NU + cR]] + 0.32);
      }
    }

    const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
    this.fiberDust.emit(mx, my, mz, (Math.random() - 0.5) * 0.015, 0.002, (Math.random() - 0.5) * 0.015, 3);
    newlyBroken.push({ x: mx, y: my, z: mz, side: 0, isSkirt: true });
    sound.playClothRip(newlyBroken.length, true);
  }

  breakSpringQuiet(sIdx) {
    if (sIdx == null || sIdx < 0 || this.sBroken[sIdx]) return false;
    this.sBroken[sIdx] = 1;
    this.brokenStrands++;
    const a = this.sA[sIdx], b = this.sB[sIdx];
    this.intactDegree[a] = Math.max(0, this.intactDegree[a] - 1);
    this.intactDegree[b] = Math.max(0, this.intactDegree[b] - 1);
    this.brokenDegree[a]++;
    this.brokenDegree[b]++;
    return true;
  }

  tearPatch(centerIdx, radC, radR) {
    const r0 = Math.floor(centerIdx / this.NU);
    const c0 = centerIdx % this.NU;
    let opened = 0;
    for (let dr = -radR; dr <= radR; dr++) {
      const r = r0 + dr;
      if (r < 0 || r >= this.NV) continue;
      for (let dc = -radC; dc <= radC; dc++) {
        const er = dr / radR;
        const ec = dc / radC;
        if (er * er + ec * ec > 1) continue;
        const c = (c0 + dc + this.NU * 4) % this.NU;
        const ci = r * this.NU + c;
        if (this.cellTorn[ci]) continue;
        this.tearCell(r, c);
        this.breakSpringQuiet(this.horizSpring[r * this.NU + c]);
        this.breakSpringQuiet(this.vertSpring[ci]);
        if (r + 1 <= this.NV) this.breakSpringQuiet(this.horizSpring[(r + 1) * this.NU + c]);
        opened++;
      }
    }
    opened += this.clearLeftoverWaistband();
    if (opened > 0) this.rebuildIndices();
    return opened;
  }

  // Cạp (hàng 0–2) đang ghim nên khi xé hết thân váy vẫn sót một vòng viền. Gỡ đúng đoạn đó.
  clearLeftoverWaistband() {
    const openCell = (r, c) => {
      const ci = r * this.NU + c;
      if (this.cellTorn[ci]) return 0;
      this.tearCell(r, c);
      this.breakSpringQuiet(this.horizSpring[ci]);
      this.breakSpringQuiet(this.vertSpring[ci]);
      if (r + 1 <= this.NV) this.breakSpringQuiet(this.horizSpring[(r + 1) * this.NU + c]);
      return 1;
    };
    let opened = 0;
    if (this.NV > 1) {
      for (let c = 0; c < this.NU; c++) {
        if (!this.cellTorn[this.NU + c]) continue;
        opened += openCell(0, c);
      }
    }
    let body = 0, bodyTorn = 0;
    for (let r = 3; r < this.NV; r++) {
      for (let c = 0; c < this.NU; c++) {
        body++;
        if (this.cellTorn[r * this.NU + c]) bodyTorn++;
      }
    }
    if (body > 0 && bodyTorn >= body * 0.7) {
      const waistRows = Math.min(3, this.NV);
      for (let r = 0; r < waistRows; r++) {
        for (let c = 0; c < this.NU; c++) opened += openCell(r, c);
      }
    }
    return opened;
  }

  consumePullTear(activeGrabs, newlyBroken) {
    let pullDist = 0;
    let center = -1;
    for (let g = 0; g < activeGrabs.length; g++) {
      const grab = activeGrabs[g];
      if (grab.cloth !== this || !grab.startPoint) continue;
      const d = grab.target.distanceTo(grab.startPoint);
      if (d < pullDist) continue;
      pullDist = d;
      let bestW = -1;
      center = -1;
      for (let k = 0; k < grab.nodes.length; k++) {
        if (grab.nodes[k].weight > bestW) {
          bestW = grab.nodes[k].weight;
          center = grab.nodes[k].idx;
        }
      }
    }
    const tearDist = 0.034 + Math.max(0, appState.strength - 1.85) * 0.038;
    if (pullDist < tearDist || center < 0) return;
    const reach = clamp((pullDist - tearDist) / 0.10, 0, 1);
    const radC = 7 + Math.round(reach * 9);
    const radR = 5 + Math.round(reach * 6);
    const opened = this.tearPatch(center, radC, radR);
    if (opened > 0) {
      const i3 = center * 3;
      this.fiberDust.emit(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2], (Math.random() - 0.5) * 0.02, 0.004, (Math.random() - 0.5) * 0.02, 8);
      sound.playClothRip(4, true);
      newlyBroken.push({ x: this.pos[i3], y: this.pos[i3 + 1], z: this.pos[i3 + 2], side: 0, isSkirt: true });
    }
  }

  stepPhysics(activeGrabs) {
    if (!appState.showSkirt) return { peakTensionRatio: 0, newlyBroken: [] };
    if (!this.isAwake && activeGrabs.length === 0) {
      return { peakTensionRatio: 0, newlyBroken: [] };
    }

    const damping = 0.88;
    const gravity = -0.00046;
    let maxMotionSq = 0;

    for (let i = 0; i < this.numNodes; i++) {
      if (this.pinned[i]) continue;
      const i3 = i * 3;
      const x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
      const vx = (x - this.prevPos[i3]) * damping;
      const vy = (y - this.prevPos[i3 + 1]) * damping;
      const vz = (z - this.prevPos[i3 + 2]) * damping;
      const mSq = vx * vx + vy * vy + vz * vz;
      if (mSq > maxMotionSq) maxMotionSq = mSq;

      this.prevPos[i3] = x; this.prevPos[i3 + 1] = y; this.prevPos[i3 + 2] = z;

      const torn = this.brokenDegree[i] > 0;
      const pleatMem = torn ? 0.0 : 0.032;
      const gMult = torn ? 1.55 : 0.45;
      this.pos[i3]     = x + vx + (this.restPos[i3] - x) * pleatMem;
      this.pos[i3 + 1] = y + vy + gravity * gMult + (this.restPos[i3 + 1] - y) * pleatMem;
      this.pos[i3 + 2] = z + vz + (this.restPos[i3 + 2] - z) * pleatMem;
    }

    const pullStiff = 0.40 * appState.pullPower;
    for (let gIdx = 0; gIdx < activeGrabs.length; gIdx++) {
      const grab = activeGrabs[gIdx];
      if (grab.cloth !== this) continue;
      const tx = grab.target.x, ty = grab.target.y, tz = grab.target.z;
      for (let k = 0; k < grab.nodes.length; k++) {
        const item = grab.nodes[k];
        if (this.intactDegree[item.idx] === 0) continue;
        const i3 = item.idx * 3;
        const pull = Math.min(0.72, item.weight * pullStiff);
        this.pos[i3]     += (tx + item.ox - this.pos[i3]) * pull;
        this.pos[i3 + 1] += (ty + item.oy - this.pos[i3 + 1]) * pull;
        this.pos[i3 + 2] += (tz + item.oz - this.pos[i3 + 2]) * pull;
      }
    }

    // Vải len dệt chéo dày chắc -> ít giãn đàn hồi, kéo căng sẽ xé toạc dứt khoát dọc theo nếp ly!
    const baseThresh = Math.max(1.26, appState.strength * 0.60);
    let peakTensionRatio = 0;
    const newlyBroken = [];
    this.consumePullTear(activeGrabs, newlyBroken);
    const maxBreaks = 6;
    const sb = this.skirtBounds;
    const prof = getCustomLegProfile();
    const maxY = sb ? sb.yTop + 0.02 : 1.92;
    const legTopCheck = prof ? prof.yTop : 1.56;

    for (let iter = 0; iter < 6; iter++) {
      let highestOver = 0, highestIdx = -1;
      for (let s = 0; s < this.numStrands; s++) {
        if (this.sBroken[s]) continue;
        const a = this.sA[s], b = this.sB[s];
        const a3 = a * 3, b3 = b * 3;
        const dx = this.pos[b3] - this.pos[a3];
        const dy = this.pos[b3 + 1] - this.pos[a3 + 1];
        const dz = this.pos[b3 + 2] - this.pos[a3 + 2];
        const dist = Math.hypot(dx, dy, dz) || 0.0001;
        const rest = this.sRest[s];

        if (iter === 0 && this.sType[s] !== 2) {
          const stretch = dist / rest;
          const effThresh = Math.max(1.24, baseThresh * this.sRand[s] - this.sNotch[s] - this.sFatigue[s]);
          const tr = clamp((stretch - 1.05) / (effThresh - 1.05), 0, 1.5);
          if (tr > peakTensionRatio) peakTensionRatio = tr;
          if (tr > 0.86) this.sFatigue[s] = Math.min(0.24, this.sFatigue[s] + (tr - 0.86) * 0.035);
          else if (this.sFatigue[s] > 0) this.sFatigue[s] = Math.max(0, this.sFatigue[s] - 0.015);

          if (activeGrabs.length > 0 && stretch > effThresh) {
            const over = stretch / effThresh;
            if (over > highestOver) { highestOver = over; highestIdx = s; }
          }
        }

        const diff = (dist - rest) / dist;
        const stiff = this.sType[s] === 2 ? 0.44 : 0.88;
        const corr = diff * 0.5 * stiff;
        if (!this.pinned[a]) {
          this.pos[a3] += dx * corr; this.pos[a3 + 1] += dy * corr; this.pos[a3 + 2] += dz * corr;
        }
        if (!this.pinned[b]) {
          this.pos[b3] -= dx * corr; this.pos[b3 + 1] -= dy * corr; this.pos[b3 + 2] -= dz * corr;
        }
      }

      if (iter < maxBreaks && highestIdx !== -1 && newlyBroken.length < maxBreaks) {
        this.breakSpring(highestIdx, newlyBroken);
      }

      // Va chạm 360° TOÀN CHIỀU CAO với bao hông/eo/đùi GLB (không bao giờ thủng mặt trước hay lọt vào đồ lót!)
      for (let i = 0; i < this.numNodes; i++) {
        if (this.pinned[i]) continue;
        const i3 = i * 3;
        let px = this.pos[i3], py = clamp(this.pos[i3 + 1], 0.05, maxY), pz = this.pos[i3 + 2];
        this.pos[i3 + 1] = py;

        if (sb && sb.radArr && py >= sb.yBot - 0.05) {
          const vFrac = clamp((sb.yTop - py) / Math.max(0.05, sb.yTop - sb.yBot), 0, 1);
          const hEst = this.sampleGlbSkirtHull(vFrac, Math.atan2(pz - sb.cz, px - sb.cx));
          const dx = px - hEst.cx, dz = pz - hEst.cz;
          const theta = Math.atan2(dz, dx);
          const hExact = this.sampleGlbSkirtHull(vFrac, theta);
          const r = Math.hypot(dx, dz) || 0.0001;
          const minR = hExact.r + 0.0165;
          if (r < minR) {
            const sc = minR / r;
            px = hExact.cx + dx * sc;
            pz = hExact.cz + dz * sc;
            this.pos[i3] = px; this.pos[i3 + 2] = pz;
          }
        } else if (!sb) {
          if (py > 1.49) {
            const { rx, rz, backGlute } = getPelvisCrossSection(py);
            const colRx = rx + 0.012;
            const colRz = rz + (pz < 0 ? backGlute : 0) + 0.012;
            const normR = Math.hypot(px / colRx, pz / colRz) || 0.0001;
            if (normR < 1.0) {
              px /= normR; pz /= normR;
              this.pos[i3] = px; this.pos[i3 + 2] = pz;
            }
          }
        }

        if (py < legTopCheck) {
          const tLeg = legTFromY(py);
          for (const side of [-1, 1]) {
            const { cx, cz } = getLegCenter(side, tLeg);
            const dx = px - cx, dz = pz - cz;
            const r = Math.hypot(dx, dz) || 0.0001;
            const minR = getLegSkinRadius(side, tLeg, Math.atan2(dz, dx)) + 0.014;
            if (r < minR) {
              const sc = minR / r;
              px = cx + dx * sc; pz = cz + dz * sc;
              this.pos[i3] = px; this.pos[i3 + 2] = pz;
            }
          }
        }
      }
    }

    if (newlyBroken.length > 0) {
      this.rebuildIndices();
      this.sleepFrames = 0;
    }

    if (activeGrabs.length === 0 && maxMotionSq < 1e-10) {
      this.sleepFrames++;
      if (this.sleepFrames > 70) this.isAwake = false;
    } else {
      this.sleepFrames = 0;
    }

    return { peakTensionRatio, newlyBroken };
  }

  updateVisualGeometry() {
    if (!appState.showSkirt) return;
    const stride = this.NU + 1;
    for (let r = 0; r <= this.NV; r++) {
      for (let c = 0; c <= this.NU; c++) {
        const pi = r * this.NU + (c % this.NU);
        const vi = r * stride + c;
        const p3 = pi * 3, v3 = vi * 3;
        this.renderPos[v3]     = this.pos[p3];
        this.renderPos[v3 + 1] = this.pos[p3 + 1];
        this.renderPos[v3 + 2] = this.pos[p3 + 2];
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();

    const nArr = this.geo.attributes.normal.array;
    for (let r = 0; r <= this.NV; r++) {
      const i0 = (r * stride) * 3;
      const i1 = (r * stride + this.NU) * 3;
      let nx = nArr[i0] + nArr[i1], ny = nArr[i0 + 1] + nArr[i1 + 1], nz = nArr[i0 + 2] + nArr[i1 + 2];
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      nArr[i0] = nArr[i1] = nx; nArr[i0 + 1] = nArr[i1 + 1] = ny; nArr[i0 + 2] = nArr[i1 + 2] = nz;
    }
    this.geo.attributes.normal.needsUpdate = true;

    // Dải mép vải len rách nham nhở (ragged woven wool twill rim) dọc chu vi vết xé — giống xé vải váy thật!
    if (this.brokenStrands > 0) {
      const ePos = [], eUV = [], eIdx = [];
      let vCursor = 0;
      const sb = this.skirtBounds;
      const bodyCx = sb ? sb.cx : 0, bodyCz = sb ? sb.cz : 0;
      const pushRaggedEdge = (iA, iB, iOppA, iOppB, seedPhase) => {
        const a3 = iA * 3, b3 = iB * 3, oa3 = iOppA * 3, ob3 = iOppB * 3;
        const ax = this.pos[a3], ay = this.pos[a3 + 1], az = this.pos[a3 + 2];
        const bx = this.pos[b3], by = this.pos[b3 + 1], bz = this.pos[b3 + 2];
        let oxA = ax - this.pos[oa3], oyA = ay - this.pos[oa3 + 1], ozA = az - this.pos[oa3 + 2];
        let oxB = bx - this.pos[ob3], oyB = by - this.pos[ob3 + 1], ozB = bz - this.pos[ob3 + 2];
        const lA = Math.hypot(oxA, oyA, ozA) || 1;
        const lB = Math.hypot(oxB, oyB, ozB) || 1;
        const h1 = ((seedPhase * 41) % 11) / 11;
        const h2 = ((seedPhase * 61 + 5) % 11) / 11;
        const wA = 0.022 + h1 * 0.016;
        const wB = 0.022 + h2 * 0.016;
        const backLap = 0.003;
        const uxA = oxA / lA, uyA = oyA / lA, uzA = ozA / lA;
        const uxB = oxB / lB, uyB = oyB / lB, uzB = ozB / lB;

        // Nâng mép vải rách ra ngoài +4.5mm theo pháp tuyến hông để viền vải tưa luôn nổi rõ trên da/đồ lót
        const rLenA = Math.hypot(ax - bodyCx, az - bodyCz) || 1;
        const rLenB = Math.hypot(bx - bodyCx, bz - bodyCz) || 1;
        const lift = 0.0045;
        const lxA = ((ax - bodyCx) / rLenA) * lift, lzA = ((az - bodyCz) / rLenA) * lift;
        const lxB = ((bx - bodyCx) / rLenB) * lift, lzB = ((bz - bodyCz) / rLenB) * lift;

        ePos.push(
          ax - uxA * backLap + lxA * 0.35, ay - uyA * backLap, az - uzA * backLap + lzA * 0.35,
          bx - uxB * backLap + lxB * 0.35, by - uyB * backLap, bz - uzB * backLap + lzB * 0.35,
          ax + uxA * wA + lxA, ay + uyA * wA - 0.007, az + uzA * wA + lzA,
          bx + uxB * wB + lxB, by + uyB * wB - 0.007, bz + uzB * wB + lzB
        );
        const u0 = (seedPhase % 5) * 0.20;
        eUV.push(u0, 0, u0 + 0.85, 0, u0, 1, u0 + 0.85, 1);
        eIdx.push(vCursor, vCursor + 1, vCursor + 2, vCursor + 1, vCursor + 3, vCursor + 2);
        vCursor += 4;
      };

      for (let r = 0; r < this.NV; r++) {
        for (let c = 0; c < this.NU; c++) {
          if (this.cellTorn[r * this.NU + c]) continue;
          const cNext = (c + 1) % this.NU;
          const cPrev = (c - 1 + this.NU) % this.NU;
          const pTL = r * this.NU + c, pTR = r * this.NU + cNext;
          const pBL = (r + 1) * this.NU + c, pBR = (r + 1) * this.NU + cNext;
          const tUp = r > 0 && this.cellTorn[(r - 1) * this.NU + c];
          const tDn = r < this.NV - 1 && this.cellTorn[(r + 1) * this.NU + c];
          const tL = this.cellTorn[r * this.NU + cPrev];
          const tR = this.cellTorn[r * this.NU + cNext];
          if (tUp && tR)      pushRaggedEdge(pTL, pBR, pBL, pBL, r * 5 + c);
          else if (tUp && tL) pushRaggedEdge(pBL, pTR, pBR, pBR, r * 5 + c + 1);
          else if (tDn && tR) pushRaggedEdge(pTR, pBL, pTL, pTL, r * 5 + c + 2);
          else if (tDn && tL) pushRaggedEdge(pTL, pBR, pTR, pTR, r * 5 + c + 3);
          else {
            if (tUp) pushRaggedEdge(pTL, pTR, pBL, pBR, r + c);
            if (tDn) pushRaggedEdge(pBL, pBR, pTL, pTR, r + c + 1);
            if (tL)  pushRaggedEdge(pTL, pBL, pTR, pBR, r * 3 + c);
            if (tR)  pushRaggedEdge(pTR, pBR, pTL, pBL, r * 3 + c + 2);
          }
        }
      }
      this.tornEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3));
      this.tornEdgeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(eUV, 2));
      this.tornEdgeGeo.setIndex(eIdx);
      this.tornEdgeGeo.computeVertexNormals();
    } else if (this.tornEdgeGeo.attributes.position && this.tornEdgeGeo.attributes.position.count > 0) {
      this.tornEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      this.tornEdgeGeo.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
      this.tornEdgeGeo.setIndex([]);
    }
  }
}
