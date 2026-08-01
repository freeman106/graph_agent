"""에이전트 스켈레톤.

  .venv/bin/python -m agent.main                 픽스처 대화로 실행
  .venv/bin/python -m agent.main --raw           raw 이벤트까지 전부 출력
  .venv/bin/python -m agent.main --reset         그래프를 시드로 되돌리고 실행
  .venv/bin/python -m agent.main --offline       API 없이 스트림 형식만 확인

컨텍스트 구성 순서가 중요하다. 시스템 프롬프트(INSTRUCTIONS)와 툴 스키마는
모듈 상수라 실행마다 바이트가 동일하고, 매번 달라지는 대화 본문은 input 으로
맨 뒤에 붙는다. 프롬프트 캐싱이 먹으려면 이 순서를 깨면 안 된다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from agents import Agent, ItemHelpers, MaxTurnsExceeded, Runner

from contract.schema import Conversation, LimitPayload

from agent import tools as tool_module
from agent.config import (
    DEFAULT_CONVERSATION,
    GRAPH_PATH,
    LAST_RUN_PATH,
    MAX_STEPS,
    MODE,
    MODEL,
)
from agent.store import load_conversation
from agent.stream import StreamWriter

# ════════════════════════════════════════════════════════════════
#  시스템 프롬프트 — 컨텍스트 맨 앞. 실행마다 바뀌지 않는다.
# ════════════════════════════════════════════════════════════════
#
# 단계를 강제하지 않는다. 목표만 주고 어떤 툴을 몇 번 어떤 순서로 부를지는
# 모델이 정한다. 대신 상태를 바꾸기 전에 판단 근거를 남기게 한다.

INSTRUCTIONS = """\
너는 사용자의 개인 지식그래프를 관리하는 에이전트다.

목표: 주어진 대화를 읽고, 거기서 다뤄진 개념들을 기존 지식그래프에 반영하라.

작업 방식은 네가 정한다. 어떤 툴을 몇 번 어떤 순서로 부를지 스스로 결정하고,
할 일이 끝났다고 판단하면 멈춰라. 정해진 단계는 없다.

지켜야 할 것:

1. 그래프 상태를 바꾸는 툴을 호출하기 전에, 왜 그렇게 판단했는지 한 줄을 먼저 써라.
   근거를 밝히지 않은 변경은 하지 않는다.

2. 새 노드를 만들기 전에 search_nodes 로 기존 노드를 확인하라. 표기만 다른 같은
   개념을 중복으로 만들지 않는다. 한글 표기와 영문 표기를 모두 검색해볼 것.

3. search_nodes 가 주는 score 는 문자열이 얼마나 겹치는지일 뿐이다. 같은 개념인지는
   점수가 아니라 네가 판단한다. 점수가 높아도 다른 개념일 수 있고, 낮아도 같을 수 있다.

4. 대화에 근거가 없는 것은 그래프에 넣지 않는다. 네가 일반적으로 아는 사실이더라도
   이 대화에서 다뤄지지 않았다면 넣지 마라.

5. 사용자가 되물었거나, 잘못 알고 있다가 정정된 지점이 있으면 그 개념을 눈여겨봐라.
   그게 이 그래프에서 가장 중요한 정보다.

