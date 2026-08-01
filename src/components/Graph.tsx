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
const CENTER = { x: GRAPH_VIEWBOX.width / 2, y: GRAPH_VIEWBOX.height / 2 - 8 };

export type GraphMode = 'atlas' | 'orbit' | 'story';
export type DetailLevel = 'regions' | 'links' | 'concepts';

interface Props {
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  selectedId: string | null;
  noteIds: Set<string>;
  frontierIds: Set<string>;
  mode: GraphMode;
  detailLevel: DetailLevel;
  goalId: string;
  onSelect: (id: string | null) => void;
}

type Position = { x: number; y: number; depth?: number };

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

function wrapText(value: string, maxLength = 30, maxLines = 3) {
  const words = value.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxLength) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').length;
  if (consumed < value.length - 2 && lines.length) lines[lines.length - 1] += '…';
  return lines;
}

function shortestDepths(nodes: RuntimeNode[], edges: RuntimeEdge[], goalId: string) {
  const depths = new Map<string, number>([[goalId, 0]]);
  const queue = [goalId];
  while (queue.length) {
    const current = queue.shift()!;
    const depth = depths.get(current)!;
    if (depth >= 3) continue;
    for (const edge of edges) {
      const neighbor = edge.source === current ? edge.target : edge.target === current ? edge.source : null;
      if (neighbor && !depths.has(neighbor)) {
        depths.set(neighbor, depth + 1);
        queue.push(neighbor);
      }
    }
  }
  return new Map(nodes.map((node) => [node.id, depths.get(node.id) ?? 4]));
}

function orbitPositions(nodes: RuntimeNode[], depths: Map<string, number>) {
  const positions = new Map<string, Position>();
  const radii = [0, 118, 224, 320, 405];
  for (let depth = 0; depth <= 4; depth++) {
    const layer = nodes
      .filter((node) => depths.get(node.id) === depth)
      .sort((a, b) => Math.atan2(a.y - CENTER.y, a.x - CENTER.x) - Math.atan2(b.y - CENTER.y, b.x - CENTER.x));
    layer.forEach((node, index) => {
      if (depth === 0) {
        positions.set(node.id, { ...CENTER, depth });
        return;
      }
      const offset = depth % 2 ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / Math.max(layer.length, 2);
      const angle = offset + (Math.PI * 2 * index) / Math.max(layer.length, 1);
      positions.set(node.id, {
        x: CENTER.x + Math.cos(angle) * radii[depth],
        y: CENTER.y + Math.sin(angle) * radii[depth] * 0.78,
        depth,
      });
    });
  }
  return positions;
}

