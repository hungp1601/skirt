import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { appState, DENIER_PRESETS, SKIN_TONES, VIEWS } from './config.js';
import {
  clamp,
  legTFromY,
  getLegCenter,
  getLegSkinRadius,
  setCustomLegProfile,
  getCustomLegProfile
} from './math.js';
import { sound } from './audio.js';
import {
  createConcreteFloorTexture,
  createSkinTextures,
  createStudioBackdropTexture,
  createStudioSoftboxEnv
} from './textures.js';
import { FiberDustSystem } from './effects.js';
import { loadGLBCharacter } from './characterLoader.js';
import { createBodyMeshes } from './body.js';
import { createUpperBody, getPelvisCrossSection } from './upperBody.js';
import { TearablePleatedSkirt } from './skirt.js';
import { TearableSchoolShirt } from './shirt.js';
import { createHandSystem, updateHandPinch } from './hand.js';
import { createStockingSystem } from './stocking.js';
import { createMiniGameController } from './minigame.js';

// =========================================================================
// 1. SCENE, CAMERA, STUDIO SOFTBOX LIGHTING & FLOOR
// =========================================================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = createStudioBackdropTexture();
scene.fog = new THREE.FogExp2(0x111924, 0.055);

const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.04, 40);
camera.position.copy(VIEWS.full.pos);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
container.appendChild(renderer.domElement);

scene.environment = createStudioSoftboxEnv(renderer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.copy(VIEWS.full.target);
controls.minDistance = 0.45;
controls.maxDistance = 6.0;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = Math.PI * 0.88;
controls.minAzimuthAngle = -Infinity;
controls.maxAzimuthAngle = Infinity;
controls.enableRotate = true;
controls.enablePan = true;
controls.enableZoom = true;
controls.zoomSpeed = 0.32;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE
};

// Portrait-Calibrated Studio Lighting
scene.add(new THREE.HemisphereLight(0xf6efe9, 0x3b2d2a, 0.72));

const keyLight = new THREE.DirectionalLight(0xfff3e6, 1.88);
keyLight.position.set(-1.6, 3.8, 2.9);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.4;
keyLight.shadow.camera.far = 9.5;
keyLight.shadow.camera.left = -1.4;
keyLight.shadow.camera.right = 1.4;
keyLight.shadow.camera.top = 3.5;
keyLight.shadow.camera.bottom = -0.3;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffebd9, 0.68);
fillLight.position.set(2.2, 2.0, 2.0);
scene.add(fillLight);

const rimLightRight = new THREE.DirectionalLight(0xffe9d9, 1.55);
rimLightRight.position.set(2.3, 2.5, -1.8);
scene.add(rimLightRight);

const rimLightLeft = new THREE.DirectionalLight(0xd9e8ff, 0.85);
rimLightLeft.position.set(-2.3, 2.2, -1.5);
scene.add(rimLightLeft);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.MeshStandardMaterial({
    map: createConcreteFloorTexture(),
    roughness: 0.84,
    metalness: 0.04,
    envMapIntensity: 0.45,
    color: 0xbcc3cd
  })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// =========================================================================
// 2. INSTANTIATE HANDS & ASYNC GLB CHARACTER + STOCKINGS + OPTIONAL SKIRT
// =========================================================================
const fiberDust = new FiberDustSystem(scene);
const skinTex = createSkinTextures();
const skinSSSUniform = { value: SKIN_TONES.fair.sss.clone() };
const { handSkinMat, mainHand, pinnedHand } = createHandSystem(scene, { skinTex, skinSSSUniform });

let isReady = false;
let skinMat = null;
let upperBody = null;
let skirtCloth = null;
let shirtCloth = null;
let cloths = [];
let applyColorPreset = () => {};
let miniGame = null;

// =========================================================================
// 3. INTERACTION: RAYCASTING, ELASTIC PINCH & TWO-HAND GRAB
// =========================================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const hoverNormal = new THREE.Vector3(0, 0, 1);

let mainGrab = null;
let pinnedGrab = null;

function getHullMeshes() {
  if (!isReady) return [];
  const list = [...cloths.map(c => c.hullMesh), skirtCloth.hullMesh];
  if (shirtCloth) list.push(...shirtCloth.getPickMeshes());
  return list;
}

function updatePointer(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
}

function orientHandAt(hand, point, normal) {
  hand.position.copy(point);
  hand.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
  hand.visible = true;
}

