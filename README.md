# MonShield Tracker

Full-stack admin wrapper around [Nautilus Trader](https://nautilustrader.io):

- `backend/` — Python 3.13 / FastAPI service embedding the Nautilus `BacktestEngine`, running an EMA-cross strategy over synthetic EUR/USD quote ticks on a simulated venue. Deploys to **Railway** (Dockerfile included).
- `frontend/` — Next.js 16 / React 19 / Tailwind 4 dashboard (engine status, account balances, positions, run/stop controls). Deploys to **Vercel**.

The default mode is a **backtest sandbox** — it needs no exchange credentials and demonstrates the full loop: initialize engine → run strategy → inspect account/positions from the engine cache.

## Local development

Backend (port 8080):

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8080
```

Smoke test (initialize → run → verify positions and balances):

```bash
cd backend && .venv/bin/python test_smoke.py
```

Frontend (port 3000):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 — it redirects to `/dashboard`. Click **Initialize engine**, then **Run strategy**; the backtest completes in under a second and the account/positions tables populate.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check (use as Railway healthcheck path) |
| POST | `/api/engine/initialize` | Build engine, venue, instrument, data, strategy. Optional JSON body: `num_ticks`, `fast_period`, `slow_period`, `trade_size` |
| GET | `/api/engine/status` | Engine state: `offline / initialized / running / completed / error` |
| GET | `/api/strategies` | Registered strategies |
| POST | `/api/strategies/start` | Run the engine on a background thread |
| POST | `/api/strategies/stop` | Dispose engine and reset to `offline` |
| GET | `/api/positions` | Open positions + closed count from the engine cache |
| GET | `/api/account` | Account balances from the engine cache |

## Deploy: backend → Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick the repo, set **Root Directory** to `backend`. Railway detects the Dockerfile automatically.
3. Railway injects `PORT` at runtime and the Dockerfile CMD honors it — no manual port setting needed. (Setting `PORT=8080` manually as some guides suggest is harmless but unnecessary.)
4. Set variables (Settings → Variables): `ENVIRONMENT=sandbox`, `ALLOWED_ORIGINS=http://localhost:3000` for now.
5. Optional: add a **Redis** service to the project canvas. Railway injects `REDIS_URL`; Nautilus only uses it once you configure live-mode cache/message-bus persistence — the backtest demo doesn't need it.
6. Settings → Networking → **Generate Domain**. Note the URL (e.g. `https://monshield-backend-production.up.railway.app`).

## Deploy: frontend → Vercel

1. In Vercel: **Add New Project → Import** the same GitHub repo, set **Root Directory** to `frontend` (framework auto-detects as Next.js).
2. Add environment variable `NEXT_PUBLIC_API_URL` = your Railway URL (no trailing slash).
3. Deploy, note your Vercel URL.
4. Back in Railway, update `ALLOWED_ORIGINS` to include it, e.g.:
   `ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000`
   The FastAPI CORS middleware reads this at startup — Railway redeploys on variable change.

## Stock trading (Alpaca, paper by default)

The dashboard has a **Stock trading** section backed by Alpaca's paper-trading API — simulated money, real market prices, no funds at risk.

Setup (once):

1. Create a free account at https://alpaca.markets and open the **Paper Trading** dashboard.
2. Generate an API key pair (key ID + secret).
3. In Railway → backend service → **Variables**, add `ALPACA_API_KEY` and `ALPACA_SECRET_KEY`. Railway redeploys automatically.

The dashboard then shows equity/cash/buying power, an order ticket (market day orders, whole or fractional shares), open positions with unrealized P&L, and recent orders with cancel for unfilled ones. Orders placed outside market hours queue until the next open.

Broker endpoints: `GET /api/broker/status`, `GET /api/broker/positions`, `POST /api/broker/orders` (`{symbol, qty, side}`), `GET /api/broker/orders`, `DELETE /api/broker/orders/{id}`.

**Live trading guard**: the backend refuses the live Alpaca endpoint unless `ENVIRONMENT=live` *and* `ALPACA_BASE_URL` are both explicitly set — every other configuration falls back to paper. Switching to live means real money and real risk; test extensively on paper first.

## Going live (later)

The demo trades a simulated venue. To trade a real sandbox (e.g. Binance testnet):

- Set `VENUE_API_KEY` / `VENUE_SECRET` in Railway.
- Replace the `BacktestEngine` in `backend/main.py` with a `TradingNode` configured with the Binance adapter (`nautilus_trader.adapters.binance`) and `testnet=True`, wiring `REDIS_URL` into the cache config for state persistence.
- `strategies/ema_cross.py` works unchanged in live mode — it only consumes quote ticks.

**Never point this at a live venue with real funds without position limits and thorough sandbox testing.**

## Corrections to the original deployment guide

- **No Rust toolchain needed**: `nautilus_trader` ships prebuilt wheels (manylinux/macOS/Windows, Python 3.11–3.13), so the Dockerfile uses plain `python:3.13-slim`. Building Rust from source in Docker would add ~15 minutes of build time for nothing.
- **No third-party "Nautilus-Web-Interface" boilerplate required** — this repo *is* the FastAPI + Next.js wrapper.
- Vercel can actually run Python and long-lived functions these days (Fluid Compute), but a persistent always-on trading engine is still a better fit for Railway's long-running worker model, so the split architecture stands.
