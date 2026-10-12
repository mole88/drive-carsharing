// Support and operations UI. All dynamic text is escaped before rendering.
const ticketLabels = {
  open: "Новое",
  answered: "Есть ответ",
  closed: "Закрыто",
};
const auditLabels = {
  "car.created": "Добавление автомобиля",
  "car.updated": "Изменение автомобиля",
  "car.maintenance": "Передача на обслуживание",
  "car.available": "Возврат в автопарк",
  "support.answered": "Ответ на обращение",
  "support.closed": "Закрытие обращения",
  "rental.force_closed": "Завершение зависшей поездки",
};
const pages = { support: 0, inbox: 0, rentals: 0, audit: 0 };
let editCarId = null,
  operationsEpoch = 0;
function ticketCard(t, admin = false) {
  return `<article class="ticket"><div class="section-head"><h3>№${t.id} · ${escape(t.subject)}</h3><span class="badge">${ticketLabels[t.status]}</span></div><p>${new Date(t.created_at).toLocaleString("ru-RU")}${t.rental_id ? " · Поездка №" + t.rental_id : ""}</p><p class="multiline">${escape(t.message)}</p>${t.reply ? `<div class="ticket-reply"><strong>Ответ поддержки</strong><p class="multiline">${escape(t.reply)}</p></div>` : ""}${admin ? `<form data-ticket-reply="${t.id}"><label>Ответ<textarea name="reply" rows="3" required minlength="3" maxlength="4000">${escape(t.reply)}</textarea></label><label>Статус<select name="status"><option value="answered">С ответом</option><option value="closed">Закрыто</option></select></label><button class="primary">Сохранить ответ</button><p class="form-status" role="status"></p></form>` : ""}</article>`;
}
function pageButtons(prefix, page, count) {
  $(prefix + "-prev").disabled = page === 0;
  $(prefix + "-next").disabled = count < 20;
}
async function supportList() {
  const epoch = operationsEpoch;
  const rows = await api("/support?limit=20&offset=" + pages.support * 20);
  if (epoch !== operationsEpoch) return;
  $("support-list").innerHTML =
    rows.map((t) => ticketCard(t)).join("") || "<p>Пока нет обращений.</p>";
  pageButtons("support", pages.support, rows.length);
}
async function inboxList() {
  const epoch = operationsEpoch;
  const status = $("ticket-status").value;
  const rows = await api(
    "/admin/support?limit=20&offset=" +
      pages.inbox * 20 +
      (status ? "&status=" + status : ""),
  );
  if (epoch !== operationsEpoch) return;
  $("admin-tickets").innerHTML =
    rows.map((t) => ticketCard(t, true)).join("") ||
    "<p>Обращений с таким статусом нет.</p>";
  pageButtons("inbox", pages.inbox, rows.length);
}
async function adminRentals() {
  const epoch = operationsEpoch;
  const rows = await api(
    "/admin/rentals?limit=20&offset=" +
      pages.rentals * 20 +
      "&search=" +
      encodeURIComponent($("admin-rentals-search").value),
  );
  if (epoch !== operationsEpoch) return;
  $("admin-rentals").innerHTML =
    rows
      .map((r) => {
        const stale =
          r.status === "active" &&
          r.closeable_at &&
          new Date(r.closeable_at) <= new Date(r.server_now);
        return `<article class="trip"><div><strong>№${r.id} · ${escape(r.car_name)} · ${escape(r.plate)}</strong><p>${labels[r.status]} · ${new Date(r.created_at).toLocaleString("ru-RU")} · ${money(r.total_kopecks)}</p></div><div class="actions">${stale ? `<button data-close-rental="${r.id}">Завершить зависшую</button>` : ""}</div></article>`;
      })
      .join("") || "<p>Поездки не найдены.</p>";
  pageButtons("admin-rentals", pages.rentals, rows.length);
}
async function auditList() {
  const epoch = operationsEpoch;
  const rows = await api("/admin/audit?limit=20&offset=" + pages.audit * 20);
  if (epoch !== operationsEpoch) return;
  $("audit-list").innerHTML =
    rows
      .map(
        (r) =>
          `<article class="trip"><div><strong>${escape(auditLabels[r.action] || r.action)}</strong><p>${escape(r.actor)} · ${escape(r.target)} · ${new Date(r.created_at).toLocaleString("ru-RU")}</p></div></article>`,
      )
      .join("") || "<p>Пока нет действий.</p>";
  pageButtons("audit", pages.audit, rows.length);
}
async function adminSummary() {
  const epoch = operationsEpoch;
  const s = await api("/admin/summary");
  if (epoch !== operationsEpoch) return;
  $("admin-summary").innerHTML = [
    [s.cars, "Автомобилей"],
    [s.active_rentals, "Поездок сейчас"],
    [s.open_tickets, "Новых обращений"],
    [money(s.completed_kopecks), "Стоимость завершённых поездок"],
  ]
    .map(
      ([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`,
    )
    .join("");
}
function initializeOperations() {
  operationsEpoch++;
  for (const key in pages) pages[key] = 0;
  if ($("support-section")) $("support-section").hidden = !user;
  if ($("operations")) $("operations").hidden = !user?.is_admin;
  if (!user) {
    for (const id of [
      "support-list",
      "admin-tickets",
      "admin-summary",
      "admin-rentals",
      "audit-list",
    ])
      if ($(id)) $(id).replaceChildren();
    return;
  }
  if ($("support-list")) supportList().catch((e) => message(e.message));
  if (user.is_admin && $("operations"))
    Promise.all([
      inboxList(),
      adminSummary(),
      adminRentals(),
      auditList(),
    ]).catch((e) => message(e.message));
}
document.addEventListener("account-change", initializeOperations);
if (accountInitialized) initializeOperations();
if ($("support-form"))
  $("support-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const b = form.querySelector("button"),
      status = form.querySelector(".form-status");
    b.disabled = true;
    status.textContent = "Отправляем…";
    const data = Object.fromEntries(new FormData(form));
    data.rental_id = data.rental_id ? Number(data.rental_id) : null;
    try {
      await api("/support", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      status.textContent = "Обращение отправлено. Ответ появится здесь.";
      pages.support = 0;
      await supportList();
    } catch (e) {
      status.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
if ($("admin-tickets"))
  $("admin-tickets").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target,
      b = form.querySelector("button"),
      status = form.querySelector(".form-status");
    b.disabled = true;
    try {
      await api("/admin/support/" + form.dataset.ticketReply, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      await Promise.all([inboxList(), adminSummary(), auditList()]);
      message("Ответ сохранён");
    } catch (e) {
      status.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  });
for (const [prefix, key, load] of [
  ["support", "support", supportList],
  ["inbox", "inbox", inboxList],
  ["admin-rentals", "rentals", adminRentals],
  ["audit", "audit", auditList],
])
  for (const [direction, delta] of [
    ["prev", -1],
    ["next", 1],
  ])
    if ($(prefix + "-" + direction))
      $(prefix + "-" + direction).onclick = async () => {
        const before = pages[key];
        pages[key] = Math.max(0, before + delta);
        try {
          await load();
        } catch (e) {
          pages[key] = before;
          message(e.message);
        }
      };
if ($("support-refresh"))
  $("support-refresh").onclick = () =>
    supportList().catch((e) => message(e.message));
if ($("audit-refresh"))
  $("audit-refresh").onclick = () =>
    auditList().catch((e) => message(e.message));
if ($("ticket-status"))
  $("ticket-status").onchange = () => {
    pages.inbox = 0;
    inboxList().catch((e) => message(e.message));
  };
if ($("admin-rentals-form"))
  $("admin-rentals-form").onsubmit = (e) => {
    e.preventDefault();
    pages.rentals = 0;
    adminRentals().catch((e) => message(e.message));
  };
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-edit-car]");
  if (!b) return;
  const car = currentCars.find((c) => c.id === Number(b.dataset.editCar));
  if (!car) return;
  editCarId = car.id;
  for (const field of [
    "brand",
    "model",
    "plate",
    "category",
    "address",
    "fuel",
    "rate_kopecks",
  ])
    $("edit-car-form").elements[field].value = car[field];
  $("edit-car-form").querySelector(".form-status").textContent = "";
  $("edit-car-dialog").showModal();
});
if ($("edit-car-close"))
  $("edit-car-close").onclick = () => $("edit-car-dialog").close();

/* Зависшую поездку закрывает админ: сервер пускает только спустя 90 минут */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-close-rental]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("/admin/rentals/" + b.dataset.closeRental + "/close", {
      method: "POST",
    });
    await adminRentals();
    message(
      "Поездка №" + b.dataset.closeRental + " закрыта, машина в автопарке",
    );
  } catch (error) {
    message(error.message);
    b.disabled = false;
  }
});

if ($("edit-car-form"))
  $("edit-car-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target,
      b = form.querySelector("button"),
      status = form.querySelector(".form-status");
    b.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    data.fuel = Number(data.fuel);
    data.rate_kopecks = Number(data.rate_kopecks);
    try {
      await api("/admin/cars/" + editCarId, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      $("edit-car-dialog").close();
      await refresh();
      message("Автомобиль обновлён");
    } catch (e) {
      status.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