function computeSurfaceNormal(cloth, pt) {
  if (cloth.isShirt) {
    const sp = getCustomLegProfile()?.shirtProfile;
    const cx = sp ? sp.cx : 0;
    const cz = sp ? sp.cz : 0;
    const v = new THREE.Vector3(pt.x - cx, 0.04, pt.z - cz);
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1);
    return v.normalize();
  }
  if (cloth.isSkirt) {
    const sb = getCustomLegProfile()?.skirtBounds;
    const cx = sb ? sb.cx : 0;
    const cz = sb ? sb.cz : 0;
    const v = new THREE.Vector3(pt.x - cx, 0.08, pt.z - cz);
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1);
    return v.normalize();
  }
  const t = legTFromY(pt.y);
  const { cx, cz } = getLegCenter(cloth.side, t);
  const v = new THREE.Vector3(pt.x - cx, 0, pt.z - cz);
  if (v.lengthSq() < 1e-6) v.set(0, 0, 1);
  return v.normalize();
}

function createGrabCluster(cloth, hitPoint, grabRadius = 0.066) {
  const nodes = [];
  for (let i = 0; i < cloth.numNodes; i++) {
    if (cloth.pinned[i] || cloth.intactDegree[i] === 0) continue;
    const i3 = i * 3;
    const dx = cloth.pos[i3] - hitPoint.x;
    const dy = cloth.pos[i3 + 1] - hitPoint.y;
    const dz = cloth.pos[i3 + 2] - hitPoint.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < grabRadius) {
      const weight = Math.exp(-(d * d) / (2 * 0.030 * 0.030));
      nodes.push({ idx: i, ox: dx * 0.50, oy: dy * 0.50, oz: dz * 0.50, weight });
    }
  }
  if (nodes.length === 0) {
    let best = -1, bestD = 0.12;
    for (let i = 0; i < cloth.numNodes; i++) {
      if (cloth.pinned[i] || cloth.intactDegree[i] === 0) continue;
      const i3 = i * 3;
      const d = Math.hypot(cloth.pos[i3] - hitPoint.x, cloth.pos[i3 + 1] - hitPoint.y, cloth.pos[i3 + 2] - hitPoint.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best !== -1) nodes.push({ idx: best, ox: 0, oy: 0, oz: 0, weight: 1.0 });
  }
  return nodes;
}

function onPointerDown(e) {
  if (!isReady || e.target !== renderer.domElement) return;
  sound.init();
  // Chuột phải, Shift+kéo, hoặc chế độ Xoay 360° -> xoay tự do quanh nhân vật
  if (appState.orbitMode || e.shiftKey || (e.pointerType === 'mouse' && e.button !== 0)) {
    mainHand.visible = false;
    return;
  }

  updatePointer(e.clientX, e.clientY);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(getHullMeshes(), false);
  // Bấm ra ngoài nền / mặt / tay -> cho OrbitControls xoay 360° ngay lập tức
  if (hits.length === 0) {
    mainHand.visible = false;
    return;
  }

  const hit = hits[0];
  const cloth = hit.object.userData.cloth;
  const onBow = !!hit.object.userData.isBow;
  const onCollar = !!hit.object.userData.isCollar;
  const onSleeve = !!hit.object.userData.isSleeve;
  const nodes = createGrabCluster(cloth, hit.point, (onBow || onCollar || onSleeve) ? 0.16 : 0.066);
  if (onBow && cloth.bowAnchorNode != null && !nodes.some(n => n.idx === cloth.bowAnchorNode)) {
    nodes.push({ idx: cloth.bowAnchorNode, ox: 0, oy: 0, oz: 0, weight: 1 });
  }
  if (nodes.length === 0 && !onSleeve) return;

  // Đang túm vải để kéo & xé -> khóa camera tạm thời trong cú kéo này
  e.stopImmediatePropagation();
  controls.enabled = false;
  cloth.wake();
  const surfNorm = computeSurfaceNormal(cloth, hit.point);
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), hit.point);

  mainGrab = {
    cloth,
    nodes,
    startPoint: hit.point.clone(),
    startNormal: surfNorm.clone(),
    target: hit.point.clone(),
    prevTarget: hit.point.clone(),
    peakStretchSeen: 0,
    brokeAny: false,
    ripBow: onBow,
    hideCollar: onCollar,
    sleeveMesh: onSleeve ? hit.object : null
  };

  container.classList.add('grabbing');
  orientHandAt(mainHand, hit.point, surfNorm);
}

