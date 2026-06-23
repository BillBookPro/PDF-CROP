const state = {
  symbol: 'RELIANCE.BSE',
  candles: [],
  analysis: null,
  source: 'No data loaded',
  liveTimer: null,
  liveOn: false
};

const el = (id) => document.getElementById(id);
const money = (value) => Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-';
const pct = (value) => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '-';

function init() {
  el('alphaKeyInput').value = localStorage.getItem('alphaVantageKey') || '';
  el('todayText').textContent = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  el('marketState').textContent = marketSessionText();
  el('loadBtn').addEventListener('click', loadLiveData);
  el('liveBtn').addEventListener('click', toggleLiveMode);
  el('saveKeyBtn').addEventListener('click', saveAlphaKey);
  el('timeRange').addEventListener('change', syncIntervalForRange);
  el('sampleBtn').addEventListener('click', () => useData(makeDemoCandles(), 'Demo data'));
  el('csvFile').addEventListener('change', handleCsvFile);
  el('applyManualBtn').addEventListener('click', applyManualPrice);
  el('resetCounterBtn').addEventListener('click', resetRequestCounter);
  el('dailyLimitInput').value = localStorage.getItem('dailyApiLimit') || '20';
  el('dailyLimitInput').addEventListener('input', () => {
    localStorage.setItem('dailyApiLimit', el('dailyLimitInput').value || '20');
    renderRequestCounter();
  });
  ['capitalInput', 'riskInput', 'manualEntry', 'manualStop'].forEach(id => {
    el(id).addEventListener('input', updateRiskCalculator);
  });
  el('saveJournalBtn').addEventListener('click', saveJournal);
  renderRequestCounter();
  renderJournal();
  useData(makeDemoCandles(), 'Demo data');
}

function saveAlphaKey() {
  const key = el('alphaKeyInput').value.trim();
  if (!key) {
    alert('Alpha Vantage API key paste karein.');
    return;
  }
  localStorage.setItem('alphaVantageKey', key);
  el('saveKeyBtn').textContent = 'Saved';
  setTimeout(() => el('saveKeyBtn').textContent = 'Save Key', 1200);
}

function marketSessionText() {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 30;
  if (day === 0 || day === 6) return 'Market closed';
  if (minutes >= open && minutes <= close) return 'Market open';
  return 'Market closed';
}

async function loadLiveData() {
  const symbol = el('symbolInput').value.trim() || 'RELIANCE.BSE';
  const range = el('timeRange').value;
  const interval = compatibleInterval(range, el('timeInterval').value);
  el('timeInterval').value = interval;
  if (!canUseApiRequest()) {
    showSignal('wait', 'Free limit bachao', 'Aaj ka request limit complete ho gaya. Manual price update ya CSV import use karein.', 'Action: Aaj live fetch stop rakhein, kal phir fresh limit milegi.');
    stopLiveMode();
    return;
  }
  el('loadBtn').textContent = 'Loading...';
  el('loadBtn').disabled = true;
  try {
    incrementRequestCounter();
    const candles = await fetchAlphaVantage(symbol, range, interval);
    if (candles.length < 55) throw new Error('Analysis ke liye kam data mila');
    useData(candles, `Alpha Vantage: ${symbol} | ${range} | ${interval} | ${new Date().toLocaleTimeString('en-IN')}`);
  } catch (error) {
    showSignal('wait', 'Data nahi mila', error.message || 'API key, symbol, ya API limit check karein.', 'Action: Trade decision available nahi hai. Pehle live data load hona zaroori hai.');
    console.warn(error);
  } finally {
    el('loadBtn').textContent = 'Analyze';
    el('loadBtn').disabled = false;
  }
}

