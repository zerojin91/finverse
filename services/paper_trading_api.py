"""Local HTTP service for the paper trading engine.

Runs the scenario engine next to the web app instead of proxying a separate
FinSimulation process. `scripts/dev_local.mjs` starts it; the Next route at
`app/api/paper-trading/[...path]` forwards to it.
"""

from __future__ import annotations

import os

from flask import Flask
from flask_cors import CORS

from services.paper_trading.api import paper_trading_bp
from services.paper_trading.config import Config


def create_app() -> Flask:
    app = Flask("finverse-paper-trading")
    app.config["JSON_AS_ASCII"] = False
    app.config["PAPER_TRADING_DATA_DIR"] = Config.PAPER_TRADING_DATA_DIR
    app.config["FINVERSE_DATABASE_URL"] = Config.FINVERSE_DATABASE_URL
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    app.register_blueprint(paper_trading_bp, url_prefix="/api/paper-trading")

    @app.route("/health")
    def health():
        return {"status": "ok", "settings": Config.validate() or "ok"}

    return app


app = create_app()

if __name__ == "__main__":
    for problem in Config.validate():
        print(f"[설정 확인] {problem}")
    app.run(host="127.0.0.1",
            port=int(os.environ.get("FINVERSE_PAPER_TRADING_PORT", "5055")),
            threaded=True)
