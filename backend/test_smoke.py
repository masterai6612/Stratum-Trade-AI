"""Smoke test: initialize -> run -> verify positions and account.

Run with: python test_smoke.py
"""

import time

from fastapi.testclient import TestClient

from main import app


def main() -> None:
    client = TestClient(app)

    r = client.get("/api/health")
    assert r.status_code == 200, r.text

    r = client.post("/api/engine/initialize", json={"num_ticks": 3000})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "initialized", r.json()

    r = client.get("/api/strategies")
    assert r.json()["strategies"], r.json()

    r = client.post("/api/strategies/start")
    assert r.status_code == 200, r.text

    status = None
    for _ in range(120):
        status = client.get("/api/engine/status").json()
        if status["state"] in ("completed", "error"):
            break
        time.sleep(0.5)
    assert status["state"] == "completed", status

    acct = client.get("/api/account").json()
    assert acct["accounts"], acct
    assert acct["accounts"][0]["balances"], acct

    pos = client.get("/api/positions").json()
    assert pos["closed_count"] > 0 or pos["open"], pos

    r = client.post("/api/strategies/stop")
    assert r.status_code == 200 and r.json()["state"] == "offline", r.text

    print("SMOKE OK —", "closed positions:", pos["closed_count"], "| balances:", acct["accounts"][0]["balances"])


if __name__ == "__main__":
    main()
