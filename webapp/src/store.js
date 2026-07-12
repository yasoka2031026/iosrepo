// Append-only snapshot store.
//
// PricePerGig (and most free retail feeds) expose *current* prices only — no history.
// To build a genuine equal-interval price *trend* from a free source, the app records
// each live fetch as a timestamped snapshot. Over time these snapshots become a real
// historical series that the averaging service can aggregate at equal intervals.
//
// Storage is newline-delimited JSON (one snapshot record per line) so it is append-only,
// crash-safe, and easy to inspect. Swap for a real time-series DB in production.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'snapshots.jsonl');

export function snapshotFile() {
  return process.env.SNAPSHOT_FILE || DEFAULT_FILE;
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

/**
 * Append one snapshot: the per-manufacturer prices captured at a single instant.
 * @param {object} snap { category, fetchedAt, source, manufacturers:[{id,pricePerGB,...}] }
 */
export function appendSnapshot(snap, file = snapshotFile()) {
  ensureDir(file);
  const rec = {
    ts: snap.fetchedAt || new Date().toISOString(),
    category: snap.category,
    source: snap.source || 'unknown',
    manufacturers: (snap.manufacturers || []).map((m) => ({
      id: m.id,
      pricePerGB: m.pricePerGB,
      samples: m.samples,
    })),
  };
  fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  return rec;
}

/** Read all snapshots (optionally filtered by category). */
export function readSnapshots({ category } = {}, file = snapshotFile()) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const rec = JSON.parse(s);
      if (category && rec.category !== category) continue;
      out.push(rec);
    } catch (_) {
      // Skip malformed line rather than failing the whole read.
    }
  }
  return out;
}

export function snapshotCount(opts, file = snapshotFile()) {
  return readSnapshots(opts, file).length;
}