function onPointerMove(e) {
  if (!isReady) return;
  updatePointer(e.clientX, e.clientY);

  if (mainGrab) {
    raycaster.setFromCamera(pointer, camera);
    const planePt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, planePt)) {
      const delta = planePt.clone().sub(mainGrab.startPoint);
      const dragDist = delta.length();
      const clampedDist = Math.min(dragDist, 0.34);
      if (dragDist > 0.0001) delta.multiplyScalar(clampedDist / dragDist);

      const outwardLift = Math.min(0.15, clampedDist * 0.52);
      mainGrab.prevTarget.copy(mainGrab.target);
      mainGrab.target.copy(mainGrab.startPoint)
        .add(delta)
        .addScaledVector(mainGrab.startNormal, outwardLift);

      if (mainGrab.cloth.isShirt) {
        const sp = getCustomLegProfile()?.shirtProfile;
        const vFrac = clamp((mainGrab.cloth.yTop - mainGrab.target.y) / Math.max(0.05, mainGrab.cloth.yTop - mainGrab.cloth.yBot), 0, 1);
        const surf = mainGrab.cloth.sampleTorsoRadius(vFrac, Math.atan2(mainGrab.target.z - (sp ? sp.cz : 0), mainGrab.target.x - (sp ? sp.cx : 0)));
        const dx = mainGrab.target.x - surf.cx, dz = mainGrab.target.z - surf.cz;
        const r = Math.hypot(dx, dz) || 0.0001;
        const minR = surf.r + 0.018;
        if (r < minR) {
          mainGrab.target.x = surf.cx + (dx / r) * minR;
          mainGrab.target.z = surf.cz + (dz / r) * minR;
        }
      } else if (mainGrab.cloth.isSkirt) {
        const sb = getCustomLegProfile()?.skirtBounds;
        if (sb) {
          if (mainGrab.target.y > sb.yTop * 0.45 + sb.yBot * 0.55) {
            const vFrac = clamp((sb.yTop - mainGrab.target.y) / Math.max(0.05, sb.yTop - sb.yBot), 0, 1);
            const hullT = Math.min(1, vFrac * 1.45);
            const rx = sb.waistRx + (sb.hipRx - sb.waistRx) * hullT + 0.020;
            const rz = sb.waistRz + (sb.hipRz - sb.waistRz) * hullT + 0.022;
            const dx = mainGrab.target.x - sb.cx;
            const dz = mainGrab.target.z - sb.cz;
            const normR = Math.hypot(dx / rx, dz / rz) || 0.0001;
            if (normR < 1.0) {
              mainGrab.target.x = sb.cx + dx / normR;
              mainGrab.target.z = sb.cz + dz / normR;
            }
          }
        } else if (mainGrab.target.y > 1.48) {
          const { rx, rz } = getPelvisCrossSection(mainGrab.target.y);
          const normR = Math.hypot(mainGrab.target.x / (rx + 0.018), mainGrab.target.z / (rz + 0.022)) || 0.0001;
          if (normR < 1.0) {
            mainGrab.target.x /= normR;
            mainGrab.target.z /= normR;
          }
        }
      } else {
        const t = legTFromY(mainGrab.target.y);
        const { cx, cz } = getLegCenter(mainGrab.cloth.side, t);
        const dx = mainGrab.target.x - cx, dz = mainGrab.target.z - cz;
        const r = Math.hypot(dx, dz) || 0.0001;
        const minR = getLegSkinRadius(mainGrab.cloth.side, t, Math.atan2(dz, dx)) + 0.012;
        if (r < minR) {
          mainGrab.target.x = cx + (dx / r) * minR;
          mainGrab.target.z = cz + (dz / r) * minR;
        }
      }

      orientHandAt(mainHand, mainGrab.target, mainGrab.startNormal);
    }
    return;
  }

  if (!appState.orbitMode && e.buttons === 0) {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(getHullMeshes(), false);
    if (hits.length > 0) {
      const hit = hits[0];
      const surfNorm = computeSurfaceNormal(hit.object.userData.cloth, hit.point);
      hoverNormal.copy(surfNorm);
      orientHandAt(mainHand, hit.point, surfNorm);
    } else {
      mainHand.visible = false;
    }
  } else if (!mainGrab) {
    mainHand.visible = false;
  }
}

