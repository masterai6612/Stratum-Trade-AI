"use client";

import { useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

type EngineStatus = {
  state: string;
  environment: string;
  venue: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  tick_count: number;
};

type Balance = { currency: string; total: string; free: string; locked: string };
type Account = { account_id: string; balances: Balance[] };
type Position = {
  position_id: string;
  instrument_id: string;
  side: string;
  quantity: string;
  avg_px_open: string;
  realized_pnl: string;
};
type Positions = { open: Position[]; closed_count: number };

type BrokerAccount = { status: string; equity: string; cash: string; buying_power: string; currency: string };
type BrokerStatus = { configured: boolean; paper: boolean; account: BrokerAccount | null };
type BrokerPosition = {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string | null;
  market_value: string | null;
  unrealized_pl: string | null;
};
type BrokerOrder = {
  id: string;
  symbol: string;
  side: string;
  qty: string | null;
  type: string | null;
  status: string | null;
  filled_qty: string | null;
  filled_avg_price: string | null;
  submitted_at: string | null;
};

const CANCELLABLE = new Set(["new", "accepted", "pending_new", "partially_filled"]);

function usd(v: string | null | undefined): string {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const STATE_COLORS: Record<string, string> = {
  offline: "bg-slate-500",
  initialized: "bg-sky-400",
  running: "bg-amber-400",
  completed: "bg-emerald-400",
  error: "bg-red-500",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [positions, setPositions] = useState<Positions>({ open: [], closed_count: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [broker, setBroker] = useState<BrokerStatus | null>(null);
  const [brokerPositions, setBrokerPositions] = useState<BrokerPosition[]>([]);
  const [brokerOrders, setBrokerOrders] = useState<BrokerOrder[]>([]);
  const [symbol, setSymbol] = useState("AAPL");
  const [qty, setQty] = useState("1");
  const [ticketMsg, setTicketMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s: EngineStatus = await fetch(`${API}/api/engine/status`).then((r) => r.json());
      setStatus(s);
      setOnline(true);
      const [acct, pos] = await Promise.all([
        fetch(`${API}/api/account`).then((r) => r.json()),
        fetch(`${API}/api/positions`).then((r) => r.json()),
      ]);
      setAccounts(acct.accounts ?? []);
      setPositions(pos ?? { open: [], closed_count: 0 });
    } catch {
      setOnline(false);
    }
    // Broker polls separately — a broker outage must not mark the backend offline.
    try {
      const b: BrokerStatus = await fetch(`${API}/api/broker/status`).then((r) => r.json());
      setBroker(b);
      if (b.configured) {
        const [bp, bo] = await Promise.all([
          fetch(`${API}/api/broker/positions`).then((r) => r.json()),
          fetch(`${API}/api/broker/orders`).then((r) => r.json()),
        ]);
        setBrokerPositions(bp.positions ?? []);
        setBrokerOrders(bo.orders ?? []);
      }
    } catch {
      /* broker card keeps last state */
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const post = async (path: string) => {
    setBusy(true);
    setMessage(null);
    try {
      let r: Response;
      try {
        r = await fetch(`${API}${path}`, { method: "POST" });
      } catch {
        // Browsers auto-retry GETs on a stale kept-alive connection but never
        // POSTs — one manual retry covers the edge closing idle connections.
        await new Promise((resolve) => setTimeout(resolve, 500));
        r = await fetch(`${API}${path}`, { method: "POST" });
      }
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        setMessage(body?.detail ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const submitOrder = async (side: "buy" | "sell") => {
    setBusy(true);
    setTicketMsg(null);
    try {
      const r = await fetch(`${API}/api/broker/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase(), qty: Number(qty), side }),
      });
      const body = await r.json().catch(() => null);
      setTicketMsg(
        r.ok
          ? `${side.toUpperCase()} ${qty} ${symbol.trim().toUpperCase()} submitted — status: ${body?.order?.status ?? "?"}`
          : body?.detail ?? `HTTP ${r.status}`,
      );
    } catch (e) {
      setTicketMsg(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const cancelOrder = async (id: string) => {
    try {
      await fetch(`${API}/api/broker/orders/${id}`, { method: "DELETE" });
    } finally {
      refresh();
    }
  };

  const state = status?.state ?? "offline";
  const qtyValid = Number(qty) > 0 && Number(qty) <= 10000;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">MonShield Tracker</h1>
          <p className="text-sm text-slate-400">Nautilus Trader admin center</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${online ? STATE_COLORS[state] ?? "bg-slate-500" : "bg-red-500"}`} />
          {online ? `Engine ${state}` : "Backend offline"}
          {status?.environment && online && (
            <span className="ml-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{status.environment}</span>
          )}
        </div>
      </header>

      <h2 className="pt-2 text-lg font-semibold">Backtest sandbox (simulated)</h2>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => post("/api/engine/initialize")}
          disabled={busy || !online || state === "running"}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
        >
          Initialize engine
        </button>
        <button
          onClick={() => post("/api/strategies/start")}
          disabled={busy || !online || state !== "initialized"}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
        >
          Run strategy
        </button>
        <button
          onClick={() => post("/api/strategies/stop")}
          disabled={busy || !online || state === "offline" || state === "running"}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-600 disabled:opacity-40"
        >
          Stop / reset
        </button>
      </div>

      {(message || status?.error) && (
        <p className="rounded-lg border border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300">
          {message ?? status?.error}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Account">
          {accounts.length === 0 ? (
            <p className="text-sm text-slate-500">No account yet — initialize and run the engine.</p>
          ) : (
            accounts.map((a) => (
              <div key={a.account_id}>
                <p className="mb-2 font-mono text-xs text-slate-500">{a.account_id}</p>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="pb-1">Currency</th>
                      <th className="pb-1">Total</th>
                      <th className="pb-1">Free</th>
                      <th className="pb-1">Locked</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {a.balances.map((b) => (
                      <tr key={b.currency} className="border-t border-slate-800">
                        <td className="py-1.5">{b.currency}</td>
                        <td className="py-1.5">{b.total}</td>
                        <td className="py-1.5">{b.free}</td>
                        <td className="py-1.5">{b.locked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </Card>

        <Card title={`Open positions (${positions.open.length}) — ${positions.closed_count} closed`}>
          {positions.open.length === 0 ? (
            <p className="text-sm text-slate-500">Flat — no open positions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-1">Instrument</th>
                  <th className="pb-1">Side</th>
                  <th className="pb-1">Qty</th>
                  <th className="pb-1">Avg px</th>
                  <th className="pb-1">Realized PnL</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {positions.open.map((p) => (
                  <tr key={p.position_id} className="border-t border-slate-800">
                    <td className="py-1.5">{p.instrument_id}</td>
                    <td className={`py-1.5 ${p.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{p.side}</td>
                    <td className="py-1.5">{p.quantity}</td>
                    <td className="py-1.5">{p.avg_px_open}</td>
                    <td className="py-1.5">{p.realized_pnl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <h2 className="text-lg font-semibold">Stock trading</h2>
        {broker && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              broker.configured
                ? broker.paper
                  ? "bg-sky-900 text-sky-300"
                  : "bg-red-900 text-red-300"
                : "bg-slate-800 text-slate-400"
            }`}
          >
            {broker.configured ? (broker.paper ? "PAPER" : "LIVE") : "NOT CONFIGURED"}
          </span>
        )}
      </div>

      {!broker?.configured ? (
        <Card title="Connect a broker (paper trading)">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-400">
            <li>
              Create a free account at <span className="font-mono text-slate-300">alpaca.markets</span> and open the
              dashboard&apos;s <span className="text-slate-300">Paper Trading</span> section.
            </li>
            <li>Generate an API key pair (key ID + secret).</li>
            <li>
              In Railway → your backend service → Variables, add{" "}
              <span className="font-mono text-slate-300">ALPACA_API_KEY</span> and{" "}
              <span className="font-mono text-slate-300">ALPACA_SECRET_KEY</span>, then redeploy.
            </li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Paper trading uses simulated money against real market prices. No real funds are at risk.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-3">
            <Card title="Equity">
              <p className="font-mono text-xl">{usd(broker.account?.equity)}</p>
            </Card>
            <Card title="Cash">
              <p className="font-mono text-xl">{usd(broker.account?.cash)}</p>
            </Card>
            <Card title="Buying power">
              <p className="font-mono text-xl">{usd(broker.account?.buying_power)}</p>
            </Card>
          </div>

          <Card title="Order ticket — market order, day">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-slate-400">
                Symbol
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="mt-1 block w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm uppercase text-slate-100"
                />
              </label>
              <label className="text-sm text-slate-400">
                Quantity
                <input
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  type="number"
                  min="0.001"
                  max="10000"
                  step="any"
                  className="mt-1 block w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
                />
              </label>
              <button
                onClick={() => submitOrder("buy")}
                disabled={busy || !symbol.trim() || !qtyValid}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
              >
                Buy
              </button>
              <button
                onClick={() => submitOrder("sell")}
                disabled={busy || !symbol.trim() || !qtyValid}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium hover:bg-red-500 disabled:opacity-40"
              >
                Sell
              </button>
            </div>
            {ticketMsg && <p className="mt-3 text-sm text-slate-300">{ticketMsg}</p>}
            <p className="mt-2 text-xs text-slate-500">
              Market orders outside market hours stay queued until the next open (cancel below if unwanted).
            </p>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title={`Broker positions (${brokerPositions.length})`}>
              {brokerPositions.length === 0 ? (
                <p className="text-sm text-slate-500">No positions.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="pb-1">Symbol</th>
                      <th className="pb-1">Qty</th>
                      <th className="pb-1">Avg entry</th>
                      <th className="pb-1">Now</th>
                      <th className="pb-1">Unrealized</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {brokerPositions.map((p) => (
                      <tr key={p.symbol} className="border-t border-slate-800">
                        <td className="py-1.5">{p.symbol}</td>
                        <td className="py-1.5">{p.qty}</td>
                        <td className="py-1.5">{usd(p.avg_entry_price)}</td>
                        <td className="py-1.5">{usd(p.current_price)}</td>
                        <td className={`py-1.5 ${Number(p.unrealized_pl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {usd(p.unrealized_pl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Recent orders">
              {brokerOrders.length === 0 ? (
                <p className="text-sm text-slate-500">No orders yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="pb-1">Symbol</th>
                      <th className="pb-1">Side</th>
                      <th className="pb-1">Qty</th>
                      <th className="pb-1">Status</th>
                      <th className="pb-1">Fill px</th>
                      <th className="pb-1"></th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {brokerOrders.map((o) => (
                      <tr key={o.id} className="border-t border-slate-800">
                        <td className="py-1.5">{o.symbol}</td>
                        <td className={`py-1.5 ${o.side === "buy" ? "text-emerald-400" : "text-red-400"}`}>{o.side}</td>
                        <td className="py-1.5">{o.filled_qty && o.filled_qty !== "0" ? o.filled_qty : o.qty}</td>
                        <td className="py-1.5">{o.status}</td>
                        <td className="py-1.5">{usd(o.filled_avg_price)}</td>
                        <td className="py-1.5 text-right">
                          {o.status && CANCELLABLE.has(o.status) && (
                            <button onClick={() => cancelOrder(o.id)} className="text-xs text-slate-400 underline hover:text-slate-200">
                              cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}

      <footer className="text-xs text-slate-600">
        API: <span className="font-mono">{API}</span> · polls every 3s
      </footer>
    </main>
  );
}
