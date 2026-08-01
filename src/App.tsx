import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RELATION_LABEL, type Chapter, type Edge, type Graph as ContractGraph, type Node, type StreamEvent } from '../contract/schema';
import Graph from './components/Graph';
import Legend from './components/Legend';
import NodeDetail from './components/NodeDetail';
import NoteWorkspace from './components/NoteWorkspace';
import PdfNoteWorkspace from './components/PdfNoteWorkspace';
import StudyPlanWorkspace from './components/StudyPlanWorkspace';
import StreamPanel from './components/StreamPanel';
import { LECTURE_NOTE_SECTIONS, NOTE_INSERTIONS } from './lectureNote';
import { layoutByChapter, NODE_LAYOUT, placeNewNode, type Point } from './layout';
import { extractPdfNote, type PdfNoteDocument } from './pdfNote';
import { buildNoteBundle } from './graphNote';
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
import { fetchGraph, fetchRedoStatus, fetchSharedChat, fetchUndoStatus, isShareUrl, probeAgent, redoLastRun, runAgent, runLecture, toStreamLine, undoLastRun, type AgentStatus } from './agentApi';
import type { RuntimeEdge, RuntimeNode, RuntimeNoteComment, RuntimePipelineStep, StreamLine, StreamLineKind } from './view';

type Phase = 'idle' | 'running' | 'done';
type LearningInputMode = 'conversation' | 'share' | 'reflection';
type Subject = { id: string; name: string };

const DEFAULT_SUBJECT: Subject = { id: 'deep-learning', name: '딥러닝 시스템 설계' };
const SUBJECTS_STORAGE_KEY = 'graphmind.subjects.v1';

function initialSubjects(): Subject[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SUBJECTS_STORAGE_KEY) ?? '[]') as Subject[];
    const valid = parsed.filter((subject) => subject?.id && subject?.name);
    return valid.some((subject) => subject.id === DEFAULT_SUBJECT.id)
      ? valid
      : [DEFAULT_SUBJECT, ...valid];
  } catch {
    return [DEFAULT_SUBJECT];
  }
}

const GRAPH_MUTATION_TOOLS = new Set([
  'create_chapter',
  'create_subtopic',
  'create_node',
  'link_nodes',
  'merge_nodes',
  'mark_progress',
]);

const INPUT_MODES: Array<{
  id: LearningInputMode;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    id: 'conversation',
    label: 'GPT 대화 원문',
    hint: '나: / ChatGPT: 형식의 학습 대화',
    placeholder: 'GPT와 나눈 학습 대화를 그대로 붙여넣으세요…',
  },
  {
    id: 'share',
    label: 'GPT 공유 링크',
    hint: 'chatgpt.com/share 링크',
    placeholder: 'https://chatgpt.com/share/…',
  },
  {
    id: 'reflection',
    label: '현재 학습 상황',
    hint: '이해한 내용·막힌 지점·궁금한 점',
    placeholder: '',
  },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.round(ms * 0.42)));

function withLayout(
  nodes: Node[],
  edges: Edge[] = INITIAL_EDGES,
  chapters: Chapter[] = [],
): RuntimeNode[] {
  // 단원이 있으면 그게 곧 세로 줄이다. 손으로 잡은 좌표보다 우선한다.
  if (chapters.length > 0) {
    const { points } = layoutByChapter(chapters, nodes);
    const rest: Record<string, Point> = { ...points };
    return nodes.map((node) => {
      let point = points[node.id];
      if (!point) {
        const anchors = edges
          .filter((edge) => edge.from_id === node.id || edge.to_id === node.id)
          .map((edge) => (edge.from_id === node.id ? edge.to_id : edge.from_id));
        point = placeNewNode(node.id, anchors, rest);
        rest[node.id] = point;
      }
      return {
        ...node,
        status: node.status === 'weak' ? 'learned' : node.status,
        comments: [],
        ...point,
      };
    });
  }

  // NODE_LAYOUT 은 손으로 잡은 시드 좌표라 강의안이 만든 노드는 들어 있지 않다.
  // 좌표가 없으면 (0,0) 에 쌓이므로, 이웃을 보고 자리를 잡아 준다.
  const placed: Record<string, Point> = {};
  for (const node of nodes) {
    const fixed = NODE_LAYOUT[node.id];
    if (fixed) placed[node.id] = fixed;
  }
  return nodes.map((node) => {
    let point = placed[node.id];
    if (!point) {
      const anchors = edges
        .filter((edge) => edge.from_id === node.id || edge.to_id === node.id)
        .map((edge) => (edge.from_id === node.id ? edge.to_id : edge.from_id));
      point = placeNewNode(node.id, anchors, placed);
      placed[node.id] = point;
    }
    return {
      ...node,
      status: node.status === 'weak' ? 'learned' : node.status,
      comments: [],
      ...point,
    };
  });
}