function onPointerUp() {
  controls.enabled = true;
  if (!mainGrab) return;
  if (mainGrab.peakStretchSeen > 0.32 && !mainGrab.brokeAny) {
    sound.playSnapBack(clamp(mainGrab.peakStretchSeen, 0.35, 1.0));
  }
  mainGrab.cloth.wake();
  mainGrab = null;
  container.classList.remove('grabbing');
  if (!pinnedGrab) sound.setStretchIntensity(0);
}

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// Bắt sự kiện ở pha capture để ưu tiên túm vải khi bấm trúng đồ, còn bấm ngoài thì xoay 360° ngay
renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// =========================================================================
// 4. CAMERA PRESETS, UI CONTROLS & MINI-GAME BINDING
// =========================================================================
let camAnim = null;
function transitionToView(key, btnId) {
  const v = VIEWS[key];
  camAnim = {
    startPos: camera.position.clone(),
    endPos: v.pos.clone(),
    startTarget: controls.target.clone(),
    endTarget: v.target.clone(),
    t: 0
  };
  ['btn-view-full', 'btn-view-face', 'btn-view-1', 'btn-view-2', 'btn-view-side'].forEach(id => {
    document.getElementById(id).classList.toggle('active-view', id === btnId);
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translate(-50%, 0)';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -6px)';
  }, 1700);
}

function clearGrabs() {
  controls.enabled = true;
  mainGrab = null;
  pinnedGrab = null;
  mainHand.visible = false;
  pinnedHand.visible = false;
  container.classList.remove('grabbing');
  document.getElementById('pin-badge').classList.add('hidden');
}

function togglePinHand() {
  if (pinnedGrab) {
    pinnedGrab.cloth.wake();
    pinnedGrab = null;
    pinnedHand.visible = false;
    document.getElementById('pin-badge').classList.add('hidden');
    sound.playSnapBack(0.5);
    showToast('Đã thả Tay 1');
    return;
  }
  if (!mainGrab) {
    showToast('Hãy kéo áo/váy/tất trước rồi nhấn 1 để ghim Tay 1!');
    return;
  }
  pinnedGrab = mainGrab;
  mainGrab = null;
  controls.enabled = true;
  container.classList.remove('grabbing');
  orientHandAt(pinnedHand, pinnedGrab.target, pinnedGrab.startNormal);
  mainHand.visible = false;
  document.getElementById('pin-badge').classList.remove('hidden');
  showToast('Đã ghim Tay 1 — Kéo điểm khác bằng chuột để xé 2 tay!');
}

function repairAllTears(silent = false) {
  if (!isReady) return;
  clearGrabs();
  cloths.forEach(c => c.repair());
  skirtCloth.repair();
  if (shirtCloth) shirtCloth.repair();
  if (!silent) showToast('Đã phục hồi áo, váy & tất như mới!');
}

function rebuildStockingsSize(sizeKey) {
  if (!isReady) return;
  appState.fishnetSize = sizeKey;
  clearGrabs();
  cloths.forEach(c => c.build(sizeKey));
  showToast(sizeKey === 'small' ? 'Mắt lưới nhỏ (mảnh & dày)' : sizeKey === 'medium' ? 'Mắt lưới vừa (cổ điển)' : 'Mắt lưới lớn (cá tính)');
}

// Mode tabs
const tabSandbox = document.getElementById('tab-sandbox');
const tabMinigame = document.getElementById('tab-minigame');
tabSandbox.addEventListener('click', () => {
  if (!isReady) return;
  miniGame.exitToSandbox();
  tabSandbox.className = 'studio-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sky-500 text-white shadow';
  tabMinigame.className = 'studio-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5';
});
tabMinigame.addEventListener('click', () => {
  if (!isReady) return;
  tabMinigame.className = 'studio-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-sky-500 to-rose-500 text-white shadow flex items-center gap-1.5';
  tabSandbox.className = 'studio-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white';
  miniGame.enterMiniGame();
});

