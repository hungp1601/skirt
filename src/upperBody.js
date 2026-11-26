import * as THREE from 'three';
import { SKIN_TONES } from './config.js';
import { clamp, smoothstep, gauss } from './math.js';

// =========================================================================
// FULL UPPER BODY: TORSO, ARMS, SCULPTED HUMAN HEAD/FACE, EYES & HAIR
// (Proportional to 1.62m leg scale -> total figure height ~3.05 units)
// =========================================================================

// Shared pelvis/waist cross-section so body, shorts, torso & skirt align 100% concentrically
export function getPelvisCrossSection(y) {
  // y = 1.50 (lower hip matching outer thigh ±0.295) -> y = 1.90 (slender waist ±0.198)
  const v = clamp((y - 1.50) / 0.40, 0, 1);
  const hipCurve = smoothstep(0.0, 0.22, v);
  const waistTaper = smoothstep(0.28, 1.0, v);
  const rx = 0.292 + 0.008 * Math.sin(hipCurve * Math.PI) - waistTaper * 0.094;
  const rz = 0.146 + 0.008 * Math.sin(hipCurve * Math.PI) - waistTaper * 0.028;
  const backGlute = (1 - waistTaper * 0.85) * 0.024 * smoothstep(0.0, 0.25, v);
  return { rx, rz, backGlute };
}

// Procedural face texture (soft cheeks, subtle nose/lip contour, natural brows & lashline)
function createFaceSkinTexture() {
  const w = 512, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Smooth luminous skin base matching legs
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0.0, '#edd0c0');
  bg.addColorStop(0.5, '#f2d3c2');
  bg.addColorStop(1.0, '#ebd0c0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // UV convention for head mesh: u = 0.5 is front center (+Z), v = 0 is top crown -> v = 1 is chin/neck
  // Soft rosy cheeks (u ~ 0.39 & 0.61, v ~ 0.60)
  for (const cx of [w * 0.40, w * 0.60]) {
    const blush = ctx.createRadialGradient(cx, h * 0.61, 4, cx, h * 0.61, 44);
    blush.addColorStop(0, 'rgba(228, 134, 126, 0.24)');
    blush.addColorStop(1, 'rgba(228, 134, 126, 0)');
    ctx.fillStyle = blush;
    ctx.fillRect(0, 0, w, h);
  }

  // Subtle nose bridge warmth & tip highlight
  const noseTip = ctx.createRadialGradient(w * 0.50, h * 0.62, 2, w * 0.50, h * 0.62, 16);
  noseTip.addColorStop(0, 'rgba(235, 162, 148, 0.18)');
  noseTip.addColorStop(1, 'rgba(235, 162, 148, 0)');
  ctx.fillStyle = noseTip;
  ctx.fillRect(0, 0, w, h);

  // Soft natural eye-socket shading & upper lashline shadow (u ~ 0.43 & 0.57, v ~ 0.50)
  for (const side of [-1, 1]) {
    const ex = w * (0.50 + side * 0.068);
    const ey = h * 0.50;
    const sock = ctx.createRadialGradient(ex, ey, 4, ex, ey, 26);
    sock.addColorStop(0, 'rgba(168, 118, 104, 0.20)');
    sock.addColorStop(1, 'rgba(168, 118, 104, 0)');
    ctx.fillStyle = sock;
    ctx.fillRect(0, 0, w, h);

    // Delicate dark-brown curved upper lashline
    ctx.strokeStyle = 'rgba(42, 28, 24, 0.85)';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - side * 14, ey + 2);
    ctx.quadraticCurveTo(ex, ey - 8, ex + side * 15, ey + 1);
    ctx.stroke();

    // Soft natural arched eyebrows (v ~ 0.425)
    ctx.strokeStyle = 'rgba(56, 38, 30, 0.78)';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(ex - side * 15, h * 0.435);
    ctx.quadraticCurveTo(ex + side * 2, h * 0.412, ex + side * 18, h * 0.436);
    ctx.stroke();
  }

  // Natural rosy sculpted lips with Cupid's bow (u = 0.50, v ~ 0.735)
  const mx = w * 0.50, my = h * 0.735;
  ctx.fillStyle = 'rgba(208, 112, 110, 0.72)';
  ctx.beginPath();
  ctx.moveTo(mx - 20, my);
  ctx.quadraticCurveTo(mx - 8, my - 8, mx, my - 4.5);
  ctx.quadraticCurveTo(mx + 8, my - 8, mx + 20, my);
  ctx.quadraticCurveTo(mx, my + 12, mx - 20, my);
  ctx.fill();

  // Subtle lip center crease
  ctx.strokeStyle = 'rgba(135, 58, 58, 0.45)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(mx - 17, my + 0.5);
  ctx.quadraticCurveTo(mx, my + 2.2, mx + 17, my + 0.5);
  ctx.stroke();

  // Soft lower-lip specular hint
  const lipGlow = ctx.createRadialGradient(mx, my + 5, 1, mx, my + 5, 10);
  lipGlow.addColorStop(0, 'rgba(255, 224, 220, 0.35)');
  lipGlow.addColorStop(1, 'rgba(255, 224, 220, 0)');
  ctx.fillStyle = lipGlow;
  ctx.fillRect(mx - 14, my - 2, 28, 16);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}

