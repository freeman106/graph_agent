/**
 * 모든 목 데이터가 이 파일에 모여 있다.
 * 나중에 실제 에이전트 응답으로 통째로 갈아끼울 수 있도록 타입을 먼저 고정한다.
 *
 * 갈아끼울 때 바뀌는 것:
 *   INITIAL_NODES / INITIAL_EDGES  → 서버가 들고 있는 기존 지식그래프
 *   RUN_PLAN                       → 에이전트 1회 실행의 결과 (6단계 + 그래프 변경 + 노트)
 * 갈아끼워도 그대로인 것: 아래 타입들.
 */

import sampleConversationRaw from '../sample-conversation.md?raw';

/* ────────────────────────────── 그래프 타입 ────────────────────────────── */

export type NodeStatus =
  | 'learned' // 문제나 설명으로 검증 완료
  | 'introduced' // 대화에서 발견했지만 아직 검증 전
  | 'unlearned' // 미학습 — 아직 안 밟은 노드
  | 'weak'; // 약점 있음 — 공부했지만 대화에서 헤맨 흔적

/** 관계 라벨. 간선은 "source 는 target 의 {relation} 이다" 로 읽는다. */
export type RelationLabel = '선행 개념' | '구성 요소' | '변형' | '대비';

export interface GraphNode {
  id: string;
  label: string;
  /** 레이아웃은 하드코딩. 물리 시뮬레이션을 쓰지 않으므로 실행마다 흔들리지 않는다. */
  x: number;
  y: number;
  status: NodeStatus;
  /** 노드 패널 상단에 뜨는 개념 요약 */
  summary: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: RelationLabel;
}

/** 렌더링 중에만 붙는 플래그. 데이터가 아니라 연출용. */
export interface RuntimeFlags {
  /** 이번 실행에서 새로 추가된 노드/간선 */
  isNew?: boolean;
  /** 방금 등장해서 강조 중 */
  justAdded?: boolean;
  /** 검수 단계에서 제거되는 중 (페이드아웃) */
  removing?: boolean;
  /** 검수 결과가 반영되며 잠깐 번쩍이는 중 */
  flash?: boolean;
}

export type RuntimeNode = GraphNode & RuntimeFlags;
export type RuntimeEdge = GraphEdge & RuntimeFlags;

/* ────────────────────────────── 강의노트 타입 ────────────────────────────── */

export interface Correction {
  before: string;
  after: string;
}

export interface Evidence {
  speaker: '나' | 'ChatGPT';
  quote: string;
}

export interface LectureNote {
  nodeId: string;
  /** 개념 요약 (노트용. GraphNode.summary 보다 길다) */
  body: string;
  /** 이 대화에서 막혔던 지점 — 이 제품의 차별점 */
  stuckPoint?: string;
  /** 오해했다 정정된 부분 */
  correction?: Correction;
  /** 연결된 개념 (노드 id) — [[위키링크]] 로 표시 */
  linkedConcepts: string[];
  /** 근거: 이 내용이 나온 대화 구간 */
  evidence: Evidence[];
}

/* ────────────────────────────── 실행 스트림 타입 ────────────────────────────── */

export type StreamLineKind =
  | 'system' // 런타임 메시지
  | 'call' // [호출 중]
  | 'result' // [결과]
  | 'reason' // 판단 근거 한 줄
  | 'detail' // 부연
  | 'place' // 그래프에 노드가 붙는 순간
  | 'edge' // 그래프에 간선이 붙는 순간
  | 'warn' // 검수에서 자기 결과의 문제를 잡아낸 지적
  | 'fix' // 그 지적이 그래프에 반영됨
  | 'done';

export interface StreamLine {
  id: number;
  kind: StreamLineKind;
  text: string;
}

export interface ToolStep {
  tool: string;
  /** [호출 중] 줄에 찍히는 인자 */
  args: string;
  /** [결과] 한 줄 */
  result: string;
  /** 결과에 붙는 판단 근거 한 줄 */
  reason: string;
}

export const STEP_NAMES = [
  'parse_conversation',
  'match_nodes',
  'place_nodes',
  'detect_weakpoints',
  'write_lecture_note',
  'review_graph',
] as const;

