const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const target = process.argv[2] || "http://127.0.0.1:8011";
// This verifier creates test accounts and rentals: run only against an isolated local DB.
assert.match(target, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
fs.mkdirSync("tmp", { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const tag = Date.now();
    for (const [name, width, height, mobile] of [
      ["desktop", 1440, 1000, false],
      ["phone", 390, 844, true],
      ["small-phone", 320, 568, true],
      ["landscape", 844, 390, true],
    ]) {
      const context = await browser.newContext({
        baseURL: target,
        viewport: { width, height },
        isMobile: mobile,
        hasTouch: mobile,
      });
      const email = `ui-${tag}-${name}@example.com`,
        password = "Local-test-password-123";
      assert.equal(
        (
          await context.request.post("/api/auth/register", {
            data: { name: `UI ${name}`, email, password },
          })
        ).status(),
        201,
      );
      assert.equal(
        (
          await context.request.post("/api/auth/token", {
            form: { username: email, password },
          })
        ).status(),
        200,
      );
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/cars");
      await page.locator('[data-reserve="1"]').click();
      assert.equal(await page.locator("[data-drive]").count(), 0);
      await page.locator("#reserve-form button.primary").click();
      await page.waitForURL(/\/drive\?rental=\d+$/);
      await page.waitForFunction(
        () => window.DriveGame?.state.mode === "playing",
      );
      await page.waitForFunction(() => DriveGame.state.world.time > 2);
      const rental = await page.evaluate(() => DriveGame.state.rental.id);
      const cashWidths = await page.evaluate(() => {
        const world = DriveGame.state.world;
        const original = world.player.cash;
        const widths = [500000, 10000000, 99999999].map((cash) => {
          world.player.cash = cash;
          DriveGame.hud(0);
          const el = document.querySelector("#hud-cash");
          return { cash, width: el.clientWidth, content: el.scrollWidth };
        });
        world.player.cash = original;
        DriveGame.hud(0);
        return widths;
      });
      assert.ok(
        cashWidths.every((size) => size.content <= size.width),
        JSON.stringify(cashWidths),
      );
      const measurements = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };
        const g = DriveGame;
        g.togglePause(true);
        document.querySelector("#drive-pause").hidden = true;
        const ids = [
          ".hud-row-2",
          ".hud-actions",
          ".hud-nitro",
          "#hud-heat",
          "#hud-hearts",
        ];
        g.state.world.player.combo = 1;
        g.hud(0);
        const before = ids.map(box);
        g.state.world.player.combo = 2;
        g.hud(0);
        const after = ids.map(box);
        return {
          stage: box("#drive-stage"),
          before,
          after,
          viewport: { width: innerWidth, height: innerHeight },
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          selection: getComputedStyle(document.querySelector("#touch-nitro"))
            .userSelect,
          controls: ["#touch-bribe", "#touch-nitro"].map(box),
          visibleText: document.body.innerText,
        };
      });
      assert.ok(measurements.stage.width >= width - 1);
      assert.ok(measurements.stage.height >= height - 1);
      assert.ok(
        measurements.scrollWidth <= width &&
          measurements.scrollHeight <= height + 1,
      );
      assert.deepEqual(
        measurements.before,
        measurements.after,
        "combo moves HUD",
      );
      assert.doesNotMatch(
        measurements.visibleText,
        /Заезд бесконечный|Вымышленная сатира|Таблица заезда/,
      );
      assert.ok(measurements.visibleText.length < 350, "HUD has too much text");
      if (mobile) {
        for (const b of measurements.controls) {
          assert.equal(b.width, 76);
          assert.equal(b.height, 44);
          assert.ok(b.bottom <= height);
        }
        assert.equal(measurements.selection, "none");
      }
      await page.screenshot({ path: `tmp/rental-game-${name}.png` });
      // Refresh continues the same trip with the same damage and time.
      await page.evaluate(() => {
        DriveGame.state.world.player.hearts = 3;
        DriveGame.togglePause();
        DriveGame.togglePause(true);
      });
      const savedTime = await page.evaluate(() => DriveGame.state.world.time);
      await page.reload();
      await page.waitForFunction(
        () => window.DriveGame?.state.mode === "playing",
      );
      assert.equal(
        await page.evaluate(() => DriveGame.state.rental.id),
        rental,
      );
      assert.equal(
        await page.evaluate(() => DriveGame.state.world.player.hearts),
        3,
      );
      assert.ok(
        await page.evaluate((t) => DriveGame.state.world.time >= t, savedTime),
      );
      if (name === "desktop") {
        await page.evaluate(() => {
          DriveGame.state.world.player.invuln = 100;
        });
        await page.waitForFunction(
          () => DriveGame.state.world.time >= 11,
          {},
          { timeout: 20000 },
        );
        await page.evaluate(() => {
          DriveGame.state.world.player.score = 1000;
        });
      }
      await page.locator("#touch-pause").click();
      await page.locator("#quit").click();
      await page.waitForFunction(
        () => DriveGame.state.rental.status === "completed",
      );
      assert.equal(await page.locator("#result-stats li").count(), 3);
      assert.equal(
        await page.locator("#result-receipt").getAttribute("href"),
        `/api/rentals/${rental}/receipt`,
      );
      const current = await (
        await context.request.get("/api/rentals/current")
      ).json();
      assert.equal(current, null);
      const stored = await (
        await context.request.get(`/api/rentals/${rental}`)
      ).json();
      assert.equal(stored.status, "completed");
      assert.equal(stored.game_result.rental_id, rental);
      assert.ok(stored.total_kopecks > 0);
      const clock = stored.game_result;
      assert.equal(clock.time_scale, 40);
      assert.equal(
        clock.trip_duration_seconds,
        (clock.duration_ms * 40) / 1000,
      );
      assert.equal(
        stored.total_kopecks,
        Math.max(1, Math.ceil((clock.duration_ms * 40) / 60000)) *
          stored.rate_kopecks,
      );
      const local = await page.evaluate(() => DriveGame.state.world.result);
      assert.equal(local.rentalCost, stored.total_kopecks);
      assert.equal(local.distanceMeters, clock.distance_meters);
      assert.match(await page.locator("#result-meta").innerText(), /мин.*км/);
      const receipt = await (
        await context.request.get(`/api/rentals/${rental}/receipt`)
      ).text();
      assert.ok(
        receipt.includes("Пробег") && receipt.includes("пауза не оплачивается"),
      );
      assert.equal(
        (await (await context.request.get("/api/cars/1")).json()).status,
        "available",
      );
      assert.ok(
        await page
          .locator(".overlay-card.result")
          .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        "result actions require scrolling",
      );
      await page.screenshot({ path: `tmp/rental-result-${name}.png` });
      await page.goto("/trips");
      await page.waitForSelector(".trip");
      assert.match(await page.locator("#rentals").innerText(), /очков/);
      await page.goto(`/drive?rental=${rental}`);
      await page.waitForFunction(() => DriveGame.state.mode === "result");
      await page.goto("/leaderboard");
      await page.waitForSelector(".leader-table");
      assert.match(
        await page.locator("#leader-content").innerText(),
        /UI desktop/,
      );
      assert.ok(
        await page
          .locator("#leader-content")
          .evaluate((el) => el.scrollWidth <= innerWidth),
      );
      await page.locator('[data-period="all"]').click();
      await page.waitForFunction(
        () => !document.querySelector('[aria-busy="true"]'),
      );
      await page.screenshot({ path: `tmp/rental-leaderboard-${name}.png` });
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          name,
          rental,
          stage: measurements.stage,
          visibleText: measurements.visibleText.length,
          score: stored.game_result.score,
          total: stored.total_kopecks,
          errors,
        }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
