/**
 * 렌더링 전용 타입과 상수.
 *
 * 계약 타입을 다시 선언하지 않는다 — contract/schema.ts 의 Node / Edge 를
 * import 해서 확장만 한다. 여기 붙는 것들(좌표, 애니메이션 플래그, 색)은
 * 백엔드가 알 필요가 없는 프론트 사정이다.
 */

import type { Edge, Node, NodeStatus } from '../contract/schema';
import type { Point } from './layout';

/** 등장/제거 연출용 플래그. 데이터가 아니라 연출이다. */
export interface RuntimeFlags {
  /** 이번 실행에서 새로 추가된 노드/간선 */
  isNew?: boolean;
  /** 방금 등장해서 강조 중 */
  justAdded?: boolean;
  /** 검수 단계에서 제거되는 중 (페이드아웃) */
  removing?: boolean;
  /** 검수 결과가 반영되며 잠깐 번쩍이는 중 */
  flash?: boolean;
}

/** 계약 Node + 프론트가 붙이는 좌표와 연출 플래그. */
export type RuntimeNode = Node & Point & RuntimeFlags;

/** 계약 Edge + 연출 플래그. */
export type RuntimeEdge = Edge & RuntimeFlags;

/** 강의노트 위 코멘트. 문서 앵커는 프론트 DOM에만 존재한다. */
export interface RuntimeNoteComment {
  id: string;
  anchorId: string | null;
  quote: string | null;
  nodeId: string;
  title: string;
  body: string;
  source: string;
  relatedNodeId: string | null;
  relatedAnchorId: string | null;
  revealOnRun: boolean;
  kind?: 'agent' | 'question' | 'conversation' | 'highlight';
  highlighted?: boolean;
  archived?: boolean;
  start?: number;
  end?: number;
  createdNow?: boolean;
}

/* ── 실행 스트림 (프론트 표시용) ────────────────────────────── */

export type StreamLineKind =
  | 'system'
  | 'call'
  | 'result'
  | 'reason'
  | 'detail'
  | 'place'
  | 'edge'
  | 'warn'
  | 'fix'
  | 'done';

export interface StreamLine {
  id: number;
  kind: StreamLineKind;
  text: string;
}

/** 실제 스트림의 툴 호출 하나. */
export interface RuntimePipelineTool {
  id: number;
  name: string;
  status: 'running' | 'done';
}

/** 같은 목적의 툴 호출을 한데 묶은 실행 단계. */
export interface RuntimePipelineStep {
  id: number;
  label: string;
  status: 'running' | 'done';
  tools: RuntimePipelineTool[];
}

/* ── 색 / 범례 ──────────────────────────────────────────────── */

export interface StatusStyle {
  label: string;
  fill: string;
  stroke: string;
  dashed?: boolean;
}

export const STATUS_STYLE: Record<NodeStatus, StatusStyle> = {
  learned: { label: '학습 완료', fill: '#10b981', stroke: '#047857' },
  unlearned: {
    label: '미학습 · 다음에 공부할 것',
    fill: '#ffffff',
    stroke: '#94a3b8',
    dashed: true,
  },
  weak: { label: '약점 있음', fill: '#f59e0b', stroke: '#b45309' },
};

export const NEW_STYLE = {
  label: '이번 실행에서 새로 추가됨',
  fill: '#8b5cf6',
  stroke: '#6d28d9',
};

/** 라벨을 노드 아래 여러 줄로 접는다. */
export function wrapLabel(label: string, maxLen = 17): string[] {
  const words = label.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxLen) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
