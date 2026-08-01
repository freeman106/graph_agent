import { useMemo } from 'react';
import type { RuntimeEdge, RuntimeNode } from '../mock';

interface Props {
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  onSelect: (id: string) => void;
}

const stateWeight = (node: RuntimeNode) => {
  if (node.status === 'learned') return 22;
  if (node.status === 'introduced') return 12;
  if (node.status === 'weak') return 7;
  return 0;
};

export default function SideRail({ nodes, edges, onSelect }: Props) {
  const frontier = useMemo(() => {
    const active = new Set(nodes.filter((n) => n.status !== 'unlearned').map((n) => n.id));

    return nodes
      .filter((n) => n.status === 'unlearned')
      .map((node) => {
        const via = Array.from(
          new Set(
            edges
              .filter((edge) => edge.source === node.id || edge.target === node.id)
              .map((edge) => (edge.source === node.id ? edge.target : edge.source))
              .filter((id) => active.has(id)),
          ),
        )
          .map((id) => nodes.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is RuntimeNode => Boolean(candidate));

        const readiness = Math.min(
          96,
          48 + via.reduce((score, prerequisite) => score + stateWeight(prerequisite), 0),
        );
        return { node, via, readiness };
      })
      .filter((item) => item.via.length > 0)
      .sort((a, b) => b.readiness - a.readiness || b.via.length - a.via.length);
  }, [nodes, edges]);

  return (
    <aside className="light-scroll flex w-[260px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-[#f8fafc] px-4 py-4">
      <section>
        <div className="mb-1 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.12)]" />
          <h3 className="text-[10.5px] font-extrabold tracking-[0.12em] text-slate-500">
            KNOWLEDGE FRONTIER
          </h3>
        </div>
        <h2 className="mt-2 text-[17px] font-bold tracking-tight text-slate-900">지금 배울 수 있는 경계</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          이미 이해한 개념을 발판으로, 가장 적은 노력으로 열 수 있는 다음 지점입니다.
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          {frontier.slice(0, 5).map(({ node, via, readiness }, index) => (
            <button
              key={node.id}
              onClick={() => onSelect(node.id)}
              className={`group w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                index === 0
                  ? 'border-sky-200 bg-gradient-to-br from-sky-50 to-white shadow-sm'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-black ${
                    index === 0 ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-tight font-bold text-slate-800 group-hover:text-sky-700">
                    {node.label}
                  </div>
                  <div className="mt-1 text-[10.5px] leading-snug text-slate-400">
                    {via.map((item) => item.label).join(' · ')}에서 연결
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[9.5px] font-semibold">
                  <span className="text-slate-400">학습 준비도</span>
                  <span className={index === 0 ? 'text-sky-600' : 'text-slate-500'}>
                    {readiness}%
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={index === 0 ? 'h-full rounded-full bg-sky-500' : 'h-full rounded-full bg-slate-300'}
                    style={{ width: `${readiness}%` }}
                  />
                </div>
              </div>

              {index === 0 && (
                <div className="mt-2.5 flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-slate-500">약 12분</span>
                  <span className="font-bold text-sky-600">가장 큰 확장 효과 →</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      <div className="mt-auto pt-5">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold tracking-wider text-slate-400">학습 원칙</div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            대화에 등장한 것과 이해한 것은 다릅니다. 직접 설명하거나 문제를 풀어야 초록색이 됩니다.
          </p>
        </div>
      </div>
    </aside>
  );
}