/* ────────────────────────────── 초기 지식그래프 ────────────────────────────── */

export const GRAPH_VIEWBOX = { width: 1060, height: 760 };

export const INITIAL_NODES: GraphNode[] = [
  // ── 입력 처리
  {
    id: 'tokenization',
    label: 'Tokenization',
    x: 90,
    y: 80,
    status: 'learned',
    summary: '원문 텍스트를 모델이 다룰 수 있는 이산 단위(토큰)로 자르는 전처리 단계.',
  },
  {
    id: 'bpe',
    label: 'BPE',
    x: 85,
    y: 180,
    status: 'learned',
    summary:
      '자주 붙어 나오는 바이트 쌍을 반복 병합해 어휘를 만드는 토크나이저. 미등록 단어를 조각으로 표현할 수 있다.',
  },
  {
    id: 'embedding',
    label: 'Embedding',
    x: 110,
    y: 285,
    status: 'learned',
    summary: '토큰 id를 연속 벡터 공간으로 옮기는 학습 가능한 조회 테이블.',
  },
  {
    id: 'positional-encoding',
    label: 'Positional Encoding',
    x: 90,
    y: 390,
    status: 'weak',
    summary:
      '어텐션 자체는 순서를 모르므로 위치 정보를 따로 주입한다. 사인/코사인 방식과 학습형 방식이 있다.',
  },
  {
    id: 'rotary-positional-embedding',
    label: 'Rotary Positional Embedding',
    x: 80,
    y: 500,
    status: 'unlearned',
    summary: '위치 정보를 더하는 대신 Q/K 벡터를 위치에 따라 회전시켜 상대 위치를 반영하는 방식.',
  },

  // ── 어텐션 코어
  {
    id: 'softmax',
    label: 'Softmax',
    x: 275,
    y: 70,
    status: 'learned',
    summary: '실수 점수 벡터를 합이 1인 확률 분포로 바꾸는 함수. 어텐션 가중치와 출력 분포 모두에 쓰인다.',
  },
  {
    id: 'query-key-value',
    label: 'Query/Key/Value',
    x: 255,
    y: 175,
    status: 'learned',
    summary:
      '입력을 세 가지 역할의 벡터로 투영한 것. Query는 "무엇을 찾는가", Key는 "나는 무엇인가", Value는 "실제로 전달할 내용".',
  },
  {
    id: 'attention',
    label: 'Attention',
    x: 250,
    y: 290,
    status: 'learned',
    summary: '질의에 대한 관련도로 값들을 가중 평균하는 연산. 거리에 상관없이 토큰을 직접 연결한다.',
  },
  {
    id: 'scaled-dot-product-attention',
    label: 'Scaled Dot-Product Attention',
    x: 420,
    y: 120,
    status: 'learned',
    summary: 'softmax(QKᵀ/√d)V. √d로 나누는 이유는 차원이 커질수록 내적 분산이 커져 softmax가 포화되기 때문.',
  },
  {
    id: 'self-attention',
    label: 'Self-Attention',
    x: 410,
    y: 260,
    status: 'learned',
    summary: 'Q, K, V를 모두 같은 시퀀스에서 만드는 어텐션. 시퀀스 내부의 토큰끼리 서로를 참조한다.',
  },
  {
    id: 'multi-head-attention',
    label: 'Multi-Head Attention',
    x: 575,
    y: 170,
    status: 'learned',
    summary: '어텐션을 여러 개의 부분 공간에서 병렬로 수행하고 concat. 헤드마다 다른 관계 패턴을 잡는다.',
  },
  {
    id: 'masked-attention',
    label: 'Masked Attention',
    x: 420,
    y: 390,
    status: 'learned',
    summary: '미래 위치의 점수를 -∞로 만들어 각 토큰이 자기 앞쪽만 보게 하는 어텐션. 디코더의 인과성을 보장한다.',
  },
  {
    id: 'cross-attention',
    label: 'Cross-Attention',
    x: 595,
    y: 315,
    status: 'unlearned',
    summary: 'Query는 디코더에서, Key/Value는 인코더에서 가져오는 어텐션. 두 시퀀스를 잇는 다리 역할.',
  },

  // ── 블록 구성
  {
    id: 'feed-forward-network',
    label: 'Feed-Forward Network',
    x: 750,
    y: 85,
    status: 'learned',
    summary: '토큰마다 독립적으로 적용되는 2층 MLP. 어텐션이 섞은 정보를 위치별로 변환한다.',
  },
  {
    id: 'layer-normalization',
    label: 'Layer Normalization',
    x: 900,
    y: 160,
    status: 'learned',
    summary: '배치가 아니라 피처 축으로 정규화. 시퀀스 길이가 들쭉날쭉해도 안정적이다.',
  },
  {
    id: 'transformer-block',
    label: 'Transformer Block',
    x: 765,
    y: 245,
    status: 'learned',
    summary: '어텐션 + FFN을 residual과 normalization으로 감싼 반복 단위.',
  },
  {
    id: 'residual-connection',
    label: 'Residual Connection',
    x: 930,
    y: 300,
    status: 'learned',
    summary: '입력을 출력에 그대로 더해 기울기가 깊은 층까지 흐르게 하는 우회로.',
  },
  {
    id: 'encoder-decoder',
    label: 'Encoder-Decoder',
    x: 860,
    y: 390,
    status: 'learned',
    summary: '입력을 표현으로 압축하는 인코더와, 그 표현을 보며 출력을 생성하는 디코더로 나뉜 구조.',
  },
  {
    id: 'grouped-query-attention',
    label: 'Grouped-Query Attention',
    x: 730,
    y: 430,
    status: 'unlearned',
    summary: '여러 Query 헤드가 Key/Value 헤드를 공유해 KV 메모리를 줄이는 어텐션 변형.',
  },

  // ── 디코딩
  {
    id: 'greedy-decoding',
    label: 'Greedy Decoding',
    x: 185,
    y: 570,
    status: 'learned',
    summary: '매 스텝 확률이 가장 높은 토큰 하나만 고르는 디코딩. 빠르지만 지역 최적에 빠진다.',
  },
  {
    id: 'beam-search',
    label: 'Beam Search',
    x: 140,
    y: 690,
    status: 'unlearned',
    summary: '상위 k개 후보 시퀀스를 동시에 유지하며 확장하는 디코딩.',
  },
  {
    id: 'temperature-sampling',
    label: 'Temperature Sampling',
    x: 330,
    y: 675,
    status: 'unlearned',
    summary: 'softmax 이전 로짓을 T로 나눠 분포의 뾰족함을 조절한 뒤 표본을 뽑는 디코딩.',
  },
];

