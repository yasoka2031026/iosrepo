import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { normalizeDrives } from '../src/providers/livePriceSource.js';
import { appendSnapshot, readSnapshots, snapshotCount } from '../src/store.js';

// Representative sample of the free public API's drive listings (field-name variants
// included on purpose to exercise the tolerant parser).
const SAMPLE = [
  { brand: 'Samsung', name: 'Samsung 990 PRO 1TB NVMe SSD', type: 'ssd', price: 89.99, country: 'US' },
  { manufacturer: 'Micron', title: 'Crucial (Micron) T500 2TB SSD', type: 'ssd-nvme', price: 129.0, capacityGB: 2000 },
  { brand: 'Kioxia', name: 'Kioxia EXCERIA 512GB SSD', type: 'ssd', price: 44.5 },
  { brand: 'SK hynix', name: 'SK hynix Platinum P41 1TB', type: 'nvme', price: 99.99 },
  { brand: 'Samsung', name: 'Samsung DDR5 32GB DIMM', type: 'ram', price: 84.0, capacityGB: 32 },
  { brand: 'NoName', name: 'Generic 1TB SSD', type: 'ssd', price: 40.0 }, // unmatched brand -> skipped
  { brand: 'Samsung', name: 'Samsung broken row', type: 'ssd' }, // no price/capacity -> skipped
];

test('normalizeDrives maps NAND listings to manufacturers with USD/GB', () => {
  const r = normalizeDrives(SAMPLE, 'NAND');
  const byId = Object.fromEntries(r.manufacturers.map((m) => [m.id, m]));
  assert.ok(byId.samsung, 'samsung present');
  assert.ok(byId.micron, 'micron present');
  assert.ok(byId.kioxia, 'kioxia present');
  assert.ok(byId.skhynix, 'skhynix present');
  // Samsung 990 PRO 1TB @ $89.99 -> ~0.09/GB
  assert.ok(byId.samsung.pricePerGB > 0.05 && byId.samsung.pricePerGB < 0.15);
  // DRAM-only row (Samsung DDR5) must not leak into NAND aggregation.
  assert.equal(byId.samsung.samples, 1);
});

test('normalizeDrives filters by category', () => {
  const dram = normalizeDrives(SAMPLE, 'DRAM');
  const ids = dram.manufacturers.map((m) => m.id);
  assert.deepEqual(ids, ['samsung']);
  assert.ok(dram.manufacturers[0].pricePerGB > 0); // 84/32
});

test('normalizeDrives handles empty/garbage input', () => {
  assert.deepEqual(normalizeDrives([], 'NAND').manufacturers, []);
  assert.deepEqual(normalizeDrives(null, 'NAND').manufacturers, []);
  assert.deepEqual(normalizeDrives([{ foo: 1 }], 'NAND').manufacturers, []);
});

test('snapshot store round-trips', () => {
  const file = path.join(os.tmpdir(), `snap-test-${Date.now()}.jsonl`);
  try {
    const live = normalizeDrives(SAMPLE, 'NAND');
    appendSnapshot({ category: 'NAND', source: 'test', fetchedAt: '2026-07-12T00:00:00Z', ...live }, file);
    appendSnapshot({ category: 'NAND', source: 'test', fetchedAt: '2026-07-13T00:00:00Z', ...live }, file);
    const recs = readSnapshots({ category: 'NAND' }, file);
    assert.equal(recs.length, 2);
    assert.equal(snapshotCount({ category: 'NAND' }, file), 2);
    assert.equal(snapshotCount({ category: 'DRAM' }, file), 0);
    assert.ok(recs[0].manufacturers.length > 0);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
