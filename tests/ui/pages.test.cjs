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
const staleRental = {
  id: 77,
  car_id: 1,
  status: "active",
  rate_kopecks: 900,
  total_kopecks: 0,
  car_name: "Kia Rio",
  plate: "TEST123",
  address: "Test parking",
  created_at: "2026-01-01T00:00:00Z",
  started_at: "2026-01-01T00:00:00Z",
  finished_at: null,
  expires_at: "2026-01-01T00:20:00Z",
  closeable_at: "2026-01-01T01:30:00Z",
  server_now: "2026-01-01T05:00:00Z",
  estimated_kopecks: 900,
  pickup_address: "Test parking",
  finish_address: null,
  game_result: null,
};
async function screen(name, role = "user", query = "", active = null) {
  const user =
    role === "guest"
      ? null
      : {
          id: 1,
          name: "Driver",
          email: "driver@example.com",
          is_admin: role === "admin",
        };
  const requests = [],
    errors = [];
  /* Открытая поездка живёт в переменной: клик «Вернуть машину» обязан погасить
     баннер так же, как это делает настоящий /rentals/current после закрытия. */
  let open = active;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  let html = read("app/templates/base.html");
  for (const [key, value] of Object.entries({
    page: name,
    title: name,
    content: read(`app/templates/${name}.html`),
    subnav: "",
    styles: "",
    scripts: "",
    asset_version: "test-version",
  }))
    html = html.replaceAll(`{{${key}}}`, value);
  const path =
    name === "home"
      ? "/"
      : name === "admin-fleet"
        ? "/admin/fleet"
        : "/" + name;
  const dom = new JSDOM(html, {
    url: "http://localhost" + path + query,
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
  w.addEventListener("error", (e) => errors.push(e.message));
  w.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    requests.push({ url, method, body: options.body });
    let status = 200,
      data;
    const route = url.split("?")[0];
    if (route === "/api/auth/me") {
      if (!user) {
        status = 401;
        data = { detail: "Sign in" };
      } else {
        if (method === "PATCH") user.name = JSON.parse(options.body).name;
        data = user;
      }
    } else if (route === "/api/cars") data = [car];
    else if (route === "/api/rentals/summary")
      data = { completed_count: 0, total_kopecks: 0 };
    else if (route === "/api/rentals/current") data = open;
    else if (route === `/api/rentals/${active?.id}/return`) {
      open = null;
      data = {
        ...active,
        status: "completed",
        total_kopecks: 900,
        closeable_at: null,
      };
    } else if (route === "/api/rentals" && method === "GET")
      data = open ? [open] : [];
    else if (route === "/api/admin/summary")
      data = {
        cars: 1,
        active_rentals: 0,
        open_tickets: 0,
        completed_kopecks: 0,
      };
    else if (route === "/api/admin/rentals")
      data =
        method === "POST"
          ? {
              ...staleRental,
              status: "completed",
              total_kopecks: 900,
              closeable_at: null,
            }
          : [staleRental];
    else if (
      [
        "/api/rentals",
        "/api/support",
        "/api/admin/support",
        "/api/admin/audit",
      ].includes(route)
    )
      data = method === "POST" ? { id: 1 } : [];
    else if (route === "/api/admin/cars/1") data = car;
    else throw new Error("Unexpected request: " + url);
    return { ok: status < 400, status, json: async () => data };
  };
  vm.runInContext(read("app/static/app.js"), dom.getInternalVMContext());
  if (["support", "admin", "admin-fleet"].includes(name))
    vm.runInContext(
      read("app/static/operations.js"),
      dom.getInternalVMContext(),
    );
  await pause();
  return { w, requests, errors, close: () => dom.window.close() };
}

for (const [name, role] of [
  ["home", "guest"],
  ["home", "user"],
  ["cars", "guest"],
  ["cars", "user"],
  ["trips", "user"],
  ["profile", "user"],
  ["support", "user"],
  ["admin", "admin"],
  ["admin-fleet", "admin"],
  ["how-it-works", "guest"],
  ["login", "guest"],
]) {
  test(`page ${name} initializes for ${role} without missing-element errors`, async () => {
    const page = await screen(name, role);
    try {
      assert.deepEqual(page.errors, []);
      assert.equal(page.w.document.getElementById("message").hidden, true);
      const ids = [...page.w.document.querySelectorAll("[id]")].map(
        (e) => e.id,
      );
      assert.equal(ids.length, new Set(ids).size, "duplicate IDs");
      assert.equal(page.w.document.querySelectorAll("h1").length, 1);
      if (name !== "cars" && name !== "admin-fleet")
        assert(!page.requests.some((r) => r.url.startsWith("/api/cars")));
      if (name === "cars") {
        assert.equal(page.w.document.querySelectorAll(".card").length, 1);
        const photo = page.w.document.querySelector(".card .car-image img");
        assert.equal(photo.getAttribute("src"), "/static/images/kiario.png");
        assert.equal(photo.getAttribute("alt"), "Kia Rio");
      }
    } finally {
      page.close();
    }
  });
}

test("catalog opens reservation dialog without rendering account sections", async () => {
  const p = await screen("cars");
  try {
    p.w.document.querySelector("[data-reserve]").click();
    await pause();
    assert(p.w.document.getElementById("reserve-dialog").open);
    assert.equal(
      p.w.document.getElementById("reserve-title").textContent,
      "Kia Rio",
    );
    assert.equal(p.w.document.getElementById("profile"), null);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

/* Мёртвая точка, из-за которой человек с активной арендой не мог начать заезд:
   каталог показывал заглушенную «Поехать» на занятой машине и ни одной ссылки
   в игру. Выход обязан быть на той же странице, где пользователь остался. */
const liveRental = { ...staleRental, closeable_at: "2026-01-01T07:00:00Z" };
const reservationRental = {
  ...staleRental,
  status: "reserved",
  started_at: null,
  closeable_at: null,
};

test("каталог с активной поездкой ведёт в игру, а не в заглушку", async () => {
  const p = await screen("cars", "user", "", staleRental);
  try {
    const banner = p.w.document.getElementById("active-trip");
    assert.equal(banner.hidden, false, "баннер поездки на /cars обязателен");
    assert.match(banner.textContent, /Продолжить поездку/);
    const links = [
      ...p.w.document.querySelectorAll('a[href^="/drive?rental="]'),
    ];
    assert.equal(links.length, 2, "баннер и карточка ведут в один заезд");
    assert.equal(links[0].getAttribute("href"), "/drive?rental=77");
    const card = p.w.document.querySelector(".card");
    assert.equal(
      card.querySelector("button[data-reserve]"),
      null,
      "своя машина не имеет права быть мёртвой кнопкой",
    );
    assert.match(card.querySelector(".badge").textContent, /Ваша поездка/);
    assert.ok(
      card.querySelector('[data-return-rental="77"]') ||
        banner.querySelector('[data-return-rental="77"]'),
      "зависшую поездку владелец сдаёт сам",
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("свежую поездку без игры не сдать", async () => {
  const p = await screen("cars", "user", "", liveRental);
  try {
    assert.equal(p.w.document.querySelector("[data-return-rental]"), null);
    assert.ok(p.w.document.querySelector('a[href="/drive?rental=77"]'));
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("броня на /cars начинается со страницы каталога", async () => {
  const p = await screen("cars", "user", "", reservationRental);
  try {
    const banner = p.w.document.getElementById("active-trip");
    assert.match(banner.textContent, /ВАША БРОНЬ/);
    assert.match(banner.textContent, /осталось до отмены/);
    const start = p.w.document.querySelector(
      '.card button[data-action="start"]',
    );
    assert.ok(start, "карточка забронированной машины даёт старт");
    assert.equal(start.textContent, "Начать поездку");
    assert.match(
      p.w.document.querySelector(".card .badge").textContent,
      /Ваша бронь/,
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("вторая бронь при открытой поездке объясняется на месте, а не 409", async () => {
  const p = await screen("cars", "user", "", {
    ...staleRental,
    car_id: 9,
    closeable_at: null,
  });
  try {
    const btn = p.w.document.querySelector("[data-reserve]");
    assert.equal(btn.disabled, false, "чужая машина остаётся доступной");
    btn.click();
    await pause();
    await pause();
    assert.equal(
      p.requests.filter((r) => r.url === "/api/rentals" && r.method === "POST")
        .length,
      0,
      "диалог, который сервер отклонит, открывать нельзя",
    );
    assert.equal(
      p.w.document.getElementById("reserve-dialog").hasAttribute("open"),
      false,
    );
    assert.match(
      p.w.document.getElementById("message").textContent,
      /ещё не возвращена/,
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("возврат зависшей поездки подтверждается вторым кликом", async () => {
  const p = await screen("cars", "user", "", staleRental);
  try {
    const btn = p.w.document.querySelector('[data-return-rental="77"]');
    assert.ok(btn);
    assert.match(btn.textContent, /Вернуть машину без игры/);
    assert.match(
      p.w.document.getElementById("active-trip").textContent,
      /одну минуту тарифа/,
      "цена решения называется до подтверждения",
    );
    btn.click();
    await pause();
    assert.equal(
      p.requests.some((r) => r.url === "/api/rentals/77/return"),
      false,
      "первый клик только вооружает кнопку",
    );
    assert.match(btn.textContent, /Подтвердите возврат/);
    btn.click();
    await pause();
    await pause();
    assert(
      p.requests.some(
        (r) => r.url === "/api/rentals/77/return" && r.method === "POST",
      ),
    );
    assert.equal(p.w.document.getElementById("active-trip").hidden, true);
    assert.match(
      p.w.document.getElementById("message").textContent,
      /Машина возвращена/,
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("profile saves name on its own page", async () => {
  const p = await screen("profile");
  try {
    const form = p.w.document.getElementById("profile-form");
    form.elements.name.value = "New Name";
    form.dispatchEvent(
      new p.w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    assert.equal(
      form.querySelector(".form-status").textContent,
      "Имя сохранено",
    );
    assert(p.requests.some((r) => r.method === "PATCH"));
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("support form posts and refreshes its list", async () => {
  const p = await screen("support");
  try {
    const form = p.w.document.getElementById("support-form");
    form.elements.subject.value = "Question";
    form.elements.message.value = "A detailed question";
    form.dispatchEvent(
      new p.w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    assert(
      p.requests.some((r) => r.url === "/api/support" && r.method === "POST"),
    );
    assert.match(form.querySelector(".form-status").textContent, /отправлено/);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("admin fleet editor loads and saves vehicle", async () => {
  const p = await screen("admin-fleet", "admin");
  try {
    p.w.document.querySelector("[data-edit-car]").click();
    const form = p.w.document.getElementById("edit-car-form");
    assert.equal(form.elements.brand.value, "Kia");
    form.dispatchEvent(
      new p.w.Event("submit", { bubbles: true, cancelable: true }),
    );
    await pause();
    assert(
      p.requests.some(
        (r) => r.url === "/api/admin/cars/1" && r.method === "PUT",
      ),
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("кабинет закрывает зависшую поездку", async () => {
  const p = await screen("admin", "admin");
  try {
    const d = p.w.document;
    const btn = d.querySelector("[data-close-rental]");
    assert.ok(btn, "для активной поездки старше порога появляется кнопка");
    assert.equal(btn.dataset.closeRental, "77");
    btn.click();
    await pause();
    assert(
      p.requests.some(
        (r) => r.url === "/api/admin/rentals/77/close" && r.method === "POST",
      ),
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test("login return path only accepts local allowed screens", async () => {
  for (const [next, expected] of [
    ["/trips", "/trips"],
    ["https://evil.example", "/cars"],
    ["//evil.example", "/cars"],
  ]) {
    const p = await screen(
      "login",
      "guest",
      "?next=" + encodeURIComponent(next),
    );
    try {
      assert.equal(p.w.eval("loginDestination()"), expected);
      p.w.document.getElementById("toggle-auth").click();
      assert.equal(p.w.document.getElementById("name-label").hidden, false);
    } finally {
      p.close();
    }
  }
});