async function fetchAlphaVantage(symbol, range, interval) {
  const apikey = el('alphaKeyInput').value.trim() || localStorage.getItem('alphaVantageKey') || '';
  if (!apikey) throw new Error('Pehle Alpha Vantage API key paste karke Save Key dabayein.');

  const isDaily = interval === '1d';
  const params = new URLSearchParams({
    function: isDaily ? 'TIME_SERIES_DAILY' : 'TIME_SERIES_INTRADAY',
    symbol,
    apikey,
    outputsize: range === '1y' || range === '6mo' ? 'full' : 'compact'
  });
  if (!isDaily) {
    params.set('interval', alphaInterval(interval));
    params.set('adjusted', 'true');
  }

  const response = await fetch(`https://www.alphavantage.co/query?${params.toString()}`);
  if (!response.ok) throw new Error('Network/API response failed.');
  const json = await response.json();
  if (json.Note) throw new Error('Alpha Vantage free API limit hit ho gaya. Thodi der baad try karein ya paid plan/API key use karein.');
  if (json.Information) {
    const info = String(json.Information);
    if (info.toLowerCase().includes('rate') || info.toLowerCase().includes('premium') || info.toLowerCase().includes('request')) {
      throw new Error('Alpha Vantage free API limit hit ho gaya. Free plan me requests limited hoti hain, isliye abhi live decision nahi ban paya.');
    }
    throw new Error(info);
  }
  if (json['Error Message']) throw new Error('Symbol galat ho sakta hai. Example: RELIANCE.BSE');

  const key = Object.keys(json).find(k => k.includes('Time Series'));
  if (!key || !json[key]) throw new Error('Alpha Vantage se price series nahi mili.');
  return parseAlphaSeries(json[key], range);
}

function alphaInterval(interval) {
  if (interval === '1m') return '1min';
  if (interval === '5m') return '5min';
  if (interval === '15m') return '15min';
  return '5min';
}

function parseAlphaSeries(series, range) {
  const rows = Object.entries(series).map(([date, row]) => ({
    date,
    open: num(row['1. open']),
    high: num(row['2. high']),
    low: num(row['3. low']),
    close: num(row['4. close']),
    volume: num(row['5. volume'])
  })).filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const maxRows = { '1d': 120, '5d': 160, '1mo': 220, '3mo': 90, '6mo': 140, '1y': 260 }[range] || 140;
  return rows.slice(-maxRows);
}

function toggleLiveMode() {
  if (state.liveOn) {
    stopLiveMode();
    return;
  }
  let interval = compatibleInterval(el('timeRange').value, el('timeInterval').value);
  if (interval === '1m' || interval === '5m') {
    interval = '15m';
    el('timeInterval').value = interval;
    el('smartStatus').textContent = 'Free Smart Mode ne refresh 15 minute kar diya, request bachane ke liye.';
  }
  state.liveOn = true;
  el('liveBtn').textContent = 'Stop Live';
  el('liveBtn').classList.add('danger');
  loadLiveData();
  state.liveTimer = setInterval(loadLiveData, refreshMsForInterval(interval));
}

function stopLiveMode() {
  state.liveOn = false;
  el('liveBtn').textContent = 'Start Live';
  el('liveBtn').classList.remove('danger');
  if (state.liveTimer) clearInterval(state.liveTimer);
  state.liveTimer = null;
}

function syncIntervalForRange() {
  const range = el('timeRange').value;
  el('timeInterval').value = compatibleInterval(range, el('timeInterval').value);
  if (state.liveOn) {
    stopLiveMode();
    toggleLiveMode();
  }
}

function compatibleInterval(range, interval) {
  if (range === '1d') return ['1m', '5m', '15m'].includes(interval) ? interval : '5m';
  if (range === '5d') return ['5m', '15m'].includes(interval) ? interval : '5m';
  if (range === '1mo') return ['15m', '1d'].includes(interval) ? interval : '15m';
  return '1d';
}