// Camera & quick action buttons
document.getElementById('btn-view-full').addEventListener('click', () => transitionToView('full', 'btn-view-full'));
document.getElementById('btn-view-face').addEventListener('click', () => transitionToView('face', 'btn-view-face'));
document.getElementById('btn-view-1').addEventListener('click', () => transitionToView('view1', 'btn-view-1'));
document.getElementById('btn-view-2').addEventListener('click', () => transitionToView('view2', 'btn-view-2'));
document.getElementById('btn-view-side').addEventListener('click', () => transitionToView('side', 'btn-view-side'));
document.getElementById('btn-pin-hand').addEventListener('click', togglePinHand);
document.getElementById('btn-repair').addEventListener('click', () => {
  if (!isReady) return;
  if (appState.gameMode === 'minigame') miniGame.startLevel(appState.levelIndex);
  else repairAllTears();
});

const orbitKeys = { left: false, right: false };
window.addEventListener('keydown', (e) => {
  if (!isReady) return;
  const k = e.key.toLowerCase();
  if (e.key === '1') togglePinHand();
  if (e.key === '2' || k === 'r') {
    if (appState.gameMode === 'minigame') miniGame.startLevel(appState.levelIndex);
    else repairAllTears();
  }
  if (e.key === 'ArrowLeft' || k === 'a') orbitKeys.left = true;
  if (e.key === 'ArrowRight' || k === 'd') orbitKeys.right = true;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowLeft' || k === 'a') orbitKeys.left = false;
  if (e.key === 'ArrowRight' || k === 'd') orbitKeys.right = false;
});

document.getElementById('btn-orbit-toggle').addEventListener('click', () => {
  appState.orbitMode = !appState.orbitMode;
  container.classList.toggle('orbit-mode', appState.orbitMode);
  document.getElementById('orbit-toggle-text').textContent = appState.orbitMode ? 'Xoay 360°' : 'Kéo & Xé';
  if (appState.orbitMode) mainHand.visible = false;
  showToast(appState.orbitMode ? 'Chế độ Xoay 360° (kéo mọi vị trí để xoay)' : 'Kéo đồ để xé • Kéo nền hoặc chuột phải để xoay 360°');
});

document.getElementById('btn-sound').addEventListener('click', () => {
  sound.init();
  sound.enabled = !sound.enabled;
  document.getElementById('icon-sound-on').classList.toggle('hidden', !sound.enabled);
  document.getElementById('icon-sound-off').classList.toggle('hidden', sound.enabled);
  showToast(sound.enabled ? 'Đã bật âm thanh' : 'Đã tắt âm thanh');
});

document.getElementById('btn-settings-toggle').addEventListener('click', () => {
  document.getElementById('settings-panel').classList.toggle('hidden');
});

// Stocking type & denier / mesh size toggles
const btnTypeFishnet = document.getElementById('type-fishnet');
const btnTypeSheer = document.getElementById('type-sheer');
const elFishnetSizeGroup = document.getElementById('fishnet-size-group');
const elSheerDenierGroup = document.getElementById('sheer-denier-group');

function switchStockingType(type) {
  if (!isReady || appState.stockingType === type) return;
  appState.stockingType = type;
  const isSheer = type === 'sheer';
  btnTypeFishnet.className = isSheer
    ? 'studio-btn py-1.5 rounded-lg font-medium text-slate-300 hover:text-white'
    : 'studio-btn py-1.5 rounded-lg font-medium bg-sky-500 text-white shadow';
  btnTypeSheer.className = isSheer
    ? 'studio-btn py-1.5 rounded-lg font-medium bg-sky-500 text-white shadow'
    : 'studio-btn py-1.5 rounded-lg font-medium text-slate-300 hover:text-white';
  elFishnetSizeGroup.classList.toggle('hidden', isSheer);
  elSheerDenierGroup.classList.toggle('hidden', !isSheer);

  clearGrabs();
  const targetPreset = isSheer ? 'small' : appState.fishnetSize;
  cloths.forEach(c => c.build(targetPreset));
  applyColorPreset();
  showToast(isSheer ? 'Tất mỏng không lưới (xuyên thấu Fresnel)' : 'Tất lưới 3D');
}

btnTypeFishnet.addEventListener('click', () => switchStockingType('fishnet'));
btnTypeSheer.addEventListener('click', () => switchStockingType('sheer'));

