const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM, VirtualConsole } = require("jsdom");

const read = (path) => fs.readFileSync(path, "utf8");
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
const car = {
  id: 1,
  brand: "Kia",
  model: "Rio",
  plate: "TEST123",
  category: "economy",
  address: "Test parking",
  fuel: 80,
  rate_kopecks: 900,
  status: "available",
  image: "images/kiario.png",
};
const rental = {
  id: 7,
  car_id: 1,
  status: "active",
  rate_kopecks: 900,
  created_at: "2026-01-01T00:00:00Z",
  started_at: "2026-01-01T00:00:00Z",
  finished_at: null,
  total_kopecks: 0,
  car_name: "Kia Rio",
  plate: "TEST123",
  address: "Test parking",
  expires_at: "2026-01-01T00:20:00Z",
  estimated_kopecks: 900,
  server_now: "2026-01-01T00:01:00Z",
  pickup_address: "Test parking",
  finish_address: null,
};

async function screen(name, options = {}) {
  const { role = "user", query = "", scripts = "" } = options;
  const user =
    role === "guest"
      ? null
      : {
          id: 1,
          name: "Driver",
          email: "d@example.com",
          is_admin: role === "admin",
        };
  const requests = [];
  const errors = [];
  const audioCalls = [];
  const mediaHandlers = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    if (!error.message.includes("Not implemented: navigation"))
      errors.push(error.message);
  });
  let html = read("app/templates/base.html");
  for (const [key, value] of Object.entries({
    page: name,
    title: name,
    content: read(`app/templates/${name}.html`),
    subnav: "",
    styles: "",
    scripts,
    asset_version: "test",
  }))
    html = html.replaceAll(`{{${key}}}`, value);
  const dom = new JSDOM(html, {
    url: "http://localhost/" + (name === "home" ? "" : name) + query,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const w = dom.window;
  w.AbortSignal.timeout = () => undefined;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  w.fetch = async (url, options2 = {}) => {
    const route = url.split("?")[0];
    requests.push({ url, route, options: options2 });
    let data;
    if (route === "/api/auth/me") data = user || { detail: "Sign in" };
    else if (route === "/api/cars") data = [car];
    else if (route.startsWith("/api/cars/")) data = options.chosenCar || car;
    else if (route === "/api/rentals/summary")
      data = { completed_count: 0, total_kopecks: 0 };
    else if (route === "/api/rentals/current")
      data =
        options.current ?? (options.game && role !== "guest" ? rental : null);
    else if (/^\/api\/rentals\/\d+\/game\/finish$/.test(route)) {
      if (options.failFinish && !w.finishFailed) {
        w.finishFailed = true;
        return {
          ok: false,
          status: 503,
          json: async () => ({ detail: "Offline" }),
        };
      }
      const body = JSON.parse(options2.body);
      /* app/services/rentals.py заводит строку таблицы только для
         заездов от 10 секунд с положительными очками. */
      w.tabled = body.duration_seconds >= 10 && body.score > 0;
      data = {
        ...(options.current || rental),
        status: "completed",
        total_kopecks: 900,
        game_result: { ...body, car_name: "Kia Rio", category: "economy" },
      };
    } else if (/^\/api\/rentals\/\d+\/heartbeat$/.test(route)) {
      if (options.failHeartbeat)
        return {
          ok: false,
          status: options.failHeartbeat,
          json: async () => ({ detail: "Trip unavailable" }),
        };
      data = { ...(options.current || rental), status: "active" };
    } else if (/^\/api\/rentals\/\d+\/start$/.test(route))
      data = { ...(options.current || rental), status: "active" };
    else if (/^\/api\/rentals\/\d+$/.test(route))
      data = options.current || rental;
    else if (route === "/api/rentals")
      data =
        options2.method === "POST"
          ? { ...rental, status: "reserved" }
          : options.rentals || [];
    else if (route === "/api/game/leaderboard" && options.failBoard)
      return {
        ok: false,
        status: 500,
        json: async () => ({ detail: "Board offline" }),
      };
    else if (route === "/api/game/leaderboard")
      data = {
        period: "week",
        week: "2026-W41",
        category: null,
        rows: [
          {
            rank: 1,
            name: '<img src=x onerror="alert(1)">',
            car_name: "BMW 320i",
            category: "business",
            score: 2100000,
            level: 26,
            knockdowns: 1000,
            drones: 40,
            bribes: 12,
            profit_kopecks: 50000,
            duration_seconds: 520,
            reason: "wrecked",
            is_me: false,
          },
        ],
        totals: { players: 1, runs: 1 },
        me:
          user && w.tabled !== false
            ? { rank: 2, score: 90000, best_ever: 90000, plays: 1 }
            : null,
      };
    else if (route === "/api/game/scores")
      data = {
        accepted: true,
        improved: true,
        score: 90000,
        level: 5,
        week: "2026-W41",
        personal: { rank: 2, score: 90000, best_ever: 90000, plays: 1 },
      };
    else throw new Error("Unexpected request: " + url);
    if (options.missingCar && route.startsWith("/api/cars/"))
      return {
        ok: false,
        status: 404,
        json: async () => ({ detail: "Missing" }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(JSON.stringify(data)),
    };
  };
  vm.runInContext(read("app/static/app.js"), dom.getInternalVMContext());
  if (name === "leaderboard")
    vm.runInContext(
      read("app/static/leaderboard.js"),
      dom.getInternalVMContext(),
    );
  if (options.game) {
    if (options.savedRun)
      w.localStorage.setItem(
        "drive.rental.run.v1." + rental.id,
        JSON.stringify(options.savedRun),
      );
    if (options.storedCar)
      w.localStorage.setItem(
        "drive.selectedCar",
        JSON.stringify(options.storedCar),
      );
    w.matchMedia = (query) => ({
      matches:
        (!!options.touch && /pointer:\s*coarse/.test(query)) ||
        (!!options.reduceMotion && /prefers-reduced-motion/.test(query)),
      addEventListener: (type, fn) => {
        if (/prefers-reduced-motion/.test(query)) mediaHandlers.push(fn);
      },
    });
    w.requestAnimationFrame = () => 1;
    w.HTMLCanvasElement.prototype.getContext = () => ({});
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.GameArt = {
      playerCar: (_, props) => {
        w.previewSkin = props.skin;
      },
    };
    w.GameAudio = new Proxy(
      {},
      {
        get: (target, name) =>
          name in target
            ? target[name]
            : name === "setMuted"
              ? (value) => value
              : name === "getVolume"
                ? () => ({ music: 1, sfx: 1 })
                : (...args) => {
                    audioCalls.push([String(name), args]);
                  },
        set: (target, name, value) => {
          target[name] = value;
          return true;
        },
      },
    );
    vm.runInContext(
      read("app/static/game-core.js"),
      dom.getInternalVMContext(),
    );
    vm.runInContext(read("app/static/game.js"), dom.getInternalVMContext());
  }
  await pause();
  return {
    w,
    requests,
    errors,
    audioCalls,
    mediaHandlers,
    close: () => dom.window.close(),
  };
}

test("drive page ships canvas, HUD and every overlay", async () => {
  const p = await screen("drive", { role: "guest" });
  try {
    const d = p.w.document;
    assert.equal(d.querySelectorAll("h1").length, 1);
    assert.ok(d.getElementById("drive-canvas"));
    for (const id of [
      "hud-score",
      "hud-cash",
      "hud-cashout",
      "hud-level",
      "hud-clock",
      "hud-raid",
      "hud-retire",
      "hud-hearts",
      "hud-heat",
      "hud-nitro-fill",
      "hud-powers",
      "bribe-prompt",
      "bribe-cost",
      "drive-intro",
      "intro-goal",
      "intro-help",
      "intro-help-text",
      "drive-pause",
      "pause-help",
      "pause-state",
      "drive-result",
      "drive-start",
      "drive-sound",
      "drive-calm",
      "drive-volume",
      "drive-volume-panel",
      "vol-music",
      "vol-sfx",
      "drive-caster",
      "result-grade",
      "result-stats",
      "result-stars",
      "result-caption",
      "result-meta",
      "result-rank",
      "result-gif",
      "touch-bribe",
      "touch-nitro",
    ])
      assert.ok(d.getElementById(id), "missing #" + id);
    assert.equal(
      d.getElementById("drive-difficulty"),
      null,
      "один режим сложности",
    );
    assert.equal(
      d.getElementById("hud-time"),
      null,
      "таймера смены больше нет",
    );
    assert.equal(
      d.getElementById("drive-coach"),
      null,
      "обучающие подсказки не закрывают дорогу",
    );
    const ids = [...d.querySelectorAll("[id]")].map((e) => e.id);
    assert.equal(ids.length, new Set(ids).size, "duplicate IDs");
    assert.equal(d.querySelector(".drive-disclaimer"), null);
    assert.equal(d.querySelector("#board-intro"), null);
    assert.ok(!d.body.textContent.includes("Заезд бесконечный"));
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("catalog has one rental action and a separate leaderboard navigation", async () => {
  const p = await screen("cars");
  try {
    assert.equal(p.w.document.querySelector("[data-drive]"), null);
    assert.match(
      p.w.document.querySelector("[data-reserve]").textContent,
      /Поехать/,
    );
    assert.ok(p.w.document.querySelector('nav a[href="/leaderboard"]'));
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("confirming a car reserves and starts the real rental", async () => {
  const p = await screen("cars");
  try {
    p.w.document.querySelector("[data-reserve]").click();
    await pause();
    const form = p.w.document.getElementById("reserve-form");
    form.dispatchEvent(
      new p.w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    assert.ok(
      p.requests.some(
        (r) => r.route === "/api/rentals" && r.options.method === "POST",
      ),
    );
    assert.ok(p.requests.some((r) => r.route === "/api/rentals/7/start"));
    assert.equal(p.w.document.getElementById("reserve-drive"), null);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("active rental resumes by its rental ID without the default counter", async () => {
  const p = await screen("trips", { current: rental });
  try {
    const link = p.w.document.querySelector("#active-trip a");
    assert.equal(link.getAttribute("href"), "/drive?rental=7");
    assert.equal(p.w.document.querySelector("#live-time"), null);
    assert.equal(p.w.document.querySelector('[data-action="finish"]'), null);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("каждое событие ядра имеет голос или явное право молчать", () => {
  const coreSrc = read("app/static/game-core.js");
  const uiSrc = read("app/static/game.js");
  const audioSrc = read("app/static/game-audio.js");
  const emitted = new Set(
    [...coreSrc.matchAll(/emit\(world, "([a-zA-Z]+)"/g)].map((m) => m[1]),
  );
  assert.ok(
    emitted.size >= 20,
    "ядро перестало испускать события? найдено " + emitted.size,
  );

  const mapBlock = /const SFX_BY_EVENT = \{([\s\S]*?)\n  \};/.exec(uiSrc);
  assert.ok(mapBlock, "карта SFX_BY_EVENT не найдена");
  const mapped = new Map(
    [...mapBlock[1].matchAll(/^\s+([a-zA-Z]+):\s*"([a-zA-Z]+)"/gm)].map((m) => [
      m[1],
      m[2],
    ]),
  );

  const voices = new Set(
    [
      ...(/const SFX = \{([\s\S]*?)\n  \};/.exec(audioSrc)?.[1] || "").matchAll(
        /^\s{4}([a-zA-Z]+)\(/gm,
      ),
    ].map((m) => m[1]),
  );
  const slots = new Set(
    [
      ...(
        /const SAMPLES = \{([\s\S]*?)\n  \};/.exec(audioSrc)?.[1] || ""
      ).matchAll(/^\s{4}([a-zA-Z]+):/gm),
    ].map((m) => m[1]),
  );

  /* Экран сам озвучивает исход (win/lose), поэтому финальные события в карте не нужны */
  const allowedSilence = {
    end: "исход озвучивает showResult через win/lose",
    finished: "то же самое: финал играет одним из двух слотов",
    /* тариф тикает каждую игровую минуту (1,5 с реального времени): озвучивать
       каждый тик — значит превратить счёт в пулемёт. Звук имеет только момент,
       когда наличность кончилась и тариф пошёл в долг (debtStart). */
    rent: "минутный тик тарифа",
  };

  for (const name of emitted) {
    if (!mapped.has(name)) {
      assert.ok(
        allowedSilence[name],
        "событие " +
          name +
          " не маппится ни на один звук и не имеет разрешения молчать",
      );
      continue;
    }
    const slot = mapped.get(name);
    assert.ok(
      voices.has(slot) || slots.has(slot),
      "карта ждёт голос " +
        slot +
        " для события " +
        name +
        ", а его нет в game-audio.js",
    );
  }
  for (const name of Object.keys(allowedSilence))
    assert.ok(
      emitted.has(name),
      "разрешение молчать для " + name + " устарело",
    );

  /* эти четыре момента раньше были немы: ядро их слало, экран молчал */
  for (const name of ["nitroEnd", "powerEnd", "droneMiss", "debtStart"])
    assert.ok(
      mapped.has(name),
      "событие " + name + " снова осталось без звука",
    );
});

test("mini-game assets are plain files allowed by the site CSP", () => {
  for (const file of [
    "app/static/game-core.js",
    "app/static/game-art.js",
    "app/static/game-audio.js",
    "app/static/game.js",
    "app/static/game.css",
    "app/templates/drive.html",
  ])
    assert.ok(fs.existsSync(file), "missing " + file);
  const markup =
    read("app/templates/drive.html") + read("app/templates/base.html");
  assert.ok(!/style="/.test(markup), "inline style attribute breaks style-src");
  assert.ok(
    !/<script/.test(read("app/templates/drive.html")),
    "inline script breaks script-src",
  );
  const pages = read("app/pages.py");
  for (const name of [
    "game-core.js",
    "game-art.js",
    "game-audio.js",
    "game.js",
  ])
    assert.ok(pages.includes(name), "pages.py does not load " + name);
});

test("the selected rental's locked tariff wins over stale local storage and current catalog rate", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
    storedCar: { ...car, rate_kopecks: 100 },
    chosenCar: { ...car, rate_kopecks: 1900 },
  });
  try {
    const g = p.w.DriveGame;
    assert.equal(g.state.car.rate_kopecks, 900);
    assert.equal(p.w.previewSkin, "rio");
    assert.match(
      p.w.document.getElementById("intro-tariff").textContent,
      /1,5 с игры = 1 мин поездки/,
    );
    g.start();
    g.step(1 / 60);
    g.hud(1 / 60);
    assert.equal(g.state.world.car.rateKopecks, 900);
    assert.equal(g.state.world.stats.rentalCost, 900);
    assert.equal(g.state.world.player.cash, 499100);
    assert.match(p.w.document.getElementById("hud-profit").textContent, /9,00/);
    g.togglePause();
    const pausedTime = g.state.world.time;
    for (let i = 0; i < 1500; i++) g.step(0.05);
    assert.equal(g.state.world.time, pausedTime);
    assert.equal(g.state.world.stats.rentalCost, 900);
    g.togglePause();
    g.step(0.05);
    assert.ok(g.state.world.time > pausedTime);
    const other = p.w.GameCore.createRun({ seed: 1, rateKopecks: 900 });
    assert.equal(other.stats.rentalCost, 0, "restarting must reset the bill");
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("the exact rental selects its car and autostarts", async () => {
  const bmw = {
    ...car,
    id: 4,
    brand: "BMW",
    model: "320i",
    category: "business",
    rate_kopecks: 2200,
  };
  const p = await screen("drive", {
    game: true,
    query: "?rental=8",
    current: { ...rental, id: 8, car_id: 4, rate_kopecks: 2100 },
    chosenCar: bmw,
    storedCar: car,
  });
  try {
    const g = p.w.DriveGame;
    assert.equal(g.state.mode, "playing");
    assert.equal(g.state.world.car.id, 4);
    assert.equal(g.state.world.car.rateKopecks, 2100);
    assert.equal(p.w.previewSkin, "bmw");
    assert.ok(p.requests.some((r) => r.route === "/api/rentals/8"));
    assert.equal(p.w.document.getElementById("drive-intro").hidden, true);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("a missing selected car cannot silently start a different car", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=1234",
    missingCar: true,
  });
  try {
    assert.equal(p.w.document.getElementById("drive-start").disabled, true);
    assert.match(
      p.w.document.getElementById("intro-car").textContent,
      /недоступна/,
    );
    assert.equal(p.w.DriveGame.state.world, null);
  } finally {
    p.close();
  }
});

test("the HUD shows pressure instead of a shift countdown", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
  });
  try {
    const d = p.w.document;
    const g = p.w.DriveGame;
    g.start();
    g.step(1 / 60);
    g.hud(1 / 60);
    assert.equal(d.getElementById("hud-level").textContent, "1");
    assert.equal(
      d.getElementById("hud-raid").hidden,
      true,
      "облава раньше времени",
    );
    assert.match(d.getElementById("hud-clock").textContent, /мин/);
    const world = g.state.world;
    world.player.cash = 1000000;
    world.time = 150;
    g.step(1 / 60);
    g.hud(1 / 60);
    assert.ok(
      Number(d.getElementById("hud-level").textContent) >= 7,
      "уровень растёт",
    );
    assert.equal(
      d.getElementById("hud-raid").hidden,
      false,
      "полоса облавы появилась",
    );
    assert.match(
      d.getElementById("hud-raid-note").textContent,
      /\d|газ|держит|сидит/,
    );
    assert.match(d.getElementById("hud-retire").textContent, /Забрать|Вернуть/);
    world.stats.cashEarned = 3000000;
    world.stats.cashSpent = 0;
    world.stats.rentalCost = 100000;
    world.player.score = 200000;
    world.player.heat = 0.2;
    g.hud(1 / 60);
    const cashout = p.w.GameCore.cashoutAt(world);
    assert.ok(cashout > 0, "касса возврата считается при плюсовой прибыли");
    const cashoutEl = d.getElementById("hud-cashout");
    assert.equal(cashoutEl.hidden, false, "при плюсе сумма возврата видна");
    assert.equal(
      cashoutEl.textContent,
      "+" + cashout.toLocaleString("ru-RU") + " очк.",
      "HUD обязан показывать ту же кассу возврата, что начислит возврат",
    );
    assert.match(d.getElementById("hud-retire").title, /сгорит/);
    world.stats.cashEarned = 0;
    world.stats.rentalCost = 500000;
    g.hud(1 / 60);
    assert.equal(
      cashoutEl.hidden,
      true,
      "в минус возвращать нечего — плашку убираем, а не кричим о нуле",
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("смена предупреждает, что приносит новый акт", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
  });
  try {
    const d = p.w.document;
    const g = p.w.DriveGame;
    const core = p.w.GameCore;
    const last = core.PHASES[core.PHASES.length - 1];
    g.start();
    g.step(1 / 60);
    const world = g.state.world;
    world.player.cash = 1e9;
    world.fx.length = 0;
    world.time = (last.fromLevel - 1) * core.LEVEL_SECONDS;
    g.step(1 / 60);
    g.hud(1 / 60);
    const pops = world.fx.filter((f) => f.kind === "pop").map((f) => f.text);
    assert.ok(
      pops.includes(last.name.toUpperCase()),
      "экран не назвал новый акт",
    );
    assert.ok(
      pops.includes(last.hint),
      "акт вошёл без слова о новой опасности",
    );
    assert.equal(d.getElementById("hud-phase").textContent, last.name);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("the run posts a score the leaderboard service accepts", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
    role: "user",
  });
  try {
    const g = p.w.DriveGame;
    g.start();
    const world = g.state.world;
    world.time = 240;
    world.player.score = 400000;
    world.player.hearts = 3;
    world.stats.cashEarned = 300000;
    world.player.cash = 250000;
    p.w.GameCore.finish(world, "quit");
    await g.publishScore(world.result);
    await pause();
    const sent = p.requests.find(
      (r) => r.route === "/api/rentals/7/game/finish",
    );
    assert.ok(sent, "результат не отправлен");
    assert.equal(sent.options.method, "POST");
    const body = JSON.parse(sent.options.body);
    assert.equal(body.reason, "quit");
    assert.equal(body.score, world.result.score);
    assert.equal(body.car_id, 1);
    assert.ok(body.duration_seconds >= 10, "слишком короткий заезд");
    assert.ok(
      body.level <=
        Math.min(30, 1 + Math.floor(body.duration_seconds / 22) + 2),
      "уровень не соответствует длительности",
    );
    assert.ok(
      body.score <= body.duration_seconds * 9000,
      "очки кажутся накрученными",
    );
    assert.ok(
      body.knockdowns <= body.duration_seconds * 12,
      "сбитые кажутся накрученными",
    );
    const rankLine = p.w.document.getElementById("result-rank").textContent;
    assert.match(
      rankLine,
      /2-е место недели/,
      "место в таблице недели не показано: " + rankLine,
    );
    assert.match(rankLine, /пилотов в таблице: 1/);
    assert.ok(
      p.requests.some((r) => r.route === "/api/game/leaderboard"),
      "ранг недели не запрошен",
    );
    assert.equal(
      p.w.document.getElementById("result-receipt").getAttribute("href"),
      "/api/rentals/7/receipt",
    );
  } finally {
    p.close();
  }
});

test("место недели не ломает экран, если лидерборд недоступен", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
    role: "user",
    failBoard: true,
  });
  try {
    const g = p.w.DriveGame;
    g.start();
    const world = g.state.world;
    world.time = 240;
    world.player.score = 400000;
    world.player.hearts = 3;
    world.player.cash = 250000;
    p.w.GameCore.finish(world, "quit");
    await g.publishScore(world.result);
    await pause();
    const line = p.w.document.getElementById("result-rank").textContent;
    assert.match(
      line,
      /Поездка сохранена/,
      "без ответа лидерборда строка не должна выдумывать ранг: " + line,
    );
    assert.ok(
      p.requests.some((r) => r.route === "/api/rentals/7/game/finish"),
      "результат всё равно обязан быть отправлен",
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("short runs still complete the rental", async () => {
  const p = await screen("drive", { game: true, query: "?rental=7" });
  try {
    const g = p.w.DriveGame;
    g.state.world.time = 4;
    g.quitShift();
    await pause();
    const sent = p.requests.find(
      (r) => r.route === "/api/rentals/7/game/finish",
    );
    assert.equal(JSON.parse(sent.options.body).duration_seconds, 4);
    assert.equal(g.state.rental.status, "completed");
    const shortLine = p.w.document.getElementById("result-rank").textContent;
    assert.match(shortLine, /Поездка сохранена/);
    assert.ok(
      !/место/.test(shortLine),
      "заезд короче 10 секунд не попадает в таблицу — ранг выдуман быть не может: " +
        shortLine,
    );
    assert.equal(
      p.w.document.getElementById("result-stats").children.length,
      4,
      "итоги: комбо, сбито, финал и аренда",
    );
    assert.match(
      p.w.document.getElementById("result-stats").textContent,
      /машину вернул сам/,
      "добровольный возврат подписан даже без поля killer",
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("пауза называет цену возврата и язык управления", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
  });
  try {
    const d = p.w.document,
      g = p.w.DriveGame;
    g.start();
    const world = g.state.world;
    world.time = 90;
    world.player.hearts = 5;
    world.player.heat = 0.5;
    world.player.score = 60000;
    world.stats.cashEarned = 5200000;
    world.stats.cashSpent = 0;
    world.stats.rentalCost = 200000;
    g.togglePause();
    assert.equal(g.state.mode, "paused");
    assert.match(
      d.getElementById("pause-help").textContent,
      /Пробел — взятка/,
      "клавиатурная легенда пропала с паузы",
    );
    const cashout = p.w.GameCore.cashoutAt(world);
    const line = d.getElementById("pause-state");
    assert.ok(cashout > 0, "заезд обязан давать кассу возврата");
    assert.ok(
      line.textContent.includes(
        "+" + cashout.toLocaleString("ru-RU") + " очк.",
      ),
      "строка не совпадает с ядром: " + line.textContent,
    );
    assert.equal(line.classList.contains("loss"), false);

    world.stats.cashEarned = 0;
    world.stats.rentalCost = 900000;
    g.togglePause();
    g.togglePause();
    assert.equal(g.state.mode, "paused");
    assert.ok(
      /кассы нет/.test(line.textContent),
      "в минус возвращать нечего — пауза обязана это сказать: " +
        JSON.stringify(line.textContent),
    );
    assert.equal(line.classList.contains("loss"), true);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }

  const phone = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
    touch: true,
  });
  try {
    const g = phone.w.DriveGame;
    g.start();
    g.togglePause();
    const help = phone.w.document.getElementById("pause-help").textContent;
    assert.match(help, /пальцем/, "телефону нужна сенсорная легенда: " + help);
    assert.ok(!/A\/D/.test(help), "клавиши телефону не объясняют: " + help);
  } finally {
    phone.close();
  }
});

test("первый заезд получает шпаргалку, а телефон — свои кнопки", async () => {
  const desk = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
  });
  try {
    const d = desk.w.document;
    assert.equal(
      d.getElementById("intro-help").open,
      true,
      "до первой смены шпаргалка обязана быть раскрыта",
    );
    assert.match(d.getElementById("intro-goal").textContent, /окупить тариф/);
    const text = d.getElementById("intro-help-text").textContent;
    assert.match(text, /Пробел — взятка/);
    assert.match(text, /V — вернуть машину/);
    assert.ok(
      !/Кнопки под игрой/.test(text),
      "клавиатуре не нужны экранные кнопки",
    );
    await desk.w.DriveGame.start();
    assert.equal(
      desk.w.localStorage.getItem("drive.intro.help.v1"),
      "1",
      "смена началась — шпаргалка не обязана раскрываться сама",
    );
    assert.deepEqual(desk.errors, []);
  } finally {
    desk.close();
  }

  const phone = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
    touch: true,
  });
  try {
    const text = phone.w.document.getElementById("intro-help-text").textContent;
    assert.match(text, /пальцем по дороге/);
    assert.match(text, /кнопки под игрой/i);
    assert.match(text, /«Взятка»/);
    assert.ok(!/A\/D/.test(text), "телефону нельзя объяснять клавиши: " + text);
    assert.deepEqual(phone.errors, []);
  } finally {
    phone.close();
  }
});

test("промпт взятки учит длине первое окно", async () => {
  const p = await screen("drive", { game: true, query: "?rental=7" });
  try {
    const g = p.w.DriveGame;
    const d = p.w.document;
    const w = g.state.world;
    w.player.encounter = {
      copId: 1,
      timer: 2.6,
      window: 2.6,
      cost: 200000,
      shown: 200000,
      pressed: false,
    };
    g.hud(1 / 60);
    assert.equal(d.getElementById("bribe-prompt").hidden, false);
    assert.match(d.getElementById("bribe-note").textContent, /ПЕРВЫЙ КОНТАКТ/);
    assert.equal(d.getElementById("bribe-fill").style.width, "100%");
    w.player.encounter = { ...w.player.encounter, timer: 1.5, window: 1.5 };
    g.hud(1 / 60);
    assert.equal(d.getElementById("bribe-note").textContent, "ПРОБЕЛ / Взятка");
    assert.equal(d.getElementById("bribe-fill").style.width, "100%");
    w.player.encounter.timer = 0.75;
    g.hud(1 / 60);
    assert.equal(d.getElementById("bribe-fill").style.width, "50%");
    const alt = d.getElementById("bribe-alt");
    w.player.nitro = 0;
    g.hud(1 / 60);
    assert.equal(alt.hidden, false, "цена отказа показана во время диалога");
    assert.match(alt.textContent, /протокол/);
    assert.match(alt.textContent, /бампер/);
    assert.ok(
      !/нитро/.test(alt.textContent),
      "без заряда нитро альтернативу не обещаем",
    );
    w.player.nitro = p.w.GameCore.RULES.nitroCost;
    g.hud(1 / 60);
    assert.match(alt.textContent, /нитро/, "заряженное нитро предлагает таран");
    w.player.encounter = null;
    g.hud(1 / 60);
    assert.equal(alt.hidden, true, "после диалога строка прячется");
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("на телефоне промпт зовёт на кнопку «Взятка», а не на Пробел", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    touch: true,
  });
  try {
    const g = p.w.DriveGame;
    const d = p.w.document;
    const w = g.state.world;
    w.player.encounter = {
      copId: 1,
      timer: 1.5,
      window: 1.5,
      cost: 200000,
      shown: 200000,
      pressed: false,
    };
    w.player.nitro = 0;
    g.hud(1 / 60);
    const note = d.getElementById("bribe-note").textContent;
    assert.match(note, /кнопка «Взятка»/);
    assert.ok(!/ПРОБЕЛ/.test(note), "на таче клавиатуру не обещаем");
    assert.match(d.getElementById("bribe-alt").textContent, /протокол/);
    assert.ok(
      d.getElementById("touch-bribe").classList.contains("armed"),
      "кнопка «Взятка» подсвечена, пока идёт диалог",
    );
    w.player.encounter = null;
    g.hud(1 / 60);
    assert.ok(!d.getElementById("touch-bribe").classList.contains("armed"));
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("экран итогов называет, что именно закончило смену", async () => {
  const p = await screen("drive", { game: true, query: "?rental=7" });
  try {
    const g = p.w.DriveGame;
    const world = g.state.world;
    world.time = 40;
    world.player.hearts = 1;
    world.player.invuln = 0;
    world.stats.dronesDown = 3;
    world.stats.dodges = 5;
    p.w.GameCore.damage(world, 99, "drone");
    assert.equal(
      world.killer,
      "drone",
      "ядро помнит источник смертельного удара",
    );
    g.step(1 / 60);
    await pause();
    assert.equal(world.result.reason, "wrecked");
    assert.equal(world.result.killer, "drone");
    assert.match(
      p.w.document.getElementById("result-stats").textContent,
      /смену закончил БПЛА/,
    );
    assert.match(
      p.w.document.getElementById("result-stats").textContent,
      /3 сбит · 5 мимо/,
      "главная угроза смены должна быть видна по цифрам",
    );
    const caption = p.w.document.getElementById("result-caption").textContent;
    const score = world.result.score;
    assert.ok(
      caption.includes(p.w.GameCore.grade(score).title),
      "подпись не совпадает со ступенью ядра: " + caption,
    );
    assert.match(
      caption,
      /ещё [\d\s]*очк\./,
      "зазор до следующей ступени не назван",
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("leaderboard lives on its own page and escapes names and filters", async () => {
  const p = await screen("leaderboard");
  try {
    const d = p.w.document,
      board = d.getElementById("leader-content");
    assert.equal(board.querySelectorAll("img,[onerror]").length, 0);
    assert.match(board.textContent, /BMW 320i/);
    assert.equal(d.getElementById("leader-personal").hidden, false);
    d.querySelector("[data-period=all]").click();
    await pause();
    assert.ok(p.requests.some((r) => r.url.includes("period=all")));
    d.getElementById("leader-category").value = "business";
    d.getElementById("leader-category").dispatchEvent(new p.w.Event("change"));
    await pause();
    assert.ok(p.requests.some((r) => r.url.includes("category=business")));
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("without a real rental the game cannot start a demo", async () => {
  const p = await screen("drive", { game: true, role: "guest" });
  try {
    await p.w.DriveGame.start();
    assert.equal(p.w.DriveGame.state.world, null);
    assert.equal(p.w.document.getElementById("drive-start").disabled, true);
    assert.ok(!p.requests.some((r) => r.route.includes("/game/finish")));
  } finally {
    p.close();
  }
});

test("completion retries keep the same result and reload restores a paused run", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    failFinish: true,
  });
  let saved;
  try {
    const g = p.w.DriveGame;
    g.state.world.time = 12;
    g.state.world.player.hearts = 3;
    g.togglePause(true);
    saved = JSON.parse(p.w.localStorage.getItem("drive.rental.run.v1.7"));
    g.togglePause();
    g.quitShift();
    await pause();
    assert.equal(p.w.document.getElementById("result-retry").hidden, false);
    assert.equal(g.state.rental.status, "active");
    p.w.document.getElementById("result-retry").click();
    await pause();
    const sent = p.requests.filter((r) => r.route.includes("/game/finish"));
    assert.equal(sent.length, 2);
    assert.equal(sent[0].options.body, sent[1].options.body);
    assert.equal(g.state.rental.status, "completed");
    assert.equal(p.w.localStorage.getItem("drive.rental.run.v1.7"), null);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
  const resumed = await screen("drive", {
    game: true,
    query: "?rental=7",
    savedRun: saved,
  });
  try {
    assert.equal(resumed.w.DriveGame.state.world.player.hearts, 3);
    assert.equal(resumed.w.DriveGame.state.world.time, 12);
    resumed.w.DriveGame.step(0.05);
    assert.ok(resumed.w.DriveGame.state.world.time > 12);
    assert.deepEqual(resumed.errors, []);
  } finally {
    resumed.close();
  }
});

test("completed rentals show their saved result without starting again", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: {
      ...rental,
      status: "completed",
      total_kopecks: 900,
      game_result: {
        score: 2000000,
        level: 25,
        duration_seconds: 300,
        reason: "quit",
        profit_kopecks: 900000,
        knockdowns: 500,
        best_combo: 5,
      },
    },
  });
  try {
    const g = p.w.DriveGame,
      d = p.w.document;
    assert.equal(g.state.mode, "result");
    assert.equal(
      d.getElementById("result-gif").getAttribute("src"),
      "/static/images/smoking.gif",
    );
    assert.equal(d.getElementById("result-grade").textContent, "S");
    assert.match(
      d.getElementById("result-caption").textContent,
      /Король ночного проспекта/,
      "название ступени обязано быть на экране, а не только в таблице ядра",
    );
    assert.match(
      d.getElementById("result-caption").textContent,
      /потолок таблицы/,
    );
    assert.equal(d.getElementById("result-receipt").hidden, false);
    await g.start();
    assert.equal(g.state.mode, "result");
    assert.ok(!p.requests.some((r) => r.route.includes("/game/finish")));
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("зазор до следующей ступени назван: прод-заезд в 711 очках от C", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: {
      ...rental,
      status: "completed",
      total_kopecks: 900,
      game_result: {
        score: 39289,
        level: 2,
        duration_seconds: 40,
        trip_duration_seconds: 1615.68,
        distance_meters: 24571,
        reason: "quit",
        killer: "retired",
        profit_kopecks: 1094350,
        knockdowns: 20,
        drones: 0,
        dodges: 0,
        best_combo: 3,
      },
    },
  });
  try {
    const d = p.w.document;
    const text = d.getElementById("result-caption").textContent;
    assert.equal(d.getElementById("result-grade").textContent, "D");
    assert.match(text, /Первая смена/);
    assert.match(text, /«Довольно бодро»/);
    assert.match(
      text,
      /ещё 711 очк\./,
      "не хватило 711 из 40 000 — экран обязан это сказать: " + text,
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("кнопка «Без миганий» честна: показывает настройку ОС и меняется на лету", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    reduceMotion: true,
  });
  try {
    const d = p.w.document;
    const btn = d.getElementById("drive-calm");
    const g = p.w.DriveGame;
    assert.equal(g.state.calm, true, "уменьшение движения из ОС учтено");
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.match(
      btn.textContent,
      /вкл$/,
      "подпись говорит про текущее состояние",
    );
    btn.click();
    assert.equal(g.state.calm, false);
    assert.equal(btn.getAttribute("aria-pressed"), "false");
    assert.match(btn.textContent, /выкл$/);
    assert.equal(
      JSON.parse(p.w.localStorage.getItem("drive.nightshift.calm.v1")).calm,
      false,
      "выбор игрока переживает перезагрузку",
    );
    assert.ok(p.mediaHandlers.length, "изменение настройки ОС слушаем");
    p.mediaHandlers.forEach((fn) => fn({ matches: true }));
    assert.equal(
      g.state.calm,
      false,
      "раз игрок выбрал сам — системная настройка не перебивает",
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("без явного выбора настройка ОС применяется на лету", async () => {
  const p = await screen("drive", { game: true, query: "?rental=7" });
  try {
    const g = p.w.DriveGame;
    assert.equal(g.state.calm, false);
    p.mediaHandlers.forEach((fn) => fn({ matches: true }));
    assert.equal(g.state.calm, true, "настройка ОС до сих пор главный сигнал");
    assert.match(p.w.document.getElementById("drive-calm").textContent, /вкл$/);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("music and effects have their own saved volume knobs", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?rental=7",
    current: rental,
  });
  try {
    const d = p.w.document;
    const panel = d.getElementById("drive-volume-panel");
    const button = d.getElementById("drive-volume");
    assert.equal(panel.hidden, true, "панель спрятана до нажатия");
    const musicCalls = () =>
      p.audioCalls.filter(
        (call) => call[0] === "setVolume" && call[1][0] === "music",
      );
    assert.equal(musicCalls().length, 1, "ручка применена при старте");
    assert.equal(musicCalls()[0][1][1], 1);
    button.click();
    assert.equal(panel.hidden, false);
    assert.equal(button.getAttribute("aria-pressed"), "true");
    const slider = d.getElementById("vol-music");
    slider.value = "60";
    slider.dispatchEvent(new p.w.Event("input", { bubbles: true }));
    assert.equal(d.getElementById("vol-music-value").textContent, "60%");
    assert.equal(musicCalls().pop()[1][1], 0.6);
    assert.equal(
      JSON.parse(p.w.localStorage.getItem("drive.nightshift.volume.v1")).music,
      0.6,
    );
    const sfx = d.getElementById("vol-sfx");
    sfx.value = "0";
    sfx.dispatchEvent(new p.w.Event("input", { bubbles: true }));
    assert.equal(
      p.audioCalls
        .filter((call) => call[0] === "setVolume" && call[1][0] === "sfx")
        .pop()[1][1],
      0,
    );
    assert.deepEqual({ ...p.w.DriveGame.state.volume }, { music: 0.6, sfx: 0 });
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("touch actions fire once, capture a drag and suppress text selection menus", async () => {
  const p = await screen("drive", {
    game: true,
    role: "user",
    query: "?rental=7",
  });
  try {
    const g = p.w.DriveGame;
    g.start();
    for (const [id, prop, action] of [
      ["touch-nitro", "touchNitro", "nitro"],
      ["touch-bribe", "touchBribe", "bribe"],
    ]) {
      const button = p.w.document.getElementById(id);
      const captured = [];
      button.setPointerCapture = (pointerId) => captured.push(pointerId);
      const down = new p.w.Event("pointerdown", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(down, "pointerId", { value: 7 });
      assert.equal(button.dispatchEvent(down), false);
      assert.deepEqual(captured, [7]);
      assert.equal(g.state[prop], true);
      assert.equal(g.input()[action], true);
      assert.equal(
        g.input()[action],
        false,
        "held button must not repeat an action",
      );
      button.dispatchEvent(new p.w.Event("pointercancel"));
      assert.equal(g.state[prop], false);
      for (const type of ["contextmenu", "selectstart", "dragstart"])
        assert.equal(
          button.dispatchEvent(new p.w.Event(type, { cancelable: true })),
          false,
        );
    }
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("game keeps an active trip alive and stops heartbeat after completion", async () => {
  const p = await screen("drive", { game: true, query: "?rental=7" });
  try {
    const beats = () =>
      p.requests.filter((r) => r.route.endsWith("/heartbeat"));
    assert.equal(beats().length, 1);
    assert.equal(beats()[0].options.method, "POST");
    p.w.DriveGame.togglePause(true);
    p.w.document.dispatchEvent(new p.w.Event("visibilitychange"));
    await pause();
    assert.equal(beats().length, 2, "visible paused game retains its lease");
    Object.defineProperty(p.w.document, "hidden", {
      configurable: true,
      value: true,
    });
    p.w.document.dispatchEvent(new p.w.Event("visibilitychange"));
    await pause();
    assert.equal(beats().length, 2, "hidden page does not keep a car occupied");
    Object.defineProperty(p.w.document, "hidden", {
      configurable: true,
      value: false,
    });
    p.w.DriveGame.quitShift();
    await pause();
    p.w.document.dispatchEvent(new p.w.Event("visibilitychange"));
    await pause();
    assert.equal(beats().length, 2);
    assert.equal(p.w.DriveGame.state.rental.status, "completed");
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("an expired lease prevents playing while a brief outage permits retry", async () => {
  for (const status of [409, 503]) {
    const p = await screen("drive", {
      game: true,
      query: "?rental=7",
      failHeartbeat: status,
    });
    try {
      assert.equal(
        p.w.DriveGame.state.mode,
        status === 409 ? "intro" : "playing",
      );
      if (status === 409) {
        assert.equal(p.w.document.getElementById("drive-start").hidden, true);
        assert.match(
          p.w.document.getElementById("intro-perk").textContent,
          /каталог/,
        );
        assert.equal(
          p.requests.some((r) => r.route.endsWith("/game/finish")),
          false,
        );
      }
      assert.deepEqual(p.errors, []);
    } finally {
      p.close();
    }
  }
});
