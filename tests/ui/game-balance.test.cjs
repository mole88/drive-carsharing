/* Кривая давления: сложность растёт сама, забег конечен, мастерство заметно на дистанции. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sim = require("./game-sim.cjs");

const core = sim.core;
const { WORLD, RULES, CLASSES, GRADES } = core;
const { LEVEL_SECONDS, MAX_LEVEL, TIME_SCALE } = core;
const DT = sim.DT;
const SEEDS = [3, 9, 15, 21];
const COMFORT = {
  category: "comfort",
  carName: "Skoda Octavia",
  rateKopecks: 1400,
};

function series(policy, seeds, options) {
  return seeds.map(
    (seed) =>
      sim.play(policy, seed, Object.assign({}, COMFORT, options || {})).result,
  );
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function atLevel(w, level) {
  w.time = (level - 1) * LEVEL_SECONDS;
  w.level = level;
  /* Прыжок во времени не должен моментально загонять в долг по договору */
  w.player.cash = 1e9;
  return w;
}

test("ядро отдаёт экрану таблицы давления и таблицу оценок", () => {
  for (const key of [
    "WORLD",
    "CLASSES",
    "RULES",
    "PHASES",
    "LEVEL_SECONDS",
    "MAX_LEVEL",
    "TIME_SCALE",
    "levelAt",
    "pressureAt",
    "damageScaleAt",
    "blockedAt",
    "raidKmhAt",
    "heartCapAt",
    "createRun",
    "step",
    "finish",
    "cashoutAt",
  ])
    assert.ok(core[key] !== undefined, "GameCore." + key + " отсутствует");
  assert.equal(
    typeof core.cashoutAt,
    "function",
    "касса возврата — функция ядра",
  );
  assert.equal(GRADES[0].grade, "S");
  for (let i = 1; i < GRADES.length; i++)
    assert.ok(
      GRADES[i - 1].score > GRADES[i].score,
      "пороги оценок должны убывать",
    );
  assert.equal(
    GRADES[GRADES.length - 1].score,
    0,
    "худшая оценка обязана быть доступной",
  );
});

test("давление монотонно растёт и режим выбора больше нет", () => {
  assert.equal(core.createRun({ seed: 1 }).level, 1);
  let prev = null;
  for (const level of [1, 4, 8, 12, 16, 20, 24, MAX_LEVEL]) {
    const now = {
      pressure: core.pressureAt(level),
      damage: core.damageScaleAt(level),
      blocked: core.blockedAt(level),
      raid: core.raidKmhAt(level),
      cap: core.propCapAt(level),
    };
    if (prev)
      for (const key of Object.keys(now))
        assert.ok(now[key] >= prev[key], key + " не должен падать с уровнем");
    prev = now;
  }
  assert.equal(core.levelAt(0), 1);
  assert.equal(core.levelAt(LEVEL_SECONDS), 2);
  assert.equal(core.levelAt((MAX_LEVEL - 1) * LEVEL_SECONDS), MAX_LEVEL);
  assert.equal(core.levelAt(1e9), MAX_LEVEL, "уровень обязан быть ограничен");
});

test("коридор всегда существует и смещается на одну полосу", () => {
  for (let level = 1; level <= MAX_LEVEL; level++)
    assert.ok(
      core.blockedAt(level) < WORLD.lanes,
      "уровень " + level + " перекрыл все полосы",
    );
  const w = core.createRun(Object.assign({ seed: 11 }, COMFORT));
  const state = { plan: 0, planAt: -1, noise: 0, rand: Math.random };
  let corridor = w.corridor;
  for (let i = 0; i < 60 * 240 && w.status === "running"; i++) {
    core.step(w, DT, sim.botFor(w, "perfect", state));
    w.events.length = 0;
    assert.ok(
      Math.abs(w.corridor - corridor) <= 1,
      "коридор прыгнул дальше одной полосы",
    );
    corridor = w.corridor;
    if (i % 4) continue;
    const rows = {};
    for (const s of w.props)
      rows[Math.round(s.y / 8)] = (rows[Math.round(s.y / 8)] || 0) + 1;
    for (const count of Object.values(rows))
      assert.ok(count < WORLD.lanes, "стена перекрыла все полосы");
  }
});

