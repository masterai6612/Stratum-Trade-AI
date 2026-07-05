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

  const state = status?.state ?? "offline";

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

      <footer className="text-xs text-slate-600">
        API: <span className="font-mono">{API}</span> · polls every 3s
      </footer>
    </main>
  );
}
