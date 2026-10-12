/* Экономия мини-игры: ускоренная аренда, долг по договору и условие победы. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sim = require("./game-sim.cjs");

const core = sim.core;
const { TIME_SCALE, DEBT_MINUTES, RULES } = core;

test("one minute of play advances 40 trip minutes and city mileage follows the speedometer", () => {
  assert.equal(60 / TIME_SCALE, 1.5);
  const w = core.createRun({ seed: 31 });
  for (let i = 0; i < 300; i++) {
    const distance = w.stats.distance;
    core.step(w, sim.DT, { throttle: 1 });
    assert.ok(
      Math.abs(
        w.stats.distance -
          distance -
          (core.tripSpeed(w.player.speed) * sim.DT * TIME_SCALE) / 3600,
      ) < 1e-9,
    );
  }
  w.time = 60;
  core.finish(w, "quit");
  assert.equal(w.result.tripSeconds, 2400);
  assert.equal(w.result.durationMs, 60000);
  assert.equal(w.result.rentMinutes, 40);
  assert.equal(w.result.distanceMeters, Math.round(w.stats.distance * 1000));
});

test("banknotes credit their literal denomination even with maximum combo and business class", () => {
  const w = core.createRun({ seed: 2, category: "business" });
  w.player.combo = RULES.comboCap;
  for (const rubles of core.BANKNOTES) {
    const before = w.player.cash;
    core.collect(w, { kind: "cash", value: rubles * 100, x: 0, y: 0 });
    assert.equal(w.player.cash - before, rubles * 100);
  }
  for (const category of ["economy", "comfort", "business"]) {
    const run = core.createRun({ seed: 4, category });
    for (let i = 0; i < 100; i++)
      core.knock(run, core.spawnTarget(run, { vip: i % 5 === 0 }));
    assert.ok(run.pickups.every((q) => core.BANKNOTES.includes(q.value / 100)));
  }
});

test("bribes stay in thousands, in round sums, with bounded escalation", () => {
  for (const category of ["economy", "comfort", "business"])
    for (const heat of [0, 1, 3, 6])
      for (const bribes of [0, 10, 100, 1000]) {
        const cost = core.bribeCost({
          cls: core.CLASSES[category],
          player: { heat },
          stats: { bribes },
        });
        assert.ok(cost >= 200000 && cost <= 1500000);
        assert.equal(cost % 50000, 0);
      }
});

test("old unfinished runs convert once without resetting progress or making up earnings", () => {
  const old = core.snapshotRun(core.createRun({ seed: 22, rateKopecks: 900 }));
  delete old.economyVersion;
  old.timeScale = 8;
  old.time = 60;
  old.player.hearts = 3;
  old.stats.cashEarned = 20000;
  old.stats.cashSpent = 10000;
  old.stats.rentalCost = 7200;
  old.stats.distance = 5;
  old.targets = [{ id: 20, purse: 40 }];
  old.pickups = [{ id: 21, kind: "cash", value: 120 }];
  const upgraded = core.resumeRun(old);
  assert.equal(upgraded.time, 60);
  assert.equal(upgraded.player.hearts, 3);
  assert.equal(upgraded.timeScale, 40);
  assert.equal(upgraded.stats.rentalCost, 36000);
  assert.equal(upgraded.player.cash, 1464000);
  assert.ok(core.BANKNOTES.includes(upgraded.targets[0].purse / 100));
  assert.deepEqual(
    core.snapshotRun(core.resumeRun(core.snapshotRun(upgraded))),
    core.snapshotRun(upgraded),
  );
  old.result = { time: 60, rentalCost: 7200 };
  assert.deepEqual(
    JSON.parse(JSON.stringify(core.resumeRun(old).result)),
    old.result,
  );
});

test("rent charges every started rental minute on the accelerated clock", () => {
  for (const rate of [900, 950, 1400, 2200, 1733]) {
    const w = core.createRun({ seed: 1, rateKopecks: rate });
    core.step(w, 0.01, {});
    assert.equal(w.stats.rentalCost, rate);
    assert.equal(w.player.cash, core.STARTING_CASH - rate);
    w.time = 60 / TIME_SCALE - 0.01;
    core.step(w, 0.01, {});
    assert.equal(w.stats.rentalCost, rate, "минута аренды ещё не началась");
    w.time = 60 / TIME_SCALE;
    core.step(w, 0.01, {});
    assert.equal(w.stats.rentalCost, rate * 2);
    assert.equal(core.rentalCost(rate, 120), rate * 2);
    assert.equal(core.rentalCost(rate, 120.001), rate * 3);
  }
});

test("a few minutes behind the wheel cost like a real carshare trip", () => {
  const rate = 1400;
  const w = core.createRun({ seed: 2, rateKopecks: rate });
  w.time = 300;
  core.finish(w, "quit");
  assert.equal(w.result.rentMinutes, 200, "5 минут игры = 200 минут поездки");
  assert.equal(w.result.rentalCost, core.rentalCost(rate, 300 * TIME_SCALE));
  assert.ok(
    w.result.rentalCost >= rate * 40,
    "аренда за смену должна быть ощутимой",
  );
  assert.equal(w.debtLimit, rate * DEBT_MINUTES);
});

test("rent debt is repaid by earnings instead of disappearing when cash hits zero", () => {
  const w = core.createRun({ seed: 3, rateKopecks: 2200 });
  w.player.cash = 100;
  core.step(w, 0.01, {});
  assert.equal(w.player.cash, 0);
  assert.equal(w.player.rentalDebt, 2100);
  core.collect(w, { kind: "cash", value: 20000, x: 0, y: 0 });
  assert.equal(w.player.rentalDebt, 0);
  assert.equal(w.player.cash, w.stats.cashEarned - 2100);
  assert.equal(
    core.profit(w),
    w.stats.cashEarned - w.stats.cashSpent - w.stats.rentalCost,
  );
});

test("only a paid-off retirement wins; wrecking pays nothing", () => {
  const idle = core.createRun({ seed: 4, rateKopecks: 900 });
  idle.time = 150;
  core.finish(idle, "quit");
  const rent = core.rentalCost(900, 150 * TIME_SCALE);
  assert.equal(idle.result.rentalCost, rent);
  assert.equal(idle.result.profit, -rent);
  assert.equal(idle.result.won, false, "уход в минус не победа");
  assert.equal(idle.result.bonus, 0, "должник не получает кассу");

  const earned = core.createRun({ seed: 5, rateKopecks: 900 });
  core.collect(earned, { kind: "cash", value: 200000, x: 0, y: 0 });
  earned.time = 150;
  core.finish(earned, "quit");
  assert.equal(earned.result.profit, earned.stats.cashEarned - rent);
  assert.equal(earned.result.won, true);
  assert.ok(earned.result.bonus > 0);
  assert.equal(earned.result.grade, core.grade(earned.result.score).grade);

  const wrecked = core.createRun({ seed: 6, rateKopecks: 900 });
  core.collect(wrecked, { kind: "cash", value: 10000, x: 0, y: 0 });
  wrecked.time = 150;
  wrecked.status = "wrecked";
  core.finish(wrecked, "wrecked");
  assert.equal(wrecked.result.reason, "wrecked");
  assert.equal(wrecked.result.won, false);
  assert.equal(wrecked.result.bonus, 0);
});

test("debt ceiling ends the run: the car goes back to the depot", () => {
  const w = core.createRun({ seed: 7, rateKopecks: 2200 });
  w.player.cash = 0;
  w.player.hearts = 999;
  w.player.maxHearts = 999;
  let steps = 0;
  while (w.status === "running" && steps < 60 * 300) {
    core.step(w, 1 / 60, {});
    /* Пешком наличность не поднимать: проверяем именно потолок долга */
    w.pickups.length = 0;
    w.stats.cashEarned = 0;
    steps += 1;
  }
  assert.equal(w.status, "broke", "долг обязан остановить заезд");
  assert.equal(w.result.reason, "broke");
  assert.ok(w.player.rentalDebt >= w.debtLimit);
  assert.equal(w.result.won, false);
});

