import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averagePrices, defaultRange, resolveIntervalDays, INTERVALS } from '../src/priceService.js';
import { dailyPrice, fetchSeries } from '../src/providers/priceSource.js';
import { manufacturersFor } from '../src/manufacturers.js';

test('dailyPrice is deterministic and positive', () => {
  const ts = Date.UTC(2026, 0, 1);
  const a = dailyPrice('samsung', 'DRAM', ts);
  const b = dailyPrice('samsung', 'DRAM', ts);
  assert.equal(a, b);
  assert.ok(a > 0);
});

test('fetchSeries returns one point per day inclusive', () => {
  const from = Date.UTC(2026, 0, 1);
  const to = Date.UTC(2026, 0, 10);
  const s = fetchSeries('micron', 'NAND', from, to);
  assert.equal(s.length, 10);
  assert.equal(s[0].date, '2026-01-01');
  assert.equal(s[9].date, '2026-01-10');
});

test('resolveIntervalDays handles names, numbers, fallback', () => {
  assert.equal(resolveIntervalDays('weekly'), 7);
  assert.equal(resolveIntervalDays('monthly'), 30);
  assert.equal(resolveIntervalDays(14), 14);
  assert.equal(resolveIntervalDays('3'), 3);
  assert.equal(resolveIntervalDays('nonsense'), INTERVALS.weekly);
});

test('averagePrices produces equal-interval buckets', () => {
  const { from, to } = defaultRange(90);
  const r = averagePrices({ category: 'DRAM', interval: 'weekly', from, to });
  assert.ok(r.buckets.length > 0);
  // Every bucket except possibly the last spans exactly intervalDays.
  for (let i = 0; i < r.buckets.length - 1; i++) {
    const start = new Date(r.buckets[i].periodStart).getTime();
    const nextStart = new Date(r.buckets[i + 1].periodStart).getTime();
    assert.equal((nextStart - start) / (24 * 3600 * 1000), 7);
  }
  for (const b of r.buckets) {
    assert.ok(b.average > 0);
    assert.ok(b.min <= b.average && b.average <= b.max);
    assert.ok(b.samples > 0);
  }
});

test('country filter restricts manufacturers', () => {
  const r = averagePrices({ ...defaultRange(30), category: 'DRAM', country: 'KR', interval: 'weekly' });
  const ids = r.manufacturers.map((m) => m.id).sort();
  assert.deepEqual(ids, ['samsung', 'skhynix']);
});

test('NAND category excludes DRAM-only makers', () => {
  const makers = manufacturersFor({ category: 'NAND' }).map((m) => m.id);
  assert.ok(makers.includes('kioxia'));
  assert.ok(!makers.includes('cxmt'));
  assert.ok(!makers.includes('nanya'));
});

test('invalid inputs throw', () => {
  assert.throws(() => averagePrices({ category: 'XXX', ...defaultRange(10) }));
  assert.throws(() => averagePrices({ category: 'DRAM', country: 'ZZ', ...defaultRange(10) }));
  assert.throws(() => averagePrices({ category: 'DRAM', from: '2026-02-01', to: '2026-01-01' }));
});

test('empty manufacturer selection yields no buckets', () => {
  const r = averagePrices({ category: 'DRAM', country: 'JP', ...defaultRange(30) });
  // Japan has no DRAM maker in the dataset -> empty.
  assert.equal(r.manufacturers.length, 0);
  assert.equal(r.buckets.length, 0);
});
