"""노트에서 선택한 문장에 답하는 단일 모델 호출."""

from __future__ import annotations

import asyncio
import json
import sys

from openai import AsyncOpenAI

from agent.config import MODEL


INSTRUCTIONS = """\
너는 학습 노트 안에서 질문을 받는 튜터다.
제공된 노트와 선택 문장을 우선 근거로 삼아 한국어로 정확하고 간결하게 답하라.
질문에 필요한 정보가 노트에 부족하면 추측해서 채우지 말고, 부족한 부분을 분명히 밝혀라.
답만 출력하고 메타 설명이나 JSON은 출력하지 마라.
"""


async def answer(payload: dict[str, object]) -> str:
    question = str(payload.get("question", "")).strip()
    quote = str(payload.get("quote", "")).strip()
    node_name = str(payload.get("nodeName", "")).strip()
    document = str(payload.get("document", "")).strip()
    if not question or not quote:
        raise ValueError("질문과 선택 문장이 필요합니다.")

    client = AsyncOpenAI()
    response = await client.responses.create(
        model=MODEL,
        instructions=INSTRUCTIONS,
        input=(
            f"개념: {node_name or '이름 없음'}\n\n"
            f"선택 문장:\n{quote}\n\n"
            f"관련 노트:\n{document or '(관련 노트 없음)'}\n\n"
            f"학습자 질문:\n{question}"
        ),
    )
    result = response.output_text.strip()
    if not result:
        raise RuntimeError("모델이 빈 답변을 반환했습니다.")
    return result


def main() -> int:
    payload = json.loads(sys.stdin.read())
    result = asyncio.run(answer(payload))
    print(json.dumps({"answer": result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
