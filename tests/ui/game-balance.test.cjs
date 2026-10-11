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
const COMFORT = { category: "comfort", carName: "Skoda Octavia", rateKopecks: 1400 };

function series(policy, seeds, options) {
  return seeds.map(
    (seed) => sim.play(policy, seed, Object.assign({}, COMFORT, options || {})).result,
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
  ])
    assert.ok(core[key] !== undefined, "GameCore." + key + " отсутствует");
  assert.equal(GRADES[0].grade, "S");
  for (let i = 1; i < GRADES.length; i++)
    assert.ok(GRADES[i - 1].score > GRADES[i].score, "пороги оценок должны убывать");
  assert.equal(GRADES[GRADES.length - 1].score, 0, "худшая оценка обязана быть доступной");
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
    assert.ok(core.blockedAt(level) < WORLD.lanes, "уровень " + level + " перекрыл все полосы");
  const w = core.createRun(Object.assign({ seed: 11 }, COMFORT));
  const state = { plan: 0, planAt: -1, noise: 0, rand: Math.random };
  let corridor = w.corridor;
  for (let i = 0; i < 60 * 240 && w.status === "running"; i++) {
    core.step(w, DT, sim.botFor(w, "perfect", state));
    w.events.length = 0;
    assert.ok(Math.abs(w.corridor - corridor) <= 1, "коридор прыгнул дальше одной полосы");
    corridor = w.corridor;
    if (i % 4) continue;
    const rows = {};
    for (const s of w.props) rows[Math.round(s.y / 8)] = (rows[Math.round(s.y / 8)] || 0) + 1;
    for (const count of Object.values(rows))
      assert.ok(count < WORLD.lanes, "стена перекрыла все полосы");
  }
});

test("облава догоняет того, кто не жмёт газ, и отстаёт от того, кто жмёт", () => {
  const lazy = atLevel(core.createRun(Object.assign({ seed: 13 }, COMFORT)), RULES.raidLevel);
  lazy.player.hearts = 999;
  lazy.player.maxHearts = 999;
  const gapStart = lazy.raid.y - lazy.player.y;
  for (let i = 0; i < 60 * 90; i++) core.step(lazy, DT, { throttle: -1 });
  assert.ok(lazy.raid.tight, "оцепление обязано наехать на тормозящего");
  assert.ok(lazy.raid.y - lazy.player.y < gapStart, "дистанция должна сокращаться");
  assert.ok(lazy.raid.hits > 0, "наезд обязан снимать бампер");

  const fast = atLevel(core.createRun(Object.assign({ seed: 13 }, COMFORT)), RULES.raidLevel);
  for (let i = 0; i < 60 * 30; i++) core.step(fast, DT, { throttle: 1 });
  assert.ok(fast.raid.y - fast.player.y >= gapStart, "на полном газу оцепление отстаёт");
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
  for (let i = 0; i < Math.ceil((RULES.grace - 2) / DT); i++) core.step(w, DT, {});
  assert.equal(w.props.length, 0, "препятствия появляются только после грации");
  assert.equal(w.drones.length, 0, "БПЛА летают только после грации");
  assert.equal(w.raid.y - w.player.y, RULES.raidGap, "до облавы оцепление не виден");

  const fresh = core.createRun(Object.assign({ seed: 4 }, COMFORT));
  assert.equal(core.heartCapAt(fresh), fresh.player.maxHearts, "на старте ремонтируется всё");
  const worn = atLevel(core.createRun(Object.assign({ seed: 4 }, COMFORT)), MAX_LEVEL);
  worn.player.hearts = 1;
  core.collect(worn, { kind: "repair", value: 1, x: worn.player.x, y: worn.player.y });
  assert.ok(core.heartCapAt(worn) < worn.player.maxHearts, "наверху ремонт скромнее");
  assert.ok(worn.player.hearts <= core.heartCapAt(worn), "кузов устал: ремонт ограничен износом");
});

