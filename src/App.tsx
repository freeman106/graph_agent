import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RELATION_LABEL, type Node } from '../contract/schema';
import Graph from './components/Graph';
import Legend from './components/Legend';
import NodeDetail from './components/NodeDetail';
import NoteWorkspace from './components/NoteWorkspace';
import StreamPanel from './components/StreamPanel';
import { anchorForNode, LECTURE_NOTE_SECTIONS, NOTE_COMMENTS, NOTE_INSERTIONS } from './lectureNote';
import { NODE_LAYOUT, placeNewNode, type Point } from './layout';
import {
  CONVERSATION_META,
  DETECTED_COMMENT,
  INITIAL_EDGES,
  INITIAL_NODES,
  NOTE_UPDATES,
  PLACEMENTS,
  REVIEW_FINDINGS,
  SAMPLE_CONVERSATION,
  TOOL_STEPS,
  WEAKPOINT_NODE_ID,
} from './mock';
import type { RuntimeEdge, RuntimeNode, RuntimeNoteComment, StreamLine, StreamLineKind } from './view';

type Phase = 'idle' | 'running' | 'done';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.round(ms * 0.42)));

function withLayout(nodes: Node[]): RuntimeNode[] {
  return nodes.map((node) => ({
    ...node,
    status: node.status === 'weak' ? 'learned' : node.status,
    comments: [],
    ...(NODE_LAYOUT[node.id] ?? { x: 0, y: 0 }),
  }));
}

