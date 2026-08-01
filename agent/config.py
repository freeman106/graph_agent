"""실행 설정. 모델명은 여기 한 곳에만 있다."""

from __future__ import annotations

import hashlib
import os
import shutil
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

def _local_state_dir() -> Path:
    override = os.getenv("KG_STATE_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if os.name == "nt":
        base = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        app_dir = base / "graph-agent"
    elif os.uname().sysname == "Darwin":
        app_dir = Path.home() / "Library" / "Application Support" / "graph-agent"
    else:
        app_dir = Path(
            os.getenv("XDG_STATE_HOME", Path.home() / ".local" / "state")
        ) / "graph-agent"
    project_key = hashlib.sha256(str(ROOT.resolve()).encode("utf-8")).hexdigest()[:16]
    return app_dir / project_key


# 실행 중 계속 바뀌는 파일은 프로젝트가 OneDrive 안에 있어도 로컬 디스크에 둔다.
# KG_STATE_DIR 로 별도 경로를 지정할 수 있다.
STATE_DIR = _local_state_dir()
STATE_DIR.mkdir(parents=True, exist_ok=True)

# 기존 실행 결과는 최초 한 번 보존해서 사용자가 만든 그래프를 잃지 않는다.
_LEGACY_STATE_DIRS = (STATE_DIR.parent, ROOT / "agent" / "state")
for _state_name in ("graph.json", "last_run.jsonl"):
    _local = STATE_DIR / _state_name
    for _legacy_dir in _LEGACY_STATE_DIRS:
        _legacy = _legacy_dir / _state_name
        if not _local.exists() and _legacy.exists():
            shutil.copy2(_legacy, _local)
            break

GRAPH_PATH = STATE_DIR / "graph.json"
LAST_RUN_PATH = STATE_DIR / "last_run.jsonl"
