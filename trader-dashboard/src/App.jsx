import { useState, useRef, useEffect, useCallback } from "react";
import { generateMockQuote } from "./mockData";

const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

const WATCHLIST = ["SPY","QQQ","AAPL","NVDA","TSLA","AMD","MSFT","META","UAL","CCL","XOM","GLD"];

const SYSTEM_PROMPT = `You are THE TRADER — a composite AI persona of history's greatest traders: Jesse Livermore, Paul Tudor Jones, Richard Dennis, Jim Simons, and Larry Williams.

Analyze the provided market data and give a clear trading assessment with:
📊 TAPE READING (price action observation)
🎯 SETUP (entry, stop, target, R/R)
🧠 TRADER CONSENSUS (which legends agree/disagree and why)
⚡ VERDICT (one line: what to do right now)
⚠️ RISK CHECK (one line)

Rules: Never recommend chasing moves >2 ATR extended. Always define stop before entry. If R/R below 3:1, say AVOID. Keep it sharp and fast.`;

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  return 100 - 100 / (1 + gains / (losses || 0.001));
}

function calcMACD(closes) {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  return e12 != null && e26 != null ? e12 - e26 : null;
}

function calcATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++)
    trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcVWAP(prices, volumes) {
  let pv = 0, v = 0;
  for (let i = 0; i < prices.length; i++) { pv += prices[i]*(volumes[i]||0); v += volumes[i]||0; }
  return v > 0 ? pv / v : null;
}

function calcBB(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const sl = closes.slice(-period);
  const mean = sl.reduce((a,b)=>a+b,0)/period;
  const sd = Math.sqrt(sl.reduce((a,b)=>a+(b-mean)**2,0)/period);
  const upper = mean+mult*sd, lower = mean-mult*sd;
  const price = closes[closes.length-1];
  return { pos:(price-lower)/(upper-lower), upper, lower, mean };
}

async function fetchWithFallback(symbol) {
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=5d`;
  // Vite dev proxy (no CORS in dev mode)
  try {
    const path = `/yf/v8/finance/chart/${symbol}?interval=5m&range=5d`;
    const r = await fetch(path, { signal: AbortSignal.timeout(5000) });
    if (r.ok) return JSON.parse(await r.text());
  } catch {}
  // CORS proxy fallback
  for (const proxy of PROXIES) {
    try {
      const r = await fetch(proxy(yfUrl), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      return JSON.parse(await r.text());
    } catch {}
  }
  return null;
}

async function fetchQuote(symbol) {
  try {
    const data = await fetchWithFallback(symbol);
    const result = data?.chart?.result?.[0];
    if (!result) return generateMockQuote(symbol);
    const meta = result.meta;
    const q = result.indicators.quote[0];
    const closes = (q.close||[]).filter(v=>v!=null);
    const highs = (q.high||[]).filter(v=>v!=null);
    const lows = (q.low||[]).filter(v=>v!=null);
    const volumes = (q.volume||[]).filter(v=>v!=null);
    const price = meta.regularMarketPrice ?? closes[closes.length-1];
    const prevClose = meta.chartPreviousClose ?? meta.previousClose;
    const change = price - prevClose;
    const changePct = (change/prevClose)*100;
    const avgVol = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
    const curVol = volumes[volumes.length-1]||0;
    const recent5 = closes.slice(-5);
    return {
      symbol, price, change, changePct, prevClose,
      high52: meta.fiftyTwoWeekHigh, low52: meta.fiftyTwoWeekLow,
      dayHigh: meta.regularMarketDayHigh, dayLow: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume||curVol,
      rsi: calcRSI(closes), macd: calcMACD(closes),
      ema9: calcEMA(closes,9), ema20: calcEMA(closes,20), ema50: calcEMA(closes,50),
      atr: calcATR(highs,lows,closes),
      vwap: calcVWAP(closes.slice(-78), volumes.slice(-78)),
      volRatio: avgVol ? curVol/avgVol : null,
      bb: calcBB(closes),
      momentum5: recent5.length===5 ? ((recent5[4]-recent5[0])/recent5[0])*100 : null,
      sparkline: closes.slice(-30), closes, highs, lows, volumes,
      marketState: meta.marketState, lastFetched: Date.now(), isMock: false,
    };
  } catch {
    return generateMockQuote(symbol);
  }
}

function Sparkline({ data, up, width=80, height=28 }) {
  if (!data||data.length<2) return null;
  const min=Math.min(...data), max=Math.max(...data), range=max-min||1;
  const pts = data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-min)/range)*height}`).join(" ");
  return (
    <svg width={width} height={height} style={{display:"block"}}>
      <polyline points={pts} fill="none" stroke={up?"#2ECC71":"#E74C3C"} strokeWidth="1.5" opacity="0.85"/>
    </svg>
  );
}