function StoryView({ nodes, noteIds, onSelect }: Pick<Props, 'nodes' | 'noteIds' | 'onSelect'>) {
  const storyIds = [
    'query-key-value',
    'self-attention',
    'masked-attention',
    'kv-cache',
    'grouped-query-attention',
  ];
  const storyNodes = storyIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is RuntimeNode => Boolean(node));
  const stages = [
    { x: 150, label: '기존 지식', sub: '대화 이전' },
    { x: 385, label: '개념 연결', sub: '이번 대화' },
    { x: 625, label: '오해 발견', sub: '정정 순간' },
    { x: 865, label: '내 말로 검증', sub: '학습 완료' },
  ];

  return (
    <svg viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`} className="h-full w-full">
      <defs>
        <linearGradient id="story-bg" x1="0" x2="1">
          <stop offset="0" stopColor="#f8fafc" />
          <stop offset="0.58" stopColor="#fff7ed" />
          <stop offset="1" stopColor="#ecfdf5" />
        </linearGradient>
      </defs>
      <rect x="56" y="82" width="948" height="574" rx="30" fill="url(#story-bg)" stroke="#e2e8f0" />
      <text x="76" y="48" fontSize="18" fontWeight="800" fill="#0f172a">지식이 바뀐 순간을 따라가세요</text>
      <text x="76" y="70" fontSize="11" fill="#64748b">노드는 위치가 아니라 시간 위를 흐릅니다 · 선을 클릭하면 근거를 볼 수 있습니다</text>
      {stages.map((stage, index) => (
        <g key={stage.label}>
          <line x1={stage.x} y1="124" x2={stage.x} y2="626" stroke="#cbd5e1" strokeDasharray="3 6" />
          <circle cx={stage.x} cy="112" r="15" fill={index === 2 ? '#f59e0b' : index === 3 ? '#10b981' : '#0f172a'} />
          <text x={stage.x} y="116" textAnchor="middle" fontSize="10" fontWeight="900" fill="white">{index + 1}</text>
          <text x={stage.x} y="680" textAnchor="middle" fontSize="12" fontWeight="800" fill="#334155">{stage.label}</text>
          <text x={stage.x} y="698" textAnchor="middle" fontSize="10" fill="#94a3b8">{stage.sub}</text>
        </g>
      ))}
      {storyNodes.map((node, index) => {
        const y = 178 + index * 92;
        const knownBefore = index < 3;
        const learnedNow = noteIds.has(node.id);
        const isWeak = node.status === 'weak';
        const endX = learnedNow || knownBefore ? 865 : 625;
        const stroke = isWeak ? '#f59e0b' : learnedNow ? '#8b5cf6' : '#64748b';
        return (
          <g key={node.id} onClick={() => onSelect(node.id)} style={{ cursor: 'pointer' }}>
            <path
              d={`M ${knownBefore ? 150 : 385} ${y} C 270 ${y - 18}, 500 ${y + 18}, ${endX} ${y}`}
              fill="none"
              stroke={stroke}
              strokeWidth={node.id === 'kv-cache' ? 5 : 3}
              strokeDasharray={!learnedNow && !knownBefore ? '7 6' : undefined}
              opacity={0.82}
            />
            {[knownBefore ? 150 : 385, 385, ...(node.id === 'kv-cache' ? [625] : []), endX].map((x, i) => (
              <circle key={`${x}-${i}`} cx={x} cy={y} r={x === 625 && node.id === 'kv-cache' ? 9 : 5.5} fill={x === 625 && node.id === 'kv-cache' ? '#f59e0b' : stroke} stroke="white" strokeWidth="2" />
            ))}
            <rect x="68" y={y - 18} width="146" height="35" rx="10" fill="white" stroke="#e2e8f0" />
            <text x="81" y={y + 4} fontSize="11.5" fontWeight="750" fill="#1e293b">{node.label}</text>
            {node.id === 'kv-cache' && (
              <g>
                <rect x="562" y={y - 38} width="126" height="22" rx="11" fill="#fff7ed" stroke="#fed7aa" />
                <text x="625" y={y - 23} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#c2410c">학습에도 캐시? → 정정</text>
              </g>
            )}
          </g>
        );
      })}
      {!noteIds.size && (
        <g>
          <rect x="352" y="590" width="356" height="38" rx="19" fill="#0f172a" />
          <text x="530" y="614" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">대화를 분석하면 오해와 교정의 흐름이 여기에 생깁니다</text>
        </g>
      )}
    </svg>
  );
}

export default function Graph({
  nodes,
  edges,
  selectedId,
  noteIds,
  frontierIds,
  mode,
  detailLevel,
  goalId,
  onSelect,
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const depths = useMemo(() => shortestDepths(nodes, edges, goalId), [nodes, edges, goalId]);
  const orbit = useMemo(() => orbitPositions(nodes, depths), [nodes, depths]);
  const positions = useMemo(
    () => new Map(nodes.map((node) => [node.id, mode === 'orbit' ? orbit.get(node.id) ?? node : node])),
    [nodes, mode, orbit],
  );
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const interactionFocus = hoverId ?? selectedId;
  const focusId = interactionFocus ?? (mode === 'orbit' ? goalId : null);
  const focusedEdges = useMemo(() => {
    if (!focusId) return new Set<string>();
    return new Set(edges.filter((edge) => edge.source === focusId || edge.target === focusId).map((edge) => edge.id));
  }, [edges, focusId]);
  const neighborIds = useMemo(() => {
    if (!focusId) return new Set<string>();
    const result = new Set<string>();
    for (const edge of edges) {
      if (edge.source === focusId) result.add(edge.target);
      if (edge.target === focusId) result.add(edge.source);
    }
    return result;
  }, [edges, focusId]);

  if (mode === 'story') return <StoryView nodes={nodes} noteIds={noteIds} onSelect={onSelect} />;

  const hoveredNode = hoverId ? byId.get(hoverId) : null;
  const hoveredPosition = hoverId ? positions.get(hoverId) : null;
  const episodeNodes = nodes.filter((node) => noteIds.has(node.id)).map((node) => positions.get(node.id)).filter((item): item is Position => Boolean(item));
  const episodeBounds = episodeNodes.length > 1
    ? {
        x: Math.min(...episodeNodes.map((p) => p.x)) - 62,
        y: Math.min(...episodeNodes.map((p) => p.y)) - 62,
        width: Math.max(...episodeNodes.map((p) => p.x)) - Math.min(...episodeNodes.map((p) => p.x)) + 124,
        height: Math.max(...episodeNodes.map((p) => p.y)) - Math.min(...episodeNodes.map((p) => p.y)) + 124,
      }
    : null;

  return (
    <svg viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`} className="h-full w-full" onClick={() => onSelect(null)}>
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#b6c2d2" /></marker>
        <marker id="arrow-new" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#8b5cf6" /></marker>
        <marker id="arrow-focus" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#334155" /></marker>
        <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.13" /></filter>
      </defs>

      {mode === 'atlas' && (
        <g className="atlas-regions">
          <rect x="30" y="35" width="180" height="520" rx="88" fill="#f0f9ff" stroke="#bae6fd" />
          <text x="68" y="62" fontSize="10" fontWeight="800" letterSpacing="1.5" fill="#0284c7">INPUT COAST</text>
          <path d="M215 35 H685 C725 35 748 70 730 112 L690 202 C676 236 680 324 715 352 L735 370 C768 399 755 520 690 554 H210 C250 488 225 428 205 365 C184 298 214 247 228 191 C240 143 213 92 215 35Z" fill="#f5f3ff" stroke="#ddd6fe" />
          <text x="255" y="62" fontSize="10" fontWeight="800" letterSpacing="1.5" fill="#7c3aed">ATTENTION BASIN</text>
          <rect x="705" y="35" width="325" height="500" rx="72" fill="#f0fdf4" stroke="#bbf7d0" />
          <text x="760" y="62" fontSize="10" fontWeight="800" letterSpacing="1.5" fill="#16a34a">TRANSFORMER RIDGE</text>
          <path d="M45 545 C180 510 284 530 390 565 C500 602 621 508 735 522 C865 538 976 580 1020 720 H45Z" fill="#fff7ed" stroke="#fed7aa" />
          <text x="76" y="704" fontSize="10" fontWeight="800" letterSpacing="1.5" fill="#ea580c">DECODING DELTA</text>
        </g>
      )}

      {mode === 'orbit' && (
        <g>
          {[118, 224, 320].map((radius, index) => (
            <g key={radius}>
              <ellipse cx={CENTER.x} cy={CENTER.y} rx={radius} ry={radius * 0.78} fill={index % 2 ? '#f8fafc' : 'none'} stroke="#cbd5e1" strokeDasharray={index === 2 ? '5 7' : undefined} />
              <text x={CENTER.x + radius + 8} y={CENTER.y + 4} fontSize="9" fontWeight="700" fill="#94a3b8">{index === 0 ? '직접 연결' : index === 1 ? '선행 2단계' : '확장 지식'}</text>
            </g>
          ))}
          <text x={CENTER.x} y="46" textAnchor="middle" fontSize="11" fontWeight="800" fill="#64748b">목표까지의 거리가 지식의 궤도가 됩니다</text>
        </g>
      )}

      {mode === 'atlas' && episodeBounds && (
        <g pointerEvents="none">
          <rect {...episodeBounds} rx="62" fill="#8b5cf6" fillOpacity="0.055" stroke="#8b5cf6" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="7 6" />
          <rect x={episodeBounds.x + 18} y={episodeBounds.y - 13} width="132" height="25" rx="12.5" fill="#6d28d9" />
          <text x={episodeBounds.x + 84} y={episodeBounds.y + 4} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="white">이번 학습 에피소드</text>
        </g>
      )}

      <g>
        {edges.map((edge) => {
          const a = positions.get(edge.source);
          const b = positions.get(edge.target);
          if (!a || !b) return null;
          const geometry = trim(a.x, a.y, b.x, b.y);
          const focused = focusedEdges.has(edge.id);
          const pathRelevant = mode !== 'orbit' || ((depths.get(edge.source) ?? 4) <= 3 && (depths.get(edge.target) ?? 4) <= 3);
          const dim = (!!focusId && !focused) || !pathRelevant || detailLevel === 'regions';
          const color = edge.isNew ? '#a78bfa' : focused ? '#334155' : '#cbd5e1';
          const marker = edge.isNew ? 'arrow-new' : focused ? 'arrow-focus' : 'arrow';
          return <line key={edge.id} x1={geometry.x1} y1={geometry.y1} x2={geometry.x2} y2={geometry.y2} stroke={color} strokeWidth={edge.isNew ? 2 : focused ? 2 : 1.1} markerEnd={`url(#${marker})`} opacity={edge.removing ? 0 : dim ? 0.14 : 0.85} className={edge.removing ? 'fading' : edge.justAdded ? 'edge-draw' : undefined} style={edge.justAdded ? ({ ['--len' as string]: `${geometry.len}` } as React.CSSProperties) : undefined} />;
        })}
      </g>

      <g>
        {edges.map((edge) => {
          const a = positions.get(edge.source);
          const b = positions.get(edge.target);
          if (!a || !b || edge.removing) return null;
          const show = edge.isNew || focusedEdges.has(edge.id) || detailLevel === 'concepts';
          if (!show) return null;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const width = edge.relation.replace(/\s/g, '').length * 10.5 + 16;
          return (
            <g key={`label-${edge.id}`} pointerEvents="none" opacity={focusId && !focusedEdges.has(edge.id) ? 0.15 : 1}>
              <rect x={mx - width / 2} y={my - 9} width={width} height="18" rx="9" fill={edge.isNew ? '#f5f3ff' : 'white'} stroke={edge.isNew ? '#c4b5fd' : '#e2e8f0'} />
              <text x={mx} y={my + 4} textAnchor="middle" fontSize="10" fontWeight="650" fill={edge.isNew ? '#6d28d9' : '#64748b'}>{edge.relation}</text>
            </g>
          );
        })}
      </g>

      <g>
        {nodes.map((node) => {
          const position = positions.get(node.id) ?? node;
          const style = STATUS_STYLE[node.status];
          const isFocus = focusId === node.id;
          const isGoal = mode === 'orbit' && goalId === node.id;
          const isNeighbor = neighborIds.has(node.id);
          const outsideOrbit = mode === 'orbit' && (depths.get(node.id) ?? 4) > 3;
          const dim =
            mode === 'orbit'
              ? outsideOrbit || (!!interactionFocus && !isFocus && !isNeighbor)
              : !!focusId && !isFocus && !isNeighbor;
          const fill = node.justAdded ? NEW_STYLE.fill : style.fill;
          const stroke = node.justAdded ? NEW_STYLE.stroke : style.stroke;
          const lines = wrapLabel(node.label);
          const isFrontier = frontierIds.has(node.id);
          const hideLabel = detailLevel === 'regions' && !isFocus && !isGoal && node.status !== 'weak';
          return (
            <g key={node.id} transform={`translate(${position.x},${position.y})`} className={node.removing ? 'fading' : undefined} opacity={node.removing ? 0 : dim ? 0.2 : 1} style={{ cursor: 'pointer', transition: 'opacity 200ms ease' }} onMouseEnter={() => setHoverId(node.id)} onMouseLeave={() => setHoverId(null)} onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}>
              <g className={node.justAdded ? 'node-pop' : undefined}>
                {node.justAdded && <circle r={22} fill="none" stroke={NEW_STYLE.fill} strokeWidth={2.5} className="ring-pulse" />}
                {node.flash && <circle r={24} fill="none" stroke="#0ea5e9" strokeWidth={3} className="flash-ring" />}
                {(selectedId === node.id || isGoal) && <circle r={isGoal ? R + 10 : R + 7} fill="none" stroke={isGoal ? '#7c3aed' : '#0f172a'} strokeWidth={isGoal ? 3 : 2} opacity={0.78} />}
                {isGoal && <circle r={R + 17} fill="none" stroke="#c4b5fd" strokeWidth="1.5" strokeDasharray="4 5" className="goal-orbit" />}
                {isFrontier && !node.justAdded && !isGoal && (
                  <>
                    <circle r={R + 6} fill="none" stroke="#0ea5e9" strokeWidth={1.6} strokeDasharray="3 3" />
                    <rect x={-17} y={-35} width={34} height={13} rx={6.5} fill="#e0f2fe" />
                    <text x="0" y={-25.5} textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#0369a1">NEXT</text>
                  </>
                )}
                {node.isNew && !node.justAdded && <circle r={R + 4} fill="none" stroke={NEW_STYLE.fill} strokeWidth={2} opacity={0.85} />}
                <circle r={isGoal ? R + 2 : R} fill={fill} stroke={stroke} strokeWidth={isGoal ? 3 : 2} strokeDasharray={style.dashed && !node.justAdded ? '4 3' : undefined} />
                {node.status === 'weak' && <><circle cx="16" cy="-16" r="8.5" fill="#dc2626" stroke="white" strokeWidth="2" /><text x="16" y="-12.2" textAnchor="middle" fontSize="11" fontWeight="800" fill="white">!</text></>}
                {noteIds.has(node.id) && node.status !== 'weak' && <circle cx="16" cy="-16" r="5.5" fill="#0f172a" stroke="white" strokeWidth="2" />}
              </g>
              {!hideLabel && <text textAnchor="middle" fontSize={isGoal ? 12.5 : 11.5} fontWeight={isFocus || isGoal ? 800 : 600} fill={node.status === 'unlearned' ? '#64748b' : '#1e293b'} pointerEvents="none">{lines.map((line, index) => <tspan key={line} x="0" y={R + 15 + index * 13}>{line}</tspan>)}</text>}
            </g>
          );
        })}
      </g>

      {hoveredNode && hoveredPosition && (
        <g transform={`translate(${hoveredPosition.x > 760 ? hoveredPosition.x - 282 : hoveredPosition.x + 35},${Math.max(76, Math.min(hoveredPosition.y - 70, 565))})`} pointerEvents="none" filter="url(#soft-shadow)">
          <rect width="248" height="116" rx="16" fill="#0f172a" fillOpacity="0.96" />
          <text x="16" y="24" fontSize="9" fontWeight="800" letterSpacing="1.3" fill="#7dd3fc">CONCEPT LENS</text>
          <text x="16" y="48" fontSize="14" fontWeight="800" fill="white">{hoveredNode.label}</text>
          {wrapText(hoveredNode.summary).map((line, index) => <text key={line} x="16" y={69 + index * 15} fontSize="10.5" fill="#94a3b8">{line}</text>)}
          <text x="232" y="101" textAnchor="end" fontSize="9.5" fontWeight="700" fill="#7dd3fc">클릭하여 근거 보기 →</text>
        </g>
      )}
    </svg>
  );
}
