import { useEffect, useMemo, useRef, useState } from 'react';
import { RELATION_LABEL } from '../../contract/schema';
import { GRAPH_VIEWBOX } from '../layout';
import { wrapLabel, type RuntimeEdge, type RuntimeNode } from '../view';

const NODE_RADIUS = 15;
const FULL_VIEW = { x: 0, y: 0, width: GRAPH_VIEWBOX.width, height: GRAPH_VIEWBOX.height };
const VIEW_ASPECT = GRAPH_VIEWBOX.width / GRAPH_VIEWBOX.height;
const MIN_ZOOM_WIDTH = 280;
const SUPPLEMENT_COLOR = '#a65f2b';
const SUPPLEMENT_DARK = '#6f3518';

type ViewBox = typeof FULL_VIEW;

function constrainViewBox(candidate: ViewBox): ViewBox {
  const width = Math.max(MIN_ZOOM_WIDTH, Math.min(GRAPH_VIEWBOX.width, candidate.width));
  const height = width / VIEW_ASPECT;
  return {
    x: Math.max(0, Math.min(GRAPH_VIEWBOX.width - width, candidate.x)),
    y: Math.max(0, Math.min(GRAPH_VIEWBOX.height - height, candidate.y)),
    width,
    height,
  };
}

/** 선택 노드와 직접 연결된 이웃의 노드·라벨이 함께 보이는 확대 범위. */
function fitNeighborhood(nodes: RuntimeNode[], compact: boolean): ViewBox {
  const minX = Math.min(...nodes.map((node) => node.x)) - 55;
  const maxX = Math.max(...nodes.map((node) => node.x)) + 150;
  const minY = Math.min(...nodes.map((node) => node.y)) - 55;
  const maxY = Math.max(...nodes.map((node) => node.y)) + 80;
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const width = Math.max(compact ? 390 : 440, contentWidth, contentHeight * VIEW_ASPECT);
  const height = width / VIEW_ASPECT;
  return constrainViewBox({
    x: (minX + maxX - width) / 2,
    y: (minY + maxY - height) / 2,
    width,
    height,
  });
}

interface Props {
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  selectedId: string | null;
  noteIds: Set<string>;
  filter: string;
  compact?: boolean;
  /** 단원 세로 줄. 그래프 데이터에서 나온다. 없으면 구획을 그리지 않는다 */
  columns?: Array<{ id: string; title: string; x: number; width: number }>;
  onSelect: (id: string | null) => void;
}

function trimmedLine(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  return {
    x1: ax + ux * (NODE_RADIUS + 3),
    y1: ay + uy * (NODE_RADIUS + 3),
    x2: bx - ux * (NODE_RADIUS + 7),
    y2: by - uy * (NODE_RADIUS + 7),
    length: Math.max(distance - NODE_RADIUS * 2 - 10, 1),
  };
}

const edgeDash = (relation: RuntimeEdge['relation']) => {
  if (relation === 'contrast') return '2 5';
  if (relation === 'component') return '7 4';
  if (relation === 'variant') return '1 4';
  return undefined;
};