function RSIBar({ rsi }) {
  if (rsi==null) return <span style={{color:"#555",fontSize:10}}>—</span>;
  const color = rsi>70?"#E74C3C":rsi<30?"#2ECC71":"#C9A84C";
  return (
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <div style={{width:44,height:5,background:"#222",borderRadius:2,overflow:"hidden"}}>
        <div style={{width:`${rsi}%`,height:"100%",background:color}}/>
      </div>
      <span style={{fontSize:9,color,letterSpacing:1}}>{rsi.toFixed(0)} {rsi>70?"OB":rsi<30?"OS":"NEU"}</span>
    </div>
  );
}

function ApiKeyModal({ onSave }) {
  const [key, setKey] = useState(()=>localStorage.getItem("anthropic_key")||"");
  const valid = key.startsWith("sk-");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
      <div style={{background:"#0F0F0F",border:"1px solid #C9A84C",padding:28,width:380}}>
        <div style={{fontSize:14,fontWeight:900,color:"#C9A84C",letterSpacing:3,marginBottom:8}}>◈ API KEY REQUIRED</div>
        <div style={{fontSize:10,color:"#666",marginBottom:16,lineHeight:1.7}}>
          Enter your Anthropic API key to enable AI analysis.<br/>Stored locally in your browser only.
        </div>
        <input
          value={key} onChange={e=>setKey(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&valid&&(localStorage.setItem("anthropic_key",key),onSave(key))}
          placeholder="sk-ant-..."
          style={{width:"100%",boxSizing:"border-box",background:"#080808",border:"1px solid #2A2A2A",
            color:"#D8D0C0",fontFamily:"'Courier New',monospace",fontSize:12,padding:"9px 12px",
            outline:"none",marginBottom:12}}
        />
        <button
          onClick={()=>{if(valid){localStorage.setItem("anthropic_key",key);onSave(key);}}}
          disabled={!valid}
          style={{width:"100%",background:valid?"#C9A84C":"#1A1A1A",color:valid?"#000":"#444",
            border:"none",fontFamily:"'Courier New',monospace",fontWeight:900,fontSize:11,
            letterSpacing:2,padding:10,cursor:valid?"pointer":"not-allowed"}}
        >SAVE &amp; CONNECT</button>
        <div style={{fontSize:9,color:"#444",marginTop:10}}>Get a key at console.anthropic.com · Not financial advice.</div>
      </div>
    </div>
  );
}

