import { useCallback, useMemo, useRef, useState } from 'react';
import { RELATION_LABEL, type Node } from '../contract/schema';
import Graph from './components/Graph';
import Legend from './components/Legend';
import NodeDetail from './components/NodeDetail';
import SideRail from './components/SideRail';
import StreamPanel from './components/StreamPanel';
import { NODE_LAYOUT, placeNewNode, type Point } from './layout';
import {
  CONVERSATION_META,
  DETECTED_WEAKPOINT,
  INITIAL_EDGES,
  INITIAL_NODES,
  NOTE_UPDATES,
  PLACEMENTS,
  REVIEW_FINDINGS,
  SAMPLE_CONVERSATION,
  TOOL_STEPS,
  WEAKPOINT_NODE_ID,
} from './mock';
import type { RuntimeEdge, RuntimeNode, StreamLine, StreamLineKind } from './view';

type Phase = 'idle' | 'running' | 'done';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 계약 Node 에 프론트 좌표를 붙여 렌더링용 노드로 만든다. */
function withLayout(nodes: Node[]): RuntimeNode[] {
  return nodes.map((n) => ({ ...n, ...(NODE_LAYOUT[n.id] ?? { x: 0, y: 0 }) }));
}

function pointsOf(nodes: RuntimeNode[]): Record<string, Point> {
  return Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

/** 스트림 줄에 개념 이름을 찍기 위한 정적 라벨 맵 */
const NAMES = new Map<string, string>([
  ...INITIAL_NODES.map((n) => [n.id, n.name] as const),
  ...PLACEMENTS.map((p) => [p.node.id, p.node.name] as const),
]);
const nameOf = (id: string) => NAMES.get(id) ?? id;

export default function App() {
  const [nodes, setNodes] = useState<RuntimeNode[]>(() => withLayout(INITIAL_NODES));
  const [edges, setEdges] = useState<RuntimeEdge[]>(() => INITIAL_EDGES.map((e) => ({ ...e })));
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [activeStep, setActiveStep] = useState(-1);
  const [pasted, setPasted] = useState('');

  const lineId = useRef(0);
  const runToken = useRef(0);

  const push = useCallback((kind: StreamLineKind, text: string) => {
    setLines((prev) => [...prev, { id: ++lineId.current, kind, text }]);
  }, []);

  const noteIds = useMemo(
    () => new Set(nodes.filter((n) => n.weakpoints.length > 0).map((n) => n.id)),
    [nodes],
  );
  const selectedNode = selectedId ? (nodes.find((n) => n.id === selectedId) ?? null) : null;

  const reset = () => {
    runToken.current++;
    setNodes(withLayout(INITIAL_NODES));
    setEdges(INITIAL_EDGES.map((e) => ({ ...e })));
    setLines([]);
    setSelectedId(null);
    setPhase('idle');
    setActiveStep(-1);
    setPasted('');
  };

  /* ──────────────────── 실행: 전부 타이머로 흐름만 흉내 낸다 ──────────────────── */

  const run = async (text: string) => {
    const my = ++runToken.current;
    const alive = () => runToken.current === my;

    setPasted(text);
    setPhase('running');
    setSelectedId(null);

    push('system', `대화 입력 감지 — ${text.length.toLocaleString()}자 / ${CONVERSATION_META.turns}턴`);
    push('system', '단계별 승인 없이 끝까지 실행합니다.');
    await wait(650);
    if (!alive()) return;

    /* ── 1. parse_conversation ── */
    setActiveStep(0);
    const s1 = TOOL_STEPS.parse_conversation;
    push('call', `[호출 중] ${s1.tool}(${s1.args})`);
    await wait(1300);
    if (!alive()) return;
    push('result', `[결과] ${s1.result}`);
    push('reason', s1.reason);
    push(
      'detail',
      'Self-Attention · Masked Attention · Query/Key/Value · Multi-Head Attention · Grouped-Query Attention',
    );
    push('detail', 'KV Cache · Autoregressive Decoding · Incremental Decoding · Flash Attention');
    await wait(1400);
    if (!alive()) return;

    /* ── 2. match_nodes ── */
    setActiveStep(1);
    const s2 = TOOL_STEPS.match_nodes;
    push('call', `[호출 중] ${s2.tool}(${s2.args})`);
    await wait(1350);
    if (!alive()) return;
    push('result', `[결과] ${s2.result}`);
    push('reason', s2.reason);
    push(
      'detail',
      '일치 → Self-Attention, Masked Attention, Query/Key/Value, Multi-Head Attention, Grouped-Query Attention',
    );
    push('detail', '신규 → KV Cache, Autoregressive Decoding, Incremental Decoding, Flash Attention');
    await wait(1300);
    if (!alive()) return;

    /* ── 3. place_nodes — 대표 장면 ── */
    setActiveStep(2);
    const s3 = TOOL_STEPS.place_nodes;
    push('call', `[호출 중] ${s3.tool}(${s3.args})`);
    await wait(900);
    if (!alive()) return;

    for (const p of PLACEMENTS) {
      setNodes((prev) => {
        const point = placeNewNode(p.node.id, p.anchors, pointsOf(prev));
        return [...prev, { ...p.node, ...point, isNew: true, justAdded: true }];
      });
      push('place', `${p.node.name} — 그래프에 배치`);
      await wait(520);
      if (!alive()) return;

      for (const e of p.edges) {
        setEdges((prev) => [...prev, { ...e, isNew: true, justAdded: true }]);
        push(
          'edge',
          `  └─[${RELATION_LABEL[e.relation]}]→  ${nameOf(e.from_id)} → ${nameOf(e.to_id)}`,
        );
        await wait(420);
        if (!alive()) return;
      }
      push('reason', `  ${p.reason}`);
      await wait(560);
      if (!alive()) return;
    }

    // 등장 강조를 끄고 각자의 상태 색으로 정착시킨다.
    setNodes((prev) => prev.map((n) => (n.justAdded ? { ...n, justAdded: false } : n)));
    setEdges((prev) => prev.map((e) => (e.justAdded ? { ...e, justAdded: false } : e)));
    push('result', `[결과] ${s3.result}`);
    push('reason', s3.reason);
    await wait(1400);
    if (!alive()) return;

    /* ── 4. detect_weakpoints ── */
    setActiveStep(3);
    const s4 = TOOL_STEPS.detect_weakpoints;
    push('call', `[호출 중] ${s4.tool}(${s4.args})`);
    await wait(1350);
    if (!alive()) return;
    push('result', `[결과] ${s4.result}`);
    push('reason', s4.reason);
    for (const ev of DETECTED_WEAKPOINT.evidence.slice(0, 2)) {
      push('detail', `  #${ev.index} ${ev.speaker === 'user' ? '나' : 'ChatGPT'}: ${ev.text.slice(0, 70)}…`);
    }
    await wait(1300);
    if (!alive()) return;

    /* ── 5. mark_progress — 약점과 노트를 그래프에 쓴다 ── */
    setActiveStep(4);
    const s5 = TOOL_STEPS.write_lecture_note;
    push('call', `[호출 중] ${s5.tool}(${s5.args})`);
    await wait(900);
    if (!alive()) return;

    setNodes((prev) =>
      prev.map((n) =>
        n.id === WEAKPOINT_NODE_ID
          ? { ...n, status: 'weak', weakpoints: [DETECTED_WEAKPOINT], flash: true }
          : n,
      ),
    );
    push('detail', `  ✎ ${nameOf(WEAKPOINT_NODE_ID)} — 약점 1건 · 정정 전·후 · 인용 ${DETECTED_WEAKPOINT.evidence.length}건`);
    await wait(700);
    if (!alive()) return;
    setNodes((prev) => prev.map((n) => (n.flash ? { ...n, flash: false } : n)));

    for (const u of NOTE_UPDATES) {
      setNodes((prev) =>
        prev.map((n) => (n.id === u.node_id ? { ...n, summary: u.summary } : n)),
      );
      push('detail', `  ✎ ${nameOf(u.node_id)} — 요약 갱신`);
      await wait(340);
      if (!alive()) return;
    }
    push('result', `[결과] ${s5.result}`);
    push('reason', s5.reason);
    await wait(1300);
    if (!alive()) return;

    /* ── 6. review_graph — 자기 결과의 문제를 스스로 잡아낸다 ── */
    setActiveStep(5);
    const s6 = TOOL_STEPS.review_graph;
    push('call', `[호출 중] ${s6.tool}(${s6.args})`);
    await wait(1400);
    if (!alive()) return;

    for (const f of REVIEW_FINDINGS) {
      push('warn', f.claim);
      push('reason', `  ${f.reason}`);
      await wait(950);
      if (!alive()) return;

      if (f.fix.type === 'mergeNode') {
        const { from, into } = f.fix;
        setNodes((prev) =>
          prev.map((n) =>
            n.id === from ? { ...n, removing: true } : n.id === into ? { ...n, flash: true } : n,
          ),
        );
        setEdges((prev) =>
          prev.map((e) => (e.from_id === from || e.to_id === from ? { ...e, removing: true } : e)),
        );
        await wait(460);
        if (!alive()) return;
        setNodes((prev) => prev.filter((n) => n.id !== from));
        setEdges((prev) => prev.filter((e) => e.from_id !== from && e.to_id !== from));
        await wait(900);
        if (!alive()) return;
        setNodes((prev) => prev.map((n) => (n.flash ? { ...n, flash: false } : n)));
      } else {
        const { edgeId } = f.fix;
        setEdges((prev) => prev.map((e) => (e.id === edgeId ? { ...e, removing: true } : e)));
        await wait(460);
        if (!alive()) return;
        setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      }

      push('fix', f.applied);
      await wait(1200);
      if (!alive()) return;
    }

    push('result', `[결과] ${s6.result}`);
    push('reason', s6.reason);
    await wait(700);
    if (!alive()) return;
    push(
      'done',
      `실행 완료 — 노드 ${INITIAL_NODES.length + 3}개 / 간선 ${INITIAL_EDGES.length + 8}개. 노드를 클릭하면 노트가 열립니다.`,
    );
    setActiveStep(6);
    setPhase('done');
  };

  /** 붙여넣는 순간 자동 실행 — 실행 버튼 없음 */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (phase !== 'idle') return;
    const text = e.clipboardData.getData('text');
    if (text.trim().length < 20) return;
    e.preventDefault();
    void run(text);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-slate-900 text-[13px] font-black text-white">
          ▚
        </div>
        <h1 className="text-[15px] font-bold tracking-tight">지식그래프 학습 도우미</h1>
        <span className="text-[12px] text-slate-400">
          공부한 대화를 붙여넣으면 개념이 추출되어 기존 그래프에 자동으로 연결됩니다
        </span>
        <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 font-mono-term text-[10.5px] text-slate-500">
          prototype · mock data
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 좌측: 지식그래프 + 붙여넣기 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-white">
            <div className="pointer-events-none absolute top-3 left-4 z-10">
              <div className="text-[11px] font-bold tracking-wider text-slate-400">지식그래프</div>
              <div className="font-mono-term text-[11px] text-slate-400">
                {nodes.length} nodes · {edges.length} edges
              </div>
            </div>
            <Graph
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              noteIds={noteIds}
              onSelect={setSelectedId}
            />
            <Legend />
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-4 pt-3 pb-3">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-bold tracking-wider text-slate-400">
                대화 붙여넣기
              </span>
              <span className="text-[11px] text-slate-400">
                붙여넣는 즉시 자동 실행됩니다 · 단계별 승인 없음
              </span>
              <span className="ml-auto text-[11px]">
                {phase === 'idle' ? (
                  <button
                    onClick={() => void run(SAMPLE_CONVERSATION)}
                    className="text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-600"
                  >
                    샘플 대화 붙여넣기 (데모용)
                  </button>
                ) : (
                  <button
                    onClick={reset}
                    className="text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-600"
                  >
                    초기화
                  </button>
                )}
              </span>
            </div>
            <textarea
              value={pasted}
              onPaste={handlePaste}
              onChange={(e) => setPasted(e.target.value)}
              readOnly={phase !== 'idle'}
              placeholder="여기에 ChatGPT / Claude 대화를 통째로 붙여넣으세요  (⌘V)"
              className={`light-scroll h-[104px] w-full resize-none rounded-lg border px-3 py-2.5 text-[12.5px] leading-relaxed outline-none transition ${
                phase === 'idle'
                  ? 'border-slate-200 bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white'
                  : 'border-slate-200 bg-slate-50/60 text-slate-400'
              }`}
            />
          </div>
        </div>

        {/* 같은 자리를 나눠 쓴다: 평소엔 "다음에 공부할 것", 노드를 고르면 노트 패널 */}
        {selectedNode ? (
          <NodeDetail
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <SideRail nodes={nodes} edges={edges} onSelect={setSelectedId} />
        )}

        {/* 우측: 에이전트 실행 스트림 */}
        <div className="w-[404px] shrink-0">
          <StreamPanel lines={lines} activeStep={activeStep} phase={phase} />
        </div>
      </div>
    </div>
  );
}
