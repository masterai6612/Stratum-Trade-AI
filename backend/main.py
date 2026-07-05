"""
MonShield Tracker — FastAPI wrapper around the Nautilus Trader engine.

Default mode runs the EMA-cross strategy as a backtest over synthetic
EUR/USD quote ticks on a simulated venue, so the whole stack works with no
exchange credentials. Live venue adapters (e.g. Binance testnet) plug into
EngineManager later without touching the API surface.
"""

import math
import os
import threading
from datetime import datetime, timezone
from decimal import Decimal

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from nautilus_trader.backtest.engine import BacktestEngine, BacktestEngineConfig
from nautilus_trader.config import LoggingConfig
from nautilus_trader.model.currencies import USD
from nautilus_trader.model.data import QuoteTick
from nautilus_trader.model.enums import AccountType, OmsType
from nautilus_trader.model.identifiers import TraderId, Venue
from nautilus_trader.model.objects import Money, Price, Quantity
from nautilus_trader.test_kit.providers import TestInstrumentProvider

from broker import router as broker_router
from strategies.ema_cross import EMACross, EMACrossConfig

VENUE = Venue("SIM")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "sandbox")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_quote_ticks(instrument, count: int) -> list[QuoteTick]:
    # Deterministic two-sine walk around 1.10 so EMA crossovers actually happen.
    start = pd.Timestamp("2024-01-01", tz="UTC").value
    ticks = []
    for i in range(count):
        mid = 1.1000 + 0.0100 * math.sin(i / 50) + 0.0020 * math.sin(i / 7)
        ts = start + i * 1_000_000_000  # 1 tick per second
        ticks.append(
            QuoteTick(
                instrument_id=instrument.id,
                bid_price=Price(round(mid - 0.00002, 5), precision=5),
                ask_price=Price(round(mid + 0.00002, 5), precision=5),
                bid_size=Quantity.from_int(1_000_000),
                ask_size=Quantity.from_int(1_000_000),
                ts_event=ts,
                ts_init=ts,
            )
        )
    return ticks


class EngineManager:
    """Owns the engine instance and runs it on a background thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.engine: BacktestEngine | None = None
        self.state = "offline"  # offline -> initialized -> running -> completed | error
        self.error: str | None = None
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.tick_count = 0

    def initialize(self, num_ticks: int, fast_period: int, slow_period: int, trade_size: int) -> None:
        with self._lock:
            if self.state == "running":
                raise RuntimeError("engine is running — wait for completion")
            if self.engine is not None:
                self.engine.dispose()

            engine = BacktestEngine(
                config=BacktestEngineConfig(
                    trader_id=TraderId("MONSHIELD-001"),
                    logging=LoggingConfig(log_level="ERROR"),
                )
            )
            engine.add_venue(
                venue=VENUE,
                oms_type=OmsType.NETTING,
                account_type=AccountType.MARGIN,
                base_currency=USD,
                starting_balances=[Money(1_000_000, USD)],
            )
            instrument = TestInstrumentProvider.default_fx_ccy("EUR/USD", VENUE)
            engine.add_instrument(instrument)
            engine.add_data(generate_quote_ticks(instrument, num_ticks))
            engine.add_strategy(
                EMACross(
                    EMACrossConfig(
                        instrument_id=instrument.id,
                        fast_period=fast_period,
                        slow_period=slow_period,
                        trade_size=Decimal(trade_size),
                    )
                )
            )

            self.engine = engine
            self.tick_count = num_ticks
            self.state = "initialized"
            self.error = None
            self.started_at = None
            self.finished_at = None

    def start(self) -> None:
        with self._lock:
            if self.engine is None:
                raise RuntimeError("engine not initialized — POST /api/engine/initialize first")
            if self.state == "running":
                raise RuntimeError("engine already running")
            self.state = "running"
            self.started_at = utc_now()
            self.finished_at = None
            threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        try:
            self.engine.run()
            self.state = "completed"
        except Exception as e:  # surface engine failures via /api/engine/status
            self.state = "error"
            self.error = str(e)
        finally:
            self.finished_at = utc_now()

    def reset(self) -> None:
        with self._lock:
            if self.state == "running":
                raise RuntimeError("engine is running — wait for completion")
            if self.engine is not None:
                self.engine.dispose()
                self.engine = None
            self.state = "offline"
            self.error = None
            self.started_at = None
            self.finished_at = None
            self.tick_count = 0

    def status(self) -> dict:
        return {
            "state": self.state,
            "environment": ENVIRONMENT,
            "venue": str(VENUE),
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "tick_count": self.tick_count,
        }


manager = EngineManager()
app = FastAPI(title="MonShield Tracker API")
app.include_router(broker_router)

origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InitializeRequest(BaseModel):
    num_ticks: int = 5000
    fast_period: int = 10
    slow_period: int = 20
    trade_size: int = 100_000


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/engine/initialize")
def initialize_engine(req: InitializeRequest | None = None):
    req = req or InitializeRequest()
    try:
        manager.initialize(req.num_ticks, req.fast_period, req.slow_period, req.trade_size)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return manager.status()


@app.get("/api/engine/status")
def engine_status():
    return manager.status()


@app.get("/api/strategies")
def list_strategies():
    if manager.engine is None:
        return {"strategies": []}
    return {
        "strategies": [
            {"id": str(s.id), "running": bool(getattr(s, "is_running", False))}
            for s in manager.engine.trader.strategies()
        ]
    }


@app.post("/api/strategies/start")
def start_strategies():
    try:
        manager.start()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return manager.status()


@app.post("/api/strategies/stop")
def stop_strategies():
    # Backtests run to completion in well under a second; "stop" resets the
    # engine so a fresh run can be initialized.
    try:
        manager.reset()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return manager.status()


def _position_to_dict(p) -> dict:
    return {
        "position_id": str(p.id),
        "instrument_id": str(p.instrument_id),
        "side": str(p.side).split(".")[-1],
        "quantity": str(p.quantity),
        "avg_px_open": str(p.avg_px_open),
        "realized_pnl": str(p.realized_pnl),
    }


@app.get("/api/positions")
def positions():
    if manager.engine is None:
        return {"open": [], "closed_count": 0}
    cache = manager.engine.cache
    return {
        "open": [_position_to_dict(p) for p in cache.positions_open()],
        "closed_count": len(cache.positions_closed()),
    }


@app.get("/api/account")
def account():
    if manager.engine is None:
        return {"accounts": []}
    out = []
    for a in manager.engine.cache.accounts():
        bals = a.balances()
        bals = bals.values() if isinstance(bals, dict) else bals
        out.append(
            {
                "account_id": str(a.id),
                "balances": [
                    {
                        "currency": str(b.currency),
                        "total": str(b.total),
                        "free": str(b.free),
                        "locked": str(b.locked),
                    }
                    for b in bals
                ],
            }
        )
    return {"accounts": out}
