"""그래프 상태 저장소. JSON 파일 하나. DB 없음.

여기 있는 함수는 전부 사실 조회 또는 상태 변경만 한다.
**어떤 함수에서도 LLM 을 호출하지 않는다.** 판단은 전부 모델이 한다.

B(그래프 엔진) 가 이 파일을 이어받아 get_neighbors / link_nodes / merge_nodes /
mark_progress / lookup_reference / quote_conversation 을 채운다.
아래 "B 가 채울 자리" 섹션에 시그니처만 남겨뒀다.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from contract.schema import (
    Conversation,
    Edge,
    Graph,
    Node,
    NodeStatus,
    ReferenceBook,
    SearchHit,
    Weakpoint,
)

from agent import READ_ENCODING, WRITE_ENCODING
from agent.config import GRAPH_PATH, REFERENCE_BOOK, SEED_GRAPH

# ────────────────────────────────────────────────────────────────
#  정규화 — search_nodes 가 임베딩 대신 쓰는 것
# ────────────────────────────────────────────────────────────────

_SEP = re.compile(r"[\s_/]+")
_PUNCT = re.compile(r"[^0-9a-z가-힣\- ]+")


def normalize(text: str) -> str:
    """소문자 + 구분자 통일. 결과가 예측 가능한 게 임베딩보다 중요하다."""
    lowered = text.lower().strip()
    lowered = _SEP.sub(" ", lowered)
    lowered = _PUNCT.sub("", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def slugify(name: str) -> str:
    """노드 id 생성. 결정적이라 픽스처/재생이 안정적이다."""
    base = normalize(name).replace(" ", "-")
    base = re.sub(r"-+", "-", base).strip("-")
    return base or "node"


# ────────────────────────────────────────────────────────────────
#  저장소
# ────────────────────────────────────────────────────────────────


class GraphStore:
    def __init__(self, path: Path = GRAPH_PATH) -> None:
        self.path = path
        self.graph = self._load()

    # ── 파일 입출력 ──────────────────────────────────────────
    def _load(self) -> Graph:
        if not self.path.exists():
            self.reset()
        return Graph.model_validate_json(self.path.read_text(encoding=READ_ENCODING))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            self.graph.model_dump_json(indent=2), encoding=WRITE_ENCODING
        )

    def reset(self) -> None:
        """시드 그래프로 되돌린다. 데모를 다시 돌릴 때 쓴다."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SEED_GRAPH, self.path)
        self.graph = Graph.model_validate_json(
            self.path.read_text(encoding=READ_ENCODING)
        )

    # ── 조회 ────────────────────────────────────────────────
    def node(self, node_id: str) -> Node | None:
        return next((n for n in self.graph.nodes if n.id == node_id), None)

    def search_nodes(self, query: str, limit: int = 5) -> list[SearchHit]:
        """이름 + 별칭에 대한 정규화 부분 문자열 매칭.

        점수는 참고 수치일 뿐이고 "같은 개념인지"는 판정하지 않는다.
        임계값으로 자동 병합하지 말 것 — 병합은 모델이 merge_nodes 로 결정한다.
        """
        q = normalize(query)
        if not q:
            return []

        hits: list[SearchHit] = []
        for node in self.graph.nodes:
            score = max(
                (self._score(q, normalize(c)) for c in [node.name, *node.aliases]),
                default=0.0,
            )
            if score > 0:
                hits.append(SearchHit(node_id=node.id, name=node.name, score=score))

        hits.sort(key=lambda h: (-h.score, h.name))
        return hits[:limit]

    @staticmethod
    def _score(query: str, candidate: str) -> float:
        if not candidate:
            return 0.0
        if query == candidate:
            return 1.0
        if query in candidate or candidate in query:
            short, long = sorted((len(query), len(candidate)))
            return round(0.6 + 0.3 * (short / long), 3)

        q_tokens = set(query.split())
        c_tokens = set(candidate.split())
        shared = q_tokens & c_tokens
        if not shared:
            return 0.0
        ratio = len(shared) / len(q_tokens | c_tokens)
        return round(0.3 + 0.3 * ratio, 3)

    # ── 변경 ────────────────────────────────────────────────
    def create_node(
        self,
        name: str,
        summary: str,
        aliases: list[str] | None = None,
        source_conversation_id: str | None = None,
    ) -> str:
        """새 노드를 만들고 id 를 돌려준다.

        같은 id 가 이미 있으면 새로 만들지 않고 기존 id 를 그대로 돌려준다.
        (모델이 중복을 만들려 해도 그래프가 깨지지 않게 하는 안전장치일 뿐,
        중복 판정을 대신해주는 게 아니다.)
        """
        node_id = slugify(name)
        existing = self.node(node_id)
        if existing is not None:
            return existing.id

        self.graph.nodes.append(
            Node(
                id=node_id,
                name=name,
                aliases=aliases or [],
                summary=summary,
                status="learned",
                weakpoints=[],
                source_conversation_id=source_conversation_id,
            )
        )
        self.save()
        return node_id

    # ────────────────────────────────────────────────────────
    #  B 가 채울 자리 — 시그니처는 contract/README.md 계약 B 와 같다
    # ────────────────────────────────────────────────────────

    def get_neighbors(self, node_id: str, depth: int = 1) -> list[Edge]:
        raise NotImplementedError("B: 그래프 엔진에서 구현")

    def link_nodes(
        self, from_id: str, to_id: str, relation: str, rationale: str
    ) -> str:
        raise NotImplementedError("B: 그래프 엔진에서 구현")

    def merge_nodes(self, keep_id: str, merge_id: str, reason: str) -> str:
        raise NotImplementedError("B: 그래프 엔진에서 구현")

    def mark_progress(
        self, node_id: str, status: NodeStatus, weakpoint: Weakpoint | None = None
    ) -> bool:
        raise NotImplementedError("B: 그래프 엔진에서 구현")


# ────────────────────────────────────────────────────────────────
#  대화 / 용어 사전 — quote_conversation, lookup_reference 의 재료
# ────────────────────────────────────────────────────────────────


def load_conversation(path: Path) -> Conversation:
    return Conversation.model_validate_json(path.read_text(encoding=READ_ENCODING))


def load_reference_book(path: Path = REFERENCE_BOOK) -> ReferenceBook:
    return ReferenceBook.model_validate(json.loads(path.read_text(encoding=READ_ENCODING)))
