/**
 * 프론트 목 데이터 — 계약 타입만 쓴다.
 *
 * 타입은 contract/schema.ts 에서 import 한다. 여기서 새로 선언하지 않는다.
 * 좌표는 여기 없다 — src/layout.ts 로 분리됐다.
 *
 * 실제 백엔드를 붙일 때 갈아끼울 지점:
 *   INITIAL_GRAPH  → GET /api/graph 응답
 *   PLACEMENTS     → create_node / link_nodes 툴 호출 결과
 *   REVIEW_FINDINGS→ merge_nodes / unlink 결과
 *   NOTE_UPDATES   → mark_progress(weakpoint=...) 결과
 *   TOOL_STEPS     → 실제 스트림 이벤트
 * 갈아끼워도 그대로인 것: contract/ 의 타입 전부.
 */

import type { Conversation, Edge, Graph, Node, Weakpoint } from '../contract/schema';
import seedGraph from '../contract/fixtures/seed_graph.json';
import kvCacheConversation from '../contract/fixtures/kv_cache_conversation.json';

export const INITIAL_GRAPH = seedGraph as Graph;
export const INITIAL_NODES: Node[] = INITIAL_GRAPH.nodes;
export const INITIAL_EDGES: Edge[] = INITIAL_GRAPH.edges;

/* ────────────────────────────── 붙여넣는 대화 ────────────────────────────── */

export const CONVERSATION = kvCacheConversation as Conversation;

/** textarea 에 붙여넣는 원문. 픽스처를 그대로 편 것이라 백엔드 입력과 동일하다. */
export const SAMPLE_CONVERSATION = CONVERSATION.turns
  .map((t) => `${t.speaker === 'user' ? '나' : 'ChatGPT'}: ${t.text}`)
  .join('\n\n');

export const CONVERSATION_META = {
  id: CONVERSATION.id,
  turns: CONVERSATION.turns.length,
  chars: SAMPLE_CONVERSATION.length,
};

/* ────────────────────────────── 실행 계획 ────────────────────────────── */

/** 3단계에서 노드 하나가 그래프에 붙는 단위. */
export interface Placement {
  node: Node;
  edges: Edge[];
  /** 왜 여기에 붙였는지 한 줄 */
  reason: string;
  /** 좌표를 계산할 때 기준이 되는 기존 노드들 */
  anchors: string[];
}

