import type { Edge, Node, Weakpoint } from '../contract/schema';

export type WeakpointKind =
  | 'scope'
  | 'mechanism'
  | 'relation'
  | 'example'
  | 'definition';

export type WeakpointAction = 'add' | 'merge' | 'ignore';

export interface WeakpointAnalysis {
  action: WeakpointAction;
  kind: WeakpointKind;
  targetNodeId: string;
  weakpointIndex: number | null;
  relatedNodeIds: string[];
  rationale: string;
  weakpoint: Weakpoint | null;
}

export interface AnalyzeQuestionInput {
  question: string;
  quote: string;
  nodeId: string;
  nodes: Node[];
  edges: Edge[];
  sourceConversationId?: string | null;
}

/**
 * This is the prompt contract for the eventual agent-backed implementation.
 * The local analyzer below deliberately follows the same decisions so the
 * frontend demo remains deterministic without an API key.
 */
export const WEAKPOINT_ANALYSIS_PROMPT = `
너는 학습 대화의 약점 진단자다.

입력으로 선택된 강의노트 문단, 연결된 그래프 노드, 사용자의 질문,
기존 weakpoint 목록을 받는다.

1. 단순한 추가 호기심인지, 개념을 잘못 적용하거나 혼동한 것인지 구분한다.
2. 질문의 양상을 scope, mechanism, relation, example, definition 중 하나로 분류한다.
3. 같은 노드의 기존 weakpoint와 양상이 같으면 merge, 다르면 add, 약점이 아니면 ignore 한다.
4. 선택된 노드가 실제 대상이 아닐 수 있으므로 인접 노드와 간선 관계를 함께 확인한다.
5. 대화에 없는 근거를 만들지 않는다. description, misconception, correction, evidence를 작성한다.
6. 최종 결과는 target_node_id, action, weakpoint_index, related_node_ids, rationale을 포함한다.
`;

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

const hasAny = (value: string, words: string[]) => words.some((word) => value.includes(word));

const KIND_LABEL: Record<WeakpointKind, string> = {
  scope: '적용 범위',
  mechanism: '작동 원리',
  relation: '개념 간 관계',
  example: '예시 적용',
  definition: '개념 정의',
};

export function weakpointKindLabel(kind: WeakpointKind): string {
  return KIND_LABEL[kind];
}

/** Classify the semantic shape of a question, not its exact wording. */
export function classifyQuestion(question: string): WeakpointKind {
  const value = normalize(question);

  if (hasAny(value, ['학습', '훈련', '추론', '언제', '어디까지', '에도', '항상', '적용', '가능'])) {
    return 'scope';
  }
  if (hasAny(value, ['차이', '같은', '관계', '대신', '비교', '연결', '무엇과'])) {
    return 'relation';
  }
  if (hasAny(value, ['예시', '예를', '경우', '상황', '실제로', '적용해'])) {
    return 'example';
  }
  if (hasAny(value, ['왜', '어떻게', '원리', '계산', '다시', '과정', '이유'])) {
    return 'mechanism';
  }
  return 'definition';
}

export function classifyWeakpoint(weakpoint: Weakpoint): WeakpointKind {
  return classifyQuestion(
    [weakpoint.description, weakpoint.misconception, weakpoint.correction]
      .filter(Boolean)
      .join(' '),
  );
}

function looksLikeWeakpoint(question: string): boolean {
  const value = normalize(question);
  if (value.length < 4) return false;
  if (hasAny(value, ['이해했어요', '알겠어요', '이해됐어요', '정리하면 맞'])) return false;
  return value.includes('?')
    || hasAny(value, ['왜', '어떻게', '그럼', '그러면', '맞나요', '모르', '헷갈', '안 되', '가능']);
}

function directRelatedNodes(nodeId: string, nodes: Node[], edges: Edge[]): string[] {
  const existing = new Set(nodes.map((node) => node.id));
  return edges
    .filter((edge) => edge.from_id === nodeId || edge.to_id === nodeId)
    .map((edge) => (edge.from_id === nodeId ? edge.to_id : edge.from_id))
    .filter((id, index, ids) => existing.has(id) && ids.indexOf(id) === index)
    .slice(0, 3);
}

