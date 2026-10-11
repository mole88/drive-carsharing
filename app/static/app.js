const $ = (id) => document.getElementById(id);
const screen = document.body.dataset.page;
const protectedScreen = [
  "trips",
  "support",
  "profile",
  "admin",
  "admin-fleet",
].includes(screen);
function goLogin() {
  location.assign(
    "/login?next=" + encodeURIComponent(location.pathname + location.search),
  );
}
function loginDestination() {
  const next = new URLSearchParams(location.search).get("next");
  return [
    "/cars",
    "/trips",
    "/profile",
    "/support",
    "/admin",
    "/admin/fleet",
  ].includes(next)
    ? next
    : "/cars";
}
for (const link of document.querySelectorAll("nav a"))
  if (new URL(link.href).pathname === location.pathname)
    link.setAttribute("aria-current", "page");
sessionStorage.removeItem("token");
let user = null,
  accountInitialized = false,
  registration = false,
  finishId = null;
const labels = {
  available: "Доступен",
  reserved: "Забронирован",
  rented: "В поездке",
  maintenance: "На обслуживании",
  active: "В поездке",
  completed: "Завершена",
  cancelled: "Отменена",
  economy: "Эконом",
  comfort: "Комфорт",
  business: "Бизнес",
};
const money = (value) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(
    value / 100,
  );
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
let messageTimer;
function message(text) {
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => ($("message").hidden = true), 7000);
  $("message").textContent = text;
  $("message").hidden = false;
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch("/api" + path, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(options.body && !(options.body instanceof URLSearchParams)
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      options.method && options.method !== "GET"
        ? "Ответ не получен. Обновите данные перед повтором: действие могло сохраниться."
        : "Не удалось связаться с сервером. Проверьте соединение и повторите попытку.",
    );
  }
  const data = await response
    .json()
    .catch(() => ({
      detail: "Сервис временно недоступен. Попробуйте ещё раз.",
    }));
  if (response.status === 401 && user) {
    clearAccount();
    message("Сессия завершена. Войдите снова");
  }
  if (!response.ok) {
    const error = new Error(
      Array.isArray(data.detail)
        ? data.detail.map((e) => e.msg).join("; ")
        : data.detail || "Ошибка запроса",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
let refreshSequence = 0,
  currentTrips = [],
  currentCars = [],
  activeRental = null,
  historyPage = 0,
  selectedCar = null,
  activeReceivedAt = 0,
  activeMarkupKey = "";
function rememberCar(car) {
  if (!car) return;
  try {
    localStorage.setItem("drive.selectedCar", JSON.stringify(car));
  } catch (error) {
    void error;
  }
}
function driveHref(carId) {
  return "/drive?car=" + carId;
}
async function refresh() {
  const sequence = ++refreshSequence;
  if ($("cars")) {
    const params = new URLSearchParams({
      category: $("category").value,
      search: $("search").value,
      sort: $("sort").value,
      available: $("available").checked,
      limit: 100,
    });
    $("cars").setAttribute("aria-busy", "true");
    let cars;
    try {
      cars = await api("/cars?" + params);
    } catch (e) {
      if (sequence === refreshSequence) {
        $("cars").setAttribute("aria-busy", "false");
        $("catalog-error").hidden = false;
        $("catalog-error-text").textContent = e.message;
      }
      throw e;
    }
    $("catalog-error").hidden = true;
    if (sequence !== refreshSequence) return;
    currentCars = cars;
    $("cars").setAttribute("aria-busy", "false");
    $("result-count").textContent = cars.length
      ? `Найдено автомобилей: ${cars.length}`
      : "Ничего не найдено. Попробуйте изменить фильтры.";
    $("cars").innerHTML =
      cars
  .map(
    (c) =>
      `<article class="card">
        <span class="badge">${labels[c.category]} · ${
          c.fuel < 10 && c.status === "available"
            ? "Ожидает заправки"
            : labels[c.status]
        }</span>

        <div class="car-image">
          ${
            c.image
              ? `<img src="/static/${escape(c.image)}" alt="${escape(
                  c.brand + " " + c.model,
                )}">`
              : carIllustration(c.category)
          }
        </div>

        <h3>${escape(c.brand)} ${escape(c.model)}</h3>
        <p>${escape(c.plate)} · Топливо ${c.fuel}%</p>
        <p>${escape(c.address)}</p>

        <div class="price">
          ${money(c.rate_kopecks)} <small>/ мин</small>
        </div>

        <button
          class="primary"
          ${screen === "admin-fleet" ? "hidden" : ""}
          data-reserve="${c.id}"
          ${c.status !== "available" || c.fuel < 10 ? "disabled" : ""}
        >
          ${user ? "Забронировать" : "Войти и забронировать"}
        </button>

        ${
          screen === "admin-fleet"
            ? ""
            : `<button class="drive-cta" data-drive="${c.id}">Ночная смена · мини-игра</button>`
        }

        ${
          screen === "admin-fleet" &&
          user?.is_admin &&
          ["available", "maintenance"].includes(c.status)
            ? `<button data-edit-car="${c.id}">Редактировать</button>
               <button data-service="${c.id}" data-status="${
                 c.status === "available" ? "maintenance" : "available"
               }">${
                 c.status === "available"
                   ? "На обслуживание"
                   : "Вернуть в автопарк"
               }</button>`
            : ""
        }
      </article>`,
  )
        .join("") || "<p>В этом классе пока нет автомобилей.</p>";
  }
  if (user && $("rentals")) {
    const [trips, summary, active] = await Promise.all([
      api("/rentals?limit=10&offset=" + historyPage * 10),
      api("/rentals/summary"),
      api("/rentals/current"),
    ]);
    if (sequence !== refreshSequence) return;
    currentTrips = trips;
    activeRental = active;
    activeReceivedAt = performance.now();
    $("history-pages").hidden = false;
    $("history-prev").disabled = historyPage === 0;
    $("history-next").disabled = trips.length < 10;
    $("history-page").textContent = "Страница " + (historyPage + 1);
    renderActive();

    $("trip-summary").hidden = false;
    $("trip-summary").innerHTML =
      `<div><strong>${summary.completed_count}</strong><span>Завершённых поездок</span></div><div><strong>${money(summary.total_kopecks)}</strong><span>Стоимость всех поездок</span></div>`;
    $("rentals").innerHTML =
      trips
        .map(
          (r) =>
            `<article class="trip"><div><strong>${escape(r.car_name)} · ${escape(r.plate)}</strong><p>№${r.id} · ${new Date(r.created_at).toLocaleString("ru-RU")}<br>${labels[r.status]} · ${money(r.rate_kopecks)}/мин${r.status === "completed" ? " · Итого " + money(r.total_kopecks) : ""}</p></div><div class="actions">${r.status === "reserved" ? `<button class="primary" data-action="start" data-id="${r.id}">Начать поездку</button><button data-action="cancel" data-id="${r.id}">Отменить бронь</button>` : ""}${r.status === "completed" ? `<a class="receipt-link" href="/api/rentals/${r.id}/receipt" target="_blank" rel="noopener">Итоги поездки ↗</a>` : ""}${r.status === "active" ? `<button class="primary" data-action="finish" data-id="${r.id}">Завершить</button>` : ""}</div></article>`,
        )
        .join("") || "<p>Пока нет поездок. Выберите автомобиль в каталоге.</p>";
  }
}
async function loadUser() {
  try {
    user = await api("/auth/me");
  } catch (error) {
    user = null;
    if (error.status !== 401) {
      message(error.message);
      return;
    }
  }
  if (protectedScreen && !user) {
    goLogin();
    return;
  }
  if (screen === "login" && user) {
    location.replace(loginDestination());
    return;
  }
  $("logout").hidden = !user;
  $("login-link").hidden = !!user;
  $("profile-link").hidden = !user;
  $("admin-link").hidden = !user?.is_admin;
  if ($("profile")) {
    $("profile").hidden = !user;
    if (user) {
      $("profile-email").textContent = user.email;
      $("profile-form").elements.name.value = user.name;
    }
  }
  if ($("admin")) $("admin").hidden = !user?.is_admin;
  if ($("greeting")) $("greeting").textContent = "Мои поездки";
  await refresh();
  accountInitialized = true;
  document.dispatchEvent(new Event("account-change"));
}
if ($("toggle-auth"))
  $("toggle-auth").onclick = () => {
    registration = !registration;
    $("name-label").hidden = !registration;
    document.querySelector("[name=name]").required = registration;
    $("submit-auth").textContent = registration
      ? "Зарегистрироваться"
      : "Войти";
    $("toggle-auth").textContent = registration
      ? "Уже есть аккаунт"
      : "Создать аккаунт";
  };
if ($("auth-form"))
  $("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target,
      b = $("submit-auth"),
      status = form.querySelector(".form-status");
    b.disabled = true;
    status.textContent = "Входим…";
    const data = Object.fromEntries(new FormData(form));
    try {
      if (registration)
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify(data),
        });
      await api("/auth/token", {
        method: "POST",
        body: new URLSearchParams({
          username: data.email,
          password: data.password,
        }),
      });
      location.assign(loginDestination());
    } catch (e) {
      status.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
if ($("logout"))
  $("logout").onclick = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      location.assign("/");
    } catch (e) {
      message(e.message);
    }
  };
for (const id of ["category", "sort", "available"])
  if ($(id)) $(id).onchange = () => refresh().catch((e) => message(e.message));
let searchTimer;
if ($("search"))
  $("search").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(
      () => refresh().catch((e) => message(e.message)),
      300,
    );
  };
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.drive) {
      rememberCar(currentCars.find((c) => c.id === Number(b.dataset.drive)));
      location.assign(driveHref(b.dataset.drive));
      return;
    }
    if (b.dataset.reserve) {
      if (!user) {
        goLogin();
        return;
      }
      selectedCar = currentCars.find((c) => c.id === Number(b.dataset.reserve));
      if (!selectedCar) return;
      $("reserve-title").textContent =
        selectedCar.brand + " " + selectedCar.model;
      $("reserve-address").textContent =
        selectedCar.plate + " · " + selectedCar.address;
      $("reserve-rate").textContent =
        money(selectedCar.rate_kopecks) + " / мин";
      rememberCar(selectedCar);
      if ($("reserve-drive")) $("reserve-drive").href = driveHref(selectedCar.id);
      $("reserve-form").querySelector(".form-status").textContent = "";
      $("reserve-dialog").showModal();
    }
    if (b.dataset.action) {
      if (b.dataset.action === "finish") {
        finishId = b.dataset.id;
        const trip =
          activeRental || currentTrips.find((r) => r.id === Number(finishId));
        if (trip) $("finish-form").elements.address.value = trip.address;
        $("finish-form").querySelector(".form-status").textContent = "";
        $("finish-dialog").showModal();
        return;
      }
      b.disabled = true;
      await api(`/rentals/${b.dataset.id}/${b.dataset.action}`, {
        method: "POST",
      });
      await refresh();
      message(
        b.dataset.action === "start"
          ? "Поездка началась. Идёт расчёт стоимости."
          : "Бронь отменена",
      );
    }
    if (b.dataset.service) {
      b.disabled = true;
      await api(
        `/cars/${b.dataset.service}/status?status=${b.dataset.status}`,
        { method: "PATCH" },
      );
      await refresh();
    }
  } catch (e) {
    message(e.message);
  } finally {
    b.disabled = false;
  }
});
if ($("finish-form"))
  $("finish-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target,
      button = form.querySelector("button"),
      status = form.querySelector(".form-status");
    button.disabled = true;
    status.textContent = "Завершаем поездку…";
    const data = Object.fromEntries(new FormData(form));
    data.fuel = Number(data.fuel);
    try {
      const result = await api(`/rentals/${finishId}/finish`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      $("finish-dialog").close();
      historyPage = 0;
      await refresh();
      message("Поездка завершена. Стоимость: " + money(result.total_kopecks));
    } catch (e) {
      status.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
if ($("close-dialog"))
  $("close-dialog").onclick = () => $("finish-dialog").close();
if ($("car-form"))
  $("car-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.rate_kopecks = Number(data.rate_kopecks);
    try {
      await api("/cars", { method: "POST", body: JSON.stringify(data) });
      e.target.reset();
      await refresh();
      message("Автомобиль добавлен");
    } catch (e) {
      message(e.message);
    }
  };

function carIllustration(category) {
  const color =
    { economy: "#9db3a7", comfort: "#adb9d3", business: "#c4ba9f" }[category] ||
    "#9db3a7";
  return `<svg viewBox="0 0 480 220" role="presentation"><ellipse cx="244" cy="187" rx="189" ry="14" fill="#17312e" opacity=".08"/><path d="M51 156L77 111L151 98L203 53L322 53L378 105L422 125L430 166H48Z" fill="${color}"/><path d="M171 99L211 63H313L349 101Z" fill="#29423e"/><path d="M268 63V100" stroke="${color}" stroke-width="8"/><path d="M61 134H89M394 132H417" stroke="#f9ffda" stroke-width="8"/><path d="M175 133H326" stroke="#17312e" stroke-opacity=".2" stroke-width="3"/><circle cx="125" cy="165" r="31" fill="#243631"/><circle cx="125" cy="165" r="15" fill="#ccd4cf"/><circle cx="362" cy="165" r="31" fill="#243631"/><circle cx="362" cy="165" r="15" fill="#ccd4cf"/></svg>`;
}
function renderActive() {
  if (!$("active-trip")) return;
  const trip = activeRental;
  $("active-trip").hidden = !trip;
  if (!trip) {
    activeMarkupKey = "";
    return;
  }
  const reserved = trip.status === "reserved";
  const key = trip.id + ":" + trip.status;
  if (activeMarkupKey !== key) {
    activeMarkupKey = key;
    $("active-trip").innerHTML =
      `<div><p class="eyebrow">${reserved ? "ВАША БРОНЬ" : "ПОЕЗДКА ИДЁТ"}</p><h2>${escape(trip.car_name)}</h2><p>${escape(trip.plate)} · ${escape(trip.address)}</p><p id="live-price"></p><div class="actions">${reserved ? `<button class="primary" data-action="start" data-id="${trip.id}">Начать поездку</button><button data-action="cancel" data-id="${trip.id}">Отменить бронь</button>` : `<button class="primary" data-action="finish" data-id="${trip.id}">Завершить</button>`}<a class="drive-cta" href="${driveHref(trip.car_id)}">Ночная смена · мини-игра</a></div></div><div class="timer"><strong id="live-time"></strong><span>${reserved ? "осталось до отмены" : "в пути"}</span></div>`;
  }
  const now =
    Date.parse(trip.server_now) + (performance.now() - activeReceivedAt);
  const seconds = reserved
    ? Math.max(0, Math.ceil((Date.parse(trip.expires_at) - now) / 1000))
    : Math.max(0, Math.floor((now - Date.parse(trip.started_at)) / 1000));
  $("live-time").textContent = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  $("live-price").textContent = reserved
    ? seconds
      ? "Бронь бесплатна"
      : "Бронь истекла. Обновляем состояние…"
    : money(
        Math.max(1, Math.ceil((now - Date.parse(trip.started_at)) / 60000)) *
          trip.rate_kopecks,
      ) + " · текущая стоимость";
}
setInterval(renderActive, 1000);
setInterval(() => {
  if (!document.hidden && !document.querySelector("dialog[open]"))
    refresh().catch(() => {});
}, 30000);
loadUser().catch((e) => message(e.message));

function clearAccount() {
  user = null;
  currentTrips = [];
  activeRental = null;
  activeMarkupKey = "";
  historyPage = 0;
  refreshSequence++;
  for (const dialog of document.querySelectorAll("dialog[open]"))
    dialog.close();
  for (const id of [
    "profile",
    "admin",
    "active-trip",
    "trip-summary",
    "logout",
    "history-pages",
    "profile-link",
    "admin-link",
  ])
    if ($(id)) $(id).hidden = true;
  $("login-link").hidden = false;
  document.dispatchEvent(new Event("account-change"));
  if (protectedScreen) goLogin();
}
for (const [id, path] of [
  ["profile-form", "/auth/me"],
  ["password-form", "/auth/password"],
]) {
  if (!$(id)) continue;
  $(id).onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector("button");
    const status = form.querySelector(".form-status");
    button.disabled = true;
    status.textContent = "Сохраняем…";
    try {
      const result = await api(path, {
        method: id === "profile-form" ? "PATCH" : "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      if (id === "profile-form") {
        user = result;
        status.textContent = "Имя сохранено";
      } else {
        form.reset();
        clearAccount();
        message(result.detail);
        goLogin();
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

if ($("reserve-close"))
  $("reserve-close").onclick = () => $("reserve-dialog").close();
if ($("reserve-form"))
  $("reserve-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!selectedCar) return;
    const form = e.target,
      button = form.querySelector("button"),
      status = form.querySelector(".form-status");
    button.disabled = true;
    status.textContent = "Бронируем…";
    try {
      await api("/rentals", {
        method: "POST",
        body: JSON.stringify({
          car_id: selectedCar.id,
          expected_rate_kopecks: selectedCar.rate_kopecks,
        }),
      });
      $("reserve-dialog").close();
      historyPage = 0;
      await refresh();
      location.assign("/trips");
    } catch (e) {
      status.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
for (const [id, delta] of [
  ["history-prev", -1],
  ["history-next", 1],
])
  if ($(id))
    $(id).onclick = async () => {
      const old = historyPage;
      historyPage = Math.max(0, historyPage + delta);
      try {
        await refresh();
      } catch (e) {
        historyPage = old;
        message(e.message);
      }
    };

if ($("catalog-retry"))
  $("catalog-retry").onclick = () => refresh().catch((e) => message(e.message));
window.addEventListener("offline", () => {
  message("Нет соединения. Данные могут быть устаревшими.");
});
window.addEventListener("online", () => {
  refresh()
    .then(() => message("Соединение восстановлено"))
    .catch((e) => message(e.message));
});
