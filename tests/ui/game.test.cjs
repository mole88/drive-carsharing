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
    requests.push({ url, route });
    let data;
    if (route === "/api/auth/me") data = user || { detail: "Sign in" };
    else if (route === "/api/cars") data = [car];
    else if (route.startsWith("/api/cars/")) data = options.chosenCar || car;
    else if (route === "/api/rentals/summary")
      data = { completed_count: 0, total_kopecks: 0 };
    else if (route === "/api/rentals/current") data = options.current || null;
    else if (route === "/api/rentals") data = options.rentals || [];
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
      { get: (_, name) => (name === "setMuted" ? (value) => value : () => {}) },
    );
    vm.runInContext(
      read("app/static/game-core.js"),
      dom.getInternalVMContext(),
    );
    vm.runInContext(read("app/static/game.js"), dom.getInternalVMContext());
  }
  await pause();
  return { w, requests, errors, close: () => dom.window.close() };
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
      "hud-time",
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
      "drive-difficulty",
      "drive-sound",
      "drive-calm",
      "result-grade",
      "result-stats",
      "result-stars",
      "touch-bribe",
      "touch-nitro",
      "drive-coach",
    ])
      assert.ok(d.getElementById(id), "missing #" + id);
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
