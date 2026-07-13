"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = "";

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "$0.00";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(isoString) {
  if (!isoString) return "--:--:--";
  try {
    return new Date(isoString).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

export default function Dashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authError, setAuthError] = useState(false);
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [portfolio, setPortfolio] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [trades, setTrades] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [apiReachable, setApiReachable] = useState(true);
  const [flashDirection, setFlashDirection] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  const prevPlRef = useRef(null);
  const flashTimeoutRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const suppressNextSearchRef = useRef(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? sessionStorage.getItem("core_ai_token") : null;
    if (stored) {
      setAuthToken(stored);
      setIsAuthenticated(true);
    }
  }, []);

  const handleUnlock = useCallback(async (event) => {
    event?.preventDefault();
    setAuthLoading(true);
    setAuthError(false);
    setAuthErrorMessage("");
    try {
      let res;
      try {
        res = await fetch(`${API_BASE}/api/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: passwordInput }),
        });
      } catch (networkErr) {
        throw new Error(
          `Can't reach the server at ${API_BASE}. This is usually a mixed-content block (HTTPS page calling an HTTP API) or the backend being down.`
        );
      }
      if (res.status === 401) {
        throw new Error("Incorrect password.");
      }
      if (!res.ok) {
        throw new Error(`Server returned an unexpected error (HTTP ${res.status}).`);
      }
      const data = await res.json();
      if (data.success) {
        setAuthToken(data.token);
        setIsAuthenticated(true);
        if (typeof window !== "undefined") {
          sessionStorage.setItem("core_ai_token", data.token);
        }
      } else {
        throw new Error("Incorrect password.");
      }
    } catch (err) {
      setAuthError(true);
      setAuthErrorMessage(err.message || "Unknown error.");
      setTimeout(() => setAuthError(false), 600);
    } finally {
      setAuthLoading(false);
      setPasswordInput("");
    }
  }, [passwordInput]);

  const handleKeypadDigit = useCallback((digit) => {
    setAuthError(false);
    setPasswordInput((prev) => (prev.length < 12 ? prev + digit : prev));
  }, []);

  const handleKeypadBackspace = useCallback(() => {
    setAuthError(false);
    setPasswordInput((prev) => prev.slice(0, -1));
  }, []);

  const handleKeypadClear = useCallback(() => {
    setAuthError(false);
    setPasswordInput("");
  }, []);

  useEffect(() => {
    if (isAuthenticated) return;
    const onKeyDown = (e) => {
      if (e.key >= "0" && e.key <= "9") {
        handleKeypadDigit(e.key);
      } else if (e.key === "Backspace") {
        handleKeypadBackspace();
      } else if (e.key === "Enter") {
        handleUnlock();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAuthenticated, handleKeypadDigit, handleKeypadBackspace, handleUnlock]);

  const handleLock = useCallback(() => {
    setIsAuthenticated(false);
    setAuthToken("");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("core_ai_token");
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !authToken) return;

    let cancelled = false;

    const fetchAll = async () => {
      try {
        const headers = { "X-Dashboard-Token": authToken };
        const [portfolioRes, watchlistRes, tradesRes, analyticsRes] = await Promise.all([
          fetch(`${API_BASE}/api/portfolio`, { headers }),
          fetch(`${API_BASE}/api/watchlist`, { headers }),
          fetch(`${API_BASE}/api/trades`, { headers }),
          fetch(`${API_BASE}/api/analytics`, { headers }),
        ]);

        if (
          portfolioRes.status === 401 ||
          watchlistRes.status === 401 ||
          tradesRes.status === 401 ||
          analyticsRes.status === 401
        ) {
          handleLock();
          return;
        }

        if (!portfolioRes.ok || !watchlistRes.ok || !tradesRes.ok || !analyticsRes.ok) {
          throw new Error("Non-200 response from server");
        }

        const portfolioData = await portfolioRes.json();
        const watchlistData = await watchlistRes.json();
        const tradesData = await tradesRes.json();
        const analyticsData = await analyticsRes.json();

        if (cancelled) return;

        setPortfolio((prev) => {
          const prevPl = prevPlRef.current;
          if (prevPl !== null && portfolioData.daily_pl !== prevPl) {
            setFlashDirection(portfolioData.daily_pl >= prevPl ? "up" : "down");
            clearTimeout(flashTimeoutRef.current);
            flashTimeoutRef.current = setTimeout(() => setFlashDirection(null), 500);
          }
          prevPlRef.current = portfolioData.daily_pl;
          return portfolioData;
        });
        setWatchlist(watchlistData.watchlist || []);
        setTrades(tradesData.trades || []);
        setAnalytics(analyticsData);
        setApiReachable(true);
      } catch (err) {
        if (!cancelled) setApiReachable(false);
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated, authToken, handleLock]);

  useEffect(() => {
    if (!isAuthenticated || !authToken) return;

    clearTimeout(searchDebounceRef.current);

    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/search?q=${encodeURIComponent(searchQuery.trim())}`,
          { headers: { "X-Dashboard-Token": authToken } }
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results || []);
        }
      } catch (err) {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(searchDebounceRef.current);
  }, [searchQuery, isAuthenticated, authToken]);

  const handleSelectSymbol = useCallback(
    async (symbol) => {
      suppressNextSearchRef.current = true;
      setSearchResults([]);
      setSearchQuery(symbol);
      setQuoteLoading(true);
      setQuoteError("");
      try {
        const res = await fetch(`${API_BASE}/api/quote?symbol=${encodeURIComponent(symbol)}`, {
          headers: { "X-Dashboard-Token": authToken },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || `Couldn't fetch a quote for ${symbol}.`);
        }
        const data = await res.json();
        setSelectedQuote(data);
      } catch (err) {
        setQuoteError(err.message || "Couldn't fetch that quote.");
        setSelectedQuote(null);
      } finally {
        setQuoteLoading(false);
      }
    },
    [authToken]
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full bg-black flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-black to-slate-950" />
        <div className="absolute inset-0 backdrop-blur-3xl" />

        <form
          onSubmit={handleUnlock}
          className={`relative z-10 w-full max-w-sm mx-4 rounded-3xl border border-[#1d1d1f] bg-white/5 backdrop-blur-2xl p-10 shadow-2xl ${
            authError ? "animate-shake" : ""
          }`}
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-neutral-700 to-neutral-900 border border-[#1d1d1f] flex items-center justify-center mb-5">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M12 2L3 7V12C3 16.55 6.84 20.74 12 22C17.16 20.74 21 16.55 21 12V7L12 2Z"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="text-white text-2xl font-semibold tracking-tight">AP Daytrade Terminal</h1>
            <p className="text-neutral-500 text-sm mt-1">Enter credentials to access the trading engine</p>
          </div>

          <div className="flex items-center justify-center gap-3 mb-6 min-h-[20px]">
            {passwordInput.length === 0 ? (
              <span className="text-neutral-700 text-xs tracking-wide">Enter PIN</span>
            ) : (
              Array.from({ length: passwordInput.length }).map((_, i) => (
                <span key={i} className="w-2.5 h-2.5 rounded-full bg-white" />
              ))
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handleKeypadDigit(digit)}
                className="aspect-square rounded-2xl bg-white/5 border border-[#1d1d1f] text-white text-xl font-medium hover:bg-white/10 active:scale-95 transition-all"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={handleKeypadClear}
              className="aspect-square rounded-2xl bg-white/5 border border-[#1d1d1f] text-neutral-400 text-xs font-medium hover:bg-white/10 active:scale-95 transition-all"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleKeypadDigit("0")}
              className="aspect-square rounded-2xl bg-white/5 border border-[#1d1d1f] text-white text-xl font-medium hover:bg-white/10 active:scale-95 transition-all"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleKeypadBackspace}
              aria-label="Backspace"
              className="aspect-square rounded-2xl bg-white/5 border border-[#1d1d1f] text-neutral-400 text-xl font-medium hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
            >
              ⌫
            </button>
          </div>

          <button
            type="submit"
            disabled={authLoading || passwordInput.length === 0}
            className="w-full mt-4 bg-white text-black font-medium rounded-xl py-3.5 hover:bg-neutral-200 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {authLoading ? "Authenticating..." : "Unlock Terminal"}
          </button>

          {authError && (
            <p className="text-red-400 text-xs text-center mt-4 tracking-wide">{authErrorMessage}</p>
          )}
        </form>

        <style jsx global>{`
          @keyframes shake {
            10%, 90% { transform: translate3d(-1px, 0, 0); }
            20%, 80% { transform: translate3d(2px, 0, 0); }
            30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
            40%, 60% { transform: translate3d(4px, 0, 0); }
          }
          .animate-shake {
            animation: shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
          }
        `}</style>
      </div>
    );
  }

  const dailyPl = portfolio?.daily_pl ?? 0;
  const dailyPlPct = portfolio?.daily_pl_pct ?? 0;
  const isPositive = dailyPl >= 0;

  return (
    <div className="min-h-screen w-full bg-black text-white">
      {!apiReachable && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-500/90 backdrop-blur-md text-white text-center text-sm py-2 font-medium">
          Reconnecting to server...
        </div>
      )}

      <nav className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-black/60 border-b border-[#1d1d1f]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold tracking-tight text-sm md:text-base">
              AP DAYTRADE
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#1d1d1f] bg-white/5">
              <span
                className={`w-2 h-2 rounded-full ${
                  apiReachable ? "bg-emerald-400 animate-pulse" : "bg-red-500 animate-pulse"
                }`}
              />
              <span className="text-xs text-neutral-400 font-medium">
                {apiReachable ? "LIVE" : "OFFLINE"}
              </span>
            </div>
            <button
              onClick={handleLock}
              className="text-xs text-neutral-500 hover:text-white transition-colors"
            >
              Lock
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        <section className="mb-12">
          <p className="text-neutral-500 text-sm mb-2 tracking-wide uppercase">Total Portfolio Value</p>
          <h1 className="text-6xl md:text-8xl font-semibold tracking-tighter mb-4">
            {formatCurrency(portfolio?.equity)}
          </h1>
          <div
            className={`inline-flex items-center gap-2 text-xl md:text-2xl font-medium transition-all duration-300 ${
              isPositive ? "text-emerald-400" : "text-red-500"
            } ${flashDirection ? "scale-105" : "scale-100"}`}
            style={{
              textShadow: isPositive
                ? "0 0 20px rgba(52, 211, 153, 0.5)"
                : "0 0 20px rgba(239, 68, 68, 0.5)",
            }}
          >
            <span>{isPositive ? "▲" : "▼"}</span>
            <span>{formatCurrency(dailyPl)}</span>
            <span className="text-base md:text-lg opacity-70">({formatPercent(dailyPlPct)})</span>
          </div>
          <div className="flex flex-wrap gap-4 mt-6">
            <div className="px-4 py-2 rounded-xl border border-[#1d1d1f] bg-white/5">
              <span className="text-neutral-500 text-xs uppercase tracking-wide block">Buying Power</span>
              <span className="text-white font-medium">{formatCurrency(portfolio?.buying_power)}</span>
            </div>
            <div className="px-4 py-2 rounded-xl border border-[#1d1d1f] bg-white/5">
              <span className="text-neutral-500 text-xs uppercase tracking-wide block">Equities Session</span>
              <span className="text-white font-medium capitalize">
                {portfolio?.market_session?.replace("_", " ") || "closed"}
              </span>
            </div>
            <div className="px-4 py-2 rounded-xl border border-[#1d1d1f] bg-white/5">
              <span className="text-neutral-500 text-xs uppercase tracking-wide block">Equities Trading</span>
              <span className={`font-medium ${portfolio?.trading_enabled ? "text-emerald-400" : "text-neutral-400"}`}>
                {portfolio?.trading_enabled ? "ACTIVE" : "IDLE (market closed)"}
              </span>
            </div>
            <div className="px-4 py-2 rounded-xl border border-[#1d1d1f] bg-white/5">
              <span className="text-neutral-500 text-xs uppercase tracking-wide block">Crypto Trading</span>
              <span className={`font-medium ${portfolio?.crypto_trading_enabled ? "text-emerald-400" : "text-neutral-400"}`}>
                {portfolio?.crypto_trading_enabled ? "ACTIVE 24/7" : "OFFLINE"}
              </span>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-3xl border border-[#1d1d1f] bg-white/[0.03] backdrop-blur-xl p-6 lg:col-span-2 relative">
            <h2 className="text-neutral-400 text-sm uppercase tracking-wide mb-4 font-medium">
              Stock Search
            </h2>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ticker or company name (e.g. AAPL, Tesla)"
                className="w-full bg-white/5 border border-[#1d1d1f] rounded-xl px-4 py-3 text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 transition-all"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-20 mt-2 w-full max-h-72 overflow-y-auto rounded-xl border border-[#1d1d1f] bg-black/95 backdrop-blur-xl shadow-2xl">
                  {searchResults.map((r) => (
                    <button
                      key={r.symbol}
                      onClick={() => handleSelectSymbol(r.symbol)}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors flex items-center justify-between gap-3"
                    >
                      <span className="font-semibold text-white">{r.symbol}</span>
                      <span className="text-xs text-neutral-500 truncate">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {quoteLoading && (
              <p className="text-neutral-500 text-sm mt-4">Fetching quote...</p>
            )}

            {quoteError && !quoteLoading && (
              <p className="text-red-400 text-sm mt-4">{quoteError}</p>
            )}

            {selectedQuote && !quoteLoading && !quoteError && (
              <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-2 px-4 py-4 rounded-xl bg-white/5 border border-[#1d1d1f]">
                <div className="flex flex-col mr-auto">
                  <span className="text-white font-semibold text-lg">{selectedQuote.symbol}</span>
                  <span className="text-neutral-500 text-xs">{selectedQuote.name}</span>
                </div>
                <span className="text-white text-2xl font-semibold">
                  {formatCurrency(selectedQuote.price)}
                </span>
                <span
                  className={`text-sm font-medium ${
                    selectedQuote.change >= 0 ? "text-emerald-400" : "text-red-500"
                  }`}
                >
                  {selectedQuote.change >= 0 ? "+" : ""}
                  {formatCurrency(selectedQuote.change)} ({formatPercent(selectedQuote.change_pct)})
                </span>
                <div className="w-full flex flex-wrap gap-4 mt-2 text-xs text-neutral-500">
                  <span>Day high: {formatCurrency(selectedQuote.day_high)}</span>
                  <span>Day low: {formatCurrency(selectedQuote.day_low)}</span>
                  <span>Prev close: {formatCurrency(selectedQuote.previous_close)}</span>
                  <span>Volume: {Math.round(selectedQuote.volume).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-[#1d1d1f] bg-white/[0.03] backdrop-blur-xl p-6 lg:col-span-2">
            <h2 className="text-neutral-400 text-sm uppercase tracking-wide mb-4 font-medium">
              Live Positions
            </h2>
            {(!portfolio?.positions || portfolio.positions.length === 0) && (
              <p className="text-neutral-600 text-sm py-8 text-center">No open positions</p>
            )}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {portfolio?.positions?.map((p) => {
                const posPositive = p.unrealized_pl >= 0;
                return (
                  <div
                    key={p.symbol}
                    className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="font-semibold text-white">{p.symbol}</span>
                        <span className="text-xs text-neutral-500 capitalize">
                          {p.asset_class?.replace("_", " ")} · {p.qty} {p.side}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-medium ${posPositive ? "text-emerald-400" : "text-red-500"}`}>
                        {formatCurrency(p.unrealized_pl)}
                      </div>
                      <div className="text-xs text-neutral-500">{formatPercent(p.unrealized_plpc)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-[#1d1d1f] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2 className="text-neutral-400 text-sm uppercase tracking-wide mb-4 font-medium">
              Execution Log
            </h2>
            <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-xs">
              {trades.length === 0 && (
                <p className="text-neutral-600 text-sm py-8 text-center font-sans">No trades executed yet</p>
              )}
              {trades.map((t, idx) => (
                <div
                  key={`${t.timestamp}-${idx}`}
                  className="flex items-start gap-2 py-2 border-b border-[#1d1d1f] last:border-0"
                >
                  <span className="text-neutral-600 shrink-0">{formatTime(t.timestamp)}</span>
                  <span
                    className={`shrink-0 font-semibold ${
                      t.event?.includes("BUY")
                        ? "text-emerald-400"
                        : t.event?.includes("SELL") || t.event?.includes("CIRCUIT")
                        ? "text-red-500"
                        : "text-neutral-400"
                    }`}
                  >
                    {t.event}
                  </span>
                  {t.symbol && <span className="text-white shrink-0">{t.symbol}</span>}
                  <span className="text-neutral-600 truncate">{t.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#1d1d1f] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2 className="text-neutral-400 text-sm uppercase tracking-wide mb-4 font-medium">
              Trump Sentiment Watchlist
            </h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {watchlist.length === 0 && (
                <p className="text-neutral-600 text-sm py-8 text-center">No active signals</p>
              )}
              {watchlist.map((w, idx) => (
                <div
                  key={`${w.symbol}-${w.timestamp}-${idx}`}
                  className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{w.symbol}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      P{w.priority}
                    </span>
                  </div>
                  <p className="text-neutral-400 text-xs leading-snug">{w.headline}</p>
                  <span className="text-neutral-600 text-xs">{formatTime(w.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#1d1d1f] bg-white/[0.03] backdrop-blur-xl p-6 lg:col-span-2">
            <h2 className="text-neutral-400 text-sm uppercase tracking-wide mb-4 font-medium">
              Performance Analytics
            </h2>
            {(!analytics || analytics.total_closed_trades === 0) && (
              <p className="text-neutral-600 text-sm py-8 text-center">No closed trades yet</p>
            )}
            {analytics && analytics.total_closed_trades > 0 && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]">
                    <span className="text-neutral-500 text-xs uppercase tracking-wide block">Closed Trades</span>
                    <span className="text-white font-semibold text-lg">{analytics.total_closed_trades}</span>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]">
                    <span className="text-neutral-500 text-xs uppercase tracking-wide block">Avg Confidence</span>
                    <span className="text-white font-semibold text-lg">
                      {analytics.avg_entry_confidence_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]">
                    <span className="text-neutral-500 text-xs uppercase tracking-wide block">Win Rate</span>
                    <span className="text-white font-semibold text-lg">{analytics.win_rate_pct.toFixed(1)}%</span>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]">
                    <span className="text-neutral-500 text-xs uppercase tracking-wide block">Avg Win</span>
                    <span className="text-emerald-400 font-semibold text-lg">
                      {formatPercent(analytics.avg_win_pct)}
                    </span>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]">
                    <span className="text-neutral-500 text-xs uppercase tracking-wide block">Avg Loss</span>
                    <span className="text-red-500 font-semibold text-lg">
                      {formatPercent(analytics.avg_loss_pct)}
                    </span>
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-[#1d1d1f]">
                    <span className="text-neutral-500 text-xs uppercase tracking-wide block">Total P&L</span>
                    <span
                      className={`font-semibold text-lg ${
                        analytics.total_realized_pnl_pct >= 0 ? "text-emerald-400" : "text-red-500"
                      }`}
                    >
                      {formatPercent(analytics.total_realized_pnl_pct)}
                    </span>
                  </div>
                </div>

                <p className="text-neutral-500 text-xs uppercase tracking-wide mb-2">By Signal</p>
                <div className="space-y-1">
                  {Object.entries(analytics.by_signal).map(([signal, stats]) => (
                    <div
                      key={signal}
                      className="flex items-center justify-between px-4 py-2 rounded-xl bg-white/5 border border-[#1d1d1f] text-xs"
                    >
                      <span className="text-neutral-300 font-mono">{signal}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-neutral-500">{stats.trades} trades</span>
                        <span className="text-neutral-500">{stats.win_rate_pct.toFixed(1)}% win</span>
                        <span className={stats.avg_pnl_pct >= 0 ? "text-emerald-400" : "text-red-500"}>
                          {formatPercent(stats.avg_pnl_pct)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
