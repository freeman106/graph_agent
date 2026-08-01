import { useEffect, useMemo, useRef, useState } from 'react';
import { RELATION_LABEL } from '../../contract/schema';
import { anchorForNode as defaultAnchorForNode, LECTURE_NOTE_MAJOR_SECTIONS as DEFAULT_MAJORS, LECTURE_NOTE_META as DEFAULT_META, LECTURE_NOTE_SECTIONS as DEFAULT_SECTIONS, NOTE_INSERTIONS as DEFAULT_INSERTIONS } from '../lectureNote';
import { askNoteQuestion } from '../agentApi';
import type { NoteBundle } from '../graphNote';
import type { RuntimeEdge, RuntimeNode, RuntimeNoteComment } from '../view';

interface Props {
  activeAnchorId: string;
  annotationsVisible: boolean;
  comments: RuntimeNoteComment[];
  edges: RuntimeEdge[];
  navigationVersion: number;
  noteContent: Record<string, string>;
  nodes: RuntimeNode[];
  onClose: () => void;
  onArchiveComment: (commentId: string, archived: boolean) => void;
  onCreateComment: (comment: RuntimeNoteComment, sourceText: string) => void;
  onDeleteComment: (commentId: string) => void;
  onNavigate: (nodeId: string, anchorId: string) => void;
  onToggleCommentHighlight: (commentId: string, highlighted: boolean) => void;
  onUpdateComment: (commentId: string, title: string, body: string) => void;
  onUpdateNoteContent: (paragraphId: string, body: string) => void;
  /** 강의안에서 만들어진 실제 문서. 없으면 기존 목 노트를 그린다. */
  bundle?: NoteBundle | null;
}

interface SelectionDraft {
  anchorId: string;
  nodeId: string;
  quote: string;
  start: number;
  end: number;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function quoteRange(body: string, quote: string): { start: number; end: number } | null {
  const exactStart = body.indexOf(quote);
  if (exactStart >= 0) return { start: exactStart, end: exactStart + quote.length };

  const normalizedChars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (/\s/.test(character)) {
      if (normalizedChars.length === 0 || normalizedChars.at(-1) === ' ') continue;
      normalizedChars.push(' ');
      starts.push(index);
      ends.push(index + 1);
    } else {
      normalizedChars.push(character);
      starts.push(index);
      ends.push(index + 1);
    }
  }
  while (normalizedChars.at(-1) === ' ') {
    normalizedChars.pop();
    starts.pop();
    ends.pop();
  }

  const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
  if (!normalizedQuote) return null;
  const normalizedStart = normalizedChars.join('').indexOf(normalizedQuote);
  if (normalizedStart < 0) return null;
  const lastIndex = normalizedStart + normalizedQuote.length - 1;
  return { start: starts[normalizedStart], end: ends[lastIndex] };
}

