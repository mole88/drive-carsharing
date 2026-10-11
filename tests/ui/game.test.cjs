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
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
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
    else if (route === "/api/rentals/current") data = options.current || null;
    else if (route === "/api/rentals") data = options.rentals || [];
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
        me: user ? { rank: 2, score: 90000, best_ever: 90000, plays: 1 } : null,
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
    return { ok: true, status: 200, json: async () => data };
  };
  vm.runInContext(read("app/static/app.js"), dom.getInternalVMContext());
  if (options.game) {
    if (options.storedCar)
      w.localStorage.setItem(
        "drive.selectedCar",
        JSON.stringify(options.storedCar),
      );
    w.matchMedia = () => ({ matches: false });
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
  return { w, requests, errors, audioCalls, close: () => dom.window.close() };
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
      "drive-pause",
      "drive-result",
      "drive-start",
      "drive-sound",
      "drive-calm",
      "drive-volume",
      "drive-volume-panel",
      "vol-music",
      "vol-sfx",
      "drive-caster",
      "board-intro",
      "board-result",
      "result-grade",
      "result-stats",
      "result-stars",
      "result-meta",
      "result-rank",
      "result-gif",
      "touch-bribe",
      "touch-nitro",
    ])
      assert.ok(d.getElementById(id), "missing #" + id);
    assert.equal(d.getElementById("drive-difficulty"), null, "один режим сложности");
    assert.equal(d.getElementById("hud-time"), null, "таймера смены больше нет");
    assert.equal(d.getElementById("drive-coach"), null, "обучающие подсказки не закрывают дорогу");
    const ids = [...d.querySelectorAll("[id]")].map((e) => e.id);
    assert.equal(ids.length, new Set(ids).size, "duplicate IDs");
    assert.match(d.querySelector(".drive-disclaimer").textContent, /сатира/i);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("catalog card offers the mini-game for its own car", async () => {
  const p = await screen("cars");
  try {
    const cta = p.w.document.querySelector("[data-drive]");
    assert.ok(cta, "car card has no mini-game button");
    assert.equal(cta.dataset.drive, String(car.id));
    assert.match(cta.textContent, /Ночная смена/i);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("reservation dialog links the mini-game to the chosen car", async () => {
  const p = await screen("cars");
  try {
    p.w.document.querySelector("[data-reserve]").click();
    await pause();
    assert.ok(p.w.document.getElementById("reserve-dialog").open);
    assert.equal(
      p.w.document.getElementById("reserve-drive").getAttribute("href"),
      "/drive?car=" + car.id,
    );
    assert.equal(
      JSON.parse(p.w.localStorage.getItem("drive.selectedCar")).id,
      car.id,
    );
  } finally {
    p.close();
  }
});

test("active trip offers a ride in the mini-game with the same car", async () => {
  const p = await screen("trips", { current: rental });
  try {
    const link = p.w.document.querySelector("#active-trip a.drive-cta");
    assert.ok(link, "active trip panel has no mini-game link");
    assert.equal(link.getAttribute("href"), "/drive?car=" + car.id);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
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
    query: "?car=1",
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
      /вашей аренды/,
    );
    g.start();
    g.step(1 / 60);
    g.hud(1 / 60);
    assert.equal(g.state.world.car.rateKopecks, 900);
    assert.equal(g.state.world.stats.rentalCost, 900);
    assert.equal(g.state.world.player.cash, 4100);
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

test("selecting another catalog car changes skin, handling and tariff without using another rental", async () => {
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
    query: "?car=4",
    current: rental,
    chosenCar: bmw,
    storedCar: { ...car, id: 4, rate_kopecks: 100 },
  });
  try {
    const g = p.w.DriveGame;
    assert.equal(g.state.car.id, 4);
    assert.equal(g.state.car.rate_kopecks, 2200);
    assert.equal(p.w.previewSkin, "bmw");
    g.start();
    g.step(1 / 60);
    assert.equal(g.state.world.car.skin, "bmw");
    assert.equal(g.state.world.cls.maxSpeed, 204);
    assert.equal(g.state.world.stats.rentalCost, 2200);
    assert.ok(
      p.requests.every(
        (r) =>
          !r.route.startsWith("/api/rentals/") ||
          r.route === "/api/rentals/current",
      ),
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("a missing selected car cannot silently start a different car", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?car=1234",
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
  const p = await screen("drive", { game: true, query: "?car=1", current: rental });
  try {
    const d = p.w.document;
    const g = p.w.DriveGame;
    g.start();
    g.step(1 / 60);
    g.hud(1 / 60);
    assert.equal(d.getElementById("hud-level").textContent, "1");
    assert.equal(d.getElementById("hud-raid").hidden, true, "облава раньше времени");
    assert.match(d.getElementById("hud-clock").textContent, /мин/);
    const world = g.state.world;
    world.time = 150;
    g.step(1 / 60);
    g.hud(1 / 60);
    assert.ok(Number(d.getElementById("hud-level").textContent) >= 7, "уровень растёт");
    assert.equal(d.getElementById("hud-raid").hidden, false, "полоса облавы появилась");
    assert.match(d.getElementById("hud-raid-note").textContent, /\d|газ|держит|сидит/);
    assert.match(d.getElementById("hud-retire").textContent, /Забрать|Вернуть/);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("the run posts a score the leaderboard service accepts", async () => {
  const p = await screen("drive", { game: true, query: "?car=1", current: rental, role: "user" });
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
    const sent = p.requests.find((r) => r.route === "/api/game/scores");
    assert.ok(sent, "результат не отправлен");
    assert.equal(sent.options.method, "POST");
    const body = JSON.parse(sent.options.body);
    assert.equal(body.reason, "quit");
    assert.equal(body.score, world.result.score);
    assert.equal(body.car_id, 1);
    assert.ok(body.duration_seconds >= 10, "слишком короткий заезд");
    assert.ok(
      body.level <= Math.min(30, 1 + Math.floor(body.duration_seconds / 22) + 2),
      "уровень не соответствует длительности",
    );
    assert.ok(body.score <= body.duration_seconds * 9000, "очки кажутся накрученными");
    assert.ok(body.knockdowns <= body.duration_seconds * 12, "сбитые кажутся накрученными");
    assert.match(p.w.document.getElementById("result-rank").textContent, /#2/);
  } finally {
    p.close();
  }
});

test("a short run is politely refused instead of faked to the server", async () => {
  const p = await screen("drive", { game: true, query: "?car=1", current: rental, role: "user" });
  try {
    const g = p.w.DriveGame;
    g.start();
    const world = g.state.world;
    world.time = 4;
    world.player.score = 900;
    p.w.GameCore.finish(world, "quit");
    await g.publishScore(world.result);
    assert.ok(
      !p.requests.some((r) => r.route === "/api/game/scores"),
      "короткий заезд не должен уходить на сервер",
    );
    assert.match(p.w.document.getElementById("result-rank").textContent, /короче 10/);
  } finally {
    p.close();
  }
});

test("the leaderboard renders, escapes names and follows the filters", async () => {
  const p = await screen("drive", { game: true, query: "?car=1", current: rental, role: "user" });
  try {
    const board = p.w.document.getElementById("board-intro");
    for (let i = 0; i < 4; i++) await pause();
    assert.equal(board.hidden, false);
    assert.match(board.textContent, /Таблица заезда/);
    assert.equal(board.querySelectorAll("img").length, 0, "имя игрока экранировано");
    assert.equal(board.querySelectorAll("[onerror]").length, 0, "no live markup from names");
    assert.match(board.textContent, /BMW 320i/);
    assert.match(board.textContent, /2[\s\u00a0]100[\s\u00a0]000|2100000/);
    assert.match(board.textContent, /Ты:/);
    board.querySelector("[data-period=all]").click();
    for (let i = 0; i < 4; i++) await pause();
    assert.ok(p.requests.some((r) => r.url.includes("period=all")), "фильтр периода не сработал");
    board.querySelector('[data-category="business"]').click();
    for (let i = 0; i < 4; i++) await pause();
    assert.ok(
      p.requests.some((r) => r.url.includes("category=business")),
      "фильтр класса не сработал",
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("guests see the board but the run is not written", async () => {
  const p = await screen("drive", { game: true, query: "?car=1", role: "guest" });
  try {
    const board = p.w.document.getElementById("board-intro");
    for (let i = 0; i < 4; i++) await pause();
    assert.match(board.textContent, /Войди в аккаунт/);
    const g = p.w.DriveGame;
    g.start();
    const world = g.state.world;
    world.time = 120;
    world.player.score = 200000;
    p.w.GameCore.finish(world, "wrecked");
    await g.publishScore(world.result);
    await pause();
    assert.match(p.w.document.getElementById("result-rank").textContent, /Войди|место/i);
  } finally {
    p.close();
  }
});

test("the result screen shows the win or loss clip and the grade ladder", async () => {
  const p = await screen("drive", {
    game: true,
    query: "?car=1",
    current: rental,
    role: "user",
  });
  try {
    const d = p.w.document;
    const g = p.w.DriveGame;
    g.start();
    const world = g.state.world;
    world.time = 300;
    world.player.score = 2000000;
    world.player.cash = 900000;
    world.stats.cashEarned = 1000000;
    p.w.GameCore.finish(world, "quit");
    g.showResult("quit");
    await pause();
    const gif = d.getElementById("result-gif");
    assert.equal(gif.getAttribute("src"), "/static/images/smoking.gif");
    assert.match(d.getElementById("result-grade").textContent, /^S$/);
    assert.match(
      d.getElementById("result-score").textContent,
      /^[\d\s\u00a0]+ очков/,
      "очки отдельной строкой",
    );
    assert.match(d.getElementById("result-meta").textContent, /уровень \d+ из 30/);
    assert.doesNotMatch(d.getElementById("result-score").textContent, /уровень/);
    assert.equal(d.querySelectorAll("#result-stars .off").length, 0);
    world.result.won = false;
    world.result.stars = 1;
    world.result.grade = "B";
    world.result.reason = "wrecked";
    g.state.mode = "playing";
    g.showResult("wrecked");
    assert.equal(gif.getAttribute("src"), "/static/images/fuk.gif");
    assert.match(d.getElementById("result-stats").textContent, /Облава/);
    await pause();
    await pause();
  } finally {
    p.close();
  }
});

test("music and effects have their own saved volume knobs", async () => {
  const p = await screen("drive", { game: true, query: "?car=1", current: rental });
  try {
    const d = p.w.document;
    const panel = d.getElementById("drive-volume-panel");
    const button = d.getElementById("drive-volume");
    assert.equal(panel.hidden, true, "панель спрятана до нажатия");
    const musicCalls = () =>
      p.audioCalls.filter((call) => call[0] === "setVolume" && call[1][0] === "music");
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
      p.audioCalls.filter((call) => call[0] === "setVolume" && call[1][0] === "sfx").pop()[1][1],
      0,
    );
    assert.deepEqual({ ...p.w.DriveGame.state.volume }, { music: 0.6, sfx: 0 });
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("touch actions fire once, capture a drag and suppress text selection menus", async () => {
  const p = await screen("drive", { game: true, role: "guest", query: "?car=1" });
  try {
    const g = p.w.DriveGame;
    g.start();
    for (const [id, prop, action] of [["touch-nitro", "touchNitro", "nitro"], ["touch-bribe", "touchBribe", "bribe"]]) {
      const button = p.w.document.getElementById(id);
      const captured = [];
      button.setPointerCapture = (pointerId) => captured.push(pointerId);
      const down = new p.w.Event("pointerdown", { bubbles: true, cancelable: true });
      Object.defineProperty(down, "pointerId", { value: 7 });
      assert.equal(button.dispatchEvent(down), false);
      assert.deepEqual(captured, [7]);
      assert.equal(g.state[prop], true);
      assert.equal(g.input()[action], true);
      assert.equal(g.input()[action], false, "held button must not repeat an action");
      button.dispatchEvent(new p.w.Event("pointercancel"));
      assert.equal(g.state[prop], false);
      for (const type of ["contextmenu", "selectstart", "dragstart"])
        assert.equal(button.dispatchEvent(new p.w.Event(type, { cancelable: true })), false);
    }
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});
