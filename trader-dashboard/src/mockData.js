// Realistic base prices and volatility profiles per symbol
const PROFILES = {
  SPY:  { price: 542.0,  vol: 0.008, beta: 1.0,  sector: "ETF" },
  QQQ:  { price: 462.0,  vol: 0.011, beta: 1.2,  sector: "ETF" },
  AAPL: { price: 213.0,  vol: 0.013, beta: 1.1,  sector: "Tech" },
  NVDA: { price: 875.0,  vol: 0.028, beta: 1.7,  sector: "Semi" },
  TSLA: { price: 248.0,  vol: 0.035, beta: 2.1,  sector: "EV" },
  AMD:  { price: 158.0,  vol: 0.025, beta: 1.6,  sector: "Semi" },
  MSFT: { price: 415.0,  vol: 0.012, beta: 0.9,  sector: "Tech" },
  META: { price: 512.0,  vol: 0.018, beta: 1.3,  sector: "Tech" },
  UAL:  { price: 68.0,   vol: 0.022, beta: 1.4,  sector: "Air" },
  CCL:  { price: 19.5,   vol: 0.025, beta: 1.5,  sector: "Cruise" },
  XOM:  { price: 112.0,  vol: 0.014, beta: 0.8,  sector: "Energy" },
  GLD:  { price: 224.0,  vol: 0.009, beta: 0.1,  sector: "Gold" },
};

// Seeded PRNG for consistent-but-varied data per session
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const SESSION_SEED = Date.now() & 0xFFFFFF;

export function generateMockQuote(symbol) {
  const profile = PROFILES[symbol];
  if (!profile) return null;

  const rand = mulberry32(SESSION_SEED ^ symbol.charCodeAt(0) * 7919);

  // Generate 390 one-minute candles (one full trading day + some history)
  const candles = 390;
  const closes = [profile.price];
  const highs = [profile.price * (1 + profile.vol * 0.5)];
  const lows = [profile.price * (1 - profile.vol * 0.5)];
  const volumes = [Math.floor(200000 + rand() * 800000)];

  // Add slight directional drift so not all symbols look the same
  const drift = (rand() - 0.48) * 0.0002;

  for (let i = 1; i < candles; i++) {
    const prev = closes[i - 1];
    const change = prev * (drift + (rand() - 0.5) * profile.vol * 0.3);
    const close = Math.max(prev * 0.85, prev + change);
    const range = prev * profile.vol * (0.3 + rand() * 0.7);
    highs.push(close + range * rand());
    lows.push(close - range * rand());
    closes.push(close);
    volumes.push(Math.floor(100000 + rand() * 600000));
  }

  const price = closes[closes.length - 1];
  const prevClose = closes[0];
  const change = price - prevClose;
  const changePct = (change / prevClose) * 100;

  // Technical indicators (reuse the same math as the main app)
  const k2 = (period) => {
    if (closes.length < period) return null;
    const kf = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * kf + ema * (1 - kf);
    return ema;
  };

  const ema9  = k2(9);
  const ema20 = k2(20);
  const ema50 = k2(50);

  // RSI
  let gains = 0, losses = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = gains / (losses || 0.001);
  const rsi = 100 - 100 / (1 + rs);

  // MACD
  const ema12 = k2(12);
  const ema26 = k2(26);
  const macd = ema12 != null && ema26 != null ? ema12 - ema26 : null;

  // ATR
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atr = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;

  // VWAP
  const slice78c = closes.slice(-78);
  const slice78v = volumes.slice(-78);
  let pvSum = 0, vSum = 0;
  for (let i = 0; i < slice78c.length; i++) { pvSum += slice78c[i] * slice78v[i]; vSum += slice78v[i]; }
  const vwap = vSum > 0 ? pvSum / vSum : null;

  // Bollinger
  const bbSlice = closes.slice(-20);
  const bbMean = bbSlice.reduce((a, b) => a + b, 0) / 20;
  const bbVar = bbSlice.reduce((a, b) => a + (b - bbMean) ** 2, 0) / 20;
  const bbSd = Math.sqrt(bbVar);
  const bbUpper = bbMean + 2 * bbSd;
  const bbLower = bbMean - 2 * bbSd;
  const bb = { pos: (price - bbLower) / (bbUpper - bbLower), upper: bbUpper, lower: bbLower, mean: bbMean };

  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const curVol = volumes[volumes.length - 1];
  const volRatio = avgVol ? curVol / avgVol : null;

  const recent5 = closes.slice(-5);
  const momentum5 = ((recent5[4] - recent5[0]) / recent5[0]) * 100;

  const high52 = Math.max(...closes) * (1 + rand() * 0.08);
  const low52  = Math.min(...closes) * (1 - rand() * 0.08);
  const dayHigh = Math.max(...highs.slice(-78));
  const dayLow  = Math.min(...lows.slice(-78));

  return {
    symbol, price, change, changePct, prevClose,
    high52, low52, dayHigh, dayLow,
    volume: curVol,
    rsi, macd, ema9, ema20, ema50, atr, vwap, volRatio, bb, momentum5,
    sparkline: closes.slice(-30),
    closes, highs, lows, volumes,
    marketState: "SIMULATED",
    lastFetched: Date.now(),
    isMock: true,
  };
}
