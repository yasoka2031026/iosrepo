// Live price source — free public data.
//
// Source: PricePerGig free JSON API (https://api.pricepergig.com/drives).
//   - No authentication required, ~30 requests/minute.
//   - PostgREST-style: returns an array of drive listings across marketplaces/countries.
//   - Covers SSDs / flash / memory cards with current retail prices.
//
// This module maps those raw retail listings onto our manufacturer / category model
// and normalizes prices to USD-per-GB so they are comparable with the rest of the app.
//
// NOTE ON VERIFIABILITY: the build/CI sandbox this was authored in blocks all outbound
// network (proxy policy denial), so the *live HTTP hop* cannot be exercised here.
// Everything else — request construction, JSON parsing, brand→manufacturer mapping,
// normalization, and graceful fallback — is pure and unit-tested against a fixture in
// test/live.test.js. The parser is deliberately tolerant of several field-name variants
// so it degrades gracefully (skips unrecognized rows) rather than throwing if the real
// schema differs slightly from the documented one.

import { MANUFACTURERS } from '../manufacturers.js';

export const LIVE_ENDPOINT =
  process.env.PPG_ENDPOINT || 'https://api.pricepergig.com/drives';

// Category in our model <- drive "type" strings seen in the source.
const TYPE_TO_CATEGORY = {
  ssd: 'NAND',
  'ssd-nvme': 'NAND',
  'ssd-sata': 'NAND',
  nvme: 'NAND',
  m2: 'NAND',
  flash: 'NAND',
  usb: 'NAND',
  'memory-card': 'NAND',
  ram: 'DRAM',
  memory: 'DRAM',
  dram: 'DRAM',
};

// Read the first present key from a row (tolerant of schema variants).
function pick(row, keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return undefined;
}

function toNumber(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// Match a listing's brand/name to one of our tracked manufacturers.
function matchManufacturer(row) {
  const hay = (
    (pick(row, ['brand', 'manufacturer', 'maker']) || '') +
    ' ' +
    (pick(row, ['name', 'title', 'model', 'productName']) || '')
  ).toLowerCase();
  if (!hay.trim()) return null;
  for (const m of MANUFACTURERS) {
    const needle = m.name.toLowerCase().replace(/\s+/g, '');
    const alt = m.id.toLowerCase();
    if (hay.replace(/\s+/g, '').includes(needle) || hay.includes(alt)) return m;
  }
  return null;
}

function categoryOf(row) {
  const t = String(pick(row, ['type', 'driveType', 'category', 'formFactor']) || '')
    .toLowerCase()
    .trim();
  if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  // Heuristic fallback from the free-text name.
  const name = String(pick(row, ['name', 'title']) || '').toLowerCase();
  if (/\b(ddr\d|dimm|udimm|sodimm|ram)\b/.test(name)) return 'DRAM';
  if (/\b(ssd|nvme|m\.?2|sata|nand|flash)\b/.test(name)) return 'NAND';
  return null;
}

// Capacity in GB (TB rows are converted).
function capacityGB(row) {
  const gb = toNumber(pick(row, ['capacityGB', 'capacity_gb', 'sizeGB', 'gb']));
  if (Number.isFinite(gb) && gb > 0) return gb;
  const tb = toNumber(pick(row, ['capacityTB', 'capacity_tb', 'tb']));
  if (Number.isFinite(tb) && tb > 0) return tb * 1000;
  // Parse from name e.g. "1TB", "512GB".
  const name = String(pick(row, ['name', 'title']) || '');
  const tbM = name.match(/(\d+(?:\.\d+)?)\s*TB/i);
  if (tbM) return parseFloat(tbM[1]) * 1000;
  const gbM = name.match(/(\d+(?:\.\d+)?)\s*GB/i);
  if (gbM) return parseFloat(gbM[1]);
  return NaN;
}

function priceUSD(row) {
  const p = toNumber(pick(row, ['priceUSD', 'price_usd', 'price', 'amount']));
  return Number.isFinite(p) && p > 0 ? p : NaN;
}

/**
 * Pure transform: raw drive rows -> normalized per-manufacturer USD/GB prices.
 * Exported for unit testing without a network call.
 *
 * @param {Array<object>} rows
 * @param {string} category 'DRAM' | 'NAND'
 * @returns {{manufacturers: Array<{id,name,country,pricePerGB,samples}>, rows:number}}
 */
export function normalizeDrives(rows, category) {
  const acc = new Map(); // manufacturerId -> {sum, count, m}
  let used = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (categoryOf(row) !== category) continue;
    const m = matchManufacturer(row);
    if (!m || !m.categories.includes(category)) continue;
    const price = priceUSD(row);
    const cap = capacityGB(row);
    if (!Number.isFinite(price) || !Number.isFinite(cap) || cap <= 0) continue;
    const perGB = price / cap;
    // Guard against absurd outliers (bad rows).
    if (perGB <= 0 || perGB > 100) continue;
    let a = acc.get(m.id);
    if (!a) {
      a = { sum: 0, count: 0, m };
      acc.set(m.id, a);
    }
    a.sum += perGB;
    a.count += 1;
    used += 1;
  }
  const manufacturers = [...acc.values()].map((a) => ({
    id: a.m.id,
    name: a.m.name,
    country: a.m.country,
    pricePerGB: Math.round((a.sum / a.count) * 100000) / 100000,
    samples: a.count,
  }));
  return { manufacturers, rows: used };
}

// Fetch current listings from the live API for a category, with a timeout.
// Returns normalized per-manufacturer prices. Throws on network/HTTP failure so
// callers can fall back to the modeled source.
export async function fetchLiveAverages(category, { timeoutMs = 6000, limit = 500 } = {}) {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable');
  const url = `${LIVE_ENDPOINT}?limit=${encodeURIComponent(limit)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`live source HTTP ${res.status}`);
    const data = await res.json();
    return {
      source: 'pricepergig',
      fetchedAt: new Date().toISOString(),
      ...normalizeDrives(data, category),
    };
  } finally {
    clearTimeout(timer);
  }
}
