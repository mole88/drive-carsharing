const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({ console });
vm.runInContext(
  fs.readFileSync("app/static/game-core.js", "utf8"),
  context,
  { filename: "game-core.js" },
);
const core = context.GameCore;
const { WORLD, RULES, CLASSES, GRADES } = core;
const DT = 1 / 60;

function bot(world, careful) {
  const p = world.player;
  let target = null;
  let bestScore = -1e9;
  for (const t of world.targets) {
    if (t.state !== "walking") continue;
    const dy = p.y - t.y;
    if (dy < -30 || dy > 640) continue;
    const blocked =
      careful &&
      world.props.some(
        (s) => s.damage > 0 && Math.abs(s.x - t.x) < 80 && s.y < p.y && s.y > t.y - 220,
      );
    if (blocked) continue;
    const score = (1 - Math.abs(t.x - p.x) / 420) * 100 + (t.vip ? 70 : 0) - Math.abs(dy) * 0.07;
    if (score > bestScore) {
      bestScore = score;
      target = t;
    }
  }
  let steer = target ? Math.max(-1, Math.min(1, (target.x - p.x) / 120)) : 0;
  const drone = world.drones.find(
    (d) => (d.state === "lock" || d.state === "dive") && Math.abs(d.lockX - p.x) < 95,
  );
  if (drone) steer = drone.lockX > p.x ? -1 : 1;
  const prop = careful
    ? world.props.find(
        (s) => s.damage > 0 && Math.abs(s.x - p.x) < 70 && s.y < p.y && s.y > p.y - 280,
      )
    : null;
  if (prop) steer = prop.x > p.x ? -1 : 1;
  return {
    steer,
    throttle: careful ? 0.55 : 0.9,
    fast: false,
    slow: false,
    left: false,
    right: false,
    bribe: !!(p.encounter && p.cash >= p.encounter.cost),
    nitro: p.nitro >= RULES.nitroCost && !p.encounter && p.heat > 3,
  };
}

function play(category, seed, difficulty, careful) {
  const world = core.createRun({ category, seed, difficulty, carId: seed });
  const sample = { targets: [], heat: [], speed: [] };
  const seen = { encounter: 0, damage: 0, droneSpawn: 0, knock: 0 };
  while (world.status === "running") {
    core.step(world, DT, bot(world, careful));
    for (const e of world.events) if (e.type in seen) seen[e.type] += 1;
    world.events.length = 0;
    sample.targets.push(world.targets.filter((t) => t.state === "walking").length);
    sample.heat.push(world.player.heat);
    sample.speed.push(world.player.speed);
    if (world.time > 400) break;
  }
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  return { world, seen, avg: { targets: mean(sample.targets), heat: mean(sample.heat), speed: mean(sample.speed) } };
}

test("core exposes the design tables the shell relies on", () => {
  for (const key of ["WORLD", "CLASSES", "RULES", "GRADES", "createRun", "step", "finish"])
    assert.ok(core[key], "GameCore." + key + " is missing");
  for (const category of ["economy", "comfort", "business"]) {
    const cls = CLASSES[category];
    assert.ok(cls.hearts >= 4 && cls.hearts <= 8, category + " hearts");
    assert.ok(cls.maxSpeed > 140 && cls.maxSpeed < 210, category + " maxSpeed");
    assert.ok(cls.perk.length > 20, category + " needs a readable perk line");
  }
  assert.equal(GRADES[0].grade, "S");
  assert.ok(GRADES[0].score > GRADES[1].score);
});

test("a full shift completes with a sane, non-degenerate result", () => {
  const { world, seen } = play("comfort", 17, "normal", true);
  const result = world.result;
  assert.notEqual(world.status, "running", "run never terminated");
  assert.ok(result, "no result object");
  for (const [key, value] of Object.entries(result))
    if (typeof value === "number")
      assert.ok(Number.isFinite(value), "result." + key + " is not a number");
  assert.ok(result.knockdowns >= 25, "too few targets to satisfy the fantasy: " + result.knockdowns);
  assert.ok(result.knockdowns <= 200, "target flood: " + result.knockdowns);
  assert.ok(result.bestCombo >= 2, "combo chain never formed");
  assert.ok(result.bestCombo <= RULES.comboCap, "combo multiplier escaped the cap");
  assert.ok(seen.encounter >= 1, "patrols never engaged the player");
  assert.ok(result.bribes + result.failed >= 1, "bribe economy never triggered");
  assert.ok(result.time >= 45, "shift ended far too early: " + result.time);
  assert.ok(result.score > 1000);
  assert.equal(core.grade(result.score).grade, result.grade);
});