test("касса возврата: одна формула для HUD и для итога", () => {
  const w = core.createRun(Object.assign({ seed: 5 }, COMFORT));
  w.time = 60;
  w.player.score = 200000;
  w.player.heat = 0.2;
  w.stats.cashEarned = 5000000;
  w.stats.rentalCost = 100000;
  const expect = Math.round(200000 * 0.25 + w.player.hearts * 4000 + 8000);
  assert.equal(
    core.cashoutAt(w),
    expect,
    "касса возврата предсказуема до возврата",
  );
  core.finish(w, "quit");
  assert.equal(
    w.result.bonus,
    expect,
    "возврат доначисляет ровно то, что показал HUD",
  );
  assert.equal(w.result.killer, "retired", "добровольный возврат подписан");

  const poor = core.createRun(Object.assign({ seed: 5 }, COMFORT));
  poor.stats.rentalCost = 1e9;
  assert.equal(core.cashoutAt(poor), 0, "в минус возвращать нечего");
  core.finish(poor, "quit");
  assert.equal(poor.result.bonus, 0);

  const dead = core.createRun(Object.assign({ seed: 5 }, COMFORT));
  dead.player.hearts = 1;
  dead.player.invuln = 0;
  core.damage(dead, 99, "raid");
  assert.equal(dead.status, "wrecked");
  core.finish(dead, "wrecked");
  assert.equal(dead.result.killer, "raid", "итог знает, кто добил смену");
  assert.equal(dead.result.bonus, 0, "разбитая машина бонус не получает");
});

test("первый контакт даёт обучающее окно, дальше давление прежнее", () => {
  const touchCop = (w) => {
    w.cops.length = 0;
    w.player.invuln = 0;
    core.spawnCop(w, false);
    const cop = w.cops[w.cops.length - 1];
    cop.x = w.player.x;
    cop.y = w.player.y - 20;
    core.step(w, DT, {});
    return cop;
  };
  const w = core.createRun(Object.assign({ seed: 8 }, COMFORT));
  const cop = touchCop(w);
  assert.ok(w.player.encounter, "касание патруля открывает диалог");
  assert.equal(cop.mode, "block");
  assert.equal(
    w.player.encounter.window,
    RULES.bribeWindowFirst,
    "первая взятка ждёт дольше",
  );
  assert.ok(
    RULES.bribeWindowFirst > RULES.bribeWindow,
    "обучающее окно обязано быть длиннее рабочего",
  );
  assert.equal(w.stats.encounters, 1);

  core.step(w, DT, { bribe: true });
  assert.equal(
    w.stats.bribes,
    1,
    "Пробел в обучающее окно реально успевает заплатить",
  );
  assert.equal(w.player.encounter, null);

  touchCop(w);
  assert.equal(
    w.player.encounter.window,
    RULES.bribeWindow,
    "со второго контакта окно снова короткое",
  );
  assert.equal(w.stats.encounters, 2);
});

test("протокол вслух называет и деньги, и потерянный бампер", () => {
  const popsOf = (w) => w.fx.filter((f) => f.kind === "pop").map((f) => f.text);
  const open = (w) => {
    w.cops.length = 0;
    w.player.invuln = 0;
    core.spawnCop(w, false);
    const cop = w.cops[w.cops.length - 1];
    cop.x = w.player.x;
    cop.y = w.player.y - 20;
    core.step(w, DT, {});
    assert.ok(w.player.encounter, "контакт не открылся");
    w.fx.length = 0;
    w.player.encounter.timer = 0.001;
  };

  const a = core.createRun(Object.assign({ seed: 8 }, COMFORT));
  a.player.cash = 400000;
  a.player.armor = 0.9; /* кузов уже поцарапан: следующий протокол добирает бампер */
  open(a);
  const hearts = a.player.hearts;
  core.step(a, DT, {});
  assert.ok(
    a.player.hearts < hearts,
    "износ 0,9 плюс протокол обязаны стоить бампера (mass делает удар дробным)",
  );
  const texts = popsOf(a);
  assert.ok(
    texts.some((t) => /ПРОТОКОЛ −[\d.]+ ₽/.test(t)),
    "штраф деньгами не назван: " + texts,
  );
  assert.ok(
    texts.includes("−1 БАМПЕР"),
    "потеря бампера не названа, а именно она убивает новичка: " + texts,
  );

  /* Свежий кузов на первом уровне: протокол — только деньги (1 / mass 1,15 =
     0,87, недобор до бампера), и врать про потерю экран не имеет права. */
  const b = core.createRun(Object.assign({ seed: 8 }, COMFORT));
  b.player.cash = 400000;
  open(b);
  const kept = b.player.hearts;
  core.step(b, DT, {});
  assert.equal(
    b.player.hearts,
    kept,
    "на свежем кузове протокол не снимает бампер",
  );
  assert.ok(
    !popsOf(b).includes("−1 БАМПЕР"),
    "экран объявил потерю бампера, которого не было",
  );
  assert.ok(
    popsOf(b).some((t) => /ПРОТОКОЛ −/.test(t)),
    "а вот штраф деньгами называть обязан",
  );
});

