(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("leader-content")) return;
  const params = new URLSearchParams(location.search);
  const state = {
    period: params.get("period") === "all" ? "all" : "week",
    category: params.get("category") || "",
    page: Math.max(0, Math.floor((Number(params.get("offset")) || 0) / 20)),
    sequence: 0,
  };
  if (!["", "economy", "comfort", "business"].includes(state.category))
    state.category = "";
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const number = (value) => Number(value).toLocaleString("ru-RU");
  async function load() {
    const sequence = ++state.sequence;
    const query = new URLSearchParams({
      period: state.period,
      limit: 20,
      offset: state.page * 20,
    });
    if (state.category) query.set("category", state.category);
    history.replaceState(null, "", "/leaderboard?" + query.toString());
    $("leader-category").value = state.category;
    for (const button of document.querySelectorAll("[data-period]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.period === state.period),
      );
    $("leader-content").setAttribute("aria-busy", "true");
    $("leader-prev").disabled = $("leader-next").disabled = true;
    try {
      const response = await fetch("/api/game/leaderboard?" + query, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Рейтинг недоступен");
      const board = await response.json();
      if (sequence !== state.sequence) return;
      $("leader-personal").hidden = !board.me;
      if (board.me)
        $("leader-personal").innerHTML =
          `<div><span>Место</span><strong>${board.me.rank ? "#" + number(board.me.rank) : "—"}</strong></div><div><span>Ваш рекорд</span><strong>${number(board.me.score)}</strong></div><div><span>Поездки</span><strong>${number(board.me.plays)}</strong></div>`;
      $("leader-content").innerHTML = board.rows.length
        ? `<div class="leader-table-wrap"><table class="leader-table"><thead><tr><th scope="col">#</th><th scope="col">Водитель</th><th scope="col">Очки</th></tr></thead><tbody>${board.rows.map((row) => `<tr class="${row.is_me ? "me" : ""}"><td>${row.rank}</td><td><strong>${escape(row.name)}</strong><small>${escape(row.car_name)}${row.is_me && row.rental_id ? ` · <a href="/api/rentals/${Number(row.rental_id)}/receipt">Поездка ↗</a>` : ""}</small></td><td><strong>${number(row.score)}</strong><small>${number(row.duration_seconds)} с · ур. ${number(row.level)}</small></td></tr>`).join("")}</tbody></table></div>`
        : '<p class="leader-empty">Пока нет результатов.</p>';
      $("leader-page").textContent =
        `${state.page + 1} · ${number(board.totals.players)} игроков`;
      $("leader-prev").disabled = state.page === 0;
      $("leader-next").disabled = (state.page + 1) * 20 >= board.totals.players;
    } catch (error) {
      if (sequence !== state.sequence) return;
      $("leader-content").innerHTML =
        '<p class="leader-empty">Не удалось загрузить рейтинг.</p><button id="leader-retry" type="button">Повторить</button>';
      $("leader-personal").hidden = true;
      $("leader-prev").disabled = state.page === 0;
    } finally {
      if (sequence === state.sequence)
        $("leader-content").setAttribute("aria-busy", "false");
    }
  }
  document.addEventListener("click", (event) => {
    const period = event.target.closest("[data-period]");
    if (period) {
      state.period = period.dataset.period;
      state.page = 0;
      load();
    }
    if (event.target.closest("#leader-retry")) load();
  });
  $("leader-category").addEventListener("change", () => {
    state.category = $("leader-category").value;
    state.page = 0;
    load();
  });
  $("leader-prev").onclick = () => {
    if (state.page) {
      state.page--;
      load();
    }
  };
  $("leader-next").onclick = () => {
    state.page++;
    load();
  };
  load();
})();
