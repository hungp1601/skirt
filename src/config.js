import * as THREE from 'three';

export const SKIN_TONES = {
  fair:    { tint: 0xfff9f6, handHex: 0xf1ccbc, sss: new THREE.Vector3(1.0, 0.42, 0.30), sheen: 0xffeae0 },
  natural: { tint: 0xf4dfd0, handHex: 0xe5b79c, sss: new THREE.Vector3(1.0, 0.38, 0.25), sheen: 0xffdcc8 },
  warm:    { tint: 0xdab296, handHex: 0xc99676, sss: new THREE.Vector3(0.98, 0.33, 0.20), sheen: 0xf4c4a2 }
};

export const COLOR_PRESETS = {
  black:    { hex: 0x1b1f28, sheerHex: 0x111318, sheenHex: 0x94a3b8, sheerGlow: new THREE.Vector3(0.42, 0.45, 0.52), dustHex: 0x252b38, laceHex: 0x161a22 },
  burgundy: { hex: 0x69152d, sheerHex: 0x4b0d1f, sheenHex: 0xfb7185, sheerGlow: new THREE.Vector3(0.75, 0.24, 0.36), dustHex: 0x7c1a36, laceHex: 0x520f23 },
  white:    { hex: 0xeef2f7, sheerHex: 0xf1f3f7, sheenHex: 0xffffff, sheerGlow: new THREE.Vector3(0.95, 0.96, 0.98), dustHex: 0xf8fafc, laceHex: 0xe2e8f0 }
};

export const DENIER_PRESETS = {
  '15d': { center: 0.23, edge: 0.72, label: '15D Siêu mỏng' },
  '40d': { center: 0.44, edge: 0.88, label: '40D Mỏng vừa' },
  '80d': { center: 0.74, edge: 0.96, label: '80D Dày mờ' }
};

export const MESH_PRESETS = {
  small:  { NU: 26, NV: 118, halfWidth: 0.00118, knotR: 0.00195 },
  medium: { NU: 20, NV: 94,  halfWidth: 0.00152, knotR: 0.00245 },
  large:  { NU: 15, NV: 70,  halfWidth: 0.00198, knotR: 0.00310 }
};

export const VIEWS = {
  full:  { pos: new THREE.Vector3(0, 1.48, 3.85), target: new THREE.Vector3(0, 1.38, 0.04) },
  face:  { pos: new THREE.Vector3(0, 2.24, 1.32), target: new THREE.Vector3(0, 2.12, 0.04) },
  view1: { pos: new THREE.Vector3(0, 1.54, 1.62), target: new THREE.Vector3(0, 1.48, 0.06) },
  view2: { pos: new THREE.Vector3(0, 0.82, 1.52), target: new THREE.Vector3(0, 0.78, 0.06) },
  side:  { pos: new THREE.Vector3(1.42, 1.42, 1.04), target: new THREE.Vector3(0, 1.36, 0.04) }
};

export const appState = {
  stockingType: 'fishnet', // 'fishnet' | 'sheer'
  showSkirt: true,
  fishnetSize: 'medium',
  sheerDenier: '40d',
  colorKey: 'black',
  strength: 2.45,
  pullPower: 0.90,
  orbitMode: false,
  gameMode: 'sandbox',     // 'sandbox' | 'minigame'
  levelIndex: 0
};