test("победный путь: своевременный возврат закрывает смену в плюс", () => {
  /* Боты никогда не нажимают V, поэтому путь «вернулся с кассой» раньше не
     проверялся ни в одном тесте — хотя именно он и есть «победа». */
  const runs = [3, 9, 15, 21, 27, 33].map((seed) => {
    const w = core.createRun(Object.assign({ seed }, COMFORT));
    const state = { plan: 0, planAt: -1, noise: 0, rand: Math.random };
    while (w.status === "running" && w.level < 8) {
      core.step(w, DT, sim.botFor(w, "human", state));
      w.events.length = 0;
    }
    const cashout = core.cashoutAt(w);
    const beforeScore = w.player.score;
    if (cashout > 0) core.finish(w, "quit");
    return { cashout, beforeScore, level: w.level, result: w.result };
  });
  const done = runs.filter((r) => r.result);
  assert.ok(done.length >= 4, "к 8 уровню возврат должен быть в плюсе");
  for (const r of done) {
    const res = r.result;
    assert.equal(res.reason, "quit");
    assert.equal(res.retired, true);
    assert.equal(res.killer, "retired", "итог подписан добровольным возвратом");
    assert.equal(
      res.bonus,
      r.cashout,
      "возврат доначисляет ровно то, что показал HUD",
    );
    assert.equal(
      res.score,
      r.beforeScore + res.bonus,
      "бонус — единственная надбавка",
    );
    assert.ok(res.won && res.profit > 0, "возврат в плюс засчитан победой");
    assert.equal(
      res.stars,
      core.grade(res.score).stars,
      "звёзды берутся из лестницы",
    );
  }
});

test("облава догоняет того, кто не жмёт газ, и отстаёт от того, кто жмёт", () => {
  const lazy = atLevel(
    core.createRun(Object.assign({ seed: 13 }, COMFORT)),
    RULES.raidLevel,
  );
  lazy.player.hearts = 999;
  lazy.player.maxHearts = 999;
  const gapStart = lazy.raid.y - lazy.player.y;
  for (let i = 0; i < 60 * 90; i++) core.step(lazy, DT, { throttle: -1 });
  assert.ok(lazy.raid.tight, "оцепление обязано наехать на тормозящего");
  assert.ok(
    lazy.raid.y - lazy.player.y < gapStart,
    "дистанция должна сокращаться",
  );
  assert.ok(lazy.raid.hits > 0, "наезд обязан снимать бампер");

  const fast = atLevel(
    core.createRun(Object.assign({ seed: 13 }, COMFORT)),
    RULES.raidLevel,
  );
  for (let i = 0; i < 60 * 30; i++) core.step(fast, DT, { throttle: 1 });
  assert.ok(
    fast.raid.y - fast.player.y >= gapStart,
    "на полном газу оцепление отстаёт",
  );
  assert.equal(fast.raid.hits, 0);
});

test("на последнем уровне оцепление быстрее любого двигателя", () => {
  for (const category of Object.keys(CLASSES)) {
    const cls = CLASSES[category];
    assert.ok(
      core.raidKmhAt(MAX_LEVEL) > cls.maxSpeed * 1.22,
      category + ": облава обязана настигать даже на нитро",
    );
    assert.ok(
      core.raidKmhAt(RULES.raidLevel) < cls.maxSpeed,
      category + ": на старте облавы газ спасает",
    );
  }
});

