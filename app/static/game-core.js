/* Детерминированная логика мини-игры «НОЧНАЯ СМЕНА». Без DOM и canvas. */
(function (global) {
  "use strict";

  const WORLD = {
    width: 900,
    height: 1200,
    roadTop: 236,
    roadLeft: 170,
    roadRight: 730,
    lanes: 4,
    playerY: 940,
    pxPerKmh: 4.2,
  };
  WORLD.laneWidth = (WORLD.roadRight - WORLD.roadLeft) / WORLD.lanes;
  WORLD.laneCenters = Array.from(
    { length: WORLD.lanes },
    (_, i) => WORLD.roadLeft + WORLD.laneWidth * (i + 0.5),
  );

  const CLASSES = {
    economy: {
      label: "Эконом",
      maxSpeed: 162,
      steer: 1.35,
      mass: 0.95,
      hearts: 6,
      knockWidth: 0.92,
      bribeDiscount: 0,
      magnet: 96,
      nitroGain: 7.5,
      perk: "Юркая: рулится резче всех и набивает нитро с полуоборота — кто быстро думает, тот быстро уезжает.",
    },
    comfort: {
      label: "Комфорт",
      maxSpeed: 172,
      steer: 1,
      mass: 1,
      hearts: 6,
      knockWidth: 1,
      bribeDiscount: 0.06,
      magnet: 118,
      nitroGain: 5.5,
      perk: "Городской баланс: разгон, держак и снисходительный патруль.",
    },
    business: {
      label: "Бизнес",
      maxSpeed: 188,
      steer: 0.85,
      mass: 1.15,
      hearts: 6,
      knockWidth: 1.1,
      bribeDiscount: 0.2,
      magnet: 138,
      nitroGain: 4.5,
      perk: "Тяжёлый таран: ловит ямы вполбампера и договаривается дешевле всех — но повороты на себя тянет долго.",
    },
  };

  const DIFFICULTY = {
    relaxed: { spawn: 0.78, heatGain: 0.75, label: "Прогулка" },
    normal: { spawn: 1, heatGain: 1, label: "Смена" },
    hardcore: { spawn: 1.32, heatGain: 1.25, label: "Пикет" },
  };

  const PHASES = [
    { name: "Дворы", until: 50, spawn: 1, tint: "dusk", bonus: 1 },
    { name: "Проспект", until: 105, spawn: 1.2, tint: "night", bonus: 1.15 },
    { name: "Неоновый пик", until: 1e9, spawn: 1.4, tint: "neon", bonus: 1.3 },
  ];

  const SHIFT_SECONDS = 150;
  const GRADES = [
    { grade: "S", score: 70000, title: "Король ночного проспекта" },
    { grade: "A", score: 50000, title: "Легенда района" },
    { grade: "B", score: 32000, title: "Ночной завсегдатай" },
    { grade: "C", score: 18000, title: "Довольно бодро" },
    { grade: "D", score: 0, title: "Первая practice-смена" },
  ];

  const RULES = {
    comboWindow: 1.7,
    comboWindowStep: 0,
    comboWindowMax: 1.7,
    comboCap: 6,
    baseScore: 95,
    heatPerKnock: 0.34,
    heatPerVip: 0.75,
    heatDecay: 0.2,
    heatDecayIdle: 0.45,
    heatIdleAfter: 5,
    bribeBase: 320,
    bribePerHeat: 240,
    bribeEscalation: 0.08,
    bribeWindow: 1.35,
    droneLock: 1.35,
    droneHover: 0.9,
    nitroCost: 34,
    nitroTime: 3.2,
    invuln: 2.1,
    powerupTime: 9,
    grace: 12,
    damage: { pothole: 0.42, barrier: 0.75, drone: 0.7, curb: 0, protocol: 1 },
  };

  const PICKUPS = {
    cash: { label: "Купюра", weight: 0 },
    nitro: { label: "Баллон нитро", weight: 2 },
    repair: { label: "Ремонт бампера", weight: 2 },
    magnet: { label: "Магнит на наличность", weight: 2 },
    radar: { label: "Глушилка дронов", weight: 2 },
    shield: { label: "Броневой бампер", weight: 2 },
  };

  const rand = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const laneAt = (x) =>
    clamp(Math.floor((x - WORLD.roadLeft) / WORLD.laneWidth), 0, WORLD.lanes - 1);

  let nextId = 1;

  function createRun(options) {
    const cfg = options || {};
    const cls = CLASSES[cfg.category] || CLASSES.comfort;
    const difficulty = DIFFICULTY[cfg.difficulty] || DIFFICULTY.normal;
    const world = {
      seed: cfg.seed || (Date.now() & 0xffffff),
      rng: rand(cfg.seed || (Date.now() & 0xffffff)),
      car: {
        id: cfg.carId || 0,
        name: cfg.carName || "Драйв",
        plate: cfg.plate || "А000АА00",
        category: cfg.category in CLASSES ? cfg.category : "comfort",
        color: cfg.color || "#d5ff5f",
        accent: cfg.accent || "#17312e",
      },
      cls,
      difficulty,
      rules: RULES,
      time: 0,
      shift: cfg.shift || SHIFT_SECONDS,
      phase: 0,
      phaseName: PHASES[0].name,
      status: "running",
      events: [],
      stats: {
        knockdowns: 0,
        vipKnockdowns: 0,
        cashEarned: 0,
        cashSpent: 0,
        bribes: 0,
        failedBribes: 0,
        rams: 0,
        dronesDown: 0,
        dodges: 0,
        damageTaken: 0,
        distance: 0,
        topSpeed: 0,
      },
      player: {
        x: WORLD.laneCenters[1],
        y: WORLD.playerY,
        vx: 0,
        speed: 70,
        width: 112 * cls.knockWidth,
        height: 168,
        hearts: cls.hearts,
        maxHearts: cls.hearts,
        armor: 0,
        cash: 500,
        nitro: 40,
        nitroTime: 0,
        invuln: 1.2,
        spin: 0,
        tilt: 0,
        bounce: 0,
        score: 0,
        chain: 0,
        combo: 1,
        comboTime: 0,
        heat: 0,
        lastKnock: -99,
        powers: { magnet: 0, radar: 0, shield: 0 },
        encounter: null,
      },
      targets: [],
      cops: [],
      drones: [],
      props: [],
      pickups: [],
      fx: [],
      timers: {
        target: 1.1,
        cash: 2.2,
        cop: 6,
        drone: 12,
        prop: 3.4,
        power: 11,
        crowd: 0,
      },
    };
    world.rng = rand(world.seed);
    return world;
  }

  function emit(world, type, data) {
    world.events.push(Object.assign({ type, t: world.time }, data));
  }

  function phaseInfo(world) {
    let index = PHASES.length - 1;
    for (let i = 0; i < PHASES.length; i++)
      if (world.time < PHASES[i].until) {
        index = i;
        break;
      }
    return Object.assign({ index }, PHASES[index]);
  }

  function spawnTarget(world, options) {
    const o = options || {};
    const rng = world.rng;
    const lane = o.lane === undefined ? Math.floor(rng() * WORLD.lanes) : o.lane;
    const vip = o.vip !== undefined ? o.vip : rng() < 0.08 + world.phase * 0.02;
    const fromLeft = o.fromLeft === undefined ? rng() < 0.5 : o.fromLeft;
    const y = o.y === undefined ? -140 - rng() * 420 : o.y;
    const edge = fromLeft ? 46 : WORLD.width - 46;
    const target = {
      id: nextId++,
      x: o.x === undefined ? edge : o.x,
      y,
      startY: y,
      vx: 0,
      vy: 0,
      radius: 30 * (vip ? 1.06 : 1),
      speed: (vip ? 74 : 52 + rng() * 46) * (0.7 + world.phase * 0.14),
      dir: fromLeft ? 1 : -1,
      lane,
      vip,
      case: rng() < 0.3,
      hue: Math.floor(rng() * 360),
      wig: rng() < 0.5 ? "bun" : "long",
      stride: rng() * Math.PI * 2,
      state: "walking",
      alpha: 1,
      scale: 1,
      spin: 0,
      spinSpeed: 0,
      alarmed: 0,
      purse: vip ? 150 + Math.floor(rng() * 90) : 34 + Math.floor(rng() * 30),
      crossroad: rng() < 0.65,
      pauseTimer: 0,
    };
    target.laneTargetX = WORLD.laneCenters[lane];
    if (!target.crossroad) {
      target.x = WORLD.laneCenters[lane];
      target.dir = rng() < 0.5 ? 1 : -1;
      target.speed *= 0.5;
    }
    world.targets.push(target);
    return target;
  }

  function crowd(world) {
    const busy = world.phase + world.player.heat >= 4;
    const group = 1 + Math.floor(world.rng() * (busy ? 3 : 2));
    const lane = Math.floor(world.rng() * WORLD.lanes);
    const fromLeft = world.rng() < 0.5;
    const base = spawnTarget(world, { lane, fromLeft, y: -150 });
    base.crossroad = true;
    for (let i = 1; i < group; i++) {
      const t = spawnTarget(world, {
        lane,
        fromLeft,
        y: -150 - world.rng() * 60,
        x: base.x + (fromLeft ? -1 : 1) * i * 46,
      });
      t.crossroad = true;
      t.purse = Math.round(t.purse * 0.8);
    }
    if (world.rng() < 0.16) spawnTarget(world, { lane: (lane + 2) % WORLD.lanes, vip: true });
  }

  function spawnCop(world, pursue) {
    if (world.cops.length >= 3) return;
    const rng = world.rng;
    const lane = pursue
      ? laneAt(world.player.x)
      : Math.floor(rng() * WORLD.lanes);
    const x = WORLD.laneCenters[lane];
    const y = pursue ? -170 : -160 - rng() * 240;
    if (world.cops.some((o) => Math.abs(o.x - x) < 120 && Math.abs(o.y - y) < 260)) return;
    const cop = {
      id: nextId++,
      x,
      y,
      vx: 0,
      lane,
      speed: pursue ? 128 + world.phase * 12 : 74 + rng() * 26,
      mode: pursue ? "pursue" : "patrol",
      width: 118,
      height: 172,
      siren: rng() * Math.PI * 2,
      alongside: 0,
      leaving: 0,
      spin: 0,
      spinSpeed: 0,
      alpha: 1,
      flash: 0,
    };
    world.cops.push(cop);
    emit(world, "copSpawn", { mode: cop.mode, x: cop.x, y: cop.y });
  }

  function spawnDrone(world) {
    if (world.drones.length >= 3) return;
    const rng = world.rng;
    const drone = {
      id: nextId++,
      x: WORLD.roadLeft + rng() * (WORLD.roadRight - WORLD.roadLeft),
      y: -80,
      hoverY: 300 + rng() * 110,
      state: "approach",
      timer: 0,
      lockX: 0,
      spin: 0,
      rotor: rng() * Math.PI * 2,
      alpha: 1,
      vy: 0,
      scale: 1,
      jam: 0,
    };
    world.drones.push(drone);
    emit(world, "droneSpawn", { x: drone.x });
  }

  function spawnProp(world) {
    const rng = world.rng;
    const kinds =
      world.phase > 1
        ? ["cone", "oil", "pothole", "barrier", "pothole", "cone"]
        : ["cone", "oil", "pothole", "cone"];
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const lane = Math.floor(rng() * WORLD.lanes);
    const spawnY = -160 - rng() * 200;
    if (world.props.some((s) => s.lane === lane && Math.abs(s.y - spawnY) < 520)) return;
    const props = {
      cone: { radius: 34, damage: 0, label: "Конус" },
      oil: { radius: 58, damage: 0, label: "Масло" },
      pothole: { radius: 46, damage: RULES.damage.pothole, label: "Яма" },
      barrier: { radius: 62, damage: RULES.damage.barrier, label: "Лежачий патрульный" },
    }[kind];
    world.props.push({
      id: nextId++,
      kind,
      lane,
      x: WORLD.laneCenters[lane] + (rng() - 0.5) * 30,
      y: spawnY,
      radius: props.radius,
      damage: props.damage,
      spin: rng() * Math.PI,
      used: false,
    });
  }

  function spawnPickup(world, kind, x, y, value) {
    if (kind === "cash" && world.pickups.filter((p) => p.kind === "cash").length > 26) return;
    world.pickups.push({
      id: nextId++,
      kind,
      x,
      y,
      value: value || 0,
      bob: Math.random() * Math.PI * 2,
      vy: 0,
      life: kind === "cash" ? 14 : 20,
      alpha: 1,
      radius: kind === "cash" ? 26 : 32,
    });
  }

  function cashCluster(world) {
    const rng = world.rng;
    const lane = Math.floor(rng() * WORLD.lanes);
    const count = 2 + Math.floor(rng() * 2);
    const fromLeft = rng() < 0.5;
    for (let i = 0; i < count; i++) {
      const value = 30 + Math.floor(rng() * 40) + world.phase * 12;
      spawnPickup(
        world,
        "cash",
        WORLD.laneCenters[lane] + (i % 2 ? 30 : -30) + (rng() - 0.5) * 18,
        -120 - i * 74 - (fromLeft ? 0 : 40),
        value,
      );
    }
  }

  function powerDrop(world) {
    const rng = world.rng;
    const hurt = world.player.hearts <= world.player.maxHearts - 2;
    const pool = hurt
      ? ["repair", "repair", "nitro", "magnet", "shield", "radar"]
      : ["nitro", "magnet", "radar", "shield", "cash", "cash", "repair"];
    const kind = pool[Math.floor(rng() * pool.length)];
    const lane = Math.floor(rng() * WORLD.lanes);
    if (kind === "cash") {
      for (let i = 0; i < 3; i++)
        spawnPickup(world, "cash", WORLD.laneCenters[lane] + (i - 1) * 34, -140 - i * 66, 120);
      return;
    }
    spawnPickup(
      world,
      kind,
      WORLD.laneCenters[lane],
      -140,
      kind === "nitro" ? 30 : kind === "repair" ? 1 : 0,
    );
  }

  function burst(world, type, x, y, data) {
    world.fx.push(Object.assign({ kind: type, x, y, life: 0, ttl: 0.7 }, data));
  }

  function popText(world, text, x, y, tone) {
    const pops = world.fx.filter((f) => f.kind === "pop");
    if (pops.length >= 5) world.fx.splice(world.fx.indexOf(pops[0]), 1);
    world.fx.push({
      kind: "pop",
      text,
      x: clamp(x + (pops.length - 2) * 46, 130, WORLD.width - 130),
      y: y - pops.length * 26,
      tone: tone || "neutral",
      life: 0,
      ttl: 1.1,
      vy: -110,
    });
  }

  function comboOf(chain) {
    return clamp(1 + Math.floor(chain / 2), 1, RULES.comboCap);
  }

  function speedFactor(world) {
    return clamp(world.player.speed / world.cls.maxSpeed, 0.5, 1.15);
  }

  function bribeCost(world) {
    const heat = Math.max(1, Math.round(world.player.heat));
    const escalation = 1 + RULES.bribeEscalation * world.stats.bribes;
    const raw = (RULES.bribeBase + RULES.bribePerHeat * heat) * escalation;
    return Math.round(raw * (1 - world.cls.bribeDiscount) / 10) * 10;
  }

  function scrape(world, source) {
    const p = world.player;
    p.speed = Math.max(42, p.speed * 0.9);
    if (p.chain > 1) popText(world, "СТЁР БОРТЮР", p.x, p.y - 120, "bad");
    emit(world, "graze", { source });
  }

  function damage(world, amount, source) {
    const p = world.player;
    if (p.invuln > 0 || amount <= 0) return false;
    if (p.encounter && source !== "protocol") return false;
    if (p.powers.shield > 0) {      p.powers.shield = 0;
      p.invuln = 0.9;
      popText(world, "БРОНЯ УШЛА!", p.x, p.y - 120, "good");
      burst(world, "ring", p.x, p.y, { color: "#7fe3d8" });
      emit(world, "shieldBreak", { source });
      return false;
    }
    p.armor +=
      (amount *
        (source === "protocol"
          ? 1
          : 0.62 + 0.85 * clamp(p.speed / world.cls.maxSpeed, 0, 1))) /
      world.cls.mass;
    if (p.armor < 1) {
      burst(world, "shake", 0, 0, { power: 8 });
      emit(world, "graze", { source });
      return false;
    }
    p.armor = 0;
    p.hearts -= 1;
    p.invuln = RULES.invuln;
    p.chain = 0;
    p.combo = 1;
    p.comboTime = 0;
    world.stats.damageTaken += 1;
    burst(world, "shake", 0, 0, { power: 22 });
    popText(world, "БАМ!", p.x, p.y - 130, "bad");
    emit(world, "damage", { source, hearts: p.hearts });
    if (p.hearts <= 0) {
      p.hearts = 0;
      world.status = "wrecked";
      emit(world, "end", { reason: "wrecked" });
    }
    return true;
  }

  function knock(world, target) {
    const p = world.player;
    target.state = "launched";
    target.launch = 0;
    target.vy = -(360 + p.speed * 1.5);
    target.vx = clamp(p.vx * 0.5, -260, 260) + (target.x < p.x ? -140 : 140);
    target.spinSpeed = (target.x < p.x ? -1 : 1) * (7 + Math.random() * 5);
    p.chain += 1;
    p.combo = comboOf(p.chain);
    p.comboTime = Math.min(
      RULES.comboWindowMax,
      RULES.comboWindow + p.chain * RULES.comboWindowStep,
    );
    p.lastKnock = world.time;
    const phase = phaseInfo(world);
    const nitroMul = p.nitroTime > 0 ? 1.5 : 1;
    const points = Math.round(
      RULES.baseScore *
        p.combo *
        speedFactor(world) *
        phase.bonus *
        nitroMul *
        (target.vip ? 3 : 1),
    );
    p.score += points;
    p.nitro = clamp(p.nitro + world.cls.nitroGain, 0, 100);
    p.heat = clamp(
      p.heat + (target.vip ? RULES.heatPerVip : RULES.heatPerKnock) * world.difficulty.heatGain,
      0,
      6,
    );
    world.stats.knockdowns += 1;
    world.stats.bestCombo = Math.max(world.stats.bestCombo || 1, p.combo);
    if (target.vip) world.stats.vipKnockdowns += 1;
    const notes = target.vip ? 2 : 1;
    for (let i = 0; i < notes; i++) {
      spawnPickup(
        world,
        "cash",
        target.x + (Math.random() - 0.5) * 70,
        target.y - 26 - i * 44,
        Math.round(target.purse / notes),
      );
    }
    burst(world, "stars", target.x, target.y, { count: target.vip ? 14 : 8, color: target.vip ? "#ffd85e" : "#ff9ec7" });
    burst(world, "ring", target.x, target.y, { color: target.vip ? "#ffd85e" : "#ff7ab8" });
    popText(
      world,
      target.vip ? "ЗВЕЗДА! +" + points : ["ОЙ!", "БАЦ!", "УХ!", "ЛЕТИМ!"][Math.floor(Math.random() * 4)] + " +" + points,
      target.x,
      target.y - 40,
      target.vip ? "gold" : "good",
    );
    if (p.combo >= 4) popText(world, "x" + p.combo + " КОМБО", p.x, p.y - 190, "combo");
    burst(world, "shake", 0, 0, { power: target.vip ? 16 : 9 });
    emit(world, "knock", {
      x: target.x,
      y: target.y,
      points,
      combo: p.combo,
      vip: target.vip,
    });
  }

  function openEncounter(world, cop) {
    const p = world.player;
    if (p.encounter || p.invuln > 0) return false;
    const cost = bribeCost(world);
    cop.mode = "block";
    cop.alongside = 1;
    p.encounter = { copId: cop.id, timer: RULES.bribeWindow, cost, shown: cost, pressed: false };
    p.chain = 0;
    p.combo = 1;
    emit(world, "encounter", { cost, x: cop.x, y: cop.y });
    return true;
  }

  function payBribe(world) {
    const p = world.player;
    if (!p.encounter) return;
    const cop = world.cops.find((c) => c.id === p.encounter.copId);
    if (p.cash < p.encounter.cost) {
      p.encounter.pressed = true;
      emit(world, "broke", { cost: p.encounter.cost });
      popText(world, "НЕ ЧЕМ ДАВАТЬ", p.x, p.y - 210, "bad");
      return;
    }
    p.cash -= p.encounter.cost;
    world.stats.cashSpent += p.encounter.cost;
    world.stats.bribes += 1;
    p.heat = clamp(p.heat - 2.2, 0, 6);
    p.nitro = clamp(p.nitro + 12, 0, 100);
    p.score += 260 + Math.round(p.heat * 120);
    p.invuln = Math.max(p.invuln, 0.8);
    if (cop) {
      cop.leaving = 1;
      cop.spinSpeed = 2.4;
      burst(world, "coins", cop.x, cop.y, { count: 10 });
    }
    popText(world, "ДОГОВОРИЛИСЬ!", p.x, p.y - 200, "good");
    burst(world, "ring", p.x, p.y, { color: "#d5ff5f" });
    emit(world, "bribe", { cost: p.encounter.cost, x: cop ? cop.x : p.x, y: cop ? cop.y : p.y });
    p.encounter = null;
  }

  function closeEncounter(world, paid) {
    const p = world.player;
    if (!p.encounter) return;
    const cop = world.cops.find((c) => c.id === p.encounter.copId);
    if (!paid) {
      world.stats.failedBribes += 1;
      const fine = Math.round(Math.min(p.cash, p.encounter.cost * 0.5));
      p.cash -= fine;
      world.stats.cashSpent += fine;
      p.heat = clamp(p.heat - 1.4, 0, 6);
      damage(world, RULES.damage.protocol, "protocol");
      p.invuln = Math.max(p.invuln, RULES.invuln);
      if (fine > 0) popText(world, "ПРОТОКОЛ −" + fine, p.x, p.y - 210, "bad");
      else popText(world, "ПРОТОКОЛ!", p.x, p.y - 210, "bad");
      emit(world, "protocol", { fine });
    }
    if (cop) {
      cop.leaving = 1;
      cop.alongside = 0;
    }
    p.encounter = null;
  }

  function ramCop(world, cop) {
    const p = world.player;
    cop.spinSpeed = (cop.x < p.x ? -1 : 1) * 9;
    cop.leaving = 1;
    cop.flash = 0.35;
    p.heat = clamp(p.heat + 0.9 * world.difficulty.heatGain, 0, 6);
    p.score += 420;
    p.chain += 1;
    p.combo = comboOf(p.chain);
    world.stats.rams += 1;
    burst(world, "stars", cop.x, cop.y, { count: 12, color: "#7fd1ff" });
    burst(world, "shake", 0, 0, { power: 20 });
    popText(world, "ВЫТЕСНИЛ! +420", cop.x, cop.y - 60, "combo");
    emit(world, "ram", { x: cop.x, y: cop.y });
    if (p.encounter && p.encounter.copId === cop.id) closeEncounter(world, true);
  }

  function updatePlayer(world, dt, input) {
    const p = world.player;
    const cls = world.cls;
    const i = input || {};
    let steerAxis = clamp(
      (i.right ? 1 : 0) - (i.left ? 1 : 0) + (typeof i.steer === "number" ? i.steer : 0),
      -1,
      1,
    );
    if (p.spin > 0) steerAxis = -steerAxis + (p.spinDir || 1) * 0.5;
    const throttle = clamp(
      (i.fast ? 1 : 0) - (i.slow ? 1 : 0) + (typeof i.throttle === "number" ? i.throttle : 0),
      -1,
      1,
    );

    const nitroOn = p.nitroTime > 0;
    const ceiling = cls.maxSpeed * (nitroOn ? 1.22 : 1);
    const cruise = cls.maxSpeed * 0.52;
    if (p.spin > 0) p.spin -= dt;
    if (throttle > 0.05) p.speed += (70 + 90 * throttle) * dt;
    else if (throttle < -0.05) p.speed -= 130 * dt;
    else p.speed += (cruise - p.speed) * 0.55 * dt;
    p.speed = clamp(p.speed, nitroOn ? ceiling * 0.8 : 42, ceiling);
    world.stats.topSpeed = Math.max(world.stats.topSpeed, p.speed);

    const accel = 2400 * cls.steer * (nitroOn ? 1.15 : 1);
    const maxVx = 620 * cls.steer;
    p.vx += steerAxis * accel * dt;
    p.vx *= Math.pow(0.0016, dt);
    if (Math.abs(p.vx) > maxVx) p.vx = Math.sign(p.vx) * maxVx;
    p.x += p.vx * dt;
    const minX = WORLD.roadLeft + p.width / 2 + 6;
    const maxX = WORLD.roadRight - p.width / 2 - 6;
    if (p.x < minX) {
      p.x = minX;
      if (p.vx < -120) {
        burst(world, "dust", p.x - 40, p.y, { count: 6 });
        p.vx = -p.vx * 0.3;
        scrape(world, "curb");
      } else p.vx = Math.abs(p.vx) * 0.25;
    }
    if (p.x > maxX) {
      p.x = maxX;
      if (p.vx > 120) {
        burst(world, "dust", p.x + 40, p.y, { count: 6 });
        p.vx = -p.vx * 0.3;
        scrape(world, "curb");
      } else p.vx = -Math.abs(p.vx) * 0.25;
    }
    p.tilt = lerp(p.tilt, clamp(p.vx / maxVx, -1, 1) * 0.24, 1 - Math.pow(0.001, dt));
    p.bounce = Math.sin(world.time * (9 + p.speed / 26)) * (0.6 + p.speed / 260);

    const scroll = p.speed * WORLD.pxPerKmh;
    world.stats.distance += (p.speed / 3600) * dt * 1.9;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.nitroTime > 0) {
      p.nitroTime -= dt;
      p.nitro = clamp(p.nitro - 100 * (dt / RULES.nitroTime), 0, 100);
      if (p.nitroTime <= 0) {
        p.nitroTime = 0;
        emit(world, "nitroEnd", {});
      }
    }
    for (const key of ["magnet", "radar", "shield"]) {
      if (p.powers[key] > 0) {
        p.powers[key] -= dt;
        if (p.powers[key] <= 0) {
          p.powers[key] = 0;
          emit(world, "powerEnd", { key });
        }
      }
    }
    if (p.comboTime > 0) {
      p.comboTime -= dt;
      if (p.comboTime <= 0) {
        if (p.chain > 3) popText(world, "КОМБО ПОТЕРЯНО", p.x, p.y - 160, "bad");
        p.chain = 0;
        p.combo = 1;
      }
    }
    const idle = world.time - p.lastKnock > RULES.heatIdleAfter;
    const drift = p.encounter ? 0 : idle ? RULES.heatDecayIdle : RULES.heatDecay;
    p.heat = clamp(p.heat - drift * dt, 0, 6);
    return scroll;
  }

  function updateTargets(world, dt, scroll) {
    const p = world.player;
    const front = { x: p.x, y: p.y - p.height * 0.34, r: p.width * 0.62 };
    for (let k = world.targets.length - 1; k >= 0; k--) {
      const t = world.targets[k];
      t.stride += dt * (3 + t.speed / 22);
      if (t.state === "launched") {
        t.launch += dt;
        t.x += t.vx * dt;
        t.y += (t.vy + scroll * 0.35) * dt;
        t.vy += 900 * dt;
        t.spin += t.spinSpeed * dt;
        t.scale = clamp(t.scale - dt * 0.55, 0.2, 1);
        t.alpha = clamp(1 - (t.launch - 0.55) / 0.6, 0, 1);
        if (t.alpha <= 0.02 || t.y > WORLD.height + 260) world.targets.splice(k, 1);
        continue;
      }
      if (t.y < p.y - 60) t.y += scroll * dt;
      if (t.crossroad) {
        t.x += t.dir * t.speed * dt;
        if (t.pauseTimer > 0) t.pauseTimer -= dt;
        else if (Math.random() < dt * 0.12 && t.x > WORLD.roadLeft && t.x < WORLD.roadRight)
          t.pauseTimer = 0.5 + Math.random() * 0.7;
        if (t.x < WORLD.roadLeft - 6 || t.x > WORLD.roadRight + 6) {
          t.dir *= -1;
          t.x = clamp(t.x, WORLD.roadLeft - 6, WORLD.roadRight + 6);
          t.lane = (t.lane + 1 + Math.floor(Math.random() * 2)) % WORLD.lanes;
          t.y -= 40 + Math.random() * 60;
        }
      } else {
        t.x += (t.laneTargetX - t.x) * Math.min(1, dt * 1.6) + Math.sin(t.stride * 0.4) * 6 * dt;
        if (Math.abs(t.laneTargetX - t.x) < 16 && Math.random() < dt * 0.08) {
          t.lane = (t.lane + (t.dir > 0 ? 1 : -1) + WORLD.lanes) % WORLD.lanes;
          t.laneTargetX = WORLD.laneCenters[t.lane];
        }
      }
      const dx = t.x - front.x;
      const dy = t.y - front.y;
      const hitDist = t.radius + front.r;
      if (dx * dx + dy * dy < hitDist * hitDist && t.state === "walking") {
        knock(world, t);
        continue;
      }
      if (t.y > WORLD.height + 200 || t.y < -900) world.targets.splice(k, 1);
    }
  }

  function updateCops(world, dt, scroll, input) {
    const p = world.player;
    for (let k = world.cops.length - 1; k >= 0; k--) {
      const c = world.cops[k];
      c.siren += dt * 9;
      if (c.flash > 0) c.flash -= dt;
      if (c.spinSpeed) {
        c.spin = (c.spin || 0) + c.spinSpeed * dt;
        c.spinSpeed *= Math.pow(0.2, dt);
      }
      if (c.leaving) {
        c.y += (scroll * 0.55 + 220) * dt;
        c.x += (c.x < p.x ? -160 : 160) * dt;
        c.alpha -= dt * 0.7;
        if (c.alpha <= 0.05 || c.y > WORLD.height + 220) world.cops.splice(k, 1);
        continue;
      }
      if (c.mode === "block" && p.encounter && p.encounter.copId === c.id) {
        const side = c.x < p.x ? -1 : 1;
        const gap = (p.width + c.width) * 0.8;
        const targetX = clamp(p.x + side * gap, WORLD.roadLeft + c.width / 2, WORLD.roadRight - c.width / 2);
        c.x += (targetX - c.x) * Math.min(1, dt * 5);
        c.y += (p.y - 112 - c.y) * Math.min(1, dt * 4);
        c.alongside = 1;
        p.speed = lerp(p.speed, 58, Math.min(1, dt * 2.2));
        p.vx *= Math.pow(0.02, dt);
        p.encounter.timer -= dt;
        if ((input || {}).bribe) payBribe(world);
        else if (p.encounter && p.encounter.timer <= 0) closeEncounter(world, false);
        continue;
      }
      if (c.mode === "pursue") {
        const dx = p.x - c.x;
        c.x += clamp(dx * 3.2, -430, 430) * dt;
        c.y += (p.y - 130 - c.y) * Math.min(1, dt * 1.4) + scroll * 0.06 * dt;
        c.speed = lerp(c.speed, p.speed * 1.02, dt * 1.5);
      } else {
        c.y += (world.player.speed - c.speed) * WORLD.pxPerKmh * dt;
        c.x += Math.sin(world.time * 0.6 + c.id) * 22 * dt;
      }
      const dx = Math.abs(c.x - p.x);
      const dy = Math.abs(c.y - p.y);
      if (dx < (c.width + p.width) * 0.44 && dy < (c.height + p.height) * 0.4) {
        if (p.nitroTime > 0) {
          ramCop(world, c);
          continue;
        }
        openEncounter(world, c);
      }
      if (c.y > WORLD.height + 260 || c.y < -700) world.cops.splice(k, 1);
    }
  }

  function updateDrones(world, dt, scroll) {
    const p = world.player;
    const jammed = p.powers.radar > 0;
    for (let k = world.drones.length - 1; k >= 0; k--) {
      const d = world.drones[k];
      d.rotor += dt * 34;
      if (d.state === "approach") {
        d.y += 240 * dt;
        d.x += (WORLD.laneCenters[laneAt(p.x)] - d.x) * Math.min(1, dt * 0.9);
        if (d.y >= d.hoverY) {
          d.y = d.hoverY;
          d.state = "hover";
          d.timer = jammed ? 99 : RULES.droneHover;
        }
      } else if (d.state === "hover") {
        d.timer -= dt;
        d.x += clamp(p.x - d.x, -320, 320) * dt * 1.1;
        d.y = d.hoverY + Math.sin(world.time * 6 + d.id) * 8;
        if (!jammed && d.timer <= 0) {
          d.state = "lock";
          d.timer = RULES.droneLock;
          d.lockX = p.x;
          emit(world, "droneLock", { x: d.x, y: d.y });
        }
      } else if (d.state === "lock") {
        d.timer -= dt;
        d.lockX += clamp(p.x - d.lockX, -400, 400) * dt * 2.4;
        d.x = d.lockX + Math.sin(world.time * 22) * 3;
        if (jammed) {
          d.state = "hover";
          d.timer = 99;
        } else if (d.timer <= 0) {
          d.state = "dive";
          d.vy = 520;
          emit(world, "droneDive", { x: d.x });
        }
      } else if (d.state === "dive") {
        d.vy += 1500 * dt;
        d.y += (d.vy + scroll * 0.5) * dt;
        d.x += (d.lockX - d.x) * Math.min(1, dt * 8);
        d.spin += dt * 6;
        const dx = Math.abs(d.x - p.x);
        const dy = Math.abs(d.y - p.y);
        if (dx < 62 && dy < 84) {
          if (p.nitroTime > 0) {
            world.stats.dronesDown += 1;
            p.score += 520;
            p.cash += 180;
            world.stats.cashEarned += 180;
            if (p.hearts < p.maxHearts && Math.random() < 0.4) {
              p.hearts += 1;
              popText(world, "ЗАПЧАСТИ +1 БАМПЕР", d.x, d.y - 76, "good");
            } else popText(world, "БПЛА СБИТ! +520", d.x, d.y - 40, "gold");
            burst(world, "boom", d.x, d.y, { color: "#ffd85e" });
            burst(world, "shake", 0, 0, { power: 16 });
            for (let q = 0; q < 3; q++)
              spawnPickup(world, "cash", d.x + (q - 1) * 40, d.y, 70);
            emit(world, "droneKill", { x: d.x, y: d.y });
            world.drones.splice(k, 1);
            continue;
          }
          const hit = damage(world, RULES.damage.drone, "drone");
          if (hit) {
            const lost = Math.round(p.cash * 0.18);
            p.cash -= lost;
            world.stats.cashSpent += lost;
            if (lost > 0) popText(world, "−" + lost + " ₽", p.x, p.y - 170, "bad");
          } else {
            world.stats.dodges += 0;
            popText(world, "ЕСТЬ!", p.x, p.y - 150, "bad");
          }
          d.state = "crash";
          d.vy = 0;
          burst(world, "boom", d.x, d.y, { color: "#ff8f6a" });
          continue;
        }
        if (d.y > p.y + 120) {
          d.state = "crash";
          world.stats.dodges += 1;
          popText(world, "УШЁЛ!", p.x, p.y - 170, "good");
          burst(world, "boom", d.x, p.y + 90, { color: "#9fb0a6", small: 1 });
          emit(world, "droneMiss", { x: d.x });
        }
      } else if (d.state === "crash") {
        d.alpha -= dt * 1.6;
        d.spin += dt * 3;
        if (d.alpha <= 0.05) world.drones.splice(k, 1);
        continue;
      }
      if (d.y > WORLD.height + 200) world.drones.splice(k, 1);
    }
  }

  function updateProps(world, dt, scroll) {
    const p = world.player;
    for (let k = world.props.length - 1; k >= 0; k--) {
      const s = world.props[k];
      s.y += scroll * dt;
      if (s.used) continue;
      const dx = Math.abs(s.x - p.x);
      const dy = Math.abs(s.y - (p.y - p.height * 0.2));
      if (dx < s.radius + p.width * 0.42 && dy < s.radius + p.height * 0.3) {
        s.used = true;
        if (s.kind === "cone") {
          p.speed = Math.max(42, p.speed - 14);
          burst(world, "dust", s.x, s.y, { count: 8, color: "#ff9d4d" });
          if (p.nitroTime <= 0) burst(world, "shake", 0, 0, { power: 6 });
          emit(world, "cone", { x: s.x, y: s.y });
        } else if (s.kind === "oil") {
          if (p.nitroTime <= 0) {
            p.spin = 0.85;
            p.spinDir = p.vx >= 0 ? 1 : -1;
            p.vx += (Math.random() < 0.5 ? -1 : 1) * 320;
            popText(world, "ЗАНЕСЛО!", p.x, p.y - 150, "bad");
            emit(world, "spin", {});
          }
          burst(world, "dust", s.x, s.y, { count: 6, color: "#4b5f7a" });
        } else {
          if (p.nitroTime > 0) {
            burst(world, "dust", s.x, s.y, { count: 10 });
            popText(world, "НИТРО ВСЕ РАВНО!", s.x, s.y - 40, "combo");
          } else {
            p.speed = Math.max(42, p.speed - 34);
            damage(world, s.damage, s.kind);
          }
        }
      }
      if (s.y > WORLD.height + 160) world.props.splice(k, 1);
    }
  }

  function updatePickups(world, dt, scroll) {
    const p = world.player;
    const magnet = p.powers.magnet > 0 ? world.cls.magnet * 2.4 : world.cls.magnet;
    for (let k = world.pickups.length - 1; k >= 0; k--) {
      const q = world.pickups[k];
      q.y += scroll * dt * (q.kind === "cash" ? 1 : 0.9);
      q.bob += dt * 5;
      q.life -= dt;
      const dx = p.x - q.x;
      const dy = p.y - 40 - q.y;
      const dist = Math.hypot(dx, dy);
      if (q.kind === "cash" && dist < magnet) {
        const pull = (1 - dist / magnet) * 760 * dt;
        q.x += (dx / (dist || 1)) * pull;
        q.y += (dy / (dist || 1)) * pull;
      }
      if (dist < q.radius + p.width * 0.42) {
        collect(world, q);
        world.pickups.splice(k, 1);
        continue;
      }
      if (q.life <= 0 || q.y > WORLD.height + 160) world.pickups.splice(k, 1);
    }
  }

  function collect(world, q) {
    const p = world.player;
    if (q.kind === "cash") {
      const value = Math.max(20, Math.round(q.value * (1 + p.combo * 0.06)));
      p.cash += value;
      world.stats.cashEarned += value;
      p.nitro = clamp(p.nitro + 2.4, 0, 100);
      p.score += Math.round(value * 0.6);
      burst(world, "coins", q.x, q.y, { count: 5 });
      emit(world, "cash", { value, x: q.x, y: q.y });
      return;
    }
    if (q.kind === "nitro") {
      p.nitro = clamp(p.nitro + 34, 0, 100);
      popText(world, "НИТРО +34", q.x, q.y - 30, "gold");
    } else if (q.kind === "repair") {
      if (p.hearts < p.maxHearts) {
        p.hearts += 1;
        popText(world, "БАМПЕР ЦЕЛ", q.x, q.y - 30, "good");
      } else {
        p.cash += 250;
        world.stats.cashEarned += 250;
        popText(world, "ЗАПЧАСТИ +250₽", q.x, q.y - 30, "gold");
      }
    } else if (q.kind === "magnet") {
      p.powers.magnet = RULES.powerupTime;
      popText(world, "МАГНИТ", q.x, q.y - 30, "good");
    } else if (q.kind === "radar") {
      p.powers.radar = RULES.powerupTime * 0.8;
      for (const d of world.drones)
        if (d.state === "lock") {
          d.state = "hover";
          d.timer = 99;
        }
      popText(world, "ГЛУШИЛКА", q.x, q.y - 30, "good");
    } else if (q.kind === "shield") {
      p.powers.shield = RULES.powerupTime * 1.2;
      popText(world, "БРОНЯ", q.x, q.y - 30, "good");
    }
    burst(world, "ring", q.x, q.y, { color: "#d5ff5f" });
    emit(world, "power", { key: q.kind });
  }

  function updateSpawns(world, dt) {
    const t = world.timers;
    const phase = phaseInfo(world);
    const heat = world.player.heat;
    const rate = world.difficulty.spawn * phase.spawn;
    const warm = world.time > RULES.grace;

    t.target -= dt * rate;
    if (t.target <= 0 && world.targets.length < 9) {
      crowd(world);
      t.target = 1.8 + Math.random() * 1.4 - heat * 0.05;
    }
    t.cash -= dt * (1 + phase.index * 0.1);
    if (t.cash <= 0) {
      cashCluster(world);
      t.cash = 2.2 + Math.random() * 1.6;
    }
    t.power -= dt;
    if (t.power <= 0) {
      powerDrop(world);
      t.power = 8 + Math.random() * 5;
    }
    if (warm) {
      t.prop -= dt * rate;
      if (t.prop <= 0 && world.props.length < 4) {
        spawnProp(world);
        t.prop = 2.6 + Math.random() * 2.4 - phase.index * 0.2;
      }
      if (phase.index >= 1 || heat >= 2) {
        t.drone -= dt * rate * (0.7 + heat * 0.22);
        if (t.drone <= 0) {
          spawnDrone(world);
          t.drone = 6.5 + Math.random() * 4;
        }
      }
    }
    if (heat >= 1) {
      t.cop -= dt * rate * (0.6 + heat * 0.32);
      if (t.cop <= 0) {
        spawnCop(world, heat >= 3 && Math.random() < 0.6);
        t.cop = 5 + Math.random() * 3;
      }
    } else if (world.cops.length && heat < 0.6) t.cop = Math.max(t.cop, 2);
  }

  function grade(score) {
    for (const g of GRADES) if (score >= g.score) return g;
    return GRADES[GRADES.length - 1];
  }

  function finish(world, reason) {
    const p = world.player;
    world.status = world.status === "wrecked" ? "wrecked" : reason || "shift_end";
    const bonus =
      world.status === "shift_end"
        ? Math.round(p.cash * 0.5 + p.hearts * 600 + (p.heat < 1 ? 500 : 0))
        : Math.round(p.cash * 0.2);
    p.score += bonus;
    world.cashBonus = bonus;
    const g = grade(p.score);
    world.result = {
      reason: world.status,
      grade: g.grade,
      title: g.title,
      score: p.score,
      cash: p.cash,
      bonus,
      knockdowns: world.stats.knockdowns,
      vip: world.stats.vipKnockdowns,
      bestCombo: world.stats.bestCombo || 1,
      bribes: world.stats.bribes,
      failed: world.stats.failedBribes,
      drones: world.stats.dronesDown,
      rams: world.stats.rams,
      dodges: world.stats.dodges,
      distance: world.stats.distance,
      topSpeed: Math.round(world.stats.topSpeed),
      time: Math.round(world.time),
      stars: p.score >= 50000 ? 3 : p.score >= 32000 ? 2 : p.score >= 18000 ? 1 : 0,
    };
    emit(world, "finished", { reason: world.status });
  }

  function step(world, dt, input) {
    if (world.status !== "running") return world;
    const frame = Math.min(dt, 0.05);
    world.time += frame;
    world.stats.bestChain = Math.max(world.stats.bestChain || 0, world.player.chain);
    const input2 = input || {};
    if (input2.nitro && world.player.nitro >= RULES.nitroCost && world.player.nitroTime <= 0) {
      world.player.nitroTime = RULES.nitroTime;
      world.player.speed += 24;
      popText(world, "НИТРО!", world.player.x, world.player.y - 200, "gold");
      emit(world, "nitro", {});
    }
    const scroll = updatePlayer(world, frame, input2);
    const phase = phaseInfo(world);
    if (phase.index !== world.phase) {
      world.phase = phase.index;
      world.phaseName = phase.name;
      emit(world, "phase", { name: phase.name, index: phase.index });
    }
    updateTargets(world, frame, scroll);
    updateCops(world, frame, scroll, input2);
    updateDrones(world, frame, scroll);
    updateProps(world, frame, scroll);
    updatePickups(world, frame, scroll);
    updateSpawns(world, frame);
    for (let k = world.fx.length - 1; k >= 0; k--) {
      const f = world.fx[k];
      f.life += frame;
      if (f.vy) f.y += f.vy * frame;
      if (f.life >= f.ttl) world.fx.splice(k, 1);
    }
    if (world.status === "wrecked" && !world.result) finish(world, "wrecked");
    else if (world.time >= world.shift && !world.result) finish(world, "shift_end");
    return world;
  }

  global.GameCore = {
    WORLD,
    CLASSES,
    DIFFICULTY,
    PHASES,
    RULES,
    PICKUPS,
    GRADES,
    SHIFT_SECONDS,
    createRun,
    step,
    phaseInfo,
    grade,
    comboOf,
    bribeCost,
    laneAt,
    spawnTarget,
    spawnCop,
    spawnDrone,
    spawnProp,
    spawnPickup,
    collect,
    knock,
    damage,
    finish,
  };
})(typeof window !== "undefined" ? window : globalThis);
