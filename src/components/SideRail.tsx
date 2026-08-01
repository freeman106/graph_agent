import { useMemo } from 'react';
import type { RuntimeEdge, RuntimeNode } from '../mock';

interface Props {
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  onSelect: (id: string) => void;
}

export default function SideRail({ nodes, edges, onSelect }: Props) {
  /**
   * "다음에 공부할 것"은 따로 만드는 로드맵이 아니라 그래프에서 저절로 파생된다.
   * = 이미 학습한(또는 약점으로 표시된) 노드에 인접한 미학습 노드.
   */
  const nextUp = useMemo(() => {
    const studied = new Set(nodes.filter((n) => n.status !== 'unlearned').map((n) => n.id));
    return nodes
      .filter((n) => n.status === 'unlearned')
      .map((n) => {
        const via = Array.from(
          new Set(
            edges
              .filter((e) => e.source === n.id || e.target === n.id)
              .map((e) => (e.source === n.id ? e.target : e.source))
              .filter((id) => studied.has(id)),
          ),
        );
        return { node: n, via };
      })
      .filter((i) => i.via.length > 0)
      .sort((a, b) => b.via.length - a.via.length);
  }, [nodes, edges]);

  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <aside className="light-scroll flex w-[212px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-slate-200 bg-slate-50/70 px-4 py-4">
      {/* 다음에 공부할 것 */}
      <section>
        <h3 className="text-[10.5px] font-bold tracking-wider text-slate-400">다음에 공부할 것</h3>
        <p className="mt-1 mb-2 text-[10.5px] leading-snug text-slate-400">
          학습 완료 노드에 붙어 있는 미학습 노드. 그래프에서 저절로 나온다.
        </p>
        <ul className="flex flex-col gap-1.5">
          {nextUp.map(({ node, via }) => (
            <li key={node.id}>
              <button
                onClick={() => onSelect(node.id)}
                className="w-full rounded-md border border-slate-200 bg-white/60 px-2.5 py-2 text-left transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-slate-400 bg-white" />
                  <span className="text-[12px] leading-tight font-semibold text-slate-700">
                    {node.label}
                  </span>
                </div>
                <div className="mt-1 pl-3.5 text-[10.5px] leading-snug text-slate-400">
                  {via.map(labelOf).join(' · ')} 다음
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
