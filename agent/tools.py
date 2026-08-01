"""에이전트에 물리는 툴.

지금 물려 있는 것은 search_nodes 와 create_node 두 개뿐이다.
나머지 여섯 개는 B 가 store.py 를 채운 뒤 여기에 래퍼를 추가하고
main.py 의 TOOLS 목록에 넣으면 된다.

규칙:
  * 툴 안에서 LLM 을 호출하지 않는다. 조회하거나 상태를 바꾸기만 한다.
  * search_nodes 는 점수를 돌려주되 "같은 개념인지" 판정하지 않는다.
  * 반환값은 JSON 문자열. 모델이 읽기 쉽고 직렬화 사고가 없다.

docstring 이 곧 툴 설명이 되어 모델의 컨텍스트에 들어간다.
`@function_tool` 은 strict_mode=True 가 기본이고, 기본값 인자를 자동으로
required + nullable 스키마로 바꿔준다. 스키마를 손으로 만들지 말 것.
"""

from __future__ import annotations

import json

from agents import function_tool

from agent.store import GraphStore

# 모든 툴이 공유하는 단일 저장소. 프로세스 하나에 그래프 하나.
STORE = GraphStore()

# 이번 실행이 다루는 대화 id. main 이 실행 시작 시 채운다.
CURRENT_CONVERSATION_ID: str | None = None


def _json(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False)


@function_tool
def search_nodes(query: str, limit: int = 5) -> str:
    """지식그래프에서 이름이나 별칭이 비슷한 개념 노드를 찾는다.

    새 노드를 만들기 전에 반드시 먼저 호출해서, 표기만 다른 같은 개념이
    이미 있는지 확인하라. score 는 문자열이 얼마나 겹치는지를 나타내는
    참고 수치일 뿐이며, 같은 개념인지에 대한 판정이 아니다. 그 판단은 네가 한다.

    Args:
        query: 찾을 개념 이름. 한글/영문 모두 가능하다.
        limit: 최대 결과 개수.
    """
    hits = STORE.search_nodes(query, limit)
    return _json([h.model_dump() for h in hits])


@function_tool
def create_node(name: str, summary: str, aliases: list[str]) -> str:
    """지식그래프에 새 개념 노드를 만들고 node_id 를 돌려준다.

    호출 전에 search_nodes 로 기존 노드를 확인했어야 한다.
    aliases 에는 이 개념을 가리키는 다른 표기를 넣어라 — 한글 표기, 약어,
    띄어쓰기 변형 등. 다음 대화에서 같은 개념을 다시 찾을 때 쓰인다.

    Args:
        name: 노드 표시 이름. 예) KV Cache
        summary: 개념 요약 1~3문장.
        aliases: 다른 표기 목록. 없으면 빈 배열.
    """
    node_id = STORE.create_node(
        name=name,
        summary=summary,
        aliases=aliases,
        source_conversation_id=CURRENT_CONVERSATION_ID,
    )
    return _json({"node_id": node_id})


# ────────────────────────────────────────────────────────────────
#  B 가 추가할 툴 — store.py 의 대응 메서드를 채운 뒤 여기에 래퍼를 쓴다
#
#  @function_tool
#  def get_neighbors(node_id: str, depth: int = 1) -> str: ...
#  def lookup_reference(term: str) -> str: ...
#  def quote_conversation(keyword: str, window: int = 2) -> str: ...
#  def link_nodes(from_id, to_id, relation, rationale) -> str: ...
#  def merge_nodes(keep_id, merge_id, reason) -> str: ...
#  def mark_progress(node_id, status, weakpoint) -> str: ...
# ────────────────────────────────────────────────────────────────