// Expressive glossy iris + pupil + studio catchlight eye texture
function createEyeTexture() {
  const size = 256;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2;

  // Soft warm sclera (white of eye)
  const sclera = ctx.createRadialGradient(cx, cy, 40, cx, cy, 128);
  sclera.addColorStop(0, '#fcfbfa');
  sclera.addColorStop(0.75, '#f2ece9');
  sclera.addColorStop(1, '#dfd2ce');
  ctx.fillStyle = sclera;
  ctx.fillRect(0, 0, size, size);

  // Dark espresso-hazel iris (radius ~48)
  const irisGrad = ctx.createRadialGradient(cx, cy, 14, cx, cy, 50);
  irisGrad.addColorStop(0.0, '#1e130e');
  irisGrad.addColorStop(0.45, '#4b2d1f');
  irisGrad.addColorStop(0.82, '#351f15');
  irisGrad.addColorStop(1.0, '#140c0a');
  ctx.fillStyle = irisGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 49, 0, Math.PI * 2);
  ctx.fill();

  // Subtle iris fibers
  ctx.strokeStyle = 'rgba(138, 92, 66, 0.25)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18);
    ctx.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
    ctx.stroke();
  }

  // Deep pupil
  ctx.fillStyle = '#090708';
  ctx.beginPath();
  ctx.arc(cx, cy, 21, 0, Math.PI * 2);
  ctx.fill();

  // Crisp studio softbox catchlights (makes eyes instantly come alive!)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.ellipse(cx - 14, cy - 14, 9, 7, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 248, 240, 0.65)';
  ctx.beginPath();
  ctx.arc(cx + 14, cy + 12, 4.2, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Fine knit fabric texture for fitted studio top
function createTopKnitTexture() {
  const size = 256;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, 0, 2, size);
  }
  for (let y = 0; y < size; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.018)';
    ctx.fillRect(0, y, size, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createUpperBody(scene, { skinTex, skinSSSUniform }) {
  const root = new THREE.Group();
  scene.add(root);

  // Smooth SSS skin material for neck, shoulders, arms & sculpted face
  const upperSkinMat = new THREE.MeshPhysicalMaterial({
    color: SKIN_TONES.fair.handHex,
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(0.035, 0.035),
    roughness: 0.50,
    metalness: 0.0,
    clearcoat: 0.045,
    clearcoatRoughness: 0.60,
    sheen: 0.54,
    sheenRoughness: 0.64,
    sheenColor: new THREE.Color(SKIN_TONES.fair.sheen),
    envMapIntensity: 0.44
  });

  const faceTex = createFaceSkinTexture();
  const faceSkinMat = new THREE.MeshPhysicalMaterial({
    color: SKIN_TONES.fair.tint,
    map: faceTex,
    normalMap: skinTex.normalMap,
    normalScale: new THREE.Vector2(0.025, 0.025),
    roughness: 0.48,
    metalness: 0.0,
    clearcoat: 0.05,
    clearcoatRoughness: 0.58,
    sheen: 0.55,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(SKIN_TONES.fair.sheen),
    envMapIntensity: 0.44
  });

  // Apply matching Pre-Integrated Skin SSS shader to both upperSkinMat & faceSkinMat
  const injectSkinSSS = (mat) => {
    mat.onBeforeCompile = (shader) => {
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
  };
  injectSkinSSS(upperSkinMat);
  injectSkinSSS(faceSkinMat);

  // Chic fitted off-white/cream ribbed knit sleeveless studio top (matches dark navy pleated skirt & looks great without skirt!)
  const topMat = new THREE.MeshPhysicalMaterial({
    color: 0xeff2f7,
    map: createTopKnitTexture(),
    roughness: 0.72,
    metalness: 0.02,
    sheen: 0.48,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(0xffffff),
    side: THREE.DoubleSide
  });

  const hairMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e1615,
    roughness: 0.36,
    metalness: 0.04,
    clearcoat: 0.22,
    clearcoatRoughness: 0.42,
    sheen: 0.65,
    sheenRoughness: 0.40,
    sheenColor: new THREE.Color(0x6b4f47),
    envMapIntensity: 0.65
  });

  // -------------------------------------------------------------------------
  // 1. SCULPTED UPPER TORSO (Waist y=1.84 -> Ribcage -> Bust -> Shoulders y=2.50)
  // -------------------------------------------------------------------------
  function buildTorsoMesh() {
    const segU = 64, segV = 48;
    const yBot = 1.82, yTop = 2.50;
    const positions = [], uvs = [], indices = [];

    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV; // 0 = waist -> 1 = shoulder/collar
      const y = yBot + v * (yTop - yBot);

      // Smooth anatomical torso width & depth
      const waist = 1 - smoothstep(0.0, 0.32, v);
      const bustEnv = gauss(v, 0.56, 0.16);
      const shoulderEnv = smoothstep(0.65, 0.96, v);
      const collarTaper = smoothstep(0.92, 1.0, v);

      const rx = (0.198 + 0.046 * (1 - waist) + 0.068 * shoulderEnv) * (1 - collarTaper * 0.58);
      const rz = (0.118 + 0.026 * (1 - waist) - 0.014 * shoulderEnv) * (1 - collarTaper * 0.40);

      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU;
        const th = u * Math.PI * 2;
        const cosT = Math.cos(th), sinT = Math.sin(th); // sinT = +1 is front (+Z)

        let rBase = 1 / (Math.hypot(cosT / rx, sinT / rz) || 1);

        // Soft natural anatomical bust contour (front +Z around v ~ 0.56)
        const frontMask = Math.max(0, sinT);
        const twinBust = Math.exp(-Math.pow((Math.abs(cosT) - 0.42) / 0.34, 2));
        const bustLift = bustEnv * frontMask * (0.042 * twinBust + 0.012 * frontMask);
        // Subtle spinal curve dip at back (-Z)
        const spineDip = Math.max(0, -sinT) * Math.exp(-Math.pow(cosT / 0.22, 2)) * 0.012 * (1 - collarTaper);

        const x = cosT * (rBase + bustLift * 0.15);
        const z = sinT * (rBase + bustLift - spineDip);
        positions.push(x, y, z);
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
    const mesh = new THREE.Mesh(geo, topMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const torsoGroup = new THREE.Group();
  root.add(torsoGroup);
  torsoGroup.add(buildTorsoMesh());

  // Soft dark collar ribbon trim at neckline (ties the cream top visually with the navy skirt!)
  const collarTrim = new THREE.Mesh(
    new THREE.TorusGeometry(0.095, 0.0085, 12, 36),
    new THREE.MeshStandardMaterial({ color: 0x1b2436, roughness: 0.72 })
  );
  collarTrim.rotation.x = Math.PI / 2 + 0.14;
  collarTrim.scale.set(1.12, 0.92, 1.0);
  collarTrim.position.set(0, 2.495, 0.015);
  torsoGroup.add(collarTrim);

  // -------------------------------------------------------------------------
  // 2. GRACEFUL SCULPTED ARMS (Left & Right resting naturally beside hips)
  // -------------------------------------------------------------------------
  function buildArm(side) {
    const group = new THREE.Group();
    // Arm path stations from deltoid shoulder -> bicep -> elbow -> forearm -> relaxed hand
    const stations = [
      { x: 0.255, y: 2.45, z: -0.012, rx: 0.068, ry: 0.068 }, // shoulder cap
      { x: 0.305, y: 2.34, z: -0.015, rx: 0.056, ry: 0.058 }, // upper arm
      { x: 0.335, y: 2.15, z: -0.022, rx: 0.049, ry: 0.051 }, // mid bicep
      { x: 0.355, y: 1.98, z: -0.025, rx: 0.045, ry: 0.047 }, // elbow
      { x: 0.378, y: 1.80, z: -0.005, rx: 0.042, ry: 0.044 }, // upper forearm
      { x: 0.392, y: 1.62, z:  0.022, rx: 0.032, ry: 0.035 }, // slender wrist
      { x: 0.396, y: 1.54, z:  0.036, rx: 0.036, ry: 0.020 }, // relaxed palm
      { x: 0.390, y: 1.44, z:  0.046, rx: 0.022, ry: 0.012 }  // relaxed fingertips
    ];

    const segU = 22;
    const positions = [], uvs = [], indices = [];
    for (let is = 0; is < stations.length; is++) {
      const st = stations[is];
      const v = is / (stations.length - 1);
      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU;
        const th = u * Math.PI * 2;
        const x = st.x * side + Math.cos(th) * st.rx;
        const z = st.z + Math.sin(th) * st.ry;
        positions.push(x, st.y, z);
        uvs.push(u, v);
      }
    }
    const stride = segU + 1;
    for (let is = 0; is < stations.length - 1; is++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = is * stride + iu, b = a + 1, c = (is + 1) * stride + iu, d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    // Cap fingertips smoothly
    const tipIdx = positions.length / 3;
    const last = stations[stations.length - 1];
    positions.push(last.x * side, last.y - 0.015, last.z + 0.004);
    uvs.push(0.5, 1.0);
    const lastRow = (stations.length - 1) * stride;
    for (let iu = 0; iu < segU; iu++) {
      indices.push(lastRow + iu, lastRow + iu + 1, tipIdx);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const armMesh = new THREE.Mesh(geo, upperSkinMat);
    armMesh.castShadow = true;
    armMesh.receiveShadow = true;
    group.add(armMesh);

    // Neat short cap-sleeve covering shoulder smoothly
    const sleeveCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.078, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
      topMat
    );
    sleeveCap.position.set(0.268 * side, 2.44, -0.012);
    sleeveCap.rotation.z = -0.32 * side;
    sleeveCap.scale.set(1.05, 1.15, 0.95);
    group.add(sleeveCap);

    return group;
  }
  torsoGroup.add(buildArm(-1));
  torsoGroup.add(buildArm(1));

  // -------------------------------------------------------------------------
  // 3. SLENDER NECK & SCULPTED HUMAN HEAD / FACE / EYES / HAIR
  // -------------------------------------------------------------------------
  const neckGeo = new THREE.CylinderGeometry(0.064, 0.078, 0.24, 28, 8);
  const neckMesh = new THREE.Mesh(neckGeo, upperSkinMat);
  neckMesh.position.set(0, 2.57, -0.004);
  neckMesh.castShadow = true;
  neckMesh.receiveShadow = true;
  torsoGroup.add(neckMesh);

  // Subtle collarbone & upper-chest skin yoke
  const yokeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 16), upperSkinMat);
  yokeMesh.scale.set(1.45, 0.42, 0.92);
  yokeMesh.position.set(0, 2.485, 0.010);
  torsoGroup.add(yokeMesh);

  // Articulated Head Pivot (allows gentle lifelike breathing / subtle gaze sway)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 2.66, 0.005);
  torsoGroup.add(headPivot);

  // Sculpted Human Head & Face Mesh (centered at local y = 0.195 -> world y = 2.855, top = 3.05)
  function buildSculptedHeadMesh() {
    const segU = 64, segV = 56;
    const positions = [], uvs = [], indices = [];

    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV; // 0 = crown top -> 1 = chin/under-jaw
      const phi = v * Math.PI;
      const sinP = Math.sin(phi), cosP = Math.cos(phi);

      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU; // 0.5 = front face (+Z), 0 & 1 = back of head (-Z)
        const theta = (u - 0.5) * Math.PI * 2; // 0 = front (+Z)
        const sinT = Math.sin(theta), cosT = Math.cos(theta);

        // Base cranial & facial proportions
        const jawTaper = smoothstep(0.55, 0.96, v);
        let rx = 0.122 * (1 - jawTaper * 0.42);
        let ry = 0.194;
        let rz = 0.144 * (1 - jawTaper * 0.22);

        // Slightly fuller cranium at back (-Z, upper half)
        if (cosT < 0 && v < 0.65) {
          rz += 0.012 * (-cosT) * Math.sin(v * Math.PI);
        }

        let x = sinP * sinT * rx;
        let y = 0.198 + cosP * ry;
        let z = sinP * cosT * rz;

        // Anatomical facial sculpting on front (+Z, cosT > 0)
        if (cosT > 0.05) {
          const front = Math.pow(cosT, 1.4);
          const uDist = Math.abs(u - 0.5);

          // 1. Delicate eye-socket depressions (v ~ 0.50, uDist ~ 0.068)
          const eyeSock = gauss(v, 0.50, 0.044) * gauss(uDist, 0.068, 0.036);
          z -= eyeSock * 0.016 * front;

          // 2. Soft brow ridge above eyes (v ~ 0.42)
          const brow = gauss(v, 0.425, 0.032) * gauss(uDist, 0.055, 0.060);
          z += brow * 0.007 * front;

          // 3. Sculpted cheekbones (v ~ 0.58, uDist ~ 0.105)
          const cheek = gauss(v, 0.585, 0.055) * gauss(uDist, 0.105, 0.048);
          z += cheek * 0.011 * front;
          x += Math.sign(sinT) * cheek * 0.008;

          // 4. Sculpted nose bridge & delicate nose tip (v = 0.47..0.63, center uDist ~ 0)
          const noseBridge = gauss(uDist, 0, 0.018) * smoothstep(0.44, 0.55, v) * (1 - smoothstep(0.61, 0.66, v));
          const noseTip = gauss(uDist, 0, 0.022) * gauss(v, 0.615, 0.026);
          z += (noseBridge * 0.017 + noseTip * 0.014) * front;

          // 5. Soft sculpted upper & lower lips (v ~ 0.72 & 0.755)
          const mouthW = gauss(uDist, 0, 0.042);
          const upperLip = mouthW * gauss(v, 0.720, 0.015);
          const lowerLip = mouthW * gauss(v, 0.752, 0.017);
          const mouthCleft = mouthW * gauss(v, 0.736, 0.007);
          z += (upperLip * 0.010 + lowerLip * 0.011 - mouthCleft * 0.005) * front;

          // 6. Soft tapered feminine chin (v ~ 0.87)
          const chin = gauss(uDist, 0, 0.048) * gauss(v, 0.875, 0.045);
          z += chin * 0.014 * front;
          y -= chin * 0.006;
        }

        positions.push(x, y, z);
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
    const mesh = new THREE.Mesh(geo, faceSkinMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  headPivot.add(buildSculptedHeadMesh());

  // Sculpted Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 12), upperSkinMat);
    ear.scale.set(0.38, 1.35, 0.72);
    ear.position.set(0.118 * side, 0.190, -0.008);
    ear.rotation.y = -0.18 * side;
    headPivot.add(ear);
  }

  // Glossy 3D Eyes + Blinking Eyelids
  const eyeTex = createEyeTexture();
  const eyeMat = new THREE.MeshPhysicalMaterial({
    map: eyeTex,
    roughness: 0.08,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 0.85
  });
  const eyelids = [];
  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(0.046 * side, 0.198, 0.116);
    headPivot.add(eyeGroup);

    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.021, 20, 18), eyeMat);
    globe.rotation.y = -Math.PI / 2; // orient iris directly forward (+Z)
    eyeGroup.add(globe);

    // Subtle upper eyelid cap for natural blinking
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.0226, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
      upperSkinMat
    );
    lid.rotation.x = -0.78; // open resting position
    eyeGroup.add(lid);
    eyelids.push(lid);
  }

  // Styled Flowing Dark Hair (Volume Cap + Side-Swept Bangs + Back Flowing Strands)
  function buildStyledHair() {
    const hairGroup = new THREE.Group();

    // Main sculpted hair crown volume
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.146, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.66),
      hairMat
    );
    crown.scale.set(0.95, 1.32, 1.12);
    crown.position.set(0, 0.215, -0.015);
    crown.rotation.x = -0.22;
    crown.castShadow = true;
    hairGroup.add(crown);

    // Flowing back hair curtain draping smoothly behind neck & upper back
    const segU = 28, segV = 18;
    const positions = [], indices = [];
    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV; // 0 = crown -> 1 = mid-back tips
      const y = 0.28 - v * 0.56;
      const spread = 0.135 + v * 0.055;
      const depth = 0.152 + Math.sin(v * Math.PI) * 0.028;
      for (let iu = 0; iu <= segU; iu++) {
        const u = iu / segU; // covers back arc from left cheek to right cheek
        const th = Math.PI * 0.34 + u * Math.PI * 1.32;
        const wave = Math.sin(u * Math.PI * 10 + v * 3.5) * 0.007 * v;
        const x = Math.cos(th) * (spread + wave);
        const z = -Math.sin(th) * (depth + wave) - 0.02;
        positions.push(x, y, z);
      }
    }
    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * stride + iu, b = a + 1, c = (iv + 1) * stride + iu, d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const backGeo = new THREE.BufferGeometry();
    backGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    backGeo.setIndex(indices);
    backGeo.computeVertexNormals();
    const backHair = new THREE.Mesh(backGeo, hairMat);
    backHair.material.side = THREE.DoubleSide;
    backHair.castShadow = true;
    hairGroup.add(backHair);

    // Soft face-framing side locks (left & right)
    for (const side of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.26, 10, 16), hairMat);
      lock.scale.set(0.62, 1.0, 1.15);
      lock.position.set(0.118 * side, 0.11, 0.045);
      lock.rotation.z = -0.10 * side;
      lock.rotation.x = 0.08;
      lock.castShadow = true;
      hairGroup.add(lock);
    }

    // Soft parted forehead bangs
    for (const [ox, oy, oz, rz, sx] of [
      [-0.048, 0.312, 0.112,  0.34, 1.15],
      [ 0.042, 0.315, 0.114, -0.30, 1.25],
      [ 0.000, 0.330, 0.108,  0.04, 1.00]
    ]) {
      const bang = new THREE.Mesh(new THREE.SphereGeometry(0.056, 18, 14), hairMat);
      bang.scale.set(sx, 0.92, 0.45);
      bang.position.set(ox, oy, oz);
      bang.rotation.z = rz;
      bang.rotation.x = -0.22;
      hairGroup.add(bang);
    }

    return hairGroup;
  }
  headPivot.add(buildStyledHair());

  // Living idle animation (gentle breathing + natural periodic blink + micro head sway)
  let blinkTimer = 2.8;
  let blinkPhase = 0;

  function updateIdle(nowSec, dt) {
    // Gentle subtle breathing rise on upper torso
    torsoGroup.position.y = Math.sin(nowSec * 1.65) * 0.0035;
    headPivot.rotation.y = Math.sin(nowSec * 0.55) * 0.045;
    headPivot.rotation.x = Math.sin(nowSec * 0.85) * 0.018;

    // Periodic natural eye blink
    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkPhase <= 0) {
      blinkPhase = 1.0;
      blinkTimer = 3.2 + Math.random() * 2.8;
    }
    let blinkAmt = 0;
    if (blinkPhase > 0) {
      blinkPhase = Math.max(0, blinkPhase - dt * 6.5);
      blinkAmt = Math.sin(blinkPhase * Math.PI);
    }
    for (const lid of eyelids) {
      lid.rotation.x = -0.78 + blinkAmt * 0.95;
    }
  }

  function applySkinTone(tone) {
    upperSkinMat.color.setHex(tone.handHex);
    upperSkinMat.sheenColor.setHex(tone.sheen);
    faceSkinMat.color.setHex(tone.tint);
    faceSkinMat.sheenColor.setHex(tone.sheen);
  }

  return { root, upperSkinMat, faceSkinMat, updateIdle, applySkinTone };
}
