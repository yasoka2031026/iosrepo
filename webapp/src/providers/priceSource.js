// Price data source.
//
// In production this module would call out to real market feeds (e.g. TrendForce /
// DRAMeXchange spot & contract prices, manufacturer investor data, distributor APIs).
// Those feeds are commercial / rate-limited and are not reachable from this
// environment, so the source is implemented as a *deterministic* generator that
// produces realistic daily spot prices per manufacturer & product category.
//
// The generator is seeded, so the same (manufacturer, category, date) always yields
// the same price. This keeps the app fully offline-capable and reproducible in tests.
//
// To plug in a real feed, replace `dailyPrice()` / `fetchSeries()` with an async
// implementation that returns [{ date, price }] for the requested range — the rest
// of the app (averaging, API, UI) does not care where the numbers come from.

import { MANUFACTURERS } from '../manufacturers.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Deterministic hash -> 32-bit seed.
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG -> deterministic float in [0, 1).
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Baseline USD reference prices per category (spot, normalized per density unit).
const BASELINE = {
  DRAM: 1.65, // USD per 8Gb equivalent
  NAND: 3.10, // USD per 128Gb equivalent
};

// Per-manufacturer multipliers so brands differ realistically.
function brandFactor(manufacturerId) {
  const r = rng(hashSeed(manufacturerId));
  // 0.90 .. 1.12
  return 0.90 + r() * 0.22;
}

const UNIX_DAY0 = Date.UTC(2020, 0, 1) / MS_PER_DAY;

function dayIndex(dateMs) {
  return Math.floor(dateMs / MS_PER_DAY);
}

// Deterministic spot price for a manufacturer/category on a given day.
export function dailyPrice(manufacturerId, category, dateMs) {
  const base = BASELINE[category];
  if (base == null) throw new Error(`Unknown category: ${category}`);
  const brand = brandFactor(manufacturerId + ':' + category);
  const d = dayIndex(dateMs) - UNIX_DAY0; // days since 2020-01-01

  // Long-term cyclical trend (memory market is famously cyclical, ~2yr cycles).
  const cycle = Math.sin((d / 365) * Math.PI); // slow up/down
  const trend = 1 + 0.28 * cycle;

  // Mild seasonal wave (quarterly demand swings).
  const seasonal = 1 + 0.05 * Math.sin((d / 91) * 2 * Math.PI);

  // Deterministic per-day noise.
  const noise = 1 + (rng(hashSeed(manufacturerId + category + d))() - 0.5) * 0.06;

  const price = base * brand * trend * seasonal * noise;
  return Math.round(price * 1000) / 1000;
}

// Return a daily series [{ date: ISOdate, ts, price }] for [fromMs, toMs] inclusive.
export function fetchSeries(manufacturerId, category, fromMs, toMs) {
  const series = [];
  const startDay = dayIndex(fromMs);
  const endDay = dayIndex(toMs);
  for (let day = startDay; day <= endDay; day++) {
    const ts = day * MS_PER_DAY;
    series.push({
      ts,
      date: new Date(ts).toISOString().slice(0, 10),
      price: dailyPrice(manufacturerId, category, ts),
    });
  }
  return series;
}

export function isKnownManufacturer(id) {
  return MANUFACTURERS.some((m) => m.id === id);
}
