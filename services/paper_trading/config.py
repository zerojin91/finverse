"""Settings for the paper trading engine.

Trimmed from the FinSimulation backend to what the scenario engine actually
reads. The graph, OASIS and Zep settings stayed behind with the services that
use them — this engine needs a market database, an LLM, and somewhere to keep
saved games.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


# 저장소 루트의 .env 하나만 쓴다. 예전에는 FinSimulation 쪽에 같은 키를
# 한 벌 더 두어야 했다.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


class Config:
    """Runtime settings, read once at import."""

    # 게임 저장 위치. finverse 작업 디렉터리 아래에 둔다.
    PAPER_TRADING_DATA_DIR = os.environ.get(
        "FINVERSE_PAPER_TRADING_DIR",
        str(Path(__file__).resolve().parents[2] / "var" / "paper_games"))
    UPLOAD_FOLDER = str(Path(PAPER_TRADING_DATA_DIR).parent)

    FINVERSE_DATABASE_URL = os.environ.get("FINVERSE_DATABASE_URL", "")

    # 로컬 추론 서버 경로. OPENROUTER_API_KEY가 있으면 쓰이지 않는다.
    LLM_API_KEY = os.environ.get("LLM_API_KEY")
    LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    LLM_MODEL_NAME = os.environ.get("LLM_MODEL_NAME", "gpt-4o-mini")
    LLM_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", 131072))
    LLM_REASONING_EFFORT = os.environ.get("LLM_REASONING_EFFORT", "")
    LLM_DISABLE_THINKING = os.environ.get(
        "LLM_DISABLE_THINKING", "true").strip().lower() in ("1", "true", "yes", "on")
    LLM_KEEPALIVE_EXPIRY = float(os.environ.get("LLM_KEEPALIVE_EXPIRY", 15.0))
    LLM_MAX_CONNECTIONS = int(os.environ.get("LLM_MAX_CONNECTIONS", 8))
    LLM_READ_TIMEOUT = float(os.environ.get("LLM_READ_TIMEOUT", 1800.0))
    LLM_MAX_RETRIES = int(os.environ.get("LLM_MAX_RETRIES", 2))

    # OpenRouter. 키가 있으면 이쪽으로 간다.
    OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
    OPENROUTER_BASE_URL = os.environ.get(
        "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip()
    OPENROUTER_MODEL = (os.environ.get("OPENROUTER_MODEL", "").strip()
                        or os.environ.get("MIROFISH_LLM_MODEL", "").strip())
    OPENROUTER_FALLBACK_MODELS = [
        name.strip() for name in
        os.environ.get("OPENROUTER_FALLBACK_MODELS", "").split(",") if name.strip()]
    # 같은 모델도 프로바이더에 따라 처리량이 17배까지 갈린다. 처리량으로 고정한다.
    OPENROUTER_PROVIDER_SORT = os.environ.get(
        "OPENROUTER_PROVIDER_SORT", "throughput").strip()
    OPENROUTER_MAX_TOKENS = int(os.environ.get("OPENROUTER_MAX_TOKENS", 8192))
    OPENROUTER_READ_TIMEOUT = float(os.environ.get("OPENROUTER_READ_TIMEOUT", 180.0))
    OPENROUTER_MAX_RETRIES = int(os.environ.get("OPENROUTER_MAX_RETRIES", 2))
    OPENROUTER_APP_URL = os.environ.get("OPENROUTER_APP_URL", "https://finverse.local").strip()
    OPENROUTER_APP_TITLE = os.environ.get("OPENROUTER_APP_TITLE", "FINVERSE Paper Trading").strip()

    # 독립 에이전트는 각각 LLM 호출을 하지만, 프로필 생성과 거래일 행동의
    # 동시 실행 수는 제한한다. 한 요청에 여러 에이전트를 합치는 값이 아니다.
    AGENT_PROFILE_PARALLEL_COUNT = int(os.environ.get("FINVERSE_AGENT_PROFILE_PARALLEL_COUNT", 5))
    AGENT_ACTION_PARALLEL_COUNT = int(os.environ.get("FINVERSE_AGENT_ACTION_PARALLEL_COUNT", 4))

    @classmethod
    def use_openrouter(cls) -> bool:
        return bool(cls.OPENROUTER_API_KEY)

    @classmethod
    def validate(cls) -> list[str]:
        errors = []
        if not cls.OPENROUTER_API_KEY and not cls.LLM_API_KEY:
            errors.append("OPENROUTER_API_KEY 또는 LLM_API_KEY가 설정되지 않았습니다.")
        if cls.OPENROUTER_API_KEY and not cls.OPENROUTER_MODEL:
            errors.append("OPENROUTER_MODEL(또는 MIROFISH_LLM_MODEL)이 설정되지 않았습니다.")
        if not cls.FINVERSE_DATABASE_URL:
            errors.append("FINVERSE_DATABASE_URL이 설정되지 않았습니다.")
        return errors
