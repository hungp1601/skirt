import * as THREE from 'three';

// =========================================================================
// FIBER LINT BURST PARTICLES (Micro-feedback when threads/cloth tear)
// =========================================================================
export class FiberDustSystem {
  constructor(scene, maxCount = 260) {
    this.maxCount = maxCount;
    this.pos = new Float32Array(maxCount * 3);
    this.vel = new Float32Array(maxCount * 3);
    this.life = new Float32Array(maxCount);
    this.cursor = 0;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0x1d232e,
      size: 0.0045,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, count = 3) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.maxCount;
      const i3 = i * 3;
      this.pos[i3] = x + (Math.random() - 0.5) * 0.008;
      this.pos[i3 + 1] = y + (Math.random() - 0.5) * 0.008;
      this.pos[i3 + 2] = z + (Math.random() - 0.5) * 0.008;
      this.vel[i3] = vx + (Math.random() - 0.5) * 0.016;
      this.vel[i3 + 1] = vy + (Math.random() - 0.3) * 0.014;
      this.vel[i3 + 2] = vz + (Math.random() - 0.5) * 0.016;
      this.life[i] = 1.0;
    }
  }

  step() {
    let any = false;
    for (let i = 0; i < this.maxCount; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= 0.025;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.pos[i3 + 1] = -10;
        continue;
      }
      this.vel[i3] *= 0.94;
      this.vel[i3 + 1] = this.vel[i3 + 1] * 0.94 - 0.00035;
      this.vel[i3 + 2] *= 0.94;
      this.pos[i3] += this.vel[i3];
      this.pos[i3 + 1] += this.vel[i3 + 1];
      this.pos[i3 + 2] += this.vel[i3 + 2];
    }
    if (any) this.geo.attributes.position.needsUpdate = true;
  }
}
