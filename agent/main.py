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

CONVERSATION_INSTRUCTIONS = """\
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
   그게 이 그래프에서 가장 중요한 정보다. mark_progress 의 comment 로 남긴다.

6. 코멘트의 quote 는 그 노드 document 안에 있는 문장을 그대로 넣어라. 프론트가
   문서에서 그 문자열을 찾아 하이라이트한다. 고쳐 쓰면 하이라이트가 걸리지 않는다.

7. 약점의 evidence 는 대화 원문 그대로여야 한다. 기억해서 옮겨 적지 말고
   quote_conversation 으로 가져와서 그 텍스트를 그대로 써라. 요약하거나 줄이면
   근거가 아니게 된다. 화면에는 이 문장이 "대화에서 실제로 이렇게 말했다" 로 표시된다.

8. 단원과 소주제는 새로 만들지 않는다. 이미 있는 소주제 중에서 고르기만 하라.
   아래 목록에 맞는 게 없으면 subtopic_id 를 비워 둬라.

9. 끝나면 무엇을 어떻게 바꿨는지 짧게 정리하라.
"""

LECTURE_INSTRUCTIONS = """\
너는 사용자의 개인 지식그래프를 만드는 에이전트다.

목표: 주어진 강의안을 읽고, 거기서 다뤄진 개념들로 지식그래프의 첫 모습을 만들어라.

작업 방식은 네가 정한다. 어떤 툴을 몇 번 어떤 순서로 부를지 스스로 결정하고,
할 일이 끝났다고 판단하면 멈춰라. 정해진 단계는 없다.

지켜야 할 것:

1. 그래프 상태를 바꾸는 툴을 호출하기 전에, 왜 그렇게 판단했는지 한 줄을 먼저 써라.

2. 단원(create_chapter)과 소주제(create_subtopic)는 지금 이 실행에서만 만들 수 있다.
   나중에 대화로 추가되는 개념들도 전부 여기서 만든 분류 안으로 들어온다.
   그러니 강의안의 큰 흐름을 담되, 나중 개념도 들어올 자리가 있게 잡아라.

3. 단원은 강의안의 큰 목차 단위다. 개념 하나마다 만들지 않는다.
   소주제는 그 안에서 문서 몇 개를 묶는 단위이고, blurb 에 한 문장으로 설명을 단다.

4. 노드는 개념 단위로 만든다. document 에는 그 개념을 설명하는 읽을 수 있는 글을 써라.
   summary 는 그래프에 붙는 한 줄이고, document 는 노트에서 읽는 본문이다. 둘은 다르다.

5. document 는 강의안에 실제로 있는 내용으로 쓴다. 네가 아는 사실이라도 강의안이
   다루지 않았으면 넣지 마라. 나중에 학생이 무엇을 덜 이해했는지 판정하는 기준선이 된다.

6. 개념 사이 관계가 강의안에 드러나 있으면 link_nodes 로 이어라.

7. 끝나면 무엇을 만들었는지 짧게 정리하라.
"""

# 실행 종류에 따라 툴 목록이 다르다.
#
# 단원과 소주제는 강의안을 넣을 때만 만들어진다. 대화 실행에서는 기존 것으로
# 분류만 한다. 이걸 프롬프트로 부탁하지 않고 **툴을 안 주는 것으로** 강제한다 —
# 지시는 언젠가 무시되지만 없는 툴은 부를 수 없다.
#
# 순서를 강제하는 게 아니라 할 수 있는 일의 범위를 정하는 것이라
# "단계를 강제하지 않는다"(AGENTS.md 7절) 와 부딪히지 않는다.

_READ_TOOLS = [
    tool_module.search_nodes,
    tool_module.get_neighbors,
    tool_module.lookup_reference,
]

_GRAPH_TOOLS = [
    tool_module.create_node,
    tool_module.link_nodes,
    tool_module.merge_nodes,
    tool_module.mark_progress,
]

# 강의안 실행 — 단원/소주제를 만들 수 있다. 대화가 없으므로 quote_conversation 이 없다.
LECTURE_TOOLS = [
    *_READ_TOOLS,
    tool_module.create_chapter,
    tool_module.create_subtopic,
    *_GRAPH_TOOLS,
]

