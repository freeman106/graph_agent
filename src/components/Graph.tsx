import { useMemo, useState } from 'react';
import {
  GRAPH_VIEWBOX,
  NEW_STYLE,
  STATUS_STYLE,
  wrapLabel,
  type RuntimeEdge,
  type RuntimeNode,
} from '../mock';

const R = 22;

interface Props {
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  selectedId: string | null;
  noteIds: Set<string>;
  onSelect: (id: string | null) => void;
}

/** 선을 두 노드의 원 바깥에서 시작/끝나게 자른다. */
function trim(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  return {
    x1: ax + ux * (R + 2),
    y1: ay + uy * (R + 2),
    x2: bx - ux * (R + 9),
    y2: by - uy * (R + 9),
    len: Math.max(d - (2 * R + 11), 1),
  };
}

export default function Graph({ nodes, edges, selectedId, noteIds, onSelect }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const focusId = hoverId ?? selectedId;

  /** 포커스된 노드에 붙은 간선은 라벨을 보여준다. */
  const focusedEdges = useMemo(() => {
    if (!focusId) return new Set<string>();
    return new Set(
      edges.filter((e) => e.source === focusId || e.target === focusId).map((e) => e.id),
    );
  }, [edges, focusId]);

  const neighborIds = useMemo(() => {
    if (!focusId) return new Set<string>();
    const s = new Set<string>();
    for (const e of edges) {
      if (e.source === focusId) s.add(e.target);
      if (e.target === focusId) s.add(e.source);
    }
    return s;
  }, [edges, focusId]);

  return (
    <svg
      viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
      className="h-full w-full"
      onClick={() => onSelect(null)}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="#b6c2d2" />
        </marker>
        <marker
          id="arrow-new"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="#8b5cf6" />
        </marker>
        <marker
          id="arrow-focus"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="#475569" />
        </marker>
      </defs>

      {/* ── 간선 ───────────────────────────────── */}
      <g>
        {edges.map((e) => {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) return null;
          const g = trim(a.x, a.y, b.x, b.y);
          const focused = focusedEdges.has(e.id);
          const dim = !!focusId && !focused;
          const color = e.isNew ? '#a78bfa' : focused ? '#475569' : '#cbd5e1';
          const marker = e.isNew ? 'arrow-new' : focused ? 'arrow-focus' : 'arrow';
          return (
            <line
              key={e.id}
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              stroke={color}
              strokeWidth={e.isNew ? 2 : focused ? 1.8 : 1.2}
              markerEnd={`url(#${marker})`}
              opacity={e.removing ? 0 : dim ? 0.28 : 1}
              className={
                e.removing ? 'fading' : e.justAdded ? 'edge-draw' : undefined
              }
              style={
                e.justAdded ? ({ ['--len' as string]: `${g.len}` } as React.CSSProperties) : undefined
              }
            />
          );
        })}
      </g>

      {/* ── 관계 라벨 (신규 간선은 항상, 나머지는 포커스 시) ── */}
      <g>
        {edges.map((e) => {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) return null;
          const show = e.isNew || focusedEdges.has(e.id);
          if (!show || e.removing) return null;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const w = e.relation.replace(/\s/g, '').length * 10.5 + 16;
          return (
            <g
              key={`l-${e.id}`}
              className={e.justAdded ? 'label-in' : undefined}
              style={{ pointerEvents: 'none' }}
            >
              <rect
                x={mx - w / 2}
                y={my - 9}
                width={w}
                height={18}
                rx={9}
                fill={e.isNew ? '#f5f3ff' : '#ffffff'}
                stroke={e.isNew ? '#c4b5fd' : '#e2e8f0'}
                strokeWidth={1}
              />
              <text
                x={mx}
                y={my + 4}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={600}
                fill={e.isNew ? '#6d28d9' : '#64748b'}
              >
                {e.relation}
              </text>
            </g>
          );
        })}
      </g>

      {/* ── 노드 ───────────────────────────────── */}
      <g>
        {nodes.map((n) => {
          const s = STATUS_STYLE[n.status];
          const isFocus = focusId === n.id;
          const isNeighbor = neighborIds.has(n.id);
          const dim = !!focusId && !isFocus && !isNeighbor;
          const fill = n.justAdded ? NEW_STYLE.fill : s.fill;
          const stroke = n.justAdded ? NEW_STYLE.stroke : s.stroke;
          const lines = wrapLabel(n.label);

          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className={n.removing ? 'fading' : undefined}
              opacity={n.removing ? 0 : dim ? 0.32 : 1}
              style={{ cursor: 'pointer', transition: 'opacity 200ms ease' }}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelect(n.id);
              }}
            >
              <g className={n.justAdded ? 'node-pop' : undefined}>
                {/* 새 노드가 막 등장할 때 퍼지는 링 */}
                {n.justAdded && (
                  <circle r={22} fill="none" stroke={NEW_STYLE.fill} strokeWidth={2.5} className="ring-pulse" />
                )}
                {/* 검수 반영 순간의 번쩍임 */}
                {n.flash && (
                  <circle r={24} fill="none" stroke="#0ea5e9" strokeWidth={3} className="flash-ring" />
                )}
                {/* 선택 링 */}
                {selectedId === n.id && (
                  <circle r={R + 7} fill="none" stroke="#0f172a" strokeWidth={2} opacity={0.75} />
                )}
                {/* 이번 실행에서 추가된 노드는 보라 테두리를 계속 유지 */}
                {n.isNew && !n.justAdded && (
                  <circle r={R + 4} fill="none" stroke={NEW_STYLE.fill} strokeWidth={2} opacity={0.85} />
                )}

                <circle
                  r={R}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={2}
                  strokeDasharray={s.dashed && !n.justAdded ? '4 3' : undefined}
                  style={{ transition: 'fill 500ms ease, stroke 500ms ease' }}
                />

                {/* 약점 배지 */}
                {n.status === 'weak' && (
                  <>
                    <circle cx={16} cy={-16} r={8.5} fill="#dc2626" stroke="#ffffff" strokeWidth={2} />
                    <text
                      x={16}
                      y={-12.2}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={800}
                      fill="#ffffff"
                    >
                      !
                    </text>
                  </>
                )}
                {/* 강의노트 보유 표시 */}
                {noteIds.has(n.id) && n.status !== 'weak' && (
                  <circle cx={16} cy={-16} r={5.5} fill="#0f172a" stroke="#ffffff" strokeWidth={2} />
                )}
              </g>

              <text
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={isFocus ? 700 : 600}
                fill={n.status === 'unlearned' ? '#64748b' : '#1e293b'}
                style={{ pointerEvents: 'none' }}
              >
                {lines.map((ln, i) => (
                  <tspan key={i} x={0} y={R + 15 + i * 13}>
                    {ln}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
