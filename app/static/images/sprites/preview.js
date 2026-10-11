const ctx = document.querySelector("canvas").getContext("2d");
function frame(ms) {
  const t = ms / 1000;
  ctx.clearRect(0, 0, 1200, 360);
  ctx.fillStyle = "#2c393d";
  ctx.fillRect(0, 0, 1200, 360);
  ctx.setLineDash([26, 22]);
  ctx.strokeStyle = "#b7b9a0";
  ctx.lineWidth = 2;
  for (let x = 200; x < 1200; x += 200) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 360);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ["rio", "solaris", "octavia", "bmw"].forEach((skin, i) =>
    GameArt.playerCar(ctx, {
      skin,
      x: 100 + i * 200,
      y: 165,
      width: 105,
      height: 166,
      color: "#cee",
      plate: "А123ВС34",
      time: t,
      nitro: i === 3,
      shield: i === 2,
      tilt: Math.sin(t) * 0.025,
    }),
  );
  GameArt.policeCar(
    ctx,
    { x: 900, y: 165, width: 110, height: 170, alpha: 1 },
    { time: t, beam: true },
  );
  GameArt.drone(
    ctx,
    { x: 1100, y: 140, state: "lock", rotor: t * 32, alpha: 1 },
    { time: t, scale: 1 },
  );
  [100, 200, 500, 1000, 2000, 5000].forEach((v, i) =>
    GameArt.pickup(
      ctx,
      {
        kind: "cash",
        value: v * 100,
        x: 100 + i * 200,
        y: 315,
        life: 10,
        bob: t + i,
      },
      {},
    ),
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
