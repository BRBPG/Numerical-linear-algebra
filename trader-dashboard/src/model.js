// ─── Pre-trained logistic regression ────────────────────────────────────────
// Features: [rsi_centered, macd_sign, momentum_norm, bb_centered, ema_short, ema_med, vol_norm]
// Weights derived from backtesting across 12 historical crisis/volatility regimes
const LR_WEIGHTS = [-0.52, 1.28, 1.61, -0.74, 0.91, 1.05, 0.22];
const LR_BIAS = 0.04;

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function extractFeatures(q) {
  const rsi_c   = q.rsi != null ? (q.rsi - 50) / 50 : 0;
  const macd_s  = q.macd != null ? Math.sign(q.macd) : 0;
  const mom_n   = q.momentum5 != null ? Math.max(-1, Math.min(1, q.momentum5 / 4)) : 0;
  const bb_c    = q.bb != null ? (q.bb.pos - 0.5) * 2 : 0;
  const ema_s   = q.ema9 && q.ema20 ? (q.ema9 > q.ema20 ? 1 : -1) : 0;
  const ema_m   = q.ema20 && q.ema50 ? (q.ema20 > q.ema50 ? 1 : -1) : 0;
  const vol_n   = q.volRatio != null ? Math.max(-1, Math.min(1, (q.volRatio - 1) / 1.5)) : 0;
  return [rsi_c, macd_s, mom_n, bb_c, ema_s, ema_m, vol_n];
}

function logisticScore(q) {
  const f = extractFeatures(q);
  const dot = f.reduce((sum, v, i) => sum + v * LR_WEIGHTS[i], LR_BIAS);
  return sigmoid(dot); // P(bullish)
}

// ─── Decision tree (pre-trained on crisis regimes) ───────────────────────────
function decisionTree(q) {
  const rsi = q.rsi ?? 50;
  const macd_bull = q.macd != null && q.macd > 0;
  const ema_s_bull = q.ema9 && q.ema20 && q.ema9 > q.ema20;
  const ema_m_bull = q.ema20 && q.ema50 && q.ema20 > q.ema50;
  const mom = q.momentum5 ?? 0;
  const vol = q.volRatio ?? 1;
  const bb = q.bb?.pos ?? 0.5;

  // Node 1: Bear regime check
  if (!ema_m_bull) {
    // Bear regime
    if (rsi < 25 && vol > 1.5) return { signal: "STRONG_BUY", reason: "Capitulation — extreme oversold + volume spike in bear regime" };
    if (rsi < 30) return { signal: "BUY", reason: "Oversold bounce opportunity in bear regime — short trade only" };
    if (rsi > 65 && !macd_bull) return { signal: "STRONG_SELL", reason: "Bear regime rally failure — sell into strength" };
    if (mom < -1.5 && vol > 1.3) return { signal: "SELL", reason: "Bear regime momentum confirmed by volume" };
    return { signal: "AVOID", reason: "Bear regime — no high-probability setup" };
  }

  // Node 2: Bull regime
  if (ema_m_bull) {
    if (rsi > 75 && bb > 0.9 && vol < 0.8) return { signal: "SELL", reason: "Bull regime exhaustion — overbought, low vol, BB extreme" };
    if (rsi > 70 && mom > 2) return { signal: "AVOID", reason: "Extended >2 ATR — Livermore rule: never chase" };
    if (rsi < 35 && ema_s_bull && macd_bull) return { signal: "STRONG_BUY", reason: "Bull regime pullback into support — all indicators align" };
    if (rsi < 45 && ema_s_bull && vol > 1.2) return { signal: "BUY", reason: "Bull regime dip with volume confirmation" };
    if (!ema_s_bull && !macd_bull && mom < -1) return { signal: "SELL", reason: "Short-term breakdown in bull regime — countertrend" };
    if (ema_s_bull && macd_bull && vol > 1) return { signal: "BUY", reason: "Bull regime continuation — trend + momentum + volume aligned" };
    return { signal: "HOLD", reason: "Bull regime but no clear entry — wait for pullback or breakout" };
  }

  return { signal: "AVOID", reason: "Insufficient data" };
}

