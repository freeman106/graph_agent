import { useMemo, useState } from 'react';
import { LECTURE_NOTE_SECTIONS, NOTE_INSERTIONS } from '../lectureNote';
import type { RuntimeEdge, RuntimeNode } from '../view';

interface Props {
  edges: RuntimeEdge[];
  nodes: RuntimeNode[];
  noteContent: Record<string, string>;
  onClose: () => void;
}

interface StudyPlan {
  knownBoundaries: RuntimeNode[];
  ordered: RuntimeNode[];
  prerequisiteIds: Set<string>;
}

function buildStudyPlan(nodes: RuntimeNode[], edges: RuntimeEdge[], goalIds: string[]): StudyPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const prerequisites = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (edge.relation !== 'prerequisite' || !byId.has(edge.from_id) || !byId.has(edge.to_id)) return;
    const current = prerequisites.get(edge.to_id) ?? [];
    current.push(edge.from_id);
    prerequisites.set(edge.to_id, current);
  });
  prerequisites.forEach((ids) => ids.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0)));

  const goals = new Set(goalIds);
  const required = new Set(goalIds);
  const known = new Set<string>();
  const collecting = new Set<string>();

  const collect = (nodeId: string) => {
    if (collecting.has(nodeId)) return;
    collecting.add(nodeId);
    for (const prerequisiteId of prerequisites.get(nodeId) ?? []) {
      const prerequisite = byId.get(prerequisiteId);
      if (!prerequisite) continue;
      if (prerequisite.status !== 'unlearned' && !goals.has(prerequisiteId)) {
        known.add(prerequisiteId);
        continue;
      }
      required.add(prerequisiteId);
      collect(prerequisiteId);
    }
    collecting.delete(nodeId);
  };
  goalIds.forEach(collect);

  const orderedIds: string[] = [];
  const ordered = new Set<string>();
  const ordering = new Set<string>();
  const visit = (nodeId: string) => {
    if (ordered.has(nodeId) || ordering.has(nodeId)) return;
    ordering.add(nodeId);
    for (const prerequisiteId of prerequisites.get(nodeId) ?? []) {
      if (required.has(prerequisiteId)) visit(prerequisiteId);
    }
    ordering.delete(nodeId);
    ordered.add(nodeId);
    orderedIds.push(nodeId);
  };
  goalIds.forEach(visit);

  return {
    knownBoundaries: [...known].map((id) => byId.get(id)).filter((node): node is RuntimeNode => Boolean(node)),
    ordered: orderedIds.map((id) => byId.get(id)).filter((node): node is RuntimeNode => Boolean(node)),
    prerequisiteIds: new Set(orderedIds.filter((id) => !goals.has(id))),
  };
}

function contentForNode(node: RuntimeNode, noteContent: Record<string, string>) {
  if (node.document.trim()) return node.document.trim();

  const lectureParagraphs: string[] = [];
  for (const section of LECTURE_NOTE_SECTIONS) {
    for (const paragraph of section.paragraphs) {
      if (paragraph.nodeId === node.id) lectureParagraphs.push(noteContent[paragraph.id] ?? paragraph.body);
    }
  }
  const insertedParagraphs = NOTE_INSERTIONS.filter((insertion) => insertion.nodeId === node.id)
    .flatMap((insertion) => insertion.paragraphs.map((paragraph, index) => noteContent[index === 0 ? insertion.id : `${insertion.id}-${index + 1}`] ?? paragraph));
  const noteParagraphs = [...lectureParagraphs, ...insertedParagraphs].filter((paragraph) => paragraph.trim());

  return noteParagraphs.length > 0 ? noteParagraphs.join('\n\n') : node.summary;
}

