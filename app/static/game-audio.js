/* Звук мини-игры: эффекты синтезируются WebAudio, поверх играют присланные реплики,
   фоном — трек из /static/audio. Всё выровнено по измеренной громкости (RMS). */
(function (global) {
  "use strict";

  const TRACK_SRC = "/static/audio/testdrive.mp3";
  const TRACK_FADE_IN = 2600;
  const TRACK_FADE_OUT = 600;
  const TRACK_FALLBACK_LEVEL = 0.12;
  const DUCK_RATIO = 0.32;
  /* Целевая громкость по RMS: трек слышен вместе с репликами, а не под ними. */
  const LEVELS = { comment: 0.085, music: 0.075, loop: 0.07 };
  const GAIN_LIMIT = { min: 0.02, max: 1 };
  const LOOP_SRC = "/static/audio/mellstroy-business-meme.mp3";
  const LOOP_FADE = 0.45;
  /* Уровень шин до ручек громкости: на них накладывается выбор игрока. */
  const BUS = { sfx: 0.8, music: 0.16, master: 0.9 };
  /* Реплики: ключ = слот события, layer играет вместе с синтезом.
     Ключи принимаются и в snake_case (drone_lock == droneLock). */
  const SAMPLES = {
    go: "audio/mellstroy-poehali.mp3",
    nitro: "audio/mellstroy-raduetsa-edited.mp3",
    encounter: "audio/skolkonahui.mp3",
    bribe: "audio/schitaet.mp3",
    win: "audio/bravo.mp3",
    loseWreck: "audio/mellstroy-stop-stop-stop-stop.mp3",
    defeat: "audio/melstroi-vozmushchaetsia.mp3",
    droneLock: "audio/mellstroy-krik1.mp3",
    droneDive: "audio/mellstroy-krik2.mp3",
    babachai: "audio/mellstroy-babachai.mp3",
    banani: "audio/banani.mp3",
    slivi: "audio/slivi.mp3",
    vinograd: "audio/vinograd.mp3",
    damage: "audio/mellstroy-ekh-ty-suka.mp3",
    lose: "audio/mellstroy-obidno-mellstroi-vavfya.mp3",
  };
  /* Слоты, где реплика полностью заменяет синтез (пока файла нет — играет синтезатор). */
  const REPLACE = ["win"];

  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let engine = null;
  let noiseBuffer = null;
  let muted = false;
  /* Ручки громкости: 1 = как измерено, игрок может убрать до 0 или поднять до 1.5 */
  const volumes = { music: 1, sfx: 1 };
  let scheduler = null;
  let stepIndex = 0;
  let nextNote = 0;
  let musicOn = false;
  let track = null;
  let trackRamp = null;
  let trackBroken = false;
  let trackLevel = TRACK_FALLBACK_LEVEL;
  let duckRelease = null;
  const samples = {};
  const loudness = {};
  const levels = {
    comment: {},
    music: TRACK_FALLBACK_LEVEL,
    loop: LEVELS.loop,
  };
  let loopElements = [];
  let loopTimer = null;
  let loopActive = 0;
  let loopOn = false;
  let normalized = false;
  let analyser = null;
  let tapData = null;

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
    master.gain.value = muted ? 0 : BUS.master;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = BUS.sfx * volumes.sfx;
    sfxGain.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = BUS.music * volumes.music;
    musicGain.connect(master);
    noiseBuffer = makeNoise();
    return ctx;
  }

  /* Громкость реплики: измеренная RMS-подстройка поверх неё ручка «звуки». */
  function voiceLevel(slot) {
    const base = levels.comment[slot] || LEVELS.comment;
    return Math.max(0, Math.min(1, base * volumes.sfx));
  }

  /* Луп правил — часть музыкальной шины, поэтому живёт под ручкой «музыка». */
  function loopLevel() {
    return Math.max(0, Math.min(1, levels.loop * volumes.music));
  }

  const freq = (semi) => 110 * Math.pow(2, semi / 12);

  function tone(o) {
    if (!ctx || muted) return;
    const now = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(o.from, now);
    if (o.to)
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, o.to),
        now + o.dur,
      );
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
    if (o.to)
      bq.frequency.exponentialRampToValueAtTime(
        Math.max(60, o.to),
        now + o.dur,
      );
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
      tone({
        from: 1300,
        to: 700,
        dur: 0.1,
        type: "sine",
        gain: 0.16,
        delay: 0.02,
      });
      noise({ dur: 0.12, from: 1400, to: 300, gain: 0.16 });
    },
    vip() {
      [0, 4, 7, 12].forEach((s, i) =>
        tone({
          from: freq(s + 12),
          dur: 0.16,
          type: "square",
          gain: 0.2,
          delay: i * 0.05,
        }),
      );
    },
    cash() {
      tone({ from: 1500, dur: 0.05, type: "square", gain: 0.3 });
      tone({ from: 2200, dur: 0.07, type: "square", gain: 0.26, delay: 0.045 });
    },
    power() {
      [0, 5, 9, 14].forEach((s, i) =>
        tone({
          from: freq(s + 8),
          dur: 0.13,
          type: "triangle",
          gain: 0.32,
          delay: i * 0.045,
        }),
      );
    },
    /* тот же аккорд вниз: сила закончилась, и это надо слышать сразу */
    powerEnd() {
      [14, 9, 5, 0].forEach((s, i) =>
        tone({
          from: freq(s + 8),
          dur: 0.11,
          type: "triangle",
          gain: 0.2,
          delay: i * 0.04,
        }),
      );
    },
    nitro() {
      noise({ dur: 0.55, from: 300, to: 4200, gain: 0.32, type: "highpass" });
      tone({
        from: 160,
        to: 900,
        dur: 0.5,
        type: "sawtooth",
        gain: 0.16,
        filter: "lowpass",
        cutoff: 1800,
      });
    },
    /* Нитро кончилось: игрок обязан слыжать конец щита, а не гадать по полоске */
    nitroEnd() {
      noise({ dur: 0.3, from: 3200, to: 500, gain: 0.14, type: "highpass" });
      tone({
        from: 700,
        to: 140,
        dur: 0.3,
        type: "sawtooth",
        gain: 0.1,
        filter: "lowpass",
        cutoff: 900,
      });
    },
    siren() {
      tone({ from: 700, to: 1150, dur: 0.28, type: "sine", gain: 0.14 });
      tone({
        from: 1150,
        to: 700,
        dur: 0.28,
        type: "sine",
        gain: 0.14,
        delay: 0.28,
      });
    },
    encounter() {
      tone({
        from: 400,
        to: 300,
        dur: 0.3,
        type: "sawtooth",
        gain: 0.22,
        filter: "lowpass",
        cutoff: 700,
      });
      noise({ dur: 0.2, from: 500, gain: 0.12 });
    },
    bribe() {
      [12, 9, 7, 4, 0].forEach((s, i) =>
        tone({
          from: freq(s + 12),
          dur: 0.1,
          type: "square",
          gain: 0.2,
          delay: i * 0.055,
        }),
      );
      noise({ dur: 0.16, from: 3000, to: 1200, gain: 0.12, delay: 0.28 });
    },
    broke() {
      tone({
        from: 260,
        to: 110,
        dur: 0.35,
        type: "square",
        gain: 0.2,
        filter: "lowpass",
        cutoff: 500,
      });
    },
    /* штамп бухгалтера: наличность кончилась, тариф пошёл в долг */
    debt() {
      tone({
        from: 300,
        to: 160,
        dur: 0.18,
        type: "square",
        gain: 0.22,
        filter: "lowpass",
        cutoff: 800,
      });
      noise({
        dur: 0.22,
        from: 800,
        to: 200,
        gain: 0.14,
        type: "lowpass",
        delay: 0.1,
      });
    },
    protocol() {
      tone({
        from: 180,
        to: 70,
        dur: 0.5,
        type: "sawtooth",
        gain: 0.26,
        filter: "lowpass",
        cutoff: 420,
      });
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
      tone({
        from: 2000,
        to: 400,
        dur: 0.55,
        type: "sawtooth",
        gain: 0.17,
        filter: "highpass",
      });
      noise({ dur: 0.5, from: 2400, to: 700, gain: 0.14 });
    },
    droneKill() {
      noise({ dur: 0.45, from: 2600, to: 120, gain: 0.36, type: "lowpass" });
      tone({ from: 700, to: 90, dur: 0.4, type: "square", gain: 0.2 });
    },
    /* уклонился — короткий выдох ветра, чтобы успех был слышно */
    droneMiss() {
      noise({ dur: 0.2, from: 2000, to: 700, gain: 0.12, type: "bandpass" });
      tone({
        from: 1400,
        to: 2100,
        dur: 0.09,
        type: "sine",
        gain: 0.1,
        delay: 0.03,
      });
    },
    spin() {
      tone({ from: 800, to: 200, dur: 0.45, type: "sine", gain: 0.18 });
      noise({ dur: 0.4, from: 600, to: 1400, gain: 0.1 });
    },
    cone() {
      noise({ dur: 0.16, from: 1200, to: 500, gain: 0.34, type: "bandpass" });
    },
    phase() {
      [0, 7, 12, 16].forEach((s, i) =>
        tone({
          from: freq(s),
          dur: 0.4,
          type: "triangle",
          gain: 0.16,
          delay: i * 0.09,
        }),
      );
    },
    shield() {
      tone({ from: 1400, to: 500, dur: 0.3, type: "sine", gain: 0.2 });
    },
    start() {
      [0, 5, 7, 12].forEach((s, i) =>
        tone({
          from: freq(s + 12),
          dur: 0.18,
          type: "square",
          gain: 0.22,
          delay: i * 0.11,
        }),
      );
    },
    win() {
      [12, 12, 12, 16, 19, 24].forEach((s, i) =>
        tone({
          from: freq(s),
          dur: 0.3,
          type: "triangle",
          gain: 0.24,
          delay: i * 0.14,
        }),
      );
    },
    lose() {
      [12, 7, 3, 0].forEach((s, i) =>
        tone({
          from: freq(s),
          dur: 0.42,
          type: "sawtooth",
          gain: 0.2,
          filter: "lowpass",
          cutoff: 900,
          delay: i * 0.19,
        }),
      );
    },
    cheer() {
      [0, 7, 12, 16, 19].forEach((s, i) =>
        tone({
          from: freq(s + 12),
          dur: 0.22,
          type: "square",
          gain: 0.2,
          delay: i * 0.07,
        }),
      );
    },
    go() {
      tone({
        from: 300,
        to: 900,
        dur: 0.4,
        type: "sawtooth",
        gain: 0.22,
        filter: "bandpass",
      });
      tone({ from: 900, dur: 0.2, type: "square", gain: 0.18, delay: 0.4 });
    },
  };

  function scheduleMusic() {
    if (!ctx || !musicOn) return;
    const beat = 60 / BPM / 2;
    while (nextNote < ctx.currentTime + 0.3) {
      const when = Math.max(nextNote, ctx.currentTime + 0.02);
      const i = stepIndex % 8;
      if (!muted) {
        tone({
          from: freq(BASS[i]),
          dur: beat * 0.85,
          type: "square",
          gain: 0.3,
          bus: musicGain,
          filter: "lowpass",
          cutoff: 620,
        });
        if (i % 2 === 0)
          tone({
            from: freq(LEAD[i] + 12),
            dur: beat * 0.5,
            type: "triangle",
            gain: 0.16,
            bus: musicGain,
          });
        if (stepIndex % 4 === 2)
          noise({ dur: 0.05, from: 5000, gain: 0.06, type: "highpass" });
      }
      nextNote += beat;
      stepIndex += 1;
    }
  }

  function startSynth() {
    if (!ctx) return;
    stepIndex = 0;
    nextNote = ctx.currentTime + 0.05;
    if (!scheduler) scheduler = setInterval(scheduleMusic, 40);
  }

  function stopSynth() {
    if (scheduler) {
      clearInterval(scheduler);
      scheduler = null;
    }
  }

  function ensureTrack() {
    if (trackBroken || typeof global.Audio !== "function") return null;
    if (!track) {
      track = new global.Audio(TRACK_SRC);
      track.loop = true;
      track.preload = "auto";
      track.volume = 0;
      track.addEventListener("error", () => {
        trackBroken = true;
      });
    }
    return track;
  }

  function rampTrack(to, ms) {
    if (!track) return;
    if (trackRamp) clearInterval(trackRamp);
    const from = track.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    let done = 0;
    trackRamp = setInterval(() => {
      done += 1;
      const t = Math.min(1, done / steps);
      track.volume = Math.max(
        0,
        Math.min(1, from + (to - from) * (1 - Math.pow(1 - t, 2))),
      );
      if (t >= 1) {
        clearInterval(trackRamp);
        trackRamp = null;
        if (to <= 0.001 && !musicOn) track.pause();
      }
    }, 50);
  }

  const canonical = (name) =>
    String(name).replace(/_+([a-zA-Z])/g, (m, c) => c.toUpperCase());

  function urlOf(file) {
    return file.startsWith("/") ? file : "/static/" + file;
  }

  function slotOf(name) {
    const key = canonical(name);
    return Object.keys(SAMPLES).find((slot) => canonical(slot) === key)
      ? key
      : null;
  }

  async function measure(url) {
    if (loudness[url]) return loudness[url];
    loudness[url] = { rms: 0, duration: 0 };
    try {
      const context = ctx || init();
      const response = await fetch(url);
      const raw = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(raw);
      let sum = 0;
      let n = 0;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < data.length; i += 2) {
          const v = data[i];
          sum += v * v;
          n += 1;
        }
      }
      loudness[url] = {
        rms: Math.sqrt(sum / Math.max(1, n)) || 0.05,
        duration: buffer.duration,
      };
    } catch (error) {
      void error;
      loudness[url] = { rms: 0, duration: 0 };
    }
    return loudness[url];
  }

  function gainTo(rms, target) {
    if (!rms) return target;
    return Math.max(GAIN_LIMIT.min, Math.min(GAIN_LIMIT.max, target / rms));
  }

  const durations = {};

  async function normalizeAll() {
    const jobs = [
      measure(TRACK_SRC).then(
        (m) => (levels.music = gainTo(m.rms, LEVELS.music)),
      ),
    ];
    jobs.push(
      measure(LOOP_SRC).then((m) => (levels.loop = gainTo(m.rms, LEVELS.loop))),
    );
    for (const slot of Object.keys(SAMPLES)) {
      const url = urlOf(SAMPLES[slot]);
      jobs.push(
        measure(url).then((m) => {
          levels.comment[slot] = gainTo(m.rms, LEVELS.comment);
          durations[slot] = m.duration;
          if (samples[slot]) samples[slot].volume = voiceLevel(slot);
        }),
      );
    }
    await Promise.all(jobs);
    if (track) {
      trackLevel = levels.music * volumes.music;
      if (musicOn && !muted) rampTrack(trackLevel, 400);
    }
    return levels;
  }

  function voice(slot) {
    if (samples[slot]) return samples[slot];
    if (typeof global.Audio !== "function") return null;
    const el = new global.Audio(urlOf(SAMPLES[slot]));
    el.preload = "auto";
    el.volume = voiceLevel(slot);
    samples[slot] = el;
    return el;
  }

  function playSample(slot) {
    if (muted) return;
    const el = voice(slot);
    if (!el) return;
    try {
      el.currentTime = 0;
      el.volume = voiceLevel(slot);
      el.play().catch(() => {});
    } catch (error) {
      void error;
    }
    duckFor(Math.max(0.6, durations[slot] || 1));
  }

  function duckFor(seconds) {
    if (!track || trackBroken || !musicOn) return;
    rampTrack(trackLevel * DUCK_RATIO, 120);
    if (duckRelease) clearTimeout(duckRelease);
    duckRelease = setTimeout(
      () => {
        duckRelease = null;
        if (musicOn && !muted) rampTrack(trackLevel, 400);
      },
      seconds * 1000 + 220,
    );
  }

  function loopElement(index) {
    if (loopElements[index]) return loopElements[index];
    const el = new global.Audio(LOOP_SRC);
    el.preload = "auto";
    el.loop = false;
    el.volume = 0;
    loopElements[index] = el;
    return el;
  }

  function fadeElement(el, to, ms, then) {
    const from = el.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    let done = 0;
    const timer = setInterval(() => {
      done += 1;
      const t = Math.min(1, done / steps);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t >= 1) {
        clearInterval(timer);
        if (then) then();
      }
    }, 50);
    return timer;
  }

  function crossfade(from, to, ms, level, then) {
    const steps = Math.max(1, Math.round(ms / 40));
    let done = 0;
    to.volume = 0;
    const timer = setInterval(() => {
      done += 1;
      const t = Math.min(1, done / steps);
      const angle = (t * Math.PI) / 2;
      const gain = muted ? 0 : level;
      from.volume = gain * Math.cos(angle);
      to.volume = gain * Math.sin(angle);
      if (t >= 1) {
        clearInterval(timer);
        if (then) then();
      }
    }, 40);
    return timer;
  }

  function tickLoop() {
    if (!loopOn) return;
    const current = loopElement(loopActive);
    if (!current.duration || !isFinite(current.duration)) {
      if (current.paused) startLoopSide(current);
      return;
    }
    if (current.duration - current.currentTime > LOOP_FADE) return;
    const next = loopElement(loopActive === 0 ? 1 : 0);
    try {
      next.currentTime = 0;
      next.play().catch(() => {});
    } catch (error) {
      void error;
    }
    crossfade(current, next, LOOP_FADE * 1000, loopLevel(), () => {
      current.pause();
      current.volume = 0;
    });
    loopActive = loopActive === 0 ? 1 : 0;
  }

  function startLoopSide(el) {
    try {
      el.currentTime = 0;
      el.volume = 0;
      el.play().catch(() => {});
      fadeElement(el, muted ? 0 : loopLevel(), LOOP_FADE * 1000);
    } catch (error) {
      void error;
    }
  }

  const api = {
    available() {
      return !!(global.AudioContext || global.webkitAudioContext);
    },
    unlock() {
      init();
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (ctx && !normalized) {
        normalized = true;
        normalizeAll();
      }
      return !!ctx;
    },
    setMuted(value) {
      muted = !!value;
      if (master) master.gain.value = muted ? 0 : BUS.master;
      for (const [slot, el] of Object.entries(samples))
        if (el) el.volume = muted ? 0 : voiceLevel(slot);
      for (const el of loopElements) {
        if (!el) continue;
        if (muted) el.volume = 0;
        else if (loopOn) fadeElement(el, loopLevel(), 250);
      }
      if (track && !trackBroken) {
        rampTrack(muted ? 0 : musicOn ? trackLevel : 0, 250);
        if (!muted && musicOn && track.paused) track.play().catch(() => {});
      }
      return muted;
    },
    isMuted() {
      return muted;
    },
    /* Ручка громкости: kind = music|sfx, value = 0..1.5 (1 = как измерено). */
    setVolume(kind, value) {
      const next = Number(value);
      if (!(kind in volumes) || !Number.isFinite(next))
        return Object.assign({}, volumes);
      volumes[kind] = Math.max(0, Math.min(1.5, next));
      if (musicGain) musicGain.gain.value = BUS.music * volumes.music;
      if (sfxGain) sfxGain.gain.value = BUS.sfx * volumes.sfx;
      if (kind === "music") {
        trackLevel = levels.music * volumes.music;
        if (track && !trackBroken)
          rampTrack(muted || !musicOn ? 0 : trackLevel, 120);
        for (const el of loopElements)
          if (el && loopOn && !muted) el.volume = loopLevel();
      } else {
        for (const [slot, el] of Object.entries(samples))
          if (el && !muted) el.volume = voiceLevel(slot);
      }
      return Object.assign({}, volumes);
    },
    getVolume() {
      return Object.assign({}, volumes);
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
      if (muted) return;
      const slot = slotOf(name);
      /* Замена работает, только если реплика действительно докачалась */
      const replaced =
        !!slot && REPLACE.indexOf(canonical(name)) >= 0 && durations[slot] > 0;
      if (!replaced && ctx && SFX[name]) SFX[name]();
      if (slot) playSample(slot);
    },
    comment(name) {
      if (!ctx) api.unlock();
      const slot = slotOf(name);
      if (slot) playSample(slot);
    },
    music(on, restart) {
      if (!ctx) api.unlock();
      musicOn = !!on;
      if (musicOn) api.loop(false);
      const el = ensureTrack();
      if (el && !trackBroken) {
        if (musicOn) {
          stopSynth();
          if (restart) {
            try {
              el.currentTime = 0;
            } catch (error) {
              void error;
            }
          }
          const played = el.play();
          if (played && played.catch)
            played.catch(() => {
              trackBroken = true;
              startSynth();
            });
          rampTrack(muted ? 0 : trackLevel, restart ? TRACK_FADE_IN : 900);
        } else {
          rampTrack(0, TRACK_FADE_OUT);
        }
        return;
      }
      if (!ctx) return;
      if (musicOn) startSynth();
      else stopSynth();
    },
    loop(on) {
      if (typeof global.Audio !== "function") return;
      const wanted = !!on;
      if (wanted === loopOn) return;
      loopOn = wanted;
      if (loopOn) {
        if (musicOn) api.music(false);
        loopActive = 0;
        startLoopSide(loopElement(0));
        if (!loopTimer) loopTimer = setInterval(tickLoop, 60);
      } else {
        if (loopTimer) {
          clearInterval(loopTimer);
          loopTimer = null;
        }
        for (const el of loopElements) {
          if (!el) continue;
          fadeElement(el, 0, 400, () => el.pause());
        }
      }
    },
    async normalize() {
      if (!ctx) api.unlock();
      return normalizeAll();
    },
    duck(on) {
      if (!track || trackBroken || !musicOn) return;
      if (duckRelease) {
        clearTimeout(duckRelease);
        duckRelease = null;
      }
      rampTrack(
        on ? trackLevel * DUCK_RATIO : muted ? 0 : trackLevel,
        on ? 220 : 500,
      );
    },
    tap(on) {
      if (!ctx) api.unlock();
      if (!ctx) return null;
      if (on && !analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        master.connect(analyser);
        tapData = new Float32Array(analyser.fftSize);
      }
      if (!on && analyser) {
        master.disconnect(analyser);
        analyser = null;
      }
      return !!analyser;
    },
    peak() {
      if (!analyser) return null;
      analyser.getFloatTimeDomainData(tapData);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < tapData.length; i++) {
        const v = Math.abs(tapData[i]);
        if (v > peak) peak = v;
        sum += tapData[i] * tapData[i];
      }
      return {
        peak: +peak.toFixed(3),
        rms: +Math.sqrt(sum / tapData.length).toFixed(3),
      };
    },
    cut(name) {
      const slot = slotOf(name);
      const el = slot && samples[slot];
      if (!el || el.paused) return;
      const from = el.volume;
      const steps = 3;
      let done = 0;
      const timer = setInterval(() => {
        done += 1;
        el.volume = Math.max(0, from * (1 - done / steps));
        if (done >= steps) {
          clearInterval(timer);
          el.pause();
          el.volume = voiceLevel(slot);
        }
      }, 40);
    },
    levels() {
      return {
        music: Number(trackLevel.toFixed(3)),
        loop: Number(levels.loop.toFixed(3)),
        comments: Object.fromEntries(
          Object.keys(levels.comment).map((k) => [
            k,
            Number(levels.comment[k].toFixed(3)),
          ]),
        ),
      };
    },
    info() {
      return {
        state: ctx ? ctx.state : "uninitialised",
        muted,
        music: musicOn,
        loop: loopOn,
        available: api.available(),
        track: trackBroken
          ? "fallback-synth"
          : track
            ? "testdrive.mp3"
            : "idle",
        trackVolume: track ? Number(track.volume.toFixed(3)) : 0,
        trackPlaying: track ? !track.paused && !track.ended : false,
        trackTime: track ? Number(track.currentTime.toFixed(1)) : 0,
        trackReady: track ? track.readyState : -1,
        levels: api.levels(),
        volumes: api.getVolume(),
        voices: Object.keys(samples),
        replaced: REPLACE.filter((slot) => durations[slot] > 0),
        voiceStates: Object.fromEntries(
          Object.entries(samples).map(([slot, el]) => [
            slot,
            {
              paused: el.paused,
              t: Number(el.currentTime.toFixed(2)),
              vol: Number(el.volume.toFixed(3)),
            },
          ]),
        ),
        loopInfo: {
          on: loopOn,
          active: loopActive,
          sides: loopElements.map((el) =>
            el
              ? {
                  t: Number(el.currentTime.toFixed(2)),
                  vol: Number(el.volume.toFixed(3)),
                  dur: Number.isFinite(el.duration)
                    ? +el.duration.toFixed(2)
                    : null,
                  paused: el.paused,
                }
              : null,
          ),
        },
      };
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