test("грация первой минуты и ремонт по износу кузова", () => {
  const w = core.createRun(Object.assign({ seed: 12 }, COMFORT));
  for (let i = 0; i < Math.ceil((RULES.grace - 2) / DT); i++)
    core.step(w, DT, {});
  assert.equal(w.props.length, 0, "препятствия появляются только после грации");
  assert.equal(w.drones.length, 0, "БПЛА летают только после грации");
  assert.equal(
    w.raid.y - w.player.y,
    RULES.raidGap,
    "до облавы оцепление не виден",
  );

  const fresh = core.createRun(Object.assign({ seed: 4 }, COMFORT));
  assert.equal(
    core.heartCapAt(fresh),
    fresh.player.maxHearts,
    "на старте ремонтируется всё",
  );
  const worn = atLevel(
    core.createRun(Object.assign({ seed: 4 }, COMFORT)),
    MAX_LEVEL,
  );
  worn.player.hearts = 1;
  core.collect(worn, {
    kind: "repair",
    value: 1,
    x: worn.player.x,
    y: worn.player.y,
  });
  assert.ok(
    core.heartCapAt(worn) < worn.player.maxHearts,
    "наверху ремонт скромнее",
  );
  assert.ok(
    worn.player.hearts <= core.heartCapAt(worn),
    "кузов устал: ремонт ограничен износом",
  );
});

test("износ переносится: списанный бампер не прощает остаток", () => {
  const w = core.createRun(Object.assign({ seed: 12 }, COMFORT));
  const p = w.player;
  const mass = w.cls.mass;
  const hit = () => {
    p.invuln = 0;
    return core.damage(w, RULES.damage.protocol, "protocol");
  };
  p.armor = 0;
  const hearts = p.hearts;
  assert.equal(
    hit(),
    false,
    "первый протокол на свежем кузове дробный и бампер не берёт",
  );
  assert.equal(p.hearts, hearts);
  assert.ok(
    Math.abs(p.armor - RULES.damage.protocol / mass) < 1e-9,
    "износ обязан накопиться дробно: " + p.armor,
  );
  assert.equal(hit(), true, "второй протокол обязан снять бампер");
  assert.equal(p.hearts, hearts - 1);
  assert.ok(
    p.armor > 0.7 && p.armor < 0.8,
    "остаток износа обязан перенестись в следующий бампер, а не сгореть: " +
      p.armor,
  );
  /* Третий удар не должен ждать полного нового бампера */
  assert.equal(
    hit(),
    true,
    "с остатком 0,74 третий протокол сразу стоит бампера",
  );
});

test("БПЛА предупреждает удар и не появляется над машиной", () => {
  const w = core.createRun(Object.assign({ seed: 6 }, COMFORT));
  core.spawnDrone(w);
  assert.ok(
    w.drones[0].y < WORLD.playerY - 400,
    "БПЛА появился слишком близко",
  );
  const states = new Set();
  for (let i = 0; i < 60 * 12; i++) {
    core.step(w, DT, {});
    if (w.drones[0]) states.add(w.drones[0].state);
    w.events.length = 0;
  }
  assert.ok(
    states.has("hover") || states.has("lock") || states.has("dive"),
    "БПЛА так и не включился",
  );
});

test("акты смены укладываются в живую сессию и открывают барьеры", () => {
  const acts = core.PHASES;
  const last = acts[acts.length - 1];
  assert.equal(acts[0].fromLevel, 1, "смена должна начинаться с первого акта");
  for (let i = 1; i < acts.length; i++)
    assert.ok(
      acts[i].fromLevel > acts[i - 1].fromLevel,
      "акты идут не по возрастанию",
    );
  /* Живые заезды прода: 91–136 с. Финальный акт обязан успеть начаться. */
  assert.ok(
    (last.fromLevel - 1) * LEVEL_SECONDS <= 90,
    `финальный акт стартует с ${(last.fromLevel - 1) * LEVEL_SECONDS} с — за медианной смертью`,
  );
  assert.equal(
    core.phaseInfo({ level: last.fromLevel - 1 }).index,
    acts.length - 2,
  );
  assert.equal(
    core.phaseInfo({ level: last.fromLevel }).index,
    acts.length - 1,
  );
  assert.equal(core.phaseInfo({ level: MAX_LEVEL }).index, acts.length - 1);
  /* Каждый акт после первого приносит опасность — значит игрок обязан получить
     название этой опасности в момент перехода, а не после первого удара. */
  for (let i = 1; i < acts.length; i++)
    assert.ok(acts[i].hint && acts[i].hint.length > 3, `акт ${i} вошёл молча`);
  const crossed = core.createRun(Object.assign({ seed: 4 }, COMFORT));
  crossed.level = last.fromLevel;
  crossed.time = (last.fromLevel - 1) * LEVEL_SECONDS;
  core.step(crossed, DT, {});
  const event = crossed.events.find((e) => e.type === "phase");
  assert.ok(event, "переход акта не вышел событием");
  assert.equal(event.hint, last.hint, "событие акта не несёт подсказку");
  /* Что даёт третий акт по факту: на дорогу выезжают барьеры. */
  const drop = (world, count) => {
    for (let k = 0; k < count; k++)
      core.spawnProp(world, k % WORLD.lanes, -600 - k * 560);
  };
  const barriers = (world) =>
    world.props.filter((s) => s.kind === "barrier").length;
  const w = core.createRun(Object.assign({ seed: 8 }, COMFORT));
  w.phase = 1;
  drop(w, 30);
  assert.equal(barriers(w), 0, "барьеры появились до финального акта");
  w.phase = acts.length - 1;
  drop(w, 60);
  assert.ok(barriers(w) > 0, "финальный акт не открывает барьеры");
});