export const PLACEMENTS: Placement[] = [
  {
    node: {
      id: 'kv-cache',
      name: 'KV Cache',
      aliases: ['KV 캐시', 'kv-cache', 'key value cache'],
      summary:
        '자기회귀 생성에서 이전 토큰들의 Key/Value 텐서를 저장해두고 재사용해, 매 스텝의 재계산을 없애는 추론 전용 최적화.',
      status: 'learned',
      weakpoints: [],
      source_conversation_id: CONVERSATION.id,
    },
    edges: [
      {
        id: 'ne-kv-self',
        from_id: 'kv-cache',
        to_id: 'self-attention',
        relation: 'component',
        rationale: '추론 시 self-attention 계산의 일부로 캐시가 끼어든다.',
      },
      {
        id: 'ne-masked-kv',
        from_id: 'masked-attention',
        to_id: 'kv-cache',
        relation: 'prerequisite',
        rationale: '마스킹 덕분에 앞쪽 K/V가 불변이라는 것이 캐시의 전제다.',
      },
      {
        id: 'ne-kv-gqa',
        from_id: 'kv-cache',
        to_id: 'grouped-query-attention',
        relation: 'prerequisite',
        rationale: 'GQA는 KV 캐시 메모리 문제를 줄이려고 나온 기법이다.',
      },
    ],
    anchors: ['masked-attention', 'self-attention', 'grouped-query-attention'],
    reason:
      '근거: 대화가 "앞쪽 K/V는 변하지 않는다"를 Masked Attention으로 설명했고, 캐시 메모리 문제의 해법으로 GQA를 꺼냄.',
  },
  {
    node: {
      id: 'autoregressive-decoding',
      name: 'Autoregressive Decoding',
      aliases: ['자기회귀 생성', '자기회귀 디코딩', 'autoregressive generation'],
      summary: '이전까지 생성한 토큰을 다시 입력으로 넣어 다음 토큰을 하나씩 뽑는 순차 생성 방식.',
      status: 'learned',
      weakpoints: [],
      source_conversation_id: CONVERSATION.id,
    },
    edges: [
      {
        id: 'ne-masked-ar',
        from_id: 'masked-attention',
        to_id: 'autoregressive-decoding',
        relation: 'prerequisite',
        rationale: '인과 마스킹이 있어야 좌에서 우로 하나씩 생성하는 것이 성립한다.',
      },
      {
        id: 'ne-ar-kv',
        from_id: 'autoregressive-decoding',
        to_id: 'kv-cache',
        relation: 'prerequisite',
        rationale: '스텝이 순차적이어야 재사용할 이전 스텝이 존재한다.',
      },
      {
        id: 'ne-ar-greedy',
        from_id: 'autoregressive-decoding',
        to_id: 'greedy-decoding',
        relation: 'prerequisite',
        rationale: 'greedy decoding은 자기회귀 생성의 한 가지 토큰 선택 규칙이다.',
      },
    ],
    anchors: ['masked-attention', 'greedy-decoding', 'kv-cache'],
    reason:
      '근거: 캐시가 성립하는 전제로 대화 첫 턴부터 반복 등장. 기존 Greedy Decoding의 상위 개념 자리가 비어 있었음.',
  },
  {
    node: {
      id: 'incremental-decoding',
      name: 'Incremental Decoding',
      aliases: ['증분 디코딩'],
      summary: '스텝마다 새 토큰 하나 분량만 추가로 계산하는 생성 방식.',
      status: 'learned',
      weakpoints: [],
      source_conversation_id: CONVERSATION.id,
    },
    edges: [
      {
        id: 'ne-kv-incr',
        from_id: 'kv-cache',
        to_id: 'incremental-decoding',
        relation: 'component',
        rationale: '캐시가 있어야 스텝당 연산량이 상수로 줄어든다.',
      },
    ],
    anchors: ['kv-cache'],
    reason: '근거: "매 스텝 연산량이 상수로 줄어든다" 구간에서 별도 개념으로 추출됨.',
  },
  {
    node: {
      id: 'flash-attention',
      name: 'Flash Attention',
      aliases: ['플래시 어텐션', 'flashattention'],
      summary:
        '어텐션 행렬을 메모리에 쓰지 않고 타일 단위로 처리해 HBM 왕복을 줄이는 IO 최적화. 결과값은 기존 어텐션과 동일하다.',
      status: 'learned',
      weakpoints: [],
      source_conversation_id: CONVERSATION.id,
    },
    edges: [
      {
        id: 'ne-flash-self',
        from_id: 'flash-attention',
        to_id: 'self-attention',
        relation: 'variant',
        rationale: '같은 결과를 내는 self-attention의 다른 구현이다.',
      },
      {
        id: 'ne-flash-kv',
        from_id: 'flash-attention',
        to_id: 'kv-cache',
        relation: 'contrast',
        rationale: '둘 다 메모리를 다루지만 축이 다르다 — 연산 IO vs 스텝 간 상태 저장.',
      },
      {
        id: 'ne-flash-gqa',
        from_id: 'flash-attention',
        to_id: 'grouped-query-attention',
        relation: 'variant',
        rationale: '(근거 없음 — 6단계 검수에서 제거된다)',
      },
    ],
    anchors: ['kv-cache', 'self-attention', 'grouped-query-attention'],
    reason: '근거: 마지막 턴에서 KV Cache와 명시적으로 대비되며 등장. "축 자체가 다르다"는 문장을 대비 간선으로 옮김.',
  },
];