export default function Graph({ nodes, edges, selectedId, noteIds, filter, compact = false, columns = [], onSelect }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState(FULL_VIEW);
  const viewBoxRef = useRef<ViewBox>(FULL_VIEW);
  const animationFrame = useRef<number | null>(null);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const focusId = hoverId ?? selectedId;

  useEffect(() => {
    const selected = selectedId ? byId.get(selectedId) : null;
    const neighborhood = selected
      ? [
          selected,
          ...edges
            .filter((edge) => edge.from_id === selected.id || edge.to_id === selected.id)
            .map((edge) => byId.get(edge.from_id === selected.id ? edge.to_id : edge.from_id))
            .filter((node): node is RuntimeNode => Boolean(node)),
        ]
      : [];
    const target = selected ? fitNeighborhood(neighborhood, compact) : FULL_VIEW;
    const start = { ...viewBoxRef.current };
    const startedAt = performance.now();
    const duration = selected ? 720 : 560;

    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = {
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        width: start.width + (target.width - start.width) * eased,
        height: start.height + (target.height - start.height) * eased,
      };
      viewBoxRef.current = next;
      setViewBox(next);
      if (progress < 1) animationFrame.current = requestAnimationFrame(animate);
    };
    animationFrame.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    };
  // 선택이 바뀌는 순간의 그래프 구조로 확대 범위를 잡는다. 상태/애니메이션 변경이
  // 사용자가 휠로 맞춘 줌을 되돌리지 않도록 byId와 edges는 의존성에서 제외한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, compact]);

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);

    const current = viewBoxRef.current;
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    const cursor = matrix
      ? point.matrixTransform(matrix.inverse())
      : { x: current.x + current.width / 2, y: current.y + current.height / 2 };
    const normalizedDelta = Math.max(-100, Math.min(100, event.deltaY));
    const factor = Math.exp(normalizedDelta * 0.0018);
    const nextWidth = Math.max(MIN_ZOOM_WIDTH, Math.min(GRAPH_VIEWBOX.width, current.width * factor));
    const scale = nextWidth / current.width;
    const next = constrainViewBox({
      x: cursor.x - (cursor.x - current.x) * scale,
      y: cursor.y - (cursor.y - current.y) * scale,
      width: nextWidth,
      height: nextWidth / VIEW_ASPECT,
    });
    viewBoxRef.current = next;
    setViewBox(next);
  };

  const focusedEdges = useMemo(
    () => new Set(edges.filter((edge) => edge.from_id === focusId || edge.to_id === focusId).map((edge) => edge.id)),
    [edges, focusId],
  );
  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!focusId) return ids;
    for (const edge of edges) {
      if (edge.from_id === focusId) ids.add(edge.to_id);
      if (edge.to_id === focusId) ids.add(edge.from_id);
    }
    return ids;
  }, [edges, focusId]);
  const frontierIds = useMemo(() => {
    const studied = new Set(nodes.filter((node) => node.status !== 'unlearned').map((node) => node.id));
    return new Set(
      nodes
        .filter((node) => node.status === 'unlearned')
        .filter((node) => edges.some((edge) =>
          (edge.from_id === node.id && studied.has(edge.to_id)) ||
          (edge.to_id === node.id && studied.has(edge.from_id)),
        ))
        .map((node) => node.id),
    );
  }, [nodes, edges]);
  const weakContext = useMemo(() => {
    const ids = new Set(nodes.filter((node) => node.status === 'weak').map((node) => node.id));
    for (const edge of edges) {
      if (ids.has(edge.from_id)) ids.add(edge.to_id);
      if (ids.has(edge.to_id)) ids.add(edge.from_id);
    }
    return ids;
  }, [nodes, edges]);
  const frontierContext = useMemo(() => {
    const ids = new Set(frontierIds);
    for (const edge of edges) {
      if (frontierIds.has(edge.from_id)) ids.add(edge.to_id);
      if (frontierIds.has(edge.to_id)) ids.add(edge.from_id);
    }
    return ids;
  }, [edges, frontierIds]);

  const hovered = hoverId ? byId.get(hoverId) : null;

  return (
    <svg
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      className="h-full w-full bg-[#f7f5ef]"
      onClick={() => onSelect(null)}
      onWheel={handleWheel}
      style={{ touchAction: 'none' }}
    >
      <defs>
        <pattern id="paper-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#d8d4ca" strokeWidth="0.55" />
        </pattern>
        <marker id="map-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8Z" fill="#817c72" />
        </marker>
        <marker id="map-arrow-new" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8Z" fill={SUPPLEMENT_COLOR} />
        </marker>
      </defs>

      <rect width={GRAPH_VIEWBOX.width} height={GRAPH_VIEWBOX.height} fill="url(#paper-grid)" opacity="0.58" />

      {!compact && columns.length > 0 && <g className="map-districts" pointerEvents="none">
        {columns.map((column, index) => (
          <g key={column.id}>
            {index > 0 && (
              <path d={`M ${column.x - 8} 30 V ${GRAPH_VIEWBOX.height - 40}`} stroke="#b8b3a8" strokeWidth="1" />
            )}
            <text x={column.x + 10} y="48">
              {String(index + 1).padStart(2, '0')} / {column.title}
            </text>
          </g>
        ))}
      </g>}

      <g>
        {edges.map((edge) => {
          const from = byId.get(edge.from_id);
          const to = byId.get(edge.to_id);
          if (!from || !to) return null;
          const line = trimmedLine(from.x, from.y, to.x, to.y);
          const focused = focusedEdges.has(edge.id);
          const filtered = filter === 'weak'
            ? weakContext.has(edge.from_id) && weakContext.has(edge.to_id)
            : filter === 'frontier'
              ? frontierContext.has(edge.from_id) && frontierContext.has(edge.to_id)
              : true;
          const dimmed = !filtered || (!!focusId && !focused);
          return (
            <line
              key={edge.id}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={edge.isNew ? SUPPLEMENT_COLOR : focused ? '#262624' : '#aaa59b'}
              strokeWidth={edge.isNew || focused ? 1.8 : 1.05}
              strokeDasharray={edgeDash(edge.relation)}
              markerEnd={`url(#${edge.isNew ? 'map-arrow-new' : 'map-arrow'})`}
              opacity={edge.removing ? 0 : dimmed ? 0.12 : 0.7}
              className={edge.removing ? 'fading' : edge.justAdded ? 'edge-draw' : undefined}
              style={edge.justAdded ? ({ ['--len' as string]: `${line.length}` } as React.CSSProperties) : undefined}
            />
          );
        })}
      </g>

      <g pointerEvents="none">
        {edges.map((edge) => {
          if (!edge.isNew && !focusedEdges.has(edge.id)) return null;
          const from = byId.get(edge.from_id);
          const to = byId.get(edge.to_id);
          if (!from || !to || edge.removing) return null;
          const x = (from.x + to.x) / 2;
          const y = (from.y + to.y) / 2;
          const label = RELATION_LABEL[edge.relation];
          const width = label.length * 10 + 14;
          return (
            <g key={`label-${edge.id}`} className={edge.justAdded ? 'label-in' : undefined}>
              <rect x={x - width / 2} y={y - 9} width={width} height="18" fill="#f7f5ef" stroke={edge.isNew ? SUPPLEMENT_COLOR : '#bdb8ad'} />
              <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={edge.isNew ? SUPPLEMENT_COLOR : '#5f5b53'}>{label}</text>
            </g>
          );
        })}
      </g>

      <g>
        {nodes.map((node) => {
          const isFocus = focusId === node.id;
          const isNeighbor = neighborIds.has(node.id);
          const frontier = frontierIds.has(node.id);
          // 보충 개념의 출처는 영속 데이터다. isNew는 이번 실행의 등장 연출에만 쓴다.
          const isSupplement = node.origin === 'conversation';
          const filtered = filter === 'weak'
            ? weakContext.has(node.id)
            : filter === 'frontier'
              ? frontierContext.has(node.id)
              : true;
          const dimmed = !filtered || (!!focusId && !isFocus && !isNeighbor);
          const labelLines = wrapLabel(node.name, 20);
          return (
            <g
              key={node.id}
              data-testid={`node-${node.id}`}
              role="button"
              tabIndex={0}
              aria-label={`${node.name} 노드 열기`}
              transform={`translate(${node.x},${node.y})`}
              opacity={node.removing ? 0 : dimmed ? 0.18 : 1}
              className={node.removing ? 'fading' : undefined}
              style={{ cursor: 'pointer', transition: 'opacity 160ms ease' }}
              onMouseEnter={() => setHoverId(node.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(node.id);
                }
              }}
            >
              <g className={node.justAdded ? 'node-pop' : undefined}>
                {node.justAdded && <circle r="18" fill="none" stroke={SUPPLEMENT_COLOR} strokeWidth="1.5" className="ring-pulse" />}
                {node.flash && <circle r="20" fill="none" stroke="#d85b35" strokeWidth="2" className="flash-ring" />}
                {isSupplement && <circle r="19" fill="none" stroke={SUPPLEMENT_COLOR} strokeWidth="1.5" strokeDasharray="3 2" />}
                {frontier && !isSupplement && node.status === 'unlearned' && <circle r="20" fill="none" stroke="#255c99" strokeDasharray="2 4" />}

                {node.status === 'weak' ? (
                  <rect x="-11" y="-11" width="22" height="22" transform="rotate(45)" fill="#d85b35" stroke="#9f4025" strokeWidth="2" />
                ) : isSupplement ? (
                  <rect
                    x="-10"
                    y="-10"
                    width="20"
                    height="20"
                    fill={node.status === 'unlearned' ? '#f7f5ef' : SUPPLEMENT_COLOR}
                    stroke={SUPPLEMENT_DARK}
                    strokeWidth="2"
                    strokeDasharray={node.status === 'unlearned' ? '3 2' : undefined}
                  />
                ) : (
                  <circle
                    r={node.status === 'learned' ? 10 : 8}
                    fill={node.status === 'learned' ? '#262624' : '#f7f5ef'}
                    stroke={node.status === 'learned' ? '#262624' : '#817c72'}
                    strokeWidth="2"
                    strokeDasharray={node.status === 'unlearned' ? '3 2' : undefined}
                  />
                )}

                {isSupplement && <text x="0" y="-27" textAnchor="middle" fontSize="7.5" fontWeight="900" fill={SUPPLEMENT_COLOR}>{node.status === 'unlearned' ? 'ADDENDUM · 미학습' : 'ADDENDUM'}</text>}
                {noteIds.has(node.id) && <g><title>연결된 노트 코멘트 또는 약점 기록 있음</title><circle cx="13" cy="-13" r="4" fill="#f7f5ef" stroke="#d85b35" strokeWidth="2" /></g>}
                {frontier && !isSupplement && <text x="0" y="-27" textAnchor="middle" fontSize="8.5" fontWeight="900" fill="#255c99">NEXT</text>}
              </g>

              <g pointerEvents="none">
                <rect x="-5" y="17" width={Math.max(...labelLines.map((line) => line.length), 4) * 6.4 + 12} height={labelLines.length * 14 + 5} fill="#f7f5ef" fillOpacity="0.9" />
                <text x="1" textAnchor="start" fontSize="11" fontWeight={isFocus ? 900 : 650} fill="#2f2e2a">
                  {labelLines.map((line, index) => <tspan key={line} x="1" y={30 + index * 14}>{line}</tspan>)}
                </text>
              </g>
            </g>
          );
        })}
      </g>

      {hovered && !compact && (
        <g transform="translate(738,586)" pointerEvents="none">
          <rect width="280" height="116" fill="#f1ede4" stroke="#262624" />
          <text x="14" y="21" fontSize="9" fontWeight="900" letterSpacing="1.4" fill="#77736a">CONCEPT INDEX</text>
          <text x="14" y="45" fontSize="15" fontWeight="900" fill="#262624">{hovered.name}</text>
          <text x="14" y="65" fontSize="10" fill="#77736a">{hovered.status === 'weak' ? '약점 기록 있음' : hovered.status === 'learned' ? '학습 완료' : '아직 학습하지 않음'} · 연결 {edges.filter((edge) => edge.from_id === hovered.id || edge.to_id === hovered.id).length}개</text>
          <line x1="14" y1="78" x2="266" y2="78" stroke="#c7c2b8" />
          <text x="14" y="99" fontSize="10.5" fontWeight="700" fill="#255c99">클릭하여 요약과 근거 열기 →</text>
        </g>
      )}
    </svg>
  );
}
