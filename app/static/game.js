/* Экран мини-игры: связывает ядро, графику, звук, ввод и интерфейс. */
(function (global) {
  "use strict";
  const core = global.GameCore;
  const art = global.GameArt;
  const audio = global.GameAudio;
  const canvas = document.getElementById("drive-canvas");
  if (!core || !art || !canvas) return;

  const $ = (id) => document.getElementById(id);
  const W = core.WORLD;
  const CAR_COLORS = [
    ["#d5ff5f", "#a8d43a", "#eaf5cf"],
    ["#7fd1ff", "#4aa8dd", "#d5f2ff"],
    ["#ff9ec7", "#e0679c", "#ffe0ef"],
    ["#ffd85e", "#e0aa2e", "#fff3c4"],
    ["#a5ffef", "#5fd7c4", "#ddfff8"],
    ["#ff8f6a", "#e0603c", "#ffdcd0"],
    ["#c4b5fd", "#8f7ad8", "#eee7ff"],
    ["#9db3a7", "#6f8a7c", "#e2ece6"],
  ];
  const RECORD_KEY = "drive.nightshift.records.v1";
  const CAR_KEY = "drive.selectedCar";

  const state = {
    world: null,
    mode: "intro",
    scroll: 0,
    shake: 0,
    flash: 0,
    hitStop: 0,
    last: 0,
    keys: Object.create(null),
    pointer: { active: false, x: 0 },
    touchBribe: false,
    touchNitro: false,
    calm: false,
    muted: false,
    coach: [],
    coachIndex: 0,
    coachTimer: 0,
    shownHearts: -1,
    shownHeat: -1,
    record: null,
    dpr: 1,
    view: { scale: 1, ox: 0, oy: 0, w: 0, h: 0 },
    car: null,
  };

  try {
    state.calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {
    void error;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const depth = (y) => 0.8 + 0.36 * clamp(y / W.height, 0, 1);
  const money = (kopecks) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(kopecks) + " ₽";

  function records() {
    try {
      return JSON.parse(localStorage.getItem(RECORD_KEY)) || { cars: {}, total: {} };
    } catch (error) {
      void error;
      return { cars: {}, total: {} };
    }
  }
  function saveRecord(carId, result) {
    const all = records();
    const key = "car" + carId;
    const prev = all.cars[key] || { best: 0, runs: 0, knockdowns: 0, combo: 1, cash: 0 };
    const isBest = result.score > prev.best;
    all.cars[key] = {
      best: Math.max(prev.best, result.score),
      runs: prev.runs + 1,
      knockdowns: prev.knockdowns + result.knockdowns,
      combo: Math.max(prev.combo, result.bestCombo),
      cash: prev.cash + result.cash,
    };
    all.total = {
      runs: (all.total.runs || 0) + 1,
      knockdowns: (all.total.knockdowns || 0) + result.knockdowns,
      best: Math.max(all.total.best || 0, result.score),
    };
    try {
      localStorage.setItem(RECORD_KEY, JSON.stringify(all));
    } catch (error) {
      void error;
    }
    return isBest;
  }

  function carPalette(car) {
    const id = Number(car && car.id) || 0;
    return CAR_COLORS[id % CAR_COLORS.length];
  }

  function defaultCar() {
    return {
      id: 0,
      brand: "Драйв",
      model: "Ночной",
      plate: "Н000НО193",
      category: "comfort",
      address: "",
      demo: true,
    };
  }

  async function loadCar() {
    const id = Number(new URLSearchParams(location.search).get("car")) || 0;
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(CAR_KEY));
    } catch (error) {
      void error;
    }
    if (stored && (!id || Number(stored.id) === id)) return stored;
    if (!id) return defaultCar();
    try {
      const res = await fetch("/api/cars?limit=100", { credentials: "same-origin" });
      if (!res.ok) throw new Error("catalog");
      const cars = await res.json();
      return cars.find((c) => c.id === id) || cars[0] || defaultCar();
    } catch (error) {
      void error;
      return defaultCar();
    }
  }

  function createWorld(attract) {
    const car = state.car || defaultCar();
    const palette = carPalette(car);
    const world = core.createRun({
      carId: car.id,
      carName: (car.brand || "") + " " + (car.model || ""),
      plate: car.plate,
      category: car.category,
      difficulty: ($("drive-difficulty") || {}).value || "normal",
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffff)) & 0xffffff,
      color: palette[0],
      accent: palette[1],
    });
    world.car.color = palette[0];
    world.car.light = palette[2];
    world.car.dark = palette[1];
    world.attract = !!attract;
    if (attract) {
      world.player.invuln = 1e9;
      world.timers.target = 0.4;
      world.timers.cash = 0.8;
    }
    return world;
  }

  /* ---------- ввод ---------- */
  const KEYMAP = {
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right",
    KeyW: "fast",
    ArrowUp: "fast",
    KeyS: "slow",
    ArrowDown: "slow",
    Space: "bribe",
    KeyE: "bribe",
    ShiftLeft: "nitro",
    ShiftRight: "nitro",
    ControlLeft: "nitro",
  };

  function typingInField(target) {
    return !!(target && target.closest && target.closest("input,select,textarea"));
  }

  window.addEventListener("keydown", (e) => {
    if (typingInField(e.target)) return;
    const name = KEYMAP[e.code];
    if (name) {
      if (!state.keys[name]) state.keys[name + "Pressed"] = true;
      state.keys[name] = true;
      if (name === "bribe" || e.code === "ArrowUp" || e.code === "ArrowDown") e.preventDefault();
    }
    if (e.code === "KeyP" || e.code === "Escape") togglePause();
    if (e.code === "KeyR" && state.mode !== "intro") restart();
    if (e.code === "KeyM") setMuted(!state.muted);
    if (e.code === "Enter" && state.mode === "intro") start();
    if (e.code === "Enter" && state.mode === "result") restart();
  });
  window.addEventListener("keyup", (e) => {
    const name = KEYMAP[e.code];
    if (name) state.keys[name] = false;
  });
  window.addEventListener("blur", () => {
    state.keys = Object.create(null);
    if (state.mode === "playing") togglePause(true);
  });

  function worldFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    return x * W.width;
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (state.mode !== "playing") return;
    state.pointer.active = true;
    state.pointer.x = worldFromPointer(e);
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    audio.unlock();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (state.pointer.active) state.pointer.x = worldFromPointer(e);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"])
    canvas.addEventListener(type, () => {
      state.pointer.active = false;
    });

  function bindHold(id, prop) {
    const el = $(id);
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      state[prop] = true;
      state[prop + "Pressed"] = true;
      audio.unlock();
    };
    const off = () => {
      state[prop] = false;
    };
    el.addEventListener("pointerdown", on);
    for (const type of ["pointerup", "pointercancel", "pointerleave"])
      el.addEventListener(type, off);
  }
  bindHold("touch-bribe", "touchBribe");
  bindHold("touch-nitro", "touchNitro");

  function input() {
    const k = state.keys;
    const p = state.pointer;
    const world = state.world;
    let steer = 0;
    let throttle = 0;
    if (p.active && world) {
      steer = clamp((p.x - world.player.x) / 130, -1, 1);
      throttle = 1;
    }
    const out = {
      left: !!k.left,
      right: !!k.right,
      fast: !!k.fast,
      slow: !!k.slow,
      steer,
      throttle,
      bribe: !!(k.bribePressed || state.touchBribePressed),
      nitro: !!(k.nitroPressed || state.touchNitroPressed),
    };
    k.bribePressed = false;
    k.nitroPressed = false;
    state.touchBribePressed = false;
    state.touchNitroPressed = false;
    if (state.mode !== "playing") {
      out.bribe = false;
      out.nitro = false;
    }
    return out;
  }

  /* ---------- цикл ---------- */
  function step(dt) {
    const world = state.world;
    if (!world) return;
    if (state.hitStop > 0) {
      state.hitStop -= dt;
      return;
    }
    if (world.attract) {
      core.step(world, dt * 0.85, {});
      world.player.invuln = 1e9;
      world.player.heat = Math.max(0, world.player.heat - dt * 0.8);
      world.player.score = 0;
      if (world.status !== "running") state.world = createWorld(true);
    } else if (world.status === "running") {
      core.step(world, dt, input());
    }
    state.scroll += world.player.speed * W.pxPerKmh * dt * (world.attract ? 0.85 : 1);
    consumeEvents();
  }

  const SFX_BY_EVENT = {
    knock: "knock",
    cash: "cash",
    power: "power",
    bribe: "bribe",
    protocol: "protocol",
    broke: "broke",
    damage: "damage",
    graze: "graze",
    ram: "ram",
    nitro: "nitro",
    encounter: "encounter",
    copSpawn: "siren",
    droneLock: "droneLock",
    droneDive: "droneDive",
    droneKill: "droneKill",
    droneSpawn: "siren",
    cone: "cone",
    spin: "spin",
    shieldBreak: "shield",
    phase: "phase",
  };

  function consumeEvents() {
    const world = state.world;
    if (!world) return;
    for (const e of world.events) {
      if (world.attract) continue;
      const sfx = SFX_BY_EVENT[e.type];
      if (sfx) audio.sfx(sfx);
      if (e.type === "knock") {
        state.hitStop = e.vip ? 0.07 : 0.045;
        if (!state.calm) state.shake = Math.min(26, state.shake + (e.vip ? 16 : 9));
        if (e.combo >= 5 && e.combo % 5 === 0) audio.sfx("vip");
      }
      if (e.type === "damage" || e.type === "ram") {
        state.flash = 0.32;
        if (!state.calm) state.shake = Math.min(34, state.shake + 22);
      }
      if (e.type === "nitro") state.flash = 0.2;
      if (e.type === "phase") {
        world.fx.push({
          kind: "pop",
          text: e.name.toUpperCase(),
          x: W.width / 2,
          y: 520,
          tone: "gold",
          life: 0,
          ttl: 2,
          vy: -14,
        });
      }
      if (e.type === "finished") showResult(e.reason);
    }
    world.events.length = 0;
  }

  function loop(now) {
    const dt = clamp((now - (state.last || now)) / 1000, 0, 0.05);
    state.last = now;
    if (state.mode !== "paused") {
      step(dt);
      render(dt);
      hud(dt);
    }
    requestAnimationFrame(loop);
  }

  /* ---------- отрисовка ---------- */
  function fit() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(rect.width * dpr));
    const ph = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      state.dpr = dpr;
    }
    const scale = Math.min(pw / W.width, ph / W.height);
    state.view = {
      scale,
      ox: (pw - W.width * scale) / 2,
      oy: (ph - W.height * scale) / 2,
      w: pw,
      h: ph,
    };
  }

  function render(dt) {
    const world = state.world;
    fit();
    const view = state.view;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#08120f";
    ctx.fillRect(0, 0, view.w, view.h);
    if (!world) return;

    state.shake = Math.max(0, state.shake - dt * 60);
    if (state.flash > 0) state.flash -= dt * 2;
    const shakeX = state.calm ? 0 : (Math.random() - 0.5) * state.shake;
    const shakeY = state.calm ? 0 : (Math.random() - 0.5) * state.shake;
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox + shakeX, view.oy + shakeY);

    const phase = core.phaseInfo(world);
    art.background(ctx, {
      w: W.width,
      h: W.height,
      world,
      scroll: state.scroll,
      phase,
      roadTop: W.roadTop,
      roadLeft: W.roadLeft,
      roadRight: W.roadRight,
      lanes: W.lanes,
    });
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, W.roadTop - 4, W.width, W.height - W.roadTop + 4);
    ctx.clip();

    const time = world.time;
    for (const s of world.props)
      if (s.kind === "oil" || s.kind === "pothole") art.prop(ctx, s);

    const list = [];
    for (const t of world.targets) list.push({ y: t.y, kind: "target", o: t });
    for (const c of world.cops) list.push({ y: c.y, kind: "cop", o: c });
    for (const d of world.drones) list.push({ y: d.y + 40, kind: "drone", o: d });
    for (const s of world.props)
      if (s.kind !== "oil" && s.kind !== "pothole") list.push({ y: s.y, kind: "prop", o: s });
    for (const q of world.pickups) list.push({ y: q.y, kind: "pickup", o: q });
    list.push({ y: world.player.y, kind: "player", o: world.player });
    list.sort((a, b) => a.y - b.y);

    for (const item of list) {
      const o = item.o;
      const scale = depth(item.y);
      if (item.kind === "target") {
        o.alarmed = Math.max(0, (o.alarmed || 0) - dt);
        if (
          o.state === "walking" &&
          world.player.speed > 90 &&
          Math.abs(o.x - world.player.x) < 150 &&
          o.y < world.player.y &&
          o.y > world.player.y - 420
        )
          o.alarmed = 0.4;
        art.target(ctx, o, { scale, time });
      } else if (item.kind === "cop") {
        art.policeCar(ctx, o, { scale, time, beam: o.mode === "pursue" || world.player.encounter });
      } else if (item.kind === "drone") {
        art.drone(ctx, o, { scale, time });
      } else if (item.kind === "prop") {
        art.prop(ctx, o);
      } else if (item.kind === "pickup") {
        art.pickup(ctx, o, { scale });
      } else if (item.kind === "player") {
        const blink = world.player.invuln > 0 && world.player.invuln < 1e8;
        if (!(blink && !state.calm && Math.floor(time * 14) % 2))
          art.playerCar(ctx, {
            x: o.x,
            y: o.y,
            width: o.width,
            height: o.height,
            tilt: o.tilt,
            bounce: o.bounce,
            scale,
            color: world.car.color,
            colorLight: world.car.light,
            colorDark: world.car.dark,
            roof: world.car.light,
            pillar: world.car.dark,
            plate: world.car.plate,
            nitro: o.nitroTime > 0,
            shield: o.powers.shield > 0,
            time,
          });
      }
    }

    for (const d of world.drones)
      if (d.state === "lock") art.droneTarget(ctx, d, world.player.y, "#ff4d5e");

    for (const f of world.fx) {
      if (f.kind === "shake") {
        if (!f.applied && !state.calm) {
          f.applied = true;
          state.shake = Math.min(34, state.shake + f.power);
        }
        continue;
      }
      art.fx(ctx, f, time);
    }
    ctx.restore();

    screenLayer(ctx, world, view, dt);
  }

  function screenLayer(ctx, world, view, dt) {
    const p = world.player;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const w = view.w;
    const h = view.h;

    if (p.nitroTime > 0 || p.speed > world.cls.maxSpeed * 0.93) {
      const strength = p.nitroTime > 0 ? 1 : 0.4;
      ctx.strokeStyle = p.nitroTime > 0 ? "rgba(255,216,94,.3)" : "rgba(230,245,230,.12)";
      ctx.lineWidth = 2.5 * state.dpr;
      const seed = Math.floor(world.time * 24);
      for (let i = 0; i < 10; i++) {
        const a = ((seed + i * 37) % 100) / 100;
        const x = a * w;
        if (x > w * 0.28 && x < w * 0.72) continue;
        const len = (40 + ((i * 53) % 60)) * state.dpr * strength;
        const y = (((seed + i * 71) % 100) / 100) * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (x - w / 2) * 0.04, y + len);
        ctx.stroke();
      }
    }

    const vig = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.25, w / 2, h * 0.55, h * 0.78);
    vig.addColorStop(0, "rgba(8,18,15,0)");
    vig.addColorStop(1, "rgba(8,18,15,.62)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    if (p.heat >= 3.5 && !state.calm) {
      const pulse = (Math.sin(world.time * 7) + 1) / 2;
      ctx.fillStyle = `rgba(255,60,80,${0.05 + pulse * 0.08})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (state.flash > 0 && !state.calm) {
      ctx.fillStyle = `rgba(255,240,220,${clamp(state.flash, 0, 1) * 0.5})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (p.nitroTime > 0) {
      ctx.fillStyle = "rgba(255,190,70,.12)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ---------- HUD ---------- */
  function hud(dt) {
    const world = state.world;
    if (!world) return;
    const p = world.player;
    $("hud-score").textContent = Math.round(p.score).toLocaleString("ru-RU");
    $("hud-cash").textContent = money(p.cash);
    const left = Math.max(0, world.shift - world.time);
    $("hud-time").textContent =
      Math.floor(left / 60) + ":" + String(Math.floor(left % 60)).padStart(2, "0");
    $("hud-phase").textContent = world.phaseName;
    $("hud-speed").textContent = Math.round(p.speed);
    const fill = $("hud-nitro-fill");
    fill.style.width = clamp(p.nitro, 0, 100) + "%";
    fill.parentElement.parentElement.classList.toggle("ready", p.nitro >= core.RULES.nitroCost);

    const armorStep = Math.min(3, Math.floor(p.armor * 4));
    if (state.shownHearts !== p.hearts || state.shownArmor !== armorStep) {
      state.shownHearts = p.hearts;
      state.shownArmor = armorStep;
      $("hud-hearts").innerHTML = Array.from({ length: p.maxHearts }, (_, i) => {
        if (i < p.hearts - 1) return "<i></i>";
        if (i === p.hearts - 1)
          return armorStep >= 2 ? '<i class="hurt"></i>' : "<i></i>";
        return '<i class="lost"></i>';
      }).join("");
    }
    const stars = Math.round(p.heat);
    if (state.shownHeat !== stars) {
      state.shownHeat = stars;
      $("hud-heat").innerHTML = Array.from({ length: 6 }, (_, i) =>
        `<i class="${i < stars ? "on" : ""}">★</i>`,
      ).join("");
      $("hud-heat").classList.toggle("alarm", stars >= 5 && !state.calm);
    }
    const combo = $("hud-combo");
    if (p.combo > 1) {
      combo.hidden = false;
      combo.textContent = "×" + p.combo + "  (" + p.chain + ")";
    } else combo.hidden = true;

    const powers = [];
    if (p.powers.magnet > 0) powers.push("магнит " + Math.ceil(p.powers.magnet));
    if (p.powers.radar > 0) powers.push("глушилка " + Math.ceil(p.powers.radar));
    if (p.powers.shield > 0) powers.push("броня " + Math.ceil(p.powers.shield));
    if (p.nitroTime > 0) powers.push("нитро " + p.nitroTime.toFixed(1));
    const chipText = powers.join(" · ");
    if ($("hud-powers").dataset.text !== chipText) {
      $("hud-powers").dataset.text = chipText;
      $("hud-powers").innerHTML = chipText ? "<b>" + chipText + "</b>" : "";
    }

    const prompt = $("bribe-prompt");
    if (p.encounter) {
      prompt.hidden = false;
      $("bribe-cost").textContent = money(p.encounter.cost);
      $("bribe-fill").style.width =
        clamp(p.encounter.timer / core.RULES.bribeWindow, 0, 1) * 100 + "%";
      const broke = p.cash < p.encounter.cost;
      $("bribe-cost").parentElement.classList.toggle("insufficient", broke);
      $("bribe-note").textContent = broke
        ? "кэша не хватает — собирай купюры"
        : "ПРОБЕЛ / кнопка «дать взятку»";
    } else if (!prompt.hidden) prompt.hidden = true;

    if (state.mode === "playing") coach(dt);
  }

  const COACH = [
    { at: 1.5, text: "Купюры ₽ — это бюджет на взятки. Газ: W, руль: A / D" },
    { at: 9, text: "Сбивай силуэты цепочкой — комбо множит очки и розыск" },
    { at: 22, text: "Розыск растёт: едут патрули. Жми ПРОБЕЛ рядом с ментом — дашь взятку" },
    { at: 40, text: "БПЛА подсвечивает полосу перед пикированием: смени полосу или собери глушилку" },
    { at: 66, text: "Нитро (SHIFT) таранит патруль и сбивает дроны — но розыск скакнёт вверх" },
  ];

  function coach(dt) {
    const world = state.world;
    const el = $("drive-coach");
    if (!world || world.attract) return;
    const next = COACH[state.coachIndex];
    if (next && world.time >= next.at) {
      state.coachIndex += 1;
      state.coachTimer = 4.2;
      el.textContent = next.text;
      el.classList.add("show");
    }
    if (state.coachTimer > 0) {
      state.coachTimer -= dt;
      if (state.coachTimer <= 0) el.classList.remove("show");
    }
  }

  /* ---------- состояния ---------- */
  function setMode(mode) {
    state.mode = mode;
    $("drive-intro").hidden = mode !== "intro";
    $("drive-pause").hidden = mode !== "paused";
    $("drive-result").hidden = mode !== "result";
    $("hud").hidden = mode === "intro";
  }

  function start() {
    audio.unlock();
    state.world = createWorld(false);
    state.scroll = 0;
    state.coachIndex = 0;
    state.coachTimer = 0;
    state.shownHearts = -1;
    state.shownHeat = -1;
    setMode("playing");
    audio.music(true);
    audio.sfx("start");
    canvas.focus();
  }

  function restart() {
    start();
  }

  function togglePause(force) {
    if (state.mode === "playing" || force === true) {
      if (state.mode !== "playing") return;
      setMode("paused");
      audio.engine(false);
      audio.music(false);
      audio.suspend();
    } else if (state.mode === "paused") {
      setMode("playing");
      audio.resume();
      audio.music(true);
      state.last = performance.now();
    }
  }

  function showResult(reason) {
    if (state.mode === "result") return;
    const world = state.world;
    const result = world.result;
    if (!result) return;
    audio.engine(false);
    audio.music(false);
    const isBest = saveRecord(world.car.id, result);
    $("result-kicker").textContent =
      reason === "wrecked"
        ? "БАМПЕР ДОЖИЛ СВОЙ"
        : reason === "quit"
          ? "СМЕНА ПРЕРВАНА"
          : "СМЕНА ЗАКРЫТА";
    $("result-grade").textContent = result.grade;
    $("result-title").textContent = result.title;
    $("result-score").textContent =
      result.score.toLocaleString("ru-RU") +
      " очков · бонус " +
      money(result.bonus) +
      " · " +
      world.car.name +
      " " +
      world.car.plate;
    $("result-stars").innerHTML = Array.from(
      { length: 3 },
      (_, i) => `<span class="${i < result.stars ? "" : "off"}">★</span>`,
    ).join("");
    const rows = [
      ["Сбито силуэтов", result.knockdowns + (result.vip ? " (звёзд " + result.vip + ")" : "")],
      ["Лучшее комбо", "×" + result.bestCombo],
      ["Взяток дано", result.bribes],
      ["Протоколов", result.failed],
      ["БПЛА валено", result.drones],
      ["Таранов патруля", result.rams],
      ["Уклонов от дронов", result.dodges],
      ["Кэш в кармане", money(result.cash)],
      ["Максимум км/ч", result.topSpeed],
      ["Дистанция", result.distance.toFixed(1) + " км"],
    ];
    $("result-stats").innerHTML = rows
      .map(
        (r) => `<li><span>${r[0]}</span><strong>${r[1]}</strong></li>`,
      )
      .join("");
    const note = [];
    if (isBest) note.push("Новый рекорд на этой машине!");
    const best = records().cars["car" + world.car.id];
    if (best) note.push("Рекорд: " + best.best.toLocaleString("ru-RU"));
    if (result.failed > result.bribes)
      note.push("Совет: держи кэш — пустой карман означает протокол.");
    if (result.knockdowns > 0 && result.bribes === 0 && result.failed > 0)
      note.push("Взятка дешевле ремонта: копи купюры и жми ПРОБЕЛ.");
    $("result-note").textContent = note.join(" ");
    audio.sfx(reason === "wrecked" ? "lose" : "win");
    setMode("result");
  }

  function quitShift() {
    const world = state.world;
    if (!world || world.status !== "running") {
      setMode("result");
      return;
    }
    world.status = "quit";
    core.finish(world, "quit");
    showResult("quit");
  }

  function setMuted(value) {
    state.muted = audio.setMuted(value);
    const btn = $("drive-sound");
    btn.textContent = state.muted ? "Звук: выкл" : "Звук: вкл";
    btn.setAttribute("aria-pressed", String(state.muted));
  }

  function setRecordsPreview() {
    const car = state.car || defaultCar();
    const best = records().cars["car" + car.id];
    const el = $("intro-record");
    if (best && best.best) {
      el.hidden = false;
      el.textContent =
        "Рекорд на этой машине: " +
        best.best.toLocaleString("ru-RU") +
        " очков · смен: " +
        best.runs +
        " · лучшее комбо ×" +
        best.combo;
    } else el.hidden = true;
  }

  async function boot() {
    const car = await loadCar();
    state.car = car;
    const name = ((car.brand || "") + " " + (car.model || "")).trim() || "Ночной Драйв";
    $("drive-title").textContent = car.demo ? "Ночная смена" : "Ночная смена · " + name;
    $("intro-car").textContent = car.demo
      ? "Машина не выбрана — демо «Драйв Ночной»"
      : name + " · " + (car.plate || "");
    $("drive-sub").textContent = car.demo
      ? "Выберите автомобиль в каталоге, чтобы гонять на нём по ночному проспекту."
      : "Ваш «" +
        name +
        "» (" +
        (core.CLASSES[car.category] || core.CLASSES.comfort).label.toLowerCase() +
        ") выехал на проспект. Смена длится 2:30.";
    $("intro-perk").textContent = (core.CLASSES[car.category] || core.CLASSES.comfort).perk;
    setRecordsPreview();
    state.world = createWorld(true);
    setMode("intro");
    if ($("drive-calm").getAttribute("aria-pressed") === "true") state.calm = true;
    $("drive-start").addEventListener("click", start);
    if ($("touch-pause")) $("touch-pause").addEventListener("click", () => togglePause());
    $("resume").addEventListener("click", () => togglePause());
    $("quit").addEventListener("click", quitShift);
    $("again").addEventListener("click", restart);
    $("drive-sound").addEventListener("click", () => setMuted(!state.muted));
    $("drive-calm").addEventListener("click", () => {
      state.calm = !state.calm;
      $("drive-calm").setAttribute("aria-pressed", String(state.calm));
      $("drive-calm").textContent = state.calm ? "Без миганий: вкл" : "Без миганий";
    });
    for (const id of ["drive-difficulty"])
      if ($(id)) $(id).addEventListener("change", setRecordsPreview);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.mode === "playing") togglePause(true);
    });
    requestAnimationFrame(loop);
  }

  global.DriveGame = {
    state,
    start,
    restart,
    togglePause,
    quitShift,
    setMuted,
    input,
    step,
    render,
    hud,
    consumeEvents,
    createWorld,
    records,
    saveRecord,
    boot,
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