function pointsOf(nodes: RuntimeNode[]): Record<string, Point> {
  return Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

const NAMES = new Map<string, string>([
  ...INITIAL_NODES.map((node) => [node.id, node.name] as const),
  ...PLACEMENTS.map((placement) => [placement.node.id, placement.node.name] as const),
]);
const nameOf = (id: string) => NAMES.get(id) ?? id;
const weakpointKey = (nodeId: string, index: number) => `${nodeId}::${index}`;

function initialNoteContent(): Record<string, string> {
  const original = LECTURE_NOTE_SECTIONS.flatMap((section) => section.paragraphs.map((paragraph) => [paragraph.id, paragraph.body] as const));
  const insertions = NOTE_INSERTIONS.flatMap((insertion) => insertion.paragraphs.map((paragraph, index) => [index === 0 ? insertion.id : `${insertion.id}-${index + 1}`, paragraph] as const));
  return Object.fromEntries([...original, ...insertions]);
}

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
  const [noteMode, setNoteMode] = useState(false);
  const [activeNoteAnchor, setActiveNoteAnchor] = useState('p-summary-1');
  const [noteNavigationVersion, setNoteNavigationVersion] = useState(0);
  const [noteComments, setNoteComments] = useState<RuntimeNoteComment[]>(() => NOTE_COMMENTS.map((comment) => ({ ...comment, kind: 'agent' as const, highlighted: true, archived: false })));
  const [noteContent, setNoteContent] = useState<Record<string, string>>(() => initialNoteContent());
  const [resolvedWeakpoints, setResolvedWeakpoints] = useState<Set<string>>(() => new Set());
  const [minimapPosition, setMinimapPosition] = useState({ x: 12, y: 12 });
  const [isMinimapDragging, setIsMinimapDragging] = useState(false);

  const lineId = useRef(0);
  const runToken = useRef(0);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const minimapDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setMinimapPosition((position) => ({
        x: Math.max(8, Math.min(Math.max(8, width - 358), position.x)),
        y: Math.max(8, Math.min(Math.max(8, height - 248), position.y)),
      }));
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  const push = useCallback((kind: StreamLineKind, text: string) => {
    const id = ++lineId.current;
    setLines((previous) => [...previous, { id, kind, text }]);
  }, []);

  const annotationsVisible = activeStep >= 3 || phase === 'done';
  const noteIds = useMemo(() => {
    const ids = new Set(nodes.filter((node) => node.comments.some((c) => c.weakpoint)).map((node) => node.id));
    noteComments
      .filter((comment) => !comment.archived && (annotationsVisible || !comment.revealOnRun))
      .forEach((comment) => ids.add(comment.nodeId));
    return ids;
  }, [nodes, annotationsVisible, noteComments]);
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
    setNoteMode(false);
    setActiveNoteAnchor('p-summary-1');
    setNoteNavigationVersion(0);
    setNoteComments(NOTE_COMMENTS.map((comment) => ({ ...comment, kind: 'agent' as const, highlighted: true, archived: false })));
    setNoteContent(initialNoteContent());
    setResolvedWeakpoints(new Set());
    setMinimapPosition({ x: 12, y: 12 });
  };

  const openNote = (nodeId: string) => {
    setSelectedId(nodeId);
    setActiveNoteAnchor(anchorForNode(nodeId));
    setNoteNavigationVersion((value) => value + 1);
    setNoteMode(true);
  };

  const navigateInNote = (nodeId: string, anchorId: string) => {
    setSelectedId(nodeId);
    setActiveNoteAnchor(anchorId);
    setNoteNavigationVersion((value) => value + 1);
  };

  const addNoteComment = (comment: RuntimeNoteComment, sourceText: string) => {
    setNoteComments((previous) => [...previous, comment]);
    setSelectedId(comment.nodeId);
    if (comment.anchorId) setActiveNoteAnchor(comment.anchorId);
    setNodes((previous) => previous.map((node) => {
      if (node.id !== comment.nodeId) return node;
      const updated = { ...node, flash: true };
      // 하이라이트 전용 코멘트는 약점이 아니다 — 계약 Comment.weakpoint 가 null 이 된다.
      if (comment.kind === 'highlight') {
        return {
          ...updated,
          comments: [
            ...node.comments,
            {
              body: `${comment.title}: ${comment.body}`,
              quote: comment.quote,
              weakpoint: null,
              source_conversation_id: `note-selection-${comment.id}`,
            },
          ],
        };
      }
      return {
        ...updated,
        status: 'weak' as const,
        comments: [
          ...node.comments,
          {
            body: `${comment.title}: ${comment.body}`,
            quote: comment.quote,
            weakpoint: {
              description: `${comment.title}: ${comment.body}`,
              misconception: null,
              correction: null,
              evidence: [{ index: 0, speaker: 'user', text: sourceText }],
              source_conversation_id: `note-selection-${comment.id}`,
            },
            source_conversation_id: `note-selection-${comment.id}`,
          },
        ],
      };
    }));
    window.setTimeout(() => {
      setNodes((previous) => previous.map((node) => node.flash ? { ...node, flash: false } : node));
    }, 760);
    push('detail', comment.kind === 'highlight'
      ? `  ✎ ${nameOf(comment.nodeId)} — 개인 하이라이트 추가`
      : `  ✎ ${nameOf(comment.nodeId)} — 노트 선택 영역에서 새 코멘트와 막힌 지점 추가`);
  };

  const toggleCommentHighlight = (commentId: string, highlighted: boolean) => {
    setNoteComments((previous) => previous.map((comment) => comment.id === commentId ? { ...comment, highlighted } : comment));
  };

  const updateNoteComment = (commentId: string, title: string, body: string) => {
    setNoteComments((previous) => previous.map((comment) => comment.id === commentId ? { ...comment, title, body } : comment));
  };

  const archiveNoteComment = (commentId: string, archived: boolean) => {
    setNoteComments((previous) => previous.map((comment) => comment.id === commentId ? { ...comment, archived } : comment));
  };

  const deleteNoteComment = (commentId: string) => {
    const target = noteComments.find((comment) => comment.id === commentId);
    setNoteComments((previous) => previous.filter((comment) => comment.id !== commentId));
    if (!target || (target.kind !== 'question' && target.kind !== 'conversation')) return;
    const sourceId = `note-selection-${commentId}`;
    setNodes((previous) => previous.map((node) => {
      if (node.id !== target.nodeId) return node;
      const comments = node.comments.filter((comment) => comment.source_conversation_id !== sourceId);
      const openWeakpoints = comments.filter((comment) => comment.weakpoint).length;
      return { ...node, comments, status: node.status === 'weak' && openWeakpoints === 0 ? 'learned' : node.status };
    }));
    setResolvedWeakpoints((previous) => new Set(Array.from(previous).filter((key) => !key.startsWith(`${target.nodeId}::`))));
  };

  const updateNoteContent = (paragraphId: string, body: string) => {
    setNoteContent((previous) => ({ ...previous, [paragraphId]: body }));
    setNoteComments((previous) => previous.map((comment) => {
      if (comment.anchorId !== paragraphId || !comment.quote) return comment;
      const start = body.indexOf(comment.quote);
      return start >= 0
        ? { ...comment, start, end: start + comment.quote.length }
        : { ...comment, highlighted: false, start: undefined, end: undefined };
    }));
  };

  const toggleWeakpoint = (nodeId: string, index: number, checked: boolean) => {
    const next = new Set(resolvedWeakpoints);
    const key = weakpointKey(nodeId, index);
    if (checked) next.add(key);
    else next.delete(key);
    setResolvedWeakpoints(next);
    setNodes((previous) => previous.map((node) => {
      if (node.id !== nodeId) return node;
      const nodeWeakpoints = node.comments.filter((comment) => comment.weakpoint);
      const allResolved = nodeWeakpoints.length > 0
        && nodeWeakpoints.every((_, weakpointIndex) => next.has(weakpointKey(node.id, weakpointIndex)));
      return { ...node, status: allResolved ? 'learned' : 'weak', flash: allResolved };
    }));
    if (checked) {
      window.setTimeout(() => {
        setNodes((previous) => previous.map((node) => node.flash ? { ...node, flash: false } : node));
      }, 760);
    }
  };

  const toggleLearned = (nodeId: string, checked: boolean) => {
    setNodes((previous) => previous.map((node) => {
      if (node.id !== nodeId) return node;
      const hasOpenWeakpoint = node.comments
        .filter((comment) => comment.weakpoint)
        .some((_, index) => !resolvedWeakpoints.has(weakpointKey(node.id, index)));
      return { ...node, status: checked ? 'learned' : hasOpenWeakpoint ? 'weak' : 'unlearned', flash: checked };
    }));
    if (checked) {
      window.setTimeout(() => {
        setNodes((previous) => previous.map((node) => node.flash ? { ...node, flash: false } : node));
      }, 760);
    }
  };

  const selectFromGraph = (nodeId: string | null) => {
    setSelectedId(nodeId);
    if (noteMode && nodeId) {
      setActiveNoteAnchor(anchorForNode(nodeId));
      setNoteNavigationVersion((value) => value + 1);
    }
  };

  const run = async (text: string) => {
    const token = ++runToken.current;
    const alive = () => runToken.current === token;

    setPasted(text);
    setPhase('running');
    setSelectedId(null);
    push('system', `대화 입력 감지 — ${text.length.toLocaleString()}자 / ${CONVERSATION_META.turns}턴`);
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
    push('detail', '  ▣ 기존 강의노트 관련 문장 2곳 일치 → 하이라이트와 코멘트 앵커 생성');
    push('detail', '  + 노트 밖 신규 개념 3개 → 시험범위 밖 보충 아코디언으로 분리');
    for (const evidence of DETECTED_COMMENT.weakpoint!.evidence.slice(0, 2)) {
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
          ? { ...node, status: 'weak', comments: [DETECTED_COMMENT], flash: true }
          : node,
      ),
    );
    push('detail', `  ✎ ${nameOf(WEAKPOINT_NODE_ID)} — 약점 1건 · 정정 전·후 · 인용 ${DETECTED_COMMENT.weakpoint!.evidence.length}건`);
    await wait(700);
    if (!alive()) return;
    setNodes((previous) => previous.map((node) => (node.flash ? { ...node, flash: false } : node)));
    for (const update of NOTE_UPDATES) {
      setNodes((previous) => previous.map((node) => (node.id === update.node_id ? { ...node, summary: update.summary } : node)));
      push('detail', `  ✎ ${nameOf(update.node_id)} — 요약 갱신`);
      await wait(340);
      if (!alive()) return;
    }
    push('detail', '  ✎ 오른쪽 코멘트 5건 연결 · 신규 보충 노드 3개와 노트 이동 경로 생성');
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
    push('done', `실행 완료 — 노드 ${INITIAL_NODES.length + 3}개 / 간선 ${INITIAL_EDGES.length + 8}개`);
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
    if (document.fullscreenElement === workspaceRef.current) {
      await document.exitFullscreen();
    } else {
      await workspaceRef.current?.requestFullscreen();
    }
  };

  const startMinimapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!noteMode || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    minimapDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: minimapPosition.x,
      originY: minimapPosition.y,
    };
    setIsMinimapDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveMinimap = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = minimapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(8, Math.min(bounds.width - 358, drag.originX + event.clientX - drag.startX));
    const y = Math.max(8, Math.min(bounds.height - 248, drag.originY + event.clientY - drag.startY));
    setMinimapPosition({ x, y });
  };

  const endMinimapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (minimapDragRef.current?.pointerId !== event.pointerId) return;
    minimapDragRef.current = null;
    setIsMinimapDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="app-shell flex h-screen min-w-[1120px] flex-col overflow-hidden text-[#20201e]">
      <header className="flex h-14 shrink-0 items-center border-b border-[#262624] bg-[#f3f0e8] px-5">
        <div className="mr-4 grid h-7 w-7 place-items-center border border-[#262624] bg-[#262624] text-[12px] font-black text-[#f3f0e8]">GM</div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-black tracking-[-0.02em]">GRAPHMIND</h1>
          <span className="text-[10px] font-semibold tracking-[0.18em] text-[#77736a]">개인 지식 지도</span>
        </div>
        <div className="ml-6 flex h-9 items-center border border-[#bdb8ad] bg-[#f8f6f0]">
          <label htmlFor="subject-select" className="border-r border-[#d2cec4] px-2.5 font-mono-term text-[8px] font-black tracking-[0.12em] text-[#8c877d]">과목</label>
          <select id="subject-select" value="deep-learning" onChange={() => {}} className="h-full border-0 bg-transparent px-3 text-[10px] font-black text-[#3c3a36] outline-none">
            <option value="deep-learning">딥러닝 시스템 설계</option>
          </select>
          <button type="button" className="h-full border-l border-[#d2cec4] px-3 text-[9px] font-black text-[#77736a] hover:bg-[#eee9df]">＋ 과목 추가</button>
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
        <main ref={workspaceRef} className="workspace-surface relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f7f5ef]">
          {noteMode && (
            <NoteWorkspace
              activeAnchorId={activeNoteAnchor}
              annotationsVisible={annotationsVisible}
              comments={noteComments}
              edges={edges}
              navigationVersion={noteNavigationVersion}
              noteContent={noteContent}
              nodes={nodes}
              onCreateComment={addNoteComment}
              onArchiveComment={archiveNoteComment}
              onDeleteComment={deleteNoteComment}
              onToggleCommentHighlight={toggleCommentHighlight}
              onUpdateComment={updateNoteComment}
              onUpdateNoteContent={updateNoteContent}
              onClose={() => setNoteMode(false)}
              onNavigate={navigateInNote}
            />
          )}

          <section
            className={`graph-surface graph-stage z-40 overflow-hidden bg-[#f7f5ef] ${noteMode ? 'graph-stage-note border border-[#262624] shadow-[8px_8px_0_rgba(38,38,36,0.15)]' : ''} ${isMinimapDragging ? 'graph-stage-dragging' : ''}`}
            style={noteMode ? { left: minimapPosition.x, top: minimapPosition.y } : undefined}
          >
            <div
              onPointerDown={startMinimapDrag}
              onPointerMove={moveMinimap}
              onPointerUp={endMinimapDrag}
              onPointerCancel={endMinimapDrag}
              onLostPointerCapture={() => { minimapDragRef.current = null; setIsMinimapDragging(false); }}
              className={`absolute top-0 right-0 left-0 z-20 flex touch-none items-center border-b border-[#d7d3ca] bg-[#f7f5ef]/95 transition-all ${noteMode ? `h-[42px] select-none px-3 ${isMinimapDragging ? 'cursor-grabbing' : 'cursor-grab'}` : 'h-[58px] px-5'}`}
            >
              {noteMode && <span className="mr-2 text-[13px] tracking-[-0.15em] text-[#9a958b]" aria-hidden="true">⠿</span>}
              <div>
                <div className={`${noteMode ? 'text-[8px]' : 'text-[10px]'} font-black tracking-[0.16em] text-[#77736a]`}>TRANSFORMER / COGNITIVE ATLAS</div>
                <div className={`${noteMode ? 'mt-0.5 text-[8px]' : 'mt-1 text-[10px]'} font-mono-term text-[#9a958b]`}>{nodes.length} CONCEPTS · {edges.length} RELATIONS</div>
              </div>
              {!noteMode && <div className="ml-auto flex items-center gap-1 border border-[#bdb8ad] bg-[#f7f5ef] p-[3px]">
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
              </div>}
              {noteMode && selectedNode && (
                <div className="ml-auto flex max-w-[145px] items-center gap-2">
                  <span className="h-2 w-2 shrink-0 bg-[#255c99]" />
                  <span className="truncate text-[9px] font-black text-[#3c3a36]">{selectedNode.name}</span>
                </div>
              )}
            </div>

            <div className={`absolute inset-0 ${noteMode ? 'top-[42px]' : 'top-[58px]'}`}>
              <Graph nodes={nodes} edges={edges} selectedId={selectedId} noteIds={noteIds} filter={mapFilter} onSelect={selectFromGraph} compact={noteMode} />
              {!noteMode && <Legend />}
              {selectedNode && !noteMode && (
                <NodeDetail
                  node={selectedNode}
                  nodes={nodes}
                  edges={edges}
                  resolvedWeakpoints={resolvedWeakpoints}
                  onSelect={setSelectedId}
                  onOpenNote={openNote}
                  onToggleLearned={toggleLearned}
                  onToggleWeakpoint={toggleWeakpoint}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          </section>

          <section className={`absolute right-0 bottom-0 left-0 shrink-0 overflow-hidden border-t border-[#262624] bg-[#efebe2] px-5 transition-all duration-500 ${noteMode ? 'pointer-events-none h-0 border-transparent py-0 opacity-0' : 'h-[154px] py-4 opacity-100'}`}>
            <div className="mb-2 flex items-center">
              <div>
                <span className="text-[10px] font-black tracking-[0.14em]">새 학습 기록</span>
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

        <aside className={`shrink-0 overflow-hidden border-l border-[#262624] transition-all duration-500 ${noteMode ? 'w-0 border-transparent opacity-0' : 'w-[420px] opacity-100'}`}>
          <StreamPanel lines={lines} activeStep={activeStep} phase={phase} />
        </aside>
      </div>
    </div>
  );
}