test("difficulty and car class change the outcome, not just the label", () => {
  const relaxed = play("comfort", 23, "relaxed", true).world.result;
  const hardcore = play("comfort", 23, "hardcore", true).world.result;
  assert.ok(
    hardcore.bribes + hardcore.failed >= 1 && relaxed.cash >= 0 && hardcore.cash >= 0,
    "cash must stay non-negative and the bribe economy must engage",
  );
  assert.notDeepEqual(
    [relaxed.score, relaxed.knockdowns],
    [hardcore.score, hardcore.knockdowns],
    "difficulty had no effect",
  );
  const economy = play("economy", 23, "normal", true).world;
  const business = play("business", 23, "normal", true).world;
  assert.ok(economy.cls.steer > business.cls.steer, "economy must steer sharper");
  assert.ok(business.cls.mass > economy.cls.mass, "business must be heavier");
  assert.ok(
    core.bribeCost({ player: { heat: 3 }, cls: business.cls, stats: { bribes: 0 } }) <
      core.bribeCost({ player: { heat: 3 }, cls: economy.cls, stats: { bribes: 0 } }),
    "business bribe discount must be cheaper",
  );
});

test("simulation keeps entity counts and player state inside the design envelope", () => {
  for (const [category, seed, difficulty] of [
    ["economy", 5, "normal"],
    ["comfort", 11, "hardcore"],
    ["business", 31, "relaxed"],
  ]) {
    const { world, avg } = play(category, seed, difficulty, false);
    assert.ok(avg.targets >= 0.6, "playfield too empty: " + avg.targets);
    assert.ok(avg.targets <= 6, "playfield overloaded: " + avg.targets);
    assert.ok(world.player.cash >= 0, "cash went negative");
    assert.ok(world.player.heat >= 0 && world.player.heat <= 6, "heat escaped 0..6");
    assert.ok(world.player.hearts >= 0 && world.player.hearts <= CLASSES[category].hearts);
    assert.ok(world.targets.length <= 12, "target cap broken");
    assert.ok(world.cops.length <= 3, "patrol cap broken");
    assert.ok(world.drones.length <= 3, "drone cap broken");
    assert.ok(world.props.length <= 6, "prop cap broken");
    assert.ok(world.player.score >= 0);
    assert.ok(avg.speed > 30 && avg.speed < CLASSES[category].maxSpeed * 1.3);
  }
});

test("survival rate stays a skill question, not a coin flip or a formality", () => {
  const runs = [];
  for (const seed of [3, 9, 15, 21, 27, 33, 39, 45])
    for (const category of ["economy", "comfort", "business"])
      runs.push(play(category, seed, "normal", true));
  const finished = runs.filter((r) => r.world.result.reason === "shift_end").length;
  const rate = finished / runs.length;
  assert.ok(rate >= 0.2, "shift is unwinnable: " + (rate * 100).toFixed(0) + "%");
  assert.ok(rate <= 0.92, "shift has no fail pressure: " + (rate * 100).toFixed(0) + "%");
  const scores = runs.map((r) => r.world.result.score);
  const grades = new Set(runs.map((r) => r.world.result.grade));
  assert.ok(Math.max(...scores) / Math.min(...scores) > 1.4, "score spread too flat");
  assert.ok(grades.size >= 2, "every run gets the same grade");
});