test("идентичный сид даёт идентичный заезд независимо от истории процесса", () => {
  const once = (seed) => {
    /* между прогонами запускаем другой мир: счётчики сущностей не должны «уезжать» */
    const other = core.createRun(Object.assign({ seed: 999 }, COMFORT));
    core.spawnTarget(other);
    core.spawnDrone(other);
    const w = core.createRun(Object.assign({ seed }, COMFORT));
    const startId = w.nextId;
    const ids = [];
    for (let i = 0; i < 60 * 40; i++) {
      core.step(w, DT, { throttle: 1 });
      ids.push(w.targets.length, w.drones.length, w.props.length);
      w.events.length = 0;
    }
    return {
      score: w.player.score,
      hearts: w.player.hearts,
      cash: w.player.cash,
      startId,
      trace: ids.slice(0, 200).join(","),
    };
  };
  const a = once(4242);
  const b = once(4242);
  assert.deepEqual(
    a,
    b,
    "зависимость от глобального счётчика ломает воспроизводимость",
  );
  assert.equal(a.startId, 1, "счётчик id живёт в мире, а не в модуле");
});

test("ушедший от удара БПЛА засчитывается как уклонение", () => {
  const w = core.createRun(Object.assign({ seed: 7 }, COMFORT));
  core.spawnDrone(w);
  const d = w.drones[0];
  for (
    let i = 0;
    i < 60 * 30 && d.state !== "dive" && w.drones.includes(d);
    i++
  ) {
    core.step(w, DT, {});
    w.events.length = 0;
    if (d.state === "dive") {
      /* линия пикирования фиксируется в момент атаки — уходим в соседнюю полосу */
      w.player.x = WORLD.laneCenters[(core.laneAt(d.lockX) + 1) % WORLD.lanes];
    }
  }
  assert.ok(
    w.drones.includes(d) || d.state === "crash",
    "БПЛА должен долететь",
  );
  const hearts = w.player.hearts;
  for (let i = 0; i < 60 * 5 && w.drones.includes(d); i++) {
    core.step(w, DT, {});
    w.events.length = 0;
  }
  assert.equal(w.player.hearts, hearts, "промах БПЛА не снимает бампер");
  assert.ok(w.stats.dodges >= 1, "промах считается уклонением");
});

test("нитро прошивает препятствия и даёт таран", () => {
  const w = core.createRun(
    Object.assign({}, COMFORT, { seed: 2, category: "business" }),
  );
  w.player.nitro = 100;
  w.player.invuln = 0;
  w.time = RULES.grace + 1;
  core.step(w, DT, { nitro: true });
  assert.ok(w.player.nitroTime > 0, "нитро обязано загореться");
  const hearts = w.player.hearts;
  w.props.push({
    id: 999,
    kind: "barrier",
    lane: core.laneAt(w.player.x),
    x: w.player.x,
    y: w.player.y - 20,
    radius: 62,
    damage: RULES.damage.barrier,
    spin: 0,
    used: false,
  });
  core.step(w, DT, {});
  assert.equal(w.player.hearts, hearts, "под нитро препятствие не бьёт");
  core.spawnCop(w, false);
  const cop = w.cops[0];
  cop.x = w.player.x + 40;
  cop.y = w.player.y - 20;
  for (let i = 0; i < 30; i++) core.step(w, DT, {});
  assert.ok(
    w.stats.rams >= 1 || w.player.encounter,
    "таран или диалог обязаны состояться",
  );
});

