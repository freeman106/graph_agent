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

from contract.schema import Comment, NodeOrigin, NodeStatus, Relation

from agent.store import GraphStore

# 모든 툴이 공유하는 단일 저장소. 프로세스 하나에 그래프 하나.
STORE = GraphStore()

# 이번 실행의 출처. main 이 실행 시작 시 채운다.
# 강의안 실행이면 origin="lecture" + lecture_id, 대화 실행이면 "conversation" + conversation_id.
CURRENT_CONVERSATION_ID: str | None = None
CURRENT_LECTURE_ID: str | None = None
CURRENT_ORIGIN: NodeOrigin = "conversation"


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
def create_node(
    name: str,
    summary: str,
    aliases: list[str],
    document: str,
    subtopic_id: str | None = None,
) -> str:
    """지식그래프에 새 개념 노드를 만들고 node_id 를 돌려준다.

    호출 전에 search_nodes 로 기존 노드를 확인했어야 한다.
    aliases 에는 이 개념을 가리키는 다른 표기를 넣어라 — 한글 표기, 약어,
    띄어쓰기 변형 등. 다음 대화에서 같은 개념을 다시 찾을 때 쓰인다.

    subtopic_id 는 **이미 있는 소주제만** 받는다. 단원과 소주제는 강의안을
    넣을 때만 만들어지므로, 여기서는 기존 소주제 중 하나로 분류만 한다.
    어디에도 맞지 않으면 비워 둬라.

    Args:
        name: 노드 표시 이름. 예) KV Cache
        summary: 개념 요약 1~3문장. 그래프 노드에 붙는 한 줄.
        aliases: 다른 표기 목록. 없으면 빈 배열.
        document: 이 개념의 문서 본문. 읽을 수 있는 글로 쓴다.
        subtopic_id: 분류할 기존 소주제 id. 없으면 null.
    """
    node_id = STORE.create_node(
        name=name,
        summary=summary,
        aliases=aliases,
        document=document,
        subtopic_id=subtopic_id,
        origin=CURRENT_ORIGIN,
        source_conversation_id=CURRENT_CONVERSATION_ID,
        source_lecture_id=CURRENT_LECTURE_ID,
    )
    return _json({"node_id": node_id})


# ── 강의안 실행 전용 ──────────────────────────────────────────
# 대화 실행에는 이 두 개가 노출되지 않는다. 단원을 못 만들게 하는 방법은
# 지시가 아니라 툴을 안 주는 것이다.


@function_tool
def create_chapter(title: str) -> str:
    """단원을 만들고 chapter_id 를 돌려준다. 그래프에서 세로 줄 하나가 된다.

    강의안의 큰 목차 단위로 만들어라. 개념 하나마다 만들지 않는다.

    Args:
        title: 단원 제목. 예) 입력 표현
    """
    return _json({"chapter_id": STORE.create_chapter(title)})


@function_tool
def create_subtopic(chapter_id: str, title: str, blurb: str) -> str:
    """단원 안에 소주제를 만들고 subtopic_id 를 돌려준다.

    소주제는 노트에서 노드 문서들을 잘게 묶는 단위다. 그래프에는 안 보인다.

    Args:
        chapter_id: 이 소주제가 속할 기존 단원 id.
        title: 소주제 제목.
        blurb: 이 소주제가 무엇인지 짧은 한 문장.
    """
    return _json({"subtopic_id": STORE.create_subtopic(chapter_id, title, blurb)})


@function_tool
def get_neighbors(node_id: str, depth: int = 1) -> str:
    """노드와 연결된 간선을 depth 단계까지 조회한다.

    간선은 양방향으로 인접성을 계산하지만, 반환된 from_id / to_id / relation의
    방향은 그래프에 저장된 원본을 유지한다.

    Args:
        node_id: 기준 노드 ID.
        depth: 인접 노드를 확장할 단계 수. 기본값은 1.
    """
    edges = STORE.get_neighbors(node_id, depth)
    return _json([edge.model_dump() for edge in edges])


