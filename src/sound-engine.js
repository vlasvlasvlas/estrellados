import { starToSoundProfile } from "./astro.js";

const SCALE_RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 15 / 8];
const ARP_ACCENT_PATTERN = [1.14, 0.96, 1.02, 1.28, 0.98, 1.08, 0.94, 1.18];
const ARP_REGISTER_PATTERN = [0, 0.12, -0.12, 0.19, -0.05, 0.15, -0.18, 0.08];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function waveformFromSpectral(spectralType) {
  if (spectralType === "O" || spectralType === "B") {
    return "sawtooth";
  }
  if (spectralType === "A" || spectralType === "F") {
    return "triangle";
  }
  if (spectralType === "K" || spectralType === "M") {
    return "square";
  }
  return "sine";
}

function weightedPick(items, weights) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return items[0] || null;
  }

  let roll = Math.random() * total;
  for (let index = 0; index < items.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) {
      return items[index];
    }
  }

  return items[items.length - 1] || null;
}

function musicalFrequency(profile, registerShift = 0) {
  const raw = profile.baseFreq * Math.pow(2, registerShift);
  const root = 55;
  let bestFrequency = raw;
  let bestDistance = Infinity;

  for (let octave = 0; octave <= 6; octave += 1) {
    for (const ratio of SCALE_RATIOS) {
      const candidate = root * Math.pow(2, octave) * ratio;
      const distance = Math.abs(Math.log2(candidate / raw));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestFrequency = candidate;
      }
    }
  }

  return bestFrequency * (1 + (profile.harmonicBrightness - 0.5) * 0.012);
}

export class SoundEngine {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.compressor = null;
    this.noteBus = null;
    this.noteSend = null;
    this.droneBus = null;
    this.delayNode = null;
    this.feedbackGain = null;
    this.echoFilter = null;
    this.reverbSend = null;
    this.reverbConvolver = null;
    this.reverbWetGain = null;

    this.activeDrones = new Map();
    this.arpPool = [];
    this.arpType = "sequential";
    this.onArpStep = null;
    this.lastArpStarId = null;
    this.recentArpIds = [];

    this.bpm = 68;
    this.clockIndex = 0;
    this.arpDirection = 1;
    this.arpStepIndex = 0;
    this.schedulerHandle = null;
    this.lookaheadMs = 45;
    this.scheduleAheadTime = 0.22;
    this.nextStepTime = 0;

