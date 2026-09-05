"""Every route the trading room calls must at least resolve and run.

The migration dropped a helper along with a route block it happened to sit
next to; imports and unit tests passed while the games list returned 500.
Walking the surface catches that class of mistake.
"""

from __future__ import annotations

import pytest

from services.paper_trading_api import create_app


CALLED_BY_UI = [
    ("GET", "/api/paper-trading/securities?q=삼성&limit=3"),
    ("GET", "/api/paper-trading/data-source/status"),
    ("GET", "/api/paper-trading/securities/005930/initial-context/documents"),
    ("DELETE", "/api/paper-trading/securities/005930/initial-context/cache"),
    ("GET", "/api/paper-trading/games?summary=1&limit=3"),
    ("GET", "/api/paper-trading/games"),
    ("GET", "/api/paper-trading/games/scenario_missing0000"),
    ("GET", "/api/paper-trading/scenarios/scenario_missing0000/assessment"),
    ("GET", "/api/paper-trading/scenario-jobs/job_missing0000"),
]


@pytest.fixture(name="client")
def _client():
    return create_app().test_client()


@pytest.mark.parametrize("method,path", CALLED_BY_UI)
def test_route_runs_without_crashing(client, method, path):
    response = client.open(path, method=method)
    # 데이터가 없어 404나 503이 나오는 것은 정상이다. 500은 코드가 깨진 것이다.
    assert response.status_code != 500, f"{method} {path} → 500\n{response.get_data(as_text=True)[:400]}"


def test_scenario_creation_rejects_a_bad_ticker(client):
    response = client.post("/api/paper-trading/scenarios", json={"ticker": "nope"})
    assert response.status_code != 500
