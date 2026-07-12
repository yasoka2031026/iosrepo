// Aggregation service: turns raw daily manufacturer prices into equal-interval
// average price series ("等間隔で平均価格を取得").

import { manufacturersFor, CATEGORIES, COUNTRIES } from './manufacturers.js';
import { fetchSeries } from './providers/priceSource.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Named intervals -> equal bucket width in days.
export const INTERVALS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
};

export function resolveIntervalDays(interval) {
  if (typeof interval === 'number' && Number.isFinite(interval)) {
    return Math.max(1, Math.floor(interval));
  }
  if (typeof interval === 'string') {
    if (INTERVALS[interval] != null) return INTERVALS[interval];
    const n = Number(interval);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return INTERVALS.weekly;
}

function startOfDayUTC(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateInput}`);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Compute equal-interval average prices.
 *
 * @param {object} opts
 * @param {string} opts.category  'DRAM' | 'NAND'
 * @param {string} [opts.country] country code filter (KR/CN/US/TW/JP)
 * @param {string[]} [opts.manufacturers] explicit manufacturer id filter
 * @param {string|Date} opts.from  range start (inclusive)
 * @param {string|Date} opts.to    range end (inclusive)
 * @param {string|number} [opts.interval] named interval or day count
 * @returns {object} aggregation result
 */
export function averagePrices(opts = {}) {
  const category = opts.category || 'DRAM';
  if (!CATEGORIES[category]) throw new Error(`Unknown category: ${category}`);

  if (opts.country && !COUNTRIES[opts.country]) {
    throw new Error(`Unknown country: ${opts.country}`);
  }

  const fromMs = startOfDayUTC(opts.from);
  const toMs = startOfDayUTC(opts.to);
  if (fromMs > toMs) throw new Error('`from` must be on or before `to`');

  const intervalDays = resolveIntervalDays(opts.interval);

  // Which manufacturers contribute.
  let selected = manufacturersFor({ country: opts.country, category });
  if (Array.isArray(opts.manufacturers) && opts.manufacturers.length) {
    const set = new Set(opts.manufacturers);
    selected = selected.filter((m) => set.has(m.id));
  }
  if (selected.length === 0) {
    return {
      category,
      country: opts.country || null,
      intervalDays,
      unit: CATEGORIES[category].unit,
      manufacturers: [],
      buckets: [],
    };
  }

  // Pull each manufacturer's daily series once, index by ts.
  const seriesByDay = new Map(); // ts -> array of prices (across manufacturers)
  for (const m of selected) {
    const series = fetchSeries(m.id, category, fromMs, toMs);
    for (const point of series) {
      let arr = seriesByDay.get(point.ts);
      if (!arr) {
        arr = [];
        seriesByDay.set(point.ts, arr);
      }
      arr.push(point.price);
    }
  }

  // Build equal-width buckets and average every daily price falling inside each.
  const buckets = [];
  const totalDays = Math.round((toMs - fromMs) / MS_PER_DAY);
  for (let offset = 0; offset <= totalDays; offset += intervalDays) {
    const bucketStart = fromMs + offset * MS_PER_DAY;
    const bucketEnd = Math.min(bucketStart + (intervalDays - 1) * MS_PER_DAY, toMs);

    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let ts = bucketStart; ts <= bucketEnd; ts += MS_PER_DAY) {
      const prices = seriesByDay.get(ts);
      if (!prices) continue;
      for (const p of prices) {
        sum += p;
        count += 1;
        if (p < min) min = p;
        if (p > max) max = p;
      }
    }

    buckets.push({
      periodStart: new Date(bucketStart).toISOString().slice(0, 10),
      periodEnd: new Date(bucketEnd).toISOString().slice(0, 10),
      average: count ? Math.round((sum / count) * 1000) / 1000 : null,
      min: count ? Math.round(min * 1000) / 1000 : null,
      max: count ? Math.round(max * 1000) / 1000 : null,
      samples: count,
    });
  }

  return {
    category,
    country: opts.country || null,
    intervalDays,
    unit: CATEGORIES[category].unit,
    manufacturers: selected.map((m) => ({ id: m.id, name: m.name, country: m.country })),
    buckets,
  };
}

// Convenience: default range = last N days ending today (UTC).
export function defaultRange(days = 180, endDate = new Date()) {
  const end = startOfDayUTC(endDate);
  const start = end - (days - 1) * MS_PER_DAY;
  return {
    from: new Date(start).toISOString().slice(0, 10),
    to: new Date(end).toISOString().slice(0, 10),
  };
}
