const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync("app/static/game-core.js", "utf8"), context);
const core = context.GameCore;

test("rent uses the selected tariff and charges each started minute exactly once", () => {
  for (const rate of [900, 950, 1400, 2200, 1733]) {
    const w = core.createRun({ seed: 1, rateKopecks: rate });
    core.step(w, 0.01, {});
    assert.equal(w.stats.rentalCost, rate);
    assert.equal(w.player.cash, core.STARTING_CASH - rate);
    w.time = 60 - 0.01;
    core.step(w, 0.01, {});
    assert.equal(w.stats.rentalCost, rate);
    core.step(w, 0.01, {});
    assert.equal(w.stats.rentalCost, rate * 2);
    assert.equal(w.player.cash, core.STARTING_CASH - rate * 2);
    assert.equal(core.rentalCost(rate, 120), rate * 2);
    assert.equal(core.rentalCost(rate, 120.001), rate * 3);
  }
});

test("rent debt is repaid by earnings instead of disappearing when cash reaches zero", () => {
  const w = core.createRun({ seed: 2, rateKopecks: 2200 });
  w.player.cash = 100;
  core.step(w, 0.01, {});
  assert.equal(w.player.cash, 0);
  assert.equal(w.player.rentalDebt, 2100);
  core.collect(w, { kind: "cash", value: 2000, x: 0, y: 0 });
  assert.equal(w.player.rentalDebt, 0);
  assert.equal(w.player.cash, w.stats.cashEarned - 2100);
  assert.equal(core.profit(w), w.stats.cashEarned - 2200);
});

test("starting cash cannot buy victory; profitable early quits also do not win", () => {
  const idle = core.createRun({ seed: 3, rateKopecks: 900 });
  idle.time = 150;
  core.finish(idle, "shift_end");
  assert.equal(idle.result.profit, -2700);
  assert.equal(idle.result.won, false);
  assert.equal(idle.result.cash, core.STARTING_CASH - 2700);
  const earned = core.createRun({ seed: 4, rateKopecks: 900 });
  core.collect(earned, { kind: "cash", value: 10000, x: 0, y: 0 });
  earned.time = 150;
  core.finish(earned, "shift_end");
  assert.equal(earned.result.won, true);
  assert.equal(earned.result.profit, earned.result.revenue - 2700);
  const cashBefore = earned.player.cash,
    scoreBefore = earned.player.score;
  core.step(earned, 0.05, {});
  core.finish(earned, "shift_end");
  assert.equal(earned.player.cash, cashBefore);
  assert.equal(earned.player.score, scoreBefore);
  const early = core.createRun({ seed: 4, rateKopecks: 900 });
  core.collect(early, { kind: "cash", value: 10000, x: 0, y: 0 });
  early.time = 1;
  core.finish(early, "quit");
  assert.ok(early.result.profit > 0);
  assert.equal(early.result.won, false);
});

test("four models have distinct skins and physical handling, including two economy cars", () => {
  const profiles = Object.entries(core.CARS).map(([carName]) =>
    core.carProfile({ carName }),
  );
  assert.equal(new Set(profiles.map((p) => p.skin)).size, 4);
  assert.equal(new Set(profiles.map((p) => p.maxSpeed)).size, 4);
  assert.equal(new Set(profiles.map((p) => p.steer)).size, 4);
  const rio = core.createRun({
    carName: "Kia Rio",
    category: "economy",
    seed: 5,
  });
  const solaris = core.createRun({
    carName: "Hyundai Solaris",
    category: "economy",
    seed: 5,
  });
  const bmw = core.createRun({
    carName: "BMW 320i",
    category: "business",
    seed: 5,
  });
  core.step(rio, 0.05, { fast: true });
  core.step(solaris, 0.05, { fast: true });
  core.step(bmw, 0.05, { fast: true });
  assert.ok(
    bmw.player.speed > solaris.player.speed &&
      solaris.player.speed > rio.player.speed,
  );
  assert.notEqual(rio.player.width, solaris.player.width);
  assert.notEqual(rio.player.hearts, solaris.player.hearts);
  const other = core.carProfile({
    carName: "Another car",
    category: "economy",
  });
  assert.equal(other.skin, "economy");
});
