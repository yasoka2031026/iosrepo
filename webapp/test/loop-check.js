// End-to-end loop verification.
// Boots the real HTTP server and exercises every endpoint across many
// parameter combinations, in a loop, asserting each response is valid.
// Exits non-zero on the first error so it can gate the build.

import http from 'http';
import { createApp } from '../src/server.js';
import { COUNTRIES, CATEGORIES } from '../src/manufacturers.js';
import { INTERVALS } from '../src/priceService.js';

const ITERATIONS = Number(process.env.LOOP_ITERATIONS || 25);

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout ' + path)));
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

async function validateAverage(port, qs) {
  const path = '/api/prices/average?' + qs;
  const res = await request(port, path);
  assert(res.status === 200, `${path} -> ${res.status}`);
  const data = JSON.parse(res.body);
  assert(Array.isArray(data.buckets), `${path} buckets array`);
  assert(data.intervalDays >= 1, `${path} intervalDays`);
  for (const b of data.buckets) {
    assert(b.periodStart <= b.periodEnd, `${path} period order`);
    if (b.average != null) {
      assert(b.average > 0, `${path} average > 0`);
      assert(b.min <= b.average && b.average <= b.max, `${path} min<=avg<=max`);
      assert(b.samples > 0, `${path} samples`);
    }
  }
  return data;
}

async function main() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  console.log(`loop-check: server on port ${port}, ${ITERATIONS} iterations`);

  const categories = Object.keys(CATEGORIES);
  const countries = ['', ...Object.keys(COUNTRIES)];
  const intervals = Object.keys(INTERVALS);
  const dayOptions = [30, 90, 180, 365, 730];

  let checks = 0;
  const start = Date.now();
  try {
    // static + meta + health once per iteration.
    for (let iter = 1; iter <= ITERATIONS; iter++) {
      const health = await request(port, '/api/health');
      assert(health.status === 200, 'health');
      const meta = await request(port, '/api/meta');
      assert(meta.status === 200, 'meta');
      const root = await request(port, '/');
      assert(root.status === 200 && root.body.includes('<html'), 'root html');
      // Live endpoint must always answer 200 with an `available` flag, even when the
      // upstream free source is unreachable (it degrades, never crashes).
      const live = await request(port, '/api/prices/live?category=NAND');
      assert(live.status === 200, 'live status');
      const liveData = JSON.parse(live.body);
      assert(typeof liveData.available === 'boolean', 'live available flag');
      checks += 4;

      for (const category of categories) {
        for (const country of countries) {
          for (const interval of intervals) {
            const days = dayOptions[(iter + checks) % dayOptions.length];
            const params = new URLSearchParams({ category, interval, days: String(days) });
            if (country) params.set('country', country);
            await validateAverage(port, params.toString());
            checks++;
          }
        }
      }

      // Explicit date range + numeric custom interval.
      await validateAverage(port, 'category=DRAM&from=2025-01-01&to=2025-12-31&interval=10');
      checks++;

      // Bad input must yield 400, not a crash.
      const bad = await request(port, '/api/prices/average?category=BOGUS&days=30');
      assert(bad.status === 400, 'bad category -> 400');
      checks++;

      if (iter % 5 === 0) console.log(`  iteration ${iter}/${ITERATIONS} ok (${checks} checks)`);
    }
  } finally {
    server.close();
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`loop-check: PASS — ${checks} checks in ${secs}s, no errors.`);
}

main().catch((err) => {
  console.error('loop-check: FAIL —', err.message);
  process.exit(1);
});