export function analyzeQuestion(input: AnalyzeQuestionInput): WeakpointAnalysis {
  const question = input.question.trim();
  const node = input.nodes.find((candidate) => candidate.id === input.nodeId);
  const kind = classifyQuestion(question);
  const relatedNodeIds = directRelatedNodes(input.nodeId, input.nodes, input.edges);

  if (!node || !looksLikeWeakpoint(question)) {
    return {
      action: 'ignore',
      kind,
      targetNodeId: input.nodeId,
      weakpointIndex: null,
      relatedNodeIds,
      rationale: !node
        ? '선택한 문단의 개념이 현재 그래프에 없어 노트 코멘트만 남긴다.'
        : '질문은 기록할 수 있지만 개념을 잘못 이해했다는 신호가 충분하지 않다.',
      weakpoint: null,
    };
  }

  const weakpointIndex = node.weakpoints.findIndex((candidate) => classifyWeakpoint(candidate) === kind);
  const evidenceText = `${input.quote ? `선택 문단: ${input.quote} ` : ''}사용자 질문: ${question}`.trim();
  const weakpoint: Weakpoint = {
    description: `${node.name}의 ${weakpointKindLabel(kind)}에 대한 혼란이 드러남: ${question}`,
    misconception: `사용자가 ${node.name}의 ${weakpointKindLabel(kind)}을(를) 질문의 전제와 다르게 이해했을 가능성이 있음.`,
    correction: node.summary,
    evidence: [{ index: 0, speaker: 'user', text: evidenceText }],
    source_conversation_id: input.sourceConversationId ?? null,
  };

  return {
    action: weakpointIndex >= 0 ? 'merge' : 'add',
    kind,
    targetNodeId: node.id,
    weakpointIndex: weakpointIndex >= 0 ? weakpointIndex : null,
    relatedNodeIds,
    rationale: weakpointIndex >= 0
      ? `기존 '${weakpointKindLabel(kind)}' 약점과 같은 양상이므로 근거를 하나로 합친다.`
      : `기존 약점과 다른 '${weakpointKindLabel(kind)}' 양상이므로 별도 약점으로 기록한다.`,
    weakpoint,
  };
}

export function mergeWeakpoint(existing: Weakpoint, incoming: Weakpoint): Weakpoint {
  const evidence = [...existing.evidence, ...incoming.evidence].filter((candidate, index, all) => (
    all.findIndex((item) => item.speaker === candidate.speaker && item.text === candidate.text) === index
  ));

  return {
    ...existing,
    misconception: existing.misconception ?? incoming.misconception,
    correction: existing.correction ?? incoming.correction,
    evidence,
    source_conversation_id: incoming.source_conversation_id ?? existing.source_conversation_id,
  };
}

const RELATION_DECAY: Record<Edge['relation'], number> = {
  prerequisite: 1,
  component: 0.9,
  variant: 0.72,
  contrast: 0.62,
  application: 0.5,
};

export function computeSpectrumScores(
  nodes: Node[],
  edges: Edge[],
  resolvedWeakpoints: Set<string>,
): Record<string, number> {
  const raw = new Map<string, number>();

  for (const node of nodes) {
    const openWeakpoints = node.weakpoints.filter((_, index) => !resolvedWeakpoints.has(`${node.id}::${index}`));
    if (openWeakpoints.length === 0 || node.status !== 'weak') continue;

    const questionCount = openWeakpoints.reduce(
      (total, weakpoint) => total + Math.max(1, weakpoint.evidence.filter((item) => item.speaker === 'user').length),
      0,
    );
    const centerScore = 1 + Math.min(1.5, Math.max(0, questionCount - 1) * 0.25) + (openWeakpoints.length - 1) * 0.4;
    raw.set(node.id, (raw.get(node.id) ?? 0) + centerScore);

    const visited = new Set<string>([node.id]);
    let frontier = [{ id: node.id, score: centerScore, depth: 0 }];
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const current of frontier) {
        if (current.depth >= 2) continue;
        for (const edge of edges) {
          if (edge.from_id !== current.id && edge.to_id !== current.id) continue;
          const neighborId = edge.from_id === current.id ? edge.to_id : edge.from_id;
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);
          const depthDecay = current.depth === 0 ? 0.54 : 0.34;
          const neighborScore = current.score * depthDecay * RELATION_DECAY[edge.relation];
          if (neighborScore < 0.08) continue;
          raw.set(neighborId, (raw.get(neighborId) ?? 0) + neighborScore);
          next.push({ id: neighborId, score: neighborScore, depth: current.depth + 1 });
        }
      }
      frontier = next;
    }
  }

  const max = Math.max(...raw.values(), 0);
  if (max === 0) return {};

  return Object.fromEntries(
    [...raw.entries()]
      .map(([id, score]) => [id, score / max] as const)
      .filter(([, score]) => score >= 0.1)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10),
  );
}

export function spectrumColor(score: number, alpha = 1): string {
  const clamped = Math.max(0, Math.min(1, score));
  const start = [247, 245, 239];
  const end = [213, 67, 48];
  const channels = start.map((channel, index) => Math.round(channel + (end[index] - channel) * clamped));
  return `rgba(${channels.join(', ')}, ${alpha})`;
}