test("the retirement bonus adds a quarter of the score, not the whole wallet", () => {
  const w = core.createRun({ seed: 9, rateKopecks: 900 });
  core.collect(w, { kind: "cash", value: 200000, x: 0, y: 0 });
  w.time = 70;
  w.player.score = 320000;
  core.finish(w, "quit");
  const r = w.result;
  assert.equal(r.won, true);
  assert.ok(r.bonus <= r.score * 0.35, "бонус раздувает очки: " + r.bonus);
  assert.ok(
    r.score <= r.time * 9000,
    "возврат не проходит серверную проверку правдоподобия: " +
      r.score +
      "/" +
      r.time,
  );
  assert.ok(r.score >= 320000 + r.bonus - 1);
});

test("four models have distinct skins and physical handling, including two economy cars", () => {
  const profiles = Object.keys(core.CARS).map((carName) =>
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
  assert.equal(
    core.carProfile({ carName: "Another car", category: "economy" }).skin,
    "economy",
  );
});

test("car class changes the money curve, not only the label", () => {
  const gains = ["economy", "comfort", "business"].map((category) =>
    core.CASH_POOLS[category].reduce((sum, value) => sum + value, 0),
  );
  assert.ok(
    gains[0] < gains[1] && gains[1] < gains[2],
    "чек должен расти по классу",
  );
  for (const category of ["economy", "comfort", "business"]) {
    const cls = core.CLASSES[category];
    assert.ok(cls.hearts >= 4 && cls.hearts <= 8, category + " hearts");
    assert.ok(cls.perk.length > 20, category + " needs a readable perk line");
  }
  const business = core.CLASSES.business;
  const economy = core.CLASSES.economy;
  assert.ok(business.mass > economy.mass, "бизнес тяжелее");
  assert.ok(business.steer < economy.steer, "бизнес рулится медленнее");
  assert.ok(
    core.bribeCost({
      player: { heat: 3 },
      cls: business,
      stats: { bribes: 0 },
    }) <
      core.bribeCost({
        player: { heat: 3 },
        cls: economy,
        stats: { bribes: 0 },
      }),
    "скидка на взятки обязана работать",
  );
});

test("bribes cost money and cool the wanted level, silence costs bumpers", () => {
  const w = core.createRun({ category: "comfort", seed: 4 });
  const p = w.player;
  p.cash = 5000;
  p.invuln = 0;
  w.time = RULES.grace + 1;
  core.spawnCop(w, false);
  const cop = w.cops[0];
  cop.x = p.x + 60;
  cop.y = p.y;
  core.step(w, sim.DT, {});
  assert.ok(p.encounter, "контакт с патрулем обязан открыть диалог");
  const heatBefore = p.heat;
  p.cash = 999999;
  core.step(w, sim.DT, { bribe: true });
  assert.equal(p.encounter, null, "взятка закрывает диалог");
  assert.ok(p.cash < 999999, "взятка стоит денег");
  assert.equal(w.stats.bribes, 1);
  assert.ok(p.heat < heatBefore + 1, "взятка не поднимает тепло");

  const stubborn = core.createRun({ category: "comfort", seed: 8 });
  stubborn.player.hearts = 5;
  stubborn.player.invuln = 0;
  stubborn.time = RULES.grace + 1;
  core.spawnCop(stubborn, false);
  const blocker = stubborn.cops[0];
  blocker.x = stubborn.player.x + 60;
  blocker.y = stubborn.player.y;
  core.step(stubborn, sim.DT, {});
  stubborn.player.cash = 0;
  const wait = Math.ceil(stubborn.player.encounter.window / sim.DT) + 5;
  for (let i = 0; i < wait; i++) core.step(stubborn, sim.DT, {});
  assert.equal(stubborn.stats.failedBribes, 1, "молчание пишется в протокол");
  assert.ok(stubborn.player.hearts <= 4, "протокол бьёт по бамперу");
});

test("долг по тарифу объявляет себя на переходе, а не на каждом тике", () => {
  const w = core.createRun({ seed: 7, carName: "Kia Rio", rateKopecks: 1400 });
  w.player.cash = 0;
  let debtStarts = 0;
  let rents = 0;
  /* плашка живёт ttl и исчезает из fx, поэтому её считают по факту появления */
  const seenPops = new Set();
  let debtPops = 0;
  const run = (seconds) => {
    /* время мира ведёт сам core.step: прибавлять его руками здесь значит
       считать минуты тарифа дважды */
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      core.step(w, sim.DT, {});
      for (const e of w.events) {
        if (e.type === "debtStart") debtStarts += 1;
        if (e.type === "rent") rents += 1;
      }
      for (const f of w.fx) {
        if (
          f.kind === "pop" &&
          f.text === "ДОЛГ ПО ТАРИФУ" &&
          !seenPops.has(f)
        ) {
          seenPops.add(f);
          debtPops += 1;
        }
      }
      /* доход сначала гасит долг — забираем купюры, чтобы мерить именно тики */
      w.pickups.length = 0;
      w.events.length = 0;
    }
  };
  run(3);
  assert.ok(w.player.rentalDebt > 0, "без наличных тариф обязан уйти в долг");
  assert.equal(debtStarts, 1, "первый долг кричит один раз");
  assert.equal(debtPops, 1, "плашка о долге появилась один раз");
  assert.ok(rents >= 1, "тик тарифа всё равно считается");

  const grew = w.player.rentalDebt;
  run(6);
  assert.ok(w.player.rentalDebt > grew, "без дохода долг растёт");
  assert.equal(
    debtStarts,
    1,
    "тики поверх уже имеющегося долга сигнал не повторяют",
  );
  assert.equal(debtPops, 1, "и плашка не должна повторяться");
  assert.equal(w.status, "running", "до лимита в 12 минут тарифа заезд жив");

  /* выбрался из долга и снова упал — это новый случай, он обязан быть слышен */
  w.player.rentalDebt = 0;
  run(6);
  assert.equal(debtStarts, 2, "свежий долг после погашения объявляется заново");
  assert.equal(debtPops, 2, "и плашка выходит заново на новый долг");
});