export const INITIAL_EDGES: GraphEdge[] = [
  { id: 'e1', source: 'tokenization', target: 'bpe', relation: '선행 개념' },
  { id: 'e2', source: 'bpe', target: 'embedding', relation: '선행 개념' },
  { id: 'e3', source: 'embedding', target: 'positional-encoding', relation: '선행 개념' },
  {
    id: 'e4',
    source: 'rotary-positional-embedding',
    target: 'positional-encoding',
    relation: '변형',
  },
  { id: 'e5', source: 'embedding', target: 'query-key-value', relation: '선행 개념' },
  { id: 'e6', source: 'softmax', target: 'scaled-dot-product-attention', relation: '구성 요소' },
  { id: 'e7', source: 'query-key-value', target: 'attention', relation: '구성 요소' },
  { id: 'e8', source: 'scaled-dot-product-attention', target: 'attention', relation: '변형' },
  { id: 'e9', source: 'attention', target: 'self-attention', relation: '선행 개념' },
  {
    id: 'e10',
    source: 'scaled-dot-product-attention',
    target: 'self-attention',
    relation: '구성 요소',
  },
  { id: 'e11', source: 'multi-head-attention', target: 'self-attention', relation: '변형' },
  { id: 'e12', source: 'masked-attention', target: 'self-attention', relation: '변형' },
  { id: 'e13', source: 'cross-attention', target: 'self-attention', relation: '대비' },
  { id: 'e14', source: 'positional-encoding', target: 'attention', relation: '선행 개념' },
  { id: 'e15', source: 'multi-head-attention', target: 'transformer-block', relation: '구성 요소' },
  { id: 'e16', source: 'feed-forward-network', target: 'transformer-block', relation: '구성 요소' },
  { id: 'e17', source: 'layer-normalization', target: 'transformer-block', relation: '구성 요소' },
  { id: 'e18', source: 'residual-connection', target: 'transformer-block', relation: '구성 요소' },
  { id: 'e19', source: 'transformer-block', target: 'encoder-decoder', relation: '구성 요소' },
  { id: 'e20', source: 'cross-attention', target: 'encoder-decoder', relation: '구성 요소' },
  {
    id: 'e21',
    source: 'grouped-query-attention',
    target: 'multi-head-attention',
    relation: '변형',
  },
  { id: 'e22', source: 'masked-attention', target: 'greedy-decoding', relation: '선행 개념' },
  { id: 'e23', source: 'greedy-decoding', target: 'beam-search', relation: '선행 개념' },
  { id: 'e24', source: 'temperature-sampling', target: 'greedy-decoding', relation: '대비' },
  { id: 'e25', source: 'feed-forward-network', target: 'multi-head-attention', relation: '대비' },
];

