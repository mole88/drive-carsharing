/* Симулятор баланса: прогоняет ядро мини-игры ботами трёх уровней мастерства
   и возвращает статистику забегов. Используется тестом game-balance. */
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const CORE_PATH = path.resolve(__dirname, "../../app/static/game-core.js");
const DT = 1 / 60;

function loadCore(file) {
  const context = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context.GameCore;
}

const core = loadCore(CORE_PATH);
const { WORLD, RULES } = core;

/* Мастерство бота: сколько секунд просмотра, как часто перепланирует полосу,
   насколько охотится за толпой, газ, реакция нитро на облаву и готовность платить. */
const SKILL = {
  noob: { look: 0, plan: 0, hunt: 0, throttle: 0.35, nitro: 0, bribe: false, miss: 0, noise: 0 },
  human: { look: 0.9, plan: 0.7, hunt: 0.35, throttle: 0.72, nitro: 260, bribe: true, miss: 0.18, noise: 0.3 },
  casual: { look: 1.1, plan: 0.45, hunt: 0.5, throttle: 0.8, nitro: 190, bribe: true, miss: 0.08, noise: 0.18 },
  perfect: { look: 2.1, plan: 0, hunt: 1, throttle: 1, nitro: 320, bribe: true, miss: 0, noise: 0 },
};

/* Карта опасности полос: препятствия в горизонте, дроны в пикировании, патрули. */
function dangerMap(world, look) {
  const p = world.player;
  const horizon = Math.max(280, p.speed * WORLD.pxPerKmh * look);
  const danger = new Array(WORLD.lanes).fill(0);
  const add = (x, value) => {
    const lane = core.laneAt(x);
    danger[lane] += value;
    if (lane > 0) danger[lane - 1] += value * 0.3;
    if (lane < WORLD.lanes - 1) danger[lane + 1] += value * 0.3;
  };
  for (const s of world.props) {
    if (s.used) continue;
    const dy = p.y - s.y;
    if (dy < -50 || dy > horizon) continue;
    const weight =
      s.kind === "oil"
        ? 0.8
        : s.kind === "cone"
          ? 0.2
          : s.damage > 0
            ? 1.2
            : 0.25;
    add(s.x, weight * (1.3 - dy / horizon));
  }
  for (const d of world.drones) {
    if (d.state !== "lock" && d.state !== "dive") continue;
    add(d.state === "lock" ? d.lockX : d.x, 3.4);
  }
  for (const c of world.cops) {
    const dy = p.y - c.y;
    if (dy < -70 || dy > horizon) continue;
    add(c.x, 1.5);
  }
  return { danger, horizon };
}

/* Желаемая полоса: минус опасность, плюс толпа пешеходов и наличность. */
function pickLane(world, map, hunt) {
  const p = world.player;
  let best = core.laneAt(p.x);
  let bestScore = -1e9;
  for (let lane = 0; lane < WORLD.lanes; lane++) {
    const x = WORLD.laneCenters[lane];
    let score = -map.danger[lane] * (hunt === 0 ? 4 : 1.9);
    if (hunt > 0) {
      for (const t of world.targets) {
        if (t.state !== "walking") continue;
        const dy = p.y - t.y;
        if (dy < -40 || dy > map.horizon + 220) continue;
        if (Math.abs(t.x - x) < WORLD.laneWidth * 0.62)
          score += (t.vip ? 2.4 : 1) * hunt * (1 - dy / (map.horizon + 220));
      }
      for (const q of world.pickups) {
        if (q.y > p.y + 40 || q.y < p.y - map.horizon - 260) continue;
        if (Math.abs(q.x - x) < WORLD.laneWidth * 0.6)
          score += (q.kind === "cash" ? 0.5 : 0.9) * hunt;
      }
    }
    score -= Math.abs(core.laneAt(p.x) - lane) * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = lane;
    }
  }
  return best;
}

