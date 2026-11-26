import { clamp } from './math.js';

// =========================================================================
// REALISTIC WOVEN FABRIC TEARING AUDIO ENGINE (Warm Cloth, Zero Plastic Crinkle)
// =========================================================================
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.pinkBuffer = null;
    this.clothRipBuffer = null;
    this.stretchGain = null;
    this.stretchFilter = null;
    this.lastSnapTime = 0;
    this.lastCreakTick = 0;
    this.ripMomentum = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      const sr = this.ctx.sampleRate;
      const len = sr * 2;

      // 1) Warm Pink Noise Buffer (soft matte textile body, no harsh high-freq plastic/nilon crackle)
      this.pinkBuffer = this.ctx.createBuffer(1, len, sr);
      const pData = this.pinkBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        pData[i] = clamp((b0 + b1 + b2 + b3 + b4 + w * 0.18) * 0.14, -1, 1);
      }

      // 2) Authentic Woven Cloth Ripping Buffer ("RRRRR-RÁCH!")
      this.clothRipBuffer = this.ctx.createBuffer(1, len, sr);
      const rData = this.clothRipBuffer.getChannelData(0);
      let phase = 0;
      let flutterFreq = 105;
      let nextShift = 0;
      let lp1 = 0, lp2 = 0;
      let burstEnv = 0.8;
      for (let i = 0; i < len; i++) {
        if (i >= nextShift) {
          flutterFreq = 78 + Math.random() * 68;
          burstEnv = 0.55 + Math.random() * 0.45;
          nextShift = i + Math.floor(sr * (0.012 + Math.random() * 0.024));
        }
        phase += (flutterFreq / sr) * Math.PI * 2;
        const teeth = 0.30 + 0.70 * Math.pow(0.5 + 0.5 * Math.sin(phase), 1.8);
        const raw = pData[i] * 2.2;
        const x = raw * teeth * burstEnv;
        lp1 = lp1 * 0.52 + x * 0.48;
        lp2 = lp2 * 0.36 + lp1 * 0.64;
        rData[i] = clamp(lp2 * 1.45, -1, 1);
      }

      // Continuous warm muffled cloth stretch friction
      const src = this.ctx.createBufferSource();
      src.buffer = this.pinkBuffer;
      src.loop = true;

      this.stretchFilter = this.ctx.createBiquadFilter();
      this.stretchFilter.type = 'bandpass';
      this.stretchFilter.frequency.value = 780;
      this.stretchFilter.Q.value = 1.4;

      const stretchLp = this.ctx.createBiquadFilter();
      stretchLp.type = 'lowpass';
      stretchLp.frequency.value = 1650;

      this.stretchGain = this.ctx.createGain();
      this.stretchGain.gain.value = 0;

      src.connect(this.stretchFilter);
      this.stretchFilter.connect(stretchLp);
      stretchLp.connect(this.stretchGain);
      this.stretchGain.connect(this.ctx.destination);
      src.start();
    } catch (e) {
      console.warn('Web Audio unavailable:', e);
    }
  }

  playMicroCreak(intensity) {
    if (!this.enabled || !this.ctx || !this.pinkBuffer) return;
    const now = this.ctx.currentTime;
    const minGap = 0.055 + (1 - intensity) * 0.08;
    if (now - this.lastCreakTick < minGap) return;
    this.lastCreakTick = now;

    const src = this.ctx.createBufferSource();
    src.buffer = this.pinkBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(950 + Math.random() * 650, now);
    bp.Q.value = 2.0;

    const g = this.ctx.createGain();
    const peak = 0.045 + intensity * 0.055;
    g.gain.setValueAtTime(0.0005, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.016);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.ctx.destination);
    src.start(now, Math.random() * 1.5, 0.025);
  }

  setStretchIntensity(intensity, velocity = 0) {
    if (!this.ctx || !this.stretchGain) return;
    const now = this.ctx.currentTime;
    if (!this.enabled || intensity < 0.06) {
      this.stretchGain.gain.setTargetAtTime(0, now, 0.045);
      return;
    }
    const rub = Math.min(1, velocity * 0.90 + intensity * 0.22);
    this.stretchGain.gain.setTargetAtTime(rub * 0.085, now, 0.035);
    this.stretchFilter.frequency.setTargetAtTime(620 + intensity * 720 + velocity * 360, now, 0.04);

    if (intensity > 0.78 && (velocity > 0.08 || Math.random() < 0.20)) {
      this.playMicroCreak((intensity - 0.78) / 0.22);
    }
  }

  playSnapBack(strength = 0.6) {
    if (!this.enabled || !this.ctx || !this.pinkBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.pinkBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(290 + strength * 180, now);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.28 * strength, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.062);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.ctx.destination);
    src.start(now, Math.random() * 1.5, 0.08);
  }

  playThreadSnap(cascade = 0, isSheer = false) {
    if (!this.enabled || !this.ctx || !this.clothRipBuffer || !this.pinkBuffer) return;
    const now = this.ctx.currentTime;
    const dt = now - this.lastSnapTime;
    if (dt < 0.028) return;
    this.lastSnapTime = now;

    if (dt < 0.16) this.ripMomentum = Math.min(1.0, this.ripMomentum + 0.36);
    else           this.ripMomentum = Math.max(0.0, this.ripMomentum * 0.25);
    const ripHeat = clamp(this.ripMomentum + (cascade > 1 ? 0.35 : 0), 0, 1);

    // LAYER 1: Warm Mid-Body Woven Cloth Rip ("RRRRR-RÁCH!")
    const ripSrc = this.ctx.createBufferSource();
    ripSrc.buffer = this.clothRipBuffer;
    ripSrc.playbackRate.setValueAtTime((isSheer ? 1.12 : 0.88) + Math.random() * 0.22, now);

    const bodyFlt = this.ctx.createBiquadFilter();
    bodyFlt.type = 'bandpass';
    const f0 = (isSheer ? 920 : 620) + Math.random() * 240;
    const ripDur = (isSheer ? 0.115 : 0.095) + ripHeat * 0.095;
    bodyFlt.frequency.setValueAtTime(f0, now);
    bodyFlt.frequency.exponentialRampToValueAtTime(f0 * (1.35 + ripHeat * 0.30), now + ripDur);
    bodyFlt.Q.value = 0.85;

    const clothLp = this.ctx.createBiquadFilter();
    clothLp.type = 'lowpass';
    clothLp.frequency.setValueAtTime(isSheer ? 2650 : 2150, now);
    clothLp.Q.value = 0.7;

    const ripGain = this.ctx.createGain();
    const peakVol = (isSheer ? 0.44 : 0.52) + ripHeat * 0.18;
    ripGain.gain.setValueAtTime(0.001, now);
    ripGain.gain.linearRampToValueAtTime(peakVol, now + 0.006);
    ripGain.gain.setValueAtTime(peakVol * 0.82, now + ripDur * 0.52);
    ripGain.gain.exponentialRampToValueAtTime(0.0008, now + ripDur);

    ripSrc.connect(bodyFlt);
    bodyFlt.connect(clothLp);
    clothLp.connect(ripGain);
    ripGain.connect(this.ctx.destination);
    ripSrc.start(now, Math.random() * 1.4, ripDur + 0.025);

    // LAYER 2: Fibrous Thread Bite ("Rẹt / Tách")
    const biteSrc = this.ctx.createBufferSource();
    biteSrc.buffer = this.pinkBuffer;
    const biteBp = this.ctx.createBiquadFilter();
    biteBp.type = 'bandpass';
    biteBp.frequency.setValueAtTime((isSheer ? 1650 : 1220) + Math.random() * 420, now);
    biteBp.Q.value = 1.6;

    const biteGain = this.ctx.createGain();
    const biteVol = isSheer ? 0.24 : 0.34;
    biteGain.gain.setValueAtTime(0.001, now);
    biteGain.gain.linearRampToValueAtTime(biteVol, now + 0.0025);
    biteGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.028);

    biteSrc.connect(biteBp);
    biteBp.connect(biteGain);
    biteGain.connect(this.ctx.destination);
    biteSrc.start(now, Math.random() * 1.5, 0.04);
  }

  // Distinct dry woven cotton / wool cloth ripping sound ("XOẸT / RÁCH!") — deeper & crisper than elastic nylon stockings
  playClothRip(cascade = 0, isHeavyWool = false) {
    if (!this.enabled || !this.ctx || !this.clothRipBuffer || !this.pinkBuffer) return;
    const now = this.ctx.currentTime;
    const dt = now - this.lastSnapTime;
    if (dt < 0.036) return;
    this.lastSnapTime = now;

    if (dt < 0.18) this.ripMomentum = Math.min(1.0, this.ripMomentum + 0.40);
    else           this.ripMomentum = Math.max(0.0, this.ripMomentum * 0.25);
    const heat = clamp(this.ripMomentum + (cascade > 1 ? 0.35 : 0), 0, 1);

    // Dry woven fiber rip body
    const src = this.ctx.createBufferSource();
    src.buffer = this.clothRipBuffer;
    src.playbackRate.setValueAtTime((isHeavyWool ? 0.68 : 0.82) + Math.random() * 0.18, now);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const f0 = (isHeavyWool ? 420 : 560) + Math.random() * 160;
    const dur = (isHeavyWool ? 0.145 : 0.125) + heat * 0.11;
    bp.frequency.setValueAtTime(f0, now);
    bp.frequency.exponentialRampToValueAtTime(f0 * 1.55, now + dur);
    bp.Q.value = 0.65;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(isHeavyWool ? 1750 : 2250, now);

    const gain = this.ctx.createGain();
    const vol = (isHeavyWool ? 0.58 : 0.50) + heat * 0.20;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.008);
    gain.gain.setValueAtTime(vol * 0.78, now + dur * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    src.connect(bp);
    bp.connect(lp);
    lp.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(now, Math.random() * 1.3, dur + 0.03);
  }

  playChime(success = true) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = success ? [523.25, 659.25, 783.99, 1046.5] : [310, 230];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.075);
      g.gain.setValueAtTime(0.001, now + i * 0.075);
      g.gain.linearRampToValueAtTime(0.09, now + i * 0.075 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.075 + 0.28);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(now + i * 0.075);
      osc.stop(now + i * 0.075 + 0.30);
    });
  }
}

export const sound = new SoundEngine();