test("БПЛА предупреждает удар и не появляется над машиной", () => {
  const w = core.createRun(Object.assign({ seed: 6 }, COMFORT));
  core.spawnDrone(w);
  assert.ok(w.drones[0].y < WORLD.playerY - 400, "БПЛА появился слишком близко");
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

test("нитро прошивает препятствия и даёт таран", () => {
  const w = core.createRun(Object.assign({}, COMFORT, { seed: 2, category: "business" }));
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
  assert.ok(w.stats.rams >= 1 || w.player.encounter, "таран или диалог обязаны состояться");
});

test("любой забег заканчивается, и мастерство читается по дистанции", () => {
  const byPolicy = {};
  for (const policy of ["noob", "human", "perfect"]) byPolicy[policy] = series(policy, SEEDS);
  for (const [policy, runs] of Object.entries(byPolicy))
    for (const r of runs) {
      assert.ok(
        ["wrecked", "broke", "quit"].includes(r.reason),
        policy + ": незавершённый забег " + r.reason,
      );
      assert.equal(r.capped, false, policy + ": забег упёрся в потолок симуляции");
      assert.equal(r.grade, core.grade(r.score).grade);
      assert.ok(
        Math.abs(r.rentMinutes - (r.time * TIME_SCALE) / 60) <= 1,
        policy + ": аренда не соответствует времени: " + r.rentMinutes + " vs " + r.time,
      );
      for (const [key, value] of Object.entries(r))
        if (typeof value === "number")
          assert.ok(Number.isFinite(value), policy + ": " + key + " не число");
    }
  const noob = median(byPolicy.noob.map((r) => r.time));
  const human = median(byPolicy.human.map((r) => r.time));
  const expert = median(byPolicy.perfect.map((r) => r.time));
  assert.ok(noob < human, "новичок не должен жить дольше мастера: " + noob + "/" + human);
  assert.ok(human >= 90, "давление убивает слишком быстро: " + human);
  assert.ok(expert > 200, "мастер обязан задержаться на дороге: " + expert);
  assert.ok(expert < 760, "потолок забега слишком высокий: " + expert);
});

test("классы машины различаются длиной забега и прибылью", () => {
  const rows = ["economy", "comfort", "business"].map((category) => {
    const tariff = { economy: 900, comfort: 1400, business: 2200 }[category];
    const runs = SEEDS.map(
      (seed) =>
        sim.play("perfect", seed, { category, carName: "Тест", rateKopecks: tariff, cap: 800 })
          .result,
    );
    return {
      category,
      time: median(runs.map((r) => r.time)),
      score: median(runs.map((r) => r.score)),
      profit: median(runs.map((r) => r.profit)),
    };
  });
  const byTime = rows.slice().sort((a, b) => a.time - b.time);
  assert.notEqual(byTime[0].category, byTime[2].category, "классы не различаются длиной");
  assert.ok(byTime[2].score / byTime[0].score > 1.15, "очки должны различаться между классами");
  const cheap = rows.find((r) => r.category === "economy");
  const pricey = rows.find((r) => r.category === "business");
  assert.ok(
    cheap.profit >= pricey.profit,
    "дешёвый тариф обязан окупаться легче: " + cheap.profit + " против " + pricey.profit,
  );
});

test("лестница оценок покрывает и провал, и рекорд", () => {
  const weak = series("noob", SEEDS, { cap: 400 });
  const strong = series("human", SEEDS, { cap: 800 });
  assert.ok(
    weak.every((r) => r.grade === "D" || r.grade === "C"),
    "разбитый новичок не получает высоких оценок: " + weak.map((r) => r.grade).join(","),
  );
  assert.ok(
    strong.some((r) => r.grade === "S"),
    "S обязана быть достижимой: " + strong.map((r) => r.grade).join(","),
  );
  const ratio = GRADES[0].score / median(weak.map((r) => r.score));
  assert.ok(ratio > 8, "до S обязано быть в разы дальше, чем до провала: ×" + ratio.toFixed(1));
  for (const r of strong) assert.equal(r.stars, { S: 3, A: 2, B: 1 }[r.grade] || 0);
});

test("серверные пороги лидерборда зеркалят ядро игры", () => {
  const service = fs.readFileSync(path.resolve(__dirname, "../../app/services/game.py"), "utf8");
  const grab = (name) => Number(service.match(new RegExp("^" + name + " = (\\d+)$", "m"))[1]);
  assert.equal(grab("LEVEL_SECONDS"), LEVEL_SECONDS);
  assert.equal(grab("MAX_LEVEL"), MAX_LEVEL);
  assert.ok(grab("SCORE_SLACK") > 4000, "запас по очкам/сек должен покрывать лучший забег");
});

test("геометрия мира держит полосы внутри дороги", () => {
  assert.equal(WORLD.laneCenters.length, WORLD.lanes);
  for (const x of WORLD.laneCenters)
    assert.ok(x > WORLD.roadLeft && x < WORLD.roadRight, "полоса уехала с дороги");
  assert.ok(WORLD.roadTop > 0 && WORLD.roadTop < WORLD.playerY);
  assert.ok(WORLD.playerY + 200 < WORLD.height);
});
