import * as THREE from 'three';
import { SKIN_TONES } from './config.js';
import { clamp, smoothstep } from './math.js';

// =========================================================================
// SCULPTED ANATOMICAL 3D HUMAN HANDS (3-Joint Articulated Fingers & Nails)
// =========================================================================
function buildPhalanxGeo(rBase, rTip, len, isDistal, handedness) {
  const segU = 20, segV = isDistal ? 16 : 10;
  const positions = [], colors = [], uvs = [], indices = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    let z, rx, ry, yShift = 0, blush = 0;

    if (isDistal && v > 0.72) {
      const capT = (v - 0.72) / 0.28;
      const ang = capT * Math.PI * 0.5;
      const baseZ = -len * 0.78;
      const domeLen = len * 0.22 + rTip * 0.55;
      z = baseZ - Math.sin(ang) * domeLen;
      const cosA = Math.max(0.015, Math.cos(ang));
      rx = rTip * 1.02 * cosA;
      ry = rTip * 0.86 * cosA;
      yShift = -rTip * 0.10 * Math.sin(ang * 2);
      blush = 0.08 + 0.05 * capT;
    } else {
      const t = isDistal ? (v / 0.72) : v;
      z = -t * (isDistal ? len * 0.78 : len);
      const knuckle = Math.exp(-t * t * 18) * 0.08 + Math.exp(-(1 - t) * (1 - t) * 18) * (isDistal ? 0 : 0.06);
      const r = (rBase + (rTip - rBase) * t) * (1 + knuckle);
      rx = r * 1.05;
      ry = r * 0.90;
      yShift = isDistal ? (-r * 0.14 * Math.sin(t * Math.PI)) : (-r * 0.05 * Math.sin(t * Math.PI));
      blush = knuckle * 0.35 + (isDistal ? t * 0.07 : 0);
    }

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const th = u * Math.PI * 2;
      const cosT = Math.cos(th), sinT = Math.sin(th);
      const flatTop = (isDistal && sinT > 0) ? (1 - 0.14 * sinT * v) : 1.0;
      const x = cosT * rx * handedness;
      const y = sinT * ry * flatTop + yShift;
      positions.push(x, y, z);
      uvs.push(u, v);

      const palmSide = Math.max(0, -sinT);
      const cr = clamp(1.0 + blush * 0.18 + palmSide * 0.03, 0.9, 1.06);
      const cg = clamp(0.985 - blush * 0.42 - palmSide * 0.025, 0.82, 1.02);
      const cb = clamp(0.975 - blush * 0.48 - palmSide * 0.03, 0.78, 1.02);
      colors.push(cr, cg, cb);
    }
  }

  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
      if (handedness > 0) indices.push(a, c, b, b, c, d);
      else                indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildNailGeo(width, length, thickness = 0.0012) {
  const segU = 12, segV = 10;
  const positions = [], uvs = [], indices = [];
  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const z = -v * length;
    const halfW = width * 0.5 * Math.sin(clamp(v * 0.88 + 0.10, 0.05, 0.98) * Math.PI);
    const archY = Math.sin(v * Math.PI) * 0.0009 - v * v * 0.0011;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const s = (u - 0.5) * 2;
      const x = s * halfW;
      const curveY = -s * s * width * 0.14 + archY + thickness;
      positions.push(x, curveY, z);
      uvs.push(u, v);
    }
  }
  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildSculptedPalmAndWristGeo(handedness) {
  const segU = 32;
  const stations = [
    { z: -0.005, cx:  0.001, cy:  0.000, rx: 0.031, ry: 0.0085, cup: 0.002, sq: 0.30 },
    { z:  0.004, cx:  0.001, cy:  0.000, rx: 0.035, ry: 0.0110, cup: 0.003, sq: 0.30 },
    { z:  0.024, cx:  0.000, cy: -0.001, rx: 0.036, ry: 0.0125, cup: 0.004, sq: 0.24 },
    { z:  0.048, cx: -0.002, cy: -0.002, rx: 0.037, ry: 0.0145, cup: 0.003, sq: 0.18 },
    { z:  0.070, cx:  0.000, cy: -0.001, rx: 0.031, ry: 0.0155, cup: 0.001, sq: 0.12 },
    { z:  0.088, cx:  0.001, cy:  0.000, rx: 0.024, ry: 0.0150, cup: 0.000, sq: 0.06 },
    { z:  0.124, cx:  0.001, cy:  0.002, rx: 0.0255, ry: 0.0170, cup: 0.000, sq: 0.04 },
    { z:  0.165, cx:  0.001, cy:  0.004, rx: 0.0275, ry: 0.0195, cup: 0.000, sq: 0.02 }
  ];

  const positions = [], colors = [], uvs = [], indices = [];
  const nSt = stations.length;

  for (let is = 0; is < nSt; is++) {
    const st = stations[is];
    const v = is / (nSt - 1);
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const th = u * Math.PI * 2;
      const cosT = Math.cos(th), sinT = Math.sin(th);

      const sCos = Math.sign(cosT) * Math.pow(Math.abs(cosT), 1 - st.sq);
      const sSin = Math.sign(sinT) * Math.pow(Math.abs(sinT), 1 - st.sq);

      const knuckleBump = (is === 1 && sinT > 0.2) ? (Math.sin(cosT * Math.PI * 3.5) * 0.0012 + 0.0010) * sinT : 0;
      const cupOffset = (sinT < 0) ? (1 - cosT * cosT) * st.cup * (-sinT) : 0;
      const thenarPad = (is >= 2 && is <= 4 && cosT < -0.1 && sinT < 0.2)
        ? Math.pow(-cosT, 1.4) * (1 - Math.abs(sinT + 0.45)) * 0.0075
        : 0;

      const x = (st.cx + sCos * st.rx - thenarPad * 0.65) * handedness;
      const y = st.cy + sSin * st.ry + knuckleBump + cupOffset - thenarPad * 0.55;
      positions.push(x, y, st.z);
      uvs.push(u, v);

      const palmSide = Math.max(0, -sinT) * (1 - smoothstep(0.55, 0.85, v));
      const knTint = (is === 1 && sinT > 0.2) ? 0.04 : 0;
      colors.push(
        1.0 + palmSide * 0.025 + knTint * 0.18,
        0.99 - palmSide * 0.04 - knTint * 0.30,
        0.985 - palmSide * 0.045 - knTint * 0.35
      );
    }
  }

  const stride = segU + 1;
  for (let is = 0; is < nSt - 1; is++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = is * stride + iu, b = a + 1, c = (is + 1) * stride + iu, d = c + 1;
      if (handedness > 0) indices.push(a, b, c, b, d, c);
      else                indices.push(a, c, b, b, c, d);
    }
  }

  const frontCenterIdx = positions.length / 3;
  positions.push(stations[0].cx * handedness, stations[0].cy, stations[0].z - 0.004);
  colors.push(1.0, 0.97, 0.96);
  uvs.push(0.5, 0);
  for (let iu = 0; iu < segU; iu++) {
    if (handedness > 0) indices.push(frontCenterIdx, iu + 1, iu);
    else                indices.push(frontCenterIdx, iu, iu + 1);
  }

  const backCenterIdx = positions.length / 3;
  const last = stations[nSt - 1];
  positions.push(last.cx * handedness, last.cy, last.z + 0.004);
  colors.push(0.98, 0.97, 0.96);
  uvs.push(0.5, 1);
  const lastRow = (nSt - 1) * stride;
  for (let iu = 0; iu < segU; iu++) {
    if (handedness > 0) indices.push(backCenterIdx, lastRow + iu, lastRow + iu + 1);
    else                indices.push(backCenterIdx, lastRow + iu + 1, lastRow + iu);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function updateHandPinch(hand, targetPinch, tremor = 0) {
  const ud = hand.userData;
  ud.pinch += (targetPinch - ud.pinch) * 0.28;
  const p = ud.pinch;
  const lerp = (a, b, t) => a + (b - a) * t;
  const jitter = tremor > 0 ? (Math.random() - 0.5) * 0.022 * tremor : 0;

  ud.indexJoints[0].rotation.x = lerp(-0.18, -0.44, p) + jitter;
  ud.indexJoints[1].rotation.x = lerp(-0.22, -0.48, p);
  ud.indexJoints[2].rotation.x = lerp(-0.14, -0.34, p);

  ud.thumbYawGroup.rotation.y = lerp(0.24, 0.14, p) * ud.handedness;
  ud.thumbPitchGroup.rotation.x = lerp(-0.74, -0.58, p);
  ud.thumbJoints[1].rotation.x = lerp(-0.08, -0.32, p) - jitter;
  ud.thumbJoints[2].rotation.x = lerp(-0.05, -0.24, p);

  ud.middleJoints[0].rotation.x = lerp(-0.52, -0.82, p);
  ud.middleJoints[1].rotation.x = lerp(-0.70, -1.02, p);
  ud.middleJoints[2].rotation.x = lerp(-0.48, -0.70, p);

  ud.ringJoints[0].rotation.x = lerp(-0.68, -0.96, p);
  ud.ringJoints[1].rotation.x = lerp(-0.82, -1.10, p);
  ud.ringJoints[2].rotation.x = lerp(-0.55, -0.76, p);

  ud.pinkyJoints[0].rotation.x = lerp(-0.78, -1.06, p);
  ud.pinkyJoints[1].rotation.x = lerp(-0.88, -1.15, p);
  ud.pinkyJoints[2].rotation.x = lerp(-0.58, -0.80, p);

  ud.poseRoot.rotation.x = 0.14 + jitter * 0.45;
}

export function createHandSystem(scene, { skinTex, skinSSSUniform }) {
  const handSkinMat = new THREE.MeshPhysicalMaterial({
    color: SKIN_TONES.fair.handHex,
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(0.035, 0.035),
    roughness: 0.50,
    metalness: 0.0,
    clearcoat: 0.05,
    clearcoatRoughness: 0.58,
    sheen: 0.52,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(SKIN_TONES.fair.sheen),
    vertexColors: true,
    envMapIntensity: 0.44
  });

  handSkinMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSkinSSS = skinSSSUniform;
    const sssChunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `
      float rawDotNL = dot( geometryNormal, directLight.direction );
      float wrapDiff = saturate( ( rawDotNL + 0.44 ) / 1.44 );
      float terminatorGlow = exp( -pow( ( rawDotNL - 0.05 ) / 0.36, 2.0 ) );
      float ndotv = saturate( dot( geometryNormal, geometryViewDir ) );
      float rimFresnel = pow( 1.0 - ndotv, 2.5 );
      float backScatter = saturate( -rawDotNL * 0.45 + 0.50 ) * rimFresnel;
      vec3 skinLight = vec3( dotNL ) * 0.52
                     + vec3( wrapDiff ) * 0.48
                     + uSkinSSS * ( terminatorGlow * 0.24 + backScatter * 0.26 );
      reflectedLight.directDiffuse += directLight.color * skinLight * BRDF_Lambert( material.diffuseColor );
      `
    );
    shader.fragmentShader =
      'uniform vec3 uSkinSSS;\n' +
      shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', sssChunk);
  };

  const nailMat = new THREE.MeshPhysicalMaterial({
    color: 0xf9e5df,
    roughness: 0.16,
    metalness: 0.0,
    clearcoat: 0.92,
    clearcoatRoughness: 0.12,
    sheen: 0.25,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.75
  });

  function createRealisticHand(handedness = 1, accentHex = 0x38bdf8, showBracelet = false) {
    const root = new THREE.Group();
    const poseRoot = new THREE.Group();
    poseRoot.rotation.set(0.14, -0.68 * handedness, -0.22 * handedness);
    root.add(poseRoot);

    const handAlign = new THREE.Group();
    handAlign.position.set(0.025 * handedness, 0.047, 0.050);
    poseRoot.add(handAlign);

    const palmMesh = new THREE.Mesh(buildSculptedPalmAndWristGeo(handedness), handSkinMat);
    palmMesh.castShadow = true;
    palmMesh.receiveShadow = true;
    handAlign.add(palmMesh);

    const sleeveMat = new THREE.MeshPhysicalMaterial({
      color: 0x1b2332,
      roughness: 0.72,
      sheen: 0.45,
      sheenColor: new THREE.Color(0x64748b)
    });
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.028, 0.058, 24), sleeveMat);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.scale.set(1.0, 1.0, 0.78);
    sleeve.position.set(0.001 * handedness, 0.004, 0.172);
    handAlign.add(sleeve);

    const bandMat = new THREE.MeshStandardMaterial({
      color: accentHex,
      roughness: 0.28,
      metalness: 0.65,
      emissive: showBracelet ? new THREE.Color(accentHex) : new THREE.Color(0x000000),
      emissiveIntensity: showBracelet ? 0.38 : 0.0
    });
    const wristBand = new THREE.Mesh(new THREE.TorusGeometry(0.0235, 0.0022, 10, 28), bandMat);
    wristBand.scale.set(1.08, 0.70, 1.0);
    wristBand.position.set(0.001 * handedness, 0.000, 0.092);
    handAlign.add(wristBand);

    const makeJointSphere = (radius) => {
      const jGeo = new THREE.SphereGeometry(radius, 14, 12);
      const jCount = jGeo.attributes.position.count;
      const jCols = new Float32Array(jCount * 3);
      for (let jc = 0; jc < jCount; jc++) {
        jCols[jc * 3] = 1.0; jCols[jc * 3 + 1] = 0.96; jCols[jc * 3 + 2] = 0.95;
      }
      jGeo.setAttribute('color', new THREE.BufferAttribute(jCols, 3));
      const m = new THREE.Mesh(jGeo, handSkinMat);
      m.scale.set(1.03, 0.92, 1.0);
      return m;
    };

    const buildArticulatedFinger = ({ base, yaw, roll, segs, radii, nailSize }) => {
      const mount = new THREE.Group();
      mount.position.set(base[0] * handedness, base[1], base[2]);
      mount.rotation.set(0, yaw * handedness, roll * handedness);
      handAlign.add(mount);

      const j0 = new THREE.Group();
      mount.add(j0);
      const joints = [j0];
      let parent = j0;

      for (let i = 0; i < segs.length; i++) {
        const isLast = i === segs.length - 1;
        const r0 = radii[i], r1 = radii[i + 1], len = segs[i];
        parent.add(makeJointSphere(r0 * 1.03));

        const phMesh = new THREE.Mesh(buildPhalanxGeo(r0, r1, len, isLast, handedness), handSkinMat);
        phMesh.castShadow = true;
        phMesh.receiveShadow = true;
        parent.add(phMesh);

        if (isLast) {
          const nail = new THREE.Mesh(buildNailGeo(nailSize[0], nailSize[1]), nailMat);
          nail.position.set(0, r1 * 0.72, -len * 0.24);
          nail.rotation.x = -0.06;
          parent.add(nail);
        } else {
          const nextJoint = new THREE.Group();
          nextJoint.position.set(0, 0, -len);
          parent.add(nextJoint);
          joints.push(nextJoint);
          parent = nextJoint;
        }
      }
      return joints;
    };

    // 3-segment Opposable Thumb growing directly from side of palm
    const thumbYawGroup = new THREE.Group();
    thumbYawGroup.position.set(-0.024 * handedness, -0.006, 0.042);
    handAlign.add(thumbYawGroup);

    const thumbPitchGroup = new THREE.Group();
    thumbYawGroup.add(thumbPitchGroup);

    const thumbRollGroup = new THREE.Group();
    thumbRollGroup.rotation.z = 2.52 * handedness;
    thumbPitchGroup.add(thumbRollGroup);

    const thumbSegs = [0.039, 0.031, 0.024];
    const thumbRadii = [0.0135, 0.0098, 0.0082, 0.0065];
    const thumbJoints = [];
    let tParent = thumbRollGroup;
    for (let i = 0; i < thumbSegs.length; i++) {
      const isLast = i === thumbSegs.length - 1;
      const j = new THREE.Group();
      if (i > 0) j.position.set(0, 0, -thumbSegs[i - 1]);
      tParent.add(j);
      thumbJoints.push(j);

      j.add(makeJointSphere(thumbRadii[i] * 1.03));
      const ph = new THREE.Mesh(buildPhalanxGeo(thumbRadii[i], thumbRadii[i + 1], thumbSegs[i], isLast, handedness), handSkinMat);
      ph.castShadow = true;
      ph.receiveShadow = true;
      j.add(ph);

      if (isLast) {
        const nail = new THREE.Mesh(buildNailGeo(0.010, 0.0115), nailMat);
        nail.position.set(0, thumbRadii[i + 1] * 0.72, -thumbSegs[i] * 0.24);
        nail.rotation.x = -0.06;
        j.add(nail);
      }
      tParent = j;
    }

    const indexJoints = buildArticulatedFinger({
      base: [-0.025, 0.001, 0.000], yaw: 0.04, roll: 0.0,
      segs: [0.036, 0.023, 0.018], radii: [0.0079, 0.0069, 0.0060, 0.0051], nailSize: [0.0082, 0.0102]
    });
    const middleJoints = buildArticulatedFinger({
      base: [-0.007, 0.003, -0.003], yaw: 0.0, roll: 0.0,
      segs: [0.040, 0.025, 0.019], radii: [0.0081, 0.0070, 0.0061, 0.0052], nailSize: [0.0086, 0.0108]
    });
    const ringJoints = buildArticulatedFinger({
      base: [0.011, 0.001, 0.000], yaw: -0.04, roll: 0.0,
      segs: [0.036, 0.023, 0.018], radii: [0.0075, 0.0065, 0.0056, 0.0048], nailSize: [0.0078, 0.0100]
    });
    const pinkyJoints = buildArticulatedFinger({
      base: [0.027, -0.003, 0.006], yaw: -0.08, roll: 0.0,
      segs: [0.028, 0.018, 0.015], radii: [0.0064, 0.0055, 0.0048, 0.0041], nailSize: [0.0066, 0.0086]
    });

    root.userData = {
      poseRoot, handedness,
      indexJoints, thumbYawGroup, thumbPitchGroup, thumbJoints,
      middleJoints, ringJoints, pinkyJoints,
      pinch: 0
    };
    root.visible = false;
    updateHandPinch(root, 0, 0);
    return root;
  }

  const mainHand = createRealisticHand(1, 0x38bdf8, false);
  const pinnedHand = createRealisticHand(-1, 0xf59e0b, true);
  scene.add(mainHand);
  scene.add(pinnedHand);

  return { handSkinMat, mainHand, pinnedHand };
}
