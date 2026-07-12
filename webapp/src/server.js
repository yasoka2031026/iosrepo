import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { averagePrices, defaultRange, INTERVALS } from './priceService.js';
import { MANUFACTURERS, COUNTRIES, CATEGORIES } from './manufacturers.js';
import { fetchLiveAverages, LIVE_ENDPOINT } from './providers/livePriceSource.js';
import { appendSnapshot, snapshotCount } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  app.use(express.json());

  // Static frontend.
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });
  app.use('/static', express.static(path.join(__dirname, '..', 'public')));

  // Metadata: countries, categories, manufacturers, intervals.
  app.get('/api/meta', (_req, res) => {
    res.json({
      countries: COUNTRIES,
      categories: CATEGORIES,
      manufacturers: MANUFACTURERS,
      intervals: Object.keys(INTERVALS),
      today: new Date().toISOString().slice(0, 10),
    });
  });

  // Equal-interval average prices.
  //   /api/prices/average?category=DRAM&country=KR&interval=weekly&from=&to=&days=
  app.get('/api/prices/average', (req, res) => {
    try {
      const { category = 'DRAM', country, interval, from, to, days, manufacturers } = req.query;

      let range;
      if (from && to) {
        range = { from, to };
      } else {
        const n = Number(days);
        range = defaultRange(Number.isFinite(n) && n > 0 ? Math.floor(n) : 180);
      }

      const result = averagePrices({
        category,
        country: country || undefined,
        interval,
        from: range.from,
        to: range.to,
        manufacturers: manufacturers
          ? String(manufacturers).split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      });

      res.json({ range, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Current real prices from the free public source (PricePerGig).
  // Falls back gracefully: if the source is unreachable (e.g. restricted network),
  // returns { available: false, reason } instead of failing.
  app.get('/api/prices/live', async (req, res) => {
    const category = req.query.category || 'NAND';
    if (!CATEGORIES[category]) {
      return res.status(400).json({ error: `Unknown category: ${category}` });
    }
    try {
      const live = await fetchLiveAverages(category);
      res.json({ available: true, endpoint: LIVE_ENDPOINT, ...live });
    } catch (err) {
      res.json({
        available: false,
        endpoint: LIVE_ENDPOINT,
        reason: err.message,
        note: 'Live source unreachable from this host; the modeled series is used instead.',
      });
    }
  });

  // Record a snapshot of current real prices into the append-only store so that
  // equal-interval history accumulates from the free source over time.
  app.post('/api/prices/refresh', async (req, res) => {
    const category = (req.query.category || req.body?.category || 'NAND');
    if (!CATEGORIES[category]) {
      return res.status(400).json({ error: `Unknown category: ${category}` });
    }
    try {
      const live = await fetchLiveAverages(category);
      if (!live.manufacturers.length) {
        return res.json({ recorded: false, reason: 'no matching listings', ...live });
      }
      const rec = appendSnapshot({ category, ...live });
      res.json({ recorded: true, snapshot: rec, totalSnapshots: snapshotCount({ category }) });
    } catch (err) {
      res.status(502).json({ recorded: false, reason: err.message });
    }
  });

  // Health check.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

// Start only when run directly (not when imported by tests).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const port = process.env.PORT || 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`Memory/SSD price tracker running at http://localhost:${port}`);
  });
}
