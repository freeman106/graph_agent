import { useCallback, useMemo, useRef, useState } from 'react';
import Graph, { type DetailLevel, type GraphMode } from './components/Graph';
import Legend from './components/Legend';
import NodeDetail from './components/NodeDetail';
import SideRail from './components/SideRail';
import StreamPanel from './components/StreamPanel';
import {
  CONVERSATION_META,
  INITIAL_EDGES,
  INITIAL_NODES,
  LECTURE_NOTES,
  PLACEMENTS,
  REVIEW_FINDINGS,
  SAMPLE_CONVERSATION,
  TOOL_STEPS,
  WEAKPOINT_NODE_ID,
  type LectureNote,
  type RuntimeEdge,
  type RuntimeNode,
  type StreamLine,
  type StreamLineKind,
} from './mock';

type Phase = 'idle' | 'running' | 'done';

/** 데모는 사고 과정이 보이되, 결과까지 15초 안에 도달하도록 압축한다. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.round(ms * 0.34)));

/** 스트림 줄에 개념 이름을 찍기 위한 정적 라벨 맵 */
const LABELS = new Map<string, string>([
  ...INITIAL_NODES.map((n) => [n.id, n.label] as const),
  ...PLACEMENTS.map((p) => [p.node.id, p.node.label] as const),
]);
const labelOf = (id: string) => LABELS.get(id) ?? id;

