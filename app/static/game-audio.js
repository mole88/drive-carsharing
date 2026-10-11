/* Звук мини-игры: всё синтезируется WebAudio, файлов нет. */
(function (global) {
  "use strict";

  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let engine = null;
  let noiseBuffer = null;
  let muted = false;
  let scheduler = null;
  let stepIndex = 0;
  let nextNote = 0;
  let musicOn = false;

  const BPM = 152;
  const BASS = [0, 0, 7, 0, 3, 0, 7, 5];
  const LEAD = [12, 15, 19, 15, 12, 10, 12, 15];

  function makeNoise() {
    const length = ctx.sampleRate * 0.7;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function init() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.8;
    sfxGain.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.16;
    musicGain.connect(master);
    noiseBuffer = makeNoise();
    return ctx;
  }

  const freq = (semi) => 110 * Math.pow(2, semi / 12);

  function tone(o) {
    if (!ctx || muted) return;
    const now = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(o.from, now);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), now + o.dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(o.gain || 0.25, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
    osc.connect(gain);
    if (o.filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = o.filter;
      bq.frequency.value = o.cutoff || 900;
      gain.connect(bq);
      bq.connect(o.bus || sfxGain);
    } else gain.connect(o.bus || sfxGain);
    osc.start(now);
    osc.stop(now + o.dur + 0.03);
  }

  function noise(o) {
    if (!ctx || muted) return;
    const now = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = o.rate || 1;
    const bq = ctx.createBiquadFilter();
    bq.type = o.type || "bandpass";
    bq.frequency.setValueAtTime(o.from || 900, now);
    if (o.to) bq.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), now + o.dur);
    bq.Q.value = o.q || 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.gain || 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
    src.connect(bq);
    bq.connect(gain);
    gain.connect(sfxGain);
    src.start(now);
    src.stop(now + o.dur + 0.02);
  }

  const SFX = {
    knock() {
      tone({ from: 520, to: 120, dur: 0.22, type: "triangle", gain: 0.34 });
      tone({ from: 1300, to: 700, dur: 0.1, type: "sine", gain: 0.16, delay: 0.02 });
      noise({ dur: 0.12, from: 1400, to: 300, gain: 0.16 });
    },
    vip() {
      [0, 4, 7, 12].forEach((s, i) =>
        tone({ from: freq(s + 12), dur: 0.16, type: "square", gain: 0.2, delay: i * 0.05 }),
      );
    },
    cash() {
      tone({ from: 1500, dur: 0.05, type: "square", gain: 0.14 });
      tone({ from: 2200, dur: 0.07, type: "square", gain: 0.12, delay: 0.045 });
    },
    power() {
      [0, 5, 9, 14].forEach((s, i) =>
        tone({ from: freq(s + 8), dur: 0.13, type: "triangle", gain: 0.22, delay: i * 0.045 }),
      );
    },
    nitro() {
      noise({ dur: 0.55, from: 300, to: 4200, gain: 0.32, type: "highpass" });
      tone({ from: 160, to: 900, dur: 0.5, type: "sawtooth", gain: 0.16, filter: "lowpass", cutoff: 1800 });
    },
    siren() {
      tone({ from: 700, to: 1150, dur: 0.28, type: "sine", gain: 0.14 });
      tone({ from: 1150, to: 700, dur: 0.28, type: "sine", gain: 0.14, delay: 0.28 });
    },
    encounter() {
      tone({ from: 400, to: 300, dur: 0.3, type: "sawtooth", gain: 0.22, filter: "lowpass", cutoff: 700 });
      noise({ dur: 0.2, from: 500, gain: 0.12 });
    },
    bribe() {
      [12, 9, 7, 4, 0].forEach((s, i) =>
        tone({ from: freq(s + 12), dur: 0.1, type: "square", gain: 0.2, delay: i * 0.055 }),
      );
      noise({ dur: 0.16, from: 3000, to: 1200, gain: 0.12, delay: 0.28 });
    },
    broke() {
      tone({ from: 260, to: 110, dur: 0.35, type: "square", gain: 0.2, filter: "lowpass", cutoff: 500 });
    },
    protocol() {
      tone({ from: 180, to: 70, dur: 0.5, type: "sawtooth", gain: 0.26, filter: "lowpass", cutoff: 420 });
      noise({ dur: 0.4, from: 240, gain: 0.2, type: "lowpass" });
    },
    damage() {
      noise({ dur: 0.3, from: 1600, to: 180, gain: 0.4, type: "lowpass" });
      tone({ from: 220, to: 60, dur: 0.32, type: "square", gain: 0.26 });
    },
    graze() {
      noise({ dur: 0.12, from: 900, to: 300, gain: 0.16, type: "lowpass" });
    },
    ram() {
      noise({ dur: 0.3, from: 2200, to: 240, gain: 0.32 });
      tone({ from: 300, to: 90, dur: 0.3, type: "triangle", gain: 0.24 });
    },
    droneLock() {
      tone({ from: 900, to: 1900, dur: 0.9, type: "sine", gain: 0.13 });
    },
    droneDive() {
      tone({ from: 2000, to: 400, dur: 0.55, type: "sawtooth", gain: 0.17, filter: "highpass" });
      noise({ dur: 0.5, from: 2400, to: 700, gain: 0.14 });
    },
    droneKill() {
      noise({ dur: 0.45, from: 2600, to: 120, gain: 0.36, type: "lowpass" });
      tone({ from: 700, to: 90, dur: 0.4, type: "square", gain: 0.2 });
    },
    spin() {
      tone({ from: 800, to: 200, dur: 0.45, type: "sine", gain: 0.18 });
      noise({ dur: 0.4, from: 600, to: 1400, gain: 0.1 });
    },
    cone() {
      noise({ dur: 0.14, from: 1200, to: 500, gain: 0.14, type: "bandpass" });
    },
    phase() {
      [0, 7, 12, 16].forEach((s, i) =>
        tone({ from: freq(s), dur: 0.4, type: "triangle", gain: 0.16, delay: i * 0.09 }),
      );
    },
    shield() {
      tone({ from: 1400, to: 500, dur: 0.3, type: "sine", gain: 0.2 });
    },
    start() {
      [0, 5, 7, 12].forEach((s, i) =>
        tone({ from: freq(s + 12), dur: 0.18, type: "square", gain: 0.22, delay: i * 0.11 }),
      );
    },
    win() {
      [12, 12, 12, 16, 19, 24].forEach((s, i) =>
        tone({ from: freq(s), dur: 0.3, type: "triangle", gain: 0.24, delay: i * 0.14 }),
      );
    },
    lose() {
      [12, 7, 3, 0].forEach((s, i) =>
        tone({ from: freq(s), dur: 0.42, type: "sawtooth", gain: 0.2, filter: "lowpass", cutoff: 900, delay: i * 0.19 }),
      );
    },
  };

  function scheduleMusic() {
    if (!ctx || !musicOn) return;
    const beat = 60 / BPM / 2;
    while (nextNote < ctx.currentTime + 0.3) {
      const when = Math.max(nextNote, ctx.currentTime + 0.02);
      const i = stepIndex % 8;
      if (!muted) {
        tone({ from: freq(BASS[i]), dur: beat * 0.85, type: "square", gain: 0.3, bus: musicGain, filter: "lowpass", cutoff: 620 });
        if (i % 2 === 0)
          tone({ from: freq(LEAD[i] + 12), dur: beat * 0.5, type: "triangle", gain: 0.16, bus: musicGain });
        if (stepIndex % 4 === 2) noise({ dur: 0.05, from: 5000, gain: 0.06, type: "highpass" });
      }
      nextNote += beat;
      stepIndex += 1;
    }
  }

  const api = {
    available() {
      return !!(global.AudioContext || global.webkitAudioContext);
    },
    unlock() {
      init();
      if (ctx && ctx.state === "suspended") ctx.resume();
      return !!ctx;
    },
    setMuted(value) {
      muted = !!value;
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    isMuted() {
      return muted;
    },
    engine(on, speedNorm, nitro) {
      if (!ctx) return;
      if (on && !engine) {
        const osc = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const gain = ctx.createGain();
        const bq = ctx.createBiquadFilter();
        osc.type = "sawtooth";
        sub.type = "triangle";
        bq.type = "lowpass";
        bq.frequency.value = 700;
        gain.gain.value = 0.0001;
        osc.connect(bq);
        sub.connect(bq);
        bq.connect(gain);
        gain.connect(sfxGain);
        osc.start();
        sub.start();
        engine = { osc, sub, gain, bq };
      }
      if (!engine) return;
      if (!on) {
        engine.gain.gain.value = 0.0001;
        return;
      }
      const now = ctx.currentTime;
      const base = 58 + speedNorm * 130 + (nitro ? 26 : 0);
      engine.osc.frequency.setTargetAtTime(base, now, 0.08);
      engine.sub.frequency.setTargetAtTime(base / 2, now, 0.08);
      engine.bq.frequency.setTargetAtTime(520 + speedNorm * 1500, now, 0.1);
      engine.gain.gain.setTargetAtTime(0.06 + speedNorm * 0.08, now, 0.12);
    },
    sfx(name) {
      if (!ctx) api.unlock();
      if (!ctx || muted || !SFX[name]) return;
      SFX[name]();
    },
    music(on) {
      if (!ctx) api.unlock();
      if (!ctx) return;
      musicOn = !!on;
      if (musicOn) {
        stepIndex = 0;
        nextNote = ctx.currentTime + 0.05;
        if (!scheduler) scheduler = setInterval(scheduleMusic, 40);
      } else if (scheduler) {
        clearInterval(scheduler);
        scheduler = null;
      }
    },
    info() {
      return { state: ctx ? ctx.state : "uninitialised", muted, music: musicOn, available: api.available() };
    },
    suspend() {
      if (ctx && ctx.state === "running") ctx.suspend();
    },
    resume() {
      if (ctx && ctx.state === "suspended") ctx.resume();
    },
  };

  global.GameAudio = api;
})(typeof window !== "undefined" ? window : globalThis);
