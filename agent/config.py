"""실행 설정. 모델명은 여기 한 곳에만 있다."""

from __future__ import annotations

import os
from pathlib import Path

# ── 모델 ──────────────────────────────────────────────────────────
# 개발용/발표용 전환은 환경변수 하나로 한다.
#   KG_MODE=demo  .venv/bin/python -m agent.main
#
# 키로 /v1/models 를 조회해 실재를 확인한 모델명이다 (2026-06-24 공개된 5.6 계열).
# 5.6 계열은 mini/nano 접미사 대신 luna/sol/terra 이름을 쓴다 — 이름만으로는
# 크기 순서를 알 수 없으니 바꿀 때는 반드시 확인하고 바꿀 것.
MODEL_DEV = os.getenv("KG_MODEL_DEV", "gpt-5.6-luna")

# 발표용도 당분간 같은 모델이다. 즉 지금은 KG_MODE=demo 가 사실상 무동작이다.
# 더 큰 모델로 시연할지는 크레딧 소진 속도를 보고 정한다.
MODEL_DEMO = os.getenv("KG_MODEL_DEMO", "gpt-5.6-luna")

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
