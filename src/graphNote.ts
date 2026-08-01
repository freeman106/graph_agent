/**
 * 그래프를 NoteWorkspace 가 이미 아는 모양으로 바꾼다.
 *
 * NoteWorkspace 는 lectureNote.ts 의 하드코딩된 구조(대단원 → 섹션 → 문단,
 * 그리고 나중에 끼어드는 삽입 블록)를 그린다. 그 구조가 계약의
 * 단원 → 소주제 → 노드 문서와 그대로 대응하므로, 화면을 새로 만들지 않고
 * 데이터만 갈아끼운다.
 *
 *   대단원(major)   ← Chapter
 *   섹션(section)   ← Subtopic
 *   문단(paragraph) ← Node.document 를 줄 단위로 나눈 것
 *   삽입(insertion) ← origin 이 conversation 인 노드 (접힌 채로 끼어든다)
 */

import type { Chapter } from '../contract/schema';
import type { RuntimeNode } from './view';

export interface NoteBundle {
  meta: { title: string; course: string; author: string; updatedAt: string; readingMinutes: number };
  majorSections: Array<{ id: string; number: string; title: string; sectionIds: string[] }>;
  sections: Array<{
    id: string;
    eyebrow: string;
    title: string;
    paragraphs: Array<{ id: string; nodeId: string; body: string }>;
  }>;
  insertions: Array<{
    id: string;
    afterSectionId: string;
    nodeId: string;
    eyebrow: string;
    title: string;
    preview: string;
    tags: string[];
    paragraphs: string[];
  }>;
  noteContent: Record<string, string>;
  anchorOf: Record<string, string>;
}

const paragraphsOf = (document: string) =>
  document
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function buildNoteBundle(
  chapters: Chapter[],
  nodes: RuntimeNode[],
  title: string,
): NoteBundle {
  const sections: NoteBundle['sections'] = [];
  const majorSections: NoteBundle['majorSections'] = [];
  const insertions: NoteBundle['insertions'] = [];
  const noteContent: Record<string, string> = {};
  const anchorOf: Record<string, string> = {};

  chapters.forEach((chapter, chapterIndex) => {
    const sectionIds: string[] = [];

    for (const subtopic of chapter.subtopics) {
      const inSubtopic = nodes.filter((node) => node.subtopic_id === subtopic.id);
      const fromLecture = inSubtopic.filter((node) => node.origin === 'lecture');
      const paragraphs: NoteBundle['sections'][number]['paragraphs'] = [];

      for (const node of fromLecture) {
        paragraphsOf(node.document).forEach((body, index) => {
          const id = `${node.id}-p${index + 1}`;
          paragraphs.push({ id, nodeId: node.id, body });
          noteContent[id] = body;
          if (index === 0) anchorOf[node.id] = id;
        });
      }

      if (paragraphs.length === 0) continue;
      sections.push({
        id: subtopic.id,
        eyebrow: `${chapter.title} · ${subtopic.title}`,
        title: subtopic.title,
        paragraphs,
      });
      sectionIds.push(subtopic.id);

      // 대화로 생긴 노드는 같은 소주제 뒤에 접힌 블록으로 끼어든다.
      for (const node of inSubtopic.filter((candidate) => candidate.origin === 'conversation')) {
        const body = paragraphsOf(node.document);
        insertions.push({
          id: `insert-${node.id}`,
          afterSectionId: subtopic.id,
          nodeId: node.id,
          eyebrow: '대화에서 추가',
          title: node.name,
          preview: node.summary,
          tags: node.comments.some((comment) => comment.weakpoint) ? ['막힌 지점'] : [],
          paragraphs: body.length > 0 ? body : [node.summary],
        });
        body.forEach((text, index) => {
          const id = index === 0 ? `insert-${node.id}` : `insert-${node.id}-${index + 1}`;
          noteContent[id] = text;
        });
        anchorOf[node.id] = `insert-${node.id}`;
      }
    }

    if (sectionIds.length === 0) return;
    majorSections.push({
      id: `major-${chapter.id}`,
      number: String(chapterIndex + 1).padStart(2, '0'),
      title: chapter.title,
      sectionIds,
    });
  });

  const readingMinutes = Math.max(
    1,
    Math.round(nodes.reduce((sum, node) => sum + node.document.length, 0) / 500),
  );

  return {
    meta: {
      title,
      course: `개념 ${nodes.length}개 · 단원 ${majorSections.length}개`,
      author: '강의안에서 생성',
      updatedAt: '',
      readingMinutes,
    },
    majorSections,
    sections,
    insertions,
    noteContent,
    anchorOf,
  };
}
