import * as THREE from 'three';
import { clamp } from './math.js';

const MAX_TOUCHES = 6;

function createSlot() {
  return {
    active: false,
    held: false,
    pos: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 0, 1),
    disp: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    target: new THREE.Vector3(),
    radius: 0.062,
    stiffness: 165,
    damping: 6.0,
    maxDepth: 0.020,
    bulgeScale: 0.28,
    jiggleY: 0.12,
    jiggleLat: 0.08,
    age: 0
  };
}

// Tham số vật lý mô mềm chuẩn từng vùng cơ thể (world Y: chân ~0, đùi ~1.15, hông ~1.50, eo ~1.78, ngực ~2.02, mặt ~2.40)
function getRegionParams(worldPt) {
  const x = worldPt.x;
  const y = worldPt.y;
  const z = worldPt.z;

  // 1. Cánh tay & vai ngoài (|x| > 0.17, vùng thân trên)
  if (Math.abs(x) > 0.175 && y >= 1.32 && y <= 2.24) {
    return { radius: 0.050, stiffness: 210, damping: 7.4, maxDepth: 0.015, bulgeScale: 0.22, jiggleY: 0.06, jiggleLat: 0.05 };
  }
  // 2. Vùng ngực (mặt trước thân trên): mềm & nảy đàn hồi rõ nhất (có nhịp nảy dọc Y + lắc nhẹ)
  if (y >= 1.85 && y <= 2.22 && z > -0.02) {
    return { radius: 0.088, stiffness: 98, damping: 3.4, maxDepth: 0.032, bulgeScale: 0.36, jiggleY: 0.42, jiggleLat: 0.18 };
  }
  // 3. Lưng trên (mặt sau vùng ngực): chắc hơn mặt trước
  if (y >= 1.85 && y <= 2.22 && z <= -0.02) {
    return { radius: 0.060, stiffness: 215, damping: 7.8, maxDepth: 0.015, bulgeScale: 0.22, jiggleY: 0.06, jiggleLat: 0.04 };
  }
  // 4. Bụng / eo
  if (y >= 1.68 && y < 1.85) {
    return { radius: 0.064, stiffness: 155, damping: 5.6, maxDepth: 0.021, bulgeScale: 0.28, jiggleY: 0.12, jiggleLat: 0.08 };
  }
  // 5. Vùng hông / mông & đùi trên: mềm, êm, gọn trong từng bên đùi
  if (y >= 1.05 && y < 1.68) {
    return { radius: 0.068, stiffness: 138, damping: 4.9, maxDepth: 0.024, bulgeScale: 0.30, jiggleY: 0.18, jiggleLat: 0.10 };
  }
  // 6. Đầu gối mặt trước & cổ chân: vùng xương, cứng
  if ((y >= 0.68 && y <= 0.86 && z > 0.02) || y < 0.24) {
    return { radius: 0.042, stiffness: 300, damping: 11.5, maxDepth: 0.009, bulgeScale: 0.16, jiggleY: 0.02, jiggleLat: 0.02 };
  }
  // 7. Đùi dưới & bắp chân: cơ đàn hồi vừa
  if (y >= 0.24 && y < 1.05) {
    return { radius: 0.056, stiffness: 188, damping: 6.5, maxDepth: 0.018, bulgeScale: 0.25, jiggleY: 0.09, jiggleLat: 0.06 };
  }
  // 8. Đỉnh đầu / trán: cứng nhẹ
  if (y > 2.48) {
    return { radius: 0.042, stiffness: 280, damping: 10.5, maxDepth: 0.009, bulgeScale: 0.15, jiggleY: 0.02, jiggleLat: 0.02 };
  }
  // 9. Má / mặt / cổ: mềm nhẹ tinh tế
  if (y > 2.22) {
    return { radius: 0.044, stiffness: 210, damping: 7.6, maxDepth: 0.013, bulgeScale: 0.22, jiggleY: 0.06, jiggleLat: 0.05 };
  }
  return { radius: 0.058, stiffness: 175, damping: 6.2, maxDepth: 0.018, bulgeScale: 0.25, jiggleY: 0.10, jiggleLat: 0.06 };
}