test("bribes cost money and clear wanted level, protocols cost bumpers", () => {
  const world = core.createRun({ category: "comfort", seed: 4, difficulty: "normal" });
  const p = world.player;
  p.cash = 5000;
  p.invuln = 0;
  world.time = RULES.grace + 1;
  core.spawnCop(world, false);
  const cop = world.cops[0];
  cop.x = p.x + 60;
  cop.y = p.y;
  core.step(world, DT, {});
  assert.ok(p.encounter, "contact with a patrol must open an encounter");
  const cashBefore = p.cash;
  const heatBefore = p.heat;
  p.cash = 99999;
  core.step(world, DT, { bribe: true });
  assert.equal(p.encounter, null, "paying must end the encounter");
  assert.ok(p.cash < 99999, "bribe must cost cash");
  assert.equal(world.stats.bribes, 1);
  assert.ok(p.heat < heatBefore + 1, "bribe must not raise wanted level");

  const stubborn = core.createRun({ category: "comfort", seed: 8, difficulty: "normal" });
  stubborn.player.hearts = 5;
  stubborn.player.invuln = 0;
  stubborn.time = RULES.grace + 1;
  core.spawnCop(stubborn, false);
  const blocker = stubborn.cops[0];
  blocker.x = stubborn.player.x + 60;
  blocker.y = stubborn.player.y;
  core.step(stubborn, DT, {});
  stubborn.player.cash = 0;
  for (let i = 0; i < Math.ceil(RULES.bribeWindow / DT) + 5; i++)
    core.step(stubborn, DT, {});
  assert.equal(stubborn.stats.failedBribes, 1, "timeout must be logged as a protocol");
  assert.ok(stubborn.player.hearts <= 4, "protocol must damage the bumper");
});

test("drones telegraph before they strike and never spawn on top of the player", () => {
  const world = core.createRun({ category: "comfort", seed: 6, difficulty: "normal" });
  core.spawnDrone(world);
  const drone = world.drones[0];
  assert.ok(drone.y < WORLD.playerY - 400, "drone appeared too close");
  const states = new Set();
  for (let i = 0; i < 60 * 12; i++) {
    core.step(world, DT, {});
    if (world.drones[0]) states.add(world.drones[0].state);
    world.events.length = 0;
  }
  assert.ok(states.has("hover") || states.has("lock") || states.has("dive"), "drone never engaged");
  const locked = world.drones.find((d) => d.state === "lock");
  if (locked) assert.ok(locked.timer > 0, "lock must have a visible wind-up");
});

test("nitro converts speed into offence against patrols and drones", () => {
  const world = core.createRun({ category: "business", seed: 2, difficulty: "normal" });
  world.player.nitro = 100;
  world.player.invuln = 0;
  world.time = RULES.grace + 1;
  core.spawnCop(world, false);
  const cop = world.cops[0];
  cop.x = world.player.x + 40;
  cop.y = world.player.y - 20;
  core.step(world, DT, { nitro: true });
  assert.ok(world.player.nitroTime > 0, "nitro must ignite");
  const heatBefore = world.player.heat;
  for (let i = 0; i < 30; i++) core.step(world, DT, {});
  assert.ok(world.stats.rams >= 1 || world.player.encounter, "nitro ram or encounter must resolve");
  assert.ok(world.player.heat >= heatBefore - 1);
});

test("grace period keeps the first seconds free of hazards", () => {
  const world = core.createRun({ category: "comfort", seed: 12, difficulty: "normal" });
  for (let i = 0; i < Math.ceil((RULES.grace - 2) / DT); i++) core.step(world, DT, {});
  assert.equal(world.props.length, 0, "props must wait for the grace period");
  assert.equal(world.drones.length, 0, "drones must wait for the grace period");
  assert.ok(world.targets.length >= 0);
});

test("world geometry keeps lanes inside the road", () => {
  assert.equal(WORLD.laneCenters.length, WORLD.lanes);
  for (const x of WORLD.laneCenters)
    assert.ok(x > WORLD.roadLeft && x < WORLD.roadRight, "lane center escaped the road");
  assert.ok(WORLD.roadTop > 0 && WORLD.roadTop < WORLD.playerY);
  assert.ok(WORLD.playerY + 200 < WORLD.height);
});