/* ────────────────────────────── 붙여넣는 대화 ────────────────────────────── */

/**
 * 프로젝트 루트의 sample-conversation.md 를 그대로 읽어온다.
 * 손으로 복사해 붙여넣는 내용과 데모 버튼이 쓰는 내용을 하나로 유지하기 위함.
 */
export const SAMPLE_CONVERSATION = sampleConversationRaw.trim();

export const CONVERSATION_META = {
  source: 'chatgpt',
  turns: 14,
  chars: SAMPLE_CONVERSATION.length,
};

/* ────────────────────────────── 실행 계획 (에이전트 1회 실행) ────────────────────────────── */

/** 3단계에서 노드 하나가 그래프에 붙는 단위 */
export interface Placement {
  node: GraphNode;
  edges: GraphEdge[];
  /** 왜 여기에 붙였는지 한 줄 */
  reason: string;
}

export const PLACEMENTS: Placement[] = [
  {
    node: {
      id: 'kv-cache',
      label: 'KV Cache',
      x: 545,
      y: 480,
      status: 'introduced',
      summary:
        '자기회귀 생성에서 이전 토큰들의 Key/Value 텐서를 저장해두고 재사용해, 매 스텝의 재계산을 없애는 추론 전용 최적화.',
    },
    edges: [
      { id: 'ne-kv-self', source: 'kv-cache', target: 'self-attention', relation: '구성 요소' },
      { id: 'ne-masked-kv', source: 'masked-attention', target: 'kv-cache', relation: '선행 개념' },
      {
        id: 'ne-kv-gqa',
        source: 'kv-cache',
        target: 'grouped-query-attention',
        relation: '선행 개념',
      },
    ],
    reason:
      '근거: 대화가 "앞쪽 K/V는 변하지 않는다"를 Masked Attention으로 설명했고, 캐시 메모리 문제의 해법으로 GQA를 꺼냄.',
  },
  {
    node: {
      id: 'autoregressive-decoding',
      label: 'Autoregressive Decoding',
      x: 350,
      y: 505,
      status: 'introduced',
      summary: '이전까지 생성한 토큰을 다시 입력으로 넣어 다음 토큰을 하나씩 뽑는 순차 생성 방식.',
    },
    edges: [
      {
        id: 'ne-masked-ar',
        source: 'masked-attention',
        target: 'autoregressive-decoding',
        relation: '선행 개념',
      },
      {
        id: 'ne-ar-kv',
        source: 'autoregressive-decoding',
        target: 'kv-cache',
        relation: '선행 개념',
      },
      {
        id: 'ne-ar-greedy',
        source: 'autoregressive-decoding',
        target: 'greedy-decoding',
        relation: '선행 개념',
      },
    ],
    reason: '근거: 캐시가 성립하는 전제로 대화 첫 턴부터 반복 등장. 기존 Greedy Decoding의 상위 개념 자리가 비어 있었음.',
  },
  {
    node: {
      id: 'incremental-decoding',
      label: 'Incremental Decoding',
      x: 475,
      y: 630,
      status: 'introduced',
      summary: '스텝마다 새 토큰 하나 분량만 추가로 계산하는 생성 방식.',
    },
    edges: [
      {
        id: 'ne-kv-incr',
        source: 'kv-cache',
        target: 'incremental-decoding',
        relation: '구성 요소',
      },
    ],
    reason: '근거: "매 스텝 연산량이 상수로 줄어든다" 구간에서 별도 개념으로 추출됨.',
  },
  {
    node: {
      id: 'flash-attention',
      label: 'Flash Attention',
      x: 700,
      y: 600,
      status: 'introduced',
      summary:
        '어텐션 행렬을 메모리에 쓰지 않고 타일 단위로 처리해 HBM 왕복을 줄이는 IO 최적화. 결과값은 기존 어텐션과 동일하다.',
    },
    edges: [
      {
        id: 'ne-flash-self',
        source: 'flash-attention',
        target: 'self-attention',
        relation: '변형',
      },
      { id: 'ne-flash-kv', source: 'flash-attention', target: 'kv-cache', relation: '대비' },
      {
        id: 'ne-flash-gqa',
        source: 'flash-attention',
        target: 'grouped-query-attention',
        relation: '변형',
      },
    ],
    reason: '근거: 마지막 턴에서 KV Cache와 명시적으로 대비되며 등장. "축 자체가 다르다"는 문장을 대비 간선으로 옮김.',
  },
];

