"""계약 C 스트림 이벤트의 생성 · 출력 · 기록.

한 스트림에 두 층이 실린다:
  raw 층   — 하부 API 원본 이벤트를 가공 없이 담는다 (대회 규칙 필수 요소)
  요약 층  — kind / tool / result_summary / rationale

**요약 층이 비고 raw 만 있는 이벤트 = 순수 원본 통과분.**
프론트 요약 뷰는 그런 이벤트를 건너뛰고, raw 뷰는 raw 가 None 인 이벤트를 건너뛴다.
이 한 줄이 두 뷰를 가르는 유일한 규칙이다.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from contract.schema import StreamEvent, StreamKind

# 콘솔 색 (터미널 느낌)
_C = {
    "tool_call": "\033[36m",  # cyan
    "tool_result": "\033[32m",  # green
    "decision": "\033[33m",  # yellow
    "note": "\033[90m",  # grey
    "error": "\033[31m",  # red
    "limit": "\033[35m",  # magenta
    "raw": "\033[90m",
}
_RESET = "\033[0m"

_MARK = {
    "tool_call": "▸",
    "tool_result": "✓",
    "decision": "◆",
    "note": "·",
    "error": "✗",
    "limit": "⚠",
}


def jsonable(value: Any) -> Any:
    """원본 이벤트를 JSON 으로 옮긴다. 내용은 손대지 않는다."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    for attr in ("model_dump", "dict"):
        fn = getattr(value, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:  # noqa: BLE001 - 원본을 잃지 않는 게 우선
                pass
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return str(value)


class StreamWriter:
    """seq 를 매기고, 검증하고, 콘솔에 찍고, JSONL 로 남긴다.

    JSONL 은 항상 전부 기록한다 — C 가 크레딧 없이 개발할 수 있는 실제 픽스처가 된다.
    콘솔은 show_raw 에 따라 원본 통과분을 보여주거나 감춘다.
    """

    def __init__(self, show_raw: bool = False, jsonl_path: Path | None = None) -> None:
        self.show_raw = show_raw
        self.jsonl_path = jsonl_path
        self._seq = 0
        self._fh = None
        if jsonl_path is not None:
            jsonl_path.parent.mkdir(parents=True, exist_ok=True)
            self._fh = jsonl_path.open("w", encoding="utf-8")

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None

    def __enter__(self) -> "StreamWriter":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ── 생성 ────────────────────────────────────────────────
    def emit(
        self,
        kind: StreamKind,
        *,
        tool: str | None = None,
        args: dict | None = None,
        result_summary: str | None = None,
        rationale: str | None = None,
        raw: Any | None = None,
    ) -> StreamEvent:
        event = StreamEvent(
            seq=self._seq,
            ts=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            kind=kind,
            tool=tool,
            args=args,
            result_summary=result_summary,
            rationale=rationale,
            raw=jsonable(raw),
        )
        self._seq += 1

        if self._fh is not None:
            self._fh.write(event.model_dump_json() + "\n")
            self._fh.flush()

        self._print(event)
        return event

    # ── 출력 ────────────────────────────────────────────────
    @staticmethod
    def is_raw_only(event: StreamEvent) -> bool:
        """요약 층이 비어 있고 raw 만 있는가."""
        return (
            event.raw is not None
            and event.result_summary is None
            and event.rationale is None
            and event.tool is None
        )

    def _print(self, event: StreamEvent) -> None:
        color = _C.get(event.kind, "")
        mark = _MARK.get(event.kind, "·")

        if self.is_raw_only(event):
            if not self.show_raw:
                return
            body = json.dumps(event.raw, ensure_ascii=False)
            if len(body) > 220:
                body = body[:217] + "..."
            print(f"{_C['raw']}{event.seq:>4} raw  {body}{_RESET}")
            return

        head = f"{color}{event.seq:>4} {mark} "
        if event.kind == "tool_call":
            arg_text = json.dumps(event.args or {}, ensure_ascii=False)
            if len(arg_text) > 160:
                arg_text = arg_text[:157] + "..."
            print(f"{head}{event.tool}({arg_text}){_RESET}")
            if event.rationale:
                print(f"{_C['decision']}       근거: {event.rationale}{_RESET}")
        elif event.kind == "tool_result":
            print(f"{head}{event.tool} → {event.result_summary}{_RESET}")
        elif event.kind == "decision":
            print(f"{head}{event.rationale}{_RESET}")
        else:
            print(f"{head}{event.result_summary or ''}{_RESET}")

        if self.show_raw and event.raw is not None:
            body = json.dumps(event.raw, ensure_ascii=False)
            if len(body) > 220:
                body = body[:217] + "..."
            print(f"{_C['raw']}       raw {body}{_RESET}")