export default function StudyPlanWorkspace({ edges, nodes, noteContent, onClose }: Props) {
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);
  const [generatedGoalIds, setGeneratedGoalIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const unlearnedNodes = useMemo(() => nodes.filter((node) => node.status === 'unlearned'), [nodes]);
  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return unlearnedNodes;
    return unlearnedNodes.filter((node) => [node.name, node.summary, ...node.aliases].some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [query, unlearnedNodes]);
  const plan = useMemo(() => buildStudyPlan(nodes, edges, generatedGoalIds), [edges, generatedGoalIds, nodes]);
  const generatedGoals = new Set(generatedGoalIds);
  const documentCharacters = plan.ordered.reduce((total, node) => total + contentForNode(node, noteContent).length, 0);
  const estimatedMinutes = Math.max(1, Math.ceil(documentCharacters / 500));

  const toggleGoal = (nodeId: string) => {
    setSelectedGoalIds((current) => current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]);
    setGeneratedGoalIds([]);
    setCopied(false);
  };

  const copyDocument = async () => {
    const text = [
      '최소 학습 문서',
      `목표: ${plan.ordered.filter((node) => generatedGoals.has(node.id)).map((node) => node.name).join(', ')}`,
      '',
      ...plan.ordered.flatMap((node, index) => [
        `${String(index + 1).padStart(2, '0')}. ${node.name}${generatedGoals.has(node.id) ? ' [목표]' : ' [선행 개념]'}`,
        contentForNode(node, noteContent),
        '',
      ]),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="study-plan-workspace absolute inset-0 z-50 flex min-h-0 flex-col bg-[#eee9df]">
      <header className="flex h-[68px] shrink-0 items-center border-b border-[#262624] bg-[#f7f5ef] px-6">
        <div>
          <div className="font-mono-term text-[8px] font-black tracking-[0.18em] text-[#9a6a3a]">MINIMUM STUDY PATH</div>
          <h2 className="mt-1 text-[17px] font-black tracking-[-0.025em] text-[#262624]">목표만 배우는 최소 학습 문서</h2>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[9px] text-[#8c877d]">선행 간선만 계산 · LLM 사용 안 함</span>
          <button onClick={onClose} className="border border-[#262624] bg-[#262624] px-3 py-2 text-[9px] font-black text-white hover:bg-[#464640]">지도로 돌아가기</button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        <aside className="light-scroll overflow-y-auto border-r border-[#bdb8ad] bg-[#f5f1e8] p-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] font-black text-[#2f2e2a]">목표 노드 선택</div>
              <div className="mt-1 text-[9px] text-[#8c877d]">미학습 노드만 선택할 수 있습니다.</div>
            </div>
            <span className="font-mono-term text-[10px] font-black text-[#9a5f2f]">{selectedGoalIds.length}</span>
          </div>
          <label className="mt-4 block">
            <span className="sr-only">목표 노드 검색</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="개념 이름 검색" className="w-full rounded-lg border border-[#d0c8ba] bg-white px-3 py-2.5 text-[10px] outline-none placeholder:text-[#aaa39a] focus:border-[#9a6a3a] focus:ring-3 focus:ring-[#dcb985]/25" />
          </label>
          <div className="mt-3 space-y-2">
            {filteredNodes.map((node) => {
              const selected = selectedGoalIds.includes(node.id);
              return (
                <button key={node.id} onClick={() => toggleGoal(node.id)} className={`w-full rounded-xl border p-3 text-left transition-all ${selected ? 'border-[#9a5f2f] bg-[#fffaf0] shadow-[0_5px_14px_rgba(117,73,38,0.12)] ring-2 ring-[#e6c796]/45' : 'border-[#d8d1c6] bg-white/70 hover:border-[#b9aa96] hover:bg-white'}`}>
                  <span className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[9px] font-black ${selected ? 'border-[#9a5f2f] bg-[#9a5f2f] text-white' : 'border-[#aaa39a] bg-white text-transparent'}`}>✓</span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-black text-[#34322e]">{node.name}</span>
                      <span className="mt-1 line-clamp-2 block text-[9px] leading-relaxed text-[#817b72]">{node.summary}</span>
                    </span>
                  </span>
                </button>
              );
            })}
            {filteredNodes.length === 0 && <div className="rounded-xl border border-dashed border-[#c9c1b5] px-3 py-8 text-center text-[9px] text-[#9a958b]">검색 결과가 없습니다.</div>}
          </div>
          <div className="sticky bottom-0 mt-5 border-t border-[#c9c1b5] bg-[#f5f1e8]/95 pt-4 backdrop-blur-sm">
            <button
              disabled={selectedGoalIds.length === 0}
              onClick={() => { setGeneratedGoalIds(selectedGoalIds); setCopied(false); }}
              className="w-full rounded-full bg-[#75492e] px-4 py-3 text-[10px] font-black text-white shadow-[0_7px_16px_rgba(91,55,31,0.2)] transition hover:-translate-y-0.5 hover:bg-[#5f3923] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
            >최소 학습 문서 만들기</button>
          </div>
        </aside>

        <main className="light-scroll overflow-y-auto px-8 py-7">
          {generatedGoalIds.length === 0 ? (
            <div className="mx-auto grid min-h-full max-w-[760px] place-items-center">
              <div className="w-full border-y border-[#bdb8ad] py-16 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[#b99b72] bg-[#fffaf0] font-mono-term text-[16px] font-black text-[#9a5f2f]">→</div>
                <h3 className="mt-5 text-[20px] font-black tracking-[-0.03em] text-[#383631]">과제에 필요한 목표를 고르세요</h3>
                <p className="mx-auto mt-3 max-w-[450px] text-[11px] leading-relaxed text-[#817b72]">이미 배운 개념에서 탐색을 멈추고, 아직 배우지 않은 선행 개념과 목표 노드만 중복 없이 이어 붙입니다.</p>
              </div>
            </div>
          ) : (
            <article className="mx-auto max-w-[820px] border border-[#c9c1b5] bg-[#fbfaf6] shadow-[0_18px_52px_rgba(38,38,36,0.11)]">
              <header className="border-b border-[#c9c1b5] px-10 py-9">
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <div className="font-mono-term text-[8px] font-black tracking-[0.2em] text-[#9a6a3a]">GENERATED LOCALLY</div>
                    <h1 className="mt-3 text-[30px] font-black tracking-[-0.045em] text-[#262624]">최소 학습 문서</h1>
                    <p className="mt-3 text-[10px] leading-relaxed text-[#817b72]">선택한 목표까지 필요한 미학습 선행 개념만 위상 순서로 정리했습니다.</p>
                  </div>
                  <button onClick={() => void copyDocument()} className="shrink-0 rounded-full border border-[#bdb8ad] bg-white px-3 py-2 text-[9px] font-black text-[#5f5b53] hover:border-[#8b552d] hover:text-[#8b552d]">{copied ? '복사됨 ✓' : '문서 전체 복사'}</button>
                </div>
                <div className="mt-7 grid grid-cols-4 border-y border-[#d8d3c9]">
                  {[
                    ['목표', `${generatedGoalIds.length}개`],
                    ['추가 선행', `${plan.prerequisiteIds.size}개`],
                    ['학습량', `${plan.ordered.length}개 노드`],
                    ['예상', `약 ${estimatedMinutes}분`],
                  ].map(([label, value]) => <div key={label} className="border-r border-[#d8d3c9] px-3 py-3 last:border-r-0"><div className="text-[8px] font-black tracking-wider text-[#9a958b]">{label}</div><div className="mt-1 text-[12px] font-black text-[#3c3a36]">{value}</div></div>)}
                </div>
                {plan.knownBoundaries.length > 0 && <div className="mt-4 rounded-lg bg-[#f0ede5] px-3 py-2 text-[9px] leading-relaxed text-[#77736a]"><strong className="text-[#4e4a43]">이미 학습하여 제외:</strong> {plan.knownBoundaries.map((node) => node.name).join(' · ')}</div>}
              </header>

              <div className="px-10 py-4">
                {plan.ordered.map((node, index) => {
                  const isGoal = generatedGoals.has(node.id);
                  const paragraphs = contentForNode(node, noteContent).split(/\n\s*\n/).filter(Boolean);
                  return (
                    <section key={node.id} className="border-b border-[#ddd8ce] py-9 last:border-b-0">
                      <div className="flex items-start gap-4">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono-term text-[10px] font-black ${isGoal ? 'bg-[#8b552d] text-white' : 'border border-[#9aaec1] bg-[#f5f8fa] text-[#255c99]'}`}>{String(index + 1).padStart(2, '0')}</span>
                        <div className="min-w-0 flex-1">
                          <div className={`text-[8px] font-black tracking-[0.15em] ${isGoal ? 'text-[#9a5f2f]' : 'text-[#255c99]'}`}>{isGoal ? 'TARGET CONCEPT' : 'PREREQUISITE'}</div>
                          <h2 className="mt-1.5 text-[21px] font-black tracking-[-0.025em] text-[#2f2e2a]">{node.name}</h2>
                          <p className="mt-2 text-[10px] font-bold leading-relaxed text-[#817b72]">{node.summary}</p>
                          <div className="mt-5 space-y-4 border-l-2 border-[#d8d3c9] pl-5">
                            {paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex} className="text-[13px] leading-[1.95] text-[#504d47]">{paragraph}</p>)}
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            </article>
          )}
        </main>
      </div>
    </section>
  );
}
