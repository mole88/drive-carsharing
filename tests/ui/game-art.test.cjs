const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function renderer({
  loading = false,
  objectLoading = false,
  noImage = false,
} = {}) {
  const images = [];
  class Image {
    constructor() {
      images.push(this);
    }
    set src(value) {
      this.url = value;
      const atlas = value.includes("-walk.webp");
      this.complete =
        !(atlas && loading) &&
        !(!atlas && objectLoading && value.endsWith(".webp?v=assets"));
      const portrait = value.includes("/nightlife/") && !atlas;
      this.naturalWidth = this.complete ? (atlas || portrait ? 1024 : 384) : 0;
      this.naturalHeight = this.complete
        ? atlas
          ? 768
          : portrait
            ? 1536
            : value.includes("/cash/")
              ? 150
              : 512
        : 0;
    }
  }
  const global = {
    Image: noImage ? undefined : Image,
    URL,
    document: {
      currentScript: {
        src: "https://game.test/demo/static/game-art.js?v=assets",
      },
    },
  };
  vm.runInNewContext(fs.readFileSync("app/static/game-art.js", "utf8"), global);
  const draws = [],
    scales = [],
    stack = [],
    texts = [],
    rotations = [];
  const ctx = new Proxy(
    {
      globalAlpha: 1,
      save() {
        stack.push(this.globalAlpha);
      },
      restore() {
        this.globalAlpha = stack.pop();
      },
      scale(...args) {
        scales.push(args);
      },
      drawImage(...args) {
        draws.push({ args, alpha: this.globalAlpha });
      },
      fillText(...args) {
        texts.push(args);
      },
      measureText(text) {
        return { width: text.length * 4 };
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
      rotate(value) {
        rotations.push(value);
      },
    },
    { get: (object, key) => (key in object ? object[key] : () => {}) },
  );
  const target = (overrides = {}) =>
    global.GameArt.target(
      ctx,
      {
        x: 100,
        y: 200,
        hue: 0,
        dir: 1,
        stride: 0,
        speed: 70,
        state: "walking",
        alpha: 1,
        scale: 1,
        spin: 0,
        ...overrides,
      },
      { scale: 1, time: 0 },
    );
  return {
    target,
    images,
    draws,
    scales,
    stack,
    texts,
    rotations,
    art: global.GameArt,
    ctx,
  };
}

test("a full gait uses eight distinct cells, including the second atlas row", () => {
  const r = renderer();
  for (let frame = 0; frame < 8; frame++)
    r.target({ stride: (frame * Math.PI) / 4 + 0.001 });
  const cells = new Set();
  for (const { args } of r.draws) {
    const [image, x, y, width, height] = args;
    assert.equal(args.length, 9, "draw only one frame, not the entire sheet");
    assert.ok(
      x >= 0 &&
        y >= 0 &&
        x + width <= image.naturalWidth &&
        y + height <= image.naturalHeight,
    );
    cells.add(`${x},${y}`);
  }
  assert.equal(cells.size, 8);
  assert.ok(r.draws.some(({ args }) => args[2] > 0));
  r.target({ stride: Math.PI * 2 });
  assert.deepEqual(
    r.draws.at(-1).args.slice(1, 5),
    r.draws[0].args.slice(1, 5),
    "cycle joins its beginning",
  );
  assert.equal(r.stack.length, 0, "canvas state is balanced");
});

test("every character has a local optimized atlas and mirrors toward its direction", () => {
  const r = renderer();
  for (const props of [{ hue: 0 }, { hue: 120 }, { hue: 240 }, { vip: true }])
    r.target({ ...props, dir: -1 });
  const files = r.draws.map(({ args }) =>
    new URL(args[0].url).pathname.split("/").at(-1),
  );
  assert.equal(new Set(files).size, 4);
  for (const file of files) {
    assert.ok(fs.existsSync("app/static/images/sprites/nightlife/" + file));
    assert.ok(file.endsWith("-walk.webp"));
  }
  assert.ok(r.scales.filter(([x, y]) => x === -1 && y === 1).length === 4);
  for (const image of r.images) {
    assert.ok(
      image.url.startsWith(
        "https://game.test/demo/static/images/sprites/nightlife/",
      ),
    );
    assert.equal(new URL(image.url).search, "?v=assets");
  }
  assert.equal(
    r.images.length,
    4,
    "original portraits are not eagerly downloaded",
  );
});

test("flight and stopped movement hold a contact pose and preserve fading", () => {
  const r = renderer();
  r.target({ state: "launched", stride: 5, alpha: 0 });
  r.target({ speed: 0, stride: 5 });
  for (const { args } of r.draws) assert.deepEqual(args.slice(1, 3), [0, 0]);
  assert.equal(r.draws[0].alpha, 0, "invisible flight must stay invisible");
  assert.equal(r.draws[1].alpha, 1);
});

test("negative stride stays inside the atlas and planted feet keep the same baseline", () => {
  const r = renderer();
  for (let frame = 0; frame < 8; frame++)
    r.target({ stride: (frame * Math.PI) / 4 - Math.PI * 4 + 0.001 });
  for (const { args } of r.draws) {
    assert.ok(args[1] >= 0 && args[2] >= 0);
    assert.equal(args[8], 132, "gait frames do not change sprite size");
    assert.ok(
      args[6] + args[8] >= 56 && args[6] + args[8] < 64,
      "no large foot-baseline jump",
    );
  }
});

test("loading uses the procedural fallback; a failed atlas loads its original PNG", () => {
  const r = renderer({ loading: true });
  r.target();
  assert.equal(r.draws.length, 0);
  r.images[0].onerror();
  r.target();
  assert.ok(r.draws[0].args[0].url.includes("blonde-pink.png"));
  assert.equal(r.draws[0].args[3], 1024);
  assert.equal(r.draws[0].args[4], 1536);
  assert.equal(r.stack.length, 0);
});

const car = {
  x: 100,
  y: 200,
  width: 103,
  height: 157,
  color: "#eee",
  plate: "А123ВС34",
};
const drone = {
  x: 300,
  y: 100,
  state: "lock",
  rotor: 10,
  spin: 2,
  alpha: 0.4,
  scale: 0.9,
};

test("car models load on demand with the rental plate and effects intact", () => {
  const r = renderer();
  assert.equal(r.images.length, 4);
  for (const skin of ["rio", "solaris", "octavia", "bmw"]) {
    r.art.playerCar(r.ctx, {
      ...car,
      skin,
      nitro: true,
      shield: true,
      tilt: 0.15,
    });
    assert.ok(
      r.draws.at(-1).args[0].url.endsWith(`/vehicles/${skin}.webp?v=assets`),
    );
    assert.ok(fs.existsSync(`app/static/images/sprites/vehicles/${skin}.webp`));
    assert.equal(r.texts.at(-1)[0], car.plate);
  }
  const count = r.images.length;
  r.art.playerCar(r.ctx, { ...car, skin: "economy" });
  assert.equal(r.images.length, count, "the same model reuses its image");
  assert.ok(r.rotations.includes(0.15));
  assert.equal(r.stack.length, 0);
  assert.equal(r.ctx.globalAlpha, 1);
});

test("police and drone keep fading, rotation and scale; crashed rotors stop", () => {
  const r = renderer();
  r.art.policeCar(
    r.ctx,
    { ...car, alpha: 0.3, spin: 1, flash: 0.1 },
    { scale: 0.8, time: 2, beam: true },
  );
  assert.equal(r.draws.at(-1).alpha, 0.3);
  assert.ok(r.draws.at(-1).args[0].url.includes("vehicles/police.webp"));
  assert.ok(r.rotations.includes(1));
  r.art.drone(r.ctx, drone, { scale: 0.8 });
  assert.equal(r.draws.at(-1).alpha, 0.4);
  assert.ok(r.draws.at(-1).args[0].url.includes("drones/mavic.webp"));
  assert.ok(r.scales.some(([x]) => Math.abs(x - 0.72) < 0.0001));
  const turns = r.rotations.length;
  r.art.drone(r.ctx, { ...drone, state: "crash", alpha: 0 }, {});
  assert.equal(r.rotations.length, turns + 1, "only the crashed body rotates");
  assert.equal(r.draws.at(-1).alpha, 0);
  assert.equal(r.stack.length, 0);
  assert.equal(r.ctx.globalAlpha, 1);
});

test("all six ruble notes match their kopeck value and preserve pickup fading", () => {
  const r = renderer();
  for (const note of [100, 200, 500, 1000, 2000, 5000]) {
    const pickup = {
      kind: "cash",
      value: note * 100,
      x: 200,
      y: 300,
      bob: 1,
      life: 0.5,
    };
    const before = { ...pickup };
    r.art.pickup(r.ctx, pickup, {});
    assert.deepEqual(pickup, before);
    assert.ok(
      r.draws.at(-1).args[0].url.endsWith(`/cash/rub-${note}.webp?v=assets`),
    );
    assert.equal(r.draws.at(-1).alpha, 0.5);
    assert.ok(fs.existsSync(`app/static/images/sprites/cash/rub-${note}.webp`));
  }
  assert.equal(r.stack.length, 0);
  assert.ok(fs.existsSync("app/static/images/sprites/items/jagermeister.webp"));
  assert.ok(
    r.images.every((image) => !image.url.includes("jagermeister")),
    "future bottle is not downloaded",
  );
});

test("object loading has a procedural fallback and a single PNG retry", () => {
  const r = renderer({ objectLoading: true });
  r.art.playerCar(r.ctx, car);
  r.art.policeCar(r.ctx, car, {});
  r.art.drone(r.ctx, drone, {});
  r.art.pickup(r.ctx, { kind: "cash", value: 10000, x: 0, y: 0, life: 5 }, {});
  assert.equal(r.draws.length, 0);
  const image = r.images.find((image) =>
    image.url.includes("vehicles/octavia"),
  );
  image.onerror();
  assert.equal(image.onerror, null);
  assert.ok(image.url.endsWith("vehicles/octavia.png?v=assets"));
  r.art.playerCar(r.ctx, car);
  assert.equal(r.draws.length, 1);
  assert.equal(r.stack.length, 0);
  const headless = renderer({ noImage: true });
  headless.art.playerCar(headless.ctx, car);
  headless.art.drone(headless.ctx, drone, {});
  assert.equal(headless.draws.length, 0);
  assert.equal(headless.stack.length, 0);
});
