import * as THREE from 'three';
import { appState, COLOR_PRESETS, DENIER_PRESETS, MESH_PRESETS } from './config.js';
import {
  clamp,
  LEG_Y_BOT,
  LEG_Y_TOP,
  LEG_Y_SPAN,
  getCustomLegProfile,
  legTFromY,
  getLegCenter,
  getLegSkinRadius,
  sampleLegSurface
} from './math.js';
import {
  createBraidedYarnTextures,
  createKnotTextures,
  createContactShadowTexture,
  createSheerNylonNormalMap
} from './textures.js';
import { sound } from './audio.js';

// =========================================================================
// TRUE DIAMOND-LATTICE 3D FISHNET & FRESNEL SHEER NYLON STOCKING SYSTEM
// =========================================================================
export function createStockingSystem({ scene, camera, fiberDust, laceMat }) {
  const yarnTex = createBraidedYarnTextures();
  const knotTex = createKnotTextures();
  const shadowTex = createContactShadowTexture();
  const sheerNormalTex = createSheerNylonNormalMap();

  const sheerUniforms = {
    uSheerCenter: { value: DENIER_PRESETS['40d'].center },
    uSheerEdge:   { value: DENIER_PRESETS['40d'].edge },
    uSheerSheen:  { value: COLOR_PRESETS.black.sheerGlow.clone() }
  };

  const sheerMaterial = new THREE.MeshPhysicalMaterial({
    color: COLOR_PRESETS.black.sheerHex,
    normalMap: sheerNormalTex,
    normalScale: new THREE.Vector2(0.16, 0.16),
    roughness: 0.40,
    metalness: 0.02,
    sheen: 0.85,
    sheenRoughness: 0.38,
    sheenColor: new THREE.Color(COLOR_PRESETS.black.sheenHex),
    envMapIntensity: 0.55,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide
  });

  sheerMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uSheerCenter = sheerUniforms.uSheerCenter;
    shader.uniforms.uSheerEdge = sheerUniforms.uSheerEdge;
    shader.uniforms.uSheerSheen = sheerUniforms.uSheerSheen;

    shader.vertexShader =
      'attribute float aStrain;\nvarying float vStrain;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvStrain = aStrain;'
      );

    shader.fragmentShader =
      'uniform float uSheerCenter;\nuniform float uSheerEdge;\nuniform vec3 uSheerSheen;\nvarying float vStrain;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        vec3 sViewDir = normalize( vViewPosition );
        float ndotv = abs( dot( normalize( normal ), sViewDir ) );
        float edgeDensity = pow( 1.0 - ndotv, 1.55 );
        float stretchThin = clamp( vStrain * 0.28, 0.0, 0.30 );
        float sheerAlpha = mix( uSheerCenter, uSheerEdge, edgeDensity );
        sheerAlpha = clamp( sheerAlpha * ( 1.0 - stretchThin ), 0.08, 0.96 );
        outgoingLight += uSheerSheen * ( pow( 1.0 - ndotv, 2.6 ) * 0.16 + vStrain * 0.15 );
        diffuseColor.a = sheerAlpha;
        #include <opaque_fragment>
        `
      );
  };

  const sheerFrayMaterial = new THREE.MeshBasicMaterial({
    color: COLOR_PRESETS.black.sheerHex,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const strandMaterial = new THREE.MeshPhysicalMaterial({
    color: COLOR_PRESETS.black.hex,
    map: yarnTex.map,
    alphaMap: yarnTex.alphaMap,
    normalMap: yarnTex.normalMap,
    normalScale: new THREE.Vector2(1.55, 1.55),
    roughnessMap: yarnTex.roughnessMap,
    roughness: 0.56,
    metalness: 0.06,
    sheen: 0.95,
    sheenRoughness: 0.36,
    sheenColor: new THREE.Color(COLOR_PRESETS.black.sheenHex),
    vertexColors: true,
    transparent: true,
    alphaTest: 0.14,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: THREE.DoubleSide
  });

  const knotMaterial = new THREE.MeshPhysicalMaterial({
    color: COLOR_PRESETS.black.hex,
    alphaMap: knotTex.alphaMap,
    normalMap: knotTex.normalMap,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughness: 0.54,
    metalness: 0.06,
    sheen: 0.85,
    sheenRoughness: 0.40,
    sheenColor: new THREE.Color(COLOR_PRESETS.black.sheenHex),
    vertexColors: true,
    transparent: true,
    alphaTest: 0.22,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: THREE.DoubleSide
  });

  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    color: 0x1a0b07,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    side: THREE.DoubleSide
  });

  const hitHullMat = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide
  });

  function applyColorPreset() {
    const p = COLOR_PRESETS[appState.colorKey];
    const den = DENIER_PRESETS[appState.sheerDenier];
    strandMaterial.color.setHex(p.hex);
    strandMaterial.sheenColor.setHex(p.sheenHex);
    knotMaterial.color.setHex(p.hex);
    knotMaterial.sheenColor.setHex(p.sheenHex);
    sheerMaterial.color.setHex(p.sheerHex);
    sheerMaterial.sheenColor.setHex(p.sheenHex);
    sheerUniforms.uSheerSheen.value.copy(p.sheerGlow);
    sheerUniforms.uSheerCenter.value = den.center;
    sheerUniforms.uSheerEdge.value = den.edge;
    sheerFrayMaterial.color.setHex(p.sheerHex);
    if (laceMat) {
      laceMat.color.setHex(p.laceHex);
      laceMat.sheenColor.setHex(p.sheenHex);
    }
    fiberDust.mat.color.setHex(p.dustHex);
    contactShadowMat.opacity = appState.colorKey === 'white' ? 0.24 : 0.44;
  }

  class DiamondFishnetStocking {
    constructor(side, presetKey) {
      this.side = side;
      this.group = new THREE.Group();
      scene.add(this.group);
      this.build(presetKey);
    }

    disposeMeshes() {
      while (this.group.children.length > 0) {
        const obj = this.group.children[0];
        this.group.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
      }
    }

    build(presetKey) {
      this.disposeMeshes();
      const cfg = MESH_PRESETS[presetKey];
      const prof = getCustomLegProfile();
      this.NU = cfg.NU;
      // Giữ mắt lưới 45° cân đối theo chiều dài chân thực tế của model GLB
      this.NV = prof ? Math.max(36, Math.round(cfg.NV * clamp(LEG_Y_SPAN / 1.45, 0.55, 1.0))) : cfg.NV;
      this.baseHalfWidth = cfg.halfWidth;
      this.knotRadius = cfg.knotR;
      this.tMin = prof ? prof.tMin : 0.145;
      this.tMax = prof ? prof.tMax : 0.975;
      // Ôm bó sát da từng đường cong đùi, gối, bắp chân và cổ chân
      const isTight = !prof || prof.tightLeg;
      this.radialOffset = isTight
        ? (presetKey === 'large' ? 0.0026 : 0.0019)
        : (presetKey === 'large' ? 0.0085 : 0.0062);
      this.hoopPreTension = isTight ? 0.945 : 0.985;

      this.numNodes = this.NU * (this.NV + 1);
      this.pos = new Float32Array(this.numNodes * 3);
      this.prevPos = new Float32Array(this.numNodes * 3);
      this.restPos = new Float32Array(this.numNodes * 3);
      this.pinned = new Uint8Array(this.numNodes);
      this.intactDegree = new Uint8Array(this.numNodes);
      this.brokenDegree = new Uint8Array(this.numNodes);
      this.nodeStrain = new Float32Array(this.numNodes);
      this.nodeLift = new Float32Array(this.numNodes);
      this.isAwake = true;
      this.sleepFrames = 0;

      // 1. Staggered 45° diamond lattice nodes
      for (let r = 0; r <= this.NV; r++) {
        const v = r / this.NV;
        const t = this.tMin + v * (this.tMax - this.tMin);
        const halfStep = (r & 1) ? (0.5 / this.NU) * Math.PI * 2 : 0;
        for (let c = 0; c < this.NU; c++) {
          const theta = (c / this.NU) * Math.PI * 2 + halfStep;
          const i = r * this.NU + c;
          const pt = sampleLegSurface(this.side, t, theta, this.radialOffset);
          const i3 = i * 3;
          this.pos[i3] = this.prevPos[i3] = this.restPos[i3] = pt.x;
          this.pos[i3 + 1] = this.prevPos[i3 + 1] = this.restPos[i3 + 1] = pt.y;
          this.pos[i3 + 2] = this.prevPos[i3 + 2] = this.restPos[i3 + 2] = pt.z;
          this.pinned[i] = (r === 0 || r === this.NV) ? 1 : 0;
        }
      }

      // 2. Primary diagonal strands
      this.numStrands = this.NV * this.NU * 2;
      this.sA = new Int32Array(this.numStrands);
      this.sB = new Int32Array(this.numStrands);
      this.sInitLen = new Float32Array(this.numStrands);
      this.sRestLen = new Float32Array(this.numStrands);
      this.sRand = new Float32Array(this.numStrands);
      this.sFatigue = new Float32Array(this.numStrands);
      this.sNotch = new Float32Array(this.numStrands);
      this.sBroken = new Uint8Array(this.numStrands);
      this.sStrain = new Float32Array(this.numStrands);

      this.nodeStrands = new Int32Array(this.numNodes * 4).fill(-1);
      this.nodeStrandCount = new Uint8Array(this.numNodes);

      const attachStrand = (node, sIdx) => {
        const k = this.nodeStrandCount[node];
        if (k < 4) {
          this.nodeStrands[node * 4 + k] = sIdx;
          this.nodeStrandCount[node] = k + 1;
        }
        this.intactDegree[node]++;
      };

      let sIdx = 0;
      for (let r = 0; r < this.NV; r++) {
        const odd = (r & 1) === 1;
        for (let c = 0; c < this.NU; c++) {
          const a = r * this.NU + c;
          const cL = odd ? c : (c - 1 + this.NU) % this.NU;
          const cR = odd ? (c + 1) % this.NU : c;
          const bL = (r + 1) * this.NU + cL;
          const bR = (r + 1) * this.NU + cR;

          for (const b of [bL, bR]) {
            this.sA[sIdx] = a;
            this.sB[sIdx] = b;
            const dx = this.restPos[b * 3] - this.restPos[a * 3];
            const dy = this.restPos[b * 3 + 1] - this.restPos[a * 3 + 1];
            const dz = this.restPos[b * 3 + 2] - this.restPos[a * 3 + 2];
            const len = Math.hypot(dx, dy, dz);
            this.sInitLen[sIdx] = len;
            this.sRestLen[sIdx] = len * this.hoopPreTension;
            this.sRand[sIdx] = 0.91 + Math.random() * 0.18;
            attachStrand(a, sIdx);
            attachStrand(b, sIdx);
            sIdx++;
          }
        }
      }

      // 3. Soft shape-keeping diamond bias springs
      const biasA = [], biasB = [], biasRest = [], biasGuard1 = [], biasGuard2 = [];
      for (let r = 1; r < this.NV; r++) {
        for (let c = 0; c < this.NU; c++) {
          const a = r * this.NU + c;
          const b = r * this.NU + ((c + 1) % this.NU);
          const dx = this.restPos[b * 3] - this.restPos[a * 3];
          const dy = this.restPos[b * 3 + 1] - this.restPos[a * 3 + 1];
          const dz = this.restPos[b * 3 + 2] - this.restPos[a * 3 + 2];
          biasA.push(a);
          biasB.push(b);
          biasRest.push(Math.hypot(dx, dy, dz) * this.hoopPreTension);
          const gBase = ((r - 1) * this.NU + c) * 2;
          biasGuard1.push(gBase);
          biasGuard2.push(gBase + 1);
        }
      }
      this.numBias = biasA.length;
      this.bA = new Int32Array(biasA);
      this.bB = new Int32Array(biasB);
      this.bRest = new Float32Array(biasRest);
      this.bG1 = new Int32Array(biasGuard1);
      this.bG2 = new Int32Array(biasGuard2);

      this.brokenStrands = 0;
      this.danglingStubs = [];

      // 4A. Braided Strand Ribbons
      this.maxDangleQuads = 2400;
      this.totalStrandQuads = this.numStrands + this.maxDangleQuads;
      const sVerts = this.totalStrandQuads * 4;
      this.sPosBuf = new Float32Array(sVerts * 3);
      this.sNormBuf = new Float32Array(sVerts * 3);
      this.sColBuf = new Float32Array(sVerts * 3);
      const sUVs = new Float32Array(sVerts * 2);
      const sIndices = new Uint32Array(this.totalStrandQuads * 6);

      for (let q = 0; q < this.totalStrandQuads; q++) {
        const v = q * 4;
        sUVs[v * 2] = 0;       sUVs[v * 2 + 1] = 0;
        sUVs[(v + 1) * 2] = 1; sUVs[(v + 1) * 2 + 1] = 0;
        sUVs[(v + 2) * 2] = 0; sUVs[(v + 2) * 2 + 1] = 1.6;
        sUVs[(v + 3) * 2] = 1; sUVs[(v + 3) * 2 + 1] = 1.6;
        const idx = q * 6;
        sIndices[idx] = v; sIndices[idx + 1] = v + 1; sIndices[idx + 2] = v + 2;
        sIndices[idx + 3] = v + 1; sIndices[idx + 4] = v + 3; sIndices[idx + 5] = v + 2;
      }
      this.strandGeo = new THREE.BufferGeometry();
      this.strandGeo.setAttribute('position', new THREE.BufferAttribute(this.sPosBuf, 3));
      this.strandGeo.setAttribute('normal', new THREE.BufferAttribute(this.sNormBuf, 3));
      this.strandGeo.setAttribute('color', new THREE.BufferAttribute(this.sColBuf, 3));
      this.strandGeo.setAttribute('uv', new THREE.BufferAttribute(sUVs, 2));
      this.strandGeo.setIndex(new THREE.BufferAttribute(sIndices, 1));
      this.strandMesh = new THREE.Mesh(this.strandGeo, strandMaterial);
      this.strandMesh.frustumCulled = false;
      this.strandMesh.renderOrder = 2;
      this.group.add(this.strandMesh);

      // 4B. Interlocking Knot Quads
      const kVerts = this.numNodes * 4;
      this.kPosBuf = new Float32Array(kVerts * 3);
      this.kNormBuf = new Float32Array(kVerts * 3);
      this.kColBuf = new Float32Array(kVerts * 3);
      const kUVs = new Float32Array(kVerts * 2);
      const kIndices = new Uint32Array(this.numNodes * 6);
      for (let n = 0; n < this.numNodes; n++) {
        const v = n * 4;
        kUVs[v * 2] = 0; kUVs[v * 2 + 1] = 0;
        kUVs[(v + 1) * 2] = 1; kUVs[(v + 1) * 2 + 1] = 0;
        kUVs[(v + 2) * 2] = 0; kUVs[(v + 2) * 2 + 1] = 1;
        kUVs[(v + 3) * 2] = 1; kUVs[(v + 3) * 2 + 1] = 1;
        const idx = n * 6;
        kIndices[idx] = v; kIndices[idx + 1] = v + 1; kIndices[idx + 2] = v + 2;
        kIndices[idx + 3] = v + 1; kIndices[idx + 4] = v + 3; kIndices[idx + 5] = v + 2;
      }
      this.knotGeo = new THREE.BufferGeometry();
      this.knotGeo.setAttribute('position', new THREE.BufferAttribute(this.kPosBuf, 3));
      this.knotGeo.setAttribute('normal', new THREE.BufferAttribute(this.kNormBuf, 3));
      this.knotGeo.setAttribute('color', new THREE.BufferAttribute(this.kColBuf, 3));
      this.knotGeo.setAttribute('uv', new THREE.BufferAttribute(kUVs, 2));
      this.knotGeo.setIndex(new THREE.BufferAttribute(kIndices, 1));
      this.knotMesh = new THREE.Mesh(this.knotGeo, knotMaterial);
      this.knotMesh.frustumCulled = false;
      this.knotMesh.renderOrder = 3;
      this.group.add(this.knotMesh);

      // 4C. Dynamic Skin Contact Shadow Ribbons
      const shVerts = this.numStrands * 4;
      this.shPosBuf = new Float32Array(shVerts * 3);
      const shUVs = new Float32Array(shVerts * 2);
      const shIndices = new Uint32Array(this.numStrands * 6);
      for (let q = 0; q < this.numStrands; q++) {
        const v = q * 4;
        shUVs[v * 2] = 0; shUVs[v * 2 + 1] = 0;
        shUVs[(v + 1) * 2] = 1; shUVs[(v + 1) * 2 + 1] = 0;
        shUVs[(v + 2) * 2] = 0; shUVs[(v + 2) * 2 + 1] = 1;
        shUVs[(v + 3) * 2] = 1; shUVs[(v + 3) * 2 + 1] = 1;
        const idx = q * 6;
        shIndices[idx] = v; shIndices[idx + 1] = v + 1; shIndices[idx + 2] = v + 2;
        shIndices[idx + 3] = v + 1; shIndices[idx + 4] = v + 3; shIndices[idx + 5] = v + 2;
      }
      this.shadowGeo = new THREE.BufferGeometry();
      this.shadowGeo.setAttribute('position', new THREE.BufferAttribute(this.shPosBuf, 3));
      this.shadowGeo.setAttribute('uv', new THREE.BufferAttribute(shUVs, 2));
      this.shadowGeo.setIndex(new THREE.BufferAttribute(shIndices, 1));
      this.shadowMesh = new THREE.Mesh(this.shadowGeo, contactShadowMat);
      this.shadowMesh.frustumCulled = false;
      this.shadowMesh.renderOrder = 1;
      this.group.add(this.shadowMesh);

      // 4D. Sheer Nylon Surface Mesh (zero-seam 360°)
      this.numSheerVerts = (this.NU + 1) * (this.NV + 1);
      this.sheerPosBuf = new Float32Array(this.numSheerVerts * 3);
      this.sheerStrainBuf = new Float32Array(this.numSheerVerts);
      const sheerUVs = new Float32Array(this.numSheerVerts * 2);
      for (let r = 0; r <= this.NV; r++) {
        const v = r / this.NV;
        const halfU = (r & 1) ? 0.5 : 0.0;
        for (let c = 0; c <= this.NU; c++) {
          const vi = r * (this.NU + 1) + c;
          sheerUVs[vi * 2] = (c + halfU) / this.NU;
          sheerUVs[vi * 2 + 1] = v;
        }
      }
      this.sheerGeo = new THREE.BufferGeometry();
      this.sheerGeo.setAttribute('position', new THREE.BufferAttribute(this.sheerPosBuf, 3));
      this.sheerGeo.setAttribute('aStrain', new THREE.BufferAttribute(this.sheerStrainBuf, 1));
      this.sheerGeo.setAttribute('uv', new THREE.BufferAttribute(sheerUVs, 2));
      this.sheerMesh = new THREE.Mesh(this.sheerGeo, sheerMaterial);
      this.sheerMesh.frustumCulled = false;
      this.sheerMesh.renderOrder = 2;
      this.group.add(this.sheerMesh);

      // 4E. Wispy Frayed Nylon Threads around torn sheer rims
      this.sheerFrayPosBuf = new Float32Array(this.maxDangleQuads * 4 * 3);
      const sfIndices = new Uint32Array(this.maxDangleQuads * 6);
      for (let q = 0; q < this.maxDangleQuads; q++) {
        const v = q * 4, idx = q * 6;
        sfIndices[idx] = v; sfIndices[idx + 1] = v + 1; sfIndices[idx + 2] = v + 2;
        sfIndices[idx + 3] = v + 1; sfIndices[idx + 4] = v + 3; sfIndices[idx + 5] = v + 2;
      }
      this.sheerFrayGeo = new THREE.BufferGeometry();
      this.sheerFrayGeo.setAttribute('position', new THREE.BufferAttribute(this.sheerFrayPosBuf, 3));
      this.sheerFrayGeo.setIndex(new THREE.BufferAttribute(sfIndices, 1));
      this.sheerFrayMesh = new THREE.Mesh(this.sheerFrayGeo, sheerFrayMaterial);
      this.sheerFrayMesh.frustumCulled = false;
      this.sheerFrayMesh.renderOrder = 3;
      this.group.add(this.sheerFrayMesh);

      // 4F. Invisible Raycast Hull
      this.hullGeo = new THREE.BufferGeometry();
      this.hullGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.hullMesh = new THREE.Mesh(this.hullGeo, hitHullMat);
      this.hullMesh.userData.cloth = this;
      this.group.add(this.hullMesh);

      this.rebuildHitHull();
      this.updateVisualGeometry();
    }

    rebuildHitHull() {
      const hullIndices = [];
      const sheerIndices = [];
      const stride = this.NU + 1;

      for (let r = 0; r < this.NV; r++) {
        const odd = (r & 1) === 1;
        for (let c = 0; c < this.NU; c++) {
          const sBase = (r * this.NU + c) * 2;
          const sLBroken = this.sBroken[sBase];
          const sRBroken = this.sBroken[sBase + 1];
          const a = r * this.NU + c;
          const cL = odd ? c : (c - 1 + this.NU) % this.NU;
          const cR = odd ? (c + 1) % this.NU : c;
          const bL = (r + 1) * this.NU + cL;
          const bR = (r + 1) * this.NU + cR;
          const cNext = (c + 1) % this.NU;
          const aNext = r * this.NU + cNext;
          const sNextBase = (r * this.NU + cNext) * 2;
          const sNextL = this.sBroken[sNextBase];
          const sNextR = this.sBroken[sNextBase + 1];

          if (!sLBroken && !sRBroken) hullIndices.push(a, bR, bL);
          if (!sRBroken && !sNextL) hullIndices.push(a, aNext, bR);

          const vA = r * stride + c;
          const vB = r * stride + c + 1;
          const vC = (r + 1) * stride + c;
          const vD = (r + 1) * stride + c + 1;
          if (!odd) {
            if (!sRBroken && !sNextL) sheerIndices.push(vA, vB, vC);
            if (!sNextL && !sNextR)   sheerIndices.push(vB, vD, vC);
          } else {
            if (!sLBroken && !sRBroken) sheerIndices.push(vA, vD, vC);
            if (!sRBroken && !sNextL)   sheerIndices.push(vA, vB, vD);
          }
        }
      }
      this.hullGeo.setIndex(hullIndices);
      this.hullGeo.computeBoundingSphere();
      this.sheerGeo.setIndex(sheerIndices);
    }

    repair() {
      for (let i = 0; i < this.numNodes * 3; i++) {
        this.pos[i] = this.restPos[i];
        this.prevPos[i] = this.restPos[i];
      }
      this.sBroken.fill(0);
      this.sFatigue.fill(0);
      this.sNotch.fill(0);
      this.sStrain.fill(0);
      this.nodeStrain.fill(0);
      this.nodeLift.fill(0);
      this.brokenDegree.fill(0);
      this.intactDegree.fill(0);
      for (let s = 0; s < this.numStrands; s++) {
        this.intactDegree[this.sA[s]]++;
        this.intactDegree[this.sB[s]]++;
      }
      this.brokenStrands = 0;
      this.danglingStubs = [];
      this.isAwake = true;
      this.sleepFrames = 0;
      this.rebuildHitHull();
      this.updateVisualGeometry();
    }

    wake() {
      this.isAwake = true;
      this.sleepFrames = 0;
    }

    spawnDanglingStub(anchorIdx, otherX, otherY, otherZ, restLen, recoilDirX, recoilDirY, recoilDirZ) {
      if (this.danglingStubs.length >= this.maxDangleQuads / 2) return;
      const a3 = anchorIdx * 3;
      const ax = this.pos[a3], ay = this.pos[a3 + 1], az = this.pos[a3 + 2];
      const segLen = clamp(restLen * 0.34, 0.0045, 0.013);
      const dx = otherX - ax, dy = otherY - ay, dz = otherZ - az;
      const d = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / d, uy = dy / d, uz = dz / d;

      const mx = ax + ux * segLen, my = ay + uy * segLen, mz = az + uz * segLen;
      const tx = mx + ux * segLen * 0.9, ty = my + uy * segLen * 0.9, tz = mz + uz * segLen * 0.9;
      const kick = 0.0085;

      this.danglingStubs.push({
        anchor: anchorIdx,
        mx, my, mz,
        pmx: mx - recoilDirX * kick, pmy: my - recoilDirY * kick, pmz: mz - recoilDirZ * kick,
        tx, ty, tz,
        ptx: tx - recoilDirX * kick * 1.45, pty: ty - recoilDirY * kick * 1.45, ptz: tz - recoilDirZ * kick * 1.45,
        segLen,
        curlX: (Math.random() - 0.5) * 0.0007,
        curlZ: (Math.random() - 0.5) * 0.0007
      });
    }

    stepPhysics(activeGrabs) {
      if (!this.isAwake && activeGrabs.length === 0) {
        return { peakTensionRatio: 0, newlyBroken: [] };
      }

      const damping = 0.88;
      const gravity = -0.00042;
      this.nodeStrain.fill(0);

      let maxMotionSq = 0;
      for (let i = 0; i < this.numNodes; i++) {
        if (this.pinned[i]) continue;
        const i3 = i * 3;
        const x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];

        const onSkin = this.nodeLift[i] < 0.0045;
        const damp = onSkin ? 0.76 : damping;
        const vx = (x - this.prevPos[i3]) * damp;
        const vy = (y - this.prevPos[i3 + 1]) * damp;
        const vz = (z - this.prevPos[i3 + 2]) * damp;

        const mSq = vx * vx + vy * vy + vz * vz;
        if (mSq > maxMotionSq) maxMotionSq = mSq;

        this.prevPos[i3] = x; this.prevPos[i3 + 1] = y; this.prevPos[i3 + 2] = z;

        const isTornRim = this.brokenDegree[i] > 0;
        const gravFactor = isTornRim ? 1.85 : (onSkin ? 0.15 : 0.75);
        const restPull = (!isTornRim && onSkin) ? 0.0028 : 0;

        this.pos[i3]     = x + vx + (this.restPos[i3] - x) * restPull;
        this.pos[i3 + 1] = y + vy + gravity * gravFactor + (this.restPos[i3 + 1] - y) * restPull;
        this.pos[i3 + 2] = z + vz + (this.restPos[i3 + 2] - z) * restPull;
      }

      const pullStiff = 0.34 * appState.pullPower;
      for (let gIdx = 0; gIdx < activeGrabs.length; gIdx++) {
        const grab = activeGrabs[gIdx];
        if (grab.cloth !== this) continue;
        const tx = grab.target.x, ty = grab.target.y, tz = grab.target.z;
        const list = grab.nodes;
        for (let k = 0; k < list.length; k++) {
          const item = list[k];
          if (this.intactDegree[item.idx] === 0) continue;
          const i3 = item.idx * 3;
          const pull = Math.min(0.65, item.weight * pullStiff);
          this.pos[i3]     += (tx + item.ox - this.pos[i3]) * pull;
          this.pos[i3 + 1] += (ty + item.oy - this.pos[i3 + 1]) * pull;
          this.pos[i3 + 2] += (tz + item.oz - this.pos[i3 + 2]) * pull;
        }
      }

      const baseThresh = appState.strength;
      let peakTensionRatio = 0;
      const newlyBroken = [];
      const maxBreaksPerFrame = 3;

      for (let iter = 0; iter < 7; iter++) {
        let highestOverRatio = 0;
        let highestOverIdx = -1;

        for (let s = 0; s < this.numStrands; s++) {
          if (this.sBroken[s]) continue;
          const a = this.sA[s], b = this.sB[s];
          const a3 = a * 3, b3 = b * 3;
          const dx = this.pos[b3] - this.pos[a3];
          const dy = this.pos[b3 + 1] - this.pos[a3 + 1];
          const dz = this.pos[b3 + 2] - this.pos[a3 + 2];
          const dist = Math.hypot(dx, dy, dz) || 0.0001;

          if (iter === 0) {
            const stretch = dist / this.sInitLen[s];
            const effThresh = Math.max(1.32, baseThresh * this.sRand[s] - this.sNotch[s] - this.sFatigue[s]);
            const tensionRatio = clamp((stretch - 1.04) / (effThresh - 1.04), 0, 1.5);

            this.sStrain[s] = tensionRatio;
            if (tensionRatio > this.nodeStrain[a]) this.nodeStrain[a] = tensionRatio;
            if (tensionRatio > this.nodeStrain[b]) this.nodeStrain[b] = tensionRatio;
            if (tensionRatio > peakTensionRatio) peakTensionRatio = tensionRatio;

            if (tensionRatio > 0.88) {
              this.sFatigue[s] = Math.min(0.28, this.sFatigue[s] + (tensionRatio - 0.88) * 0.032);
            } else if (this.sFatigue[s] > 0) {
              this.sFatigue[s] = Math.max(0, this.sFatigue[s] - 0.015);
            }

            // Chỉ cho phép rách khi người chơi đang kéo, tránh tự đứt khi đứng yên
            if (activeGrabs.length > 0 && stretch > effThresh) {
              const over = stretch / effThresh;
              if (over > highestOverRatio) {
                highestOverRatio = over;
                highestOverIdx = s;
              }
            }
          }

          const rest = this.sRestLen[s];
          if (dist > rest) {
            const diff = (dist - rest) / dist;
            const corr = diff * 0.5 * 0.62;
            const cx = dx * corr, cy = dy * corr, cz = dz * corr;
            if (!this.pinned[a]) {
              this.pos[a3] += cx; this.pos[a3 + 1] += cy; this.pos[a3 + 2] += cz;
            }
            if (!this.pinned[b]) {
              this.pos[b3] -= cx; this.pos[b3 + 1] -= cy; this.pos[b3 + 2] -= cz;
            }
          }
        }

        if (iter < maxBreaksPerFrame && highestOverIdx !== -1 && newlyBroken.length < maxBreaksPerFrame) {
          this.breakStrand(highestOverIdx, newlyBroken);
        }

        for (let k = 0; k < this.numBias; k++) {
          if (this.sBroken[this.bG1[k]] || this.sBroken[this.bG2[k]]) continue;
          const a = this.bA[k], b = this.bB[k];
          const a3 = a * 3, b3 = b * 3;
          const dx = this.pos[b3] - this.pos[a3];
          const dy = this.pos[b3 + 1] - this.pos[a3 + 1];
          const dz = this.pos[b3 + 2] - this.pos[a3 + 2];
          const dist = Math.hypot(dx, dy, dz) || 0.0001;
          const diff = (dist - this.bRest[k]) / dist;
          const corr = diff * 0.5 * 0.16;
          const cx = dx * corr, cy = dy * corr, cz = dz * corr;
          if (!this.pinned[a]) {
            this.pos[a3] += cx; this.pos[a3 + 1] += cy; this.pos[a3 + 2] += cz;
          }
          if (!this.pinned[b]) {
            this.pos[b3] -= cx; this.pos[b3 + 1] -= cy; this.pos[b3 + 2] -= cz;
          }
        }

        for (let i = 0; i < this.numNodes; i++) {
          if (this.pinned[i]) {
            this.nodeLift[i] = 0;
            continue;
          }
          const i3 = i * 3;
          const px = this.pos[i3];
          const py = clamp(this.pos[i3 + 1], LEG_Y_BOT + 0.008, LEG_Y_TOP - 0.008);
          const pz = this.pos[i3 + 2];
          this.pos[i3 + 1] = py;

          const t = legTFromY(py);
          const { cx, cz } = getLegCenter(this.side, t);
          const dx = px - cx, dz = pz - cz;
          const r = Math.hypot(dx, dz) || 0.0001;
          const angle = Math.atan2(dz, dx);
          const minR = getLegSkinRadius(this.side, t, angle) + this.radialOffset;

          if (r < minR) {
            const sc = minR / r;
            this.pos[i3] = cx + dx * sc;
            this.pos[i3 + 2] = cz + dz * sc;
            this.nodeLift[i] = 0;
          } else {
            this.nodeLift[i] = r - minR;
          }
        }
      }

      // Dangling broken yarn stubs physics
      for (let i = 0; i < this.danglingStubs.length; i++) {
        const st = this.danglingStubs[i];
        const a3 = st.anchor * 3;
        const ax = this.pos[a3], ay = this.pos[a3 + 1], az = this.pos[a3 + 2];

        const mvx = (st.mx - st.pmx) * 0.86, mvy = (st.my - st.pmy) * 0.86, mvz = (st.mz - st.pmz) * 0.86;
        st.pmx = st.mx; st.pmy = st.my; st.pmz = st.mz;
        st.mx += mvx + st.curlX; st.my += mvy - 0.00062; st.mz += mvz + st.curlZ;

        const tvx = (st.tx - st.ptx) * 0.84, tvy = (st.ty - st.pty) * 0.84, tvz = (st.tz - st.ptz) * 0.84;
        st.ptx = st.tx; st.pty = st.ty; st.ptz = st.tz;
        st.tx += tvx + st.curlX * 1.4; st.ty += tvy - 0.00068; st.tz += tvz + st.curlZ * 1.4;

        for (let it = 0; it < 2; it++) {
          let dx = st.mx - ax, dy = st.my - ay, dz = st.mz - az;
          let d = Math.hypot(dx, dy, dz) || 0.0001;
          const sc1 = st.segLen / d;
          st.mx = ax + dx * sc1; st.my = ay + dy * sc1; st.mz = az + dz * sc1;

          dx = st.tx - st.mx; dy = st.ty - st.my; dz = st.tz - st.mz;
          d = Math.hypot(dx, dy, dz) || 0.0001;
          const sc2 = (st.segLen * 0.9) / d;
          st.tx = st.mx + dx * sc2; st.ty = st.my + dy * sc2; st.tz = st.mz + dz * sc2;
        }

        for (const pt of [[st.mx, st.my, st.mz, 0], [st.tx, st.ty, st.tz, 1]]) {
          const t = legTFromY(pt[1]);
          const { cx, cz } = getLegCenter(this.side, t);
          const dx = pt[0] - cx, dz = pt[2] - cz;
          const r = Math.hypot(dx, dz) || 0.0001;
          const minR = getLegSkinRadius(this.side, t, Math.atan2(dz, dx)) + this.radialOffset;
          if (r < minR) {
            const sc = minR / r;
            if (pt[3] === 0) { st.mx = cx + dx * sc; st.mz = cz + dz * sc; }
            else             { st.tx = cx + dx * sc; st.tz = cz + dz * sc; }
          }
        }
      }

      if (newlyBroken.length > 0) {
        this.rebuildHitHull();
        this.sleepFrames = 0;
      }

      this.hullGeo.attributes.position.needsUpdate = true;

      if (activeGrabs.length === 0 && maxMotionSq < 1e-10) {
        this.sleepFrames++;
        if (this.sleepFrames > 65) this.isAwake = false;
      } else {
        this.sleepFrames = 0;
      }

      return { peakTensionRatio, newlyBroken };
    }

    breakStrand(sIdx, newlyBrokenList) {
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

      const recoil = 0.0068;
      if (!this.pinned[a]) {
        this.pos[a3] -= ux * recoil; this.pos[a3 + 1] -= uy * recoil; this.pos[a3 + 2] -= uz * recoil;
      }
      if (!this.pinned[b]) {
        this.pos[b3] += ux * recoil; this.pos[b3 + 1] += uy * recoil; this.pos[b3 + 2] += uz * recoil;
      }

      this.spawnDanglingStub(a, bx, by, bz, this.sInitLen[sIdx], -ux, -uy, -uz);
      this.spawnDanglingStub(b, ax, ay, az, this.sInitLen[sIdx], ux, uy, uz);

      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
      fiberDust.emit(mx, my, mz, (Math.random() - 0.5) * 0.01, 0.003, (Math.random() - 0.5) * 0.01, 2);

      const isSheer = appState.stockingType === 'sheer';
      for (const node of [a, b]) {
        const cnt = this.nodeStrandCount[node];
        for (let k = 0; k < cnt; k++) {
          const ns = this.nodeStrands[node * 4 + k];
          if (ns >= 0 && ns !== sIdx && !this.sBroken[ns]) {
            const bonus = isSheer ? 0.21 : 0.14;
            this.sNotch[ns] = Math.min(isSheer ? 0.52 : 0.42, this.sNotch[ns] + bonus);
          }
        }
      }
      if (isSheer) {
        const rA = Math.floor(a / this.NU), cA = a % this.NU;
        const rB = Math.floor(b / this.NU), cB = b % this.NU;
        if (rA > 1) {
          const upBase = ((rA - 1) * this.NU + cA) * 2;
          this.sNotch[upBase] = Math.min(0.54, this.sNotch[upBase] + 0.16);
          this.sNotch[upBase + 1] = Math.min(0.54, this.sNotch[upBase + 1] + 0.16);
        }
        if (rB < this.NV - 1) {
          const dnBase = (rB * this.NU + cB) * 2;
          this.sNotch[dnBase] = Math.min(0.54, this.sNotch[dnBase] + 0.16);
          this.sNotch[dnBase + 1] = Math.min(0.54, this.sNotch[dnBase + 1] + 0.16);
        }
      }

      newlyBrokenList.push({ x: mx, y: my, z: mz, side: this.side });
      sound.playThreadSnap(newlyBrokenList.length, isSheer);
    }

    updateVisualGeometry() {
      const isSheer = appState.stockingType === 'sheer';
      this.strandMesh.visible = !isSheer;
      this.knotMesh.visible = !isSheer;
      this.shadowMesh.visible = !isSheer;
      this.sheerMesh.visible = isSheer;
      this.sheerFrayMesh.visible = isSheer;

      const camX = camera.position.x, camY = camera.position.y, camZ = camera.position.z;
      const pos = this.pos;

      const hideQuad = (buf, qIdx) => {
        const b = qIdx * 12;
        for (let k = 0; k < 12; k++) buf[b + k] = 0;
      };

      if (isSheer) {
        const stride = this.NU + 1;
        for (let r = 0; r <= this.NV; r++) {
          for (let c = 0; c <= this.NU; c++) {
            const pi = r * this.NU + (c % this.NU);
            const vi = r * stride + c;
            const p3 = pi * 3, v3 = vi * 3;
            this.sheerPosBuf[v3]     = pos[p3];
            this.sheerPosBuf[v3 + 1] = pos[p3 + 1];
            this.sheerPosBuf[v3 + 2] = pos[p3 + 2];
            this.sheerStrainBuf[vi]  = clamp(this.nodeStrain[pi], 0, 1.2);
          }
        }
        this.sheerGeo.attributes.position.needsUpdate = true;
        this.sheerGeo.attributes.aStrain.needsUpdate = true;
        this.sheerGeo.computeVertexNormals();

        const nArr = this.sheerGeo.attributes.normal.array;
        for (let r = 0; r <= this.NV; r++) {
          const i0 = (r * stride) * 3;
          const i1 = (r * stride + this.NU) * 3;
          let nx = nArr[i0] + nArr[i1], ny = nArr[i0 + 1] + nArr[i1 + 1], nz = nArr[i0 + 2] + nArr[i1 + 2];
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          nArr[i0] = nArr[i1] = nx; nArr[i0 + 1] = nArr[i1 + 1] = ny; nArr[i0 + 2] = nArr[i1 + 2] = nz;
        }
        this.sheerGeo.attributes.normal.needsUpdate = true;

        const sfPos = this.sheerFrayPosBuf;
        const writeWisp = (qIdx, ax, ay, az, bx, by, bz, hwA, hwB) => {
          const dx = bx - ax, dy = by - ay, dz = bz - az;
          const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
          let vx = camX - mx, vy = camY - my, vz = camZ - mz;
          const vLen = Math.hypot(vx, vy, vz) || 1;
          vx /= vLen; vy /= vLen; vz /= vLen;
          let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
          const sLen = Math.hypot(sx, sy, sz) || 1;
          sx /= sLen; sy /= sLen; sz /= sLen;
          const b = qIdx * 12;
          sfPos[b]     = ax - sx * hwA; sfPos[b + 1]  = ay - sy * hwA; sfPos[b + 2]  = az - sz * hwA;
          sfPos[b + 3] = ax + sx * hwA; sfPos[b + 4]  = ay + sy * hwA; sfPos[b + 5]  = az + sz * hwA;
          sfPos[b + 6] = bx - sx * hwB; sfPos[b + 7]  = by - sy * hwB; sfPos[b + 8]  = bz - sz * hwB;
          sfPos[b + 9] = bx + sx * hwB; sfPos[b + 10] = by + sy * hwB; sfPos[b + 11] = bz + sz * hwB;
        };

        let fq = 0;
        const wispW = 0.00055;
        for (let i = 0; i < this.danglingStubs.length; i++) {
          const st = this.danglingStubs[i];
          if (this.intactDegree[st.anchor] === 0) continue;
          const a3 = st.anchor * 3;
          const ax = pos[a3], ay = pos[a3 + 1], az = pos[a3 + 2];
          if (fq + 1 < this.maxDangleQuads) {
            writeWisp(fq++, ax, ay, az, st.mx, st.my, st.mz, wispW, wispW * 0.65);
            writeWisp(fq++, st.mx, st.my, st.mz, st.tx, st.ty, st.tz, wispW * 0.65, wispW * 0.20);
          }
        }
        while (fq < this.maxDangleQuads) hideQuad(sfPos, fq++);
        this.sheerFrayGeo.attributes.position.needsUpdate = true;
        return;
      }

      const sPos = this.sPosBuf, sNorm = this.sNormBuf, sCol = this.sColBuf, shPos = this.shPosBuf;

      const writeCordQuad = (qIdx, ax, ay, az, bx, by, bz, hwA, hwB, strain, isStub = false) => {
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
        let vx = camX - mx, vy = camY - my, vz = camZ - mz;
        const vLen = Math.hypot(vx, vy, vz) || 1;
        vx /= vLen; vy /= vLen; vz /= vLen;

        let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
        const sLen = Math.hypot(sx, sy, sz) || 1;
        sx /= sLen; sy /= sLen; sz /= sLen;

        const vBase = qIdx * 12;
        sPos[vBase]     = ax - sx * hwA; sPos[vBase + 1]  = ay - sy * hwA; sPos[vBase + 2]  = az - sz * hwA;
        sPos[vBase + 3] = ax + sx * hwA; sPos[vBase + 4]  = ay + sy * hwA; sPos[vBase + 5]  = az + sz * hwA;
        sPos[vBase + 6] = bx - sx * hwB; sPos[vBase + 7]  = by - sy * hwB; sPos[vBase + 8]  = bz - sz * hwB;
        sPos[vBase + 9] = bx + sx * hwB; sPos[vBase + 10] = by + sy * hwB; sPos[vBase + 11] = bz + sz * hwB;

        const nLx = -sx * 0.62 + vx * 0.78, nLy = -sy * 0.62 + vy * 0.78, nLz = -sz * 0.62 + vz * 0.78;
        const nRx =  sx * 0.62 + vx * 0.78, nRy =  sy * 0.62 + vy * 0.78, nRz =  sz * 0.62 + vz * 0.78;
        sNorm[vBase]     = nLx; sNorm[vBase + 1]  = nLy; sNorm[vBase + 2]  = nLz;
        sNorm[vBase + 3] = nRx; sNorm[vBase + 4]  = nRy; sNorm[vBase + 5]  = nRz;
        sNorm[vBase + 6] = nLx; sNorm[vBase + 7]  = nLy; sNorm[vBase + 8]  = nLz;
        sNorm[vBase + 9] = nRx; sNorm[vBase + 10] = nRy; sNorm[vBase + 11] = nRz;

        const st = clamp(strain, 0, 1.15);
        let cr = 1.0 + st * 0.28, cg = 1.0 + st * 0.24, cb = 1.0 + st * 0.28;
        if (!isStub && st > 0.80) {
          const warn = (st - 0.80) * 1.4;
          cr += warn * 0.45; cg += warn * 0.10;
        }
        for (let k = 0; k < 4; k++) {
          sCol[vBase + k * 3] = cr; sCol[vBase + k * 3 + 1] = cg; sCol[vBase + k * 3 + 2] = cb;
        }
      };

      for (let s = 0; s < this.numStrands; s++) {
        if (this.sBroken[s]) {
          hideQuad(sPos, s);
          hideQuad(shPos, s);
          continue;
        }
        const a = this.sA[s], b = this.sB[s];
        const a3 = a * 3, b3 = b * 3;
        const ax = pos[a3], ay = pos[a3 + 1], az = pos[a3 + 2];
        const bx = pos[b3], by = pos[b3 + 1], bz = pos[b3 + 2];

        const st = this.sStrain[s];
        const hw = this.baseHalfWidth / (1.0 + st * 0.28);
        writeCordQuad(s, ax, ay, az, bx, by, bz, hw, hw, st, false);

        const avgLift = (this.nodeLift[a] + this.nodeLift[b]) * 0.5;
        if (avgLift < 0.024) {
          const fade = 1.0 - avgLift / 0.024;
          const shW = this.baseHalfWidth * (1.85 + avgLift * 52) * fade;
          const tA = legTFromY(ay), tB = legTFromY(by);
          const cA = getLegCenter(this.side, tA), cB = getLegCenter(this.side, tB);
          const angA = Math.atan2(az - cA.cz, ax - cA.cx) + 0.014;
          const angB = Math.atan2(bz - cB.cz, bx - cB.cx) + 0.014;
          const profCur = getCustomLegProfile();
          const shOff = (profCur && !profCur.tightLeg) ? 0.0032 : 0.00075;
          const rA = getLegSkinRadius(this.side, tA, angA) + shOff;
          const rB = getLegSkinRadius(this.side, tB, angB) + shOff;

          const sax = cA.cx + Math.cos(angA) * rA, say = ay - 0.0012, saz = cA.cz + Math.sin(angA) * rA;
          const sbx = cB.cx + Math.cos(angB) * rB, sby = by - 0.0012, sbz = cB.cz + Math.sin(angB) * rB;

          const nx = Math.cos((angA + angB) * 0.5), nz = Math.sin((angA + angB) * 0.5);
          const sdx = sbx - sax, sdy = sby - say, sdz = sbz - saz;
          let px = sdy * nz, py = sdz * nx - sdx * nz, pz = -sdy * nx;
          const pLen = Math.hypot(px, py, pz) || 1;
          px = (px / pLen) * shW; py = (py / pLen) * shW; pz = (pz / pLen) * shW;

          const shB = s * 12;
          shPos[shB]     = sax - px; shPos[shB + 1]  = say - py; shPos[shB + 2]  = saz - pz;
          shPos[shB + 3] = sax + px; shPos[shB + 4]  = say + py; shPos[shB + 5]  = saz + pz;
          shPos[shB + 6] = sbx - px; shPos[shB + 7]  = sby - py; shPos[shB + 8]  = sbz - pz;
          shPos[shB + 9] = sbx + px; shPos[shB + 10] = sby + py; shPos[shB + 11] = sbz + pz;
        } else {
          hideQuad(shPos, s);
        }
      }

      let qCursor = this.numStrands;
      for (let i = 0; i < this.danglingStubs.length; i++) {
        const st = this.danglingStubs[i];
        if (this.intactDegree[st.anchor] === 0) continue;
        const a3 = st.anchor * 3;
        const ax = pos[a3], ay = pos[a3 + 1], az = pos[a3 + 2];
        if (qCursor + 1 < this.totalStrandQuads) {
          writeCordQuad(qCursor++, ax, ay, az, st.mx, st.my, st.mz, this.baseHalfWidth * 0.95, this.baseHalfWidth * 0.72, 0, true);
          writeCordQuad(qCursor++, st.mx, st.my, st.mz, st.tx, st.ty, st.tz, this.baseHalfWidth * 0.72, this.baseHalfWidth * 0.30, 0, true);
        }
      }
      while (qCursor < this.totalStrandQuads) hideQuad(sPos, qCursor++);

      const kPos = this.kPosBuf, kNorm = this.kNormBuf, kCol = this.kColBuf;
      const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const camFwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);

      for (let n = 0; n < this.numNodes; n++) {
        const deg = this.intactDegree[n];
        if (deg === 0) {
          hideQuad(kPos, n);
          continue;
        }
        const n3 = n * 3;
        const x = pos[n3], y = pos[n3 + 1], z = pos[n3 + 2];
        const r = this.knotRadius * (deg >= 3 ? 1.0 : 0.82);
        const rx = camRight.x * r, ry = camRight.y * r, rz = camRight.z * r;
        const ux = camUp.x * r, uy = camUp.y * r, uz = camUp.z * r;

        const b = n * 12;
        kPos[b]     = x - rx - ux; kPos[b + 1]  = y - ry - uy; kPos[b + 2]  = z - rz - uz;
        kPos[b + 3] = x + rx - ux; kPos[b + 4]  = y + ry - uy; kPos[b + 5]  = z + rz - uz;
        kPos[b + 6] = x - rx + ux; kPos[b + 7]  = y - ry + uy; kPos[b + 8]  = z - rz + uz;
        kPos[b + 9] = x + rx + ux; kPos[b + 10] = y + ry + uy; kPos[b + 11] = z + rz + uz;

        const st = clamp(this.nodeStrain[n], 0, 1);
        const tint = 1.0 + st * 0.25;
        for (let k = 0; k < 4; k++) {
          kNorm[b + k * 3] = camFwd.x; kNorm[b + k * 3 + 1] = camFwd.y; kNorm[b + k * 3 + 2] = camFwd.z;
          kCol[b + k * 3] = tint; kCol[b + k * 3 + 1] = tint; kCol[b + k * 3 + 2] = tint;
        }
      }

      this.strandGeo.attributes.position.needsUpdate = true;
      this.strandGeo.attributes.normal.needsUpdate = true;
      this.strandGeo.attributes.color.needsUpdate = true;
      this.knotGeo.attributes.position.needsUpdate = true;
      this.knotGeo.attributes.normal.needsUpdate = true;
      this.knotGeo.attributes.color.needsUpdate = true;
      this.shadowGeo.attributes.position.needsUpdate = true;
    }
  }

  const leftCloth = new DiamondFishnetStocking(-1, appState.fishnetSize);
  const rightCloth = new DiamondFishnetStocking(1, appState.fishnetSize);
  const cloths = [leftCloth, rightCloth];
  applyColorPreset();

  return { cloths, applyColorPreset };
}