function refreshMsForInterval(interval) {
  if (interval === '1m') return 60_000;
  if (interval === '5m') return 5 * 60_000;
  if (interval === '15m') return 15 * 60_000;
  return 10 * 60_000;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function requestState() {
  const saved = JSON.parse(localStorage.getItem('alphaRequestCounter') || '{}');
  if (saved.date !== todayKey()) return { date: todayKey(), count: 0 };
  return { date: saved.date, count: Number(saved.count) || 0 };
}

function dailyLimit() {
  return Math.max(1, Math.min(25, parseInt(el('dailyLimitInput')?.value || '20', 10) || 20));
}

function canUseApiRequest() {
  return requestState().count < dailyLimit();
}

function incrementRequestCounter() {
  const current = requestState();
  current.count += 1;
  localStorage.setItem('alphaRequestCounter', JSON.stringify(current));
  renderRequestCounter();
}

function resetRequestCounter() {
  localStorage.setItem('alphaRequestCounter', JSON.stringify({ date: todayKey(), count: 0 }));
  renderRequestCounter();
}

function renderRequestCounter() {
  const current = requestState();
  const limit = dailyLimit();
  if (el('requestCounter')) el('requestCounter').textContent = `Requests: ${current.count} / ${limit} today`;
  if (el('smartStatus')) {
    const left = Math.max(0, limit - current.count);
    el('smartStatus').textContent = left > 0
      ? `${left} request bachi hai. 15-minute refresh free plan ke liye best hai.`
      : 'Limit complete. Manual price ya CSV use karein.';
  }
}

function parseYahooChart(result) {
  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: quote.open?.[i],
    high: quote.high?.[i],
    low: quote.low?.[i],
    close: quote.close?.[i],
    volume: quote.volume?.[i]
  })).filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));
}

function handleCsvFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const candles = parseCsv(String(reader.result || ''));
      if (candles.length < 30) {
        alert('CSV me kam se kam 30 rows price data hona chahiye.');
        return;
      }
      useData(candles, `CSV import: ${file.name}`);
    } catch (error) {
      alert('CSV format sahi nahi mila. Format: Date, Open, High, Low, Close, Volume');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  const hasHeader = header.some(h => h.includes('close')) && header.some(h => h.includes('date'));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const idx = (key, fallback) => {
    if (!hasHeader) return fallback;
    const found = header.findIndex(h => h.includes(key));
    return found >= 0 ? found : fallback;
  };
  const columns = {
    date: idx('date', 0),
    open: idx('open', 1),
    high: idx('high', 2),
    low: idx('low', 3),
    close: idx('close', 4),
    volume: idx('volume', 5)
  };
  return dataLines.map(line => {
    const parts = splitCsvLine(line);
    return {
      date: parts[columns.date] || '',
      open: num(parts[columns.open]),
      high: num(parts[columns.high]),
      low: num(parts[columns.low]),
      close: num(parts[columns.close]),
      volume: num(parts[columns.volume])
    };
  }).filter(c => Number.isFinite(c.close)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) {
      out.push(cur.trim().replace(/^"|"$/g, ''));
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim().replace(/^"|"$/g, ''));
  return out;
}