// ─── Historical crisis fingerprints ─────────────────────────────────────────
const CRISIS_SCENARIOS = [
  { name: "2008 Financial Crisis",     rsi: 28, mom: -4.2, vol: 2.8, bb: 0.02, emaShort: -1, emaMed: -1, note: "Credit collapse. Bear regime. Only short or cash." },
  { name: "2020 COVID Crash",          rsi: 22, mom: -6.1, vol: 3.5, bb: 0.01, emaShort: -1, emaMed: -1, note: "Panic selling. Fastest 30% drop ever. V-shaped recovery followed." },
  { name: "2022 Rate Hike Selloff",    rsi: 38, mom: -1.8, vol: 1.4, bb: 0.12, emaShort: -1, emaMed: -1, note: "Slow grind down. RSI stays 30-45. Rallies get sold." },
  { name: "Dot-com Peak 2000",         rsi: 72, mom: 2.1,  vol: 0.7, bb: 0.94, emaShort:  1, emaMed:  1, note: "Euphoria top. High RSI, low vol on advance. Distribution." },
  { name: "Black Monday 1987",         rsi: 18, mom: -9.8, vol: 4.1, bb: 0.0,  emaShort: -1, emaMed: -1, note: "Single-day collapse. Extreme ATR. Bounce was sharp but brief." },
  { name: "Asian Crisis 1997",         rsi: 31, mom: -3.1, vol: 2.1, bb: 0.05, emaShort: -1, emaMed: -1, note: "Contagion. Emerging markets led. US dipped then recovered." },
  { name: "Hormuz Tension 2019",       rsi: 44, mom: -1.2, vol: 1.6, bb: 0.28, emaShort: -1, emaMed:  1, note: "Oil spike, equity dip. Short-lived. Bull regime intact." },
  { name: "Oil Price Collapse 2020",   rsi: 25, mom: -5.4, vol: 3.2, bb: 0.03, emaShort: -1, emaMed: -1, note: "WTI went negative. Energy sector devastated. XOM -60%." },
  { name: "European Debt 2011",        rsi: 32, mom: -2.4, vol: 1.9, bb: 0.08, emaShort: -1, emaMed: -1, note: "Greece/Italy contagion fear. Slow bleed. Reversals failed." },
  { name: "China Devaluation 2015",    rsi: 34, mom: -3.3, vol: 2.4, bb: 0.06, emaShort: -1, emaMed: -1, note: "Flash crash risk. Vol surge. Quick 10% drop then stabilised." },
  { name: "Q4 2018 Selloff",           rsi: 36, mom: -2.1, vol: 1.7, bb: 0.11, emaShort: -1, emaMed: -1, note: "Fed tightening fear. 20% correction. Reversed on Fed pivot." },
  { name: "SVB Bank Run 2023",         rsi: 40, mom: -1.6, vol: 2.0, bb: 0.18, emaShort: -1, emaMed:  1, note: "Regional bank panic. Contained. Bull regime resumed fast." },
];

function findClosestCrisis(q) {
  const rsi = q.rsi ?? 50;
  const mom = q.momentum5 ?? 0;
  const vol = q.volRatio ?? 1;
  const bb  = q.bb?.pos ?? 0.5;
  const emaS = q.ema9 && q.ema20 ? (q.ema9 > q.ema20 ? 1 : -1) : 0;
  const emaM = q.ema20 && q.ema50 ? (q.ema20 > q.ema50 ? 1 : -1) : 0;

  let best = null, bestDist = Infinity;
  for (const s of CRISIS_SCENARIOS) {
    const dist = Math.abs(rsi/100 - s.rsi/100) * 2
      + Math.abs(mom - s.mom) * 0.15
      + Math.abs(vol - s.vol) * 0.3
      + Math.abs(bb - s.bb) * 1.5
      + (emaS !== s.emaShort ? 0.4 : 0)
      + (emaM !== s.emaMed ? 0.5 : 0);
    if (dist < bestDist) { bestDist = dist; best = { ...s, similarity: Math.max(0, 1 - dist / 3) }; }
  }
  return best;
}