test("любой забег заканчивается, и мастерство читается по дистанции", () => {
  const byPolicy = {};
  for (const policy of ["noob", "human", "perfect"])
    byPolicy[policy] = series(policy, SEEDS);
  for (const [policy, runs] of Object.entries(byPolicy))
    for (const r of runs) {
      assert.ok(
        ["wrecked", "broke", "quit"].includes(r.reason),
        policy + ": незавершённый забег " + r.reason,
      );
      assert.equal(
        r.capped,
        false,
        policy + ": забег упёрся в потолок симуляции",
      );
      assert.equal(r.grade, core.grade(r.score).grade);
      assert.ok(
        Math.abs(r.rentMinutes - (r.time * TIME_SCALE) / 60) <= 1,
        policy +
          ": аренда не соответствует времени: " +
          r.rentMinutes +
          " vs " +
          r.time,
      );
      for (const [key, value] of Object.entries(r))
        if (typeof value === "number")
          assert.ok(Number.isFinite(value), policy + ": " + key + " не число");
    }
  const noob = median(byPolicy.noob.map((r) => r.time));
  const human = median(byPolicy.human.map((r) => r.time));
  const expert = median(byPolicy.perfect.map((r) => r.time));
  assert.ok(
    noob < human,
    "новичок не должен жить дольше мастера: " + noob + "/" + human,
  );
  /* Нижняя граница по замеру: перенос остатка износа снял новичку 88 → 81 с,
     живой игрок на проде живёт 91–136 с. Провал ниже 70 с значит, что давление
     выросло не из-за тумблера сложности, а из-за поломки учёта бамперов. */
  assert.ok(noob >= 70, "новичок стал жить слишком мало: " + noob + " с");
  assert.ok(human >= 90, "давление убивает слишком быстро: " + human);
  assert.ok(expert > 200, "мастер обязан задержаться на дороге: " + expert);
  assert.ok(expert < 760, "потолок забега слишком высокий: " + expert);
});

test("классы машины различаются длиной забега и прибылью", () => {
  const rows = ["economy", "comfort", "business"].map((category) => {
    const tariff = { economy: 900, comfort: 1400, business: 2200 }[category];
    const runs = SEEDS.map(
      (seed) =>
        sim.play("perfect", seed, {
          category,
          carName: "Тест",
          rateKopecks: tariff,
          cap: 800,
        }).result,
    );
    return {
      category,
      time: median(runs.map((r) => r.time)),
      score: median(runs.map((r) => r.score)),
      profit: median(runs.map((r) => r.profit)),
    };
  });
  const byTime = rows.slice().sort((a, b) => a.time - b.time);
  assert.notEqual(
    byTime[0].category,
    byTime[2].category,
    "классы не различаются длиной",
  );
  assert.ok(
    byTime[2].score / byTime[0].score > 1.15,
    "очки должны различаться между классами",
  );
  const cheap = rows.find((r) => r.category === "economy");
  const pricey = rows.find((r) => r.category === "business");
  assert.ok(
    cheap.profit >= pricey.profit,
    "дешёвый тариф обязан окупаться легче: " +
      cheap.profit +
      " против " +
      pricey.profit,
  );
});

