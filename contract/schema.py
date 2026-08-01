"""
팀 데이터 계약 (원본).

이 파일이 진실의 원본이고 contract/schema.ts 가 그 TypeScript 사본이다.
한쪽을 고치면 반드시 다른 쪽도 같이 고친다.

담당별로 여기서 봐야 할 것:
  A 에이전트 코어  → 계약 B(툴 시그니처) + 계약 C(스트림 이벤트)
  B 그래프 엔진    → 계약 A(그래프 상태) + 계약 B(툴 시그니처)
  C 프론트 + 스트림 → 계약 A(그래프 상태) + 계약 C(스트림 이벤트)
  D 노트 + 발표물   → 계약 A 의 Weakpoint / Evidence

설계 원칙 두 개:
  1. 좌표는 계약에 없다. 레이아웃은 전적으로 프론트 책임이고 백엔드는
     그래프 구조만 다룬다.
  2. 툴은 사실을 조회하거나 상태를 변경만 한다. 판단은 전부 LLM 이 한다.
     어떤 툴 안에서도 LLM 을 호출하지 않는다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

SCHEMA_VERSION = 1

# ════════════════════════════════════════════════════════════════════
#  계약 A — 그래프 상태
# ════════════════════════════════════════════════════════════════════

NodeStatus = Literal[
    "unlearned",  # 아직 안 밟은 노드. 다음에 공부할 후보
    "learned",  # 학습 완료
    "weak",  # 공부했지만 대화에서 헤맨 흔적이 있음
]

Relation = Literal[
    "prerequisite",  # 선행 개념
    "component",  # 구성 요소
    "variant",  # 변형
    "contrast",  # 대비
    "application",  # 응용
]

#: 간선 방향 규칙 — `from_id` 노드가 `to_id` 노드의 `relation` 이다.
#: 예) Softmax --component--> Attention  =  "Softmax 는 Attention 의 구성 요소"
#: 이 규칙을 어기면 그래프 전체의 화살표 방향이 뒤집힌다. 반드시 지킬 것.
EDGE_DIRECTION_RULE = "from_id is the {relation} of to_id"


class Evidence(BaseModel):
    """근거: 이 판단이 나온 대화 구간."""

    index: int = Field(description="대화 턴 인덱스 (0-based)")
    speaker: Literal["user", "assistant"]
    text: str


class Weakpoint(BaseModel):
    """대화에서 막혔던 지점 하나.

    이 제품의 차별점이 담기는 자리다. 강의노트를 위한 별도 툴을 두지 않고
    노드에 붙는 이 구조체가 노트 본문 역할을 한다.
    """

    description: str = Field(description="무엇에서 어떻게 막혔는지 한두 문장")
    misconception: str | None = Field(
        default=None, description="정정 전 — 사용자가 잘못 알고 있던 내용"
    )
    correction: str | None = Field(
        default=None, description="정정 후 — 무엇이 맞는 설명인지"
    )
    evidence: list[Evidence] = Field(
        default_factory=list, description="이 판단의 근거가 된 대화 구간"
    )
    source_conversation_id: str | None = None


class Node(BaseModel):
    """지식그래프의 개념 노드.

    좌표(x, y)는 여기 없다. 프론트가 자기 로컬 상태로 관리한다.
    """

    id: str = Field(description="슬러그 형태의 안정적 식별자. 예) self-attention")
    name: str = Field(description="표시 이름. 예) Self-Attention")
    aliases: list[str] = Field(
        default_factory=list,
        description="같은 개념을 가리키는 다른 표기. search_nodes 가 이걸 본다",
    )
    summary: str = Field(default="", description="개념 요약 1~3문장")
    status: NodeStatus = "unlearned"
    weakpoints: list[Weakpoint] = Field(default_factory=list)
    source_conversation_id: str | None = Field(
        default=None, description="이 노드를 만들어낸 대화. 시드 노드는 None"
    )


class Edge(BaseModel):
    """개념 사이의 관계. 방향 규칙은 EDGE_DIRECTION_RULE 참고."""

    id: str
    from_id: str
    to_id: str
    relation: Relation
    rationale: str = Field(
        description="왜 이 관계를 붙였는지 한 줄. 대화 근거가 없으면 붙이지 않는다"
    )


class Graph(BaseModel):
    """디스크에 저장되는 그래프 전체. JSON 파일 하나가 이 모양이다."""

    version: int = SCHEMA_VERSION
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)


# ════════════════════════════════════════════════════════════════════
#  계약 B — 툴 시그니처
# ════════════════════════════════════════════════════════════════════
#
# 조회 툴
#   search_nodes(query: str, limit: int = 5)        -> list[SearchHit]
#   get_neighbors(node_id: str, depth: int = 1)     -> list[Edge]
#   lookup_reference(term: str)                     -> ReferenceEntry
#   quote_conversation(keyword: str, window: int=2) -> list[ConversationQuote]
#
# 변경 툴
#   create_node(name: str, summary: str, aliases: list[str])              -> node_id
#   link_nodes(from_id, to_id, relation: Relation, rationale: str)        -> edge_id
#   merge_nodes(keep_id: str, merge_id: str, reason: str)                 -> node_id
#   mark_progress(node_id, status: NodeStatus, weakpoint: Weakpoint|None) -> ok
#
# 규칙:
#   * 툴 안에서 LLM 을 호출하지 않는다. 판단은 전부 모델이 한다.
#   * search_nodes 는 유사도 점수만 돌려주고 "같은 개념인지"는 판정하지 않는다.
#     임계값으로 자동 병합하지 말 것. 병합 결정은 모델이 merge_nodes 로 내린다.
#   * search_nodes 는 임베딩을 쓰지 않는다. 소문자 정규화 + 별칭 사전 +
#     부분 문자열 매칭. 노드 50개 규모에서는 그게 충분하고 결과가 예측 가능하다.


class SearchHit(BaseModel):
    """search_nodes 의 결과 한 건."""

    node_id: str
    name: str
    score: float = Field(
        ge=0.0,
        le=1.0,
        description="0~1 유사도. 1.0 = 이름/별칭 완전 일치. "
        "이건 참고 수치일 뿐 동일 개념 판정이 아니다",
    )


class ReferenceEntry(BaseModel):
    """lookup_reference 의 결과. 로컬 용어 사전 조회 결과이며 LLM 을 타지 않는다."""

    found: bool
    canonical_name: str | None = None
    summary: str | None = None
    source: str | None = Field(
        default=None, description="사전 항목의 출처 표기. 예) local-reference-v1"
    )


class ConversationQuote(BaseModel):
    """quote_conversation 의 결과 한 건."""

    index: int = Field(description="대화 턴 인덱스 (0-based)")
    text: str


# ════════════════════════════════════════════════════════════════════
#  계약 C — 스트림 이벤트
# ════════════════════════════════════════════════════════════════════

StreamKind = Literal[
    "tool_call",  # 툴 호출 시작
    "tool_result",  # 툴 반환
    "decision",  # 모델이 남긴 판단 근거 (상태 변경 직전)
    "note",  # 실행 메타 (시작/종료 등)
    "error",  # 실패
    "limit",  # 스텝 상한 도달
]


class StreamEvent(BaseModel):
    """백엔드 → 프론트로 흐르는 단위 이벤트.

    한 스트림에 두 층이 실린다:
      * raw            — 하부 API 원본 이벤트를 가공 없이 담는 자리 (대회 규칙 필수 요소)
      * 나머지 필드     — rationale 중심 요약 뷰용

    프론트는 이 하나의 스트림을 받아 raw 뷰 / 요약 뷰를 토글로 전환한다.
    """

    seq: int = Field(description="0부터 단조 증가. 실행 하나 안에서 유일")
    ts: str = Field(description="ISO 8601 UTC")
    kind: StreamKind

    tool: str | None = Field(default=None, description="tool_call / tool_result 일 때 툴 이름")
    args: dict | None = Field(default=None, description="tool_call 의 인자")
    result_summary: str | None = Field(
        default=None, description="사람이 읽는 한 줄 요약. 원본이 아니라 요약이다"
    )
    rationale: str | None = Field(
        default=None,
        description="모델이 왜 그렇게 판단했는지 한 줄. kind='decision' 이면 필수. "
        "tool_call 에는 직전 decision 의 내용이 실려 온다",
    )
    raw: object | None = Field(
        default=None,
        description="하부 API 원본 이벤트. 가공하지 않는다. 없으면 None",
    )

    @model_validator(mode="after")
    def _decision_needs_rationale(self) -> "StreamEvent":
        if self.kind == "decision" and not self.rationale:
            raise ValueError("kind='decision' 이벤트에는 rationale 이 필수다")
        return self


class LimitPayload(BaseModel):
    """kind='limit' 이벤트의 result_summary 를 만들 때 쓰는 구조.

    상한에 걸리면 조용히 멈추지 않고 이 정보를 실어 내보낸다.
    'unprocessed' 는 상한에 걸린 턴에서 실행하지 않고 버린 툴 호출 개수다.
    """

    steps_used: int
    max_steps: int
    unprocessed: int
    unprocessed_tools: list[str] = Field(default_factory=list)


# ════════════════════════════════════════════════════════════════════
#  입력 대화
# ════════════════════════════════════════════════════════════════════


class Turn(BaseModel):
    index: int
    speaker: Literal["user", "assistant"]
    text: str


class Conversation(BaseModel):
    """붙여넣은 대화 하나. quote_conversation 이 이걸 훑는다."""

    id: str
    title: str = ""
    turns: list[Turn] = Field(default_factory=list)


class ReferenceBook(BaseModel):
    """lookup_reference 가 조회하는 로컬 용어 사전."""

    source: str = "local-reference-v1"
    entries: dict[str, ReferenceEntry] = Field(default_factory=dict)


__all__ = [
    "SCHEMA_VERSION",
    "EDGE_DIRECTION_RULE",
    "NodeStatus",
    "Relation",
    "Evidence",
    "Weakpoint",
    "Node",
    "Edge",
    "Graph",
    "SearchHit",
    "ReferenceEntry",
    "ConversationQuote",
    "StreamKind",
    "StreamEvent",
    "LimitPayload",
    "Turn",
    "Conversation",
    "ReferenceBook",
]