document.querySelectorAll('.denier-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    appState.sheerDenier = btn.dataset.denier;
    document.querySelectorAll('.denier-btn').forEach(b => {
      b.className = 'denier-btn studio-btn py-1.5 rounded-lg font-medium text-slate-300 hover:text-white';
    });
    btn.className = 'denier-btn studio-btn py-1.5 rounded-lg font-medium bg-white/90 text-slate-900';
    applyColorPreset();
    showToast(`Độ dày ${DENIER_PRESETS[appState.sheerDenier].label}`);
  });
});

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.size-btn').forEach(b => {
      b.className = 'size-btn studio-btn py-1.5 rounded-lg font-medium text-slate-300 hover:text-white';
    });
    btn.className = 'size-btn studio-btn py-1.5 rounded-lg font-medium bg-white/90 text-slate-900';
    rebuildStockingsSize(btn.dataset.size);
  });
});

const sliderStrength = document.getElementById('slider-strength');
const strengthVal = document.getElementById('strength-val');
sliderStrength.addEventListener('input', () => {
  appState.strength = parseFloat(sliderStrength.value);
  if (appState.strength < 2.15) strengthVal.textContent = 'Dễ xé';
  else if (appState.strength < 2.75) strengthVal.textContent = 'Dai vừa';
  else strengthVal.textContent = 'Siêu đàn hồi';
});

const sliderPull = document.getElementById('slider-pull');
const pullVal = document.getElementById('pull-val');
sliderPull.addEventListener('input', () => {
  appState.pullPower = parseFloat(sliderPull.value);
  if (appState.pullPower < 0.75) pullVal.textContent = 'Nhẹ nhàng';
  else if (appState.pullPower < 1.08) pullVal.textContent = 'Tự nhiên';
  else pullVal.textContent = 'Mạnh tay';
});

const colorBtns = {
  black: document.getElementById('color-black'),
  burgundy: document.getElementById('color-burgundy'),
  white: document.getElementById('color-white')
};
Object.entries(colorBtns).forEach(([key, btn]) => {
  btn.addEventListener('click', () => {
    appState.colorKey = key;
    Object.values(colorBtns).forEach(b => b.classList.replace('border-sky-400', 'border-transparent'));
    btn.classList.replace('border-transparent', 'border-sky-400');
    applyColorPreset();
  });
});

// =========================================================================
// 5. MAIN ANIMATION LOOP
// =========================================================================
const elTearPct = document.getElementById('stat-tear-pct');
const elBrokenCount = document.getElementById('stat-broken-count');
const elBarTear = document.getElementById('bar-tear-pct');
const elTensionHud = document.getElementById('tension-hud');
const elTensionBox = document.getElementById('tension-box');
const elTensionBar = document.getElementById('tension-bar');
const elTensionPct = document.getElementById('tension-pct');
const elTensionLbl = document.getElementById('tension-label');

