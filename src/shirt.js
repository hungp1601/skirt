import * as THREE from 'three';
import { appState } from './config.js';
import { clamp, smoothstep, getCustomLegProfile } from './math.js';
import {
  createSchoolShirtTexture,
  createSailorCollarTexture,
  createSailorSleeveTexture,
  createCottonWeaveMaps,
  createWoolTwillMaps,
  createTornClothEdgeTexture
} from './textures.js';
import { sound } from './audio.js';

// =========================================================================
// TAILORED & TEARABLE JAPANESE SCHOOLGIRL SAILOR BLOUSE
// - Thân áo cotton trắng ôm gọn vòng 1 & thắt eo (sơ vin gọn bên trong cạp váy, không xuyên áo lót)
// - Cổ áo thủy thủ 3D tách lớp xanh than viền 2 sọc trắng (chữ V trước ngực + tà vuông sau lưng)
// - Tay áo ngắn thủy thủ ôm sát 2 bắp tay trên theo trục 3D thật, viền cổ tay xanh than sọc trắng
// - Nơ ruy-băng đỏ satin 3D gắn nổi chính giữa đỉnh chữ V, kéo giãn & xé rách hoàn toàn
// =========================================================================
export class TearableSchoolShirt {
  constructor(scene, fiberDust) {
    this.scene = scene;
    this.fiberDust = fiberDust;
    this.isShirt = true;
    this.side = 0;

    const prof = getCustomLegProfile();
    this.shirtProfile = prof ? prof.shirtProfile : null;
    this.armTubes = prof && prof.armTubes ? prof.armTubes : [];
    this.sleeveProfiles = prof && prof.sleeveProfiles ? prof.sleeveProfiles : [];

    this.NU = 76;
    this.NV = 28;
    this.yTop = this.shirtProfile ? this.shirtProfile.yTop : 2.26;
    this.yBot = this.shirtProfile ? this.shirtProfile.yBot : 1.78;
    this.frontTheta = (this.shirtProfile && this.shirtProfile.frontTheta !== undefined)
      ? this.shirtProfile.frontTheta
      : Math.PI * 0.5;
    this.thetaOffset = this.frontTheta - Math.PI * 0.5;

    const cottonMaps = createCottonWeaveMaps();
    const woolMaps = createWoolTwillMaps();
    const tornTex = createTornClothEdgeTexture('#f1f4fa', '#ffffff');

    this.shirtMaterial = new THREE.MeshPhysicalMaterial({
      map: createSchoolShirtTexture(),
      normalMap: cottonMaps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: cottonMaps.roughnessMap,
      roughness: 0.92,
      metalness: 0.0,
      sheen: 0.14,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0xf8fafc),
      envMapIntensity: 0.34,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });

    this.collarMaterial = new THREE.MeshPhysicalMaterial({
      map: createSailorCollarTexture(),
      normalMap: woolMaps.normalMap,
      normalScale: new THREE.Vector2(0.50, 0.50),
      roughnessMap: woolMaps.roughnessMap,
      roughness: 0.92,
      metalness: 0.0,
      sheen: 0.16,
      sheenRoughness: 0.82,
      sheenColor: new THREE.Color(0x475569),
      envMapIntensity: 0.32,
      side: THREE.DoubleSide
    });