6. 끝나면 무엇을 어떻게 바꿨는지 짧게 정리하라.
"""

# 지금 물려 있는 툴. B 가 나머지를 채우면 여기에 추가한다.
TOOLS = [tool_module.search_nodes, tool_module.create_node]


def build_agent() -> Agent:
    return Agent(
        name="knowledge-graph-agent",
        instructions=INSTRUCTIONS,
        tools=TOOLS,
        model=MODEL,
    )


def render_conversation(conv: Conversation) -> str:
    """대화를 모델 입력으로 편다. 턴 인덱스를 남겨야 근거 인용이 가능하다."""
    lines = [f"대화 id: {conv.id}", f"제목: {conv.title}", ""]
    speaker_ko = {"user": "사용자", "assistant": "어시스턴트"}
    for turn in conv.turns:
        lines.append(f"[{turn.index}] {speaker_ko[turn.speaker]}: {turn.text}")
    return "\n".join(lines)


# ════════════════════════════════════════════════════════════════
#  실행 — SDK 스트림을 계약 C 로 변환
# ════════════════════════════════════════════════════════════════


async def run(conv: Conversation, writer: StreamWriter) -> None:
    tool_module.CURRENT_CONVERSATION_ID = conv.id

    writer.emit(
        "note",
        result_summary=(
            f"실행 시작 — model={MODEL} mode={MODE} "
            f"max_steps={MAX_STEPS} turns={len(conv.turns)}"
        ),
    )

    agent = build_agent()
    result = Runner.run_streamed(
        agent,
        input=render_conversation(conv),
        max_turns=MAX_STEPS,
    )

    # call_id -> tool_name. 결과를 못 본 호출이 곧 "미처리"다.
    pending: dict[str, str] = {}
    last_rationale: str | None = None

    try:
        async for event in result.stream_events():
            # ── raw 층: 하부 API 원본을 가공 없이 통과시킨다 ──
            if event.type == "raw_response_event":
                writer.emit("note", raw=event.data)
                continue

            if event.type != "run_item_stream_event":
                continue

            item = event.item

            # ── 모델이 남긴 판단 근거 ──
            if event.name == "message_output_created":
                text = ItemHelpers.text_message_output(item).strip()
                if text:
                    last_rationale = text
                    writer.emit("decision", rationale=text, raw=item.raw_item)

            # ── 툴 호출 ──
            elif event.name == "tool_called":
                name = item.tool_name or "unknown"
                call_id = item.call_id or f"call-{writer._seq}"
                pending[call_id] = name
                writer.emit(
                    "tool_call",
                    tool=name,
                    args=_extract_args(item.raw_item),
                    rationale=last_rationale,
                    raw=item.raw_item,
                )

            # ── 툴 반환 ──
            elif event.name == "tool_output":
                call_id = item.call_id or ""
                name = pending.pop(call_id, "unknown")
                writer.emit(
                    "tool_result",
                    tool=name,
                    result_summary=_summarize(item.output),
                    raw=item.raw_item,
                )

    except MaxTurnsExceeded:
        payload = LimitPayload(
            steps_used=result.current_turn,
            max_steps=MAX_STEPS,
            unprocessed=len(pending),
            unprocessed_tools=sorted(pending.values()),
        )
        writer.emit(
            "limit",
            result_summary=(
                f"상한 도달 — {payload.steps_used}/{payload.max_steps} 스텝, "
                f"미처리 {payload.unprocessed}개"
                + (f" ({', '.join(payload.unprocessed_tools)})" if payload.unprocessed else "")
            ),
        )
        return

    final = (result.final_output or "").strip()
    writer.emit("note", result_summary=f"실행 완료 — {result.current_turn} 스텝")
    if final:
        writer.emit("note", result_summary=final)


def _extract_args(raw_item: object) -> dict:
    raw = getattr(raw_item, "arguments", None)
    if raw is None and isinstance(raw_item, dict):
        raw = raw_item.get("arguments")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"_unparsed": raw}
    return {}


def _summarize(output: object, width: int = 120) -> str:
    text = output if isinstance(output, str) else json.dumps(
        output, ensure_ascii=False, default=str
    )
    text = " ".join(text.split())
    return text if len(text) <= width else text[: width - 3] + "..."


# ════════════════════════════════════════════════════════════════
#  오프라인 확인 — API 키 없이 스트림 형식만 본다
# ════════════════════════════════════════════════════════════════


def run_offline(conv: Conversation, writer: StreamWriter) -> None:
    """모델 없이 툴을 직접 호출해 계약 C 스트림을 만든다.

    C(프론트) 와 B(그래프 엔진) 가 크레딧을 쓰지 않고 개발하기 위한 경로다.
    판단은 하드코딩돼 있으므로 에이전트의 동작을 검증하지는 않는다.
    """
    store = tool_module.STORE
    tool_module.CURRENT_CONVERSATION_ID = conv.id

    writer.emit("note", result_summary=f"오프라인 실행 — turns={len(conv.turns)}")

    script = [
        ("KV Cache", "대화 전체가 이 개념을 설명하고 있어 먼저 기존 노드가 있는지 확인한다."),
        ("자기회귀 생성", "캐시가 성립하는 전제로 반복 등장해 별도 개념인지 확인한다."),
    ]

    for query, why in script:
        writer.emit("decision", rationale=why)
        writer.emit("tool_call", tool="search_nodes", args={"query": query, "limit": 5}, rationale=why)
        hits = store.search_nodes(query, 5)
        writer.emit(
            "tool_result",
            tool="search_nodes",
            result_summary=_summarize([h.model_dump() for h in hits]),
        )

    why = "검색 결과에 일치하는 개념이 없고, 대화 전체가 이 개념을 설명하므로 새로 만든다."
    writer.emit("decision", rationale=why)
    args = {
        "name": "KV Cache",
        "summary": "자기회귀 생성에서 이전 토큰들의 Key/Value 텐서를 저장해 재사용하는 추론 전용 최적화.",
        "aliases": ["KV 캐시", "kv-cache", "key value cache"],
    }
    writer.emit("tool_call", tool="create_node", args=args, rationale=why)
    node_id = store.create_node(**args, source_conversation_id=conv.id)
    writer.emit("tool_result", tool="create_node", result_summary=json.dumps({"node_id": node_id}, ensure_ascii=False))

    writer.emit("note", result_summary="오프라인 실행 완료 (모델 호출 없음)")


# ════════════════════════════════════════════════════════════════


def main() -> int:
    parser = argparse.ArgumentParser(description="지식그래프 에이전트 스켈레톤")
    parser.add_argument("--raw", action="store_true", help="raw 원본 이벤트까지 출력")
    parser.add_argument("--reset", action="store_true", help="그래프를 시드로 되돌리고 실행")
    parser.add_argument("--offline", action="store_true", help="API 없이 스트림 형식만 확인")
    parser.add_argument(
        "--conversation", type=Path, default=DEFAULT_CONVERSATION, help="대화 JSON 경로"
    )
    args = parser.parse_args()

    if args.reset:
        tool_module.STORE.reset()
        print(f"그래프를 시드로 되돌렸습니다: {GRAPH_PATH}")

    conv = load_conversation(args.conversation)
    before = len(tool_module.STORE.graph.nodes)

    with StreamWriter(show_raw=args.raw, jsonl_path=LAST_RUN_PATH) as writer:
        if args.offline:
            run_offline(conv, writer)
        else:
            asyncio.run(run(conv, writer))

    store = tool_module.STORE
    after = len(store.graph.nodes)
    print(
        f"\n노드 {before} → {after} (+{after - before}) · 간선 {len(store.graph.edges)}"
        f"\n그래프: {GRAPH_PATH}"
        f"\n스트림: {LAST_RUN_PATH}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