# 대화 실행 — 단원/소주제를 만들 수 없다. 대신 대화를 인용할 수 있다.
CONVERSATION_TOOLS = [
    *_READ_TOOLS,
    tool_module.quote_conversation,
    *_GRAPH_TOOLS,
]


def build_agent() -> Agent:
    return Agent(
        name="knowledge-graph-agent",
        instructions=CONVERSATION_INSTRUCTIONS,
        tools=CONVERSATION_TOOLS,
        model=MODEL,
    )


def render_chapters() -> str:
    """기존 단원/소주제 목록. 모델이 분류하려면 뭐가 있는지 봐야 한다.

    툴로 조회하게 하면 턴을 하나 쓰고 안 부를 수도 있다. 목록이 작으므로
    입력 앞에 붙인다. 가변부라 프롬프트 캐싱 순서도 깨지 않는다.
    """
    chapters = tool_module.STORE.graph.chapters
    if not chapters:
        return "분류 가능한 단원: (없음 — subtopic_id 는 비워 둔다)\n"
    lines = ["분류 가능한 단원과 소주제 (새로 만들 수 없다. 이 중에서만 고른다):"]
    for chapter in chapters:
        lines.append(f"  [{chapter.id}] {chapter.title}")
        for sub in chapter.subtopics:
            blurb = f" — {sub.blurb}" if sub.blurb else ""
            lines.append(f"     subtopic_id={sub.id}  {sub.title}{blurb}")
    return "\n".join(lines) + "\n"


def render_conversation(conv: Conversation) -> str:
    """대화를 모델 입력으로 편다. 턴 인덱스를 남겨야 근거 인용이 가능하다."""
    lines = [render_chapters(), f"대화 id: {conv.id}", f"제목: {conv.title}", ""]
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

    # 근거(message)와 툴 호출(tool_called)이 오는 순서는 하부 스트림에 따라 다르다.
    # 실제 OpenAI 스트리밍에서는 툴 호출이 먼저다 — SDK 가 툴 호출은 스트림 도중에
    # 바로 내보내고(run_loop), 메시지는 턴이 끝난 뒤에 내보내기 때문이다(streaming).
    # 반대로 output_item.done 을 주지 않는 백엔드에서는 메시지가 먼저 온다.
    # 어느 쪽이든 "툴 호출에는 같은 턴의 근거가 붙는다" 가 유지되게 한다:
    #   근거가 아직 없으면 툴 호출을 잡아뒀다가 근거가 나오면 그 뒤에 내보내고,
    #   근거를 이미 봤으면 바로 내보낸다. 턴이 끝나면(tool_result) 근거를 버린다.
    buffered: list[tuple[str, dict, object]] = []
    turn_rationale: str | None = None

    def flush(rationale: str | None) -> None:
        for name, args, raw in buffered:
            writer.emit("tool_call", tool=name, args=args, rationale=rationale, raw=raw)
        buffered.clear()

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
                    writer.emit("decision", rationale=text, raw=item.raw_item)
                    turn_rationale = text
                    flush(text)

            # ── 툴 호출 ──
            elif event.name == "tool_called":
                name = item.tool_name or "unknown"
                call_id = item.call_id or f"call-{writer._seq}"
                pending[call_id] = name
                args = _extract_args(item.raw_item)
                if turn_rationale is None:
                    buffered.append((name, args, item.raw_item))
                else:
                    writer.emit(
                        "tool_call",
                        tool=name,
                        args=args,
                        rationale=turn_rationale,
                        raw=item.raw_item,
                    )

            # ── 툴 반환 ── 여기서 턴이 끝난다
            elif event.name == "tool_output":
                # 근거 없이 툴만 부른 턴. 근거를 지어내지 않고 비워서 내보낸다.
                flush(None)
                turn_rationale = None
                call_id = item.call_id or ""
                name = pending.pop(call_id, "unknown")
                writer.emit(
                    "tool_result",
                    tool=name,
                    result_summary=_summarize(item.output),
                    raw=item.raw_item,
                )

    except MaxTurnsExceeded:
        # 보류 중인 호출을 삼키지 않는다 — 상한에 걸린 순간을 그대로 보여준다.
        flush(None)
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

    flush(None)
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
