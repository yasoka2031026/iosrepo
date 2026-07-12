'use strict';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function loadMeta() {
  const meta = await getJSON('/api/meta');

  const cat = $('category');
  cat.innerHTML = '';
  for (const key of Object.keys(meta.categories)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = meta.categories[key].name;
    cat.appendChild(o);
  }

  const country = $('country');
  for (const key of Object.keys(meta.countries)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = meta.countries[key].name;
    country.appendChild(o);
  }

  const interval = $('interval');
  const labels = { daily: '毎日', weekly: '毎週', biweekly: '隔週', monthly: '毎月', quarterly: '四半期' };
  for (const key of meta.intervals) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = labels[key] || key;
    if (key === 'weekly') o.selected = true;
    interval.appendChild(o);
  }

  return meta;
}

function query() {
  const params = new URLSearchParams();
  params.set('category', $('category').value);
  if ($('country').value) params.set('country', $('country').value);
  params.set('interval', $('interval').value);
  params.set('days', $('days').value);
  return '/api/prices/average?' + params.toString();
}

function fmt(n) {
  return n == null ? '—' : '$' + n.toFixed(3);
}

function drawChart(data) {
  const chart = $('chart');
  chart.innerHTML = '';
  const buckets = data.buckets.filter((b) => b.average != null);
  if (!buckets.length) {
    chart.textContent = 'データがありません';
    return;
  }

  const W = 1000, H = 360, padL = 60, padR = 20, padT = 20, padB = 40;
  const values = buckets.map((b) => b.average);
  const mins = buckets.map((b) => b.min);
  const maxs = buckets.map((b) => b.max);
  const lo = Math.min(...mins);
  const hi = Math.max(...maxs);
  const range = hi - lo || 1;

  const x = (i) => padL + (i / Math.max(1, buckets.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / range) * (H - padT - padB);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Gridlines + y labels.
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const val = lo + (range * t) / ticks;
    const yy = y(val);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
    line.setAttribute('y1', yy); line.setAttribute('y2', yy);
    line.setAttribute('stroke', '#2a313c'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', padL - 8); lbl.setAttribute('y', yy + 4);
    lbl.setAttribute('text-anchor', 'end'); lbl.setAttribute('fill', '#9aa4b2');
    lbl.setAttribute('font-size', '11');
    lbl.textContent = '$' + val.toFixed(2);
    svg.appendChild(lbl);
  }

  // Min-max band.
  let bandTop = '', bandBottom = '';
  buckets.forEach((b, i) => { bandTop += `${x(i)},${y(b.max)} `; });
  for (let i = buckets.length - 1; i >= 0; i--) bandBottom += `${x(i)},${y(buckets[i].min)} `;
  const band = document.createElementNS(SVG_NS, 'polygon');
  band.setAttribute('points', bandTop + bandBottom);
  band.setAttribute('fill', 'rgba(79,157,255,0.12)');
  band.setAttribute('stroke', 'none');
  svg.appendChild(band);

  // Average line.
  let d = '';
  buckets.forEach((b, i) => { d += (i === 0 ? 'M' : 'L') + x(i) + ' ' + y(b.average); });
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#4f9dff');
  path.setAttribute('stroke-width', '2.5');
  svg.appendChild(path);

  // Points.
  buckets.forEach((b, i) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', x(i)); c.setAttribute('cy', y(b.average)); c.setAttribute('r', '3');
    c.setAttribute('fill', '#4f9dff');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${b.periodStart} 〜 ${b.periodEnd}\n平均 ${fmt(b.average)}`;
    c.appendChild(title);
    svg.appendChild(c);
  });

  // X labels (first, middle, last).
  const idxs = [0, Math.floor(buckets.length / 2), buckets.length - 1];
  [...new Set(idxs)].forEach((i) => {
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', x(i)); lbl.setAttribute('y', H - 12);
    lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('fill', '#9aa4b2');
    lbl.setAttribute('font-size', '11');
    lbl.textContent = buckets[i].periodStart;
    svg.appendChild(lbl);
  });

  chart.appendChild(svg);

  $('legend').innerHTML =
    '<span class="item"><span class="swatch" style="background:#4f9dff"></span>平均価格</span>' +
    '<span class="item"><span class="swatch" style="background:rgba(79,157,255,0.4)"></span>最小〜最大レンジ</span>';
}

function drawSummary(data) {
  const buckets = data.buckets.filter((b) => b.average != null);
  const summary = $('summary');
  summary.innerHTML = '';
  if (!buckets.length) return;

  const first = buckets[0].average;
  const last = buckets[buckets.length - 1].average;
  const change = ((last - first) / first) * 100;
  const avgAll = buckets.reduce((s, b) => s + b.average, 0) / buckets.length;

  const cls = change >= 0 ? 'up' : 'down';
  const sign = change >= 0 ? '+' : '';

  const cards = [
    { k: '最新平均価格', v: fmt(last), cls: '' },
    { k: '期間平均', v: fmt(Math.round(avgAll * 1000) / 1000), cls: '' },
    { k: '期間変化率', v: sign + change.toFixed(1) + '%', cls },
    { k: 'データ点数', v: String(buckets.length), cls: '' },
  ];
  for (const c of cards) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="k">${c.k}</div><div class="v ${c.cls}">${c.v}</div>`;
    summary.appendChild(el);
  }
}

function drawTable(data) {
  const tbody = $('table').querySelector('tbody');
  tbody.innerHTML = '';
  for (const b of data.buckets) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${b.periodStart}</td><td>${b.periodEnd}</td>` +
      `<td>${fmt(b.average)}</td><td>${fmt(b.min)}</td><td>${fmt(b.max)}</td><td>${b.samples}</td>`;
    tbody.appendChild(tr);
  }
}

async function refresh() {
  const note = $('note');
  note.className = 'note';
  note.textContent = '読み込み中…';
  try {
    const data = await getJSON(query());
    drawSummary(data);
    drawChart(data);
    drawTable(data);
    const names = data.manufacturers.map((m) => m.name).join(', ') || '該当なし';
    note.textContent =
      `単位: ${data.unit} ／ 対象メーカー: ${names} ／ 取得間隔: ${data.intervalDays}日 ／ ` +
      `期間: ${data.range.from} 〜 ${data.range.to}`;
  } catch (err) {
    note.className = 'note error';
    note.textContent = 'エラー: ' + err.message;
  }
}

(async function init() {
  try {
    await loadMeta();
    $('reload').addEventListener('click', refresh);
    ['category', 'country', 'interval', 'days'].forEach((id) =>
      $(id).addEventListener('change', refresh)
    );
    await refresh();
  } catch (err) {
    $('note').className = 'note error';
    $('note').textContent = '初期化エラー: ' + err.message;
  }
})();
