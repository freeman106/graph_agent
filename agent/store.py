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
    Chapter,
    Comment,
    Conversation,
    ConversationQuote,
    Edge,
    Graph,
    Node,
    NodeOrigin,
    NodeStatus,
    Relation,
    ReferenceBook,
    ReferenceEntry,
    SearchHit,
    Subtopic,
)

from agent import READ_ENCODING, WRITE_ENCODING
from agent.config import DEFAULT_CONVERSATION, GRAPH_PATH, REFERENCE_BOOK, SEED_GRAPH

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
        document: str = "",
        chapter_id: str | None = None,
        subtopic_id: str | None = None,
        origin: NodeOrigin = "conversation",
        source_conversation_id: str | None = None,
        source_lecture_id: str | None = None,
    ) -> str:
        """새 노드를 만들고 id 를 돌려준다.

        같은 id 가 이미 있으면 새로 만들지 않고 기존 id 를 그대로 돌려준다.
        (모델이 중복을 만들려 해도 그래프가 깨지지 않게 하는 안전장치일 뿐,
        중복 판정을 대신해주는 게 아니다.)

        chapter_id / subtopic_id 는 **이미 있는 것만** 받는다. 단원과 소주제는
        강의안 투입 때만 만들어지고, 대화에서는 분류만 하기 때문이다.
        """
        if chapter_id is not None and self.chapter(chapter_id) is None:
            raise ValueError(
                f"존재하지 않는 chapter_id: {chapter_id} — 단원은 강의안 투입 때만 만들어진다"
            )
        if subtopic_id is not None:
            owner = self.chapter_of_subtopic(subtopic_id)
            if owner is None:
                raise ValueError(f"존재하지 않는 subtopic_id: {subtopic_id}")
            if chapter_id is not None and owner.id != chapter_id:
                raise ValueError(
                    f"소주제 {subtopic_id} 는 단원 {owner.id} 소속인데 chapter_id 는 {chapter_id}"
                )
            chapter_id = owner.id

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
                document=document,
                chapter_id=chapter_id,
                subtopic_id=subtopic_id,
                status="learned",
                origin=origin,
                comments=[],
                source_conversation_id=source_conversation_id,
                source_lecture_id=source_lecture_id,
            )
        )
        self.save()
        return node_id

    # ── 단원 / 소주제 ───────────────────────────────────────
    # 강의안 투입 경로에서만 쓰인다. 대화 실행에는 툴이 노출되지 않는다.

    def chapter(self, chapter_id: str) -> Chapter | None:
        return next((c for c in self.graph.chapters if c.id == chapter_id), None)

    def chapter_of_subtopic(self, subtopic_id: str) -> Chapter | None:
        for chapter in self.graph.chapters:
            if any(s.id == subtopic_id for s in chapter.subtopics):
                return chapter
        return None

    def create_chapter(self, title: str) -> str:
        chapter_id = slugify(title)
        if self.chapter(chapter_id) is None:
            self.graph.chapters.append(Chapter(id=chapter_id, title=title))
            self.save()
        return chapter_id

    def create_subtopic(self, chapter_id: str, title: str, blurb: str = "") -> str:
        chapter = self.chapter(chapter_id)
        if chapter is None:
            raise ValueError(f"존재하지 않는 chapter_id: {chapter_id}")
        subtopic_id = slugify(f"{chapter_id}-{title}")
        if not any(s.id == subtopic_id for s in chapter.subtopics):
            chapter.subtopics.append(
                Subtopic(id=subtopic_id, title=title, blurb=blurb)
            )
            self.save()
        return subtopic_id

    # ────────────────────────────────────────────────────────
    #  B 가 채울 자리 — 시그니처는 contract/README.md 계약 B 와 같다
    # ────────────────────────────────────────────────────────

    def get_neighbors(self, node_id: str, depth: int = 1) -> list[Edge]:
        if depth <= 0 or self.node(node_id) is None:
            return []

        visited_nodes = {node_id}
        frontier = {node_id}
        seen_edges: set[str] = set()
        neighbors: list[Edge] = []

        for _ in range(depth):
            next_frontier: set[str] = set()
            for edge in self.graph.edges:
                if edge.from_id not in frontier and edge.to_id not in frontier:
                    continue

                if edge.id not in seen_edges:
                    seen_edges.add(edge.id)
                    neighbors.append(edge)

                if edge.from_id in frontier and edge.to_id not in visited_nodes:
                    next_frontier.add(edge.to_id)
                if edge.to_id in frontier and edge.from_id not in visited_nodes:
                    next_frontier.add(edge.from_id)

            visited_nodes.update(next_frontier)
            frontier = next_frontier
            if not frontier:
                break

        return neighbors

    def link_nodes(
        self, from_id: str, to_id: str, relation: Relation, rationale: str
    ) -> str:
        if from_id == to_id:
            raise ValueError("간선의 양 끝 노드는 달라야 합니다")
        if self.node(from_id) is None:
            raise ValueError(f"존재하지 않는 from_id: {from_id}")
        if self.node(to_id) is None:
            raise ValueError(f"존재하지 않는 to_id: {to_id}")

        existing = next(
            (
                edge
                for edge in self.graph.edges
                if edge.from_id == from_id
                and edge.to_id == to_id
                and edge.relation == relation
            ),
            None,
        )
        if existing is not None:
            return existing.id

        edge_id = f"{from_id}-{to_id}-{relation}"
        if any(edge.id == edge_id for edge in self.graph.edges):
            suffix = 2
            while any(edge.id == f"{edge_id}-{suffix}" for edge in self.graph.edges):
                suffix += 1
            edge_id = f"{edge_id}-{suffix}"

        self.graph.edges.append(
            Edge(
                id=edge_id,
                from_id=from_id,
                to_id=to_id,
                relation=relation,
                rationale=rationale,
            )
        )
        self.save()
        return edge_id

    def merge_nodes(self, keep_id: str, merge_id: str, reason: str) -> str:
        if keep_id == merge_id:
            raise ValueError("병합할 두 노드는 달라야 합니다")

        keep = self.node(keep_id)
        merge = self.node(merge_id)
        if keep is None:
            raise ValueError(f"존재하지 않는 keep_id: {keep_id}")
        if merge is None:
            raise ValueError(f"존재하지 않는 merge_id: {merge_id}")

        for alias in [merge.name, *merge.aliases]:
            if alias != keep.name and alias not in keep.aliases:
                keep.aliases.append(alias)
        for comment in merge.comments:
            if comment not in keep.comments:
                keep.comments.append(comment)
        if not keep.document and merge.document:
            keep.document = merge.document

        rewritten: list[Edge] = []
        seen_relations: set[tuple[str, str, str]] = set()
        for edge in self.graph.edges:
            from_id = keep_id if edge.from_id == merge_id else edge.from_id
            to_id = keep_id if edge.to_id == merge_id else edge.to_id
            if from_id == to_id:
                continue

            relation_key = (from_id, to_id, edge.relation)
            if relation_key in seen_relations:
                continue
            seen_relations.add(relation_key)
            rewritten.append(
                Edge(
                    id=edge.id,
                    from_id=from_id,
                    to_id=to_id,
                    relation=edge.relation,
                    rationale=edge.rationale,
                )
            )

        self.graph.edges = rewritten
        self.graph.nodes = [node for node in self.graph.nodes if node.id != merge_id]
        self.save()
        return keep_id

    def mark_progress(
        self, node_id: str, status: NodeStatus, comment: Comment | None = None
    ) -> bool:
        node = self.node(node_id)
        if node is None:
            raise ValueError(f"존재하지 않는 node_id: {node_id}")

        updated = node.model_dump()
        updated["status"] = status
        if comment is not None:
            updated["comments"] = [*node.comments, comment]
        validated = Node.model_validate(updated)
        self.graph.nodes = [
            validated if current.id == node_id else current
            for current in self.graph.nodes
        ]
        self.save()
        return True

    def lookup_reference(self, term: str) -> ReferenceEntry:
        """로컬 용어 사전을 정규화한 정확한 키로 조회한다."""
        normalized_term = normalize(term)
        if not normalized_term:
            return ReferenceEntry(found=False)

        reference_book = load_reference_book()
        entry = reference_book.entries.get(normalized_term)
        if entry is not None:
            return entry

        # 사전 파일을 사람이 편집했을 때도 동일한 정규화 규칙으로 조회한다.
        for key, candidate in reference_book.entries.items():
            if normalize(key) == normalized_term:
                return candidate
        return ReferenceEntry(found=False)

    def quote_conversation(
        self, keyword: str, window: int = 2
    ) -> list[ConversationQuote]:
        """기본 대화에서 키워드 일치 턴과 앞뒤 문맥을 중복 없이 돌려준다."""
        normalized_keyword = normalize(keyword)
        if not normalized_keyword or window < 0:
            return []

        conversation = load_conversation(DEFAULT_CONVERSATION)
        included_indexes: set[int] = set()
        for position, turn in enumerate(conversation.turns):
            if normalized_keyword not in normalize(turn.text):
                continue

            start = max(0, position - window)
            end = min(len(conversation.turns), position + window + 1)
            included_indexes.update(
                candidate.index for candidate in conversation.turns[start:end]
            )

        return [
            ConversationQuote(index=turn.index, text=turn.text)
            for turn in conversation.turns
            if turn.index in included_indexes
        ]


# ────────────────────────────────────────────────────────────────
#  대화 / 용어 사전 — quote_conversation, lookup_reference 의 재료
# ────────────────────────────────────────────────────────────────


def load_conversation(path: Path) -> Conversation:
    return Conversation.model_validate_json(path.read_text(encoding=READ_ENCODING))


def load_reference_book(path: Path = REFERENCE_BOOK) -> ReferenceBook:
    return ReferenceBook.model_validate(json.loads(path.read_text(encoding=READ_ENCODING)))