export default function App() {
  const [nodes, setNodes] = useState<RuntimeNode[]>(() => INITIAL_NODES.map((n) => ({ ...n })));
  const [edges, setEdges] = useState<RuntimeEdge[]>(() => INITIAL_EDGES.map((e) => ({ ...e })));
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [notes, setNotes] = useState<Record<string, LectureNote>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [verified, setVerified] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [pasted, setPasted] = useState('');
  const [graphMode, setGraphMode] = useState<GraphMode>('atlas');
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('links');
  const [goalId, setGoalId] = useState('grouped-query-attention');

  const lineId = useRef(0);
  const runToken = useRef(0);

  const push = useCallback((kind: StreamLineKind, text: string) => {
    setLines((prev) => [...prev, { id: ++lineId.current, kind, text }]);
  }, []);

  const noteIds = useMemo(() => new Set(Object.keys(notes)), [notes]);
  const frontierIds = useMemo(() => {
    const active = new Set(nodes.filter((node) => node.status !== 'unlearned').map((node) => node.id));
    return new Set(
      nodes
        .filter((node) => node.status === 'unlearned')
        .filter((node) =>
          edges.some(
            (edge) =>
              (edge.source === node.id && active.has(edge.target)) ||
              (edge.target === node.id && active.has(edge.source)),
          ),
        )
        .map((node) => node.id),
    );
  }, [nodes, edges]);
  const selectedNode = selectedId ? (nodes.find((n) => n.id === selectedId) ?? null) : null;

  const reset = () => {
    runToken.current++;
    setNodes(INITIAL_NODES.map((n) => ({ ...n })));
    setEdges(INITIAL_EDGES.map((e) => ({ ...e })));
    setLines([]);
    setNotes({});
    setSelectedId(null);
    setPhase('idle');
    setVerified(false);
    setActiveStep(-1);
    setPasted('');
    setGraphMode('atlas');
    setDetailLevel('links');
  };

  const verifyUnderstanding = () => {
    setVerified(true);
    setSelectedId(null);
    setNodes((prev) =>
      prev.map((node) =>
        node.id === WEAKPOINT_NODE_ID ? { ...node, status: 'learned', flash: true } : node,
      ),
    );
    window.setTimeout(() => {
      setNodes((prev) => prev.map((node) => (node.flash ? { ...node, flash: false } : node)));
    }, 1500);
  };

  /* ──────────────────── 실행: 전부 타이머로 흐름만 흉내 낸다 ──────────────────── */

  const run = async (text: string) => {
    const my = ++runToken.current;
    const alive = () => runToken.current === my;

    setPasted(text);
    setPhase('running');
    setVerified(false);
    setSelectedId(null);

    push(
      'system',
      `대화 입력 감지 — ${text.length.toLocaleString()}자 / ${CONVERSATION_META.turns}턴`,
    );
    push('system', '단계별 승인 없이 6단계를 끝까지 실행합니다.');
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
      setNodes((prev) => [...prev, { ...p.node, isNew: true, justAdded: true }]);
      push('place', `${p.node.label} — 그래프에 배치`);
      await wait(520);
      if (!alive()) return;

      for (const e of p.edges) {
        setEdges((prev) => [...prev, { ...e, isNew: true, justAdded: true }]);
        push('edge', `  └─[${e.relation}]→  ${labelOf(e.source)} → ${labelOf(e.target)}`);
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
    setNodes((prev) =>
      prev.map((n) => (n.id === WEAKPOINT_NODE_ID ? { ...n, status: 'weak', flash: true } : n)),
    );
    push('detail', '  정정 전 → 학습이 더 오래 걸리니 학습에도 KV Cache를 적용하면 이득이다');
    push('detail', '  정정 후 → 학습은 전 위치를 한 번의 forward로 계산. 재사용할 이전 스텝이 없음');
    await wait(1000);
    if (!alive()) return;
    setNodes((prev) => prev.map((n) => (n.flash ? { ...n, flash: false } : n)));
    await wait(600);
    if (!alive()) return;

    /* ── 5. write_lecture_note ── */
    setActiveStep(4);
    const s5 = TOOL_STEPS.write_lecture_note;
    push('call', `[호출 중] ${s5.tool}(${s5.args})`);
    await wait(900);
    if (!alive()) return;
    for (const note of LECTURE_NOTES) {
      setNotes((prev) => ({ ...prev, [note.nodeId]: note }));
      push(
        'detail',
        `  ✎ ${labelOf(note.nodeId)} — 요약 / ${
          note.correction ? '정정 전·후 / ' : ''
        }인용 ${note.evidence.length}건`,
      );
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
          prev.map((e) => (e.source === from || e.target === from ? { ...e, removing: true } : e)),
        );
        await wait(460);
        if (!alive()) return;
        setNodes((prev) => prev.filter((n) => n.id !== from));
        setEdges((prev) => prev.filter((e) => e.source !== from && e.target !== from));
        setNotes((prev) => {
          const next = { ...prev };
          delete next[from];
          return next;
        });
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
      `실행 완료 — 노드 ${INITIAL_NODES.length + 3}개 / 간선 ${
        INITIAL_EDGES.length + 8
      }개. 노드를 클릭하면 강의노트가 열립니다.`,
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
    <div className="flex h-screen min-w-[1180px] flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-slate-950 to-slate-700 text-[14px] font-black text-white shadow-sm">
          G
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-extrabold tracking-tight">Graphmind</h1>
            <span className="text-[10px] font-bold tracking-wider text-slate-400">PERSONAL COGNITIVE MAP</span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-slate-400">무엇을 이해했고, 어디서 착각했는지를 기억합니다.</p>
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] font-semibold text-slate-500">나의 지식지도 · Transformer</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 좌측: 지식그래프 + 붙여넣기 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-white">
            <div className="pointer-events-none absolute top-3 left-4 z-10">
              <div className="text-[11px] font-bold tracking-wider text-slate-500">
                {graphMode === 'atlas' ? '지식 지도' : graphMode === 'orbit' ? '목표 궤도' : '학습 흐름'}
              </div>
              <div className="font-mono-term text-[11px] text-slate-400">
                {nodes.length} nodes · {edges.length} edges
              </div>
            </div>
            <div className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-slate-200 bg-white/92 p-1 shadow-sm backdrop-blur">
              {([
                ['atlas', '◫', '지도'],
                ['orbit', '◎', '목표 궤도'],
                ['story', '⌁', '학습 흐름'],
              ] as const).map(([mode, icon, label]) => (
                <button
                  key={mode}
                  onClick={() => setGraphMode(mode)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10.5px] font-bold transition ${
                    graphMode === mode
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                  }`}
                >
                  <span className="text-[13px]">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
            {graphMode !== 'story' && (
              <div className="absolute top-3 right-4 z-20 flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-slate-200 bg-white/92 p-0.5 shadow-sm backdrop-blur">
                  {([
                    ['regions', '영역'],
                    ['links', '연결'],
                    ['concepts', '개념'],
                  ] as const).map(([level, label]) => (
                    <button
                      key={level}
                      onClick={() => setDetailLevel(level)}
                      className={`rounded-md px-2 py-1 text-[9.5px] font-bold transition ${
                        detailLevel === level ? 'bg-sky-100 text-sky-700' : 'text-slate-400 hover:text-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {graphMode === 'orbit' && (
              <label className="absolute top-[54px] right-4 z-20 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
                <span className="text-[9.5px] font-extrabold tracking-wider text-violet-500">GOAL</span>
                <select
                  value={goalId}
                  onChange={(event) => {
                    setGoalId(event.target.value);
                    setSelectedId(null);
                  }}
                  className="max-w-[170px] bg-transparent text-[10.5px] font-bold text-violet-900 outline-none"
                >
                  <option value="grouped-query-attention">Grouped-Query Attention</option>
                  <option value="transformer-block">Transformer Block</option>
                  <option value="beam-search">Beam Search</option>
                </select>
              </label>
            )}
            <Graph
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              noteIds={noteIds}
              frontierIds={frontierIds}
              mode={graphMode}
              detailLevel={detailLevel}
              goalId={goalId}
              onSelect={setSelectedId}
            />
            {graphMode !== 'story' && <Legend />}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-4 pt-3 pb-3">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-extrabold tracking-wider text-slate-500">
                학습 대화 가져오기
              </span>
              <span className="text-[11px] text-slate-400">
                ChatGPT · Claude 대화를 붙여넣으면 자동으로 생각의 흔적을 분석합니다
              </span>
              <span className="ml-auto text-[11px]">
                {phase === 'idle' ? (
                  <button
                    onClick={() => void run(SAMPLE_CONVERSATION)}
                    className="text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-600"
                  >
                    샘플로 경험하기 →
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
              placeholder="여기에 학습 대화를 통째로 붙여넣으세요…  (Ctrl/⌘ + V)"
              className={`light-scroll h-[104px] w-full resize-none rounded-lg border px-3 py-2.5 text-[12.5px] leading-relaxed outline-none transition ${
                phase === 'idle'
                  ? 'border-slate-200 bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white'
                  : 'border-slate-200 bg-slate-50/60 text-slate-400'
              }`}
            />
          </div>
        </div>

        {/* 같은 자리를 나눠 쓴다: 평소엔 "다음에 공부할 것", 노드를 고르면 강의노트 패널 */}
        {selectedNode ? (
          <NodeDetail
            node={selectedNode}
            note={notes[selectedNode.id]}
            nodes={nodes}
            edges={edges}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <SideRail nodes={nodes} edges={edges} onSelect={setSelectedId} />
        )}

        {/* 우측: 에이전트 실행 스트림 */}
        <div className="w-[390px] shrink-0">
          <StreamPanel
            lines={lines}
            activeStep={activeStep}
            phase={phase}
            verified={verified}
            onVerify={verifyUnderstanding}
            onSelect={setSelectedId}
          />
        </div>
      </div>
    </div>
  );
}
