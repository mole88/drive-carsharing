const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const target = process.argv[2] || "http://127.0.0.1:8011";
assert.match(target, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext({
      baseURL: target,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage(),
      errors = [],
      loaded = new Set();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (/images\/sprites\/(vehicles|drones|cash|items)\//.test(r.url())) {
        if (r.status() !== 200) errors.push(`${r.status()} ${r.url()}`);
        loaded.add(new URL(r.url()).pathname);
      }
    });
    await page.goto("/static/images/sprites/preview.html");
    await page.waitForFunction(
      () =>
        [...document.images].length === 13 &&
        [...document.images].every((i) => i.complete && i.naturalWidth),
    );
    await page.waitForFunction(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((e) => e.name.includes("cash/rub-") && e.name.includes("?v="))
          .length === 6,
    );
    const transparency = await page.evaluate(() =>
      [...document.images].map((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
        return { name: image.alt, alpha };
      }),
    );
    assert.ok(
      transparency.every((image) => image.alpha === 0),
      JSON.stringify(transparency),
    );
    await page.screenshot({
      path: "tmp/object-sprites-gallery.png",
      fullPage: true,
    });
    assert.ok(loaded.size >= 13);
    const email = `sprites-${Date.now()}@example.com`,
      password = "Local-test-password-123";
    assert.equal(
      (
        await context.request.post("/api/auth/register", {
          data: { name: "Sprite QA", email, password },
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
    await page.goto("/cars");
    await page.locator("[data-reserve]:enabled").first().click();
    await page.locator("#reserve-form button.primary").click();
    await page.waitForURL(/\/drive\?rental=\d+$/);
    await page.waitForFunction(
      () =>
        window.DriveGame?.state.mode === "playing" &&
        DriveGame.state.world.time > 1,
    );
    await page.evaluate(() => {
      const g = DriveGame,
        w = g.state.world;
      g.togglePause(true);
      document.querySelector("#drive-pause").hidden = true;
      w.targets = [];
      w.props = [];
      w.fx = [];
      w.cops = [
        { x: 570, y: 660, width: 110, height: 170, alpha: 1, mode: "pursue" },
      ];
      w.drones = [
        {
          x: 280,
          y: 470,
          state: "lock",
          rotor: 15,
          alpha: 1,
          lockX: 380,
          lockTime: 1,
        },
      ];
      w.pickups = [100, 200, 500, 1000, 2000, 5000].map((v, i) => ({
        kind: "cash",
        value: v * 100,
        x: 220 + (i % 3) * 200,
        y: 300 + Math.floor(i / 3) * 90,
        life: 8,
        bob: i,
      }));
      g.render(0);
    });
    await page.waitForFunction(() =>
      performance
        .getEntriesByType("resource")
        .some((e) => e.name.includes("drones/mavic.webp")),
    );
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["phone", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => DriveGame.render(0));
      await page.waitForTimeout(200);
      await page.evaluate(() => DriveGame.render(0));
      await page.screenshot({ path: `tmp/game-sprites-${name}.png` });
    }
    await page.evaluate(() => DriveGame.quitShift());
    await page.waitForFunction(
      () => DriveGame.state.rental.status === "completed",
    );
    assert.deepEqual(errors, []);
    console.log(
      "13 transparent assets and live rental renderer verified on desktop and phone",
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