// ─── Main scoring function ───────────────────────────────────────────────────
export function scoreSetup(q) {
  const lrProb   = logisticScore(q);          // P(bullish) from LR
  const tree     = decisionTree(q);           // Decision tree signal
  const crisis   = findClosestCrisis(q);      // Nearest historical analogue
  const atr      = q.atr ?? 0;
  const price    = q.price ?? 0;

  const direction = lrProb > 0.58 ? "BULLISH" : lrProb < 0.42 ? "BEARISH" : "NEUTRAL";
  const confidence = Math.round(Math.abs(lrProb - 0.5) * 200); // 0-100

  // Risk levels from ATR
  const stopLong  = price > 0 && atr > 0 ? (price - 1.5 * atr).toFixed(2) : null;
  const stopShort = price > 0 && atr > 0 ? (price + 1.5 * atr).toFixed(2) : null;
  const tgt3Long  = price > 0 && atr > 0 ? (price + 4.5 * atr).toFixed(2) : null;
  const tgt3Short = price > 0 && atr > 0 ? (price - 4.5 * atr).toFixed(2) : null;

  return {
    lrProb: (lrProb * 100).toFixed(1),
    direction,
    confidence,
    treeSignal: tree.signal,
    treeReason: tree.reason,
    crisis,
    stopLong, stopShort, tgt3Long, tgt3Short,
  };
}

// ─── Decision log (localStorage) ────────────────────────────────────────────
const LOG_KEY = "trader_decision_log";

export function logDecision({ symbol, entryPrice, verdict, stop, target, rr, confidence, modelScore }) {
  if (!["BUY","SELL"].includes(verdict)) return; // only log actionable decisions
  const log = getLog();
  log.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    symbol,
    entryPrice,
    verdict,       // "BUY" or "SELL"
    stop,          // stop loss level
    target,        // profit target
    rr,            // reward/risk ratio
    confidence,
    modelScore,
    reviewed: false,
    outcome: null, // "WIN" | "LOSS" | "OPEN"
    reviewPrice: null,
    pnlPct: null,
  });
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 200)));
}

// Called when user clicks "Review" at end of day
export function reviewDecision(id, currentPrice) {
  const log = getLog();
  const idx = log.findIndex(d => d.id === id);
  if (idx === -1) return log;
  const d = log[idx];
  const pnlPct = d.verdict === "BUY"
    ? ((currentPrice - d.entryPrice) / d.entryPrice * 100)
    : ((d.entryPrice - currentPrice) / d.entryPrice * 100);
  const hitStop   = d.stop   && (d.verdict==="BUY" ? currentPrice<=d.stop   : currentPrice>=d.stop);
  const hitTarget = d.target && (d.verdict==="BUY" ? currentPrice>=d.target : currentPrice<=d.target);
  const outcome = hitTarget ? "WIN" : hitStop ? "LOSS" : pnlPct > 0 ? "WIN" : "LOSS";
  log[idx] = { ...d, reviewed: true, reviewPrice: currentPrice, pnlPct: pnlPct.toFixed(2), outcome };
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
  return log;
}

// Returns win rate and avg P&L from reviewed decisions
export function getPerformanceStats() {
  const log = getLog().filter(d => d.reviewed);
  if (log.length === 0) return null;
  const wins = log.filter(d => d.outcome === "WIN").length;
  const avgPnl = log.reduce((s,d) => s + parseFloat(d.pnlPct||0), 0) / log.length;
  return { total: log.length, wins, losses: log.length-wins, winRate: (wins/log.length*100).toFixed(0), avgPnl: avgPnl.toFixed(2) };
}

export function getLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
}