    this.sleeveMaterial = new THREE.MeshPhysicalMaterial({
      map: createSailorSleeveTexture(),
      normalMap: cottonMaps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: cottonMaps.roughnessMap,
      roughness: 0.92,
      metalness: 0.0,
      sheen: 0.14,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0xf8fafc),
      envMapIntensity: 0.34,
      side: THREE.DoubleSide
    });

    this.tornEdgeMaterial = new THREE.MeshStandardMaterial({
      map: tornTex.map,
      alphaMap: tornTex.alphaMap,
      normalMap: cottonMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
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
    this.mesh = new THREE.Mesh(this.geo, this.shirtMaterial);
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

    // Cổ áo thủy thủ 3D tách lớp + 2 tay áo ngắn thủy thủ + nơ satin đỏ 3D
    this.collarMesh = this.buildSailorCollar3D();
    scene.add(this.collarMesh);

    this.sleevesGroup = this.buildSailorSleeves3D();
    scene.add(this.sleevesGroup);

    this.bowGroup = this.createRibbonBow3D();
    scene.add(this.bowGroup);
    this.bowAnchorNode = Math.round(this.NV * 0.04) * this.NU + Math.round(this.NU * 0.25);
    this.bowRipped = false;
    this.bowPieces = null;
    this.collarHidden = false;
    this.tagCloth(this.mesh, {});
    this.tagCloth(this.collarMesh, { isCollar: true });
    this.tagCloth(this.sleevesGroup, { isSleeve: true });
    this.tagCloth(this.bowGroup, { isBow: true });

    this.rebuildIndices();
    this.updateVisualGeometry();
    this.geo.computeBoundingSphere();
  }

  // Tính khoảng đệm tailored theo chiều cao vDown (ôm vòng 1 thoáng không xuyên bra, thon gọn vào cạp váy ở eo)
  getBlouseEase(vDown) {
    const bustZone = smoothstep(0.06, 0.24, vDown) * (1 - smoothstep(0.60, 0.84, vDown));
    const waistTuck = smoothstep(0.76, 1.0, vDown);
    return 0.0085 + bustZone * 0.0065 - waistTuck * 0.0038;
  }

  // Tính độ khoét cổ áo mượt mà theo u (u=0.25 là cổ chữ V sắc nét trước ngực, u=0.75 là sau gáy, hai vai cao phủ kín dây áo)
  getNeckDip(u) {
    let dFront = Math.abs(u - 0.25);
    if (dFront > 0.5) dFront = 1.0 - dFront;
    const vNorm = clamp(1.0 - dFront / 0.145, 0, 1);
    const vNeckDip = (vNorm * 0.65 + smoothstep(0, 1, vNorm) * 0.35) * 0.142;

    let dBack = Math.abs(u - 0.75);
    if (dBack > 0.5) dBack = 1.0 - dBack;
    const backScoop = smoothstep(0.16, 0.0, dBack) * 0.032;
    return vNeckDip + backScoop;
  }

  // Cổ áo thủy thủ 3D tách lớp nằm nổi +5mm trên vai, ngực chữ V và tà vuông sau lưng
  buildSailorCollar3D() {
    const segU = 84, segV = 12;
    const spanY = Math.max(0.05, this.yTop - this.yBot);
    const verts = [], uvs = [], indices = [];

    for (let iv = 0; iv <= segV; iv++) {
      const f = iv / segV; // 0 = viền sát cổ -> 1 = mép dưới cổ thủy thủ có 2 sọc trắng
      for (let iu = 0; iu <= segU; iu++) {
        const u = (iu % segU) / segU;
        const theta = u * Math.PI * 2 + this.thetaOffset;

        let dFront = Math.abs(u - 0.25);
        if (dFront > 0.5) dFront = 1.0 - dFront;
        let dBack = Math.abs(u - 0.75);
        if (dBack > 0.5) dBack = 1.0 - dBack;

        // Độ rủ dài của cổ áo thủy thủ: sâu ở tà vuông sau lưng (~17cm), ôm vát hình chữ V sắc nét phía trước (~8.5cm)
        const backFlap = (1 - smoothstep(0.145, 0.195, dBack));
        const frontV = Math.max(0, 1.0 - dFront / 0.17);
        const dropLen = 0.072 + backFlap * 0.098 + frontV * 0.025;

        const topY = this.yTop - this.getNeckDip(u) + 0.004;
        const y = topY - f * dropLen;
        const vBody = clamp((this.yTop - y) / spanY, 0, 1);

        const { cx, cz, r: bodyR } = this.sampleTorsoRadius(vBody, theta);
        // Cổ áo nổi tách lớp 5.5mm..11mm bên ngoài thân áo để có độ dày & bóng đổ 3D thật
        const blouseR = bodyR + this.getBlouseEase(vBody);
        const lift = 0.0045 + Math.pow(f, 0.85) * 0.0075 + backFlap * f * 0.005;
        const rad = blouseR + lift;

        verts.push(cx + Math.cos(theta) * rad, y, cz + Math.sin(theta) * rad);
        uvs.push(iu / segU * 2, 1.0 - f);
      }
    }

    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.collarMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  // Hai tay áo ngắn thủy thủ ôm sát bao 3D vai + bắp tay thật từ GLB (phủ kín chỏm vai & dây áo lót, không bao giờ xuyên da!)
  buildSailorSleeves3D() {
    const group = new THREE.Group();
    if (!this.sleeveProfiles || this.sleeveProfiles.length < 2) return group;

    const segV = 22, segU = 40;
    const shCenter = this.sampleTorsoRadius(0.03, 0);

    for (let k = 0; k < 2; k++) {
      const sp = this.sleeveProfiles[k];
      const { yTop, yBot, NS, NA, cxArr, czArr, radArr } = sp;
      const verts = [], uvs = [], indices = [];

      const sampleSleeveR = (f, th) => {
        const sf = clamp(f, 0, 1) * (NS - 1);
        const s0 = Math.floor(sf), s1 = Math.min(NS - 1, s0 + 1), st = sf - s0;
        const cx = cxArr[s0] * (1 - st) + cxArr[s1] * st;
        const cz = czArr[s0] * (1 - st) + czArr[s1] * st;
        let ang = th % (Math.PI * 2); if (ang < 0) ang += Math.PI * 2;
        const af = (ang / (Math.PI * 2)) * NA;
        const a0 = Math.floor(af) % NA, a1 = (a0 + 1) % NA, at = af - Math.floor(af);
        const r0 = radArr[s0 * NA + a0] * (1 - at) + radArr[s0 * NA + a1] * at;
        const r1 = radArr[s1 * NA + a0] * (1 - at) + radArr[s1 * NA + a1] * at;
        return { cx, cz, r: r0 + (r1 - r0) * st };
      };

      for (let iv = 0; iv <= segV; iv++) {
        const f = iv / segV; // 0 = đỉnh chỏm vai -> 1 = cửa tay áo viền xanh than
        const y = (yTop + 0.014) - f * ((yTop + 0.014) - yBot);
        // Chỏm trên bo tròn mềm mượt khép kín (không lộ vòng phẳng khi nhìn thẳng từ trên xuống)
        const capRound = f < 0.16 ? (0.16 + 0.84 * Math.sin((f / 0.16) * Math.PI * 0.5)) : 1.0;
        const cuffFlare = Math.pow(Math.max(0, f - 0.30) / 0.70, 1.2) * 0.0075;
        const ease = 0.0095 + cuffFlare;

        for (let iu = 0; iu <= segU; iu++) {
          const u = iu / segU;
          const th = u * Math.PI * 2;
          const sInfo = sampleSleeveR(f, th);
          const rad = (sInfo.r + ease) * capRound;
          const pullIn = f < 0.16 ? (1 - f / 0.16) * 0.16 : 0;
          const cx = sInfo.cx + (shCenter.cx - sInfo.cx) * pullIn;
          const cz = sInfo.cz + (shCenter.cz - sInfo.cz) * pullIn;
          verts.push(cx + Math.cos(th) * rad, y, cz + Math.sin(th) * rad);
          uvs.push(u, 1.0 - f);
        }
      }

      const stride = segU + 1;
      for (let iv = 0; iv < segV; iv++) {
        for (let iu = 0; iu < segU; iu++) {
          const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
          indices.push(a, b, c, b, d, c);
        }
      }

      // Đóng kín đỉnh chỏm vai bằng 1 đỉnh tròn mượt (hướng normal lên trên +Y)
      const topCapIdx = verts.length / 3;
      const topCx = cxArr[0] + (shCenter.cx - cxArr[0]) * 0.22;
      const topCz = czArr[0] + (shCenter.cz - czArr[0]) * 0.22;
      verts.push(topCx, yTop + 0.0155, topCz);
      uvs.push(0.5, 1.0);
      for (let iu = 0; iu < segU; iu++) {
        indices.push(topCapIdx, iu, iu + 1);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, this.sleeveMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    return group;
  }

  // Nơ ruy-băng đỏ satin 3D mềm mại, tạo khối đẹp & đuôi vát chữ V sắc nét
  createRibbonBow3D() {
    const g = new THREE.Group();
    const ribMat = new THREE.MeshPhysicalMaterial({
      color: 0xb91c3a,
      roughness: 0.36,
      metalness: 0.04,
      sheen: 0.85,
      sheenRoughness: 0.32,
      sheenColor: new THREE.Color(0xfda4af),
      side: THREE.DoubleSide
    });

    // Nút thắt giữa bo tròn mềm mại
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), ribMat);
    knot.scale.set(1.05, 0.92, 0.65);
    g.add(knot);

    // Hai cánh nơ phồng mềm kiểu ruy-băng lụa
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.028, 18, 14), ribMat);
      wing.scale.set(1.42, 0.64, 0.34);
      wing.position.set(s * 0.032, -0.002, 0.002);
      wing.rotation.z = s * -0.16;
      wing.rotation.y = s * -0.22;
      g.add(wing);

      // Đuôi ruy-băng có cắt đuôi én chữ V tinh tế
      const tailShape = new THREE.Shape();
      tailShape.moveTo(-0.011, 0);
      tailShape.lineTo(0.011, 0);
      tailShape.lineTo(0.015, -0.105);
      tailShape.lineTo(0.0, -0.092);
      tailShape.lineTo(-0.015, -0.105);
      tailShape.closePath();
      const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), ribMat);
      tail.position.set(s * 0.016, -0.008, 0.011);
      tail.rotation.z = s * 0.18;
      tail.rotation.x = -0.34;
      g.add(tail);
    }

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  pIdx(r, c) {
    return r * this.NU + ((c % this.NU + this.NU) % this.NU);
  }

  // Nội suy tâm & bán kính thân trên 360° theo chiều cao vDown (0 = cổ vai, 1 = gấu áo ngang eo)
  sampleTorsoRadius(vDown, theta) {
    const sp = this.shirtProfile;
    if (sp && sp.radArr) {
      const { NS, NA, cxArr, czArr, radArr } = sp;
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
      return { cx, cz, r: Math.max(0.06, r0 * (1 - st) + r1 * st) };
    }
    const bust = Math.exp(-Math.pow((vDown - 0.35) / 0.24, 2));
    const rx = 0.145 + bust * 0.032;
    const rz = 0.105 + bust * 0.055 * Math.max(0, Math.sin(theta));
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const r = Math.hypot(cosT * rx, sinT * rz);
    return { cx: 0, cz: 0, r };
  }

  initParticlesAndSprings() {
    const prof = getCustomLegProfile();
    const armLimitFn = prof && prof.maxRadiusBeforeArms ? prof.maxRadiusBeforeArms : null;
    const spanY = Math.max(0.05, this.yTop - this.yBot);

    for (let r = 0; r <= this.NV; r++) {
      const vDown = r / this.NV; // 0 = viền cổ vai -> 1 = gấu áo sơ vin gọn ở eo
      const vTex = 1.0 - vDown;

      for (let c = 0; c < this.NU; c++) {
        const u = c / this.NU;
        const theta = u * Math.PI * 2 + this.thetaOffset;

        const topY = this.yTop - this.getNeckDip(u);
        const y = topY - vDown * (topY - this.yBot);
        const vBody = clamp((this.yTop - y) / spanY, 0, 1);

        const { cx, cz, r: bodyR } = this.sampleTorsoRadius(vBody, theta);
        const ease = this.getBlouseEase(vBody);
        const drape = Math.sin(theta * 10) * 0.0014 * vDown;
        let rad = bodyR + ease + drape;
        if (armLimitFn && vBody > 0.35) {
          const lim = armLimitFn(cx, cz, y, theta, 0.004);
          // Không bao giờ ép lún vải vào trong thân/ngực
          rad = Math.min(rad, Math.max(bodyR + 0.0055, lim));
        }
        const x = cx + Math.cos(theta) * rad;
        const z = cz + Math.sin(theta) * rad;

        const i = r * this.NU + c;
        const i3 = i * 3;
        this.pos[i3] = this.prevPos[i3] = this.restPos[i3] = x;
        this.pos[i3 + 1] = this.prevPos[i3 + 1] = this.restPos[i3 + 1] = y;
        this.pos[i3 + 2] = this.prevPos[i3 + 2] = this.restPos[i3 + 2] = z;
        // Ghim viền cổ/vai (r === 0) để áo luôn giữ form cân đối, toàn bộ thân áo kéo & xé tự do
        this.pinned[i] = r === 0 ? 1 : 0;
      }

      for (let c = 0; c <= this.NU; c++) {
        const vi = r * (this.NU + 1) + c;
        this.renderUVs[vi * 2] = c / this.NU;
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
    this.collarHidden = false;
    if (this.collarMesh) this.collarMesh.visible = true;
    if (this.sleevesGroup) {
      this.sleevesGroup.visible = true;
      this.sleevesGroup.traverse(o => { if (o.isMesh) o.visible = true; });
    }
    if (this.bowRipped) {
      for (const p of this.bowPieces || []) this.scene.remove(p.mesh);
      this.bowPieces = null;
      this.bowRipped = false;
      this.scene.remove(this.bowGroup);
      this.bowGroup = this.createRibbonBow3D();
      this.tagCloth(this.bowGroup, { isBow: true });
      this.scene.add(this.bowGroup);
    } else if (this.bowGroup) {
      this.bowGroup.visible = true;
    }
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
    // Cắt luôn lò xo chéo băng qua ô vải rách để 2 mép vải tách rời hẳn như vải cotton thật (không bị mạng nhện kiểu tất!)
    const ds = this.diagSpring[ci];
    if (ds >= 0 && !this.sBroken[ds]) {
      this.sBroken[ds] = 1;
      this.intactDegree[this.sA[ds]] = Math.max(0, this.intactDegree[this.sA[ds]] - 1);
      this.intactDegree[this.sB[ds]] = Math.max(0, this.intactDegree[this.sB[ds]] - 1);
    }
  }

  rebuildIndices() {
    // Dọn các ô tam giác mồ côi bị cô lập (rách >= 3 cạnh xung quanh) để vết rách liền mạch thành vạt vải thật
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

        // Vát chéo góc ô vải tiếp giáp 2 cạnh rách để vết xé áo cotton tự nhiên không bị ô vuông 90°!
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

    // Phản lực tách hai mép vải rách dứt khoát (tạo cảm giác xé vải cotton)
    const recoil = 0.009;
    if (!this.pinned[a]) {
      this.pos[a3] -= ux * recoil; this.pos[a3 + 1] -= uy * recoil; this.pos[a3 + 2] -= uz * recoil;
    }
    if (!this.pinned[b]) {
      this.pos[b3] += ux * recoil; this.pos[b3 + 1] += uy * recoil; this.pos[b3 + 2] += uz * recoil;
    }

    const r = Math.floor(a / this.NU), c = a % this.NU;
    if (this.sType[sIdx] === 0) {
      // Đứt sợi ngang -> tách ô trên/dưới và lan dọc theo đường rách thẳng đứng của thớ vải cotton
      if (r < this.NV) this.tearCell(r, c);
      if (r > 0) this.tearCell(r - 1, c);
      if (r > 1) this.sNotch[this.horizSpring[(r - 1) * this.NU + c]] = Math.min(0.65, this.sNotch[this.horizSpring[(r - 1) * this.NU + c]] + 0.36);
      if (r < this.NV) this.sNotch[this.horizSpring[(r + 1) * this.NU + c]] = Math.min(0.65, this.sNotch[this.horizSpring[(r + 1) * this.NU + c]] + 0.36);
    } else if (this.sType[sIdx] === 1) {
      // Đứt sợi dọc -> tách ô trái/phải và lan ngang theo sợi dệt ngang
      const cL = (c - 1 + this.NU) % this.NU, cR = (c + 1) % this.NU;
      this.tearCell(r, c);
      this.tearCell(r, cL);
      if (r < this.NV) {
        this.sNotch[this.vertSpring[r * this.NU + cL]] = Math.min(0.60, this.sNotch[this.vertSpring[r * this.NU + cL]] + 0.32);
        this.sNotch[this.vertSpring[r * this.NU + cR]] = Math.min(0.60, this.sNotch[this.vertSpring[r * this.NU + cR]] + 0.32);
      }
    }

    const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
    this.fiberDust.emit(mx, my, mz, (Math.random() - 0.5) * 0.015, 0.003, (Math.random() - 0.5) * 0.015, 3);
    newlyBroken.push({ x: mx, y: my, z: mz, side: 0, isShirt: true });
    sound.playClothRip(newlyBroken.length, false);
  }

  tagCloth(root, extra) {
    if (!root) return;
    root.traverse(o => {
      if (!o.isMesh) return;
      o.userData.cloth = this;
      if (extra) Object.assign(o.userData, extra);
    });
  }

  getPickMeshes() {
    const out = [];
    const add = (root) => {
      if (!root) return;
      root.traverse(o => { if (o.isMesh && o.visible) out.push(o); });
    };
    add(this.mesh);
    add(this.collarMesh);
    add(this.sleevesGroup);
    if (!this.bowRipped) add(this.bowGroup);
    return out;
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

  // Xé một mảng vải lớn quanh nút bị túm (ô elip), không chỉ đứt từng sợi một
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
    if (opened > 0) this.rebuildIndices();
    return opened;
  }

  ripBow() {
    if (this.bowRipped || !this.bowGroup) return;
    this.bowRipped = true;
    this.bowGroup.updateWorldMatrix(true, true);
    this.bowPieces = [];
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScl = new THREE.Vector3();
    const origin = new THREE.Vector3();
    this.bowGroup.getWorldPosition(origin);
    for (const child of [...this.bowGroup.children]) {
      child.updateWorldMatrix(true, false);
      child.matrixWorld.decompose(worldPos, worldQuat, worldScl);
      this.bowGroup.remove(child);
      this.scene.add(child);
      child.position.copy(worldPos);
      child.quaternion.copy(worldQuat);
      child.scale.copy(worldScl);
      const away = worldPos.clone().sub(origin);
      away.y = Math.abs(away.y) + 0.015;
      if (away.lengthSq() < 1e-8) away.set(Math.random() - 0.5, 0.02, 0.02);
      this.bowPieces.push({
        mesh: child,
        vel: away.normalize().multiplyScalar(0.007 + Math.random() * 0.007),
        spin: (Math.random() - 0.5) * 0.18
      });
    }
    this.bowGroup.visible = false;
  }

  consumePullTear(activeGrabs, newlyBroken) {
    let pullDist = 0;
    let center = -1;
    let ripBow = false;
    let hideCollar = false;
    let sleeveMesh = null;
    for (let g = 0; g < activeGrabs.length; g++) {
      const grab = activeGrabs[g];
      if (grab.cloth !== this || !grab.startPoint) continue;
      const d = grab.target.distanceTo(grab.startPoint);
      if (d < pullDist) continue;
      pullDist = d;
      ripBow = !!grab.ripBow;
      hideCollar = !!grab.hideCollar;
      sleeveMesh = grab.sleeveMesh || null;
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
    if (sleeveMesh && pullDist >= tearDist) sleeveMesh.visible = false;
    if (pullDist < tearDist) return;
    if (center < 0 && (ripBow || hideCollar)) center = this.bowAnchorNode;
    if (center < 0) return;

    const reach = clamp((pullDist - tearDist) / 0.10, 0, 1);
    const radC = 6 + Math.round(reach * 8);
    const radR = 5 + Math.round(reach * 6);
    const opened = this.tearPatch(center, radC, radR);

    const br = Math.floor(this.bowAnchorNode / this.NU);
    const bc = this.bowAnchorNode % this.NU;
    const cr = Math.floor(center / this.NU);
    let dcBow = Math.abs(bc - (center % this.NU));
    if (dcBow > this.NU / 2) dcBow = this.NU - dcBow;
    if (ripBow || (Math.abs(br - cr) <= radR && dcBow <= radC)) this.ripBow();
    if ((hideCollar || cr <= 10) && this.collarMesh) {
      this.collarMesh.visible = false;
      this.collarHidden = true;
    }

    if (opened > 0) {
      const i3 = center * 3;
      this.fiberDust.emit(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2], (Math.random() - 0.5) * 0.02, 0.004, (Math.random() - 0.5) * 0.02, 8);
      sound.playClothRip(4, false);
      newlyBroken.push({ x: this.pos[i3], y: this.pos[i3 + 1], z: this.pos[i3 + 2], side: 0, isShirt: true });
    }
  }

  stepPhysics(activeGrabs) {
    if (!this.isAwake && activeGrabs.length === 0) {
      return { peakTensionRatio: 0, newlyBroken: [] };
    }

    const damping = 0.87;
    const gravity = -0.00044;
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
      const formMem = torn ? 0.0 : 0.036;
      const gMult = torn ? 1.55 : 0.35;
      this.pos[i3]     = x + vx + (this.restPos[i3] - x) * formMem;
      this.pos[i3 + 1] = y + vy + gravity * gMult + (this.restPos[i3 + 1] - y) * formMem;
      this.pos[i3 + 2] = z + vz + (this.restPos[i3 + 2] - z) * formMem;
    }

    const pullStiff = 0.42 * appState.pullPower;
    for (let gIdx = 0; gIdx < activeGrabs.length; gIdx++) {
      const grab = activeGrabs[gIdx];
      if (grab.cloth !== this) continue;
      const tx = grab.target.x, ty = grab.target.y, tz = grab.target.z;
      for (let k = 0; k < grab.nodes.length; k++) {
        const item = grab.nodes[k];
        if (this.intactDegree[item.idx] === 0) continue;
        const i3 = item.idx * 3;
        const pull = Math.min(0.74, item.weight * pullStiff);
        this.pos[i3]     += (tx + item.ox - this.pos[i3]) * pull;
        this.pos[i3 + 1] += (ty + item.oy - this.pos[i3 + 1]) * pull;
        this.pos[i3 + 2] += (tz + item.oz - this.pos[i3 + 2]) * pull;
      }
    }

    // Vải cotton poplin ít co giãn hơn tất nilon nhiều -> căng vừa là rách dứt khoát thành vạt vải!
    const baseThresh = Math.max(1.24, appState.strength * 0.58);
    let peakTensionRatio = 0;
    const newlyBroken = [];
    this.consumePullTear(activeGrabs, newlyBroken);
    const maxBreaks = 6;
    const spanY = Math.max(0.05, this.yTop - this.yBot);

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
        const stiff = this.sType[s] === 2 ? 0.42 : 0.88;
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

      // Va chạm 360° với thân trên GLB (giữ áo luôn bên ngoài vòng 1 & da, không bao giờ xuyên áo lót!)
      for (let i = 0; i < this.numNodes; i++) {
        if (this.pinned[i]) continue;
        const i3 = i * 3;
        const px = this.pos[i3];
        const py = clamp(this.pos[i3 + 1], this.yBot - 0.14, this.yTop + 0.015);
        const pz = this.pos[i3 + 2];
        this.pos[i3 + 1] = py;

        const vFrac = clamp((this.yTop - py) / spanY, 0, 1);
        const sp = this.shirtProfile;
        const thetaEst = Math.atan2(pz - (sp ? sp.cz : 0), px - (sp ? sp.cx : 0));
        const surf = this.sampleTorsoRadius(vFrac, thetaEst);
        const dx = px - surf.cx, dz = pz - surf.cz;
        const theta = Math.atan2(dz, dx);
        const surfExact = this.sampleTorsoRadius(vFrac, theta);
        const r = Math.hypot(dx, dz) || 0.0001;
        const minR = surfExact.r + Math.max(0.0042, this.getBlouseEase(vFrac) * 0.85);
        if (r < minR) {
          const sc = minR / r;
          this.pos[i3] = surfExact.cx + dx * sc;
          this.pos[i3 + 2] = surfExact.cz + dz * sc;
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

    if (this.bowPieces) {
      for (let i = 0; i < this.bowPieces.length; i++) {
        const p = this.bowPieces[i];
        if (p.vel.x === 0 && p.vel.y === 0 && p.vel.z === 0) continue;
        p.vel.y -= 0.0007;
        p.mesh.position.add(p.vel);
        p.mesh.rotation.z += p.spin;
        if (p.mesh.position.y < 0.015) {
          p.mesh.position.y = 0.015;
          p.vel.set(0, 0, 0);
        }
      }
    }

    // Cập nhật vị trí nơ đỏ 3D ngay đỉnh chữ V (nổi hẳn ngoài bề mặt cổ áo thủy thủ, không bị lún vào ngực)
    if (this.bowGroup && !this.bowRipped) {
      const a = this.bowAnchorNode;
      if (this.intactDegree[a] <= 1) {
        this.bowGroup.visible = false;
      } else {
        this.bowGroup.visible = true;
        const a3 = a * 3;
        const bx = this.pos[a3], by = this.pos[a3 + 1], bz = this.pos[a3 + 2];
        const fx = Math.cos(this.frontTheta), fz = Math.sin(this.frontTheta);
        this.bowGroup.position.set(bx + fx * 0.019, by - 0.006, bz + fz * 0.019);
        this.bowGroup.up.set(0, 1, 0);
        this.bowGroup.lookAt(bx + fx * 1.0, by - 0.020, bz + fz * 1.0);
      }
    }

    // Ẩn cổ áo nếu phần trên của áo bị xé rách nặng
    if (this.collarMesh) {
      this.collarMesh.visible = !this.collarHidden && this.brokenStrands < this.numStrands * 0.18;
    }

    // Tạo dải mép vải cotton rách nham nhở (ragged woven cloth fringe) dọc chu vi vết xé — KHÔNG còn sợi kẻ mảnh như tất!
    if (this.brokenStrands > 0) {
      const ePos = [], eUV = [], eIdx = [];
      let vCursor = 0;
      const sp = this.shirtProfile;
      const bodyCx = sp ? sp.cx : 0, bodyCz = sp ? sp.cz : 0;
      const pushRaggedEdge = (iA, iB, iOppA, iOppB, seedPhase) => {
        const a3 = iA * 3, b3 = iB * 3, oa3 = iOppA * 3, ob3 = iOppB * 3;
        const ax = this.pos[a3], ay = this.pos[a3 + 1], az = this.pos[a3 + 2];
        const bx = this.pos[b3], by = this.pos[b3 + 1], bz = this.pos[b3 + 2];
        let oxA = ax - this.pos[oa3], oyA = ay - this.pos[oa3 + 1], ozA = az - this.pos[oa3 + 2];
        let oxB = bx - this.pos[ob3], oyB = by - this.pos[ob3 + 1], ozB = bz - this.pos[ob3 + 2];
        const lA = Math.hypot(oxA, oyA, ozA) || 1;
        const lB = Math.hypot(oxB, oyB, ozB) || 1;
        const h1 = ((seedPhase * 37) % 11) / 11;
        const h2 = ((seedPhase * 53 + 7) % 11) / 11;
        const wA = 0.018 + h1 * 0.014;
        const wB = 0.018 + h2 * 0.014;
        const backLap = 0.0025;
        const uxA = oxA / lA, uyA = oyA / lA, uzA = ozA / lA;
        const uxB = oxB / lB, uyB = oyB / lB, uzB = ozB / lB;

        const rLenA = Math.hypot(ax - bodyCx, az - bodyCz) || 1;
        const rLenB = Math.hypot(bx - bodyCx, bz - bodyCz) || 1;
        const lift = 0.004;
        const lxA = ((ax - bodyCx) / rLenA) * lift, lzA = ((az - bodyCz) / rLenA) * lift;
        const lxB = ((bx - bodyCx) / rLenB) * lift, lzB = ((bz - bodyCz) / rLenB) * lift;

        ePos.push(
          ax - uxA * backLap + lxA * 0.35, ay - uyA * backLap, az - uzA * backLap + lzA * 0.35,
          bx - uxB * backLap + lxB * 0.35, by - uyB * backLap, bz - uzB * backLap + lzB * 0.35,
          ax + uxA * wA + lxA, ay + uyA * wA - 0.006, az + uzA * wA + lzA,
          bx + uxB * wB + lxB, by + uyB * wB - 0.006, bz + uzB * wB + lzB
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