/** 6단계 검수에서 에이전트가 스스로 잡아내는 자기 결과의 문제 */
export type ReviewFix =
  | { type: 'mergeNode'; from: string; into: string }
  | { type: 'removeEdge'; edgeId: string };

export interface ReviewFinding {
  id: string;
  /** 지적 한 줄 */
  claim: string;
  /** 판단 근거 한 줄 */
  reason: string;
  /** 그래프에 반영된 결과 한 줄 */
  applied: string;
  fix: ReviewFix;
}

export const REVIEW_FINDINGS: ReviewFinding[] = [
  {
    id: 'rv-merge',
    claim:
      'Incremental Decoding 과 Autoregressive Decoding 이 사실상 같은 개념이라 병합함.',
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

/** 4단계에서 약점 표시가 붙는 노드 */
export const WEAKPOINT_NODE_ID = 'kv-cache';

/* ────────────────────────────── 강의노트 ────────────────────────────── */

export const LECTURE_NOTES: LectureNote[] = [
  {
    nodeId: 'kv-cache',
    body: '자기회귀 생성에서 각 스텝은 이전 토큰 전체를 다시 통과시킨다. 그런데 Masked Attention 때문에 앞쪽 토큰의 Key/Value는 뒤에 무엇이 붙어도 변하지 않는다. 그래서 한 번 계산한 K/V를 레이어별로 들고 있다가 다음 스텝에서 그대로 재사용한다. Query는 캐시하지 않는데, 매 스텝 Query가 필요한 토큰은 방금 생성된 마지막 토큰 하나뿐이기 때문이다. 대가는 메모리다. 캐시 크기는 배치 × 레이어 × 헤드 × 시퀀스 길이 × head_dim 으로 선형 증가한다.',
    stuckPoint:
      '"학습할 때도 캐시를 쓰면 더 이득 아닌가"에서 막혔다. 추론이 느린 이유(스텝이 순차적)와 학습이 느린 이유(파라미터 갱신·역전파)를 같은 문제로 묶어서 본 것이 원인. 캐시가 성립하려면 "이전 스텝"이 존재해야 한다는 전제를 놓쳤다.',
    correction: {
      before: '학습이 추론보다 오래 걸리니, 학습에 KV Cache를 적용하면 더 큰 이득을 볼 수 있다.',
      after:
        '학습은 teacher forcing으로 정답 시퀀스 전체를 이미 알고 있어 모든 위치를 한 번의 forward로 병렬 계산한다. "이전 스텝"이 없으므로 재사용할 캐시도 없다. KV Cache는 추론 전용 최적화다.',
    },
    linkedConcepts: [
      'self-attention',
      'masked-attention',
      'autoregressive-decoding',
      'grouped-query-attention',
      'flash-attention',
    ],
    evidence: [
      {
        speaker: '나',
        quote: '그럼 학습할 때도 캐시를 쓰나요? 학습이 추론보다 훨씬 오래 걸리니까 거기에 적용하면 더 이득일 것 같은데요.',
      },
      {
        speaker: 'ChatGPT',
        quote:
          '학습은 teacher forcing으로 정답 시퀀스 전체를 이미 알고 있기 때문에 모든 위치를 단 한 번의 forward로 병렬 계산합니다. 즉 "이전 스텝"이라는 것 자체가 존재하지 않아서 재사용할 캐시도 없습니다.',
      },
      {
        speaker: 'ChatGPT',
        quote:
          '캐시 크기는 배치 × 레이어 × 헤드 × 시퀀스 길이 × head_dim에 비례해서 선형으로 커지고, 긴 컨텍스트에서는 모델 가중치보다 캐시가 더 큰 메모리를 먹기도 합니다.',
      },
    ],
  },
  {
    nodeId: 'autoregressive-decoding',
    body: '이전까지 생성한 토큰을 다시 입력에 넣어 다음 토큰 하나를 뽑는 것을 반복한다. 스텝이 순차적으로 묶여 있다는 점이 이 방식의 모든 성질을 결정한다 — 병렬화가 안 되는 이유도, KV Cache가 성립하는 이유도 여기서 나온다. 학습 시점의 teacher forcing과 짝을 이루는 개념으로, 학습에서는 같은 목표를 병렬로 달성한다.',
    linkedConcepts: ['masked-attention', 'kv-cache', 'greedy-decoding'],
    evidence: [
      {
        speaker: 'ChatGPT',
        quote:
          '자기회귀(autoregressive) 생성에서는 토큰을 하나 뽑을 때마다 지금까지의 시퀀스 전체를 다시 모델에 통과시킵니다.',
      },
    ],
  },
  {
    nodeId: 'flash-attention',
    body: '어텐션 행렬 전체를 HBM에 쓰지 않고 타일 단위로 나눠 SRAM 안에서 처리한다. 메모리 왕복을 줄이는 IO 최적화이므로 결과값은 기존 어텐션과 정확히 같다. KV Cache와 자주 헷갈리지만 축이 다르다 — 하나는 연산 시점의 IO, 하나는 스텝 사이의 상태 저장이라 함께 쓸 수 있다.',
    linkedConcepts: ['self-attention', 'kv-cache'],
    evidence: [
      {
        speaker: 'ChatGPT',
        quote:
          'Flash Attention은 어텐션 행렬 전체를 메모리에 쓰지 않고 타일 단위로 처리해서 HBM 왕복을 줄이는, 연산 시점의 IO 최적화입니다. (…) 반면 KV Cache는 스텝 사이에 상태를 남겨두는 저장 전략이라 축 자체가 다릅니다.',
      },
    ],
  },
  {
    nodeId: 'masked-attention',
    body: '이번 대화에서 다시 다뤄진 기존 개념. 미래 위치를 -∞로 마스킹한다는 사실이 단순한 구현 디테일이 아니라 KV Cache가 성립하는 근거라는 점이 새로 연결됐다. 마스킹이 있어야 앞쪽 토큰의 K/V가 뒤에 무엇이 오든 불변이다.',
    linkedConcepts: ['self-attention', 'kv-cache', 'autoregressive-decoding'],
    evidence: [
      {
        speaker: 'ChatGPT',
        quote:
          'Masked Attention 때문에 각 토큰은 자기 앞쪽만 볼 수 있으므로, 뒤에 토큰이 추가돼도 앞쪽 토큰의 Key/Value는 절대 변하지 않습니다.',
      },
    ],
  },
  {
    nodeId: 'self-attention',
    body: '이번 대화에서 다시 다뤄진 기존 개념. Q/K/V의 비대칭이 부각됐다 — Query는 매 스텝 마지막 토큰 것만 필요해 버려지고, Key/Value만 이후 스텝에서 계속 참조된다. 이 비대칭이 "왜 KV Cache이고 Q Cache가 아닌가"의 답이다.',
    linkedConcepts: ['query-key-value', 'kv-cache', 'flash-attention', 'masked-attention'],
    evidence: [
      {
        speaker: 'ChatGPT',
        quote:
          '과거 토큰들의 Query는 이미 그 시점에 쓰이고 역할이 끝났어요. 반대로 Key/Value는 새 Query가 계속 참조해야 하니 남겨둬야 합니다.',
      },
    ],
  },
];

/* ────────────────────────────── 6단계 툴 호출 ────────────────────────────── */

export const TOOL_STEPS: Record<(typeof STEP_NAMES)[number], ToolStep> = {
  parse_conversation: {
    tool: 'parse_conversation',
    args: `source="chatgpt", turns=${CONVERSATION_META.turns}, chars=${CONVERSATION_META.chars}`,
    result: '대화에서 다룬 개념 9개 추출',
    reason:
      '근거: 사용자가 정의를 되묻거나 어시스턴트가 새 용어를 도입한 지점만 개념으로 인정. 스쳐 지나간 언급(HBM, SRAM)은 제외.',
  },
  match_nodes: {
    tool: 'match_nodes',
    args: 'candidates=9, graph_nodes=22, threshold=0.82',
    result: '기존 노드 5개 일치, 신규 후보 4개 발견',
    reason:
      '근거: 표기 흔들림은 정규화 후 대조("자기회귀" → Autoregressive). 유사도 0.82 미만은 기존 노드로 접지 않고 신규로 분류.',
  },
  place_nodes: {
    tool: 'place_nodes',
    args: 'new=4, anchor="matched_nodes", relations=[선행 개념|구성 요소|변형|대비]',
    result: '신규 노드 4개 배치, 간선 10개 생성',
    reason: '근거: 각 신규 개념이 대화에서 "무엇을 설명하기 위해" 등장했는지로 앵커 노드를 정함.',
  },
  detect_weakpoints: {
    tool: 'detect_weakpoints',
    args: 'signals=["재질문", "전제 오류", "어시스턴트의 명시적 정정"]',
    result: '약점 1건 · 정정 1건 탐지 → KV Cache',
    reason:
      '근거: 사용자가 캐시의 적용 범위를 두 번 물었고, 두 번째 질문에서 어시스턴트가 "아니요"로 전제를 부정하며 정정함.',
  },
  write_lecture_note: {
    tool: 'write_lecture_note',
    args: 'concepts=5, include_evidence=true',
    result: '강의노트 5개 작성 (신규 3 · 기존 갱신 2)',
    reason:
      '근거: 약점이 잡힌 개념은 정정 전/후를 분리해 기록하고, 모든 문단에 대화 원문 구간을 근거로 붙임.',
  },
  review_graph: {
    tool: 'review_graph',
    args: 'scope="this_run", checks=["중복 개념", "근거 없는 간선"]',
    result: '최종 노드 3개 추가, 간선 8개. 검수 지적 2건 반영 완료.',
    reason: '근거: 재검수에서 남은 노드/간선 전부가 대화 원문 구간에 1:1로 대응됨을 확인.',
  },
};

/* ────────────────────────────── 색상 / 범례 ────────────────────────────── */

export interface StatusStyle {
  label: string;
  fill: string;
  stroke: string;
  text: string;
  dashed?: boolean;
}

export const STATUS_STYLE: Record<NodeStatus, StatusStyle> = {
  learned: {
    label: '이해 검증 완료',
    fill: '#10b981',
    stroke: '#047857',
    text: '#0f172a',
  },
  introduced: {
    label: '대화에서 발견 · 검증 전',
    fill: '#ddd6fe',
    stroke: '#7c3aed',
    text: '#3b0764',
  },
  unlearned: {
    label: '미학습 · 다음에 공부할 것',
    fill: '#ffffff',
    stroke: '#94a3b8',
    text: '#64748b',
    dashed: true,
  },
  weak: {
    label: '약점 있음',
    fill: '#f59e0b',
    stroke: '#b45309',
    text: '#0f172a',
  },
};

export const NEW_STYLE = {
  label: '이번 실행에서 새로 추가됨',
  fill: '#8b5cf6',
  stroke: '#6d28d9',
};

/** 라벨을 노드 아래 최대 2줄로 접는다. */
export function wrapLabel(label: string, maxLen = 17): string[] {
  const words = label.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxLen) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
