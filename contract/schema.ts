/**
 * 팀 데이터 계약 (TypeScript 사본).
 *
 * 원본은 contract/schema.py 다. 한쪽을 고치면 반드시 다른 쪽도 같이 고친다.
 * 프론트(src/)는 자체 타입을 정의하지 말고 이 파일을 import 해서 쓴다.
 *
 * 설계 원칙 두 개:
 *   1. 좌표는 계약에 없다. 레이아웃은 전적으로 프론트 책임이고 백엔드는
 *      그래프 구조만 다룬다. 좌표는 src/layout.ts 에 프론트 로컬 상태로 있다.
 *   2. 툴은 사실을 조회하거나 상태를 변경만 한다. 판단은 전부 LLM 이 한다.
 */

export const SCHEMA_VERSION = 1;

/* ════════════════════════════════════════════════════════════════════
 *  계약 A — 그래프 상태
 * ════════════════════════════════════════════════════════════════════ */

export type NodeStatus =
  | 'unlearned' // 아직 안 밟은 노드. 다음에 공부할 후보
  | 'learned' // 학습 완료
  | 'weak'; // 공부했지만 대화에서 헤맨 흔적이 있음

export type Relation =
  | 'prerequisite' // 선행 개념
  | 'component' // 구성 요소
  | 'variant' // 변형
  | 'contrast' // 대비
  | 'application'; // 응용

/**
 * 간선 방향 규칙 — `from_id` 노드가 `to_id` 노드의 `relation` 이다.
 * 예) Softmax --component--> Attention = "Softmax 는 Attention 의 구성 요소"
 * 이 규칙을 어기면 그래프 전체의 화살표 방향이 뒤집힌다.
 */
export const EDGE_DIRECTION_RULE = 'from_id is the {relation} of to_id';

/** 근거: 이 판단이 나온 대화 구간. */
export interface Evidence {
  /** 대화 턴 인덱스 (0-based) */
  index: number;
  speaker: 'user' | 'assistant';
  text: string;
}

/**
 * 대화에서 막혔던 지점 하나.
 * 강의노트를 위한 별도 툴을 두지 않고 노드에 붙는 이 구조체가 노트 본문 역할을 한다.
 */
export interface Weakpoint {
  /** 무엇에서 어떻게 막혔는지 한두 문장 */
  description: string;
  /** 정정 전 — 사용자가 잘못 알고 있던 내용 */
  misconception: string | null;
  /** 정정 후 — 무엇이 맞는 설명인지 */
  correction: string | null;
  evidence: Evidence[];
  source_conversation_id: string | null;
}

/** 지식그래프의 개념 노드. 좌표는 여기 없다. */
export interface Node {
  /** 슬러그 형태의 안정적 식별자. 예) self-attention */
  id: string;
  /** 표시 이름. 예) Self-Attention */
  name: string;
  /** 같은 개념을 가리키는 다른 표기. search_nodes 가 이걸 본다 */
  aliases: string[];
  /** 개념 요약 1~3문장 */
  summary: string;
  status: NodeStatus;
  weakpoints: Weakpoint[];
  /** 이 노드를 만들어낸 대화. 시드 노드는 null */
  source_conversation_id: string | null;
}

/** 개념 사이의 관계. 방향 규칙은 EDGE_DIRECTION_RULE 참고. */
export interface Edge {
  id: string;
  from_id: string;
  to_id: string;
  relation: Relation;
  /** 왜 이 관계를 붙였는지 한 줄. 대화 근거가 없으면 붙이지 않는다 */
  rationale: string;
}

/** 디스크에 저장되는 그래프 전체. JSON 파일 하나가 이 모양이다. */
export interface Graph {
  version: number;
  nodes: Node[];
  edges: Edge[];
}

/* ════════════════════════════════════════════════════════════════════
 *  계약 B — 툴 시그니처 (프론트는 결과 타입만 알면 된다)
 * ════════════════════════════════════════════════════════════════════
 *
 * 조회
 *   search_nodes(query, limit=5)         -> SearchHit[]
 *   get_neighbors(node_id, depth=1)      -> Edge[]
 *   lookup_reference(term)               -> ReferenceEntry
 *   quote_conversation(keyword, window=2)-> ConversationQuote[]
 *
 * 변경
 *   create_node(name, summary, aliases)              -> node_id
 *   link_nodes(from_id, to_id, relation, rationale)  -> edge_id
 *   merge_nodes(keep_id, merge_id, reason)           -> node_id
 *   mark_progress(node_id, status, weakpoint?)       -> ok
 */