function buildPolarEnvelopeGeometry(env, stepS = 2, stepA = 3, capTop = false) {
  if (!env || !env.radArr || !env.cxArr || !env.czArr) return null;
  const { yTop, yBot, NS, NA, cxArr, czArr, radArr } = env;
  const sIndices = [];
  for (let s = 0; s < NS; s += stepS) sIndices.push(s);
  if (sIndices[sIndices.length - 1] !== NS - 1) sIndices.push(NS - 1);

  const aCount = Math.max(12, Math.floor(NA / stepA));
  const verts = [];
  const indices = [];

  for (let si = 0; si < sIndices.length; si++) {
    const s = sIndices[si];
    const y = yTop - (s / Math.max(1, NS - 1)) * (yTop - yBot);
    const cx = cxArr[s];
    const cz = czArr[s];
    for (let ai = 0; ai < aCount; ai++) {
      const a = Math.floor((ai / aCount) * NA) % NA;
      const ang = (a / NA) * Math.PI * 2;
      const r = radArr[s * NA + a] + 0.006;
      verts.push(cx + Math.cos(ang) * r, y, cz + Math.sin(ang) * r);
    }
  }

  for (let si = 0; si < sIndices.length - 1; si++) {
    for (let ai = 0; ai < aCount; ai++) {
      const an = (ai + 1) % aCount;
      const a = si * aCount + ai;
      const b = si * aCount + an;
      const c = (si + 1) * aCount + ai;
      const d = (si + 1) * aCount + an;
      indices.push(a, b, c, b, d, c);
    }
  }

  if (capTop) {
    const topCenterIdx = verts.length / 3;
    verts.push(cxArr[0], yTop + 0.008, czArr[0]);
    for (let ai = 0; ai < aCount; ai++) {
      const an = (ai + 1) % aCount;
      indices.push(topCenterIdx, an, ai);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildArmTubeProxyGeometry(arm, yMin, yMax, segY = 12, segA = 10) {
  const verts = [];
  const indices = [];
  for (let i = 0; i <= segY; i++) {
    const y = yMax - (i / segY) * (yMax - yMin);
    const a = arm.evalArm(y);
    const r = Math.max(0.035, a.r + 0.006);
    for (let j = 0; j < segA; j++) {
      const ang = (j / segA) * Math.PI * 2;
      verts.push(a.x + Math.cos(ang) * r, y, a.z + Math.sin(ang) * r);
    }
  }
  for (let i = 0; i < segY; i++) {
    for (let j = 0; j < segA; j++) {
      const jn = (j + 1) % segA;
      const a = i * segA + j;
      const b = i * segA + jn;
      const c = (i + 1) * segA + j;
      const d = (i + 1) * segA + jn;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class SkinElasticitySystem {
  constructor() {
    this.slots = Array.from({ length: MAX_TOUCHES }, createSlot);
    this.touchPosUniforms = Array.from({ length: MAX_TOUCHES }, () => new THREE.Vector4(0, -100, 0, 0));
    this.touchVecUniforms = Array.from({ length: MAX_TOUCHES }, () => new THREE.Vector4(0, 0, 0, 0));
    this.touchNormUniforms = Array.from({ length: MAX_TOUCHES }, () => new THREE.Vector3(0, 0, 1));
    this.patchedMaterials = new WeakSet();
    this.pickMeshes = [];
    this.proxyGroup = new THREE.Group();
    this.activeSlot = null;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
  }

  // tiltNormal = true cho da, áo cotton & váy (hiện rõ bóng lõm 3D); false cho tất lưới/tất mỏng Fresnel (không đổi màu)
  patchMaterial(mat, { tiltNormal = true } = {}) {
    if (!mat || this.patchedMaterials.has(mat)) return;
    this.patchedMaterials.add(mat);

    const prevOnBeforeCompile = mat.onBeforeCompile;
    const prevCacheKey = mat.customProgramCacheKey;
    const tag = tiltNormal ? 'skin-elastic-v5-lit' : 'skin-elastic-v5-flat';

    mat.customProgramCacheKey = () => {
      const base = prevCacheKey ? prevCacheKey.call(mat) : '';
      return `${base}|${tag}`;
    };

    mat.onBeforeCompile = (shader, renderer) => {
      if (prevOnBeforeCompile) prevOnBeforeCompile.call(mat, shader, renderer);

      shader.uniforms.uSkinTouchPos = { value: this.touchPosUniforms };
      shader.uniforms.uSkinTouchVec = { value: this.touchVecUniforms };
      shader.uniforms.uSkinTouchNorm = { value: this.touchNormUniforms };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec4 uSkinTouchPos[${MAX_TOUCHES}];
        uniform vec4 uSkinTouchVec[${MAX_TOUCHES}];
        uniform vec3 uSkinTouchNorm[${MAX_TOUCHES}];
        vec3 _worldToLocalDir(mat4 m, vec3 wv) {
          vec3 invSq = vec3(
            1.0 / max(1e-6, dot(m[0].xyz, m[0].xyz)),
            1.0 / max(1e-6, dot(m[1].xyz, m[1].xyz)),
            1.0 / max(1e-6, dot(m[2].xyz, m[2].xyz))
          );
          return vec3(dot(m[0].xyz, wv), dot(m[1].xyz, wv), dot(m[2].xyz, wv)) * invSq;
        }
        vec3 _calcSkinWorldDisp(vec3 swPos, vec3 swNorm, out vec3 swNormDelta) {
          vec3 disp = vec3(0.0);
          swNormDelta = vec3(0.0);
          for (int i = 0; i < ${MAX_TOUCHES}; i++) {
            float rad = uSkinTouchPos[i].w;
            if (rad <= 0.0001) continue;
            vec3 diff = swPos - uSkinTouchPos[i].xyz;
            float distSq = dot(diff, diff);
            float r2 = rad * rad;
            if (distSq > r2 * 3.8) continue;
            float sigma2 = r2 * 0.25;
            float core = exp(-distSq / (2.0 * sigma2));
            float rNorm = sqrt(distSq) / rad;
            float ring = exp(-pow(rNorm - 0.95, 2.0) / 0.16) * uSkinTouchVec[i].w;
            disp += uSkinTouchVec[i].xyz * core + uSkinTouchNorm[i] * ring;
            float depth = dot(uSkinTouchVec[i].xyz, swNorm);
            vec3 tang = diff - swNorm * dot(diff, swNorm);
            swNormDelta += tang * (depth * core / max(sigma2, 1e-5)) * 0.34;
          }
          return disp;
        }
        `
      );

      if (tiltNormal && shader.vertexShader.includes('#include <beginnormal_vertex>')) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          {
            vec3 _swPosN = (modelMatrix * vec4(position, 1.0)).xyz;
            vec3 _rawWN = mat3(modelMatrix) * objectNormal;
            float _rawWNLen = length(_rawWN);
            if (_rawWNLen > 1e-5) {
              vec3 _swNormN = _rawWN / _rawWNLen;
              vec3 _swNormDelta;
              _calcSkinWorldDisp(_swPosN, _swNormN, _swNormDelta);
              if (dot(_swNormDelta, _swNormDelta) > 1e-8) {
                vec3 _sNewWorldN = normalize(_swNormN + _swNormDelta);
                objectNormal = normalize(_worldToLocalDir(modelMatrix, _sNewWorldN));
              }
            }
          }
          `
        );
      }

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 _swPosV = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 _swDummyDelta;
          vec3 _skinDispV = _calcSkinWorldDisp(_swPosV, vec3(0.0, 0.0, 1.0), _swDummyDelta);
          if (dot(_skinDispV, _skinDispV) > 1e-10) {
            transformed += _worldToLocalDir(modelMatrix, _skinDispV);
          }
        }
        `
      );
    };

    mat.needsUpdate = true;
  }

  attachObject(root, { pickable = false, tiltNormal = true } = {}) {
    if (!root) return;
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) this.patchMaterial(m, { tiltNormal });
      if (pickable && !this.pickMeshes.includes(obj)) {
        this.pickMeshes.push(obj);
      }
    });
  }

  // Tạo lưới raycast siêu nhẹ (~2.500 tam giác thay vì 1.500.000 tam giác GLB) để Chạm da mượt 60 FPS
  buildProxyFromProfile(scene, profile, totalHeight = 2.66) {
    if (!profile) return;
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    const addProxyGeo = (geo) => {
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, proxyMat);
      this.proxyGroup.add(mesh);
      this.pickMeshes.push(mesh);
    };

    if (profile.shirtProfile) addProxyGeo(buildPolarEnvelopeGeometry(profile.shirtProfile, 2, 3));
    if (profile.skirtBounds) addProxyGeo(buildPolarEnvelopeGeometry(profile.skirtBounds, 2, 3));

    if (profile.armTubes && profile.armTubes.length) {
      for (const arm of profile.armTubes) {
        const yMin = arm.pLow ? Math.max(1.18, arm.pLow.y - 0.06) : 1.24;
        const yMax = arm.pHigh ? Math.min(totalHeight - 0.35, arm.pHigh.y + 0.30) : 2.24;
        addProxyGeo(buildArmTubeProxyGeometry(arm, yMin, yMax, 12, 10));
      }
    }

    if (profile.headProfile) {
      addProxyGeo(buildPolarEnvelopeGeometry(profile.headProfile, 1, 1, true));
    } else {
      const headBaseY = profile.shirtProfile ? profile.shirtProfile.yTop - 0.04 : totalHeight - 0.44;
      const headCx = profile.shirtProfile ? profile.shirtProfile.cx : 0;
      const headCz = profile.shirtProfile ? profile.shirtProfile.cz : 0;
      const headH = Math.max(0.32, totalHeight - headBaseY);
      const headGeo = new THREE.SphereGeometry(1, 14, 10);
      headGeo.scale(0.145, headH * 0.54, 0.155);
      headGeo.translate(headCx, headBaseY + headH * 0.52, headCz + 0.01);
      addProxyGeo(headGeo);
    }

    scene.add(this.proxyGroup);
    this.proxyGroup.updateMatrixWorld(true);
  }

  _allocateSlot(worldPt) {
    for (const s of this.slots) {
      if (s.active && !s.held && s.pos.distanceTo(worldPt) < 0.042) {
        return s;
      }
    }
    for (const s of this.slots) {
      if (!s.active) return s;
    }
    let oldest = this.slots[0];
    for (const s of this.slots) {
      if (!s.held && s.age > oldest.age) oldest = s;
    }
    return oldest;
  }

  beginTouch(worldPt, worldNormal) {
    const params = getRegionParams(worldPt);
    const slot = this._allocateSlot(worldPt);
    slot.active = true;
    slot.held = true;
    slot.age = 0;
    slot.pos.copy(worldPt);
    slot.normal.copy(worldNormal).normalize();
    slot.radius = params.radius;
    slot.stiffness = params.stiffness;
    slot.damping = params.damping;
    slot.maxDepth = params.maxDepth;
    slot.bulgeScale = params.bulgeScale;
    slot.jiggleY = params.jiggleY;
    slot.jiggleLat = params.jiggleLat;

    // Ấn lõm theo pháp tuyến + nhấc nhẹ/lệch tự nhiên theo mô mềm (rõ ngay cả khi nhìn chính diện)
    const latSign = worldPt.x >= 0 ? 1 : -1;
    slot.target.copy(slot.normal).multiplyScalar(-slot.maxDepth * 0.85);
    slot.target.y += slot.maxDepth * slot.jiggleY * 0.42;
    slot.target.x += latSign * slot.maxDepth * slot.jiggleLat * 0.35;

    // Xung lực chạm ban đầu (lõm vào + rung dọc theo trọng lực để tap nhanh vẫn nảy rõ)
    slot.vel.addScaledVector(slot.normal, -0.26);
    slot.vel.y -= slot.jiggleY * 0.36;
    slot.vel.x += latSign * slot.jiggleLat * 0.14;

    this.activeSlot = slot;
    return slot;
  }

  moveTouch(worldPt, worldNormal, dragDelta = null) {
    if (!this.activeSlot) return null;
    const slot = this.activeSlot;

    if (worldPt.distanceTo(slot.pos) > slot.radius * 1.18) {
      this.endTouch();
      return this.beginTouch(worldPt, worldNormal);
    }

    const delta = this._tmpA.copy(worldPt).sub(slot.pos);
    if (dragDelta) delta.addScaledVector(dragDelta, 0.45);

    const nDot = delta.dot(slot.normal);
    const tang = this._tmpB.copy(delta).addScaledVector(slot.normal, -nDot);
    const maxTang = slot.maxDepth * (1.0 + slot.jiggleY * 0.65);
    if (tang.length() > maxTang) tang.setLength(maxTang);

    slot.target.copy(slot.normal).multiplyScalar(-slot.maxDepth * 0.82).add(tang);
    return slot;
  }

  endTouch() {
    if (!this.activeSlot) return;
    const slot = this.activeSlot;
    slot.held = false;
    slot.target.set(0, 0, 0);
    // Bật đàn hồi ngược chiều biến dạng + nhịp rung dọc trọng lực (rất tự nhiên ở ngực & hông)
    slot.vel.addScaledVector(slot.disp, -3.0);
    slot.vel.addScaledVector(slot.normal, 0.14);
    slot.vel.y -= slot.jiggleY * 0.48;
    this.activeSlot = null;
  }

  getActiveTouchPosition(outVec) {
    if (!this.activeSlot) return null;
    return outVec.copy(this.activeSlot.pos).add(this.activeSlot.disp);
  }

  step(dt) {
    const subSteps = 2;
    const subDt = clamp(dt, 0.001, 0.04) / subSteps;

    for (let i = 0; i < MAX_TOUCHES; i++) {
      const s = this.slots[i];
      if (!s.active) {
        this.touchPosUniforms[i].w = 0;
        this.touchVecUniforms[i].set(0, 0, 0, 0);
        continue;
      }

      s.age += dt;
      for (let step = 0; step < subSteps; step++) {
        const ax = s.stiffness * (s.target.x - s.disp.x) - s.damping * s.vel.x;
        const ay = s.stiffness * (s.target.y - s.disp.y) - s.damping * s.vel.y;
        const az = s.stiffness * (s.target.z - s.disp.z) - s.damping * s.vel.z;

        s.vel.x += ax * subDt;
        s.vel.y += ay * subDt;
        s.vel.z += az * subDt;

        s.disp.x += s.vel.x * subDt;
        s.disp.y += s.vel.y * subDt;
        s.disp.z += s.vel.z * subDt;
      }

      const maxAmp = s.maxDepth * 1.55;
      const lenSq = s.disp.lengthSq();
      if (lenSq > maxAmp * maxAmp) {
        s.disp.multiplyScalar(maxAmp / Math.sqrt(lenSq));
      }

      if (!s.held && s.disp.lengthSq() < 1e-8 && s.vel.lengthSq() < 1e-6) {
        s.active = false;
        s.disp.set(0, 0, 0);
        s.vel.set(0, 0, 0);
        this.touchPosUniforms[i].w = 0;
        this.touchVecUniforms[i].set(0, 0, 0, 0);
        continue;
      }

      const indentDepth = -s.disp.dot(s.normal);
      const bulge = Math.max(0, indentDepth) * s.bulgeScale;

      this.touchPosUniforms[i].set(s.pos.x, s.pos.y, s.pos.z, s.radius);
      this.touchVecUniforms[i].set(s.disp.x, s.disp.y, s.disp.z, bulge);
      this.touchNormUniforms[i].copy(s.normal);
    }
  }
}