export default function NoteWorkspace({
  activeAnchorId,
  annotationsVisible,
  comments,
  edges,
  navigationVersion,
  noteContent,
  nodes,
  onClose,
  onArchiveComment,
  onCreateComment,
  onDeleteComment,
  onNavigate,
  onToggleCommentHighlight,
  onUpdateComment,
  onUpdateNoteContent,
  bundle = null,
}: Props) {
  // 실제 강의안 문서가 있으면 그걸 그리고, 없으면 기존 목 노트를 그대로 그린다.
  const LECTURE_NOTE_META = bundle?.meta ?? DEFAULT_META;
  const LECTURE_NOTE_MAJOR_SECTIONS = bundle?.majorSections ?? DEFAULT_MAJORS;
  const LECTURE_NOTE_SECTIONS = bundle?.sections ?? DEFAULT_SECTIONS;
  const NOTE_INSERTIONS = bundle?.insertions ?? DEFAULT_INSERTIONS;
  const anchorForNode = (nodeId: string) =>
    bundle ? (bundle.anchorOf[nodeId] ?? '') : defaultAnchorForNode(nodeId);
  const activeNodeId = useMemo(() => {
    for (const section of LECTURE_NOTE_SECTIONS) {
      const paragraph = section.paragraphs.find((candidate) => candidate.id === activeAnchorId);
      if (paragraph) return paragraph.nodeId;
    }
    for (const insertion of NOTE_INSERTIONS) {
      if (activeAnchorId === insertion.id || activeAnchorId.startsWith(`${insertion.id}-`)) return insertion.nodeId;
    }
    return null;
  }, [activeAnchorId, LECTURE_NOTE_SECTIONS, NOTE_INSERTIONS]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const commentCardRefs = useRef(new Map<string, HTMLElement>());
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [composerMode, setComposerMode] = useState<'question' | 'conversation' | 'highlight'>('question');
  const [composerText, setComposerText] = useState('');
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [expandedInsertions, setExpandedInsertions] = useState<Set<string>>(() => new Set());
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentTitle, setEditingCommentTitle] = useState('');
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [openRelatedCommentId, setOpenRelatedCommentId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const visibleComments = useMemo(
    () => comments.filter((comment) => !comment.archived && (annotationsVisible || !comment.revealOnRun)),
    [annotationsVisible, comments],
  );
  const archivedComments = useMemo(
    () => comments.filter((comment) => comment.archived && (annotationsVisible || !comment.revealOnRun)),
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
    const isInsertion = NOTE_INSERTIONS.some((insertion) => insertion.id === activeAnchorId);
    if (isInsertion) {
      setExpandedInsertions((previous) => {
        const next = new Set(previous);
        next.add(activeAnchorId);
        return next;
      });
    }
    const timer = window.setTimeout(() => scrollToAnchor(activeAnchorId), isInsertion ? 520 : 180);
    return () => window.clearTimeout(timer);
  }, [activeAnchorId, navigationVersion]);

  useEffect(() => {
    if (!selectionDraft) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectionDraft(null);
        setComposerText('');
        window.getSelection()?.removeAllRanges();
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
    const ranges: Array<{ start: number; end: number; comment: RuntimeNoteComment | null; key: string; pending: boolean }> = visibleComments
      .filter((comment) => comment.highlighted !== false && comment.anchorId === paragraphId && comment.quote)
      .map((comment) => {
        const found = comment.start === undefined || comment.end === undefined
          ? quoteRange(body, comment.quote!)
          : { start: comment.start, end: comment.end };
        return { start: found?.start ?? -1, end: found?.end ?? -1, comment, key: comment.id, pending: false };
      })
      .filter((range) => range.start >= 0)
      .sort((a, b) => a.start - b.start || Number(Boolean(b.comment?.createdNow)) - Number(Boolean(a.comment?.createdNow)));

    if (selectionDraft?.anchorId === paragraphId) {
      ranges.push({
        start: Math.max(0, Math.min(selectionDraft.start, body.length)),
        end: Math.max(0, Math.min(selectionDraft.end, body.length)),
        comment: null,
        key: 'pending-selection',
        pending: true,
      });
      ranges.sort((a, b) => a.start - b.start || Number(b.pending) - Number(a.pending));
    }

    if (ranges.length === 0) return body;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      if (range.start > cursor) parts.push(body.slice(cursor, range.start));
      const active = range.comment !== null && activeCommentId === range.comment.id;
      if (range.pending) {
        parts.push(<mark key={range.key} className="note-selection-pending">{body.slice(range.start, range.end)}</mark>);
        cursor = range.end;
        continue;
      }
      if (!range.comment) continue;
      const comment = range.comment;
      parts.push(
        <mark
          key={range.key}
          role="button"
          tabIndex={0}
          aria-label={`${comment.title} 코멘트 보기`}
          className={`note-highlight cursor-pointer rounded-sm outline-none focus:ring-2 focus:ring-[#255c99] ${active ? 'note-highlight-active' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            focusComment(comment);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              focusComment(comment);
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
    if (isEditingNote) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const rawQuote = selection.toString();
    const quote = rawQuote.replace(/\s+/g, ' ').trim();
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
    const beforeSelection = document.createRange();
    beforeSelection.selectNodeContents(startParagraph);
    beforeSelection.setEnd(range.startContainer, range.startOffset);
    const start = beforeSelection.toString().length;
    setSelectionDraft({ anchorId: startParagraph.id, nodeId, quote, start, end: start + rawQuote.length });
    setComposerMode('question');
    setComposerText('');
    setQuestionError(null);
  };

  const submitComment = async () => {
    if (!selectionDraft || (composerMode !== 'highlight' && composerText.trim().length < 2)) return;
    const node = nodes.find((candidate) => candidate.id === selectionDraft.nodeId);
    const cleanInput = composerText.trim();
    const isQuestion = composerMode === 'question';
    const isHighlight = composerMode === 'highlight';
    let answer = '';
    if (isQuestion) {
      setQuestionLoading(true);
      setQuestionError(null);
      try {
        const result = await askNoteQuestion({
          question: cleanInput,
          quote: selectionDraft.quote,
          nodeName: node?.name ?? selectionDraft.nodeId,
          document: node?.document.trim() || node?.summary || '',
        });
        answer = result.answer;
      } catch (error) {
        setQuestionError(error instanceof Error ? error.message : 'GPT 답변을 받지 못했습니다.');
        return;
      } finally {
        setQuestionLoading(false);
      }
    }

    const id = `comment-note-${Date.now()}`;
    const comment: RuntimeNoteComment = {
      id,
      anchorId: selectionDraft.anchorId,
      quote: selectionDraft.quote,
      nodeId: selectionDraft.nodeId,
      title: isHighlight ? '내 하이라이트' : isQuestion ? '선택한 내용에 직접 질문' : 'GPT 대화에서 가져온 코멘트',
      body: isHighlight
        ? cleanInput || '개인 하이라이트'
        : isQuestion
        ? `질문: ${cleanInput}\n\n답변: ${answer}`
        : `붙여넣은 대화에서 이 문장과 관련된 학습 맥락을 추가했습니다: ${cleanInput.slice(0, 220)}${cleanInput.length > 220 ? '…' : ''}`,
      source: isHighlight ? '직접 표시 · 방금' : isQuestion ? '노트에서 직접 질문 · 방금' : '붙여넣은 GPT 대화 · 방금',
      relatedNodeId: null,
      relatedAnchorId: null,
      revealOnRun: false,
      kind: isHighlight ? 'highlight' : isQuestion ? 'question' : 'conversation',
      highlighted: true,
      start: selectionDraft.start,
      end: selectionDraft.end,
      createdNow: true,
    };
    onCreateComment(comment, cleanInput || selectionDraft.quote);
    setActiveCommentId(id);
    setSelectionDraft(null);
    setComposerText('');
    setQuestionError(null);
    window.getSelection()?.removeAllRanges();
    window.requestAnimationFrame(() => {
      commentCardRefs.current.get(id)?.focus({ preventScroll: false });
    });
  };

  const relatedTargetsFor = (comment: RuntimeNoteComment) => {
    const targets: Array<{ nodeId: string; anchorId: string; label: string; relation: string }> = [];
    const seen = new Set<string>();
    const add = (nodeId: string, anchorId: string, label: string, relation: string) => {
      if (anchorId === comment.anchorId || seen.has(anchorId)) return;
      seen.add(anchorId);
      targets.push({ nodeId, anchorId, label, relation });
    };
    if (comment.relatedNodeId && comment.relatedAnchorId) {
      add(
        comment.relatedNodeId,
        comment.relatedAnchorId,
        nodes.find((node) => node.id === comment.relatedNodeId)?.name ?? comment.relatedNodeId,
        '코멘트에 지정된 관련 내용',
      );
    }
    edges
      .filter((edge) => edge.from_id === comment.nodeId || edge.to_id === comment.nodeId)
      .forEach((edge) => {
        const nodeId = edge.from_id === comment.nodeId ? edge.to_id : edge.from_id;
        const node = nodes.find((candidate) => candidate.id === nodeId);
        if (node) add(nodeId, anchorForNode(nodeId), node.name, RELATION_LABEL[edge.relation]);
      });
    return targets.slice(0, 5);
  };

  const renderInsertion = (insertion: (typeof NOTE_INSERTIONS)[number]) => {
    if (!annotationsVisible || !nodes.some((node) => node.id === insertion.nodeId)) return null;
    const expanded = expandedInsertions.has(insertion.id);
    return (
      <section key={insertion.id} className={`my-7 overflow-hidden transition-colors ${expanded ? 'bg-[#fffaf1]' : 'bg-transparent'}`}>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpandedInsertions((previous) => {
              const next = new Set(previous);
              if (expanded) next.delete(insertion.id);
              else next.add(insertion.id);
              return next;
            });
            if (!expanded) {
              onNavigate(insertion.nodeId, insertion.id);
              window.setTimeout(() => scrollToAnchor(insertion.id), 120);
            }
          }}
          className="w-full py-2 text-left"
        >
          <span className="flex w-full items-center gap-2">
            <span className="h-px min-w-5 flex-1 bg-[#cbb28e]" />
            <span className="font-mono-term text-[8px] font-black tracking-[0.1em] text-[#9b5a2b]">대화 보충</span>
            {insertion.tags.map((tag) => <span key={tag} className="rounded-full border border-[#d7b98e] bg-[#fffaf1] px-1.5 py-0.5 text-[7.5px] font-black text-[#8a5b32]">{tag}</span>)}
            <span className={`ml-1 text-[14px] text-[#9b5a2b] transition-transform duration-500 ${expanded ? 'rotate-180' : ''}`}>⌄</span>
            <span className="h-px min-w-5 flex-1 bg-[#cbb28e]" />
          </span>
          <span className={`grid transition-[grid-template-rows,opacity] duration-500 ${expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
            <span className="overflow-hidden px-6">
              <span className="block font-mono-term text-[8.5px] font-black tracking-[0.13em] text-[#9b5a2b]">{insertion.eyebrow}</span>
              <span className="mt-1.5 block text-[15px] font-black leading-snug text-[#3f342b]">{insertion.title}</span>
            </span>
          </span>
        </button>
        <div className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.22,.8,.25,1)] ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="border-y border-[#e3cfb1] px-6 py-5">
              <div className="space-y-4">
                {insertion.paragraphs.map((paragraph, index) => {
                  const paragraphId = index === 0 ? insertion.id : `${insertion.id}-${index + 1}`;
                  const body = noteContent[paragraphId] ?? paragraph;
                  if (isEditingNote) {
                    return (
                      <textarea
                        key={`edit-${paragraphId}`}
                        defaultValue={body}
                        rows={Math.max(4, Math.ceil(body.length / 48))}
                        onBlur={(event) => onUpdateNoteContent(paragraphId, event.currentTarget.value)}
                        className="w-full resize-y border border-[#d7c4a7] bg-[#fffdf8] p-4 text-[13px] leading-[1.9] text-[#584d43] outline-none focus:border-[#a65f2b]"
                        aria-label={`${insertion.title} 문단 편집`}
                      />
                    );
                  }
                  return (
                    <p
                      key={paragraphId}
                      id={paragraphId}
                      data-note-paragraph
                      data-node-id={insertion.nodeId}
                      onClick={() => {
                        if (window.getSelection()?.toString().trim()) return;
                        onNavigate(insertion.nodeId, insertion.id);
                      }}
                      className={`cursor-pointer scroll-mt-28 whitespace-pre-line border-l-2 py-0.5 pl-4 text-[13px] leading-[1.95] text-[#584d43] transition-colors ${activeNodeId === insertion.nodeId ? 'border-[#255c99] bg-[#eef3f8]' : 'border-transparent hover:border-[#cf9a68]'}`}
                    >
                      {renderHighlightedText(body, paragraphId)}
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <section className="note-workspace absolute inset-0 z-10 flex min-h-0 flex-col bg-[#ede9df]">
      <header className="flex h-[62px] shrink-0 items-center border-b border-[#bdb8ad] bg-[#f7f5ef] pl-[382px] pr-5">
        <div className="min-w-0">
          <div className="text-[9px] font-black tracking-[0.18em] text-[#8c877d]">강의노트</div>
          <h2 className="mt-1 truncate text-[15px] font-black tracking-[-0.02em] text-[#262624]">{LECTURE_NOTE_META.title}</h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-2 border border-[#d5bd91] bg-[#fff9ec] px-2.5 py-1.5 text-[9px] font-bold text-[#705a3e]"><i className="h-2.5 w-5 bg-[#f4cf73]" /> 노란색 = 대화·질문이 연결된 원문</span>
          <button
            onClick={() => {
              setIsEditingNote((value) => !value);
              setSelectionDraft(null);
              setComposerText('');
              window.getSelection()?.removeAllRanges();
            }}
            className={`border px-3 py-2 text-[9px] font-black transition ${isEditingNote ? 'border-[#8b552d] bg-[#fff4e8] text-[#8b552d]' : 'border-[#bdb8ad] text-[#666259] hover:border-[#7b766d]'}`}
          >
            {isEditingNote ? '편집 완료' : '노트 편집'}
          </button>
          <button onClick={onClose} className="border border-[#262624] bg-[#262624] px-3 py-2 text-[10px] font-black text-[#f7f5ef] transition hover:bg-[#464640]">지도로 돌아가기</button>
        </div>
      </header>

      <div ref={scrollRef} className="note-scroll light-scroll min-h-0 flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto grid w-full max-w-[1320px] grid-cols-[190px_minmax(520px,720px)_300px] items-start gap-7 px-7 pt-8 pb-32">
          <nav className={`sticky top-[206px] mt-[210px] border-t border-[#262624] transition-opacity ${outlineOpen ? 'opacity-100' : 'opacity-70'}`} aria-label="강의노트 목차">
            <button onClick={() => setOutlineOpen((value) => !value)} className="flex w-full items-center justify-between py-3 text-left text-[9px] font-black tracking-[0.16em] text-[#77736a]">
              <span>DOCUMENT OUTLINE</span><span>{outlineOpen ? '−' : '+'}</span>
            </button>
            {outlineOpen && <div className="border-t border-[#d3cec4] py-2">
              {LECTURE_NOTE_MAJOR_SECTIONS.map((major) => (
                <div key={major.id} className="border-b border-[#ddd8ce] py-2 last:border-b-0">
                  <button onClick={() => scrollToAnchor(major.id)} className="flex w-full items-center gap-2 px-2 py-1 text-left text-[9px] font-black tracking-[0.08em] text-[#3c3a36] hover:text-[#255c99]">
                    <span className="font-mono-term text-[8px] text-[#255c99]">{major.number}</span>
                    <span>{major.title}</span>
                  </button>
                  {LECTURE_NOTE_SECTIONS.filter((section) => major.sectionIds.some((sectionId) => sectionId === section.id)).map((section) => (
                    <button key={section.id} onClick={() => scrollToAnchor(section.id)} className="group flex w-full gap-2 border-l border-transparent py-1 pr-1 pl-7 text-left hover:border-[#255c99]">
                      <span className="text-[9px] leading-snug font-bold text-[#8b867d] group-hover:text-[#255c99]">{section.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>}
          </nav>

          <article ref={articleRef} onMouseUp={handleTextSelection} className="note-paper border border-[#c9c4ba] bg-[#fbfaf6] shadow-[0_16px_48px_rgba(38,38,36,0.10)]">
            <div className="border-b border-[#d8d3c9] px-12 pt-12 pb-10">
              <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.16em] text-[#8c877d]"><span>{LECTURE_NOTE_META.course}</span><span>·</span><span>{LECTURE_NOTE_META.updatedAt}</span></div>
              <h1 className="mt-5 max-w-[560px] text-[36px] leading-[1.12] font-black tracking-[-0.055em] text-[#262624]">{LECTURE_NOTE_META.title}</h1>
              <div className="mt-8 flex items-center gap-3 border-t border-[#d8d3c9] pt-4 text-[10px] text-[#8c877d]"><span>{LECTURE_NOTE_META.author}</span><span>·</span><span>{LECTURE_NOTE_META.readingMinutes}분</span></div>
            </div>

            <div className="px-12 py-4">
              {LECTURE_NOTE_SECTIONS.map((section) => {
                const major = LECTURE_NOTE_MAJOR_SECTIONS.find((candidate) => candidate.sectionIds[0] === section.id);
                return (
                 <div key={section.id}>
                {major && (
                  <header id={major.id} className="scroll-mt-28 mt-8 border-y border-[#262624] py-5 first:mt-4">
                    <div className="flex items-end justify-between gap-4">
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono-term text-[11px] font-black text-[#255c99]">{major.number}</span>
                        <h2 className="text-[23px] font-black tracking-[0.08em] text-[#262624]">{major.title}</h2>
                      </div>
                      <span className="pb-1 font-mono-term text-[8px] font-bold tracking-[0.1em] text-[#9a958b]">{major.sectionIds.length} TOPICS</span>
                    </div>
                  </header>
                )}
                <section id={section.id} className="scroll-mt-8 border-b border-[#ddd8ce] py-10 last:border-b-0">
                  <div className="mb-5 font-mono-term text-[9px] font-black tracking-[0.14em] text-[#255c99]">{section.eyebrow}</div>
                  <h2 className="mb-6 text-[25px] leading-tight font-black tracking-[-0.035em] text-[#2d2c29]">{section.title}</h2>
                  <div className="space-y-5">
                    {section.paragraphs.map((paragraph) => {
                      const active = activeNodeId === paragraph.nodeId;
                      const body = noteContent[paragraph.id] ?? paragraph.body;
                      if (isEditingNote) {
                        return (
                          <textarea
                            key={`edit-${paragraph.id}`}
                            defaultValue={body}
                            rows={Math.max(4, Math.ceil(body.length / 48))}
                            onBlur={(event) => onUpdateNoteContent(paragraph.id, event.currentTarget.value)}
                            className="w-full resize-y border border-[#d1c6b7] bg-[#fffdf8] p-4 text-[13px] leading-[1.9] text-[#4e4b45] outline-none focus:border-[#a65f2b]"
                            aria-label={`${section.title} 문단 편집`}
                          />
                        );
                      }
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
                          className={`cursor-pointer scroll-mt-28 whitespace-pre-line border-l-2 py-0.5 pl-4 text-[14px] leading-[2.05] text-[#4e4b45] transition-colors ${active ? 'border-[#255c99] bg-[#eef3f8]' : 'border-transparent hover:border-[#9fb5ca] hover:bg-[#f4f7f9]'}`}
                        >
                          {renderHighlightedText(body, paragraph.id)}
                        </p>
                      );
                    })}
                  </div>
                </section>
                {NOTE_INSERTIONS.filter((insertion) => insertion.afterSectionId === section.id).map(renderInsertion)}
                </div>
                );
              })}
            </div>
          </article>

          <aside className="min-h-full pt-[170px]" aria-label="대화 코멘트">
            <div className="light-scroll sticky top-6 max-h-[calc(100vh-110px)] overflow-y-auto pr-1 pb-6">
              <div className="mb-3 flex items-center justify-between border-b border-[#262624] pb-2">
                <span className="text-[9px] font-black tracking-[0.16em] text-[#77736a]">코멘트</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono-term text-[9px] text-[#255c99]">{visibleComments.length}</span>
                  <button onClick={() => setArchiveOpen((value) => !value)} className={`border px-2 py-1 text-[8px] font-black ${archiveOpen ? 'border-[#8b552d] bg-[#fff4e8] text-[#8b552d]' : 'border-[#c9c1b5] text-[#77736a]'}`}>보관함 {archivedComments.length}</button>
                </span>
              </div>

              {archiveOpen && (
                <section className="mb-4 border border-[#bdb8ad] bg-[#f3efe7] p-3">
                  <div className="mb-2 text-[8.5px] font-black tracking-[0.12em] text-[#6f665b]">보관된 코멘트</div>
                  {archivedComments.length === 0 ? <div className="py-3 text-center text-[9px] text-[#aaa39a]">비어 있음</div> : (
                    <div className="space-y-2">
                      {archivedComments.map((comment) => {
                        const node = nodes.find((candidate) => candidate.id === comment.nodeId);
                        return (
                          <article key={comment.id} className="border border-[#d4cdc2] bg-[#fffdf8] p-3">
                            <div className="text-[9.5px] font-black text-[#403c37]">{comment.title}</div>
                            <div className="mt-1 font-mono-term text-[7.5px] text-[#928a80]">{node?.name ?? comment.nodeId}</div>
                            <blockquote className="mt-2 line-clamp-2 border-l-2 border-[#d5bd91] pl-2 text-[8.5px] leading-relaxed text-[#756b60]">“{comment.quote ?? comment.body}”</blockquote>
                            <div className="mt-2 flex items-center justify-between">
                              <button onClick={() => { onArchiveComment(comment.id, false); setArchiveOpen(false); if (comment.anchorId) onNavigate(comment.nodeId, comment.anchorId); }} className="text-[8.5px] font-black text-[#8b552d]">복원하고 이동</button>
                              <button onClick={() => setDeleteConfirmId(deleteConfirmId === comment.id ? null : comment.id)} className="text-[8px] font-black text-[#a2553d]">삭제</button>
                            </div>
                            {deleteConfirmId === comment.id && <div className="mt-2 flex justify-end gap-2 border-t border-[#ead5cc] pt-2 text-[8px]"><button onClick={() => setDeleteConfirmId(null)}>취소</button><button onClick={() => { onDeleteComment(comment.id); setDeleteConfirmId(null); }} className="font-black text-[#b33f25]">완전 삭제</button></div>}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {selectionDraft && (
                <section role="dialog" aria-label="선택한 노트 내용에 질문 추가" className="selection-composer relative mb-5 overflow-hidden rounded-[18px] border border-[#d7bd91] bg-[#fffaf2] p-4 shadow-[0_18px_42px_rgba(100,70,35,0.16)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.14em] text-[#8b552d]"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#f2d9ae] text-[10px] text-[#8b552d]">✦</span> 선택한 문장에 남기기</div>
                      <div className="mt-1 text-[8px] text-[#9a8772]">표시는 저장하거나 취소할 때까지 유지됩니다.</div>
                    </div>
                    <button
                      disabled={questionLoading}
                      onClick={() => { setSelectionDraft(null); setComposerText(''); setQuestionError(null); window.getSelection()?.removeAllRanges(); }}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dfcfb5] bg-white/70 text-[12px] text-[#887663] transition hover:border-[#b98a54] hover:bg-white hover:text-[#654424]"
                      aria-label="선택 취소"
                      title="선택 취소"
                    >×</button>
                  </div>
                  <blockquote className="mt-3 line-clamp-4 rounded-xl border border-[#ead9ba] bg-[#fffdf8] px-3 py-2.5 text-[10.5px] leading-relaxed text-[#665344] shadow-[inset_3px_0_0_#d9a451]">“{selectionDraft.quote}”</blockquote>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {([
                      ['question', '?', '직접 질문', '궁금한 점을 묻기'],
                      ['conversation', '↗', 'GPT 대화', '대화 내용을 연결'],
                      ['highlight', '✦', '개인 표시', '강조와 메모만'],
                    ] as const).map(([mode, icon, label, description]) => {
                      const selected = composerMode === mode;
                      return (
                        <button
                          key={mode}
                          disabled={questionLoading}
                          onClick={() => { setComposerMode(mode); setQuestionError(null); }}
                          className={`rounded-xl border px-2 py-2.5 text-left transition-all ${selected ? 'border-[#bd8042] bg-white text-[#704522] shadow-[0_5px_14px_rgba(123,78,32,0.13)] ring-2 ring-[#efd3a5]/55' : 'border-[#e4d6c0] bg-[#f9f3e8] text-[#786b5d] hover:border-[#cfb38b] hover:bg-white'}`}
                        >
                          <span className={`mb-1.5 grid h-5 w-5 place-items-center rounded-full text-[9px] font-black ${selected ? 'bg-[#80502d] text-white' : 'bg-[#ece1cf] text-[#8a6b4a]'}`}>{icon}</span>
                          <span className="block text-[8.5px] font-black">{label}</span>
                          <span className="mt-0.5 block text-[7px] font-medium opacity-70">{description}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-4 block text-[9px] font-black text-[#665747]" htmlFor="note-comment-input">{composerMode === 'question' ? '무엇이 궁금한가요?' : composerMode === 'conversation' ? '관련 대화를 붙여 넣으세요' : '이 표시와 함께 남길 메모'}</label>
                  <textarea
                    id="note-comment-input"
                    autoFocus
                    value={composerText}
                    onChange={(event) => setComposerText(event.target.value)}
                    onKeyDown={(event) => {
                      if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') void submitComment();
                    }}
                    placeholder={composerMode === 'question' ? '왜 이 값은 다시 계산하지 않나요?' : composerMode === 'conversation' ? 'GPT와 나눈 대화를 붙여넣으세요…' : '필요하면 메모를 남기세요.'}
                    className="mt-2 h-28 w-full resize-none rounded-xl border border-[#dfcfb5] bg-white/85 p-3 text-[11px] leading-relaxed text-[#4f443a] outline-none transition placeholder:text-[#b4a492] focus:border-[#bc7d3e] focus:bg-white focus:ring-4 focus:ring-[#edc98d]/30"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[7.5px] text-[#a08e7a]">{questionLoading ? 'GPT가 노트 근거로 답변 중…' : 'Ctrl/⌘ + Enter로 저장'}</span>
                    <button disabled={questionLoading || (composerMode !== 'highlight' && composerText.trim().length < 2)} onClick={() => void submitComment()} className="rounded-full bg-[#75492e] px-4 py-2.5 text-[9px] font-black text-white shadow-[0_6px_14px_rgba(95,57,35,0.22)] transition hover:-translate-y-0.5 hover:bg-[#5f3923] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0">{questionLoading ? '답변 받는 중…' : composerMode === 'question' ? '질문 보내기' : composerMode === 'conversation' ? '대화 연결하기' : '하이라이트 저장'}</button>
                  </div>
                  {questionError && <p role="alert" className="mt-3 rounded-lg border border-[#dfb5a6] bg-[#fff4ef] px-3 py-2 text-[9px] font-bold text-[#8f4933]">{questionError}</p>}
                </section>
              )}

              {!annotationsVisible && visibleComments.length === 0 && !selectionDraft && (
                <div className="border border-dashed border-[#aaa59b] bg-[#f4f0e7] p-4 text-[11px] text-[#77736a]">아직 코멘트가 없습니다.</div>
              )}

              <div className="space-y-3">
                {visibleComments.filter((comment) => comment.anchorId !== null).map((comment) => {
                  const node = nodes.find((candidate) => candidate.id === comment.nodeId);
                  const active = activeCommentId === comment.id;
                  const canRestoreHighlight = Boolean(comment.anchorId && comment.quote && quoteRange(noteContent[comment.anchorId] ?? '', comment.quote));
                  const relatedTargets = relatedTargetsFor(comment);
                  return (
                    <article
                      key={comment.id}
                      id={`comment-card-${comment.id}`}
                      ref={(element) => { if (element) commentCardRefs.current.set(comment.id, element); else commentCardRefs.current.delete(comment.id); }}
                      tabIndex={-1}
                      className={`comment-card relative border p-4 outline-none transition-all duration-300 ${active ? 'comment-card-active border-[#c56a2d] bg-[#fffaf0] ring-4 ring-[#f4c47c]/35' : 'border-[#bdb8ad] bg-[#f8f6f0] shadow-[5px_5px_0_rgba(38,38,36,0.07)]'} ${comment.createdNow ? 'comment-pop' : ''}`}
                    >
                      {active && <div className="mb-3 flex items-center gap-2 text-[8px] font-black tracking-[0.12em] text-[#9a4f22]"><span className="h-2 w-2 rounded-full bg-[#d97732]" /> 현재 보고 있는 코멘트</div>}
                      {editingCommentId === comment.id ? (
                        <div className="space-y-2">
                          <label className="block text-[8.5px] font-black text-[#77736a]">제목</label>
                          <input value={editingCommentTitle} onChange={(event) => setEditingCommentTitle(event.target.value)} className="w-full border border-[#c9c1b5] bg-white px-2.5 py-2 text-[11px] font-bold outline-none focus:border-[#a65f2b]" />
                          <label className="block text-[8.5px] font-black text-[#77736a]">내용</label>
                          <textarea value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} className="h-28 w-full resize-y border border-[#c9c1b5] bg-white p-2.5 text-[11px] leading-relaxed outline-none focus:border-[#a65f2b]" />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingCommentId(null)} className="px-2 py-1.5 text-[8.5px] font-black text-[#77736a]">취소</button>
                            <button
                              disabled={!editingCommentTitle.trim() || !editingCommentBody.trim()}
                              onClick={() => {
                                onUpdateComment(comment.id, editingCommentTitle.trim(), editingCommentBody.trim());
                                setEditingCommentId(null);
                              }}
                              className="bg-[#75492e] px-2.5 py-1.5 text-[8.5px] font-black text-white disabled:opacity-35"
                            >저장</button>
                          </div>
                        </div>
                      ) : <button onClick={() => focusComment(comment)} className="w-full text-left">
                        <div className="flex items-start gap-2">
                          <span className={`grid h-5 w-5 shrink-0 place-items-center text-[9px] font-black text-white ${comment.createdNow ? 'bg-[#d85b35]' : 'bg-[#255c99]'}`}>{comment.createdNow ? '나' : 'AI'}</span>
                          <div className="min-w-0"><div className="flex items-center gap-2 text-[11px] font-black text-[#2f2e2a]"><span>{comment.title}</span>{comment.highlighted === false && <span className="border border-[#c9c1b5] px-1 py-0.5 text-[7px] text-[#8c877d]">표시 꺼짐</span>}</div><div className="mt-0.5 truncate font-mono-term text-[8.5px] text-[#8c877d]">{node?.name ?? comment.nodeId} · {comment.source}</div></div>
                        </div>
                        <p className="mt-3 whitespace-pre-line text-[11px] leading-[1.65] text-[#5f5b53]">{comment.body}</p>
                      </button>}
                      {editingCommentId !== comment.id && (
                        <div className="mt-3 border-t border-[#d8d3c9] pt-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[8.5px] font-black text-[#6f6255]">원문 표시</span>
                              <button
                                role="switch"
                                aria-checked={comment.highlighted !== false}
                                disabled={comment.highlighted === false && !canRestoreHighlight}
                                onClick={() => onToggleCommentHighlight(comment.id, comment.highlighted === false)}
                                className={`relative h-5 w-9 rounded-full transition-colors ${comment.highlighted !== false ? 'bg-[#e0a638]' : 'bg-[#d2cec5]'} disabled:cursor-not-allowed disabled:opacity-45`}
                              >
                                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${comment.highlighted !== false ? 'translate-x-4' : 'translate-x-0'}`} />
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => { setEditingCommentId(comment.id); setEditingCommentTitle(comment.title); setEditingCommentBody(comment.body); }} className="text-[8.5px] font-black text-[#77736a] hover:text-[#3c3a36]">수정</button>
                              <button onClick={() => { onArchiveComment(comment.id, true); setActiveCommentId(null); }} className="text-[8.5px] font-black text-[#77736a] hover:text-[#3c3a36]">보관</button>
                              <button onClick={() => setDeleteConfirmId(deleteConfirmId === comment.id ? null : comment.id)} className="text-[8.5px] font-black text-[#a2553d] hover:text-[#742f20]">삭제</button>
                            </div>
                          </div>
                          {comment.highlighted === false && !canRestoreHighlight && <div className="mt-2 text-[8px] text-[#9a705d]">원문이 수정되어 하이라이트 연결이 끊어졌습니다.</div>}
                          {deleteConfirmId === comment.id && (
                            <div className="mt-3 flex items-center justify-between border border-[#dfb5a6] bg-[#fff4ef] px-2.5 py-2 text-[8.5px] text-[#8f4933]">
                              <span>코멘트를 완전히 삭제할까요?</span>
                              <span className="flex gap-2"><button onClick={() => setDeleteConfirmId(null)} className="font-black">취소</button><button onClick={() => { onDeleteComment(comment.id); setDeleteConfirmId(null); }} className="font-black text-[#b33f25]">삭제</button></span>
                            </div>
                          )}
                        </div>
                      )}
                      {relatedTargets.length > 0 && editingCommentId !== comment.id && (
                        <div className="mt-3">
                          <button onClick={() => setOpenRelatedCommentId(openRelatedCommentId === comment.id ? null : comment.id)} className="flex w-full items-center border-t border-[#d8d3c9] pt-3 text-left text-[9.5px] font-black text-[#255c99] hover:text-[#173f6d]">관련 내용 {relatedTargets.length}곳 <span className={`ml-auto transition-transform ${openRelatedCommentId === comment.id ? 'rotate-180' : ''}`}>⌄</span></button>
                          {openRelatedCommentId === comment.id && (
                            <div className="mt-2 overflow-hidden border border-[#c9d5e0] bg-[#f7fafc]">
                              {relatedTargets.map((target) => (
                                <button key={`${target.nodeId}-${target.anchorId}`} onClick={() => { onNavigate(target.nodeId, target.anchorId); scrollToAnchor(target.anchorId); setOpenRelatedCommentId(null); }} className="flex w-full items-center gap-3 border-b border-[#dfe6ec] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#eaf1f6]">
                                  <span className="grid h-5 w-5 shrink-0 place-items-center border border-[#9fb3c5] text-[9px] text-[#255c99]">↗</span>
                                  <span className="min-w-0"><span className="block truncate text-[10px] font-black text-[#344b60]">{target.label}</span><span className="mt-0.5 block text-[8px] text-[#788a99]">{target.relation}</span></span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
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