test("лестница оценок покрывает и провал, и рекорд", () => {
  const weak = series("noob", SEEDS, { cap: 400 });
  const strong = series("human", SEEDS, { cap: 800 });
  assert.ok(
    weak.every((r) => r.grade === "D" || r.grade === "C"),
    "разбитый новичок не получает высоких оценок: " +
      weak.map((r) => r.grade).join(","),
  );
  assert.ok(
    strong.some((r) => r.grade === "S"),
    "S обязана быть достижимой: " + strong.map((r) => r.grade).join(","),
  );
  const ratio = GRADES[0].score / median(weak.map((r) => r.score));
  assert.ok(
    ratio > 8,
    "до S обязано быть в разы дальше, чем до провала: ×" + ratio.toFixed(1),
  );
  for (const r of strong) assert.equal(r.stars, core.grade(r.score).stars);
  /* Звёзды обязан получать и человеческий результат, а не только боты */
  /* GRADES приходит из vm-контекста симулятора: сравниваем содержимое, а не прототипы */
  assert.equal(
    GRADES.map((g) => g.stars).join(","),
    "4,3,2,1,0",
    "шкала звёзд обязана строго возрастать вместе с оценками",
  );
  /* Лестница обязана измерять человеческую игру, а не только ботов-оракулов.
     Прогон реальных заездов с прода: 22 503…99 820 очков, медиана ~59 000. */
  const realBest = 99820,
    realMedian = 59000,
    realWorst = 22503;
  assert.notEqual(
    core.grade(realBest).grade,
    "D",
    "лучший реальный заезд не имеет права быть худшей оценкой",
  );
  assert.ok(
    core.grade(realBest).stars > 0,
    "лучший реальный заезд обязан получать звезду",
  );
  assert.ok(
    core.grade(realMedian).stars >= 1,
    "медианный человеческий заезд тоже должен быть чем-то награждён",
  );
  assert.equal(core.grade(realWorst).stars, 0, "у худшей ступени звёзд нет");
  assert.notEqual(
    core.grade(realMedian).grade,
    "D",
    "середина человеческих заездов должна получать оценку",
  );
  assert.equal(
    core.grade(realWorst).grade,
    "D",
    "совсем слабый заезд остаётся в нижней ступени",
  );
  const humanGrades = new Set(
    [realWorst, realMedian, realBest].map((s) => core.grade(s).grade),
  );
  assert.ok(
    humanGrades.size >= 3,
    "человеческий диапазон должен раскладываться по ступеням: " +
      [...humanGrades],
  );
  /* Зазор до следующей ступени считается той же таблицей, что и оценка:
     экран обязан называть его честно, иначе «711 очков до C» выглядит обидой. */
  for (const g of GRADES.slice(0, -1)) {
    assert.equal(
      core.nextGrade(g.score - 1),
      g,
      "ступень над " + (g.score - 1),
    );
    assert.ok(
      g.title && g.title.length > 3,
      "у ступени " + g.grade + " нет названия",
    );
    const above = GRADES[GRADES.indexOf(g) - 1];
    assert.equal(
      core.nextGrade(g.score),
      above || null,
      "над " + g.grade + " должна быть " + (above ? above.grade : "пустота"),
    );
  }
  assert.equal(core.nextGrade(GRADES[0].score), null, "для S запаса вверх нет");
  const nearMiss = 39289; /* прод-заезд #11: не хватило 711 очков до C */
  assert.equal(core.grade(nearMiss).grade, "D");
  assert.equal(core.nextGrade(nearMiss).grade, "C");
  assert.equal(
    core.nextGrade(nearMiss).score - nearMiss,
    711,
    "зазор до следующей ступени сошёлся с прод-фактом",
  );
});

test("серверные пороги лидерборда зеркалят ядро игры", () => {
  const service = fs.readFileSync(
    path.resolve(__dirname, "../../app/services/game.py"),
    "utf8",
  );
  const grab = (name) =>
    Number(service.match(new RegExp("^" + name + " = (\\d+)$", "m"))[1]);
  assert.equal(grab("LEVEL_SECONDS"), LEVEL_SECONDS);
  assert.equal(grab("MAX_LEVEL"), MAX_LEVEL);
  const clock = fs.readFileSync(
    path.resolve(__dirname, "../../app/services/trip.py"),
    "utf8",
  );
  assert.equal(Number(clock.match(/^TIME_SCALE = (\d+)$/m)[1]), TIME_SCALE);
  assert.ok(
    grab("SCORE_SLACK") > 4000,
    "запас по очкам/сек должен покрывать лучший забег",
  );
});

test("геометрия мира держит полосы внутри дороги", () => {
  assert.equal(WORLD.laneCenters.length, WORLD.lanes);
  for (const x of WORLD.laneCenters)
    assert.ok(
      x > WORLD.roadLeft && x < WORLD.roadRight,
      "полоса уехала с дороги",
    );
  assert.ok(WORLD.roadTop > 0 && WORLD.roadTop < WORLD.playerY);
  assert.ok(WORLD.playerY + 200 < WORLD.height);
});
