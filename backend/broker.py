"""
Alpaca broker integration for stock trading — paper trading by default.

All order placement here is user-initiated from the dashboard; nothing in
this module trades autonomously.

Safety: requests go to the paper endpoint unless BOTH conditions hold —
ENVIRONMENT=live and ALPACA_BASE_URL explicitly set to the live endpoint.
Any other combination silently falls back to paper.
"""

import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/broker")

PAPER_URL = "https://paper-api.alpaca.markets"


def _base_url() -> str:
    override = os.environ.get("ALPACA_BASE_URL", "").rstrip("/")
    if override and override != PAPER_URL and os.environ.get("ENVIRONMENT") != "live":
        return PAPER_URL
    return override or PAPER_URL


def _configured() -> bool:
    return bool(os.environ.get("ALPACA_API_KEY") and os.environ.get("ALPACA_SECRET_KEY"))


def _headers() -> dict:
    if not _configured():
        raise HTTPException(
            status_code=503,
            detail="Broker not configured — set ALPACA_API_KEY and ALPACA_SECRET_KEY in Railway",
        )
    return {
        "APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"],
        "APCA-API-SECRET-KEY": os.environ["ALPACA_SECRET_KEY"],
    }


def _alpaca_error(r: httpx.Response) -> str:
    try:
        return r.json().get("message", r.text)
    except Exception:
        return r.text


def _get(path: str, params: dict | None = None):
    r = httpx.get(f"{_base_url()}{path}", headers=_headers(), params=params, timeout=15)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=_alpaca_error(r))
    return r.json()


def _order_to_dict(o: dict) -> dict:
    return {
        "id": o["id"],
        "symbol": o["symbol"],
        "side": o["side"],
        "qty": o.get("qty"),
        "type": o.get("type"),
        "status": o.get("status"),
        "filled_qty": o.get("filled_qty"),
        "filled_avg_price": o.get("filled_avg_price"),
        "submitted_at": o.get("submitted_at"),
    }


@router.get("/status")
def broker_status():
    if not _configured():
        return {"configured": False, "paper": True, "account": None}
    acct = _get("/v2/account")
    return {
        "configured": True,
        "paper": _base_url() == PAPER_URL,
        "account": {
            "status": acct.get("status"),
            "equity": acct.get("equity"),
            "cash": acct.get("cash"),
            "buying_power": acct.get("buying_power"),
            "currency": acct.get("currency"),
        },
    }


@router.get("/positions")
def broker_positions():
    return {
        "positions": [
            {
                "symbol": p["symbol"],
                "qty": p["qty"],
                "side": p["side"],
                "avg_entry_price": p["avg_entry_price"],
                "current_price": p.get("current_price"),
                "market_value": p.get("market_value"),
                "unrealized_pl": p.get("unrealized_pl"),
            }
            for p in _get("/v2/positions")
        ]
    }


class OrderRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=10)
    qty: float = Field(gt=0, le=10_000)
    side: str = Field(pattern="^(buy|sell)$")


@router.post("/orders")
def submit_order(req: OrderRequest):
    payload = {
        "symbol": req.symbol.upper().strip(),
        "qty": str(req.qty),
        "side": req.side,
        "type": "market",
        "time_in_force": "day",
    }
    r = httpx.post(f"{_base_url()}/v2/orders", headers=_headers(), json=payload, timeout=15)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=_alpaca_error(r))
    return {"order": _order_to_dict(r.json())}


@router.get("/orders")
def list_orders():
    return {"orders": [_order_to_dict(o) for o in _get("/v2/orders", {"status": "all", "limit": 20})]}


@router.delete("/orders/{order_id}")
def cancel_order(order_id: str):
    r = httpx.delete(f"{_base_url()}/v2/orders/{order_id}", headers=_headers(), timeout=15)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=_alpaca_error(r))
    return {"canceled": order_id}