function num(value) {
  const parsed = parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function useData(candles, source) {
  state.symbol = el('symbolInput').value.trim() || state.symbol;
  state.candles = candles;
  state.source = source;
  state.analysis = analyze(candles);
  renderAll();
}

function applyManualPrice() {
  if (!state.candles.length) {
    alert('Pehle demo, CSV, ya API se base data load karein.');
    return;
  }
  const price = num(el('manualPriceInput').value);
  if (!Number.isFinite(price) || price <= 0) {
    alert('Valid current price daalein.');
    return;
  }
  const candles = state.candles.map(c => ({ ...c }));
  const last = { ...candles[candles.length - 1] };
  last.close = price;
  last.high = Math.max(last.high || price, price);
  last.low = Math.min(last.low || price, price);
  if (!Number.isFinite(last.open)) last.open = price;
  candles[candles.length - 1] = last;
  useData(candles, `${state.source} | Manual price ${money(price)} at ${new Date().toLocaleTimeString('en-IN')}`);
}

function analyze(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume || 0);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const avgVol20 = average(volumes.slice(-20));
  const volRatio = avgVol20 ? (last.volume || 0) / avgVol20 : 0;
  const lastSma20 = lastValue(sma20);
  const lastSma50 = lastValue(sma50);
  const lastRsi = lastValue(rsi14);
  const recent = candles.slice(-21, -1);
  const resistance = Math.max(...recent.map(c => c.high));
  const support = Math.min(...recent.map(c => c.low));
  const swingLow = Math.min(...candles.slice(-10).map(c => c.low));
  const changePct = prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0;

  const checks = [];
  addCheck(checks, last.close > lastSma20, 'Price SMA 20 ke upar', `Close ${money(last.close)} vs SMA20 ${money(lastSma20)}`);
  addCheck(checks, last.close > lastSma50, 'Price SMA 50 ke upar', `Close ${money(last.close)} vs SMA50 ${money(lastSma50)}`);
  addCheck(checks, lastSma20 > lastSma50, 'Short trend strong', `SMA20 ${money(lastSma20)} vs SMA50 ${money(lastSma50)}`);
  addCheck(checks, lastRsi >= 45 && lastRsi <= 68, 'RSI healthy zone', `RSI ${money(lastRsi)}`);
  addCheck(checks, volRatio >= 1.2, 'Volume support', `${volRatio.toFixed(2)}x 20-day average`);
  addCheck(checks, last.close > resistance, 'Breakout confirmed', `Resistance ${money(resistance)}`);

  let score = checks.filter(c => c.status === 'pass').length;
  if (lastRsi > 75) score -= 1;
  if (last.close < lastSma50) score -= 1;

  let signal = 'avoid';
  let headline = 'Nahi lena';
  let reason = 'Setup weak hai. Is stock me abhi fresh trade avoid karein.';
  if (score >= 5) {
    signal = 'ready';
    headline = 'Plan ke saath le sakte ho';
    reason = 'Trend, momentum aur volume me alignment dikh raha hai. Entry ke upar hi trade karein aur stop loss zaroor lagayein.';
  } else if (score >= 3) {
    signal = 'wait';
    headline = 'Abhi wait karo';
    reason = 'Setup ban raha hai, lekin clear confirmation abhi missing hai. Breakout ya volume confirmation ka wait karein.';
  }

  const entry = Math.max(last.close, resistance) * 1.001;
  const stop = Math.min(swingLow, lastSma20 || swingLow);
  const risk = Math.max(entry - stop, entry * 0.01);
  const target1 = entry + risk * 1.5;
  const target2 = entry + risk * 2.5;

  return {
    last,
    prev,
    closes,
    sma20,
    sma50,
    rsi14,
    lastSma20,
    lastSma50,
    lastRsi,
    avgVol20,
    volRatio,
    resistance,
    support,
    changePct,
    checks,
    score,
    signal,
    headline,
    reason,
    levels: { entry, stop, target1, target2 }
  };
}

function addCheck(checks, pass, title, detail) {
  checks.push({ status: pass ? 'pass' : 'fail', title, detail });
}

function sma(values, period) {
  return values.map((_, i) => {
    if (i + 1 < period) return null;
    return average(values.slice(i + 1 - period, i + 1));
  });
}