function pointsOf(nodes: RuntimeNode[]): Record<string, Point> {
  return Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

/** 약점 내용이 있는데 상태만 learned인 과거 실행 데이터도 화면에서는 약점으로 복구한다. */
function normalizeWeakpointStatus(node: Node): Node {
  return node.comments.some((comment) => comment.weakpoint)
    ? { ...node, status: 'weak' }
    : node;
}

function restoreGraphNodes(graph: ContractGraph): RuntimeNode[] {
  const laidOut = withLayout(graph.nodes, graph.edges, graph.chapters);
  const rawById = new Map(graph.nodes.map((node) => [node.id, normalizeWeakpointStatus(node)]));
  return laidOut.map((node) => {
    const raw = rawById.get(node.id);
    return raw ? { ...raw, x: node.x, y: node.y } : node;
  });
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

function pipelineLabel(tool: string): string {
  if (['parse_conversation'].includes(tool)) return '입력 분석';
  if (['search_nodes', 'get_neighbors', 'match_nodes', 'lookup_reference'].includes(tool)) return '개념·근거 조사';
  if (['create_chapter', 'create_subtopic'].includes(tool)) return '단원 구조 생성';
  if (['create_node', 'link_nodes', 'merge_nodes', 'place_nodes'].includes(tool)) return '지식지도 구성';
  if (['quote_conversation', 'detect_weakpoints'].includes(tool)) return '약점 근거 확인';
  if (['mark_progress', 'write_lecture_note'].includes(tool)) return '학습 상태 반영';
  if (['review_graph'].includes(tool)) return '결과 검수';
  return '도구 실행';
}

function addPipelineTool(
  steps: RuntimePipelineStep[],
  id: number,
  tool: string,
): RuntimePipelineStep[] {
  const label = pipelineLabel(tool);
  const last = steps.at(-1);
  if (last?.status === 'running' && last.label === label) {
    return steps.map((step, index) =>
      index === steps.length - 1
        ? { ...step, tools: [...step.tools, { id, name: tool, status: 'running' }] }
        : step,
    );
  }
  return [
    ...steps,
    { id, label, status: 'running', tools: [{ id, name: tool, status: 'running' }] },
  ];
}

function completePipelineTool(
  steps: RuntimePipelineStep[],
  tool: string,
): RuntimePipelineStep[] {
  let stepIndex = -1;
  let toolIndex = -1;
  for (let i = 0; i < steps.length && stepIndex < 0; i += 1) {
    const match = steps[i].tools.findIndex(
      (item) => item.status === 'running' && item.name === tool,
    );
    if (match >= 0) {
      stepIndex = i;
      toolIndex = match;
    }
  }
  if (stepIndex < 0) return steps;
  return steps.map((step, index) => {
    if (index !== stepIndex) return step;
    const tools = step.tools.map((item, itemIndex) =>
      itemIndex === toolIndex ? { ...item, status: 'done' as const } : item,
    );
    return { ...step, tools, status: tools.every((item) => item.status === 'done') ? 'done' : 'running' };
  });
}

export default function App() {
  const [nodes, setNodes] = useState<RuntimeNode[]>([]);
  const [edges, setEdges] = useState<RuntimeEdge[]>([]);
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [activeStep, setActiveStep] = useState(-1);
  const [pipelineSteps, setPipelineSteps] = useState<RuntimePipelineStep[]>([]);
  const [pasted, setPasted] = useState('');
  const [inputMode, setInputMode] = useState<LearningInputMode>('conversation');
  const [inputError, setInputError] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState('all');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [docNote, setDocNote] = useState(false);
  const [activeNoteAnchor, setActiveNoteAnchor] = useState('');
  const [noteNavigationVersion, setNoteNavigationVersion] = useState(0);
  const [studyMode, setStudyMode] = useState(false);
  // 목 코멘트는 쓰지 않는다. 실제 node.comments 가 noteBundle 을 통해 들어온다.
  const [noteComments, setNoteComments] = useState<RuntimeNoteComment[]>([]);
  const [noteCommentHighlightOverrides, setNoteCommentHighlightOverrides] = useState<Record<string, boolean>>({});
  const [noteContent, setNoteContent] = useState<Record<string, string>>(() => initialNoteContent());
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [pdfNote, setPdfNote] = useState<PdfNoteDocument | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [resolvedWeakpoints, setResolvedWeakpoints] = useState<Set<string>>(() => new Set());
  const [minimapPosition, setMinimapPosition] = useState({ x: 12, y: 12 });
  const [isMinimapDragging, setIsMinimapDragging] = useState(false);
  // 키가 있는 개발 서버에서만 실제 실행이 붙는다. 없으면 목으로 흐른다.
  const [agent, setAgent] = useState<AgentStatus>({ available: false });
  const [subjects, setSubjects] = useState<Subject[]>(initialSubjects);
  const [activeSubjectId, setActiveSubjectId] = useState(DEFAULT_SUBJECT.id);
  const [subjectAdding, setSubjectAdding] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);
  const [redoing, setRedoing] = useState(false);

  const lineId = useRef(0);
  const runToken = useRef(0);
  const pdfLoadToken = useRef(0);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const minimapDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const subjectViewsRef = useRef(new Map<string, { nodes: RuntimeNode[]; edges: RuntimeEdge[]; chapters: Chapter[] }>());
  const undoViewSnapshotsRef = useRef(new Map<string, { nodes: RuntimeNode[]; edges: RuntimeEdge[]; chapters: Chapter[] }>());
  const redoViewSnapshotsRef = useRef(new Map<string, { nodes: RuntimeNode[]; edges: RuntimeEdge[]; chapters: Chapter[] }>());
  const serverUndoAvailableRef = useRef(false);
  const serverRedoAvailableRef = useRef(false);

  useEffect(() => {
    void probeAgent().then(setAgent);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SUBJECTS_STORAGE_KEY, JSON.stringify(subjects));
  }, [subjects]);

  useEffect(() => {
    let cancelled = false;
    serverUndoAvailableRef.current = false;
    serverRedoAvailableRef.current = false;
    setUndoAvailable(false);
    setRedoAvailable(false);
    void Promise.all([fetchUndoStatus(activeSubjectId), fetchRedoStatus(activeSubjectId)]).then(([undo, redo]) => {
      if (cancelled) return;
      const localUndo = undoViewSnapshotsRef.current.has(activeSubjectId);
      const localRedo = redoViewSnapshotsRef.current.has(activeSubjectId);
      serverUndoAvailableRef.current = !localUndo && !localRedo && undo;
      serverRedoAvailableRef.current = !localUndo && !localRedo && redo;
      setUndoAvailable(localUndo || (!localRedo && undo));
      setRedoAvailable(localRedo || (!localUndo && redo));
    });
    return () => { cancelled = true; };
  }, [activeSubjectId]);

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

  // 강의안이 만든 문서가 있으면 그것으로 노트를 엮는다. 없으면 null 이라 목 노트가 그려진다.
  const noteBundle = useMemo(
    () =>
      nodes.some((node) => node.document.trim())
        ? buildNoteBundle(chapters, nodes, pdfNote?.title ?? '강의노트')
        : null,
    [chapters, nodes, pdfNote],
  );

  const graphColumns = useMemo(
    () => (chapters.length > 0 ? layoutByChapter(chapters, nodes).columns : []),
    [chapters, nodes],
  );

  // 노트가 열리면(PDF든 문서든) 그래프는 미니맵으로 접힌다.
  const noteLayout = noteMode || docNote;

  const push = useCallback((kind: StreamLineKind, text: string) => {
    const id = ++lineId.current;
    setLines((previous) => [...previous, { id, kind, text }]);
  }, []);

  const syncLivePipeline = (event: StreamEvent) => {
    if (event.kind === 'tool_call') {
      setPipelineSteps((previous) => addPipelineTool(previous, event.seq, event.tool ?? 'unknown'));
      return;
    }
    if (event.kind !== 'tool_result') return;
    setPipelineSteps((previous) => completePipelineTool(previous, event.tool ?? 'unknown'));
  };

  const finishLivePipeline = () => {
    setPipelineSteps((previous) =>
      previous.map((step) => ({
        ...step,
        status: 'done',
        tools: step.tools.map((tool) => ({ ...tool, status: 'done' })),
      })),
    );
  };

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
  const selectedInputMode = INPUT_MODES.find((mode) => mode.id === inputMode) ?? INPUT_MODES[0];

  const clearWorkspaceForSubject = () => {
    setNodes([]);
    setEdges([]);
    setChapters([]);
    setLines([]);
    setSelectedId(null);
    setPhase('idle');
    setActiveStep(-1);
    setPipelineSteps([]);
    setPasted('');
    setInputError(null);
    setMapFilter('all');
    setNoteMode(false);
    setDocNote(false);
    setStudyMode(false);
    setPdfNote(null);
    setPdfError(null);
    setNoteComments([]);
    setNoteCommentHighlightOverrides({});
    setNoteContent(initialNoteContent());
    setResolvedWeakpoints(new Set());
    setMinimapPosition({ x: 12, y: 12 });
    setUndoAvailable(false);
    setUndoing(false);
    setRedoAvailable(false);
    setRedoing(false);
    serverUndoAvailableRef.current = false;
    serverRedoAvailableRef.current = false;
  };

  const switchSubject = async (subjectId: string) => {
    if (phase === 'running' || subjectId === activeSubjectId) return;
    subjectViewsRef.current.set(activeSubjectId, { nodes, edges, chapters });
    const token = ++runToken.current;
    setActiveSubjectId(subjectId);
    setSubjectAdding(false);
    setSubjectError(null);
    clearWorkspaceForSubject();

    const cached = subjectViewsRef.current.get(subjectId);
    if (cached) {
      setNodes(cached.nodes);
      setEdges(cached.edges);
      setChapters(cached.chapters);
      return;
    }

    const graph = await fetchGraph(subjectId);
    if (runToken.current !== token || !graph) return;
    setNodes(withLayout(graph.nodes, graph.edges, graph.chapters));
    setEdges(graph.edges.map((edge) => ({ ...edge })));
    setChapters(graph.chapters);
  };

  const addSubject = () => {
    const name = newSubjectName.trim();
    if (name.length < 2) {
      setSubjectError('과목 이름을 2자 이상 입력해 주세요.');
      return;
    }
    if (subjects.some((subject) => subject.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setSubjectError('이미 같은 이름의 과목이 있습니다.');
      return;
    }
    const subject = { id: `subject-${Date.now().toString(36)}`, name };
    setSubjects((previous) => [...previous, subject]);
    setNewSubjectName('');
    void switchSubject(subject.id);
  };

  const reset = () => {
    runToken.current++;
    setNodes([]);
    setEdges([]);
    setChapters([]);
    setLines([]);
    setSelectedId(null);
    setPhase('idle');
    setActiveStep(-1);
    setPipelineSteps([]);
    setPasted('');
    setInputMode('conversation');
    setInputError(null);
    setMapFilter('all');
    setNoteMode(false);
    setDocNote(false);
    setStudyMode(false);
    setPdfNote(null);
    setPdfError(null);
    setNoteComments([]);
    setNoteCommentHighlightOverrides({});
    setNoteContent(initialNoteContent());
    setResolvedWeakpoints(new Set());
    setMinimapPosition({ x: 12, y: 12 });
  };

  const navigateInNote = (nodeId: string, anchorId: string) => {
    setSelectedId(nodeId);
    setActiveNoteAnchor(anchorId);
    setNoteNavigationVersion((value) => value + 1);
  };

  const updateNoteContent = (paragraphId: string, body: string) =>
    setNoteContent((previous) => ({ ...previous, [paragraphId]: body }));

  const addNoteComment = (comment: RuntimeNoteComment) =>
    setNoteComments((previous) => [...previous, comment]);

  const toggleCommentHighlight = (commentId: string, highlighted: boolean) => {
    setNoteCommentHighlightOverrides((previous) => ({ ...previous, [commentId]: highlighted }));
    setNoteComments((previous) =>
      previous.map((comment) => (comment.id === commentId ? { ...comment, highlighted } : comment)),
    );
  };

  const updateNoteComment = (commentId: string, title: string, body: string) =>
    setNoteComments((previous) =>
      previous.map((comment) => (comment.id === commentId ? { ...comment, title, body } : comment)),
    );

  const archiveComment = (commentId: string, archived: boolean) =>
    setNoteComments((previous) =>
      previous.map((comment) => (comment.id === commentId ? { ...comment, archived } : comment)),
    );

  const deleteNoteComment = (commentId: string) =>
    setNoteComments((previous) => previous.filter((comment) => comment.id !== commentId));

  const undoLearningRun = async () => {
    if (!undoAvailable || undoing || phase === 'running') return;
    setUndoing(true);
    setInputError(null);
    const usingServer = serverUndoAvailableRef.current;
    try {
      let restored: { nodes: RuntimeNode[]; edges: RuntimeEdge[]; chapters: Chapter[] };
      if (usingServer) {
        const graph = await undoLastRun(activeSubjectId);
        restored = graph
          ? {
              nodes: restoreGraphNodes(graph),
              edges: graph.edges.map((edge) => ({ ...edge })),
              chapters: graph.chapters,
            }
          : { nodes: [], edges: [], chapters: [] };
      } else {
        const snapshot = undoViewSnapshotsRef.current.get(activeSubjectId);
        if (!snapshot) throw new Error('취소할 마지막 실행이 없습니다.');
        redoViewSnapshotsRef.current.set(activeSubjectId, {
          nodes: nodes.map((node) => ({ ...node })),
          edges: edges.map((edge) => ({ ...edge })),
          chapters,
        });
        restored = {
          nodes: snapshot.nodes.map((node) => ({ ...node })),
          edges: snapshot.edges.map((edge) => ({ ...edge })),
          chapters: snapshot.chapters,
        };
        undoViewSnapshotsRef.current.delete(activeSubjectId);
      }

      setNodes(restored.nodes);
      setEdges(restored.edges);
      setChapters(restored.chapters);
      subjectViewsRef.current.set(activeSubjectId, restored);
      setSelectedId(null);
      setDocNote(false);
      setNoteMode(false);
      setStudyMode(false);
      setNoteComments([]);
      setNoteCommentHighlightOverrides({});
      setResolvedWeakpoints(new Set());
      setPhase('idle');
      setActiveStep(-1);
      setPipelineSteps([]);
      setPasted('');
      setLines([]);
      lineId.current = 0;
      push('system', '마지막 학습 기록을 취소하고 실행 전 그래프로 복원했습니다.');
      setUndoAvailable(false);
      serverUndoAvailableRef.current = false;
      setRedoAvailable(true);
      serverRedoAvailableRef.current = usingServer;
    } catch (error) {
      setInputError(error instanceof Error ? error.message : '마지막 실행을 취소하지 못했습니다.');
    } finally {
      setUndoing(false);
    }
  };

  const redoLearningRun = async () => {
    if (!redoAvailable || redoing || phase === 'running') return;
    setRedoing(true);
    setInputError(null);
    const usingServer = serverRedoAvailableRef.current;
    try {
      let restored: { nodes: RuntimeNode[]; edges: RuntimeEdge[]; chapters: Chapter[] };
      if (usingServer) {
        const graph = await redoLastRun(activeSubjectId);
        restored = graph
          ? {
              nodes: restoreGraphNodes(graph),
              edges: graph.edges.map((edge) => ({ ...edge })),
              chapters: graph.chapters,
            }
          : { nodes: [], edges: [], chapters: [] };
      } else {
        const snapshot = redoViewSnapshotsRef.current.get(activeSubjectId);
        if (!snapshot) throw new Error('되돌릴 실행 취소가 없습니다.');
        undoViewSnapshotsRef.current.set(activeSubjectId, {
          nodes: nodes.map((node) => ({ ...node })),
          edges: edges.map((edge) => ({ ...edge })),
          chapters,
        });
        restored = {
          nodes: snapshot.nodes.map((node) => ({ ...node })),
          edges: snapshot.edges.map((edge) => ({ ...edge })),
          chapters: snapshot.chapters,
        };
        redoViewSnapshotsRef.current.delete(activeSubjectId);
      }

      setNodes(restored.nodes);
      setEdges(restored.edges);
      setChapters(restored.chapters);
      subjectViewsRef.current.set(activeSubjectId, restored);
      setSelectedId(null);
      setDocNote(false);
      setNoteMode(false);
      setStudyMode(false);
      setNoteComments([]);
      setNoteCommentHighlightOverrides({});
      setResolvedWeakpoints(new Set());
      setPhase('idle');
      setActiveStep(-1);
      setPipelineSteps([]);
      setPasted('');
      setLines([]);
      lineId.current = 0;
      push('system', '실행 취소를 되돌려 취소 전 그래프로 복원했습니다.');
      setRedoAvailable(false);
      serverRedoAvailableRef.current = false;
      setUndoAvailable(true);
      serverUndoAvailableRef.current = usingServer;
    } catch (error) {
      setInputError(error instanceof Error ? error.message : '실행 취소를 되돌리지 못했습니다.');
    } finally {
      setRedoing(false);
    }
  };

  const openNote = (nodeId: string) => {
    setStudyMode(false);
    const anchorId = noteBundle?.anchorOf[nodeId] ?? '';
    navigateInNote(nodeId, anchorId);
    setDocNote(true);
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

  const importPdf = async (file: File) => {
    const token = ++pdfLoadToken.current;
    setStudyMode(false);
    setNoteMode(true);
    setPdfLoading(true);
    setPdfError(null);
    try {
      const note = await extractPdfNote(file, file.name);
      if (pdfLoadToken.current !== token) return;
      setPdfNote(note);
      if (!agent.available) {
        setPdfError(agent.reason ?? 'LLM 실행 환경을 사용할 수 없어 PDF 원문만 준비했습니다.');
        return;
      }
      void buildGraphFromLecture(note.extractedText);
    } catch (error) {
      if (pdfLoadToken.current !== token) return;
      setPdfError(error instanceof Error ? error.message : 'PDF를 읽지 못했습니다.');
    } finally {
      if (pdfLoadToken.current === token) setPdfLoading(false);
    }
  };

  const selectFromGraph = (nodeId: string | null) => {
    setSelectedId(nodeId);
    if (!nodeId || !docNote) return;
    const anchorId = noteBundle?.anchorOf[nodeId];
    if (anchorId) navigateInNote(nodeId, anchorId);
  };

  /**
   * 강의안으로 그래프를 처음부터 만든다. 빈 그래프에서 시작하므로 화면도 비우고 연다.
   * 대화 실행과 달리 기존 노드를 남기지 않는다 — 강의안 기반인지 확인할 수 없게 되기 때문.
   */
  const buildGraphFromLecture = async (text: string) => {
    const token = ++runToken.current;
    const alive = () => runToken.current === token;

    setNoteMode(false);
    setStudyMode(false);
    setNodes([]);
    setEdges([]);
    setLines([]);
    setSelectedId(null);
    setPhase('running');
    setActiveStep(-1);
    setPipelineSteps([]);
    push('system', `강의안 ${text.length.toLocaleString()}자 → 빈 그래프에서 시작`);
    push('system', `실제 실행 — OpenAI API (키 …${agent.keyTail ?? ''})`);

    await runLecture(text, {
      onEvent: (event) => {
        if (!alive()) return;
        syncLivePipeline(event);
        const line = toStreamLine(event);
        if (line) push(line.kind, line.text);
      },
      onDone: () => {
        if (!alive()) return;
        finishLivePipeline();
        setPhase('done');
        void fetchGraph(activeSubjectId).then((graph) => {
          if (!alive() || !graph) return;
          // 강의안에서 처음 만든 그래프는 전부 기본 노드다.
          // isNew는 이후 학습 대화에서 추가된 보충 개념에만 사용한다.
          setNodes(withLayout(graph.nodes, graph.edges, graph.chapters));
          setEdges(graph.edges.map((edge) => ({ ...edge })));
          setChapters(graph.chapters);
          push('system', `강의안 반영 완료 — 노드 ${graph.nodes.length}개 / 간선 ${graph.edges.length}개 / 단원 ${graph.chapters.length}개`);
        });
      },
      onError: (message) => {
        if (!alive()) return;
        finishLivePipeline();
        push('system', `실행 실패 — ${message}`);
        setPhase('done');
      },
    }, activeSubjectId);
  };

  /**
   * 실제 에이전트 실행. 개발 서버에 키가 있을 때만 이 경로로 온다.
   *
   * 파이프라인은 도구의 목적과 실제 호출 순서로 묶는다. 각 묶음의 결과가
   * 모두 도착하면 그 단계가 완료되므로 미리 정한 단계 수에 의존하지 않는다.
   */
  const runLive = async (text: string, mode: LearningInputMode = inputMode) => {
    const token = ++runToken.current;
    const alive = () => runToken.current === token;
    let graphMutationObserved = false;
    const mutatedNodeIds = new Set<string>();
    const agentText = mode === 'reflection' ? `현재 학습 상황 입력:\n${text}` : text;

    setPasted(text);
    setPhase('running');
    setSelectedId(null);
    setActiveStep(-1);
    setPipelineSteps([]);
    push('system', `대화 입력 감지 — ${text.length.toLocaleString()}자`);
    push('system', `실제 실행 — OpenAI API (키 …${agent.keyTail ?? ''})`);

    // 초기화는 화면만 비우고 저장소는 보존한다. 실행 전 상태를 기억해 두지 않으면
    // 모델이 아무것도 바꾸지 않은 경우에도 과거 저장 그래프가 화면에 다시 나타난다.
    const graphBefore = await fetchGraph(activeSubjectId);
    if (!alive()) return;
    const graphBeforeSnapshot = graphBefore ? JSON.stringify(graphBefore) : null;

    await runAgent(agentText, {
      onEvent: (event) => {
        if (!alive()) return;
        if (event.kind === 'tool_call' && event.tool && GRAPH_MUTATION_TOOLS.has(event.tool)) {
          graphMutationObserved = true;
          for (const key of ['node_id', 'keep_id', 'merge_id']) {
            const value = event.args?.[key];
            if (typeof value === 'string') mutatedNodeIds.add(value);
          }
        }
        syncLivePipeline(event);
        const line = toStreamLine(event);
        if (line) push(line.kind, line.text);
      },
      onDone: () => {
        if (!alive()) return;
        finishLivePipeline();
        setPhase('done');
        void Promise.all([fetchUndoStatus(activeSubjectId), fetchRedoStatus(activeSubjectId)]).then(([undo, redo]) => {
          if (!alive()) return;
          serverUndoAvailableRef.current = undo;
          serverRedoAvailableRef.current = redo;
          setUndoAvailable(undo);
          setRedoAvailable(redo);
        });
        if (!graphMutationObserved) {
          push('system', '분석 완료 — 그래프에 반영할 학습 정보가 없습니다.');
          return;
        }
        void fetchGraph(activeSubjectId).then((graph) => {
          if (!alive() || !graph) return;
          if (JSON.stringify(graph) === graphBeforeSnapshot) {
            push('system', '분석 완료 — 그래프에 반영할 학습 정보가 없습니다.');
            return;
          }
          // 좌표는 계약에 없다. 새 노드는 프론트가 기존 배치를 보고 자리를 잡는다.
          setNodes((previous) => {
            const points = pointsOf(previous);
            const known = new Set(previous.map((node) => node.id));
            return graph.nodes.map((rawNode) => {
              const node = normalizeWeakpointStatus(rawNode);
              const seen = previous.find((candidate) => candidate.id === node.id);
              // 새 노드는 이미 자리를 아는 이웃 옆에 붙인다.
              const anchors = graph.edges
                .filter((edge) => edge.from_id === node.id || edge.to_id === node.id)
                .map((edge) => (edge.from_id === node.id ? edge.to_id : edge.from_id));
              const point = seen ?? NODE_LAYOUT[node.id] ?? placeNewNode(node.id, anchors, points);
              // 같은 응답에서 뒤이어 배치되는 새 노드도 이 자리를 피하게 한다.
              points[node.id] = { x: point.x, y: point.y };
              return {
                ...node,
                // 체크박스로 바꾼 로컬 학습 상태는 이 실행에서 모델이 직접 건드린
                // 노드가 아니면 보존한다. 전체 저장소 응답으로 덮어쓰지 않는다.
                status: seen && !mutatedNodeIds.has(node.id) ? seen.status : node.status,
                x: point.x,
                y: point.y,
                isNew: !known.has(node.id),
              };
            });
          });
          setEdges(graph.edges.map((edge) => ({ ...edge })));
          setChapters(graph.chapters);
          serverUndoAvailableRef.current = true;
          setUndoAvailable(true);
          serverRedoAvailableRef.current = false;
          setRedoAvailable(false);
          push('system', `실행 완료 — 노드 ${graph.nodes.length}개 / 간선 ${graph.edges.length}개`);
        });
      },
      onError: (message) => {
        if (!alive()) return;
        finishLivePipeline();
        push('system', `실행 실패 — ${message}`);
        setPhase('done');
        void Promise.all([fetchUndoStatus(activeSubjectId), fetchRedoStatus(activeSubjectId)]).then(([undo, redo]) => {
          if (!alive()) return;
          serverUndoAvailableRef.current = undo;
          serverRedoAvailableRef.current = redo;
          setUndoAvailable(undo);
          setRedoAvailable(redo);
        });
      },
    }, activeSubjectId);
  };

  const run = async (text: string) => {
    // 붙여넣은 게 ChatGPT 공유 링크면 대화를 먼저 받아 온다.
    if (isShareUrl(text)) {
      if (!agent.available) {
        push('system', '공유 링크를 읽으려면 개발 서버에 API 키가 필요합니다.');
        return;
      }
      setPhase('running');
      push('system', `공유 링크에서 대화를 가져오는 중…`);
      const fetched = await fetchSharedChat(text.trim());
      if ('error' in fetched) {
        push('system', `가져오기 실패 — ${fetched.error}`);
        setPhase('idle');
        return;
      }
      push('system', `대화 ${fetched.turnCount}턴 · ${fetched.text.length.toLocaleString()}자 확보`);
      return runLive(fetched.text, 'conversation');
    }
    if (agent.available) return runLive(text, inputMode);
    if (inputMode === 'reflection') {
      setPhase('done');
      push('system', agent.reason ?? '현재 학습 상황을 반영하려면 OpenAI API 연결이 필요합니다.');
      return;
    }
    const token = ++runToken.current;
    const alive = () => runToken.current === token;

    undoViewSnapshotsRef.current.set(activeSubjectId, {
      nodes: nodes.map((node) => ({ ...node })),
      edges: edges.map((edge) => ({ ...edge })),
      chapters,
    });
    redoViewSnapshotsRef.current.delete(activeSubjectId);
    serverRedoAvailableRef.current = false;
    setRedoAvailable(false);
    setPipelineSteps([]);
    setPasted(text);
    setPhase('running');
    setSelectedId(null);
    push('system', `대화 입력 감지 — ${text.length.toLocaleString()}자 / ${CONVERSATION_META.turns}턴`);
    await wait(650);
    if (!alive()) return;

    setActiveStep(0);
    const s1 = TOOL_STEPS.parse_conversation;
    setPipelineSteps((previous) => addPipelineTool(previous, 1, s1.tool));
    push('call', `[호출 중] ${s1.tool}(${s1.args})`);
    await wait(1300);
    if (!alive()) return;
    push('result', `[결과] ${s1.result}`);
    setPipelineSteps((previous) => completePipelineTool(previous, s1.tool));
    push('reason', s1.reason);
    push('detail', 'Self-Attention · Masked Attention · Query/Key/Value · Multi-Head Attention · Grouped-Query Attention');
    push('detail', 'KV Cache · Autoregressive Decoding · Incremental Decoding · Flash Attention');
    await wait(1400);
    if (!alive()) return;

    setActiveStep(1);
    const s2 = TOOL_STEPS.match_nodes;
    setPipelineSteps((previous) => addPipelineTool(previous, 2, s2.tool));
    push('call', `[호출 중] ${s2.tool}(${s2.args})`);
    await wait(1350);
    if (!alive()) return;
    push('result', `[결과] ${s2.result}`);
    setPipelineSteps((previous) => completePipelineTool(previous, s2.tool));
    push('reason', s2.reason);
    push('detail', '일치 → Self-Attention, Masked Attention, Query/Key/Value, Multi-Head Attention, Grouped-Query Attention');
    push('detail', '신규 → KV Cache, Autoregressive Decoding, Incremental Decoding, Flash Attention');
    await wait(1300);
    if (!alive()) return;

    setActiveStep(2);
    const s3 = TOOL_STEPS.place_nodes;
    setPipelineSteps((previous) => addPipelineTool(previous, 3, s3.tool));
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
    setPipelineSteps((previous) => completePipelineTool(previous, s3.tool));
    push('reason', s3.reason);
    await wait(1400);
    if (!alive()) return;

    setActiveStep(3);
    const s4 = TOOL_STEPS.detect_weakpoints;
    setPipelineSteps((previous) => addPipelineTool(previous, 4, s4.tool));
    push('call', `[호출 중] ${s4.tool}(${s4.args})`);
    await wait(1350);
    if (!alive()) return;
    push('result', `[결과] ${s4.result}`);
    setPipelineSteps((previous) => completePipelineTool(previous, s4.tool));
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
    setPipelineSteps((previous) => addPipelineTool(previous, 5, s5.tool));
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
    setPipelineSteps((previous) => completePipelineTool(previous, s5.tool));
    push('reason', s5.reason);
    await wait(1300);
    if (!alive()) return;

    setActiveStep(5);
    const s6 = TOOL_STEPS.review_graph;
    setPipelineSteps((previous) => addPipelineTool(previous, 6, s6.tool));
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
    setPipelineSteps((previous) => completePipelineTool(previous, s6.tool));
    push('reason', s6.reason);
    await wait(700);
    if (!alive()) return;
    push('done', `실행 완료 — 노드 ${INITIAL_NODES.length + 3}개 / 간선 ${INITIAL_EDGES.length + 8}개`);
    setActiveStep(6);
    setPhase('done');
    serverUndoAvailableRef.current = false;
    setUndoAvailable(true);
  };

  const selectInputMode = (mode: LearningInputMode) => {
    if (phase === 'running' || mode === inputMode) return;
    setInputMode(mode);
    setPasted('');
    setInputError(null);
  };

  const submitLearningRecord = () => {
    if (phase === 'running') return;
    const text = pasted.trim();
    if (inputMode === 'share' && !isShareUrl(text)) {
      setInputError('ChatGPT 공유 링크 형식을 확인해 주세요.');
      return;
    }
    if (inputMode === 'conversation' && text.length < 20) {
      setInputError('분석할 학습 대화를 20자 이상 입력해 주세요.');
      return;
    }
    const reflectionIsQuestion = /[?？]\s*$/.test(text);
    if (inputMode === 'reflection' && text.length < (reflectionIsQuestion ? 2 : 5)) {
      setInputError(reflectionIsQuestion
        ? '질문할 개념을 한 글자 이상 적어 주세요.'
        : '현재 이해한 내용이나 막힌 지점을 5자 이상 적어 주세요.');
      return;
    }
    setInputError(null);
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
        <div className="mr-4 grid h-8 w-8 shrink-0 place-items-center border border-[#262624] bg-[#f7f5ef] shadow-[2px_2px_0_#d2cec4]">
          <svg
            viewBox="0 0 32 32"
            className="h-7 w-7"
            role="img"
            aria-label="Graphmind 지식그래프 로고"
          >
            <path d="M7 8 16 6 25 11 18 19 8 24M7 8l11 11m-2-13 2 13m0 0 7 7M8 24l10-5" fill="none" stroke="#aaa59b" strokeWidth="1.25" />
            <path d="M16 6 8 24" fill="none" stroke="#817c72" strokeWidth="1" strokeDasharray="2 2.5" />
            <circle cx="7" cy="8" r="3.4" fill="#262624" stroke="#262624" strokeWidth="1.4" />
            <circle cx="16" cy="6" r="3.1" fill="#f7f5ef" stroke="#817c72" strokeWidth="1.5" />
            <rect x="21.8" y="7.8" width="6.4" height="6.4" rx="0.7" transform="rotate(45 25 11)" fill="#d85b35" stroke="#9f4025" strokeWidth="1.35" />
            <circle cx="18" cy="19" r="3.7" fill="#a65f2b" stroke="#6f3518" strokeWidth="1.5" />
            <circle cx="8" cy="24" r="3.2" fill="#f7f5ef" stroke="#255c99" strokeWidth="1.5" />
            <circle cx="25" cy="26" r="3" fill="#262624" stroke="#262624" strokeWidth="1.4" />
            <circle cx="26.3" cy="7.1" r="1.35" fill="#f7f5ef" stroke="#d85b35" strokeWidth="1" />
          </svg>
        </div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-black tracking-[-0.02em]">GRAPHMIND</h1>
          <span className="text-[10px] font-semibold tracking-[0.18em] text-[#77736a]">개인 지식 지도</span>
        </div>
        <div className="relative ml-6 flex h-9 items-center border border-[#bdb8ad] bg-[#f8f6f0]">
          <label htmlFor="subject-select" className="border-r border-[#d2cec4] px-2.5 font-mono-term text-[8px] font-black tracking-[0.12em] text-[#8c877d]">과목</label>
          <select
            id="subject-select"
            value={activeSubjectId}
            disabled={phase === 'running'}
            onChange={(event) => void switchSubject(event.target.value)}
            className="h-full max-w-[180px] border-0 bg-transparent px-3 text-[10px] font-black text-[#3c3a36] outline-none disabled:opacity-50"
          >
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
          <button
            type="button"
            disabled={phase === 'running'}
            onClick={() => { setSubjectAdding((value) => !value); setSubjectError(null); }}
            className="h-full border-l border-[#d2cec4] px-3 text-[9px] font-black text-[#77736a] hover:bg-[#eee9df] disabled:opacity-40"
          >＋ 과목 추가</button>
          {subjectAdding && (
            <div className="absolute top-11 left-0 z-[100] w-[310px] border border-[#262624] bg-[#f8f6f0] p-3 shadow-[6px_6px_0_rgba(38,38,36,0.16)]">
              <label htmlFor="new-subject-name" className="block text-[9px] font-black tracking-[0.12em] text-[#666259]">새 과목 이름</label>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => { event.preventDefault(); addSubject(); }}
              >
                <input
                  id="new-subject-name"
                  autoFocus
                  value={newSubjectName}
                  maxLength={30}
                  onChange={(event) => { setNewSubjectName(event.target.value); setSubjectError(null); }}
                  placeholder="예: 경제학 원론"
                  className="min-w-0 flex-1 border border-[#bdb8ad] bg-white px-2.5 py-2 text-[10px] font-bold outline-none focus:border-[#255c99]"
                />
                <button type="submit" className="bg-[#262624] px-3 text-[9px] font-black text-white">추가</button>
              </form>
              {subjectError && <p role="alert" className="mt-2 text-[8.5px] font-bold text-[#a24b36]">{subjectError}</p>}
              <p className="mt-2 text-[8px] leading-relaxed text-[#8c877d]">과목마다 그래프와 실행 기록이 별도로 저장됩니다.</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setNoteMode(false); setStudyMode(true); }}
          className={`ml-3 h-9 border px-3 text-[9px] font-black transition ${studyMode ? 'border-[#75492e] bg-[#75492e] text-white' : 'border-[#b99b72] bg-[#fffaf0] text-[#75492e] hover:border-[#75492e]'}`}
        >◎ 최소 학습 문서</button>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importPdf(file);
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          disabled={pdfLoading || phase === 'running'}
          onClick={() => pdfInputRef.current?.click()}
          className={`ml-2 h-9 border px-3 text-[9px] font-black transition disabled:cursor-wait disabled:opacity-50 ${noteMode ? 'border-[#255c99] bg-[#255c99] text-white' : 'border-[#8aa7bf] bg-[#edf3f8] text-[#255c99] hover:border-[#255c99]'}`}
        >▤ {pdfLoading ? 'PDF 읽는 중…' : 'PDF 업로드'}</button>
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
          {docNote && noteBundle && (
            <NoteWorkspace
              activeAnchorId={activeNoteAnchor}
              annotationsVisible
              comments={[
                ...(noteBundle?.comments ?? []).map((comment) =>
                  Object.hasOwn(noteCommentHighlightOverrides, comment.id)
                    ? { ...comment, highlighted: noteCommentHighlightOverrides[comment.id] }
                    : comment,
                ),
                ...noteComments,
              ]}
              edges={edges}
              navigationVersion={noteNavigationVersion}
              noteContent={{ ...noteBundle.noteContent, ...noteContent }}
              nodes={nodes}
              onClose={() => setDocNote(false)}
              onArchiveComment={archiveComment}
              onCreateComment={(comment) => addNoteComment(comment)}
              onDeleteComment={deleteNoteComment}
              onNavigate={navigateInNote}
              onToggleCommentHighlight={toggleCommentHighlight}
              onUpdateComment={updateNoteComment}
              onUpdateNoteContent={updateNoteContent}
              bundle={noteBundle}
            />
          )}

          {noteMode && (
            <PdfNoteWorkspace
              error={pdfError}
              isLoading={pdfLoading}
              note={pdfNote}
              onClose={() => setNoteMode(false)}
              onImportPdf={(file) => void importPdf(file)}
              canRun={agent.available}
              running={phase === 'running'}
              onBuildGraph={(text) => void buildGraphFromLecture(text)}
            />
          )}

          {studyMode && <StudyPlanWorkspace edges={edges} nodes={nodes} noteContent={noteContent} onClose={() => setStudyMode(false)} />}

          <section
            className={`graph-surface graph-stage z-40 overflow-hidden bg-[#f7f5ef] ${noteLayout ? 'graph-stage-note border border-[#262624] shadow-[8px_8px_0_rgba(38,38,36,0.15)]' : ''} ${studyMode ? 'pointer-events-none opacity-0' : ''} ${isMinimapDragging ? 'graph-stage-dragging' : ''}`}
            style={noteLayout ? { left: minimapPosition.x, top: minimapPosition.y } : undefined}
          >
            <div
              onPointerDown={startMinimapDrag}
              onPointerMove={moveMinimap}
              onPointerUp={endMinimapDrag}
              onPointerCancel={endMinimapDrag}
              onLostPointerCapture={() => { minimapDragRef.current = null; setIsMinimapDragging(false); }}
              className={`absolute top-0 right-0 left-0 z-20 flex touch-none items-center border-b border-[#d7d3ca] bg-[#f7f5ef]/95 transition-all ${noteLayout ? `h-[42px] select-none px-3 ${isMinimapDragging ? 'cursor-grabbing' : 'cursor-grab'}` : 'h-[58px] px-5'}`}
            >
              {noteLayout && <span className="mr-2 text-[13px] tracking-[-0.15em] text-[#9a958b]" aria-hidden="true">⠿</span>}
              <div>
                <div className={`${noteLayout ? 'text-[8px]' : 'text-[10px]'} font-black tracking-[0.16em] text-[#77736a]`}>TRANSFORMER / COGNITIVE ATLAS</div>
                <div className={`${noteLayout ? 'mt-0.5 text-[8px]' : 'mt-1 text-[10px]'} font-mono-term text-[#9a958b]`}>{nodes.length} CONCEPTS · {edges.length} RELATIONS</div>
              </div>
              {!noteLayout && <div className="ml-auto flex items-center gap-1 border border-[#bdb8ad] bg-[#f7f5ef] p-[3px]">
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
              {noteLayout && selectedNode && (
                <div className="ml-auto flex max-w-[145px] items-center gap-2">
                  <span className="h-2 w-2 shrink-0 bg-[#255c99]" />
                  <span className="truncate text-[9px] font-black text-[#3c3a36]">{selectedNode.name}</span>
                </div>
              )}
            </div>

            <div className={`absolute inset-0 ${noteLayout ? 'top-[42px]' : 'top-[58px]'}`}>
              <Graph nodes={nodes} edges={edges} selectedId={selectedId} noteIds={noteIds} filter={mapFilter} onSelect={selectFromGraph} compact={noteLayout} columns={graphColumns} />
              {!noteLayout && <Legend />}
              {selectedNode && !noteLayout && (
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

          <section className={`absolute right-0 bottom-0 left-0 z-50 shrink-0 overflow-hidden border-t border-[#262624] bg-[#efebe2] px-5 transition-all duration-500 ${noteLayout || studyMode ? 'pointer-events-none h-0 border-transparent py-0 opacity-0' : 'h-[218px] py-3 opacity-100'}`}>
            <div className="mb-2 flex items-center">
              <div>
                <span className="text-[10px] font-black tracking-[0.14em]">새 학습 기록</span>
              </div>
              <div className="ml-auto flex items-center gap-3 text-[10px]">
                {inputMode === 'conversation' && phase === 'idle' && (
                  <button onClick={() => { setPasted(SAMPLE_CONVERSATION); void run(SAMPLE_CONVERSATION); }} className="border-b border-[#255c99] pb-0.5 font-bold text-[#255c99]">샘플 기록 실행</button>
                )}
                {undoAvailable && (
                  <button
                    type="button"
                    disabled={phase === 'running' || undoing || redoing}
                    onClick={() => void undoLearningRun()}
                    className="border-b border-[#255c99] pb-0.5 font-bold text-[#255c99] disabled:cursor-wait disabled:opacity-40"
                  >{undoing ? '취소 중…' : '↶ 실행 취소'}</button>
                )}
                {redoAvailable && (
                  <button
                    type="button"
                    disabled={phase === 'running' || undoing || redoing}
                    onClick={() => void redoLearningRun()}
                    className="border-b border-[#255c99] pb-0.5 font-bold text-[#255c99] disabled:cursor-wait disabled:opacity-40"
                  >{redoing ? '복원 중…' : '↷ 다시 실행'}</button>
                )}
                {phase !== 'idle' && (
                  <button onClick={reset} className="border-b border-[#d85b35] pb-0.5 font-bold text-[#9f4025]">초기화</button>
                )}
                <span className="font-mono-term text-[#aaa59b]">CHOOSE · WRITE · RUN</span>
              </div>
            </div>
            <div className="mb-2 grid grid-cols-3 gap-1.5">
              {INPUT_MODES.map((mode, index) => {
                const active = mode.id === inputMode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    disabled={phase === 'running'}
                    onClick={() => selectInputMode(mode.id)}
                    className={`flex min-w-0 items-center gap-2 border px-2.5 py-1.5 text-left transition ${active ? 'border-[#75492e] bg-[#75492e] text-white' : 'border-[#c5bfb4] bg-[#f8f6f0] text-[#77736a] hover:border-[#8f887d]'} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span className={`grid h-4 w-4 shrink-0 place-items-center font-mono-term text-[8px] ${active ? 'bg-white/15' : 'bg-[#ebe6dc]'}`}>{index + 1}</span>
                    <span className="truncate text-[9.5px] font-black">{mode.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <textarea
                value={pasted}
                onChange={(event) => { setPasted(event.target.value); setInputError(null); }}
                onKeyDown={(event) => {
                  if (inputMode === 'share' && event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitLearningRecord();
                  }
                }}
                readOnly={phase === 'running'}
                aria-label={selectedInputMode.label}
                placeholder={selectedInputMode.placeholder}
                className="light-scroll h-[102px] min-w-0 flex-1 resize-none border border-[#bdb8ad] bg-[#f8f6f0] px-3 py-2.5 text-[12px] leading-relaxed text-[#3c3a36] outline-none placeholder:text-[#aaa59b] focus:border-[#262624] disabled:opacity-60"
              />
              <div className="flex w-[152px] shrink-0 flex-col border border-[#c5bfb4] bg-[#e8e3d9] p-2.5">
                <span className="font-mono-term text-[8px] tracking-wider text-[#8f887d]">{selectedInputMode.label}</span>
                <span className={`mt-1 text-[9px] leading-snug ${inputError ? 'font-bold text-[#9f4025]' : 'text-[#77736a]'}`}>
                  {inputError ?? selectedInputMode.hint}
                </span>
                <button
                  type="button"
                  disabled={phase === 'running' || pasted.trim().length === 0}
                  onClick={submitLearningRecord}
                  className="mt-auto border border-[#262624] bg-[#262624] px-3 py-2 text-[9.5px] font-black text-white transition hover:bg-[#46433d] disabled:cursor-not-allowed disabled:border-[#aaa59b] disabled:bg-[#aaa59b]"
                >
                  <span className="whitespace-nowrap">{phase === 'running' ? '분석 중…' : inputMode === 'share' ? '링크 불러오기 ↗' : '분석 시작 →'}</span>
                </button>
              </div>
            </div>
          </section>
        </main>

        <aside className={`shrink-0 overflow-hidden border-l border-[#262624] transition-all duration-500 ${noteLayout || studyMode ? 'w-0 border-transparent opacity-0' : 'w-[420px] opacity-100'}`}>
          <StreamPanel lines={lines} phase={phase} pipelineSteps={pipelineSteps} />
        </aside>
      </div>
    </div>
  );
}