/* Отдельный от ядра генератор: ошибки бота не должны менять последовательность мира. */
function jitter(seed) {
  let a = (seed >>> 0) + 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function botFor(world, policy, state) {
  const p = world.player;
  const skill = SKILL[policy] || SKILL.casual;
  if (!skill.look)
    return {
      steer: Math.sin(world.time * 0.7) * 0.4,
      throttle: skill.throttle,
    };
  const map = dangerMap(world, skill.look);
  if (world.time - state.planAt >= skill.plan) {
    let lane = pickLane(world, map, skill.hunt);
    if (skill.miss && state.rand() < skill.miss)
      lane = Math.max(0, Math.min(WORLD.lanes - 1, lane + (state.rand() < 0.5 ? -1 : 1)));
    state.plan = lane;
    state.noise = (state.rand() - 0.5) * skill.noise * 2;
    state.planAt = world.time;
  }
  const goalX = WORLD.laneCenters[state.plan];
  let steer = (goalX - p.x) / 95 - p.vx / 620 + state.noise;
  steer = Math.max(-1, Math.min(1, steer));
  const here = map.danger[core.laneAt(p.x)];
  const worst = Math.max.apply(null, map.danger);
  const trapped = here >= worst - 0.05 && here > 1.1;
  const panic = world.raid.y - p.y < skill.nitro;
  return {
    steer,
    throttle: panic ? 1 : skill.throttle,
    bribe: skill.bribe && !!(p.encounter && p.cash >= p.encounter.cost),
    nitro: (trapped || panic) && p.nitro >= RULES.nitroCost && p.nitroTime <= 0,
  };
}

function play(policy, seed, options) {
  const cfg = Object.assign({ category: "comfort" }, options || {}, { seed });
  const world = core.createRun(cfg);
  const state = { plan: 0, planAt: -1, noise: 0, rand: jitter(seed * 2654435761) };
  const trace = { level: [], hearts: [], cash: [], debt: [], gap: [] };
  const causes = {};
  let steps = 0;
  const cap = Math.ceil((options && options.cap ? options.cap : 900) / DT);
  while (world.status === "running" && steps < cap) {
    core.step(world, DT, botFor(world, policy, state));
    for (const e of world.events)
      if (e.type === "damage")
        causes[e.source] = (causes[e.source] || 0) + 1;
    world.events.length = 0;
    steps += 1;
    if (steps % 60 === 0) {
      trace.level.push(world.level);
      trace.hearts.push(world.player.hearts);
      trace.cash.push(world.player.cash);
      trace.debt.push(world.player.rentalDebt);
      trace.gap.push(Math.round(world.raid.y - world.player.y));
    }
  }
  if (!world.result) core.finish(world, "timeout");
  const r = world.result;
  r.policy = policy;
  r.seed = seed;
  r.car = world.car.name;
  r.category = world.car.category;
  r.capped = r.reason === "timeout";
  r.causes = causes;
  return { world, result: r, trace };
}

function summarize(runs) {
  const num = (key) => runs.map((r) => r[key]).filter((v) => typeof v === "number");
  const mean = (list) =>
    list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const median = (list) => {
    if (!list.length) return 0;
    const s = list.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const time = num("time");
  return {
    runs: runs.length,
    medianTime: Math.round(median(time)),
    meanTime: Math.round(mean(time)),
    minTime: Math.round(Math.min.apply(null, time)),
    maxTime: Math.round(Math.max.apply(null, time)),
    medianScore: Math.round(median(num("score"))),
    maxScore: Math.round(Math.max.apply(null, num("score"))),
    medianLevel: Math.round(median(num("level"))),
    medianKnocks: Math.round(median(num("knockdowns"))),
    won: runs.filter((r) => r.won).length,
    broke: runs.filter((r) => r.reason === "broke").length,
    wrecked: runs.filter((r) => r.reason === "wrecked").length,
    quit: runs.filter((r) => r.reason === "quit").length,
    capped: runs.filter((r) => r.capped).length,
  };
}

module.exports = {
  core,
  DT,
  SKILL,
  play,
  summarize,
  botFor,
  dangerMap,
  pickLane,
};
