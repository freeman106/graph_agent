/**
 * 노드 좌표 — 프론트 로컬 상태.
 *
 * 계약(contract/schema.ts)에 좌표가 없는 이유가 여기 있다. 레이아웃은 전적으로
 * 프론트 책임이고 백엔드는 그래프 구조만 다룬다. 백엔드가 새 노드를 만들면
 * placeNewNode() 가 앵커 주변에 자리를 잡는다.
 *
 * 물리 시뮬레이션을 쓰지 않는다. 프로토타입에선 레이아웃이 매번 흔들리지 않는 게
 * 더 중요하다.
 */

export const GRAPH_VIEWBOX = { width: 1060, height: 760 };

export interface Point {
  x: number;
  y: number;
}

/** 시드 그래프 22개 노드의 고정 좌표. */
export const NODE_LAYOUT: Record<string, Point> = {
  // 입력 처리
  tokenization: { x: 90, y: 80 },
  bpe: { x: 85, y: 180 },
  embedding: { x: 110, y: 285 },
  'positional-encoding': { x: 90, y: 390 },
  'rotary-positional-embedding': { x: 80, y: 500 },

  // 어텐션 코어
  softmax: { x: 275, y: 70 },
  'query-key-value': { x: 255, y: 175 },
  attention: { x: 250, y: 290 },
  'scaled-dot-product-attention': { x: 420, y: 120 },
  'self-attention': { x: 410, y: 260 },
  'multi-head-attention': { x: 575, y: 170 },
  'masked-attention': { x: 420, y: 390 },
  'cross-attention': { x: 595, y: 315 },

  // 블록 구성
  'feed-forward-network': { x: 750, y: 85 },
  'layer-normalization': { x: 900, y: 160 },
  'transformer-block': { x: 765, y: 245 },
  'residual-connection': { x: 930, y: 300 },
  'encoder-decoder': { x: 860, y: 390 },
  'grouped-query-attention': { x: 730, y: 430 },

  // 디코딩
  'greedy-decoding': { x: 185, y: 570 },
  'beam-search': { x: 140, y: 690 },
  'temperature-sampling': { x: 330, y: 675 },

  // 이번 실행에서 추가되는 노드들의 예약 자리
  'autoregressive-decoding': { x: 350, y: 505 },
  'kv-cache': { x: 545, y: 480 },
  'incremental-decoding': { x: 475, y: 630 },
  'flash-attention': { x: 700, y: 600 },
};

const MIN_GAP = 120;

/**
 * 좌표가 없는 노드의 자리를 잡는다.
 *
 * 앵커들의 무게중심에서 그래프 중심 반대쪽으로 밀어내고, 기존 노드와 겹치면
 * 원을 그리며 비켜난다. 결정적이라 같은 입력이면 같은 자리가 나온다.
 */
export function placeNewNode(
  nodeId: string,
  anchorIds: string[],
  occupied: Record<string, Point>,
): Point {
  const fixed = NODE_LAYOUT[nodeId];
  if (fixed) return fixed;

  const anchors = anchorIds.map((id) => occupied[id]).filter(Boolean) as Point[];
  const center = { x: GRAPH_VIEWBOX.width / 2, y: GRAPH_VIEWBOX.height / 2 };

  const base =
    anchors.length > 0
      ? {
          x: anchors.reduce((s, p) => s + p.x, 0) / anchors.length,
          y: anchors.reduce((s, p) => s + p.y, 0) / anchors.length,
        }
      : center;

  // 앵커 무게중심에서 그래프 바깥쪽으로 한 칸 민다.
  const away = Math.hypot(base.x - center.x, base.y - center.y) || 1;
  let candidate = {
    x: base.x + ((base.x - center.x) / away) * MIN_GAP,
    y: base.y + ((base.y - center.y) / away) * MIN_GAP,
  };

  const taken = Object.values(occupied);
  for (let ring = 0; ring < 12; ring++) {
    const collides = taken.some(
      (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < MIN_GAP,
    );
    const inside =
      candidate.x > 60 &&
      candidate.x < GRAPH_VIEWBOX.width - 90 &&
      candidate.y > 60 &&
      candidate.y < GRAPH_VIEWBOX.height - 70;
    if (!collides && inside) break;

    const angle = (ring * 2 * Math.PI) / 6;
    candidate = {
      x: base.x + Math.cos(angle) * (MIN_GAP + ring * 12),
      y: base.y + Math.sin(angle) * (MIN_GAP + ring * 12),
    };
  }

  return candidate;
}


/* ── 단원 기준 배치 ─────────────────────────────────────────
 * 단원이 그래프의 세로 줄이다(계약 설계). 좌표는 계약에 없으므로
 * 프론트가 단원 순서를 x, 단원 안 순서를 y 로 편다.
 */

export interface Column {
  id: string;
  title: string;
  x: number;
  width: number;
}

export function layoutByChapter(
  chapters: Array<{ id: string; title: string; subtopics: Array<{ id: string }> }>,
  nodes: Array<{ id: string; chapter_id: string | null; subtopic_id: string | null }>,
): { points: Record<string, Point>; columns: Column[] } {
  const columns: Column[] = [];
  const points: Record<string, Point> = {};
  if (chapters.length === 0) return { points, columns };

  const margin = 40;
  const usable = GRAPH_VIEWBOX.width - margin * 2;
  const width = usable / chapters.length;

  chapters.forEach((chapter, index) => {
    const x = margin + width * index;
    columns.push({ id: chapter.id, title: chapter.title, x, width });

    // 이 단원에 속한 노드를 소주제 순서대로 세운다.
    const order = new Map(chapter.subtopics.map((s, i) => [s.id, i]));
    const mine = nodes
      .filter((node) => node.chapter_id === chapter.id)
      .sort((a, b) => (order.get(a.subtopic_id ?? '') ?? 99) - (order.get(b.subtopic_id ?? '') ?? 99));

    const top = 96;
    const bottom = GRAPH_VIEWBOX.height - 90;
    const step = mine.length > 1 ? (bottom - top) / (mine.length - 1) : 0;
    mine.forEach((node, row) => {
      // 짝수/홀수 행을 좌우로 조금 어긋내 라벨이 겹치지 않게 한다.
      const jitter = row % 2 === 0 ? -width * 0.16 : width * 0.16;
      points[node.id] = {
        x: x + width / 2 + jitter,
        y: mine.length > 1 ? top + step * row : (top + bottom) / 2,
      };
    });
  });

  return { points, columns };
}