function rsi(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    gains += Math.max(diff, 0);
    losses += Math.max(-diff, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = ((avgGain * (period - 1)) + Math.max(diff, 0)) / period;
    avgLoss = ((avgLoss * (period - 1)) + Math.max(-diff, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : NaN;
}

function lastValue(values) {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return NaN;
}

function renderAll() {
  const a = state.analysis;
  if (!a) return;
  el('chartTitle').textContent = `${state.symbol || 'Stock'} Price Flow`;
  el('dataSource').textContent = `${state.source} | ${state.candles.length} candles`;
  showSignal(a.signal, a.headline, a.reason);
  el('actionText').textContent = actionLine(a);
  el('lastPrice').textContent = money(a.last.close);
  el('priceChange').textContent = pct(a.changePct);
  el('priceChange').className = a.changePct >= 0 ? 'positive' : 'negative';
  el('trendText').textContent = a.last.close > a.lastSma20 && a.lastSma20 > a.lastSma50 ? 'Bullish' : a.last.close < a.lastSma50 ? 'Weak' : 'Mixed';
  el('trendText').className = el('trendText').textContent === 'Bullish' ? 'positive' : el('trendText').textContent === 'Weak' ? 'negative' : 'neutral';
  el('trendDetail').textContent = `SMA20 ${money(a.lastSma20)} | SMA50 ${money(a.lastSma50)}`;
  el('rsiText').textContent = money(a.lastRsi);
  el('rsiText').className = a.lastRsi > 70 ? 'negative' : a.lastRsi >= 45 ? 'positive' : 'neutral';
  el('rsiDetail').textContent = a.lastRsi > 70 ? 'Overheated' : a.lastRsi < 40 ? 'Weak momentum' : 'Balanced';
  el('volumeText').textContent = `${a.volRatio.toFixed(2)}x`;
  el('volumeText').className = a.volRatio >= 1.2 ? 'positive' : 'neutral';
  el('volumeDetail').textContent = `Avg ${Math.round(a.avgVol20 || 0).toLocaleString('en-IN')}`;
  renderChecklist();
  renderLevels();
  drawChart();
  updateRiskCalculator();
}

function actionLine(a) {
  if (a.signal === 'ready') {
    return `Action: ${money(a.levels.entry)} ke upar entry consider karein. Stop ${money(a.levels.stop)} ke neeche strict exit.`;
  }
  if (a.signal === 'wait') {
    return `Action: Watchlist me rakhein. ${money(a.resistance)} ke upar strong close/volume ka wait.`;
  }
  return `Action: Fresh buying avoid. Pehle price SMA20/SMA50 ke upar stable hona chahiye.`;
}

function showSignal(kind, title, reason, action = '') {
  const panel = el('signalPanel');
  panel.className = `signal-panel ${kind}`;
  el('signalText').textContent = title;
  el('signalReason').textContent = reason;
  if (action) el('actionText').textContent = action;
}

function renderChecklist() {
  el('checklist').innerHTML = state.analysis.checks.map(item => `
    <div class="check-item ${item.status}">
      <span class="dot"></span>
      <div><strong>${item.title}</strong><small>${item.detail}</small></div>
    </div>
  `).join('');
}

function renderLevels() {
  const levels = state.analysis.levels;
  el('entryLevel').textContent = money(levels.entry);
  el('stopLevel').textContent = money(levels.stop);
  el('targetOne').textContent = money(levels.target1);
  el('targetTwo').textContent = money(levels.target2);
  el('manualEntry').value = levels.entry.toFixed(2);
  el('manualStop').value = levels.stop.toFixed(2);
}

function updateRiskCalculator() {
  const capital = num(el('capitalInput').value);
  const riskPct = num(el('riskInput').value);
  const entry = num(el('manualEntry').value);
  const stop = num(el('manualStop').value);
  const riskPerShare = Math.abs(entry - stop);
  const riskAmount = capital * (riskPct / 100);
  const qty = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  el('riskAmount').textContent = money(riskAmount);
  el('riskQty').textContent = qty > 0 ? qty.toLocaleString('en-IN') : '-';
  el('capitalUsed').textContent = qty > 0 ? money(qty * entry) : '-';
}

function drawChart() {
  const canvas = el('priceChart');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(700, rect.width * dpr);
  canvas.height = Math.max(320, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  const candles = state.candles.slice(-100);
  const offset = state.candles.length - candles.length;
  const sma20 = state.analysis.sma20.slice(offset);
  const sma50 = state.analysis.sma50.slice(offset);
  const prices = candles.flatMap(c => [c.high, c.low]).filter(Number.isFinite);
  const min = Math.min(...prices) * 0.995;
  const max = Math.max(...prices) * 1.005;
  const left = 52;
  const right = 18;
  const top = 22;
  const bottom = 48;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const x = (i) => left + (i / Math.max(1, candles.length - 1)) * plotW;
  const y = (v) => top + ((max - v) / (max - min)) * plotH;

  ctx.strokeStyle = '#e3eaf4';
  ctx.lineWidth = 1;
  ctx.font = '12px Segoe UI';
  ctx.fillStyle = '#607086';
  for (let i = 0; i <= 4; i++) {
    const py = top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(width - right, py);
    ctx.stroke();
    const label = max - ((max - min) / 4) * i;
    ctx.fillText(money(label), 8, py + 4);
  }

  drawSeries(ctx, candles.map(c => c.close), x, y, '#1565c0', 2.4);
  drawSeries(ctx, sma20, x, y, '#12805c', 1.8);
  drawSeries(ctx, sma50, x, y, '#6d3fc0', 1.8);

  const barW = Math.max(2, plotW / candles.length * 0.42);
  const maxVol = Math.max(...candles.map(c => c.volume || 0));
  candles.forEach((c, i) => {
    const h = maxVol ? ((c.volume || 0) / maxVol) * 42 : 0;
    ctx.fillStyle = c.close >= c.open ? 'rgba(18,128,92,0.28)' : 'rgba(198,40,40,0.24)';
    ctx.fillRect(x(i) - barW / 2, height - bottom - h, barW, h);
  });

  ctx.fillStyle = '#607086';
  const first = candles[0]?.date || '';
  const last = candles[candles.length - 1]?.date || '';
  ctx.fillText(first, left, height - 18);
  ctx.fillText(last, width - right - 82, height - 18);
}

function drawSeries(ctx, values, x, y, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  let started = false;
  values.forEach((value, i) => {
    if (!Number.isFinite(value)) return;
    if (!started) {
      ctx.moveTo(x(i), y(value));
      started = true;
    } else {
      ctx.lineTo(x(i), y(value));
    }
  });
  ctx.stroke();
}

function saveJournal() {
  if (!state.analysis) return;
  const note = el('journalNote').value.trim();
  const entries = getJournal();
  entries.unshift({
    time: new Date().toLocaleString('en-IN'),
    symbol: state.symbol,
    signal: state.analysis.headline,
    price: state.analysis.last.close,
    note
  });
  localStorage.setItem('stockFlowJournal', JSON.stringify(entries.slice(0, 20)));
  el('journalNote').value = '';
  renderJournal();
}

function getJournal() {
  try {
    return JSON.parse(localStorage.getItem('stockFlowJournal') || '[]');
  } catch {
    return [];
  }
}

function renderJournal() {
  const entries = getJournal();
  el('journalList').innerHTML = entries.length ? entries.map(row => `
    <div class="journal-row">
      <strong>${row.symbol} | ${row.signal} | ${money(row.price)}</strong>
      <small>${row.time}</small>
      <p>${row.note || 'No note added'}</p>
    </div>
  `).join('') : '<small>No journal saved yet.</small>';
}

function makeDemoCandles() {
  const candles = [];
  let close = 2450;
  const start = new Date();
  start.setDate(start.getDate() - 170);
  for (let i = 0; i < 150; i++) {
    const drift = i > 80 ? 4.4 : i > 40 ? 1.6 : -0.4;
    const wave = Math.sin(i / 5) * 12 + Math.cos(i / 13) * 9;
    const noise = (Math.sin(i * 2.17) + Math.cos(i * 1.31)) * 5;
    const open = close + noise * 0.35;
    close = Math.max(100, close + drift + wave * 0.08 + noise * 0.22);
    const high = Math.max(open, close) + 12 + Math.abs(noise);
    const low = Math.min(open, close) - 12 - Math.abs(noise * 0.8);
    const volume = Math.round(3400000 + Math.max(0, i - 100) * 36000 + Math.abs(wave) * 42000);
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    candles.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume
    });
  }
  return candles;
}

window.addEventListener('resize', () => {
  if (state.candles.length) drawChart();
});

init();
