import * as THREE from 'three';
import { SKIN_TONES } from './config.js';
import { getLegCenter, sampleLegSurface } from './math.js';
import { createSkinTextures, createLaceBandTexture } from './textures.js';
import { getPelvisCrossSection } from './upperBody.js';

// =========================================================================
// PHOTOREALISTIC SKIN LEGS (SSS), ALIGNED PELVIS SHORTS & LACE THIGH BANDS
// =========================================================================
export function createBodyMeshes(scene) {
  const skinTex = createSkinTextures();
  const skinSSSUniform = { value: SKIN_TONES.fair.sss.clone() };

  const skinMat = new THREE.MeshPhysicalMaterial({
    color: SKIN_TONES.fair.tint,
    map: skinTex.map,
    roughnessMap: skinTex.roughnessMap,
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(0.045, 0.045),
    roughness: 0.96,
    metalness: 0.0,
    clearcoat: 0.045,
    clearcoatRoughness: 0.64,
    sheen: 0.56,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color(SKIN_TONES.fair.sheen),
    envMapIntensity: 0.44
  });

  // Pre-Integrated Skin Subsurface Scattering shader
  skinMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSkinSSS = skinSSSUniform;
    const sssChunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `
      float rawDotNL = dot( geometryNormal, directLight.direction );
      float wrapDiff = saturate( ( rawDotNL + 0.46 ) / 1.46 );
      float terminatorGlow = exp( -pow( ( rawDotNL - 0.06 ) / 0.38, 2.0 ) );
      float ndotv = saturate( dot( geometryNormal, geometryViewDir ) );
      float rimFresnel = pow( 1.0 - ndotv, 2.5 );
      float backScatter = saturate( -rawDotNL * 0.45 + 0.50 ) * rimFresnel;
      vec3 skinLight = vec3( dotNL ) * 0.50
                     + vec3( wrapDiff ) * 0.50
                     + uSkinSSS * ( terminatorGlow * 0.24 + backScatter * 0.28 );
      reflectedLight.directDiffuse += directLight.color * skinLight * BRDF_Lambert( material.diffuseColor );
      `
    );
    shader.fragmentShader =
      'uniform vec3 uSkinSSS;\n' +
      shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', sssChunk);
  };

  function buildLegSkinMesh(side) {
    const segU = 64, segV = 96;
    const positions = [], uvs = [], indices = [];
    for (let iv = 0; iv <= segV; iv++) {
      const t = iv / segV;
      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU;
        const theta = u * Math.PI * 2;
        const pt = sampleLegSurface(side, t, theta, 0);
        positions.push(pt.x, pt.y, pt.z);
        const uAnat = side === 1 ? u : (0.5 - u);
        uvs.push(uAnat, t);
      }
    }
    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const footCenter = getLegCenter(side, 1.0);
    const soleIdx = positions.length / 3;
    positions.push(footCenter.cx, 0.002, footCenter.cz + 0.01);
    uvs.push(0.5, 1.0);
    const botStart = segV * stride;
    for (let iu = 0; iu < segU; iu++) {
      indices.push(botStart + iu, botStart + iu + 1, soleIdx);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, skinMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  scene.add(buildLegSkinMesh(-1));
  scene.add(buildLegSkinMesh(1));

  // Aligned fitted studio shorts (uses exact shared getPelvisCrossSection -> 100% flush with thighs, waist & skirt!)
  function buildSafetyShorts() {
    const group = new THREE.Group();
    const shortsMat = new THREE.MeshPhysicalMaterial({
      color: 0x181c26,
      roughness: 0.74,
      metalness: 0.02,
      sheen: 0.40,
      sheenRoughness: 0.60,
      sheenColor: new THREE.Color(0x475569)
    });

    const segU = 56, segV = 22;
    const positions = [], indices = [];
    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV;
      const y = 1.50 + v * 0.40; // y = 1.50 (hips) -> 1.90 (waistline matching torso!)
      const { rx, rz, backGlute } = getPelvisCrossSection(y);
      for (let iu = 0; iu <= segU; iu++) {
        const th = (iu / segU) * Math.PI * 2;
        const cosT = Math.cos(th), sinT = Math.sin(th);
        const backCurve = Math.max(0, -sinT) * backGlute;
        positions.push(cosT * rx, y, sinT * (rz + backCurve));
      }
    }
    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const pelvisGeo = new THREE.BufferGeometry();
    pelvisGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pelvisGeo.setIndex(indices);
    pelvisGeo.computeVertexNormals();
    const pelvisMesh = new THREE.Mesh(pelvisGeo, shortsMat);
    pelvisMesh.castShadow = true;
    pelvisMesh.receiveShadow = true;
    group.add(pelvisMesh);

    // Smooth upper-thigh short cuffs (t = 0.00..0.11, y = 1.44..1.62)
    for (const side of [-1, 1]) {
      const p = [], idx = [];
      const su = 44, sv = 10;
      for (let iv = 0; iv <= sv; iv++) {
        const t = (iv / sv) * 0.11;
        for (let iu = 0; iu <= su; iu++) {
          const pt = sampleLegSurface(side, t, (iu / su) * Math.PI * 2, 0.0055);
          p.push(pt.x, pt.y, pt.z);
        }
      }
      const st = su + 1;
      for (let iv = 0; iv < sv; iv++) {
        for (let iu = 0; iu < su; iu++) {
          const a = iv * st + iu, b = a + 1, c = (iv + 1) * st + iu, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, shortsMat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }

    // Subtle fitted waistband trim at y = 1.88
    const waistTrim = new THREE.Mesh(
      new THREE.TorusGeometry(0.198, 0.007, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0x0f131b, roughness: 0.72 })
    );
    waistTrim.rotation.x = Math.PI / 2;
    waistTrim.scale.set(1.02, 0.62, 1.0);
    waistTrim.position.set(0, 1.88, 0);
    group.add(waistTrim);

    return group;
  }
  scene.add(buildSafetyShorts());

  // Lace comfort thigh band at top of stockings
  const laceAlpha = createLaceBandTexture();
  const laceMat = new THREE.MeshPhysicalMaterial({
    color: 0x11141a,
    alphaMap: laceAlpha,
    transparent: true,
    alphaTest: 0.18,
    roughness: 0.62,
    sheen: 0.55,
    sheenColor: new THREE.Color(0x64748b),
    side: THREE.DoubleSide
  });

  function buildLaceBand(side) {
    const segU = 56, segV = 8;
    const tTop = 0.135, tBot = 0.195;
    const positions = [], uvs = [], indices = [];
    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV;
      const t = tTop + v * (tBot - tTop);
      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU;
        const pt = sampleLegSurface(side, t, u * Math.PI * 2, 0.0028);
        positions.push(pt.x, pt.y, pt.z);
        uvs.push(u, 1 - v);
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
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, laceMat);
  }
  scene.add(buildLaceBand(-1));
  scene.add(buildLaceBand(1));

  return { skinTex, skinSSSUniform, skinMat, laceMat };
}
