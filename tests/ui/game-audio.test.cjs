/* Звук мини-игры проверяется без ушей: мок WebAudio показывает, что каждый
   слот действительно строит узлы, а каждая реплика лежит на диске. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) =>
  fs.readFileSync(path.resolve(__dirname, "..", "..", file), "utf8");

/* карта событий -> слотов берётся из экрана, а не дублируется здесь */
const uiSource = read("app/static/game.js");
const mapBlock = /const SFX_BY_EVENT = \{([\s\S]*?)\n  \};/.exec(uiSource);
const EVENT_SLOTS = [
  ...mapBlock[1].matchAll(/^\s+([a-zA-Z]+):\s*"([a-zA-Z]+)"/gm),
].map((m) => ({ event: m[1], slot: m[2] }));
assert.ok(
  EVENT_SLOTS.length >= 20,
  "карта SFX_BY_EVENT обеднела: " + EVENT_SLOTS.length,
);

function mockContext(log) {
  const param = (name) => ({
    value: 0,
    name,
    setValueAtTime(value, time) {
      this.value = value;
      log.settings.push({ name, value, time });
      return this;
    },
    exponentialRampToValueAtTime(value, time) {
      log.settings.push({ name, value, time });
      return this;
    },
    linearRampToValueAtTime(value, time) {
      log.settings.push({ name, value, time });
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  });
  const node = (kind) => ({
    kind,
    type: "",
    connect(target) {
      log.connects += 1;
      return target;
    },
    disconnect() {},
    start(time) {
      log.starts.push(time);
      return this;
    },
    stop() {
      return this;
    },
    addEventListener() {},
    frequency: param("frequency"),
    detune: param("detune"),
    gain: param("gain"),
    Q: param("Q"),
    playbackRate: param("playbackRate"),
    buffer: null,
    loop: false,
  });
  class AudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.state = "running";
      this.destination = node("destination");
    }
    createGain() {
      log.gains += 1;
      return node("gain");
    }
    createOscillator() {
      log.oscillators += 1;
      return node("oscillator");
    }
    createBiquadFilter() {
      log.filters += 1;
      return node("filter");
    }
    createBufferSource() {
      log.sources += 1;
      return node("bufferSource");
    }
    createBuffer(_channels, length) {
      log.buffers += 1;
      return {
        length,
        getChannelData: () => new Float32Array(length),
      };
    }
    decodeAudioData(data) {
      return Promise.resolve(data);
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    suspend() {
      this.state = "suspended";
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  return AudioContext;
}

function loadAudio() {
  const log = {
    gains: 0,
    oscillators: 0,
    filters: 0,
    sources: 0,
    buffers: 0,
    connects: 0,
    starts: [],
    settings: [],
  };
  const global = {
    AudioContext: mockContext(log),
    console,
    fetch: () => Promise.reject(new Error("в тесте реплики не качаются")),
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext(global);
  vm.runInContext(read("app/static/game-audio.js"), context, {
    filename: "game-audio.js",
  });
  return { audio: context.GameAudio, log };
}

const born = (log) => log.gains + log.oscillators + log.filters + log.sources;

/* экран вызывает синтезатор по СЛОТУ (audio.sfx(SFX_BY_EVENT[e.type])),
   поэтому меряем именно множество слотов, а не имён событий */
const SLOTS = [...new Set(EVENT_SLOTS.map((entry) => entry.slot))];

test("каждый слот карты строит узлы и не падает", () => {
  const { audio, log } = loadAudio();
  assert.equal(audio.available(), true, "мок AudioContext не распознан");
  audio.unlock();
  const failures = [];
  const silent = [];
  for (const slot of SLOTS) {
    const before = born(log);
    try {
      audio.sfx(slot);
    } catch (error) {
      failures.push(slot + " -> " + error.message);
      continue;
    }
    if (born(log) === before) silent.push(slot);
  }
  assert.equal(
    SLOTS.length >= 15,
    true,
    "слотов подозрительно мало: " + SLOTS.length,
  );
  assert.deepEqual(failures, [], "голоса упали на мок-контексте");
  assert.deepEqual(silent, [], "слоты без единого узла — игра молчит");
});

test("выключение звука не создаёт ни одного узла", () => {
  const { audio, log } = loadAudio();
  audio.unlock();
  audio.setMuted(true);
  assert.equal(audio.isMuted(), true);
  const before = born(log);
  for (const slot of SLOTS) audio.sfx(slot);
  assert.equal(born(log), before, "на мьюте синтезатор всё равно работает");
  audio.setMuted(false);
  audio.sfx("knock");
  assert.ok(
    born(log) > before,
    "после включения звука узлы снова должны строиться",
  );
});

test("каждая заявленная реплика лежит в app/static/audio", () => {
  const source = read("app/static/game-audio.js");
  const block = /const SAMPLES = \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(block, "словарь SAMPLES не найден");
  const slots = [...block[1].matchAll(/^\s+([a-zA-Z]+):\s*"([^"]+)"/gm)].map(
    (m) => ({ slot: m[1], file: m[2] }),
  );
  assert.ok(slots.length >= 10, "реплик подозрительно мало: " + slots.length);
  const missing = slots.filter(
    (entry) =>
      !fs.existsSync(
        path.resolve(__dirname, "..", "..", "app/static", entry.file),
      ),
  );
  assert.deepEqual(missing, [], "эти слоты указывают на несуществующий файл");
});

test("TRACK и луп тоже ссылаются на реальные файлы", () => {
  const source = read("app/static/game-audio.js");
  const urls = [...source.matchAll(/"\/static\/audio\/([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(urls.length >= 2, "не нашёл ни трека, ни лупа");
  const missing = urls.filter(
    (file) =>
      !fs.existsSync(
        path.resolve(__dirname, "..", "..", "app/static/audio", file),
      ),
  );
  assert.deepEqual(
    missing,
    [],
    "фон ссылается на отсутствующий файл: " + missing,
  );
});