function buildContext(quotes, selected) {
  const q = quotes[selected];
  if (!q) return `[No data for ${selected}]`;
  const pct52 = q.high52&&q.low52 ? ((q.price-q.low52)/(q.high52-q.low52)*100).toFixed(0) : "?";
  const stopL = q.atr ? (q.price-1.5*q.atr).toFixed(2) : "?";
  const stopS = q.atr ? (q.price+1.5*q.atr).toFixed(2) : "?";
  const tgtL  = q.atr ? (q.price+4.5*q.atr).toFixed(2) : "?";
  const tgtS  = q.atr ? (q.price-4.5*q.atr).toFixed(2) : "?";
  const snapshot = Object.values(quotes).map(d=>
    `${d.symbol.padEnd(5)} $${d.price?.toFixed(2).padStart(8)} ${(d.changePct>=0?"+":"")+d.changePct?.toFixed(2)}%  RSI:${d.rsi?.toFixed(0)||"?"}  Vol:${d.volRatio?.toFixed(1)||"?"}x`
  ).join("\n");
  return `=== LIVE DATA ${q.isMock?"(SIMULATED)":""} — ${new Date().toLocaleTimeString()} ===
SYMBOL: ${selected}  Price: $${q.price?.toFixed(2)}  Change: ${q.changePct>=0?"+":""}${q.changePct?.toFixed(2)}%
52W Range: $${q.low52?.toFixed(2)}–$${q.high52?.toFixed(2)} (${pct52}th pct)
RSI: ${q.rsi?.toFixed(1)||"N/A"}  MACD: ${q.macd?.toFixed(3)||"N/A"} (${q.macd>0?"BULL":"BEAR"})
EMA9: $${q.ema9?.toFixed(2)||"N/A"}  EMA20: $${q.ema20?.toFixed(2)||"N/A"}  EMA50: $${q.ema50?.toFixed(2)||"N/A"}
VWAP: $${q.vwap?.toFixed(2)||"N/A"}  ATR: $${q.atr?.toFixed(2)||"N/A"}  Vol: ${q.volRatio?.toFixed(1)||"N/A"}x avg
BB pos: ${q.bb?(q.bb.pos*100).toFixed(0)+"% of range":"N/A"}
Suggested LONG: entry $${q.price?.toFixed(2)}, stop $${stopL}, target $${tgtL}
Suggested SHORT: entry $${q.price?.toFixed(2)}, stop $${stopS}, target $${tgtS}
Last 10 closes: ${q.closes?.slice(-10).map(c=>"$"+c?.toFixed(2)).join(", ")||"N/A"}
=== WATCHLIST ===\n${snapshot}`;
}