let lastTime = performance.now();

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + 0.05);
    const ease = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.startPos, camAnim.endPos, ease);
    controls.target.lerpVectors(camAnim.startTarget, camAnim.endTarget, ease);
    if (camAnim.t >= 1) camAnim = null;
  }

  if (orbitKeys.left || orbitKeys.right) {
    const dir = (orbitKeys.left ? 1 : 0) - (orbitKeys.right ? 1 : 0);
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dir * dt * 1.9);
    camera.position.copy(controls.target).add(offset);
  }

  controls.update();

  const activeGrabs = [];
  if (mainGrab) activeGrabs.push(mainGrab);
  if (pinnedGrab) activeGrabs.push(pinnedGrab);

  let peakTension = 0;
  let totalBroken = 0;
  let totalStrands = 0;
  const allNewlyBroken = [];

  const simCloths = shirtCloth ? [...cloths, skirtCloth, shirtCloth] : [...cloths, skirtCloth];
  for (let i = 0; i < simCloths.length; i++) {
    const c = simCloths[i];
    const res = c.stepPhysics(activeGrabs);
    if (res.peakTensionRatio > peakTension) peakTension = res.peakTensionRatio;
    if (res.newlyBroken.length > 0) {
      allNewlyBroken.push(...res.newlyBroken);
      if (mainGrab && mainGrab.cloth === c) mainGrab.brokeAny = true;
    }
    totalBroken += c.brokenStrands;
    totalStrands += c.numStrands;
    c.updateVisualGeometry();
  }

  if (upperBody) upperBody.updateIdle(now * 0.001, dt);

  if (mainGrab && peakTension > mainGrab.peakStretchSeen) {
    mainGrab.peakStretchSeen = peakTension;
  }

  fiberDust.step();

  const tremor = peakTension > 0.72 ? (peakTension - 0.72) / 0.28 : 0;
  updateHandPinch(mainHand, mainGrab ? 1 : 0, mainGrab ? tremor : 0);
  updateHandPinch(pinnedHand, pinnedGrab ? 1 : 0, pinnedGrab ? tremor * 0.7 : 0);

  let dragVel = 0;
  if (mainGrab) dragVel = mainGrab.target.distanceTo(mainGrab.prevTarget) * 40;
  sound.setStretchIntensity((mainGrab || pinnedGrab) ? clamp(peakTension, 0, 1) : 0, dragVel);

  if (mainGrab || pinnedGrab) {
    elTensionHud.style.opacity = '1';
    const pct = Math.min(100, Math.round(peakTension * 100));
    elTensionPct.textContent = `${pct}%`;
    elTensionBar.style.width = `${pct}%`;
    if (pct < 70) {
      elTensionLbl.textContent = 'Kéo giãn đàn hồi (An toàn)';
      elTensionLbl.className = 'font-semibold text-sky-300';
      elTensionBar.className = 'h-full bg-gradient-to-r from-sky-400 to-cyan-300 rounded-full transition-all duration-75';
      elTensionBox.classList.remove('danger-pulse');
    } else if (pct < 92) {
      elTensionLbl.textContent = 'Căng cực đại — Sắp rách!';
      elTensionLbl.className = 'font-semibold text-amber-300';
      elTensionBar.className = 'h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-75';
      elTensionBox.classList.remove('danger-pulse');
    } else {
      elTensionLbl.textContent = 'ĐANG XÉ RÁCH!';
      elTensionLbl.className = 'font-bold text-rose-400';
      elTensionBar.className = 'h-full bg-gradient-to-r from-rose-500 to-pink-500 rounded-full transition-all duration-75';
      elTensionBox.classList.add('danger-pulse');
    }
  } else {
    elTensionHud.style.opacity = '0';
    elTensionBox.classList.remove('danger-pulse');
  }

  elBrokenCount.textContent = `${totalBroken} sợi`;
  const tearPct = Math.min(100, (totalBroken / (totalStrands * 0.22)) * 100);
  elTearPct.textContent = `${tearPct.toFixed(1)}%`;
  elBarTear.style.width = `${tearPct.toFixed(1)}%`;

  miniGame.update(dt, peakTension, allNewlyBroken);

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =========================================================================
// 6. ASYNC GLB CHARACTER BOOTSTRAP (With Progress Overlay & Safe Fallback)
// =========================================================================
async function initCharacterScene() {
  const overlay = document.getElementById('loading-overlay');
  const titleEl = document.getElementById('loading-title');
  const barEl = document.getElementById('loading-bar');
  const pctEl = document.getElementById('loading-pct');

  let laceMat = null;
  try {
    const { profile, legSkinMat, laceMat: glbLaceMat } = await loadGLBCharacter(scene, './assets/character.glb', {
      skinTex,
      skinSSSUniform,
      onProgress: (ratio) => {
        const pct = Math.min(99, Math.round(ratio * 100));
        if (barEl) barEl.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
      }
    });
    if (titleEl) titleEl.textContent = 'Đang mặc áo nữ sinh, váy & tất...';
    if (barEl) barEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    skinMat = legSkinMat;
    laceMat = glbLaceMat || null;
    setCustomLegProfile(profile);
  } catch (err) {
    console.error('Không tải được character.glb, dùng model mặc định:', err);
    setCustomLegProfile(null);
    const body = createBodyMeshes(scene);
    skinMat = body.skinMat;
    laceMat = body.laceMat;
    upperBody = createUpperBody(scene, { skinTex, skinSSSUniform });
  }

  skirtCloth = new TearablePleatedSkirt(scene, fiberDust);
  shirtCloth = new TearableSchoolShirt(scene, fiberDust);
  camera.updateMatrixWorld();
  const stockSys = createStockingSystem({ scene, camera, fiberDust, laceMat });
  cloths = stockSys.cloths;
  applyColorPreset = stockSys.applyColorPreset;

  miniGame = createMiniGameController({
    scene,
    repairAllTears,
    transitionToView,
    showToast,
    getGrabState: () => ({ mainGrab, pinnedGrab })
  });

  isReady = true;
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    setTimeout(() => overlay.remove(), 350);
  }

  lastTime = performance.now();
  animate();
}

initCharacterScene();
