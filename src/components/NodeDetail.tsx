import { STATUS_LABEL } from '../../contract/schema';
import { STATUS_STYLE, type RuntimeEdge, type RuntimeNode } from '../view';

interface Props {
  node: RuntimeNode;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

/**
 * 노드 패널.
 *
 * 강의노트를 위한 별도 타입이 없다 — 계약 A 의 Node.summary 와 Node.weakpoints[] 를
 * 그대로 렌더링한다. 백엔드가 mark_progress(weakpoint=...) 로 쓴 것이 여기 그대로 뜬다.
 */
export default function NodeDetail({ node, nodes, edges, onSelect, onClose }: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const linkedIds = Array.from(
    new Set(
      edges
        .filter((e) => e.from_id === node.id || e.to_id === node.id)
        .map((e) => (e.from_id === node.id ? e.to_id : e.from_id)),
    ),
  );

  const status = STATUS_STYLE[node.status];

  return (
    <aside className="light-scroll flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 pt-4 pb-3 backdrop-blur">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: status.fill, border: `1.5px solid ${status.stroke}` }}
              />
              <span className="text-[11px] font-semibold text-slate-500">
                {STATUS_LABEL[node.status]}
              </span>
              {node.isNew && (
                <span className="rounded-full bg-violet-100 px-2 py-[1px] text-[10px] font-semibold text-violet-700">
                  이번 실행 추가
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-[19px] leading-tight font-bold text-slate-900">
              {node.name}
            </h2>
            {node.aliases.length > 0 && (
              <div className="mt-1 font-mono-term text-[10.5px] text-slate-400">
                {node.aliases.join(' · ')}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="-mt-1 shrink-0 rounded-md px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-5 py-4">
        {/* 개념 요약 */}
        <section>
          <h3 className="mb-1.5 text-[11px] font-bold tracking-wider text-slate-400">개념 요약</h3>
          <p className="text-[13.5px] leading-relaxed text-slate-700">{node.summary}</p>
        </section>

        {/* 막혔던 지점 — 이 제품의 차별점 */}
        {node.weakpoints.map((wp, wi) => (
          <div key={wi} className="flex flex-col gap-4">
            <section className="rounded-lg border-l-[3px] border-amber-400 bg-amber-50 py-3 pr-3 pl-3.5">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-amber-800">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-[10px] font-black text-white">
                  !
                </span>
                이 대화에서 막혔던 지점
              </h3>
              <p className="text-[13px] leading-relaxed text-amber-950">{wp.description}</p>
            </section>

            {(wp.misconception || wp.correction) && (
              <section>
                <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400">
                  오해했다 정정된 부분
                </h3>
                <div className="flex flex-col gap-1.5">
                  {wp.misconception && (
                    <div className="rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2">
                      <div className="mb-1 text-[10px] font-bold tracking-wide text-rose-500">
                        정정 전
                      </div>
                      <p className="text-[13px] leading-relaxed text-rose-950 line-through decoration-rose-300">
                        {wp.misconception}
                      </p>
                    </div>
                  )}
                  {wp.misconception && wp.correction && (
                    <div className="pl-3 text-[13px] leading-none text-slate-300">↓</div>
                  )}
                  {wp.correction && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                      <div className="mb-1 text-[10px] font-bold tracking-wide text-emerald-600">
                        정정 후
                      </div>
                      <p className="text-[13px] leading-relaxed text-emerald-950">{wp.correction}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {wp.evidence.length > 0 && (
              <section>
                <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400">
                  근거 · 이 내용이 나온 대화 구간
                </h3>
                <div className="flex flex-col gap-2">
                  {wp.evidence.map((ev, i) => (
                    <blockquote
                      key={i}
                      className="border-l-2 border-slate-200 py-0.5 pl-3 text-[12.5px] leading-relaxed text-slate-500"
                    >
                      <span
                        className={`mr-1.5 font-semibold ${
                          ev.speaker === 'user' ? 'text-indigo-500' : 'text-slate-400'
                        }`}
                      >
                        {ev.speaker === 'user' ? '나' : 'ChatGPT'}
                        <span className="ml-1 font-mono-term text-[10px] font-normal text-slate-300">
                          #{ev.index}
                        </span>
                      </span>
                      “{ev.text}”
                    </blockquote>
                  ))}
                </div>
              </section>
            )}
          </div>
        ))}

        {/* 연결된 개념 — 위키링크 */}
        <section>
          <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400">연결된 개념</h3>
          <div className="flex flex-wrap gap-1.5">
            {linkedIds.map((id) => {
              const n = byId.get(id);
              if (!n) return null;
              return (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-[3px] font-mono-term text-[12px] text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  <span className="text-slate-400">[[</span>
                  {n.name}
                  <span className="text-slate-400">]]</span>
                </button>
              );
            })}
          </div>
        </section>

        {node.weakpoints.length === 0 && (
          <p className="rounded-md bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-400">
            이 노드에는 기록된 약점이 없습니다. 대화에서 막혔던 지점이 탐지되면
            여기에 정정 전·후와 근거 인용이 붙습니다.
          </p>
        )}
      </div>
    </aside>
  );
}