/* ────────────────────────────── 4·5단계: 약점 ────────────────────────────── */

export const WEAKPOINT_NODE_ID = 'kv-cache';

/**
 * 계약 A 의 Weakpoint 를 그대로 쓴다. 강의노트를 위한 별도 타입이 없는 이유가 이것 —
 * 노드에 붙는 이 구조체가 노트 본문 역할을 한다.
 */
export const DETECTED_WEAKPOINT: Weakpoint = {
  description:
    '"학습할 때도 캐시를 쓰면 더 이득 아닌가"에서 막혔다. 추론이 느린 이유(스텝이 순차적)와 학습이 느린 이유(역전파·파라미터 갱신)를 같은 문제로 묶어서 본 것이 원인. 캐시가 성립하려면 "이전 스텝"이 존재해야 한다는 전제를 놓쳤다.',
  misconception: '학습이 추론보다 오래 걸리니, 학습에 KV Cache를 적용하면 더 큰 이득을 볼 수 있다.',
  correction:
    '학습은 teacher forcing으로 정답 시퀀스 전체를 이미 알고 있어 모든 위치를 한 번의 forward로 병렬 계산한다. "이전 스텝"이 없으므로 재사용할 캐시도 없다. KV Cache는 추론 전용 최적화다.',
  evidence: [
    {
      index: 6,
      speaker: 'user',
      text: '그럼 학습할 때도 캐시를 쓰나요? 학습이 추론보다 훨씬 오래 걸리니까 거기에 적용하면 더 이득일 것 같은데요.',
    },
    {
      index: 7,
      speaker: 'assistant',
      text: '학습은 teacher forcing으로 정답 시퀀스 전체를 이미 알고 있기 때문에 모든 위치를 단 한 번의 forward로 병렬 계산합니다. 즉 이전 스텝이라는 것 자체가 존재하지 않아서 재사용할 캐시도 없습니다.',
    },
    {
      index: 9,
      speaker: 'assistant',
      text: '캐시 크기는 배치 × 레이어 × 헤드 × 시퀀스 길이 × head_dim에 비례해서 선형으로 커지고, 긴 컨텍스트에서는 모델 가중치보다 캐시가 더 큰 메모리를 먹기도 합니다.',
    },
  ],
  source_conversation_id: CONVERSATION.id,
};

/** 5단계에서 기존 노드의 요약이 갱신되는 것들. */
export interface NoteUpdate {
  node_id: string;
  summary: string;
}

export const NOTE_UPDATES: NoteUpdate[] = [
  {
    node_id: 'masked-attention',
    summary:
      '미래 위치의 점수를 -inf로 만들어 각 토큰이 자기 앞쪽만 보게 하는 어텐션. 이 마스킹이 단순한 구현 디테일이 아니라 앞쪽 K/V가 불변인 근거이며, KV Cache가 성립하는 전제다.',
  },
  {
    node_id: 'self-attention',
    summary:
      'Q, K, V를 모두 같은 시퀀스에서 만드는 어텐션. 추론에서는 Q와 K/V가 비대칭이다 — Q는 매 스텝 마지막 토큰 것만 필요해 버려지고, K/V만 이후 스텝에서 계속 참조된다. 이것이 "왜 KV Cache이고 Q Cache가 아닌가"의 답이다.',
  },
];

/* ────────────────────────────── 6단계: 자기 검수 ────────────────────────────── */

export type ReviewFix =
  | { type: 'mergeNode'; from: string; into: string }
  | { type: 'removeEdge'; edgeId: string };

export interface ReviewFinding {
  id: string;
  claim: string;
  reason: string;
  applied: string;
  fix: ReviewFix;
}

