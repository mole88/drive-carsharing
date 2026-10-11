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
    ducked: false,
    goPlayed: false,
    lastCheer: -99,
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
    let id = Number(new URLSearchParams(location.search).get("car")) || 0;
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(CAR_KEY));
    } catch (error) {
      void error;
    }
    let rental = null;
    try {
      const response = await fetch("/api/rentals/current", {
        credentials: "same-origin",
      });
      if (response.ok) rental = await response.json();
    } catch (error) {
      void error;
    }
    if (!id) id = rental?.car_id || Number(stored?.id) || 0;
    if (!id) return defaultCar();
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error("Выберите машину в каталоге.");
    const res = await fetch("/api/cars/" + id, { credentials: "same-origin" });
    if (!res.ok)
      throw new Error(
        "Не удалось загрузить выбранную машину. Обновите страницу или выберите другую.",
      );
    const car = await res.json();
    if (
      rental?.car_id === car.id &&
      ["active", "reserved"].includes(rental.status)
    ) {
      car.rate_kopecks = rental.rate_kopecks;
      car.rentalTariff = true;
    }
    return car;
  }

  function createWorld(attract) {
    const car = state.car || defaultCar();
    const palette = carPalette(car);
    const world = core.createRun({
      carId: car.id,
      carName: (car.brand || "") + " " + (car.model || ""),
      plate: car.plate,
      category: car.category,
      rateKopecks: car.rate_kopecks,
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
    return !!(
      target &&
      target.closest &&
      target.closest("input,select,textarea")
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
      if (world.status !== "running") state.world = createWorld(true);
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
    phase: "phase",
  };

  function consumeEvents() {
    const world = state.world;
    if (!world) return;
    for (const e of world.events) {
      if (world.attract) continue;
      const sfx = SFX_BY_EVENT[e.type];
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
        if (Math.random() < 0.06) audio.sfx("babachai");
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
    $("hud-cash").textContent = money(p.cash);
    $("hud-rent").textContent = money(world.stats.rentalCost);
    $("hud-revenue").textContent = money(world.stats.cashEarned);
    const net = core.profit(world);
    $("hud-profit").textContent = money(net);
    $("hud-profit").classList.toggle("loss", net < 0);
    $("hud-rate").textContent = money(world.car.rateKopecks) + "/мин";
    $("hud-debt").hidden = p.rentalDebt <= 0;
    $("hud-debt").textContent = "Долг за аренду: " + money(p.rentalDebt);
    const left = Math.max(0, world.shift - world.time);
    $("hud-time").textContent =
      Math.floor(left / 60) +
      ":" +
      String(Math.floor(left % 60)).padStart(2, "0");
    $("hud-phase").textContent = world.phaseName;
    $("hud-speed").textContent = Math.round(p.speed);
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
    if (left <= 10 && !state.finalCall && !world.attract) {
      state.finalCall = true;
      worldPop(world, "ФИНАЛ — 10 СЕКУНД", W.width / 2, 380, "gold", 1.6);
    }
    if (!world.attract && !state.goPlayed && world.time >= 1.2) {
      state.goPlayed = true;
      audio.sfx("go");
    }
    const combo = $("hud-combo");
    if (p.combo > 1) {
      combo.hidden = false;
      combo.textContent = "×" + p.combo + "  (" + p.chain + ")";
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
      $("hud-powers").innerHTML = chipText ? "<b>" + chipText + "</b>" : "";
    }

    const prompt = $("bribe-prompt");
    if (!!p.encounter !== state.ducked) {
      state.ducked = !!p.encounter;
      audio.duck(state.ducked);
    }
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
    {
      at: 1.5,
      text: "Окупи аренду: собирай купюры. Каждая начатая минута стоит тариф машины. Газ: W, руль: A / D",
    },
    { at: 9, text: "Сбивай силуэты цепочкой — комбо множит очки и розыск" },
    {
      at: 22,
      text: "Розыск растёт: едут патрули. Жми ПРОБЕЛ рядом с ментом — дашь взятку",
    },
    {
      at: 40,
      text: "БПЛА подсвечивает полосу перед пикированием: смени полосу или собери глушилку",
    },
    {
      at: 66,
      text: "Нитро (SHIFT) таранит патруль и сбивает дроны — но розыск скакнёт вверх",
    },
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
      el.hidden = false;
      el.classList.add("show");
    }
    if (state.coachTimer > 0) {
      state.coachTimer -= dt;
      if (state.coachTimer <= 0) {
        el.classList.remove("show");
        el.hidden = true;
      }
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
    const p = state.world.player;
    ["3", "2", "1"].forEach((digit, i) =>
      worldPop(state.world, digit, p.x, p.y - 230, "gold", 0.45, i * 0.4),
    );
    worldPop(state.world, "ПОЕХАЛИ!", p.x, p.y - 230, "combo", 1.1, 1.25);
    state.finalCall = false;
    state.goPlayed = false;
    state.lastCheer = -99;
    const best = records().cars["car" + state.world.car.id];
    state.recordScore = best ? best.best : 0;
    state.recordBeaten = false;
    const recordEl = $("hud-record");
    recordEl.hidden = !state.recordScore;
    recordEl.textContent = state.recordScore
      ? "рекорд " + state.recordScore.toLocaleString("ru-RU")
      : "";
    document.querySelector(".hud-score").classList.remove("beat");
    audio.music(true, true);
    canvas.focus({ preventScroll: true });
    $("drive-stage").scrollIntoView({ block: "center", behavior: "instant" });
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
        ? "БАМПЕР ДОЕЗДИЛСЯ"
        : reason === "quit"
          ? "СМЕНА ПРЕРВАНА"
          : "СМЕНА ЗАКРЫТА";
    $("result-grade").textContent = result.won ? result.grade : "−";
    $("result-title").textContent = result.won
      ? "Смена в плюсе!"
      : result.profitable
        ? "Прибыль есть, машина не доехала"
        : "Тариф не окупился";
    $("result-profit").textContent = money(result.profit);
    $("result-profit").classList.toggle("loss", result.profit < 0);
    $("result-score").textContent =
      result.score.toLocaleString("ru-RU") +
      " очков · бонус " +
      result.bonus +
      " очков" +
      " · " +
      world.car.name +
      " " +
      world.car.plate;
    $("result-stars").innerHTML = Array.from(
      { length: 3 },
      (_, i) =>
        `<span class="${result.won && i < result.stars ? "" : "off"}">★</span>`,
    ).join("");
    const rows = [
      ["Выручка за смену", money(result.revenue)],
      [
        "Аренда · " + money(result.rateKopecks) + "/мин",
        money(result.rentalCost),
      ],
      ["Взятки, штрафы и потери", money(result.expenses)],
      ["Чистая прибыль", money(result.profit)],
      [
        "Сбито силуэтов",
        result.knockdowns + (result.vip ? " (звёзд " + result.vip + ")" : ""),
      ],
      ["Лучшее комбо", "×" + result.bestCombo],
      ["Взяток дано", result.bribes],
      ["Протоколов", result.failed],
      ["БПЛА валено", result.drones],
      ["Таранов патруля", result.rams],
      ["Уклонов от дронов", result.dodges],
      ["Кэш в кармане", money(result.cash)],
      ["Долг за аренду", money(result.rentalDebt)],
      ["Максимум км/ч", result.topSpeed],
      ["Дистанция", result.distance.toFixed(1) + " км"],
    ];
    $("result-stats").innerHTML = rows
      .map((r) => `<li><span>${r[0]}</span><strong>${r[1]}</strong></li>`)
      .join("");
    const note = [];
    note.push(
      "Стартовые 50 ₽ не входят в выручку. Для победы нужно доехать до конца и заработать больше аренды и остальных расходов.",
    );
    if (isBest) note.push("Новый рекорд на этой машине!");
    const best = records().cars["car" + world.car.id];
    if (best) note.push("Рекорд: " + best.best.toLocaleString("ru-RU"));
    if (result.failed > result.bribes)
      note.push("Совет: держи кэш — пустой карман означает протокол.");
    if (result.knockdowns > 0 && result.bribes === 0 && result.failed > 0)
      note.push("Взятка дешевле ремонта: копи купюры и жми ПРОБЕЛ.");
    $("result-note").textContent = note.join(" ");
    if (result.reason === "wrecked") {
      audio.sfx("lose");
      audio.sfx("loseWreck");
    } else if (result.reason === "quit") {
      audio.sfx("lose");
    } else if (result.won) {
      audio.sfx("win");
    } else {
      audio.sfx("lose");
      audio.sfx("defeat");
    }
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
        best.combo +
        " · лучшая прибыль " +
        money(best.bestProfit || 0) +
        " · побед " +
        (best.wins || 0);
    } else el.hidden = true;
  }

  async function boot() {
    let car;
    try {
      car = await loadCar();
    } catch (error) {
      $("intro-car").textContent = "Машина недоступна";
      $("intro-perk").textContent = error.message;
      $("drive-start").disabled = true;
      return;
    }
    state.car = car;
    const name =
      ((car.brand || "") + " " + (car.model || "")).trim() || "Ночной Драйв";
    $("drive-title").textContent = car.demo
      ? "Ночная смена"
      : "Ночная смена · " + name;
    $("intro-car").textContent = car.demo
      ? "Машина не выбрана — демо «Драйв Ночной»"
      : name + " · " + (car.plate || "");
    $("drive-sub").textContent = car.demo
      ? "Выберите автомобиль в каталоге, чтобы гонять на нём по ночному проспекту."
      : "Ваш «" +
        name +
        "» (" +
        (
          core.CLASSES[car.category] || core.CLASSES.comfort
        ).label.toLowerCase() +
        ") выехал на проспект. Смена длится 2:30.";
    const profile = core.carProfile(car);
    $("intro-perk").textContent = profile.perk;
    $("intro-tariff").textContent =
      (car.rentalTariff ? "Тариф вашей аренды: " : "Тариф машины: ") +
      money(car.rate_kopecks) +
      "/мин · до " +
      money(core.rentalCost(car.rate_kopecks, core.SHIFT_SECONDS)) +
      " за смену. Каждая начатая минута оплачивается целиком.";
    $("intro-specs").textContent =
      "Скин: " +
      profile.label +
      " · " +
      profile.maxSpeed +
      " км/ч · руль ×" +
      profile.steer +
      " · разгон ×" +
      profile.acceleration +
      " · " +
      profile.hearts +
      " бамперов";
    setRecordsPreview();
    state.world = createWorld(true);
    const preview = $("car-preview");
    const palette = carPalette(car);
    preview.setAttribute("aria-label", profile.label);
    art.playerCar(preview.getContext("2d"), {
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
    setMode("intro");
    const rulesLoop = () => {
      audio.unlock();
      if (state.mode === "intro") audio.loop(true);
    };
    window.addEventListener("pointerdown", rulesLoop, { once: true });
    window.addEventListener("keydown", rulesLoop, { once: true });
    rulesLoop();
    if ($("drive-calm").getAttribute("aria-pressed") === "true")
      state.calm = true;
    $("drive-start").addEventListener("click", start);
    $("drive-start").disabled = false;
    if ($("touch-pause"))
      $("touch-pause").addEventListener("click", () => togglePause());
    $("resume").addEventListener("click", () => togglePause());
    $("quit").addEventListener("click", quitShift);
    $("again").addEventListener("click", restart);
    $("drive-sound").addEventListener("click", () => setMuted(!state.muted));
    $("drive-calm").addEventListener("click", () => {
      state.calm = !state.calm;
      $("drive-calm").setAttribute("aria-pressed", String(state.calm));
      $("drive-calm").textContent = state.calm
        ? "Без миганий: вкл"
        : "Без миганий";
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