    this.masterLevel = 0.86;
    this.noteLevel = 0.92;
    this.droneLevel = 0.42;
    this.delayLevel = 0.62;
    this.reverbLevel = 0.24;
    this.maxDroneVoices = 6;
  }

  describeStar(star) {
    const profile = starToSoundProfile(star);
    return {
      ...profile,
      frequencyHz: musicalFrequency(profile),
      brightness: profile.brightness,
      altitudeNorm: profile.altitudeNorm
    };
  }

  async init() {
    if (!this.audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Context();

      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.masterLevel;

      this.compressor = this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.18;

      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.audioContext.destination);

      this.noteBus = this.audioContext.createGain();
      this.noteBus.gain.value = this.getNoteGain();
      this.noteBus.connect(this.masterGain);

      this.noteSend = this.audioContext.createGain();
      this.noteSend.gain.value = this.getDelaySendGain();
      this.noteBus.connect(this.noteSend);

      this.delayNode = this.audioContext.createDelay(1.2);
      this.delayNode.delayTime.value = 0.32;
      this.feedbackGain = this.audioContext.createGain();
      this.feedbackGain.gain.value = 0.26;
      this.echoFilter = this.audioContext.createBiquadFilter();
      this.echoFilter.type = "lowpass";
      this.echoFilter.frequency.value = 2800;

      this.noteSend.connect(this.delayNode);
      this.delayNode.connect(this.echoFilter);
      this.echoFilter.connect(this.masterGain);
      this.echoFilter.connect(this.feedbackGain);
      this.feedbackGain.connect(this.delayNode);

      this.droneBus = this.audioContext.createGain();
      this.droneBus.gain.value = this.droneLevel;
      this.droneBus.connect(this.masterGain);

      this.reverbSend = this.audioContext.createGain();
      this.reverbSend.gain.value = this.getReverbSendGain();

      this.reverbConvolver = this.audioContext.createConvolver();
      this.reverbConvolver.buffer = this.createImpulseResponse(2.6, 2.2);

      this.reverbWetGain = this.audioContext.createGain();
      this.reverbWetGain.gain.value = this.getReverbWetGain();

      this.noteBus.connect(this.reverbSend);
      this.droneBus.connect(this.reverbSend);
      this.reverbSend.connect(this.reverbConvolver);
      this.reverbConvolver.connect(this.reverbWetGain);
      this.reverbWetGain.connect(this.masterGain);

      this.updateTemporalFx();
      this.startScheduler();
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  createImpulseResponse(durationSeconds = 2.6, decay = 2.2) {
    const sampleRate = this.audioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSeconds));
    const impulse = this.audioContext.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const envelope = Math.pow(1 - index / length, decay);
        data[index] = (Math.random() * 2 - 1) * envelope;
      }
    }

    return impulse;
  }

  getNoteGain() {
    return clamp(this.noteLevel, 0, 1) * 1.36;
  }

  getDelaySendGain(baseMix = null) {
    const beat = 60 / this.bpm;
    const referenceMix = baseMix ?? clamp(0.22 + beat * 0.12, 0.24, 0.36);
    return clamp(referenceMix * clamp(this.delayLevel, 0, 1) * 1.7, 0, 0.72);
  }

  getReverbSendGain() {
    return clamp(this.reverbLevel, 0, 1) * 0.58;
  }

  getReverbWetGain() {
    return clamp(this.reverbLevel, 0, 1) * 0.82;
  }

  getMixState() {
    return {
      noteLevel: this.noteLevel,
      droneLevel: this.droneLevel,
      delayLevel: this.delayLevel,
      reverbLevel: this.reverbLevel
    };
  }

  setMasterLevel(level) {
    this.masterLevel = clamp(Number(level), 0, 1);
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.masterLevel, this.audioContext.currentTime, 0.04);
    }
  }

  setNoteLevel(level) {
    this.noteLevel = clamp(Number(level), 0, 1);
    if (this.noteBus) {
      this.noteBus.gain.setTargetAtTime(this.getNoteGain(), this.audioContext.currentTime, 0.05);
    }
  }

  setDroneLevel(level) {
    this.droneLevel = clamp(Number(level), 0, 1);
    if (this.droneBus) {
      this.droneBus.gain.setTargetAtTime(this.droneLevel, this.audioContext.currentTime, 0.08);
    }
  }

  setDelayLevel(level) {
    this.delayLevel = clamp(Number(level), 0, 1);
    if (this.audioContext && this.noteSend) {
      this.updateTemporalFx();
    }
  }

  setReverbLevel(level) {
    this.reverbLevel = clamp(Number(level), 0, 1);
    if (this.audioContext && this.reverbSend && this.reverbWetGain) {
      const now = this.audioContext.currentTime;
      this.reverbSend.gain.setTargetAtTime(this.getReverbSendGain(), now, 0.08);
      this.reverbWetGain.gain.setTargetAtTime(this.getReverbWetGain(), now, 0.12);
    }
  }

  setBpm(bpm) {
    const next = clamp(Number(bpm), 30, 220);
    if (!Number.isFinite(next) || next === this.bpm) {
      return;
    }

    this.bpm = next;
    if (this.audioContext) {
      this.updateTemporalFx();
      this.nextStepTime = this.audioContext.currentTime + 0.05;
    }
  }

  setArpType(type) {
    this.arpType = type === "weighted" ? "weighted" : "sequential";
  }

  setArpStepCallback(callback) {
    this.onArpStep = typeof callback === "function" ? callback : null;
  }

  updateTemporalFx() {
    if (!this.audioContext) {
      return;
    }

    const beat = 60 / this.bpm;
    const now = this.audioContext.currentTime;
    const delayTime = clamp(beat * 0.75, 0.22, 0.62);
    const feedback = clamp(0.18 + beat * 0.14, 0.2, 0.38);
    const baseMix = clamp(0.22 + beat * 0.12, 0.24, 0.36);

    this.delayNode.delayTime.setTargetAtTime(delayTime, now, 0.05);
    this.feedbackGain.gain.setTargetAtTime(feedback, now, 0.08);
    this.noteSend.gain.setTargetAtTime(this.getDelaySendGain(baseMix), now, 0.08);
  }

  updateArpPool(stars) {
    const hadPool = this.arpPool.length > 0;
    this.arpPool = stars.slice();
    if (!this.arpPool.some((star) => star.id === this.lastArpStarId)) {
      this.lastArpStarId = null;
      this.recentArpIds = [];
    }
    if (!this.arpPool.length) {
      this.clockIndex = 0;
      this.arpDirection = 1;
      return;
    }
    if (this.clockIndex >= this.arpPool.length || this.clockIndex < 0) {
      this.clockIndex = 0;
    }
    if (!hadPool && this.arpPool.length && this.audioContext) {
      this.nextStepTime = this.audioContext.currentTime + 0.05;
    }
  }

  async playStar(star) {
    await this.init();
    const when = this.audioContext.currentTime + 0.01;
    const duration = clamp((60 / this.bpm) * 0.98, 0.42, 1.24);
    this.scheduleNote(star, when, {
      duration,
      accent: 1.42,
      registerShift: 0.08
    });
  }

  stopDroneById(starId, fadeTime = 1.1) {
    if (!this.audioContext || !this.activeDrones.has(starId)) {
      return;
    }

    const now = this.audioContext.currentTime;
    const voice = this.activeDrones.get(starId);
    try {
      voice.gain.gain.setTargetAtTime(0.0001, now, 0.28);
      voice.osc.stop(now + fadeTime);
      if (voice.shimmer) {
        voice.shimmer.stop(now + fadeTime);
      }
      if (voice.lfo) {
        voice.lfo.stop(now + fadeTime);
      }
    } catch {
      // best effort
    }
    this.activeDrones.delete(starId);
  }

  stopAllDrones() {
    for (const starId of this.activeDrones.keys()) {
      this.stopDroneById(starId, 0.9);
    }
  }

  async toggleDrone(star) {
    await this.init();

    if (this.activeDrones.has(star.id)) {
      this.stopDroneById(star.id, 1.1);
      return false;
    }

    if (this.activeDrones.size >= this.maxDroneVoices) {
      let oldestStarId = null;
      let oldestStartedAt = Number.POSITIVE_INFINITY;
      for (const [starId, voice] of this.activeDrones.entries()) {
        if (voice.startedAt < oldestStartedAt) {
          oldestStartedAt = voice.startedAt;
          oldestStarId = starId;
        }
      }
      if (oldestStarId) {
        this.stopDroneById(oldestStarId, 0.8);
      }
    }

    const profile = starToSoundProfile(star);
    const baseFrequency = musicalFrequency(profile, -1.05);
    const now = this.audioContext.currentTime;

    const osc = this.audioContext.createOscillator();
    const shimmer = this.audioContext.createOscillator();
    const shimmerGain = this.audioContext.createGain();
    const lfo = this.audioContext.createOscillator();
    const lfoDepth = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();
    const panner = this.audioContext.createStereoPanner();
    const gain = this.audioContext.createGain();

    osc.type = waveformFromSpectral(profile.spectralType);
    osc.frequency.value = baseFrequency;

    shimmer.type = "sine";
    shimmer.frequency.value = baseFrequency * (1.495 + profile.harmonicBrightness * 0.3);
    shimmerGain.gain.value = 0.006 + profile.brightness * 0.018;

    lfo.type = "sine";
    lfo.frequency.value = 0.028 + profile.distanceNorm * 0.11;
    lfoDepth.gain.value = baseFrequency * 0.035;
    lfo.connect(lfoDepth);
    lfoDepth.connect(osc.frequency);

    filter.type = "bandpass";
    filter.frequency.value = 210 + profile.harmonicBrightness * 2400;
    filter.Q.value = 1.8 + profile.altitudeNorm * 1.6;

    panner.pan.value = profile.pan * 0.9;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.038 + profile.brightness * 0.068, now + 1.2);

    osc.connect(filter);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(filter);
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.droneBus);

    osc.start(now);
    shimmer.start(now);
    lfo.start(now);

    this.activeDrones.set(star.id, {
      osc,
      shimmer,
      lfo,
      gain,
      startedAt: Date.now()
    });
    return true;
  }

  startScheduler() {
    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle);
    }

    this.nextStepTime = this.audioContext.currentTime + 0.08;
    this.schedulerHandle = setInterval(() => this.scheduleLoop(), this.lookaheadMs);
  }

  scheduleLoop() {
    if (!this.audioContext || this.audioContext.state !== "running") {
      return;
    }
    if (!this.arpPool.length) {
      return;
    }
    if (this.nextStepTime < this.audioContext.currentTime - 0.5) {
      this.nextStepTime = this.audioContext.currentTime + 0.05;
    }

    const stepDuration = 60 / this.bpm / 2;
    while (this.nextStepTime < this.audioContext.currentTime + this.scheduleAheadTime) {
      this.scheduleTick(this.nextStepTime);
      this.nextStepTime += stepDuration;
    }
  }

  rememberArpStar(starId) {
    this.lastArpStarId = starId;
    this.recentArpIds = [starId, ...this.recentArpIds.filter((id) => id !== starId)].slice(0, 4);
  }

  pickSequentialStar() {
    if (!this.arpPool.length) {
      return null;
    }
    if (this.arpPool.length === 1) {
      return this.arpPool[0];
    }

    const star = this.arpPool[this.clockIndex];
    this.clockIndex += this.arpDirection;

    if (this.clockIndex >= this.arpPool.length) {
      this.clockIndex = this.arpPool.length - 2;
      this.arpDirection = -1;
    } else if (this.clockIndex < 0) {
      this.clockIndex = 1;
      this.arpDirection = 1;
    }

    return star;
  }

  pickWeightedStar() {
    const weights = this.arpPool.map((candidate) => {
      const profile = starToSoundProfile(candidate);
      const brightnessWeight = 0.55 + profile.brightness * 1.7;
      const altitudeWeight = 0.84 + profile.altitudeNorm * 0.92;
      const recencyPenalty = this.recentArpIds.includes(candidate.id) ? 0.24 : 1;
      return brightnessWeight * altitudeWeight * recencyPenalty;
    });

    return weightedPick(this.arpPool, weights);
  }

  scheduleTick(when) {
    if (!this.arpPool.length) {
      return;
    }

    const stepIndex = this.arpStepIndex % ARP_ACCENT_PATTERN.length;
    const star = this.arpType === "weighted" ? this.pickWeightedStar() : this.pickSequentialStar();
    if (!star) {
      return;
    }

    this.arpStepIndex += 1;
    this.rememberArpStar(star.id);
    this.scheduleNote(star, when, {
      duration: clamp((60 / this.bpm) * 0.64, 0.24, 0.62),
      accent: ARP_ACCENT_PATTERN[stepIndex],
      registerShift: ARP_REGISTER_PATTERN[stepIndex]
    });

    if (this.onArpStep) {
      try {
        this.onArpStep(star, when);
      } catch {
        // ignore UI callback failures
      }
    }
  }

  scheduleNote(star, when, options = {}) {
    const profile = starToSoundProfile(star);
    const frequency = musicalFrequency(profile, options.registerShift || 0);
    const duration = options.duration || 0.28;
    const accent = options.accent || 1;

    const osc = this.audioContext.createOscillator();
    const body = this.audioContext.createOscillator();
    const bodyGain = this.audioContext.createGain();
    const shimmer = this.audioContext.createOscillator();
    const shimmerGain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();
    const panner = this.audioContext.createStereoPanner();
    const gain = this.audioContext.createGain();

    osc.type = waveformFromSpectral(profile.spectralType);
    osc.frequency.setValueAtTime(frequency, when);

    body.type = profile.spectralType === "K" || profile.spectralType === "M" ? "square" : "triangle";
    body.frequency.setValueAtTime(frequency * 0.5, when);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime((0.014 + profile.brightness * 0.022) * accent, when + 0.024);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.82);

    shimmer.type = "sine";
    shimmer.frequency.setValueAtTime(frequency * (1.5 + profile.harmonicBrightness * 0.26), when);
    shimmerGain.gain.setValueAtTime(0.005 + profile.brightness * 0.05, when);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200 + (1 - profile.distanceNorm) * 6800 + accent * 180, when);
    filter.frequency.exponentialRampToValueAtTime(
      900 + (1 - profile.distanceNorm) * 1800,
      when + duration * 0.86
    );
    filter.Q.value = 1.2 + profile.harmonicBrightness * 2.8;

    panner.pan.setValueAtTime(profile.pan * 0.82, when);

    const peakGain = (0.075 + profile.brightness * 0.15) * accent;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peakGain, when + 0.022);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    body.connect(bodyGain);
    bodyGain.connect(filter);
    osc.connect(filter);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(filter);
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.noteBus);

    body.start(when);
    osc.start(when);
    shimmer.start(when);
    body.stop(when + duration + 0.04);
    osc.stop(when + duration + 0.04);
    shimmer.stop(when + duration + 0.04);
  }
}