export const REVIEW_FINDINGS: ReviewFinding[] = [
  {
    id: 'rv-merge',
    claim: 'Incremental Decoding 과 Autoregressive Decoding 이 사실상 같은 개념이라 병합함.',
    reason:
      '근거: 두 노드의 근거 구간이 동일한 3개 턴에서 나왔고, 대화 안에서 둘을 구분하는 표현이 없음. 별도 노드로 둘 이유가 없음.',
    applied: 'Incremental Decoding 제거. 간선 1개는 Autoregressive Decoding 으로 흡수(중복이라 폐기).',
    fix: { type: 'mergeNode', from: 'incremental-decoding', into: 'autoregressive-decoding' },
  },
  {
    id: 'rv-edge',
    claim: 'Flash Attention —[변형]→ Grouped-Query Attention 은 대화에 근거가 없어 제거함.',
    reason:
      '근거: 두 기법이 함께 언급된 턴이 없음. 게다가 하나는 연산 IO, 하나는 KV 메모리라 축이 달라 변형 관계도 성립하지 않음. 모델의 사전지식이 새어 나온 간선.',
    applied: '간선 1개 제거. 남은 간선 8개는 모두 대화 원문 구간에 대응됨.',
    fix: { type: 'removeEdge', edgeId: 'ne-flash-gqa' },
  },
];

/* ────────────────────────────── 6단계 툴 호출 ────────────────────────────── */

export const STEP_NAMES = [
  'parse_conversation',
  'match_nodes',
  'place_nodes',
  'detect_weakpoints',
  'write_lecture_note',
  'review_graph',
] as const;

export interface ToolStep {
  tool: string;
  args: string;
  result: string;
  reason: string;
}

export const TOOL_STEPS: Record<(typeof STEP_NAMES)[number], ToolStep> = {
  parse_conversation: {
    tool: 'parse_conversation',
    args: `source="chatgpt", turns=${CONVERSATION_META.turns}, chars=${CONVERSATION_META.chars}`,
    result: '대화에서 다룬 개념 9개 추출',
    reason:
      '근거: 사용자가 정의를 되묻거나 어시스턴트가 새 용어를 도입한 지점만 개념으로 인정. 스쳐 지나간 언급(HBM, SRAM)은 제외.',
  },
  match_nodes: {
    tool: 'search_nodes',
    args: 'candidates=9, graph_nodes=22, threshold=0.82',
    result: '기존 노드 5개 일치, 신규 후보 4개 발견',
    reason:
      '근거: 별칭 사전으로 대조("자기회귀" → Autoregressive). 점수는 참고만 하고 동일 개념 여부는 직접 판단.',
  },
  place_nodes: {
    tool: 'create_node + link_nodes',
    args: 'new=4, relations=[prerequisite|component|variant|contrast]',
    result: '신규 노드 4개 배치, 간선 10개 생성',
    reason: '근거: 각 신규 개념이 대화에서 "무엇을 설명하기 위해" 등장했는지로 앵커 노드를 결정.',
  },
  detect_weakpoints: {
    tool: 'quote_conversation',
    args: 'signals=["재질문", "전제 오류", "어시스턴트의 명시적 정정"]',
    result: '약점 1건 · 정정 1건 탐지 → KV Cache',
    reason:
      '근거: 사용자가 캐시의 적용 범위를 두 번 물었고, 두 번째 질문에서 어시스턴트가 "아니요"로 전제를 부정하며 정정함.',
  },
  write_lecture_note: {
    tool: 'mark_progress',
    args: 'node_id="kv-cache", status="weak", weakpoint={...}',
    result: '약점 1건 기록 · 기존 노드 요약 2건 갱신',
    reason: '근거: 정정 전/후를 분리해 기록하고, 모든 항목에 대화 원문 구간을 근거로 붙임.',
  },
  review_graph: {
    tool: 'merge_nodes + unlink',
    args: 'scope="this_run", checks=["중복 개념", "근거 없는 간선"]',
    result: '최종 노드 3개 추가, 간선 8개. 검수 지적 2건 반영 완료.',
    reason: '근거: 재검수에서 남은 노드/간선 전부가 대화 원문 구간에 1:1로 대응됨을 확인.',
  },
};
