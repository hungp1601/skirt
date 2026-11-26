import * as THREE from 'three';
import { appState } from './config.js';
import { clamp, getCustomLegProfile, legTFromY, getLegCenter, getLegSkinRadius } from './math.js';
import { createSkirtTexture } from './textures.js';
import { getPelvisCrossSection } from './upperBody.js';
import { sound } from './audio.js';

// =========================================================================
// ALIGNED & TEARABLE 360° PLEATED MINI-SKIRT (Concentric with Waist & Hips)
// =========================================================================
export class TearablePleatedSkirt {
  constructor(scene, fiberDust) {
    this.scene = scene;
    this.fiberDust = fiberDust;
    this.isSkirt = true;
    this.side = 0;
    this.NU = 88;
    this.NV = 20;
    const prof = getCustomLegProfile();
    this.skirtBounds = prof ? prof.skirtBounds : null;
    this.yTop = this.skirtBounds ? this.skirtBounds.yTop : 1.88;
    this.yBot = this.skirtBounds ? this.skirtBounds.yBot : 1.38;
    this.pleats = 22;

    this.skirtMaterial = new THREE.MeshPhysicalMaterial({
      map: createSkirtTexture(),
      roughness: 0.76,
      metalness: 0.04,
      sheen: 0.35,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color(0x475569),
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });
    this.frayMaterial = new THREE.LineBasicMaterial({
      color: 0x263144,
      transparent: true,
      opacity: 0.88
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
    this.mesh.userData.cloth = this;
    this.hullMesh = this.mesh;
    scene.add(this.mesh);

    this.frayGeo = new THREE.BufferGeometry();
    this.frayLines = new THREE.LineSegments(this.frayGeo, this.frayMaterial);
    this.frayLines.frustumCulled = false;
    scene.add(this.frayLines);

    this.rebuildIndices();
    this.updateVisualGeometry();
    this.setVisible(appState.showSkirt);
  }

  setVisible(visible) {
    this.mesh.visible = visible;
    this.frayLines.visible = visible;
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
    for (let r = 0; r <= this.NV; r++) {
      const vDown = r / this.NV; // 0 = eo trên -> 1 = gấu váy xòe
      const vTex = 1.0 - vDown;
      const y = this.yTop - vDown * (this.yTop - this.yBot);

      let cx = 0, cz = 0, baseRx = 0, baseRz = 0, backGlute = 0;
      const usePolar = !!(sb && sb.radArr);
      if (!usePolar) {
        if (sb && sb.slices) {
          const h = this.sampleGlbSkirtHull(vDown, 0);
          cx = h.cx; cz = h.cz;
          runningRx = Math.max(runningRx, h.rx + 0.022 + Math.pow(vDown, 0.90) * 0.075);
          runningRz = Math.max(runningRz, h.rz + 0.022 + Math.pow(vDown, 0.90) * 0.068);
          baseRx = runningRx; baseRz = runningRz;
        } else {
          const pel = getPelvisCrossSection(Math.max(1.50, y));
          backGlute = pel.backGlute;
          baseRx = pel.rx + 0.012 + Math.pow(vDown, 0.92) * 0.095;
          baseRz = pel.rz + 0.012 + Math.pow(vDown, 0.92) * 0.082;
        }
      }

      for (let c = 0; c < this.NU; c++) {
        const u = c / this.NU;
        const theta = u * Math.PI * 2;
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        // Nếp ly gọn ôm sát eo & hông, xòe nhẹ ở gấu váy và không đè lên bàn tay
        const pleatWave = (0.5 + 0.5 * Math.sin(theta * this.pleats)) * 0.0065 * (0.15 + 0.85 * vDown);
        const hemWave = vDown * Math.cos(theta * this.pleats) * 0.003;

        let x, z;
        if (usePolar) {
          const h = this.sampleGlbSkirtHull(vDown, theta);
          const targetR = h.r + 0.0045 + Math.pow(vDown, 1.05) * 0.016;
          runningPolar[c] = Math.max(runningPolar[c] * 0.92, targetR);
          let rad = runningPolar[c] + pleatWave;
          if (armLimitFn) {
            const lim = armLimitFn(h.cx, h.cz, y, theta, 0.003);
            rad = Math.min(rad, Math.max(h.r + 0.0032, lim));
          }
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
        this.pinned[i] = r <= 1 ? 1 : 0;
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

    const addSpring = (a, b, type) => {
      const dx = this.restPos[b * 3] - this.restPos[a * 3];
      const dy = this.restPos[b * 3 + 1] - this.restPos[a * 3 + 1];
      const dz = this.restPos[b * 3 + 2] - this.restPos[a * 3 + 2];
      const idx = sA.length;
      sA.push(a); sB.push(b); sRest.push(Math.hypot(dx, dy, dz)); sType.push(type);
      sRand.push(0.92 + Math.random() * 0.16);
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
        addSpring(this.pIdx(r, c), this.pIdx(r + 1, c + 1), 2);
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
  }

  rebuildIndices() {
    const indices = [];
    const stride = this.NU + 1;
    for (let r = 0; r < this.NV; r++) {
      for (let c = 0; c < this.NU; c++) {
        const cNext = (c + 1) % this.NU;
        const hTop = this.sBroken[this.horizSpring[r * this.NU + c]];
        const hBot = this.sBroken[this.horizSpring[(r + 1) * this.NU + c]];
        const vLeft = this.sBroken[this.vertSpring[r * this.NU + c]];
        const vRight = this.sBroken[this.vertSpring[r * this.NU + cNext]];

        const a = r * stride + c;
        const b = a + 1;
        const cc = (r + 1) * stride + c;
        const d = cc + 1;

        if (!hTop && !vLeft)  indices.push(a, b, cc);
        if (!hBot && !vRight) indices.push(b, d, cc);
      }
    }
    this.geo.setIndex(indices);
    this.geo.computeBoundingSphere();
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

    const recoil = 0.0055;
    if (!this.pinned[a]) {
      this.pos[a3] -= ux * recoil; this.pos[a3 + 1] -= uy * recoil; this.pos[a3 + 2] -= uz * recoil;
    }
    if (!this.pinned[b]) {
      this.pos[b3] += ux * recoil; this.pos[b3 + 1] += uy * recoil; this.pos[b3 + 2] += uz * recoil;
    }

    const r = Math.floor(a / this.NU), c = a % this.NU;
    if (this.sType[sIdx] === 0) {
      if (r > 1) this.sNotch[this.horizSpring[(r - 1) * this.NU + c]] = Math.min(0.55, this.sNotch[this.horizSpring[(r - 1) * this.NU + c]] + 0.24);
      if (r < this.NV) this.sNotch[this.horizSpring[(r + 1) * this.NU + c]] = Math.min(0.55, this.sNotch[this.horizSpring[(r + 1) * this.NU + c]] + 0.24);
    } else {
      const cL = (c - 1 + this.NU) % this.NU, cR = (c + 1) % this.NU;
      if (r < this.NV) {
        this.sNotch[this.vertSpring[r * this.NU + cL]] = Math.min(0.45, this.sNotch[this.vertSpring[r * this.NU + cL]] + 0.16);
        this.sNotch[this.vertSpring[r * this.NU + cR]] = Math.min(0.45, this.sNotch[this.vertSpring[r * this.NU + cR]] + 0.16);
      }
    }

    const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
    this.fiberDust.emit(mx, my, mz, (Math.random() - 0.5) * 0.012, 0.002, (Math.random() - 0.5) * 0.012, 2);
    newlyBroken.push({ x: mx, y: my, z: mz, side: 0, isSkirt: true });
    sound.playThreadSnap(newlyBroken.length, false);
  }

  stepPhysics(activeGrabs) {
    if (!appState.showSkirt) return { peakTensionRatio: 0, newlyBroken: [] };
    if (!this.isAwake && activeGrabs.length === 0) {
      return { peakTensionRatio: 0, newlyBroken: [] };
    }

    const damping = 0.89;
    const gravity = -0.00058;
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
      const pleatMem = torn ? 0.0 : 0.014;
      const gMult = torn ? 1.55 : 0.65;
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

    const baseThresh = Math.max(1.48, appState.strength * 0.82);
    let peakTensionRatio = 0;
    const newlyBroken = [];
    const maxBreaks = 3;

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

          // Chỉ xé váy khi người chơi đang kéo, tránh tự rách lúc đứng yên
          if (activeGrabs.length > 0 && stretch > effThresh) {
            const over = stretch / effThresh;
            if (over > highestOver) { highestOver = over; highestIdx = s; }
          }
        }

        const diff = (dist - rest) / dist;
        const stiff = this.sType[s] === 2 ? 0.34 : 0.78;
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

      const sb = this.skirtBounds;
      const maxY = sb ? sb.yTop + 0.04 : 1.92;
      const pelSplitY = sb ? (sb.yTop * 0.45 + sb.yBot * 0.55) : 1.49;
      const legUpperY = sb ? sb.yTop - 0.12 : 1.61;

      for (let i = 0; i < this.numNodes; i++) {
        if (this.pinned[i]) continue;
        const i3 = i * 3;
        let px = this.pos[i3], py = clamp(this.pos[i3 + 1], 0.05, maxY), pz = this.pos[i3 + 2];
        this.pos[i3 + 1] = py;

        if (py > pelSplitY) {
          if (sb && sb.radArr) {
            const vFrac = clamp((sb.yTop - py) / Math.max(0.05, sb.yTop - sb.yBot), 0, 1);
            const hEst = this.sampleGlbSkirtHull(vFrac, Math.atan2(pz, px));
            const dx = px - hEst.cx, dz = pz - hEst.cz;
            const theta = Math.atan2(dz, dx);
            const hExact = this.sampleGlbSkirtHull(vFrac, theta);
            const r = Math.hypot(dx, dz) || 0.0001;
            const prof = getCustomLegProfile();
            const armLim = prof && prof.maxRadiusBeforeArms
              ? prof.maxRadiusBeforeArms(hExact.cx, hExact.cz, py, theta, 0.003)
              : 0.48;
            const minR = Math.min(hExact.r + 0.0042, Math.max(hExact.r + 0.0030, armLim));
            if (r < minR) {
              const sc = minR / r;
              px = hExact.cx + dx * sc;
              pz = hExact.cz + dz * sc;
              this.pos[i3] = px; this.pos[i3 + 2] = pz;
            }
          } else if (sb && sb.slices) {
            const vFrac = clamp((sb.yTop - py) / Math.max(0.05, sb.yTop - sb.yBot), 0, 1);
            const h = this.sampleGlbSkirtHull(vFrac, 0);
            const colRx = h.rx + 0.016;
            const colRz = h.rz + 0.016;
            const dx = px - h.cx, dz = pz - h.cz;
            const normR = Math.hypot(dx / colRx, dz / colRz) || 0.0001;
            if (normR < 1.0) {
              px = h.cx + dx / normR;
              pz = h.cz + dz / normR;
              this.pos[i3] = px; this.pos[i3 + 2] = pz;
            }
          } else if (sb) {
            const vFrac = clamp((sb.yTop - py) / Math.max(0.05, sb.yTop - sb.yBot), 0, 1);
            const hullT = Math.min(1, vFrac * 1.45);
            const colRx = sb.waistRx + (sb.hipRx - sb.waistRx) * hullT + 0.012;
            const colRz = sb.waistRz + (sb.hipRz - sb.waistRz) * hullT + 0.012;
            const dx = px - sb.cx, dz = pz - sb.cz;
            const normR = Math.hypot(dx / colRx, dz / colRz) || 0.0001;
            if (normR < 1.0) {
              px = sb.cx + dx / normR;
              pz = sb.cz + dz / normR;
              this.pos[i3] = px; this.pos[i3 + 2] = pz;
            }
          } else {
            const { rx, rz, backGlute } = getPelvisCrossSection(py);
            const colRx = rx + 0.010;
            const colRz = rz + (pz < 0 ? backGlute : 0) + 0.010;
            const normR = Math.hypot(px / colRx, pz / colRz) || 0.0001;
            if (normR < 1.0) {
              px /= normR; pz /= normR;
              this.pos[i3] = px; this.pos[i3 + 2] = pz;
            }
          }
        }
        if (py < legUpperY) {
          const tLeg = legTFromY(py);
          for (const side of [-1, 1]) {
            const { cx, cz } = getLegCenter(side, tLeg);
            const dx = px - cx, dz = pz - cz;
            const r = Math.hypot(dx, dz) || 0.0001;
            const minR = getLegSkinRadius(side, tLeg, Math.atan2(dz, dx)) + 0.012;
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

    if (this.brokenStrands > 0) {
      const frayVerts = [];
      for (let s = 0; s < this.numStrands; s++) {
        if (!this.sBroken[s] || this.sType[s] === 2) continue;
        const a3 = this.sA[s] * 3, b3 = this.sB[s] * 3;
        const ax = this.pos[a3], ay = this.pos[a3 + 1], az = this.pos[a3 + 2];
        const bx = this.pos[b3], by = this.pos[b3 + 1], bz = this.pos[b3 + 2];
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const d = Math.hypot(dx, dy, dz) || 1;
        const len = Math.min(0.015, d * 0.26);
        frayVerts.push(ax, ay, az, ax + (dx / d) * len, ay + (dy / d) * len - 0.005, az + (dz / d) * len);
        frayVerts.push(bx, by, bz, bx - (dx / d) * len, by - (dy / d) * len - 0.005, bz - (dz / d) * len);
      }
      this.frayGeo.setAttribute('position', new THREE.Float32BufferAttribute(frayVerts, 3));
    } else if (this.frayGeo.attributes.position && this.frayGeo.attributes.position.count > 0) {
      this.frayGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    }
  }
}
