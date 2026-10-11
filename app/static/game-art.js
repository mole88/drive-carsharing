/* Мультяшная векторная отрисовка на canvas: без внешних картинок, всё рисуется кодом. */
(function (global) {
  "use strict";

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const INK = "#12241f";
  const PALETTE = {
    dusk: {
      sky: ["#2b3f52", "#5b4a63", "#c9705f"],
      block: "#22323f",
      lit: "#ffd98a",
      glow: "#ff9ec7",
      neon: ["#ff7ab8", "#7fd1ff", "#d5ff5f"],
      curb: "#3d4f4a",
    },
    night: {
      sky: ["#141d33", "#1e2b4a", "#33406b"],
      block: "#16203a",
      lit: "#ffe6a3",
      glow: "#8ea0ff",
      neon: ["#ff5ea8", "#54e0ff", "#c9ff5e"],
      curb: "#2c3b52",
    },
    neon: {
      sky: ["#0d1030", "#2a1250", "#5a1a5c"],
      block: "#120d33",
      lit: "#a5ffef",
      glow: "#ff4fd8",
      neon: ["#ff4fd8", "#4ff0ff", "#ffe14f"],
      curb: "#2a2150",
    },
  };

  const ctxLine = (ctx, w) => {
    ctx.lineWidth = w;
    ctx.strokeStyle = INK;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
  };

  const shadow = (ctx, x, y, rx, ry, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.28 : alpha;
    ctx.fillStyle = "#08120f";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const roundRect = (ctx, x, y, w, h, r) => {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  function star(ctx, x, y, r, points, inner) {
    const n = points || 5;
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const rad = i % 2 ? r * (inner || 0.45) : r;
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  /* Машина игрока: вид сзади-сверху, 3/4. */
  function playerCar(ctx, o) {
    const w = o.width,
      h = o.height,
      s = o.scale || 1;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.tilt || 0);
    ctx.scale(s, s);
    ctx.translate(0, o.bounce || 0);
    shadow(ctx, 0, h * 0.44, w * 0.52, h * 0.12, 0.3);

    if (o.nitro) {
      for (const sx of [-1, 1]) {
        const f = 1 + Math.sin((o.time || 0) * 42 + sx) * 0.3;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,157,61,.85)";
        ctx.beginPath();
        ctx.moveTo(sx * w * 0.22 - 9, h * 0.44);
        ctx.lineTo(sx * w * 0.22 + 9, h * 0.44);
        ctx.lineTo(sx * w * 0.22, h * 0.44 + 34 * f);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255,246,200,.95)";
        ctx.beginPath();
        ctx.moveTo(sx * w * 0.22 - 4, h * 0.44);
        ctx.lineTo(sx * w * 0.22 + 4, h * 0.44);
        ctx.lineTo(sx * w * 0.22, h * 0.44 + 17 * f);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    ctxLine(ctx, 6);
    ctx.fillStyle = "#1c2a26";
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * w * 0.5 - 13, -h * 0.24, 26, h * 0.52, 10);
      ctx.fill();
      ctx.stroke();
    }

    const body = ctx.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
    body.addColorStop(0, o.colorLight || o.color);
    body.addColorStop(0.55, o.color);
    body.addColorStop(1, o.colorDark || o.color);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-w * 0.46, h * 0.42);
    ctx.lineTo(-w * 0.5, -h * 0.02);
    ctx.quadraticCurveTo(-w * 0.46, -h * 0.3, -w * 0.26, -h * 0.36);
    ctx.lineTo(w * 0.26, -h * 0.36);
    ctx.quadraticCurveTo(w * 0.46, -h * 0.3, w * 0.5, -h * 0.02);
    ctx.lineTo(w * 0.46, h * 0.42);
    ctx.quadraticCurveTo(0, h * 0.52, -w * 0.46, h * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = o.colorDark || o.color;
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * w * 0.53 - 8, -h * 0.24, 16, 13, 5);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = o.colorDark || o.color;
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h * 0.35);
    ctx.lineTo(-w * 0.24, -h * 0.12);
    ctx.lineTo(w * 0.24, -h * 0.12);
    ctx.lineTo(w * 0.3, -h * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#1d3742";
    roundRect(ctx, -w * 0.26, -h * 0.14, w * 0.52, h * 0.16, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.22)";
    roundRect(ctx, -w * 0.22, -h * 0.12, w * 0.17, h * 0.05, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-w * 0.28, -h * 0.33);
    ctx.lineTo(w * 0.28, -h * 0.33);
    ctx.stroke();
    ctxLine(ctx, 6);
    ctx.fillStyle = "rgba(255,255,255,.16)";
    roundRect(ctx, -w * 0.22, h * 0.01, w * 0.2, h * 0.09, 6);
    ctx.fill();

    ctx.strokeStyle = o.pillar || "#c9d3c4";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, h * 0.02);
    ctx.lineTo(w * 0.1, h * 0.02);
    ctx.moveTo(0, h * 0.06);
    ctx.lineTo(0, h * 0.2);
    ctx.stroke();
    ctxLine(ctx, 6);

    for (const sx of [-1, 1]) {
      ctx.fillStyle = o.lights || "#ff5b5b";
      roundRect(ctx, sx * w * 0.38 - 18, h * 0.1, 36, 26, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.55)";
      roundRect(ctx, sx * w * 0.38 - 13, h * 0.14, 26, 7, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,220,120,.5)";
      roundRect(ctx, sx * w * 0.38 - 13, h * 0.25, 26, 5, 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(18,36,31,.26)";
    roundRect(ctx, -w * 0.44, h * 0.33, w * 0.88, h * 0.1, 8);
    ctx.fill();
    ctx.fillStyle = "#f6f8ef";
    roundRect(ctx, -w * 0.28, h * 0.25, w * 0.56, 24, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((o.plate || "ДРАЙВ").slice(0, 9), 0, h * 0.25 + 13);

    if (o.shield) {
      ctx.strokeStyle = "#7fe3d8";
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.75 + Math.sin((o.time || 0) * 6) * 0.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.66, h * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* Проститутка: мультяшный силуэт, вид спереди, без жестокости и без натурализма. */
  function target(ctx, t, o) {
    const s = (o.scale || 1) * (t.scale || 1);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.spin || 0);
    ctx.globalAlpha = t.alpha === undefined ? 1 : t.alpha;
    ctx.scale(s, s);
    if (t.state !== "launched") shadow(ctx, 0, 52, 26, 8, 0.25);
    ctxLine(ctx, 5);

    const swing = Math.sin(t.stride) * (t.state === "launched" ? 0.9 : 0.55);
    const coat = t.vip ? "#ffd85e" : `hsl(${t.hue} 62% 58%)`;
    const trim = t.vip ? "#fff3c4" : `hsl(${t.hue} 45% 78%)`;
    const skin = t.vip ? "#ffe1c4" : "#f3cbb0";

    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-6, 20);
    ctx.lineTo(-10 - swing * 8, 50);
    ctx.moveTo(6, 20);
    ctx.lineTo(10 + swing * 8, 50);
    ctx.stroke();
    ctx.fillStyle = t.vip ? "#8a5a1f" : "#20303c";
    for (const dx of [-10 - swing * 8, 10 + swing * 8]) {
      roundRect(ctx, dx - 6, 44, 12, 12, 5);
      ctx.fill();
    }

    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(-20, -12);
    ctx.quadraticCurveTo(-26, 22, -14, 30);
    ctx.lineTo(14, 30);
    ctx.quadraticCurveTo(26, 22, 20, -12);
    ctx.quadraticCurveTo(0, -22, -20, -12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = trim;
    roundRect(ctx, -13, -14, 26, 9, 4);
    ctx.fill();

    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    ctx.beginPath();
    const armUp = t.alarmed > 0 ? -26 - swing * 8 : 6 + swing * 6;
    ctx.moveTo(-16, -6);
    ctx.lineTo(-26, armUp);
    ctx.moveTo(16, -6);
    ctx.lineTo(26, armUp * 0.7);
    ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(-26, armUp - 4, 5, 0, Math.PI * 2);
    ctx.arc(26, armUp * 0.7 - 4, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = t.vip ? "#fff0b8" : "#f2f5ee";
    roundRect(ctx, 22, 4, 16, 14, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -30, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = t.wig === "bun" ? "#3b2536" : "#5d2f4a";
    ctx.beginPath();
    if (t.wig === "bun") {
      ctx.arc(0, -36, 14, Math.PI * 1.02, Math.PI * 1.98);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -52, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.moveTo(-16, -30);
      ctx.quadraticCurveTo(-20, -50, 0, -48);
      ctx.quadraticCurveTo(20, -50, 16, -30);
      ctx.quadraticCurveTo(12, -36, 0, -36);
      ctx.quadraticCurveTo(-12, -36, -16, -30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = INK;
    const eye = t.state === "launched" ? 0 : 2.4;
    if (t.state === "launched") {
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      for (const dx of [-6, 6]) {
        ctx.beginPath();
        ctx.moveTo(dx - 3, -33);
        ctx.lineTo(dx + 3, -27);
        ctx.moveTo(dx + 3, -33);
        ctx.lineTo(dx - 3, -27);
        ctx.stroke();
      }
    } else {
      for (const dx of [-6, 6]) {
        ctx.beginPath();
        ctx.ellipse(dx, -31, eye, eye * 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = "#d1436a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -24, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    if (t.vip) {
      ctx.fillStyle = "#ffe36b";
      ctxLine(ctx, 3);
      star(ctx, 0, -62, 11, 5);
      ctx.fill();
      ctx.stroke();
    }
    if (t.case) {
      ctx.fillStyle = "#e8dcc4";
      roundRect(ctx, -40, -6, 20, 14, 4);
      ctx.fill();
      ctx.stroke();
    }
    if (t.alarmed > 0 && t.state === "walking") {
      ctx.font = "700 26px system-ui, sans-serif";
      ctx.fillStyle = "#fff6d8";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.textAlign = "center";
      ctx.strokeText("?! ", 0, -72);
      ctx.fillText("?! ", 0, -72);
    }
    ctx.restore();
  }

  function policeCar(ctx, c, o) {
    const w = c.width,
      h = c.height;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.spin || 0);
    ctx.scale(o.scale || 1, o.scale || 1);
    ctx.globalAlpha = c.alpha === undefined ? 1 : c.alpha;
    shadow(ctx, 0, h * 0.44, w * 0.5, h * 0.11, 0.3);
    ctxLine(ctx, 6);

    ctx.fillStyle = "#1c2a26";
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * w * 0.5 - 13, -h * 0.2, 26, h * 0.5, 10);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#f2f6ee";
    ctx.beginPath();
    ctx.moveTo(-w * 0.44, h * 0.4);
    ctx.lineTo(-w * 0.48, -h * 0.1);
    ctx.quadraticCurveTo(-w * 0.42, -h * 0.34, -w * 0.2, -h * 0.38);
    ctx.lineTo(w * 0.2, -h * 0.38);
    ctx.quadraticCurveTo(w * 0.42, -h * 0.34, w * 0.48, -h * 0.1);
    ctx.lineTo(w * 0.44, h * 0.4);
    ctx.quadraticCurveTo(0, h * 0.5, -w * 0.44, h * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#2f6bd8";
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h * 0.34);
    ctx.lineTo(-w * 0.24, -h * 0.06);
    ctx.lineTo(w * 0.24, -h * 0.06);
    ctx.lineTo(w * 0.3, -h * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.25)";
    roundRect(ctx, -w * 0.22, -h * 0.3, w * 0.18, h * 0.1, 5);
    ctx.fill();

    ctx.fillStyle = "#2f6bd8";
    ctx.beginPath();
    ctx.moveTo(-w * 0.48, h * 0.02);
    ctx.lineTo(-w * 0.2, h * 0.02);
    ctx.lineTo(-w * 0.26, h * 0.24);
    ctx.lineTo(-w * 0.46, h * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.48, h * 0.02);
    ctx.lineTo(w * 0.2, h * 0.02);
    ctx.lineTo(w * 0.26, h * 0.24);
    ctx.lineTo(w * 0.46, h * 0.24);
    ctx.closePath();
    ctx.fill();

    const t = o.time || 0;
    const red = Math.sin(t * 12) > 0;
    ctx.fillStyle = "#dfe6dc";
    roundRect(ctx, -w * 0.16, -h * 0.52, w * 0.32, 14, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = red ? "#ff4444" : "#5b6b8c";
    roundRect(ctx, -w * 0.14, -h * 0.5, w * 0.13, 10, 4);
    ctx.fill();
    ctx.fillStyle = red ? "#6d7ea6" : "#4fa3ff";
    roundRect(ctx, w * 0.01, -h * 0.5, w * 0.13, 10, 4);
    ctx.fill();

    ctx.fillStyle = "#fff3c4";
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * w * 0.36 - 14, h * 0.24, 28, 16, 6);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#c8d2c6";
    roundRect(ctx, -w * 0.14, h * 0.26, w * 0.28, 14, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2f6bd8";
    ctx.font = "900 17px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ДПС", 0, h * 0.07);

    if (o.beam) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = red ? "#ff6a6a" : "#6ab7ff";
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, -h * 0.5);
      ctx.lineTo(-w * 1.5, -h * 1.5);
      ctx.lineTo(w * 1.5, -h * 1.5);
      ctx.lineTo(w * 0.2, -h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (c.flash > 0) {
      ctx.fillStyle = "#fff6d8";
      ctx.globalAlpha = c.flash * 2;
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drone(ctx, d, o) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate((d.spin || 0) * 0.25);
    const s = (o.scale || 1) * (d.scale || 1);
    ctx.scale(s, s);
    ctx.globalAlpha = d.alpha === undefined ? 1 : d.alpha;
    if (d.state !== "crash") shadow(ctx, 0, 78, 34, 9, 0.2);
    ctxLine(ctx, 5);

    const arm = 46;
    const base = d.alpha === undefined ? 1 : d.alpha;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(-arm, -11);
    ctx.lineTo(arm, 11);
    ctx.moveTo(-arm, 11);
    ctx.lineTo(arm, -11);
    ctx.stroke();

    for (const [px, py] of [
      [-arm, -11],
      [arm, -11],
      [-arm, 11],
      [arm, 11],
    ]) {
      ctx.fillStyle = "#2b3d49";
      ctx.beginPath();
      ctx.ellipse(px, py, 26, 7, Math.sin((d.rotor || 0) + px) * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = base * 0.55;
      ctx.fillStyle = "#9fd8ff";
      ctx.beginPath();
      ctx.ellipse(px, py, 27, 5, Math.cos((d.rotor || 0) + py) * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = base;
    }

    ctx.fillStyle = d.state === "dive" ? "#ff5b5b" : "#3a4f5c";
    roundRect(ctx, -24, -17, 48, 32, 11);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#12241f";
    ctx.beginPath();
    ctx.arc(0, 1, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = d.state === "lock" || d.state === "dive" ? "#ff4d4d" : "#7fe3d8";
    ctx.beginPath();
    ctx.arc(0, 1, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6f8ef";
    roundRect(ctx, -8, -26, 16, 10, 4);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = base * (Math.sin((d.rotor || 0) * 0.7) > 0 ? 1 : 0.25);
    ctx.fillStyle = "#ff4d4d";
    ctx.beginPath();
    ctx.arc(-arm, -20, 5, 0, Math.PI * 2);
    ctx.arc(arm, -20, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = base;
    ctx.restore();
  }

  function droneTarget(ctx, d, playerY, color) {
    const c = color || "#ff4d5e";
    const y0 = d.y + 24;
    const y1 = playerY;
    ctx.save();
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, "rgba(255,77,94,.02)");
    grad.addColorStop(1, "rgba(255,77,94,.2)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(d.x - 12, y0);
    ctx.lineTo(d.x + 12, y0);
    ctx.lineTo(d.lockX + 34, y1);
    ctx.lineTo(d.lockX - 34, y1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,77,94,.4)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(d.x - 12, y0);
    ctx.lineTo(d.lockX - 34, y1);
    ctx.moveTo(d.x + 12, y0);
    ctx.lineTo(d.lockX + 34, y1);
    ctx.stroke();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(d.lockX, y1, 44, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c;
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 11]);
    ctx.lineDashOffset = -(d.rotor || 0) * 6;
    ctx.beginPath();
    ctx.ellipse(d.lockX, y1, 44, 19, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function pickup(ctx, q, o) {
    const bob = Math.sin(q.bob || 0) * 5;
    ctx.save();
    ctx.translate(q.x, q.y + bob);
    ctx.globalAlpha = q.life < 2 ? Math.max(0, q.life) : 1;
    ctxLine(ctx, 4);
    if (q.kind === "cash") {
      ctx.rotate(Math.sin((q.bob || 0) * 0.6) * 0.18);
      ctx.fillStyle = "#8fd6a0";
      roundRect(ctx, -26, -16, 52, 32, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e8f7ee";
      roundRect(ctx, -18, -10, 36, 20, 4);
      ctx.fill();
      ctx.fillStyle = "#2e7d4f";
      ctx.font = "700 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("₽", 0, 1);
      ctx.fillStyle = "rgba(255,255,255,.6)";
      ctx.beginPath();
      ctx.arc(-30, -18, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const colors = {
      nitro: ["#ffd85e", "#ff9d3d"],
      repair: ["#ff8fae", "#d5ff5f"],
      magnet: ["#7fd1ff", "#2f6bd8"],
      radar: ["#a5ffef", "#4ff0ff"],
      shield: ["#d5ff5f", "#6b8d2e"],
    }[q.kind] || ["#d5ff5f", "#6b8d2e"];
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors[1];
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#12241f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 22px system-ui, sans-serif";
    const glyphs = { nitro: "⚡", repair: "+", magnet: "M", radar: "◉", shield: "◈" };
    ctx.fillText(glyphs[q.kind] || "?", 0, 1);
    ctx.restore();
  }

  function prop(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctxLine(ctx, 5);
    shadow(ctx, 0, 22, 30, 8, 0.22);
    if (s.kind === "cone") {
      ctx.fillStyle = "#ff7a2f";
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(24, 20);
      ctx.lineTo(-24, 20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f6f8ef";
      ctx.beginPath();
      ctx.moveTo(-11, -6);
      ctx.lineTo(11, -6);
      ctx.lineTo(14, 6);
      ctx.lineTo(-14, 6);
      ctx.closePath();
      ctx.fill();
    } else if (s.kind === "oil") {
      ctx.fillStyle = "#20303f";
      ctx.beginPath();
      ctx.ellipse(0, 8, 58, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#7f5fd8";
      ctx.beginPath();
      ctx.ellipse(-12, 4, 26, 10, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (s.kind === "pothole") {
      ctx.fillStyle = "#0b1512";
      ctx.beginPath();
      ctx.moveTo(-42, 0);
      ctx.lineTo(-24, -20);
      ctx.lineTo(6, -22);
      ctx.lineTo(38, -6);
      ctx.lineTo(28, 18);
      ctx.lineTo(-14, 20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#5c6f66";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-32, -4);
      ctx.lineTo(-16, -13);
      ctx.lineTo(8, -14);
      ctx.lineTo(28, -4);
      ctx.stroke();
      ctx.fillStyle = "#3f5147";
      ctx.beginPath();
      ctx.ellipse(2, 6, 16, 7, 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.rotate(Math.sin(s.spin || 0) * 0.1);
      ctx.fillStyle = "#f2f6ee";
      roundRect(ctx, -60, -22, 120, 44, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e04b4b";
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-60 + i * 42, -22, 21, 44);
        ctx.clip();
        ctx.fillRect(-70 + i * 42, -22, 42, 44);
        ctx.restore();
      }
      ctx.fillStyle = "#12241f";
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ДПС", 0, 1);
    }
    ctx.restore();
  }

  function skyline(ctx, w, h, pal, seedFn, offset, horizon) {
    let s = seedFn;
    const rows = [
      { top: horizon - h * 0.19, span: h * 0.19, w: 66, alpha: 0.45, par: 0.06 },
      { top: horizon - h * 0.11, span: h * 0.11, w: 92, alpha: 0.85, par: 0.14 },
    ];
    for (const row of rows) {
      ctx.fillStyle = pal.block;
      ctx.globalAlpha = row.alpha;
      let x = -((offset * row.par) % (row.w * 2));
      while (x < w + row.w) {
        s = (s * 9301 + 49297) % 233280;
        const bh = row.span * (0.55 + (s / 233280) * 0.9);
        const top = row.top + (row.span - bh) + h * 0.02;
        ctx.fillRect(x, top, row.w * 0.86, horizon - top);
        s = (s * 9301 + 49297) % 233280;
        ctx.fillStyle = pal.lit;
        ctx.globalAlpha = row.alpha * 0.55;
        for (let wy = top + 10; wy < horizon - 10; wy += 17)
          for (let wx = x + 7; wx < x + row.w * 0.86 - 9; wx += 16) {
            s = (s * 9301 + 49297) % 233280;
            if (s / 233280 > 0.62) ctx.fillRect(wx, wy, 7, 9);
          }
        ctx.fillStyle = pal.block;
        ctx.globalAlpha = row.alpha;
        x += row.w;
      }
      ctx.globalAlpha = 1;
    }
    const glow = ctx.createLinearGradient(0, horizon - h * 0.06, 0, horizon + h * 0.02);
    glow.addColorStop(0, "rgba(0,0,0,0)");
    glow.addColorStop(1, pal.glow);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - h * 0.06, w, h * 0.08);
    ctx.globalAlpha = 1;
  }

  function background(ctx, o) {
    const { w, h, world, scroll, phase } = o;
    const roadTop = o.roadTop || h * 0.3;
    const pal = PALETTE[phase.tint] || PALETTE.night;
    const sky = ctx.createLinearGradient(0, 0, 0, roadTop);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(0.6, pal.sky[1]);
    sky.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, roadTop);

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#fff8e1";
    let starSeed = 42;
    for (let i = 0; i < 26; i++) {
      starSeed = (starSeed * 9301 + 49297) % 233280;
      const sx = (starSeed / 233280) * w;
      starSeed = (starSeed * 9301 + 49297) % 233280;
      const sy = (starSeed / 233280) * roadTop * 0.7;
      ctx.fillRect(sx, sy, 2.5, 2.5);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#fff2c9";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(w * 0.82, roadTop * 0.32, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    skyline(ctx, w, h, pal, 12345, scroll, roadTop);

    ctx.fillStyle = "#2a3630";
    ctx.fillRect(0, roadTop, w, h - roadTop);

    const left = o.roadLeft,
      right = o.roadRight;
    ctx.fillStyle = pal.curb;
    ctx.fillRect(0, roadTop, left - 14, h);
    ctx.fillRect(right + 14, roadTop, w - right, h);
    ctx.strokeStyle = "#0e1a17";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(left - 14, roadTop);
    ctx.lineTo(left - 14, h);
    ctx.moveTo(right + 14, roadTop);
    ctx.lineTo(right + 14, h);
    ctx.stroke();

    const asphalt = ctx.createLinearGradient(left, 0, right, 0);
    asphalt.addColorStop(0, "#31403a");
    asphalt.addColorStop(0.5, "#3b4b44");
    asphalt.addColorStop(1, "#31403a");
    ctx.fillStyle = asphalt;
    ctx.fillRect(left - 14, roadTop, right - left + 28, h - roadTop);

    ctx.strokeStyle = "#1e2b26";
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (const x of [left, right]) {
      ctx.moveTo(x, roadTop);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(246,248,239,.75)";
    ctx.lineWidth = 8;
    ctx.setLineDash([46, 40]);
    ctx.lineDashOffset = -((scroll * 1) % 86);
    ctx.beginPath();
    for (let i = 1; i < o.lanes; i++) {
      const x = left + ((right - left) / o.lanes) * i;
      ctx.moveTo(x, roadTop);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const zebra = (scroll * 1) % 1500;
    for (let band = -1; band < 2; band++) {
      const y = roadTop + 120 + band * 1500 - zebra;
      if (y < -60 || y > h + 60) continue;
      ctx.fillStyle = "rgba(246,248,239,.5)";
      for (let i = 0; i < 9; i++) ctx.fillRect(left + 6 + i * ((right - left) / 9), y, (right - left) / 18, 54);
    }

    const lampStep = 460;
    const lampOffset = scroll % lampStep;
    for (let i = -1; i < h / lampStep + 2; i++) {
      const y = roadTop + i * lampStep - lampOffset;
      for (const [x, dir] of [
        [left - 52, 1],
        [right + 52, -1],
      ]) {
        ctx.strokeStyle = "#16241f";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x, y + 60);
        ctx.lineTo(x, y - 26);
        ctx.lineTo(x + 22 * dir, y - 32);
        ctx.stroke();
        ctx.fillStyle = "#ffe9a8";
        ctx.beginPath();
        ctx.ellipse(x + 22 * dir, y - 30, 9, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.07;
        ctx.beginPath();
        ctx.moveTo(x + 22 * dir, y - 26);
        ctx.lineTo(x + 22 * dir - 34, y + 120);
        ctx.lineTo(x + 22 * dir + 34, y + 120);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    const neonStep = 420;
    const neonOffset = (scroll * 0.55) % neonStep;
    for (let i = -1; i < (h - roadTop) / neonStep + 2; i++) {
      const y = roadTop + 40 + i * neonStep - neonOffset;
      const side = i % 2 ? 0 : 1;
      const x = side ? right + 46 : left - 150;
      const color = pal.neon[((i % pal.neon.length) + pal.neon.length) % pal.neon.length];
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#101c1a";
      roundRect(ctx, x, y, 104, 60, 8);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "700 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const words = ["САЛОН", "НОЧЬ", "ПИЦЦА", "АПТЕКА", "24 Ч", "БАРА"];
      ctx.fillText(words[Math.abs(i) % words.length], x + 52, y + 30);
      ctx.globalAlpha = 0.1;
      ctx.beginPath();
      ctx.arc(x + 52, y + 30, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function fx(ctx, f, time) {
    const k = f.life / f.ttl;
    ctx.save();
    ctx.globalAlpha = clamp(1 - k, 0, 1);
    if (f.kind === "stars") {
      for (let i = 0; i < (f.count || 8); i++) {
        const a = (i / (f.count || 8)) * Math.PI * 2 + k * 3;
        const r = 20 + k * 130;
        ctx.fillStyle = f.color || "#ffd85e";
        ctxLine(ctx, 2.5);
        star(ctx, f.x + Math.cos(a) * r, f.y + Math.sin(a) * r * 0.7, 9 * (1 - k * 0.5), 5);
        ctx.fill();
        ctx.stroke();
      }
    } else if (f.kind === "coins") {
      for (let i = 0; i < (f.count || 6); i++) {
        const a = i * 1.3 + k;
        ctx.fillStyle = "#ffd85e";
        ctx.beginPath();
        ctx.ellipse(
          f.x + Math.cos(a) * 40 * k,
          f.y + Math.sin(a) * 30 * k - 40 * k,
          9,
          12 * Math.abs(Math.cos(a + k * 3)),
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctxLine(ctx, 2);
        ctx.stroke();
      }
    } else if (f.kind === "dust") {
      for (let i = 0; i < (f.count || 6); i++) {
        const a = i * 2.1;
        ctx.fillStyle = f.color || "#cfd8cd";
        ctx.beginPath();
        ctx.arc(
          f.x + Math.cos(a) * 60 * k,
          f.y + Math.sin(a) * 40 * k + 20 * k,
          16 * (1 - k) + 3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (f.kind === "ring") {
      ctx.strokeStyle = f.color || "#d5ff5f";
      ctx.lineWidth = 8 * (1 - k);
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, 20 + k * 120, 14 + k * 80, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (f.kind === "boom") {
      ctx.fillStyle = f.color || "#ffd85e";
      const spikes = f.small ? 6 : 10;
      star(ctx, f.x, f.y, (f.small ? 40 : 90) * (0.4 + k), spikes, 0.5);
      ctx.fill();
      ctxLine(ctx, 4);
      ctx.stroke();
    } else if (f.kind === "pop") {
      const scale = k < 0.16 ? 0.66 + Math.max(0, k) * 2.1 : 1.2 - (k - 0.16) * 0.25;
      ctx.translate(f.x, f.y);
      ctx.scale(scale, scale);
      ctx.font = "800 27px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = INK;
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle =
        f.tone === "bad"
          ? "#ff7a7a"
          : f.tone === "gold"
            ? "#ffd85e"
            : f.tone === "combo"
              ? "#a5ffef"
              : "#eef7e6";
      ctx.fillText(f.text, 0, 0);
    }
    ctx.restore();
  }

  global.GameArt = {
    INK,
    PALETTE,
    shadow,
    roundRect,
    star,
    playerCar,
    target,
    policeCar,
    drone,
    droneTarget,
    pickup,
    prop,
    background,
    fx,
    shade(hex, amount) {
      const c = hex.replace("#", "");
      const num = parseInt(c.length === 3 ? c.replace(/(.)/g, "$1$1") : c, 16);
      const adj = (v) =>
        Math.round(clamp(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount, 0, 255));
      const r = adj((num >> 16) & 255),
        g = adj((num >> 8) & 255),
        b = adj(num & 255);
      return `rgb(${r},${g},${b})`;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
