"""실행 설정. 모델명은 여기 한 곳에만 있다."""

from __future__ import annotations

import os
from pathlib import Path

# ── 모델 ──────────────────────────────────────────────────────────
# 개발용/발표용 전환은 환경변수 하나로 한다.
#   KG_MODE=demo  .venv/bin/python -m agent.main
#
# 주의: 아래 두 값은 자리표시자다. 해커톤에서 크레딧이 어떤 모델을 커버하는지
# 확인하고 교체할 것. 코드 어디에도 모델명이 다시 나오지 않게 유지한다.
MODEL_DEV = os.getenv("KG_MODEL_DEV", "gpt-4o-mini")
MODEL_DEMO = os.getenv("KG_MODEL_DEMO", "gpt-4o")

MODE = os.getenv("KG_MODE", "dev")
MODEL = MODEL_DEMO if MODE == "demo" else MODEL_DEV

# ── 가드레일 ──────────────────────────────────────────────────────
# 에이전트 루프의 턴 상한. 걸리면 조용히 멈추지 않고 kind="limit" 이벤트를 낸다.
MAX_STEPS = 20

# ── 경로 ──────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "contract" / "fixtures"

SEED_GRAPH = FIXTURES / "seed_graph.json"
REFERENCE_BOOK = FIXTURES / "reference.json"
DEFAULT_CONVERSATION = FIXTURES / "kv_cache_conversation.json"

STATE_DIR = ROOT / "agent" / "state"
GRAPH_PATH = STATE_DIR / "graph.json"
LAST_RUN_PATH = STATE_DIR / "last_run.jsonl"
