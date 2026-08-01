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
#
# 여기서 turn 은 툴 호출 횟수가 아니라 **모델 호출 횟수**다. 한 턴에 툴을 여러 개
# 몰아 부르기도 하고 하나씩 나눠 부르기도 하는데, 같은 프롬프트여도 실행마다
# 다르다. 그래서 상한은 "몰아 부르지 않는 최악의 경우"를 견딜 만큼 둬야 한다.
MAX_STEPS = 20

# 강의안 실행은 단원·소주제를 만들고 노드 20여 개에 긴 문서를 쓴다. 모델이 툴을
# 잘게 나눠 부르면 20 턴으로는 노드 몇 개 만들다 끊긴다 — 실제로 5개에서 끊겼다.
MAX_STEPS_LECTURE = int(os.getenv("KG_MAX_STEPS_LECTURE", "80"))

# ── 경로 ──────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "contract" / "fixtures"

SEED_GRAPH = FIXTURES / "seed_graph.json"
REFERENCE_BOOK = FIXTURES / "reference.json"
DEFAULT_CONVERSATION = FIXTURES / "kv_cache_conversation.json"

STATE_DIR = ROOT / "agent" / "state"
GRAPH_PATH = STATE_DIR / "graph.json"
LAST_RUN_PATH = STATE_DIR / "last_run.jsonl"
