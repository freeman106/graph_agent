import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RELATION_LABEL, type Node } from '../contract/schema';
import Graph from './components/Graph';
import Legend from './components/Legend';
import NodeDetail from './components/NodeDetail';
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.round(ms * 0.42)));

function withLayout(nodes: Node[]): RuntimeNode[] {
  return nodes.map((node) => ({ ...node, ...(NODE_LAYOUT[node.id] ?? { x: 0, y: 0 }) }));
}

function pointsOf(nodes: RuntimeNode[]): Record<string, Point> {
  return Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

const NAMES = new Map<string, string>([
  ...INITIAL_NODES.map((node) => [node.id, node.name] as const),
  ...PLACEMENTS.map((placement) => [placement.node.id, placement.node.name] as const),
]);
const nameOf = (id: string) => NAMES.get(id) ?? id;

export default function App() {
  const [nodes, setNodes] = useState<RuntimeNode[]>(() => withLayout(INITIAL_NODES));
  const [edges, setEdges] = useState<RuntimeEdge[]>(() => INITIAL_EDGES.map((edge) => ({ ...edge })));
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [activeStep, setActiveStep] = useState(-1);
  const [pasted, setPasted] = useState('');
  const [mapFilter, setMapFilter] = useState('all');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const lineId = useRef(0);
  const runToken = useRef(0);
  const graphSurfaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === graphSurfaceRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const push = useCallback((kind: StreamLineKind, text: string) => {
    const id = ++lineId.current;
    setLines((previous) => [...previous, { id, kind, text }]);
  }, []);

  const noteIds = useMemo(
    () => new Set(nodes.filter((node) => node.weakpoints.length > 0).map((node) => node.id)),
    [nodes],
  );
  const selectedNode = selectedId ? (nodes.find((node) => node.id === selectedId) ?? null) : null;
  const learnedCount = nodes.filter((node) => node.status === 'learned').length;
  const weakCount = nodes.filter((node) => node.status === 'weak').length;
  const openCount = nodes.filter((node) => node.status === 'unlearned').length;
  const newCount = nodes.filter((node) => node.isNew).length;

  const reset = () => {
    runToken.current++;
    setNodes(withLayout(INITIAL_NODES));
    setEdges(INITIAL_EDGES.map((edge) => ({ ...edge })));
    setLines([]);
    setSelectedId(null);
    setPhase('idle');
    setActiveStep(-1);
    setPasted('');
    setMapFilter('all');
  };

  const run = async (text: string) => {
    const token = ++runToken.current;
    const alive = () => runToken.current === token;

    setPasted(text);
    setPhase('running');
    setSelectedId(null);
    push('system', `대화 입력 감지 — ${text.length.toLocaleString()}자 / ${CONVERSATION_META.turns}턴`);
    push('system', '단계별 승인 없이 끝까지 실행합니다.');
    await wait(650);
    if (!alive()) return;

    setActiveStep(0);
    const s1 = TOOL_STEPS.parse_conversation;
    push('call', `[호출 중] ${s1.tool}(${s1.args})`);
    await wait(1300);
    if (!alive()) return;
    push('result', `[결과] ${s1.result}`);
    push('reason', s1.reason);
    push('detail', 'Self-Attention · Masked Attention · Query/Key/Value · Multi-Head Attention · Grouped-Query Attention');
    push('detail', 'KV Cache · Autoregressive Decoding · Incremental Decoding · Flash Attention');
    await wait(1400);
    if (!alive()) return;

    setActiveStep(1);
    const s2 = TOOL_STEPS.match_nodes;
    push('call', `[호출 중] ${s2.tool}(${s2.args})`);
    await wait(1350);
    if (!alive()) return;
    push('result', `[결과] ${s2.result}`);
    push('reason', s2.reason);
    push('detail', '일치 → Self-Attention, Masked Attention, Query/Key/Value, Multi-Head Attention, Grouped-Query Attention');
    push('detail', '신규 → KV Cache, Autoregressive Decoding, Incremental Decoding, Flash Attention');
    await wait(1300);
    if (!alive()) return;

    setActiveStep(2);
    const s3 = TOOL_STEPS.place_nodes;
    push('call', `[호출 중] ${s3.tool}(${s3.args})`);
    await wait(900);
    if (!alive()) return;

    for (const placement of PLACEMENTS) {
      setNodes((previous) => {
        const point = placeNewNode(placement.node.id, placement.anchors, pointsOf(previous));
        return [...previous, { ...placement.node, ...point, isNew: true, justAdded: true }];
      });
      push('place', `${placement.node.name} — 그래프에 배치`);
      await wait(520);
      if (!alive()) return;

      for (const edge of placement.edges) {
        setEdges((previous) => [...previous, { ...edge, isNew: true, justAdded: true }]);
        push('edge', `  └─[${RELATION_LABEL[edge.relation]}]→  ${nameOf(edge.from_id)} → ${nameOf(edge.to_id)}`);
        await wait(420);
        if (!alive()) return;
      }
      push('reason', `  ${placement.reason}`);
      await wait(560);
      if (!alive()) return;
    }

    setNodes((previous) => previous.map((node) => (node.justAdded ? { ...node, justAdded: false } : node)));
    setEdges((previous) => previous.map((edge) => (edge.justAdded ? { ...edge, justAdded: false } : edge)));
    push('result', `[결과] ${s3.result}`);
    push('reason', s3.reason);
    await wait(1400);
    if (!alive()) return;

    setActiveStep(3);
    const s4 = TOOL_STEPS.detect_weakpoints;
    push('call', `[호출 중] ${s4.tool}(${s4.args})`);
    await wait(1350);
    if (!alive()) return;
    push('result', `[결과] ${s4.result}`);
    push('reason', s4.reason);
    for (const evidence of DETECTED_WEAKPOINT.evidence.slice(0, 2)) {
      push('detail', `  #${evidence.index} ${evidence.speaker === 'user' ? '나' : 'ChatGPT'}: ${evidence.text.slice(0, 70)}…`);
    }
    await wait(1300);
    if (!alive()) return;

    setActiveStep(4);
    const s5 = TOOL_STEPS.write_lecture_note;
    push('call', `[호출 중] ${s5.tool}(${s5.args})`);
    await wait(900);
    if (!alive()) return;
    setNodes((previous) =>
      previous.map((node) =>
        node.id === WEAKPOINT_NODE_ID
          ? { ...node, status: 'weak', weakpoints: [DETECTED_WEAKPOINT], flash: true }
          : node,
      ),
    );
    push('detail', `  ✎ ${nameOf(WEAKPOINT_NODE_ID)} — 약점 1건 · 정정 전·후 · 인용 ${DETECTED_WEAKPOINT.evidence.length}건`);
    await wait(700);
    if (!alive()) return;
    setNodes((previous) => previous.map((node) => (node.flash ? { ...node, flash: false } : node)));
    for (const update of NOTE_UPDATES) {
      setNodes((previous) => previous.map((node) => (node.id === update.node_id ? { ...node, summary: update.summary } : node)));
      push('detail', `  ✎ ${nameOf(update.node_id)} — 요약 갱신`);
      await wait(340);
      if (!alive()) return;
    }
    push('result', `[결과] ${s5.result}`);
    push('reason', s5.reason);
    await wait(1300);
    if (!alive()) return;

    setActiveStep(5);
    const s6 = TOOL_STEPS.review_graph;
    push('call', `[호출 중] ${s6.tool}(${s6.args})`);
    await wait(1400);
    if (!alive()) return;
    for (const finding of REVIEW_FINDINGS) {
      push('warn', finding.claim);
      push('reason', `  ${finding.reason}`);
      await wait(950);
      if (!alive()) return;
      if (finding.fix.type === 'mergeNode') {
        const { from, into } = finding.fix;
        setNodes((previous) => previous.map((node) => node.id === from ? { ...node, removing: true } : node.id === into ? { ...node, flash: true } : node));
        setEdges((previous) => previous.map((edge) => edge.from_id === from || edge.to_id === from ? { ...edge, removing: true } : edge));
        await wait(460);
        if (!alive()) return;
        setNodes((previous) => previous.filter((node) => node.id !== from));
        setEdges((previous) => previous.filter((edge) => edge.from_id !== from && edge.to_id !== from));
        await wait(900);
        if (!alive()) return;
        setNodes((previous) => previous.map((node) => (node.flash ? { ...node, flash: false } : node)));
      } else {
        const { edgeId } = finding.fix;
        setEdges((previous) => previous.map((edge) => edge.id === edgeId ? { ...edge, removing: true } : edge));
        await wait(460);
        if (!alive()) return;
        setEdges((previous) => previous.filter((edge) => edge.id !== edgeId));
      }
      push('fix', finding.applied);
      await wait(1200);
      if (!alive()) return;
    }
    push('result', `[결과] ${s6.result}`);
    push('reason', s6.reason);
    await wait(700);
    if (!alive()) return;
    push('done', `실행 완료 — 노드 ${INITIAL_NODES.length + 3}개 / 간선 ${INITIAL_EDGES.length + 8}개. 노드를 클릭하면 노트가 열립니다.`);
    setActiveStep(6);
    setPhase('done');
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (phase !== 'idle') return;
    const text = event.clipboardData.getData('text');
    if (text.trim().length < 20) return;
    event.preventDefault();
    void run(text);
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === graphSurfaceRef.current) {
      await document.exitFullscreen();
    } else {
      await graphSurfaceRef.current?.requestFullscreen();
    }
  };

  return (
    <div className="app-shell flex h-screen min-w-[1120px] flex-col overflow-hidden text-[#20201e]">
      <header className="flex h-14 shrink-0 items-center border-b border-[#262624] bg-[#f3f0e8] px-5">
        <div className="mr-4 grid h-7 w-7 place-items-center border border-[#262624] bg-[#262624] text-[12px] font-black text-[#f3f0e8]">GM</div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-black tracking-[-0.02em]">GRAPHMIND</h1>
          <span className="text-[10px] font-semibold tracking-[0.18em] text-[#77736a]">개인 지식 지도</span>
        </div>
        <div className="ml-auto flex h-full items-center border-x border-[#d2cec4]">
          {[
            ['학습', learnedCount],
            ['약점', weakCount],
            ['미학습', openCount],
            ['이번 기록', newCount],
          ].map(([label, value]) => (
            <div key={label} className="flex h-full min-w-[74px] flex-col justify-center border-r border-[#d2cec4] px-3 last:border-r-0">
              <span className="font-mono-term text-[9px] uppercase tracking-wider text-[#8c877d]">{label}</span>
              <span className="mt-0.5 text-[14px] font-black tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        <div className="ml-4 flex items-center gap-2 text-[10px] font-bold text-[#666259]">
          <span className={`h-2 w-2 ${phase === 'running' ? 'animate-pulse bg-[#d85b35]' : phase === 'done' ? 'bg-[#255c99]' : 'bg-[#aaa59b]'}`} />
          {phase === 'idle' ? '대기 중' : phase === 'running' ? '지도 갱신 중' : '기록 완료'}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col bg-[#f7f5ef]">
          <section ref={graphSurfaceRef} className="graph-surface relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute top-0 right-0 left-0 z-20 flex h-[58px] items-center border-b border-[#d7d3ca] bg-[#f7f5ef]/95 px-5">
              <div>
                <div className="text-[10px] font-black tracking-[0.16em] text-[#77736a]">TRANSFORMER / COGNITIVE ATLAS</div>
                <div className="mt-1 font-mono-term text-[10px] text-[#9a958b]">{nodes.length} CONCEPTS · {edges.length} RELATIONS</div>
              </div>
              <div className="ml-auto flex items-center gap-1 border border-[#bdb8ad] bg-[#f7f5ef] p-[3px]">
                {[
                  ['all', '전체'],
                  ['weak', '막힌 지점'],
                  ['frontier', '다음 경계'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setMapFilter(value)}
                    className={`px-3 py-1.5 text-[10px] font-bold transition ${mapFilter === value ? 'bg-[#262624] text-[#f7f5ef]' : 'text-[#77736a] hover:bg-[#e8e4db]'}`}
                  >
                    {label}
                  </button>
                ))}
                <span className="mx-1 h-5 border-l border-[#bdb8ad]" />
                <button
                  onClick={() => setSelectedId(null)}
                  disabled={!selectedId}
                  className="px-2.5 py-1.5 text-[10px] font-bold text-[#5f5b53] transition hover:bg-[#e8e4db] disabled:cursor-default disabled:opacity-30"
                >
                  ↙ 전체 보기
                </button>
                <button
                  onClick={() => void toggleFullscreen()}
                  data-testid="graph-fullscreen"
                  className={`px-2.5 py-1.5 text-[10px] font-bold transition ${isFullscreen ? 'bg-[#255c99] text-white' : 'text-[#5f5b53] hover:bg-[#e8e4db]'}`}
                >
                  {isFullscreen ? '× 전체 화면 종료' : '⛶ 전체 화면'}
                </button>
              </div>
            </div>

            <div className="absolute inset-0 top-[58px]">
              <Graph nodes={nodes} edges={edges} selectedId={selectedId} noteIds={noteIds} filter={mapFilter} onSelect={setSelectedId} />
              <Legend />
              {selectedNode && (
                <NodeDetail node={selectedNode} nodes={nodes} edges={edges} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
              )}
            </div>
          </section>

          <section className="h-[154px] shrink-0 border-t border-[#262624] bg-[#efebe2] px-5 py-4">
            <div className="mb-2 flex items-center">
              <div>
                <span className="text-[10px] font-black tracking-[0.14em]">새 학습 기록</span>
                <span className="ml-3 text-[10px] text-[#827d73]">대화를 붙여넣으면 오른쪽 로그와 지도가 동시에 갱신됩니다.</span>
              </div>
              <div className="ml-auto flex items-center gap-3 text-[10px]">
                {phase === 'idle' ? (
                  <button onClick={() => void run(SAMPLE_CONVERSATION)} className="border-b border-[#255c99] pb-0.5 font-bold text-[#255c99]">샘플 기록 실행</button>
                ) : (
                  <button onClick={reset} className="border-b border-[#d85b35] pb-0.5 font-bold text-[#9f4025]">초기화</button>
                )}
                <span className="font-mono-term text-[#aaa59b]">PASTE TO RUN</span>
              </div>
            </div>
            <textarea
              value={pasted}
              onPaste={handlePaste}
              onChange={(event) => setPasted(event.target.value)}
              readOnly={phase !== 'idle'}
              placeholder="여기에 ChatGPT 또는 Claude 학습 대화를 붙여넣으세요…"
              className="light-scroll h-[92px] w-full resize-none border border-[#bdb8ad] bg-[#f8f6f0] px-3 py-2.5 text-[12px] leading-relaxed text-[#3c3a36] outline-none placeholder:text-[#aaa59b] focus:border-[#262624] disabled:opacity-60"
            />
          </section>
        </main>

        <aside className="w-[420px] shrink-0 border-l border-[#262624]">
          <StreamPanel lines={lines} activeStep={activeStep} phase={phase} />
        </aside>
      </div>
    </div>
  );
}
