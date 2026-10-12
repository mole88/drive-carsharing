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
  const RECORD_KEY = "drive.nightshift.records.v2";
  const VOLUME_KEY = "drive.nightshift.volume.v1";
  const CALM_KEY = "drive.nightshift.calm.v1";
  const RUN_KEY = "drive.rental.run.v1.";
  const INTRO_HELP_KEY = "drive.intro.help.v1";

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
    volume: { music: 1, sfx: 1 },
    ducked: false,
    goPlayed: false,
    lastCheer: -99,
    shownHearts: -1,
    shownHeat: -1,
    record: null,
    dpr: 1,
    view: { scale: 1, ox: 0, oy: 0, w: 0, h: 0 },
    car: null,
    rental: null,
    saving: false,
    lastSaved: 0,
  };

  let calmQuery = null;
  try {
    calmQuery = matchMedia("(prefers-reduced-motion: reduce)");
  } catch (error) {
    void error;
  }

  /* Явный выбор игрока старшие настройки ОС: иначе «мигать» пришлось бы
     включать заново после каждой перезагрузки. */
  const savedCalm = () => {
    try {
      const value = JSON.parse(localStorage.getItem(CALM_KEY)).calm;
      return value === true || value === false ? value : null;
    } catch (error) {
      void error;
      return null;
    }
  };
  const calmChosen = savedCalm();
  state.calm =
    calmChosen === null ? !!(calmQuery && calmQuery.matches) : calmChosen;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  /* На телефоне клавиши Пробел нет — подсказки должны говорить про экранные кнопки. */
  const coarsePointer =
    typeof matchMedia === "function" &&
    matchMedia("(hover: none) and (pointer: coarse)").matches;
  /* Легенда одна на интро и на паузе: на телефоне клавиш нет, и показывать
     обоим экранам A/D — значит ничего не объяснить. */
  const KEYS_HELP =
    "A/D — руль · W/S — газ/тормоз · Shift — нитро · Пробел — взятка · P — пауза · V — вернуть машину";
  const TOUCH_HELP =
    "Веди пальцем по дороге · кнопки под игрой: «Взятка» при контакте и «Нитро» для тарана · «Вернуть машину» и пауза — вверху экрана";
  const helpText = () => (coarsePointer ? TOUCH_HELP : KEYS_HELP);
  const depth = (y) => 0.8 + 0.36 * clamp(y / W.height, 0, 1);
  function cheer() {
    const now = state.world ? state.world.time : 0;
    if (now - state.lastCheer < 5) return;
    state.lastCheer = now;
    audio.sfx("cheer");
  }
  function worldPop(world, text, x, y, tone, ttl, delay) {
    world.fx.push({
      kind: "pop",
      text,
      x,
      y,
      tone: tone || "gold",
      life: -(delay || 0),
      ttl: ttl || 1.1,
      vy: -110,
    });
  }
  const money = (kopecks) =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
    }).format(kopecks / 100);

  function records() {
    try {
      return (
        JSON.parse(localStorage.getItem(RECORD_KEY)) || { cars: {}, total: {} }
      );
    } catch (error) {
      void error;
      return { cars: {}, total: {} };
    }
  }
  function saveRecord(carId, result) {
    const all = records();
    const key = "car" + carId;
    const prev = all.cars[key] || {
      best: 0,
      runs: 0,
      knockdowns: 0,
      combo: 1,
      cash: 0,
    };
    const isBest = result.score > prev.best;
    all.cars[key] = {
      best: Math.max(prev.best, result.score),
      runs: prev.runs + 1,
      knockdowns: prev.knockdowns + result.knockdowns,
      combo: Math.max(prev.combo, result.bestCombo),
      cash: prev.cash + result.revenue,
      bestProfit: Math.max(prev.bestProfit ?? -Infinity, result.profit),
      wins: (prev.wins || 0) + Number(result.won),
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
    const profile = core.carProfile(car);
    return [profile.color, profile.dark, profile.light];
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
      rate_kopecks: 1400,
    };
  }

  async function loadCar() {
    const raw = new URLSearchParams(location.search).get("rental");
    if (
      raw &&
      (!/^\d+$/.test(raw) ||
        !Number.isSafeInteger(Number(raw)) ||
        Number(raw) <= 0)
    )
      throw new Error("Поездка не найдена.");
    const rental = await api(
      raw ? "/api/rentals/" + raw : "/api/rentals/current",
    );
    if (!rental) throw new Error("Выберите автомобиль.");
    if (!["active", "reserved", "completed"].includes(rental.status))
      throw new Error("Бронь отменена. Выберите автомобиль.");
    state.rental = rental;
    history.replaceState(null, "", "/drive?rental=" + rental.id);
    const car = await api("/api/cars/" + rental.car_id);
    car.rate_kopecks = rental.rate_kopecks;
    car.plate = rental.plate;
    car.rentalTariff = true;
    return car;
  }

  function persistRun() {
    if (
      !state.rental ||
      !state.world ||
      state.world.attract ||
      state.rental.status !== "active"
    )
      return;
    try {
      localStorage.setItem(
        RUN_KEY + state.rental.id,
        JSON.stringify({
          rental: state.rental.id,
          started: state.rental.started_at,
          world: core.snapshotRun(state.world),
          scroll: state.scroll,
        }),
      );
    } catch (error) {
      void error;
    }
  }

  function restoreRun() {
    try {
      const saved = JSON.parse(localStorage.getItem(RUN_KEY + state.rental.id));
      if (
        !saved ||
        saved.rental !== state.rental.id ||
        saved.started !== state.rental.started_at ||
        saved.world.car.id !== state.car.id ||
        saved.world.attract ||
        saved.world.car.rateKopecks !== state.rental.rate_kopecks ||
        !Number.isFinite(saved.world.time) ||
        saved.world.time < 0
      )
        return false;
      state.world = core.resumeRun(saved.world);
      state.scroll = saved.scroll || 0;
      return true;
    } catch (error) {
      return false;
    }
  }
  window.addEventListener("pagehide", persistRun);

  function createWorld(attract) {
    const car = state.car || defaultCar();
    const palette = carPalette(car);
    const world = core.createRun({
      carId: car.id,
      carName:
        state.rental?.car_name || (car.brand || "") + " " + (car.model || ""),
      plate: car.plate,
      category: car.category,
      rateKopecks: car.rate_kopecks,
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
    return !!(
      target &&
      target.closest &&
      target.closest("input:not([type=range]),select,textarea")
    );
  }

  window.addEventListener("keydown", (e) => {
    if (typingInField(e.target)) return;
    const name = KEYMAP[e.code];
    if (name) {
      if (!state.keys[name]) state.keys[name + "Pressed"] = true;
      state.keys[name] = true;
      if (name === "bribe" || e.code === "ArrowUp" || e.code === "ArrowDown")
        e.preventDefault();
    }
    if (e.code === "KeyP" || e.code === "Escape") togglePause();
    if (
      e.code === "KeyV" &&
      (state.mode === "playing" || state.mode === "paused")
    )
      quitShift();

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
    return (
      ((event.clientX - rect.left) * state.dpr - state.view.ox) /
      state.view.scale
    );
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
      if (el.setPointerCapture && e.pointerId !== undefined)
        el.setPointerCapture(e.pointerId);
      audio.unlock();
    };
    const off = () => {
      state[prop] = false;
    };
    el.addEventListener("pointerdown", on);
    for (const type of ["contextmenu", "selectstart", "dragstart"])
      el.addEventListener(type, (e) => e.preventDefault());
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
    if (!world || state.mode === "paused" || state.mode === "result") return;
    if (state.hitStop > 0) {
      state.hitStop -= dt;
      return;
    }
    if (world.attract) {
      core.step(world, dt * 0.85, {});
      world.player.invuln = 1e9;
      world.player.heat = Math.max(0, world.player.heat - dt * 0.8);
      world.player.score = 0;
      /* Витрина не доезжает до облавы: на 10-м уровне начинаем новый круг */
      if (world.status !== "running" || world.level >= core.RULES.raidLevel)
        state.world = createWorld(true);
    } else if (world.status === "running") {
      core.step(world, dt, input());
    }
    if (world.status !== "running" && !world.result && !world.attract) {
      core.finish(world, world.status);
    }
    state.scroll +=
      world.player.speed * W.pxPerKmh * dt * (world.attract ? 0.85 : 1);
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
    nitroEnd: "nitroEnd",
    powerEnd: "powerEnd",
    droneMiss: "droneMiss",
    debtStart: "debt",
    phase: "phase",
    level: "phase",
    raidClose: "siren",
  };

  /* Реплика на сбитый силуэт: бросок один, поэтому четыре голоса не накладываются. */
  const KNOCK_VOICES = ["babachai", "banani", "slivi", "vinograd"];

  function consumeEvents() {
    const world = state.world;
    if (!world) return;
    for (const e of world.events) {
      if (world.attract) continue;
      const sfx = SFX_BY_EVENT[e.type];
      if (e.type === "bribe" || e.type === "protocol") audio.cut("encounter");
      if (sfx) audio.sfx(sfx);
      if (e.type === "cash") {
        const chip = document.querySelector(".hud-cash");
        chip.classList.add("pulse");
        clearTimeout(state.cashTimer);
        state.cashTimer = setTimeout(() => chip.classList.remove("pulse"), 220);
      }
      if (e.type === "knock") {
        state.hitStop = e.vip ? 0.07 : 0.045;
        if (!state.calm)
          state.shake = Math.min(26, state.shake + (e.vip ? 16 : 9));
        if (e.combo >= 5 && e.combo % 5 === 0) cheer();
        if (Math.random() < 0.08)
          audio.sfx(
            KNOCK_VOICES[Math.floor(Math.random() * KNOCK_VOICES.length)],
          );
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
        /* Новый акт = новая опасность. Её называем сразу, а не по факту удара. */
        if (e.hint) worldPop(world, e.hint, W.width / 2, 452, "bad", 2.2, 0.55);
      }
      if (e.type === "level" && e.level % 4 === 0)
        worldPop(world, "ДАВЛЕНИЕ " + e.level, W.width / 2, 500, "bad", 1.5);
      if (e.type === "raidClose")
        worldPop(world, "ОБЛАВА ЕДЕТ", W.width / 2, 560, "bad", 2);
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
    if (state.mode === "playing" && now - state.lastSaved > 1000) {
      state.lastSaved = now;
      persistRun();
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
    // Fill tall screens without cutting either edge of the playable road.
    const scale = Math.min(
      ph / W.height,
      pw / (W.roadRight - W.roadLeft + 100),
    );
    state.view = {
      scale,
      ox: (pw - W.width * scale) / 2,
      oy: ph - W.height * scale,
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
    const zoom = world.player.nitroTime > 0 ? 0.965 : 1;
    ctx.setTransform(
      view.scale * zoom,
      0,
      0,
      view.scale * zoom,
      view.ox * zoom + shakeX + (view.w * (1 - zoom)) / 2,
      view.oy * zoom + shakeY + (view.h * (1 - zoom)) / 2,
    );

    const phase = core.phaseInfo(world);
    art.background(ctx, {
      w: W.width,
      h: W.height,
      visibleLeft: -view.ox / view.scale,
      visibleWidth: view.w / view.scale,
      visibleTop: -view.oy / view.scale,
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
    for (const d of world.drones)
      list.push({ y: d.y + 40, kind: "drone", o: d });
    for (const s of world.props)
      if (s.kind !== "oil" && s.kind !== "pothole")
        list.push({ y: s.y, kind: "prop", o: s });
    for (const q of world.pickups) list.push({ y: q.y, kind: "pickup", o: q });
    list.push({ y: world.player.y, kind: "player", o: world.player });
    if (!world.attract && core.raidActive(world.level))
      list.push({ y: world.raid.y, kind: "raid", o: world.raid });
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
        art.policeCar(ctx, o, {
          scale,
          time,
          beam: o.mode === "pursue" || world.player.encounter,
        });
      } else if (item.kind === "drone") {
        art.drone(ctx, o, { scale, time });
      } else if (item.kind === "prop") {
        art.prop(ctx, o);
      } else if (item.kind === "raid") {
        art.raid(ctx, {
          y: o.y,
          left: W.roadLeft,
          right: W.roadRight,
          time,
          tight: o.tight,
          scale,
        });
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
            skin: world.car.skin,
            plate: world.car.plate,
            nitro: o.nitroTime > 0,
            shield: o.powers.shield > 0,
            time,
          });
        if (o.combo > 1 && o.comboTime > 0) {
          const ratio = clamp(o.comboTime / core.RULES.comboWindowMax, 0, 1);
          ctx.save();
          ctx.translate(o.x, o.y);
          ctx.scale(scale, scale);
          ctx.lineWidth = 7;
          ctx.strokeStyle = "rgba(255,216,94,.28)";
          ctx.beginPath();
          ctx.arc(0, 0, 96, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = ratio > 0.35 ? "#ffd85e" : "#ff7a7a";
          ctx.beginPath();
          ctx.arc(0, 0, 96, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    for (const d of world.drones)
      if (d.state === "lock")
        art.droneTarget(ctx, d, world.player.y, "#ff4d5e");

    for (const f of world.fx) {
      if (f.life < 0) continue;
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
      ctx.strokeStyle =
        p.nitroTime > 0 ? "rgba(255,216,94,.3)" : "rgba(230,245,230,.12)";
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

    const vig = ctx.createRadialGradient(
      w / 2,
      h * 0.55,
      h * 0.25,
      w / 2,
      h * 0.55,
      h * 0.78,
    );
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
  /* Полоса облавы: честный ответ на вопрос «успею ли газануть» */
  function raidGauge(world) {
    const strip = $("hud-raid");
    if (!strip) return;
    const gap = world.raid.y - world.player.y;
    if (world.attract || !core.raidActive(world.level)) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    $("hud-raid-fill").style.width =
      Math.round(clamp(1 - gap / core.RULES.raidGap, 0, 1) * 100) + "%";
    strip.classList.toggle("tight", world.raid.tight);
    const closing = core.raidKmhAt(world.level) - world.player.speed;
    $("hud-raid-note").textContent = world.raid.tight
      ? "сидит на бампере — W или нитро"
      : closing > 0
        ? "догонит через " +
          Math.max(1, Math.round(gap / (W.pxPerKmh * closing))) +
          " с"
        : "отстаёт — держи газ";
  }

  function retireLabel(world) {
    const btn = $("hud-retire");
    if (!btn) return;
    const cashout = core.cashoutAt(world);
    const label = "Вернуть машину";
    const hint =
      cashout > 0
        ? "Касса возврата +" +
          cashout.toLocaleString("ru-RU") +
          " очков сгорит, если разобьёшься"
        : "Прибыль отрицательная: возврат ничего не доплачивает";
    if (state.retireLabel === label + hint) return;
    state.retireLabel = label + hint;
    btn.textContent = label;
    btn.title = hint;
    btn.classList.toggle("risky", cashout <= 0);
  }

  function hud(dt) {
    const world = state.world;
    if (!world) return;
    const p = world.player;
    $("hud-score").textContent = Math.round(p.score).toLocaleString("ru-RU");
    if (
      state.recordScore &&
      !state.recordBeaten &&
      p.score > state.recordScore
    ) {
      state.recordBeaten = true;
      document.querySelector(".hud-score").classList.add("beat");
      $("hud-record").textContent = "рекорд побит!";
      worldPop(world, "НОВЫЙ РЕКОРД!", W.width / 2, 430, "gold", 1.6);
      cheer();
    }
    $("hud-cash").textContent = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(p.cash / 100);
    $("hud-cash").title = money(p.cash);
    $("hud-rent").textContent = money(world.stats.rentalCost);
    $("hud-revenue").textContent = money(world.stats.cashEarned);
    const net = core.profit(world);
    $("hud-profit").textContent = money(net);
    $("hud-profit").classList.toggle("loss", net < 0);
    const cashout = core.cashoutAt(world);
    const cashoutEl = $("hud-cashout");
    cashoutEl.hidden = cashout <= 0;
    cashoutEl.textContent = "+" + cashout.toLocaleString("ru-RU") + " очк.";
    $("hud-rate").textContent = money(world.car.rateKopecks) + "/мин";
    $("hud-debt").hidden = p.rentalDebt <= 0;
    $("hud-debt").textContent = "Долг за аренду: " + money(p.rentalDebt);
    $("hud-level").textContent = world.level;
    $("hud-phase").textContent = world.phaseName;
    $("hud-clock").textContent =
      Math.floor(core.tripSeconds(world.time) / 60) + " мин";
    $("hud-distance").textContent = world.stats.distance.toFixed(1) + " км";
    $("hud-speed").textContent = Math.round(core.tripSpeed(p.speed));
    raidGauge(world);
    retireLabel(world);
    const fill = $("hud-nitro-fill");
    fill.style.width = clamp(p.nitro, 0, 100) + "%";
    fill.parentElement.parentElement.classList.toggle(
      "ready",
      p.nitro >= core.RULES.nitroCost,
    );

    const armorStep = Math.min(3, Math.floor(p.armor * 4));
    if (state.shownHearts !== p.hearts || state.shownArmor !== armorStep) {
      state.shownHearts = p.hearts;
      state.shownArmor = armorStep;
      $("hud-hearts").innerHTML = Array.from(
        { length: p.maxHearts },
        (_, i) => {
          if (i < p.hearts - 1) return "<i></i>";
          if (i === p.hearts - 1)
            return armorStep >= 2 ? '<i class="hurt"></i>' : "<i></i>";
          return '<i class="lost"></i>';
        },
      ).join("");
    }
    const stars = Math.round(p.heat);
    if (state.shownHeat !== stars) {
      if (stars > state.shownHeat && stars >= 2 && state.mode === "playing")
        worldPop(world, "РОЗЫСК " + stars + "★", W.width / 2, 400, "bad", 1.2);
      state.shownHeat = stars;
      $("hud-heat").innerHTML = Array.from(
        { length: 6 },
        (_, i) => `<i class="${i < stars ? "on" : ""}">★</i>`,
      ).join("");
      $("hud-heat").classList.toggle("alarm", stars >= 5 && !state.calm);
    }
    if (!world.attract && !state.goPlayed && world.time >= 1.2) {
      state.goPlayed = true;
      audio.sfx("go");
    }
    const combo = $("hud-combo");
    if (p.combo > 1) {
      combo.hidden = false;
      combo.textContent = "×" + p.combo;
      combo.title = "Цепочка: " + p.chain;
    } else combo.hidden = true;

    const powers = [];
    if (p.powers.magnet > 0)
      powers.push("магнит " + Math.ceil(p.powers.magnet));
    if (p.powers.radar > 0)
      powers.push("глушилка " + Math.ceil(p.powers.radar));
    if (p.powers.shield > 0) powers.push("броня " + Math.ceil(p.powers.shield));
    if (p.nitroTime > 0) powers.push("нитро " + p.nitroTime.toFixed(1));
    const chipText = powers.join(" · ");
    if ($("hud-powers").dataset.text !== chipText) {
      $("hud-powers").dataset.text = chipText;
      $("hud-powers").innerHTML = powers
        .map((power) => "<b>" + power + "</b>")
        .join("");
    }

    const prompt = $("bribe-prompt");
    const bribeBtn = $("touch-bribe");
    if (bribeBtn) bribeBtn.classList.toggle("armed", !!p.encounter);
    $("hud-retire").hidden = !!p.encounter;
    if (!!p.encounter !== state.ducked) {
      state.ducked = !!p.encounter;
      audio.duck(state.ducked);
    }
    if (p.encounter) {
      prompt.hidden = false;
      $("bribe-cost").textContent = money(p.encounter.cost);
      $("bribe-fill").style.width =
        clamp(
          p.encounter.timer / (p.encounter.window || core.RULES.bribeWindow),
          0,
          1,
        ) *
          100 +
        "%";
      const broke = p.cash < p.encounter.cost;
      $("bribe-cost").parentElement.classList.toggle("insufficient", broke);
      const firstContact =
        (p.encounter.window || core.RULES.bribeWindow) > core.RULES.bribeWindow;
      const payHint = coarsePointer ? "кнопка «Взятка»" : "ПРОБЕЛ";
      $("bribe-note").textContent = broke
        ? "не хватает денег"
        : firstContact
          ? "ПЕРВЫЙ КОНТАКТ · " + payHint + " — взятка"
          : payHint + " / Взятка";
      /* Цена молчания и альтернатива деньгам: выбор должен читаться в момент диалога */
      const alt = $("bribe-alt");
      const fine = money(Math.round(p.encounter.cost * 0.5));
      const canRam = p.nitro >= core.RULES.nitroCost && p.nitroTime <= 0;
      const ram = coarsePointer ? "кнопкой «Нитро»" : "на нитро";
      alt.textContent = canRam
        ? "или таран " +
          ram +
          ": без оплаты, +розыск · иначе протокол " +
          fine +
          " и бампер"
        : "иначе протокол: " + fine + " и минус бампер";
      alt.hidden = false;
    } else if (!prompt.hidden) {
      prompt.hidden = true;
      $("bribe-alt").hidden = true;
    }
  }

  /* ---------- состояния ---------- */
  function setMode(mode) {
    state.mode = mode;
    $("drive-intro").hidden = mode !== "intro";
    $("drive-pause").hidden = mode !== "paused";
    $("drive-result").hidden = mode !== "result";
    /* На телефоне подсказка про клавиши бесполезна — легенда одна на оба экрана */
    if (mode === "paused") $("pause-help").textContent = helpText();
    /* На итогах HUD прячем: он просвечивает сквозь затемнение оверлея */
    $("hud").hidden = mode === "intro" || mode === "result";
  }

  async function start() {
    if (
      !state.rental ||
      state.mode !== "intro" ||
      state.starting ||
      state.rental.status === "completed"
    )
      return;
    state.starting = true;
    $("drive-start").disabled = true;
    try {
      localStorage.setItem(INTRO_HELP_KEY, "1");
    } catch (error) {
      /* Приватный режим: пусть шпаргалка остаётся открытой. */
    }
    try {
      if (state.rental.status === "reserved")
        state.rental = await api("/api/rentals/" + state.rental.id + "/start", {
          method: "POST",
        });
      if (!(await heartbeat())) return;
      audio.unlock();
      const restored = restoreRun();
      if (!restored) {
        state.world = createWorld(false);
        state.scroll = 0;
      }
      state.shownHearts = state.shownHeat = -1;
      state.retireLabel = "";
      state.goPlayed = false;
      state.lastCheer = -99;
      state.recordScore = records().cars["car" + state.world.car.id]?.best || 0;
      state.recordBeaten = false;
      $("hud-record").hidden = true;
      setMode("playing");
      state.last = performance.now();
      if (state.world.result) {
        showResult(state.world.result.reason);
        return;
      }
      audio.music(true, !restored);
      canvas.focus({ preventScroll: true });
      persistRun();
    } catch (error) {
      $("intro-perk").textContent = error.message;
      $("drive-start").disabled = false;
    } finally {
      state.starting = false;
    }
  }

  function restart() {
    if (state.mode === "result") location.assign("/cars");
  }

  /* Пауза — точка, где игрок решает «рискнуть или сдать». Кнопка сдачи должна
     называть цену решения здесь же, а не только плашкой в HUD. */
  function paintPauseState() {
    const world = state.world;
    if (!world) return;
    const cashout = core.cashoutAt(world);
    const el = $("pause-state");
    el.classList.toggle("loss", cashout <= 0);
    el.textContent =
      (cashout > 0
        ? "Возврат сейчас: +" + cashout.toLocaleString("ru-RU") + " очк. кассой"
        : "Возврат сейчас: кассы нет — прибыль отрицательная") +
      " · прибыль " +
      money(core.profit(world));
  }

  function togglePause(force) {
    if (state.mode === "playing" || force === true) {
      if (state.mode !== "playing") return;
      setMode("paused");
      paintPauseState();
      persistRun();
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

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(15000),
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Не удалось сохранить поездку",
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }

  let heartbeatPending = false;
  async function heartbeat() {
    if (
      heartbeatPending ||
      document.hidden ||
      !state.rental ||
      state.rental.status !== "active" ||
      state.mode === "result"
    )
      return true;
    heartbeatPending = true;
    try {
      await api("/api/rentals/" + state.rental.id + "/heartbeat", {
        method: "POST",
      });
      return true;
    } catch (error) {
      if ([401, 404, 409].includes(error.status)) {
        if (state.mode === "playing") togglePause(true);
        state.rental.status = "completed";
        setMode("intro");
        $("intro-car").textContent = "Поездка недоступна";
        $("intro-perk").textContent =
          "Вернитесь в каталог и выберите машину заново. " + error.message;
        $("drive-start").hidden = true;
        return false;
      }
      // A brief connection failure still leaves the 90-minute grace period.
      return true;
    } finally {
      heartbeatPending = false;
    }
  }

  function submitScore(result) {
    return api("/api/rentals/" + state.rental.id + "/game/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rental_id: state.rental.id,
        car_id: state.car.id,
        car_name: state.rental.car_name,
        category: state.car.category,
        score: result.score,
        level: result.level,
        knockdowns: result.knockdowns,
        drones: result.drones,
        dodges: result.dodges,
        bribes: result.bribes,
        profit_kopecks: result.profit,
        duration_seconds: result.time,
        time_scale: result.timeScale,
        duration_ms: result.durationMs,
        distance_meters: result.distanceMeters,
        reason: result.reason,
        killer: result.killer,
        best_combo: result.bestCombo,
      }),
    });
  }

  /* Комментатор в углу: режем зелёный фон ролика на лету.
     Каскад 200 px — кадр стоит доли миллисекунды и не грузит игровой цикл. */
  const CASTER_SRC = "/static/video/commentator.mp4";
  const CASTER_SIZE = 200;
  function startCaster() {
    const out = $("drive-caster");
    const video = $("caster-source");
    if (!out || !video || !out.getContext) return;
    if (!video.canPlayType || !video.canPlayType("video/mp4")) {
      out.hidden = true;
      return;
    }
    const ctx = out.getContext("2d");
    const work = document.createElement("canvas");
    const wctx = work.getContext("2d", { willReadFrequently: true });
    let ready = false;
    video.addEventListener("loadeddata", () => {
      const ratio = video.videoWidth ? CASTER_SIZE / video.videoWidth : 1;
      out.width = work.width = CASTER_SIZE;
      out.height = work.height = Math.max(
        1,
        Math.round((video.videoHeight || CASTER_SIZE) * ratio),
      );
      ready = true;
    });
    video.src = CASTER_SRC;
    /* Без пользовательского жеста браузер не пускает автоплей: пробуем сразу и ещё раз при клике */
    const attempt = () =>
      video
        .play()
        .then(() => {
          out.hidden = false;
        })
        .catch(() => {});
    attempt();
    for (const type of ["pointerdown", "keydown"])
      window.addEventListener(type, attempt, { once: true });
    let last = 0;
    const pump = (now) => {
      requestAnimationFrame(pump);
      if (!ready || video.readyState < 2 || now - last < 33) return;
      last = now;
      wctx.drawImage(video, 0, 0, work.width, work.height);
      const frame = wctx.getImageData(0, 0, work.width, work.height);
      const px = frame.data;
      let top = work.height;
      let bottom = -1;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i];
        const b = px[i + 2];
        const mx = r > b ? r : b;
        const green = px[i + 1] - mx;
        if (green > 48) {
          px[i + 3] = 0;
          continue;
        }
        if (px[i + 1] > mx + 24) px[i + 1] = mx + 24;
        if (green > 14)
          px[i + 3] = Math.round(px[i + 3] * (1 - (green - 14) / 34));
        if (px[i + 3] > 100) {
          const y = Math.floor(i / 4 / work.width);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      // Anchor visible pixels to the nitro bar, not the video's empty green field.
      if (bottom >= top) {
        const height = bottom - top + 1;
        if (out.height !== height) out.height = height;
        ctx.clearRect(0, 0, out.width, out.height);
        ctx.putImageData(frame, 0, -top);
      } else ctx.clearRect(0, 0, out.width, out.height);
    };
    requestAnimationFrame(pump);
  }

  /* Чем именно кончилась смена: ядро записывает источник последнего удара. */
  const KILLER_LABEL = {
    drone: "смену закончил БПЛА",
    raid: "смену закончило оцепление",
    protocol: "смену закончили протоколы",
    pothole: "смену закончила яма",
    barrier: "смену закончил лежачий патрульный",
    debt: "смену закончил долг по аренде",
    retired: "машину вернул сам",
    wreck: "смену закончила авария",
  };

  function outcomeKiller(result) {
    if (KILLER_LABEL[result.killer]) return KILLER_LABEL[result.killer];
    if (result.reason === "quit") return KILLER_LABEL.retired;
    if (result.reason === "broke") return KILLER_LABEL.debt;
    return KILLER_LABEL.wreck;
  }

  function paintOutcome(result) {
    $("result-title").textContent =
      result.reason === "wrecked"
        ? "Машина разбита"
        : result.reason === "broke"
          ? "Тариф не окупился"
          : "Машина возвращена";
    $("result-score").textContent =
      result.score.toLocaleString("ru-RU") + " очков";
    $("result-meta").textContent = Number.isFinite(result.tripSeconds)
      ? (result.tripSeconds / 60).toFixed(1) +
        " мин · " +
        (result.distanceMeters / 1000).toFixed(1) +
        " км"
      : result.time + " с · уровень " + result.level;
    $("result-grade").textContent =
      result.grade || core.grade(result.score).grade;
    $("result-stars").innerHTML = "★".repeat(result.stars || 0);
    /* Название ступени и зазор до следующей: без этой строки игрок с 39 289
       очками при пороге C 40 000 получает «Первую смену» и не знает, что ему
       не хватило 711 — таблица оценок молчит. */
    const ladder = core.grade(result.score);
    const next = core.nextGrade(result.score);
    $("result-caption").textContent = next
      ? ladder.title +
        " · до «" +
        next.title +
        "» ещё " +
        (next.score - result.score).toLocaleString("ru-RU") +
        " очк."
      : ladder.title + " · это потолок таблицы";
    $("result-gif").src =
      "/static/images/" + (result.won ? "smoking.gif" : "fuk.gif");
    $("result-gif").classList.toggle("win", !!result.won);
    $("result-gif").hidden = false;
    $("result-stats").innerHTML =
      `<li><span>Комбо</span><strong>×${result.bestCombo || 1}</strong></li>` +
      `<li><span>Сбито</span><strong>${result.knockdowns}</strong></li>` +
      (result.drones || result.dodges
        ? `<li><span>БПЛА</span><strong>${result.drones || 0} сбит · ${result.dodges || 0} мимо</strong></li>`
        : "") +
      `<li><span>Финал</span><strong>${outcomeKiller(result)}</strong></li>` +
      (result.bonus
        ? `<li><span>Касса возврата</span><strong>+${result.bonus.toLocaleString("ru-RU")}</strong></li>`
        : "") +
      `<li><span>Аренда</span><strong id="result-cost">…</strong></li>`;
    setMode("result");
  }

  /* Место в таблице недели считает сервер (rank в me того же публичного
     leaderboard, что и страница рейтинга) — экран только просит его. */
  async function paintWeekRank() {
    const el = $("result-rank");
    try {
      const data = await api("/api/game/leaderboard?period=week&limit=1");
      const rank = data.me && data.me.rank;
      if (!rank) return;
      const players = data.totals && data.totals.players;
      el.textContent =
        rank +
        "-е место недели" +
        (players ? " · пилотов в таблице: " + players : "");
    } catch (error) {
      /* Ранг не критичен: строка остаётся «Поездка сохранена». */
    }
  }

  function paintCompleted(rental) {
    state.rental = rental;
    const r = rental.game_result;
    if (r) {
      const ladder = core.grade(r.score);
      paintOutcome({
        ...r,
        time: r.duration_seconds,
        tripSeconds: r.trip_duration_seconds,
        distanceMeters: r.distance_meters,
        profit: r.profit_kopecks,
        bestCombo: r.best_combo,
        won: r.reason === "quit" && r.profit_kopecks > 0,
        grade: ladder.grade,
        stars: ladder.stars,
      });
    } else {
      setMode("result");
      $("result-title").textContent = "Поездка завершена";
      $("result-score").textContent = "";
      /* Экран без результата не должен доезжать с полями прошлой смены. */
      $("result-grade").textContent = "";
      $("result-stars").innerHTML = "";
      $("result-caption").textContent = "";
      $("result-stats").innerHTML =
        '<li><span>Аренда</span><strong id="result-cost"></strong></li>';
      $("result-gif").hidden = true;
    }
    $("result-cost").textContent = money(rental.total_kopecks);
    $("result-receipt").href = "/api/rentals/" + rental.id + "/receipt";
    $("result-receipt").hidden = false;
    $("result-retry").hidden = true;
    $("result-rank").textContent = "Поездка сохранена";
    if (r) paintWeekRank();
    try {
      localStorage.removeItem(RUN_KEY + rental.id);
    } catch (error) {
      void error;
    }
  }

  function showResult(reason) {
    if (state.mode === "result" || !state.world?.result) return;
    const result = state.world.result;
    audio.engine(false);
    audio.music(false);
    saveRecord(state.world.car.id, result);
    paintOutcome(result);
    persistRun();
    audio.cut("damage");
    audio.sfx(result.won ? "win" : "lose");
    publishScore(result);
  }

  async function publishScore(result) {
    if (state.saving || !state.rental || state.rental.status === "completed")
      return;
    state.saving = true;
    $("result-rank").textContent = "Сохраняем поездку…";
    $("result-retry").hidden = true;
    try {
      const rental = await submitScore(result);
      // The first completion wins if the same rental was open in two tabs.
      paintCompleted(rental);
    } catch (error) {
      $("result-rank").textContent = "Не сохранено: " + error.message;
      $("result-retry").hidden = false;
    } finally {
      state.saving = false;
    }
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

  /* Кнопка обязана показывать фактическое состояние: режим мог включить сам ОС. */
  function paintCalm() {
    const btn = $("drive-calm");
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(state.calm));
    btn.textContent = state.calm ? "Без миганий: вкл" : "Без миганий: выкл";
  }

  function setMuted(value) {
    state.muted = audio.setMuted(value);
    const btn = $("drive-sound");
    btn.textContent = state.muted ? "Звук: выкл" : "Звук: вкл";
    btn.setAttribute("aria-pressed", String(state.muted));
  }

  /* Громкость игрока: 1 = как выровнено по RMS, хранится в браузере. */
  function readVolume() {
    const base = { music: 1, sfx: 1 };
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(VOLUME_KEY));
    } catch (error) {
      void error;
    }
    if (!saved || typeof saved !== "object") return base;
    for (const key of ["music", "sfx"]) {
      const value = Number(saved[key]);
      if (Number.isFinite(value)) base[key] = clamp(value, 0, 1.5);
    }
    return base;
  }

  function applyVolume() {
    audio.setVolume("music", state.volume.music);
    audio.setVolume("sfx", state.volume.sfx);
    for (const key of ["music", "sfx"]) {
      const slider = $("vol-" + key);
      const out = $("vol-" + key + "-value");
      const percent = Math.round(state.volume[key] * 100);
      if (slider) slider.value = String(percent);
      if (out) out.textContent = percent + "%";
    }
  }

  function saveVolume() {
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(state.volume));
    } catch (error) {
      void error;
    }
  }

  function bindVolume() {
    const button = $("drive-volume");
    const panel = $("drive-volume-panel");
    if (button && panel) {
      button.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-pressed", String(!panel.hidden));
      });
    }
    for (const key of ["music", "sfx"]) {
      const slider = $("vol-" + key);
      if (!slider) continue;
      slider.addEventListener("input", () => {
        state.volume[key] = clamp(Number(slider.value) / 100, 0, 1.5);
        applyVolume();
        saveVolume();
      });
      /* чтобы стрелки руления не уехали в ползунок после отпускания */
      slider.addEventListener("pointerup", () => slider.blur());
    }
    applyVolume();
  }

  async function boot() {
    try {
      state.car = await loadCar();
    } catch (error) {
      $("intro-car").textContent = "Поездка недоступна";
      $("intro-perk").textContent = error.message;
      $("drive-start").hidden = true;
      return;
    }
    const car = state.car;
    const profile = core.carProfile(car);
    $("drive-title").textContent = state.rental.car_name;
    $("intro-car").textContent = state.rental.car_name;
    $("intro-tariff").textContent =
      money(car.rate_kopecks) + "/мин · 1,5 с игры = 1 мин поездки";
    /* Шпаргалка свёрнута, но первый заезд без неё — слепой: из семи живых смен
       новой экономики четыре кончились аварией без единого нажатия V, а в трёх
       игрок ни разу не платил взятку. */
    $("intro-help-text").textContent = helpText();
    try {
      if (!localStorage.getItem(INTRO_HELP_KEY)) $("intro-help").open = true;
    } catch (error) {
      $("intro-help").open = true;
    }
    state.world = createWorld(true);
    const palette = carPalette(car);
    art.playerCar($("car-preview").getContext("2d"), {
      x: 90,
      y: 115,
      width: profile.width,
      height: profile.height,
      skin: profile.skin,
      color: palette[0],
      colorDark: palette[1],
      colorLight: palette[2],
      plate: car.plate,
    });
    $("drive-start").onclick = start;
    $("drive-start").disabled = false;
    $("touch-pause").onclick = () => togglePause();
    $("resume").onclick = () => togglePause();
    $("quit").onclick = $("hud-retire").onclick = quitShift;
    $("result-retry").onclick = () => publishScore(state.world.result);
    $("drive-sound").onclick = () => setMuted(!state.muted);
    $("drive-calm").onclick = () => {
      state.calm = !state.calm;
      try {
        localStorage.setItem(CALM_KEY, JSON.stringify({ calm: state.calm }));
      } catch (error) {
        void error;
      }
      paintCalm();
    };
    paintCalm();
    /* Настройку «уменьшить движение» в ОС игрок мог сменить уже в игре */
    if (calmQuery && typeof calmQuery.addEventListener === "function") {
      calmQuery.addEventListener("change", (e) => {
        if (savedCalm() !== null) return;
        state.calm = !!e.matches;
        paintCalm();
      });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.mode === "playing") togglePause(true);
      if (!document.hidden) void heartbeat();
    });
    // Autostart is silent until the first gesture unlocks browser audio.
    window.addEventListener(
      "pointerdown",
      () => {
        audio.unlock();
        if (state.mode === "playing") audio.music(true);
      },
      { once: true },
    );
    window.addEventListener(
      "keydown",
      () => {
        audio.unlock();
        if (state.mode === "playing") audio.music(true);
      },
      { once: true },
    );
    state.volume = readVolume();
    bindVolume();
    startCaster();
    requestAnimationFrame(loop);
    if (state.rental.status === "completed") paintCompleted(state.rental);
    else if (state.rental.status === "active") await start();
    const heartbeatTimer = setInterval(heartbeat, 30000);
    window.addEventListener("pagehide", () => clearInterval(heartbeatTimer), {
      once: true,
    });
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
    showResult,
    createWorld,
    records,
    saveRecord,
    submitScore,
    publishScore,
    startCaster,
    bindVolume,
    applyVolume,
    boot,
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