export default function App() {
  const [quotes, setQuotes] = useState({});
  const [selected, setSelected] = useState("SPY");
  const [messages, setMessages] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("chat");
  const [apiKey, setApiKey] = useState(()=>localStorage.getItem("anthropic_key")||"");
  const chatRef = useRef(null);

  const refreshAll = useCallback(async (silent=false) => {
    if (!silent) setRefreshing(true);
    const results = await Promise.all(WATCHLIST.map(fetchQuote));
    const map = {};
    results.forEach((r,i)=>{ if(r) map[WATCHLIST[i]]=r; });
    setQuotes(prev=>({...prev,...map}));
    setLastRefresh(Date.now());
    if (!silent) setRefreshing(false);
  }, []);

  useEffect(() => {
    refreshAll();
    const id = setInterval(()=>refreshAll(true), 30000);
    return ()=>clearInterval(id);
  }, [refreshAll]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, thinking]);

  async function sendToAI(userText) {
    setThinking(true);
    const context = buildContext(quotes, selected);
    const fullContent = `${context}\n\nUSER: ${userText}`;
    const newHistory = [...chatHistory, { role:"user", content:fullContent }];
    setChatHistory(newHistory);
    setMessages(prev=>[...prev, { type:"user", text:userText }]);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages: newHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok||data.error) {
        setMessages(prev=>[...prev,{type:"bot",text:`⚠️ API error: ${data.error?.message||`HTTP ${res.status}`}`}]);
        setThinking(false); return;
      }
      const reply = data.content?.filter(b=>b.type==="text").map(b=>b.text).join("\n")||"No response.";
      setChatHistory(prev=>[...prev,{role:"assistant",content:reply}]);
      setMessages(prev=>[...prev,{type:"bot",text:reply}]);
    } catch(err) {
      setMessages(prev=>[...prev,{type:"bot",text:`⚠️ Connection failed: ${err.message}`}]);
    }
    setThinking(false);
  }

  function handleSend() {
    if (!input.trim()||thinking) return;
    const txt = input.trim(); setInput(""); sendToAI(txt);
  }

  const selQ = quotes[selected];
  const marketUp = selQ ? selQ.changePct>=0 : true;
  const loadedCount = Object.keys(quotes).length;
  const mockCount = Object.values(quotes).filter(q=>q.isMock).length;

  if (!apiKey) return <ApiKeyModal onSave={k=>setApiKey(k)}/>;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"#080808",
      color:"#D8D0C0",fontFamily:"'Courier New',monospace",overflow:"hidden"}}>

      {/* Header */}
      <div style={{background:"#0F0F0F",borderBottom:"1px solid #1E1E1E",padding:"8px 14px",
        display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <div style={{fontSize:18,fontWeight:900,color:"#C9A84C",letterSpacing:4}}>◈ THE TRADER</div>
        <div style={{flex:1,fontSize:9,color:"#555",letterSpacing:2}}>Livermore · Tudor Jones · Dennis · Simons · Williams</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {mockCount>0&&<span style={{fontSize:9,color:"#C9A84C",letterSpacing:1}}>SIM {mockCount}/{loadedCount}</span>}
          <div style={{width:6,height:6,borderRadius:"50%",
            background:refreshing?"#C9A84C":loadedCount>0?"#2ECC71":"#555",animation:"pulse 2s infinite"}}/>
          <span style={{fontSize:9,color:"#555",letterSpacing:1}}>
            {lastRefresh?`${loadedCount}/${WATCHLIST.length} · ${new Date(lastRefresh).toLocaleTimeString()}`:"CONNECTING..."}
          </span>
          <button onClick={()=>refreshAll()} style={{background:"#1A1A1A",border:"1px solid #2A2A2A",
            color:"#888",fontSize:9,padding:"3px 8px",cursor:"pointer",letterSpacing:1,fontFamily:"inherit"}}>
            ↻ REFRESH
          </button>
          <button onClick={()=>setApiKey("")} style={{background:"#1A1A1A",border:"1px solid #2A2A2A",
            color:"#555",fontSize:9,padding:"3px 8px",cursor:"pointer",letterSpacing:1,fontFamily:"inherit"}}>
            KEY
          </button>
        </div>
      </div>

      {/* Ticker */}
      <div style={{background:"#0C0C0C",borderBottom:"1px solid #1E1E1E",overflow:"hidden",height:24,flexShrink:0}}>
        <div style={{display:"flex",whiteSpace:"nowrap",height:"100%",alignItems:"center",
          animation:"ticker 35s linear infinite",fontSize:10,letterSpacing:"0.05em"}}>
          {[...WATCHLIST,...WATCHLIST].map((sym,i)=>{
            const q=quotes[sym]; const up=q?q.changePct>=0:true;
            return <span key={i} style={{marginRight:32,color:up?"#2ECC71":"#E74C3C",fontWeight:600}}>
              {up?"▲":"▼"} {sym} {q?`$${q.price?.toFixed(2)} (${q.changePct>=0?"+":""}${q.changePct?.toFixed(2)}%)`:"..."}
            </span>;
          })}
        </div>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* Watchlist */}
        <div style={{width:200,background:"#0C0C0C",borderRight:"1px solid #1A1A1A",overflowY:"auto",flexShrink:0}}>
          <div style={{padding:"8px 10px",fontSize:8,color:"#444",letterSpacing:2,borderBottom:"1px solid #1A1A1A"}}>
            WATCHLIST · {loadedCount}/{WATCHLIST.length}
          </div>
          {WATCHLIST.map(sym=>{
            const q=quotes[sym]; const up=q?q.changePct>=0:null; const isSel=sym===selected;
            return (
              <div key={sym} onClick={()=>setSelected(sym)} style={{padding:"8px 10px",cursor:"pointer",
                background:isSel?"#1A1500":"transparent",
                borderLeft:isSel?"2px solid #C9A84C":"2px solid transparent",borderBottom:"1px solid #111"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,fontWeight:700,color:isSel?"#C9A84C":"#CCC",letterSpacing:1}}>{sym}</span>
                  {q&&<span style={{fontSize:10,color:up?"#2ECC71":"#E74C3C",fontWeight:600}}>
                    {up?"+":""}{q.changePct?.toFixed(2)}%
                  </span>}
                </div>
                {q&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:2}}>
                  <span style={{fontSize:11,color:"#888"}}>${q.price?.toFixed(2)}</span>
                  <RSIBar rsi={q.rsi}/>
                </div>}
                {q&&<Sparkline data={q.sparkline} up={up} width={180} height={18}/>}
                {!q&&<div style={{fontSize:9,color:"#333",marginTop:4}}>loading...</div>}
                {q?.isMock&&<div style={{fontSize:8,color:"#555",letterSpacing:1}}>SIMULATED</div>}
              </div>
            );
          })}
        </div>

        {/* Main panel */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {selQ&&(
            <div style={{background:"#0F0F0F",borderBottom:"1px solid #1A1A1A",padding:"10px 14px",
              display:"flex",alignItems:"center",gap:16,flexShrink:0,flexWrap:"wrap"}}>
              <div>
                <span style={{fontSize:20,fontWeight:900,color:"#FFF",letterSpacing:2}}>{selected}</span>
                <span style={{fontSize:22,marginLeft:10,color:"#FFF"}}>${selQ.price?.toFixed(2)}</span>
                <span style={{fontSize:14,marginLeft:8,color:marketUp?"#2ECC71":"#E74C3C",fontWeight:700}}>
                  {marketUp?"▲":"▼"} {selQ.changePct>=0?"+":""}{selQ.changePct?.toFixed(2)}%
                </span>
                {selQ.isMock&&<span style={{fontSize:9,color:"#C9A84C",marginLeft:8,letterSpacing:1}}>SIMULATED</span>}
              </div>
              <div style={{display:"flex",gap:14,marginLeft:10,flexWrap:"wrap"}}>
                {[
                  ["RSI",selQ.rsi!=null?`${selQ.rsi.toFixed(0)}${selQ.rsi>70?" ⚠":selQ.rsi<30?" ✓":""}`:"-"],
                  ["MACD",selQ.macd!=null?(selQ.macd>0?"▲ BULL":"▼ BEAR"):"-"],
                  ["VWAP",selQ.vwap?`$${selQ.vwap.toFixed(2)}`:"-"],
                  ["ATR",selQ.atr?`$${selQ.atr.toFixed(2)}`:"-"],
                  ["VOL",selQ.volRatio?`${selQ.volRatio.toFixed(1)}x`:"-"],
                  ["BB",selQ.bb?`${(selQ.bb.pos*100).toFixed(0)}%`:"-"],
                ].map(([label,val])=>(
                  <div key={label} style={{textAlign:"center"}}>
                    <div style={{fontSize:8,color:"#555",letterSpacing:1}}>{label}</div>
                    <div style={{fontSize:11,color:"#C9A84C",fontWeight:700}}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{marginLeft:"auto"}}>
                <button onClick={()=>{setTab("chat");sendToAI(`Give me your full trading assessment on ${selected} right now.`);}}
                  disabled={thinking} style={{
                    background:thinking?"#1A1A1A":"#C9A84C",color:thinking?"#444":"#000",
                    border:"none",fontFamily:"'Courier New',monospace",fontWeight:900,
                    fontSize:11,letterSpacing:2,padding:"7px 14px",cursor:thinking?"not-allowed":"pointer"}}>
                  ⚡ ANALYZE NOW
                </button>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #1A1A1A",background:"#0C0C0C",flexShrink:0}}>
            {["chat","data"].map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{
                padding:"8px 16px",fontSize:9,letterSpacing:2,textTransform:"uppercase",
                background:tab===t?"#1A1A1A":"transparent",border:"none",
                borderBottom:tab===t?"2px solid #C9A84C":"2px solid transparent",
                color:tab===t?"#C9A84C":"#555",cursor:"pointer",fontFamily:"inherit"}}>
                {t==="chat"?"💬 ANALYSIS":"📊 RAW DATA"}
              </button>
            ))}
          </div>

          {tab==="data"&&(
            <div style={{flex:1,overflowY:"auto",padding:14,fontSize:11,color:"#888"}}>
              <pre style={{whiteSpace:"pre-wrap",fontFamily:"'Courier New',monospace",fontSize:11,margin:0}}>
                {buildContext(quotes,selected)}
              </pre>
            </div>
          )}

          {tab==="chat"&&(
            <>
              <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:12}}>
                {messages.length===0&&(
                  <div style={{textAlign:"center",padding:"40px 20px",color:"#333"}}>
                    <div style={{fontSize:28,marginBottom:10}}>📈</div>
                    <div style={{fontSize:12,color:"#555",letterSpacing:2,textTransform:"uppercase"}}>
                      Pick a symbol → ⚡ ANALYZE NOW<br/>or ask a question
                    </div>
                    <div style={{marginTop:20,display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
                      {["What's the strongest setup right now?",`Is ${selected} worth trading today?`,
                        "Which symbol has the best R/R?","Any short setups?","Where would Livermore enter SPY?"]
                        .map((c,i)=>(
                          <button key={i} onClick={()=>setInput(c)} style={{fontSize:10,padding:"5px 10px",
                            background:"#111",border:"1px solid #222",color:"#555",cursor:"pointer",fontFamily:"inherit"}}>
                            {c}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {messages.map((m,i)=>(
                  <div key={i} style={{display:"flex",gap:10,alignSelf:m.type==="user"?"flex-end":"flex-start",
                    maxWidth:"95%",flexDirection:m.type==="user"?"row-reverse":"row"}}>
                    <div style={{width:28,height:28,flexShrink:0,alignSelf:"flex-start",
                      background:m.type==="user"?"#0d1117":"#1A1500",
                      border:`1px solid ${m.type==="user"?"#222":"#C9A84C"}`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>
                      {m.type==="user"?"👤":"📈"}
                    </div>
                    <div style={{background:m.type==="user"?"#0d1117":"#111",border:"1px solid #1E1E1E",
                      borderLeft:m.type==="bot"?"3px solid #C9A84C":"1px solid #1E1E1E",
                      borderRight:m.type==="user"?"3px solid #333":"1px solid #1E1E1E",
                      padding:"10px 14px",fontSize:12,lineHeight:1.8,
                      color:m.type==="user"?"#888":"#D8D0C0",whiteSpace:"pre-wrap"}}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {thinking&&(
                  <div style={{display:"flex",gap:10}}>
                    <div style={{width:28,height:28,background:"#1A1500",border:"1px solid #C9A84C",
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>📈</div>
                    <div style={{background:"#111",border:"1px solid #1E1E1E",borderLeft:"3px solid #C9A84C",
                      padding:"12px 14px",display:"flex",gap:6,alignItems:"center"}}>
                      {[0,1,2].map(d=>(
                        <div key={d} style={{width:7,height:7,borderRadius:"50%",background:"#C9A84C",
                          animation:`dots 1.2s ease-in-out ${d*0.2}s infinite`}}/>
                      ))}
                      <span style={{fontSize:10,color:"#555",marginLeft:6,letterSpacing:1}}>READING THE TAPE...</span>
                    </div>
                  </div>
                )}
              </div>
              <div style={{background:"#0C0C0C",borderTop:"1px solid #1A1A1A",
                padding:"10px 14px",display:"flex",gap:8,flexShrink:0}}>
                <input value={input} onChange={e=>setInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&handleSend()}
                  placeholder={`Ask about ${selected}...`} disabled={thinking}
                  style={{flex:1,background:"#080808",border:"1px solid #1E1E1E",color:"#D8D0C0",
                    fontFamily:"'Courier New',monospace",fontSize:12,padding:"9px 12px",outline:"none"}}/>
                <button onClick={handleSend} disabled={thinking||!input.trim()} style={{
                  background:thinking||!input.trim()?"#1A1A1A":"#C9A84C",
                  color:thinking||!input.trim()?"#444":"#000",border:"none",
                  fontFamily:"'Courier New',monospace",fontWeight:900,fontSize:11,letterSpacing:2,
                  padding:"0 16px",cursor:thinking||!input.trim()?"not-allowed":"pointer",textTransform:"uppercase"}}>
                  SEND
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes dots{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#080808}
        ::-webkit-scrollbar-thumb{background:#2A2A2A}
      `}</style>
    </div>
  );
}