export interface SearchHit {
  node_id: string;
  name: string;
  /** 0~1 유사도. 1.0 = 이름/별칭 완전 일치. 동일 개념 판정이 아니다 */
  score: number;
}

export interface ReferenceEntry {
  found: boolean;
  canonical_name: string | null;
  summary: string | null;
  /** 사전 항목의 출처 표기. 예) local-reference-v1 */
  source: string | null;
}

export interface ConversationQuote {
  /** 대화 턴 인덱스 (0-based) */
  index: number;
  text: string;
}

/* ════════════════════════════════════════════════════════════════════
 *  계약 C — 스트림 이벤트
 * ════════════════════════════════════════════════════════════════════ */

export type StreamKind =
  | 'tool_call' // 툴 호출 시작
  | 'tool_result' // 툴 반환
  | 'decision' // 모델이 남긴 판단 근거 (상태 변경 직전)
  | 'note' // 실행 메타 (시작/종료 등)
  | 'error' // 실패
  | 'limit'; // 스텝 상한 도달

/**
 * 백엔드 → 프론트로 흐르는 단위 이벤트.
 *
 * 한 스트림에 두 층이 실린다:
 *   - raw       : 하부 API 원본 이벤트를 가공 없이 담는 자리 (대회 규칙 필수 요소)
 *   - 나머지 필드 : rationale 중심 요약 뷰용
 *
 * 프론트는 이 하나의 스트림을 받아 raw 뷰 / 요약 뷰를 토글로 전환한다.
 */
export interface StreamEvent {
  /** 0부터 단조 증가. 실행 하나 안에서 유일 */
  seq: number;
  /** ISO 8601 UTC */
  ts: string;
  kind: StreamKind;

  /** tool_call / tool_result 일 때 툴 이름 */
  tool: string | null;
  /** tool_call 의 인자 */
  args: Record<string, unknown> | null;
  /** 사람이 읽는 한 줄 요약. 원본이 아니라 요약이다 */
  result_summary: string | null;
  /**
   * 모델이 왜 그렇게 판단했는지 한 줄. kind='decision' 이면 필수.
   * tool_call 에는 직전 decision 의 내용이 실려 온다.
   */
  rationale: string | null;
  /** 하부 API 원본 이벤트. 가공하지 않는다. 없으면 null */
  raw: unknown | null;
}

/**
 * kind='limit' 이벤트가 실어 보내는 정보.
 * 상한에 걸리면 조용히 멈추지 않는다.
 * unprocessed = 상한에 걸린 턴에서 실행하지 않고 버린 툴 호출 개수.
 */
export interface LimitPayload {
  steps_used: number;
  max_steps: number;
  unprocessed: number;
  unprocessed_tools: string[];
}

/* ════════════════════════════════════════════════════════════════════
 *  입력 대화
 * ════════════════════════════════════════════════════════════════════ */

export interface Turn {
  index: number;
  speaker: 'user' | 'assistant';
  text: string;
}

export interface Conversation {
  id: string;
  title: string;
  turns: Turn[];
}

/* ════════════════════════════════════════════════════════════════════
 *  표시용 상수 (프론트 전용 — 백엔드는 이걸 모른다)
 * ════════════════════════════════════════════════════════════════════ */

/** 관계 enum 의 한글 표시 라벨. 간선 위에 그려진다. */
export const RELATION_LABEL: Record<Relation, string> = {
  prerequisite: '선행 개념',
  component: '구성 요소',
  variant: '변형',
  contrast: '대비',
  application: '응용',
};

/** 노드 상태의 한글 표시 라벨. 범례에 쓰인다. */
export const STATUS_LABEL: Record<NodeStatus, string> = {
  learned: '학습 완료',
  unlearned: '미학습 · 다음에 공부할 것',
  weak: '약점 있음',
};
