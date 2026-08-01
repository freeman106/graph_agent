import { useEffect, useMemo, useRef, useState } from 'react';
import { LECTURE_NOTE_META, LECTURE_NOTE_SECTIONS } from '../lectureNote';
import type { RuntimeNode, RuntimeNoteComment } from '../view';

interface Props {
  activeAnchorId: string;
  annotationsVisible: boolean;
  comments: RuntimeNoteComment[];
  nodes: RuntimeNode[];
  onClose: () => void;
  onCreateComment: (comment: RuntimeNoteComment, sourceText: string) => void;
  onNavigate: (nodeId: string, anchorId: string) => void;
}

interface SelectionDraft {
  anchorId: string;
  nodeId: string;
  quote: string;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function NoteWorkspace({
  activeAnchorId,
  annotationsVisible,
  comments,
  nodes,
  onClose,
  onCreateComment,
  onNavigate,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const commentCardRefs = useRef(new Map<string, HTMLElement>());
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [composerMode, setComposerMode] = useState<'question' | 'conversation'>('question');
  const [composerText, setComposerText] = useState('');

  const visibleComments = useMemo(
    () => comments.filter((comment) => annotationsVisible || !comment.revealOnRun),
    [annotationsVisible, comments],
  );
  const orphanComments = visibleComments.filter((comment) => comment.anchorId === null);

  const scrollToAnchor = (anchorId: string) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(anchorId)}`);
    target?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => scrollToAnchor(activeAnchorId), 180);
    return () => window.clearTimeout(timer);
  }, [activeAnchorId]);

  useEffect(() => {
    if (!selectionDraft) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectionDraft(null);
        setComposerText('');
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectionDraft]);

  const focusComment = (comment: RuntimeNoteComment) => {
    setActiveCommentId(comment.id);
    if (comment.anchorId) {
      onNavigate(comment.nodeId, comment.anchorId);
      scrollToAnchor(comment.anchorId);
    }
    window.requestAnimationFrame(() => {
      const card = commentCardRefs.current.get(comment.id);
      card?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
      card?.focus({ preventScroll: true });
    });
  };

  const renderHighlightedText = (body: string, paragraphId: string) => {
    const ranges: Array<{ start: number; end: number; comment: RuntimeNoteComment }> = visibleComments
      .filter((comment) => comment.anchorId === paragraphId && comment.quote)
      .map((comment) => {
        const start = body.indexOf(comment.quote!);
        return { start, end: start + (comment.quote?.length ?? 0), comment };
      })
      .filter((range) => range.start >= 0)
      .sort((a, b) => a.start - b.start || Number(Boolean(b.comment.createdNow)) - Number(Boolean(a.comment.createdNow)));

    if (ranges.length === 0) return body;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      if (range.start > cursor) parts.push(body.slice(cursor, range.start));
      const active = activeCommentId === range.comment.id;
      parts.push(
        <mark
          key={range.comment.id}
          role="button"
          tabIndex={0}
          aria-label={`${range.comment.title} 코멘트 보기`}
          className={`note-highlight cursor-pointer rounded-sm outline-none focus:ring-2 focus:ring-[#255c99] ${active ? 'note-highlight-active' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            focusComment(range.comment);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              focusComment(range.comment);
            }
          }}
        >
          {body.slice(range.start, range.end)}
        </mark>,
      );
      cursor = range.end;
    }
    if (cursor < body.length) parts.push(body.slice(cursor));
    return parts;
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const quote = selection.toString().replace(/\s+/g, ' ').trim();
    if (quote.length < 2) return;

    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
    const startParagraph = startElement?.closest<HTMLElement>('[data-note-paragraph]');
    const endParagraph = endElement?.closest<HTMLElement>('[data-note-paragraph]');
    if (!startParagraph || startParagraph !== endParagraph || !articleRef.current?.contains(startParagraph)) return;

    const nodeId = startParagraph.dataset.nodeId;
    if (!nodeId) return;
    setSelectionDraft({ anchorId: startParagraph.id, nodeId, quote: quote.slice(0, 320) });
    setComposerMode('question');
    setComposerText('');
  };

  const handleParagraphDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    const paragraph = (event.target as HTMLElement).closest<HTMLElement>('[data-note-paragraph]');
    if (!paragraph || !articleRef.current?.contains(paragraph)) return;
    const nodeId = paragraph.dataset.nodeId;
    if (!nodeId) return;
    const quote = (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (quote.length < 2) return;
    setSelectionDraft({ anchorId: paragraph.id, nodeId, quote: quote.slice(0, 320) });
    setComposerMode('question');
    setComposerText('');
  };

  const submitComment = () => {
    if (!selectionDraft || composerText.trim().length < 2) return;
    const node = nodes.find((candidate) => candidate.id === selectionDraft.nodeId);
    const cleanInput = composerText.trim();
    const id = `comment-note-${Date.now()}`;
    const isQuestion = composerMode === 'question';
    const comment: RuntimeNoteComment = {
      id,
      anchorId: selectionDraft.anchorId,
      quote: selectionDraft.quote,
      nodeId: selectionDraft.nodeId,
      kind: isQuestion ? 'question' : 'conversation',
      title: isQuestion ? '선택한 내용에 직접 질문' : 'GPT 대화에서 가져온 코멘트',
      body: isQuestion
        ? `질문: ${cleanInput} · GPT 답변: ${node?.summary ?? '선택한 문장은 이 개념의 핵심 관계를 설명하는 부분입니다.'} 이 답을 이해했다면 ${node?.name ?? '해당 개념'} 노드의 막힌 지점 체크리스트에서 완료할 수 있습니다.`
        : `붙여넣은 대화에서 이 문장과 관련된 학습 맥락을 추가했습니다: ${cleanInput.slice(0, 220)}${cleanInput.length > 220 ? '…' : ''}`,
      source: isQuestion ? '노트에서 직접 질문 · 방금' : '붙여넣은 GPT 대화 · 방금',
      relatedNodeId: null,
      relatedAnchorId: null,
      revealOnRun: false,
      createdNow: true,
    };
    onCreateComment(comment, cleanInput);
    setActiveCommentId(id);
    setSelectionDraft(null);
    setComposerText('');
    window.getSelection()?.removeAllRanges();
    window.requestAnimationFrame(() => {
      commentCardRefs.current.get(id)?.focus({ preventScroll: false });
    });
  };

  return (
    <section className="note-workspace absolute inset-0 z-10 flex min-h-0 flex-col bg-[#ede9df]">
      <header className="flex h-[62px] shrink-0 items-center border-b border-[#bdb8ad] bg-[#f7f5ef] pl-[382px] pr-5">
        <div className="min-w-0">
          <div className="text-[9px] font-black tracking-[0.18em] text-[#8c877d]">LECTURE NOTE / SINGLE DOCUMENT</div>
          <h2 className="mt-1 truncate text-[15px] font-black tracking-[-0.02em] text-[#262624]">{LECTURE_NOTE_META.title}</h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="border border-[#bdb8ad] px-2 py-1 font-mono-term text-[9px] text-[#77736a]">더블클릭/드래그해서 질문하기</span>
          <button onClick={onClose} className="border border-[#262624] bg-[#262624] px-3 py-2 text-[10px] font-black text-[#f7f5ef] transition hover:bg-[#464640]">지도로 돌아가기</button>
        </div>
      </header>

      <div ref={scrollRef} className="note-scroll light-scroll min-h-0 flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto grid w-full max-w-[1320px] grid-cols-[190px_minmax(520px,720px)_300px] items-start gap-7 px-7 pt-8 pb-32">
          <nav className={`sticky top-6 mt-[210px] border-t border-[#262624] transition-opacity ${outlineOpen ? 'opacity-100' : 'opacity-70'}`} aria-label="강의노트 목차">
            <button onClick={() => setOutlineOpen((value) => !value)} className="flex w-full items-center justify-between py-3 text-left text-[9px] font-black tracking-[0.16em] text-[#77736a]">
              <span>DOCUMENT OUTLINE</span><span>{outlineOpen ? '−' : '+'}</span>
            </button>
            {outlineOpen && <div className="border-t border-[#d3cec4] py-2">
              {LECTURE_NOTE_SECTIONS.map((section, index) => (
                <button key={section.id} onClick={() => scrollToAnchor(section.id)} className="group flex w-full gap-2 border-l border-transparent px-2 py-1.5 text-left hover:border-[#255c99]">
                  <span className="font-mono-term text-[8px] text-[#aaa59b]">{String(index + 1).padStart(2, '0')}</span>
                  <span className="text-[10px] leading-snug font-bold text-[#77736a] group-hover:text-[#255c99]">{section.title}</span>
                </button>
              ))}
            </div>}
          </nav>

          <article ref={articleRef} onMouseUp={handleTextSelection} onDoubleClick={handleParagraphDoubleClick} className="note-paper border border-[#c9c4ba] bg-[#fbfaf6] shadow-[0_16px_48px_rgba(38,38,36,0.10)]">
            <div className="border-b border-[#d8d3c9] px-12 pt-12 pb-10">
              <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.16em] text-[#8c877d]"><span>{LECTURE_NOTE_META.course}</span><span>·</span><span>{LECTURE_NOTE_META.updatedAt}</span></div>
              <h1 className="mt-5 max-w-[560px] text-[36px] leading-[1.12] font-black tracking-[-0.055em] text-[#262624]">{LECTURE_NOTE_META.title}</h1>
              <p className="mt-5 max-w-[570px] text-[13px] leading-[1.8] text-[#666259]">토큰에서 디코딩까지, Transformer의 계산 흐름을 하나의 문서와 하나의 지식 지도로 함께 읽습니다. 대화에서 확인하거나 정정한 부분은 본문 위에 표시되고, 오른쪽 코멘트로 근거가 연결됩니다.</p>
              <div className="mt-8 flex items-center gap-3 border-t border-[#d8d3c9] pt-4 text-[10px] text-[#8c877d]"><span>{LECTURE_NOTE_META.author}</span><span>·</span><span>이 노트에서 초기 개념 {LECTURE_NOTE_META.initialConcepts}개 추출</span></div>
            </div>

            <div className="px-12 py-4">
              {LECTURE_NOTE_SECTIONS.map((section) => (
                <section key={section.id} id={section.id} className="scroll-mt-8 border-b border-[#ddd8ce] py-10 last:border-b-0">
                  <div className="mb-5 font-mono-term text-[9px] font-black tracking-[0.14em] text-[#255c99]">{section.eyebrow}</div>
                  <h2 className="mb-6 text-[25px] leading-tight font-black tracking-[-0.035em] text-[#2d2c29]">{section.title}</h2>
                  <div className="space-y-5">
                    {section.paragraphs.map((paragraph) => {
                      const active = activeAnchorId === paragraph.id;
                      return (
                        <p
                          key={paragraph.id}
                          id={paragraph.id}
                          data-note-paragraph
                          data-node-id={paragraph.nodeId}
                          onClick={() => {
                            if (window.getSelection()?.toString().trim()) return;
                            onNavigate(paragraph.nodeId, paragraph.id);
                            scrollToAnchor(paragraph.id);
                          }}
                          className={`cursor-pointer scroll-mt-28 border-l-2 py-0.5 pl-4 text-[14px] leading-[2.05] text-[#4e4b45] transition-colors ${active ? 'border-[#255c99] bg-[#eef3f8]' : 'border-transparent hover:border-[#9fb5ca] hover:bg-[#f4f7f9]'}`}
                        >
                          {renderHighlightedText(paragraph.body, paragraph.id)}
                        </p>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </article>

          <aside className="min-h-full pt-[170px]" aria-label="대화 코멘트">
            <div className="light-scroll sticky top-6 max-h-[calc(100vh-110px)] overflow-y-auto pr-1 pb-6">
              <div className="mb-3 flex items-center justify-between border-b border-[#262624] pb-2">
                <span className="text-[9px] font-black tracking-[0.16em] text-[#77736a]">CONVERSATION COMMENTS</span>
                <span className="font-mono-term text-[9px] text-[#255c99]">{visibleComments.length}</span>
              </div>

              {selectionDraft && (
                <section role="dialog" aria-label="선택한 노트 내용에 질문 추가" className="mb-4 border border-[#255c99] bg-[#eef3f8] p-4 shadow-[5px_5px_0_rgba(37,92,153,0.12)]">
                  <div className="text-[9px] font-black tracking-[0.14em] text-[#255c99]">선택한 내용</div>
                  <blockquote className="mt-2 line-clamp-4 border-l-2 border-[#255c99] pl-3 text-[10.5px] leading-relaxed text-[#4b5f72]">“{selectionDraft.quote}”</blockquote>
                  <div className="mt-3 grid grid-cols-2 border border-[#aebdcb] bg-[#f7f9fb] p-[2px]">
                    <button onClick={() => setComposerMode('question')} className={`px-2 py-1.5 text-[9px] font-black ${composerMode === 'question' ? 'bg-[#255c99] text-white' : 'text-[#66788a]'}`}>직접 질문하기</button>
                    <button onClick={() => setComposerMode('conversation')} className={`px-2 py-1.5 text-[9px] font-black ${composerMode === 'conversation' ? 'bg-[#255c99] text-white' : 'text-[#66788a]'}`}>GPT 대화 붙이기</button>
                  </div>
                  <label className="mt-3 block text-[9px] font-black text-[#66788a]" htmlFor="note-comment-input">{composerMode === 'question' ? '이 부분에서 궁금한 점' : '이 부분과 관련된 대화 내용'}</label>
                  <textarea
                    id="note-comment-input"
                    autoFocus
                    value={composerText}
                    onChange={(event) => setComposerText(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitComment();
                    }}
                    placeholder={composerMode === 'question' ? '왜 이 값은 다시 계산하지 않나요?' : 'GPT와 나눈 대화를 붙여넣으세요…'}
                    className="mt-1.5 h-24 w-full resize-none border border-[#aebdcb] bg-white p-2.5 text-[11px] leading-relaxed text-[#3c4d5e] outline-none focus:border-[#255c99]"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <button onClick={() => { setSelectionDraft(null); setComposerText(''); }} className="text-[9px] font-black text-[#8c877d]">취소</button>
                    <button disabled={composerText.trim().length < 2} onClick={submitComment} className="bg-[#255c99] px-3 py-2 text-[9px] font-black text-white disabled:cursor-not-allowed disabled:opacity-35">코멘트와 노드에 반영</button>
                  </div>
                </section>
              )}

              {!annotationsVisible && visibleComments.length === 0 && !selectionDraft && (
                <div className="border border-dashed border-[#aaa59b] bg-[#f4f0e7] p-4 text-[11px] leading-relaxed text-[#77736a]">대화를 첨부하거나 노트 문장을 드래그하면 관련 코멘트가 이곳에 쌓입니다.</div>
              )}

              <div className="space-y-3">
                {visibleComments.filter((comment) => comment.anchorId !== null).map((comment) => {
                  const node = nodes.find((candidate) => candidate.id === comment.nodeId);
                  const active = activeCommentId === comment.id;
                  return (
                    <article
                      key={comment.id}
                      id={`comment-card-${comment.id}`}
                      ref={(element) => { if (element) commentCardRefs.current.set(comment.id, element); else commentCardRefs.current.delete(comment.id); }}
                      tabIndex={-1}
                      className={`comment-card relative border bg-[#f8f6f0] p-4 shadow-[5px_5px_0_rgba(38,38,36,0.07)] outline-none transition ${active ? 'translate-x-[-4px] border-[#255c99] ring-2 ring-[#255c99]/15' : 'border-[#bdb8ad]'} ${comment.createdNow ? 'comment-pop' : ''}`}
                    >
                      <button onClick={() => focusComment(comment)} className="w-full text-left">
                        <div className="flex items-start gap-2">
                          <span className={`grid h-5 w-5 shrink-0 place-items-center text-[9px] font-black text-white ${comment.createdNow ? 'bg-[#d85b35]' : 'bg-[#255c99]'}`}>{comment.createdNow ? '나' : 'AI'}</span>
                          <div className="min-w-0"><div className="text-[11px] font-black text-[#2f2e2a]">{comment.title}</div><div className="mt-0.5 truncate font-mono-term text-[8.5px] text-[#8c877d]">{node?.name ?? comment.nodeId} · {comment.source}</div></div>
                        </div>
                        <p className="mt-3 text-[11px] leading-[1.65] text-[#5f5b53]">{comment.body}</p>
                      </button>
                      {comment.relatedNodeId && comment.relatedAnchorId && (
                        <button onClick={() => { onNavigate(comment.relatedNodeId!, comment.relatedAnchorId!); scrollToAnchor(comment.relatedAnchorId!); }} className="mt-3 flex w-full items-center border-t border-[#d8d3c9] pt-3 text-left text-[9.5px] font-black text-[#255c99] hover:text-[#173f6d]">관련 내용으로 이동 <span className="ml-auto">→</span></button>
                      )}
                    </article>
                  );
                })}
              </div>

              {orphanComments.length > 0 && (
                <div className="mt-6">
                  <div className="mb-2 text-[8.5px] font-black tracking-[0.14em] text-[#9f4025]">노트에서 일치하는 문장 없음</div>
                  {orphanComments.map((comment) => (
                    <article key={comment.id} className="border border-[#d8a08d] bg-[#fff4ef] p-4">
                      <div className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center bg-[#d85b35] text-[10px] font-black text-white">!</span><div className="text-[11px] font-black text-[#5f3428]">{comment.title}</div></div>
                      <p className="mt-3 text-[11px] leading-[1.65] text-[#76574e]">{comment.body}</p>
                      {comment.relatedNodeId && comment.relatedAnchorId && <button onClick={() => { onNavigate(comment.relatedNodeId!, comment.relatedAnchorId!); scrollToAnchor(comment.relatedAnchorId!); }} className="mt-3 flex w-full items-center border-t border-[#e5c5b9] pt-3 text-left text-[9.5px] font-black text-[#9f4025]">그래프 연결과 가장 가까운 노트 보기 <span className="ml-auto">→</span></button>}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