@function_tool
def link_nodes(from_id: str, to_id: str, relation: Relation, rationale: str) -> str:
    """두 기존 노드 사이에 방향 있는 관계를 추가하고 edge_id를 반환한다.

    from_id 노드는 to_id 노드의 relation이어야 한다. 예를 들어
    Softmax --component--> Attention은 "Softmax는 Attention의 구성 요소"를 뜻한다.
    같은 방향과 관계의 간선이 이미 있으면 기존 edge_id를 반환한다.

    Args:
        from_id: relation의 주어가 되는 기존 노드 ID.
        to_id: relation의 대상이 되는 기존 노드 ID.
        relation: prerequisite, component, variant, contrast, application 중 하나.
        rationale: 이 간선을 추가하는 대화 근거.
    """
    edge_id = STORE.link_nodes(from_id, to_id, relation, rationale)
    return _json({"edge_id": edge_id})


@function_tool
def merge_nodes(keep_id: str, merge_id: str, reason: str) -> str:
    """중복이라고 판단한 두 노드를 병합하고 남겨 둔 node_id를 반환한다.

    판단은 모델이 한다. 이 도구는 merge_id의 별칭과 약점을 keep_id로 옮기고,
    merge_id를 가리키던 간선을 keep_id로 다시 연결한다.

    Args:
        keep_id: 남길 기존 노드 ID.
        merge_id: 제거하여 keep_id에 합칠 기존 노드 ID.
        reason: 두 노드가 같은 개념이라고 판단한 근거.
    """
    node_id = STORE.merge_nodes(keep_id, merge_id, reason)
    return _json({"node_id": node_id})


@function_tool
def mark_progress(
    node_id: str, status: NodeStatus, comment: Comment | None = None
) -> str:
    """노드의 학습 상태를 기록하고, 있으면 문서에 코멘트를 단다.

    comment.quote 는 그 노드 document 안에 있는 문장을 **그대로** 넣어야 한다.
    프론트가 문서에서 그 문자열을 찾아 하이라이트하고 코멘트를 옆에 붙인다.
    문장을 고쳐 쓰면 하이라이트가 걸리지 않는다. 문서 전체에 대한 코멘트면 비워 둔다.

    약점을 짚는 코멘트라면 comment.weakpoint 를 채운다. 그 안의 evidence 는
    quote_conversation 으로 가져온 대화 원문이어야 한다. 판단은 모델이 하고
    이 도구는 저장만 한다.

    Args:
        node_id: 상태를 바꿀 기존 노드 ID.
        status: unlearned, learned, weak 중 하나.
        comment: 문서에 달 코멘트. 없으면 null.
    """
    ok = STORE.mark_progress(node_id, status, comment)
    return _json({"ok": ok})


@function_tool
def lookup_reference(term: str) -> str:
    """로컬 용어 사전에서 개념의 기준 설명을 조회한다.

    이 도구는 LLM이나 외부 검색을 쓰지 않는다. found가 false면 사전에 없는
    용어이므로, 대화 근거와 네 판단을 바탕으로 그래프를 다뤄야 한다.

    Args:
        term: 조회할 용어. 띄어쓰기·대소문자 변형은 정규화한다.
    """
    return _json(STORE.lookup_reference(term).model_dump())


@function_tool
def quote_conversation(keyword: str, window: int = 2) -> str:
    """대화에서 키워드가 나온 턴과 지정한 범위의 앞뒤 문맥을 찾는다.

    반환된 text는 판단 근거를 확인할 때만 쓰고, 키워드가 있다는 사실만으로
    약점이나 관계를 자동으로 결정하지 마라.

    Args:
        keyword: 찾을 단어 또는 구절. 띄어쓰기·대소문자 변형은 정규화한다.
        window: 일치한 턴마다 포함할 앞뒤 문맥 턴 수. 기본값은 2.
    """
    quotes = STORE.quote_conversation(keyword, window)
    return _json([quote.model_dump() for quote in quotes])
