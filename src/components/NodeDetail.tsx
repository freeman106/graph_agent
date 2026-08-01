import { STATUS_STYLE, type LectureNote, type RuntimeEdge, type RuntimeNode } from '../mock';

interface Props {
  node: RuntimeNode;
  note?: LectureNote;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function NodeDetail({ node, note, nodes, edges, onSelect, onClose }: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 노트에 적힌 연결이 있으면 그걸, 없으면 그래프 간선에서 뽑는다.
  const linkedIds =
    note?.linkedConcepts ??
    Array.from(
      new Set(
        edges
          .filter((e) => e.source === node.id || e.target === node.id)
          .map((e) => (e.source === node.id ? e.target : e.source)),
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
                style={{
                  background: status.fill,
                  border: `1.5px solid ${status.stroke}`,
                }}
              />
              <span className="text-[11px] font-semibold text-slate-500">{status.label}</span>
              {node.isNew && (
                <span className="rounded-full bg-violet-100 px-2 py-[1px] text-[10px] font-semibold text-violet-700">
                  이번 실행 추가
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-[19px] leading-tight font-bold text-slate-900">
              {node.label}
            </h2>
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
          <p className="text-[13.5px] leading-relaxed text-slate-700">{note?.body ?? node.summary}</p>
        </section>

        {/* 이 대화에서 막혔던 지점 — 이 제품의 차별점 */}
        {note?.stuckPoint && (
          <section className="rounded-lg border-l-[3px] border-amber-400 bg-amber-50 py-3 pr-3 pl-3.5">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-amber-800">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-[10px] font-black text-white">
                !
              </span>
              이 대화에서 막혔던 지점
            </h3>
            <p className="text-[13px] leading-relaxed text-amber-950">{note.stuckPoint}</p>
          </section>
        )}

        {/* 오해했다 정정된 부분 */}
        {note?.correction && (
          <section>
            <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400">
              오해했다 정정된 부분
            </h3>
            <div className="flex flex-col gap-1.5">
              <div className="rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2">
                <div className="mb-1 text-[10px] font-bold tracking-wide text-rose-500">정정 전</div>
                <p className="text-[13px] leading-relaxed text-rose-950 line-through decoration-rose-300">
                  {note.correction.before}
                </p>
              </div>
              <div className="pl-3 text-[13px] leading-none text-slate-300">↓</div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                <div className="mb-1 text-[10px] font-bold tracking-wide text-emerald-600">
                  정정 후
                </div>
                <p className="text-[13px] leading-relaxed text-emerald-950">
                  {note.correction.after}
                </p>
              </div>
            </div>
          </section>
        )}

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
                  {n.label}
                  <span className="text-slate-400">]]</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 근거: 대화 구간 인용 */}
        {note && note.evidence.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400">
              근거 · 이 내용이 나온 대화 구간
            </h3>
            <div className="flex flex-col gap-2">
              {note.evidence.map((ev, i) => (
                <blockquote
                  key={i}
                  className="border-l-2 border-slate-200 py-0.5 pl-3 text-[12.5px] leading-relaxed text-slate-500"
                >
                  <span
                    className={`mr-1.5 font-semibold ${
                      ev.speaker === '나' ? 'text-indigo-500' : 'text-slate-400'
                    }`}
                  >
                    {ev.speaker}
                  </span>
                  “{ev.quote}”
                </blockquote>
              ))}
            </div>
          </section>
        )}

        {!note && (
          <p className="rounded-md bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-400">
            이번 실행의 대화에서는 다뤄지지 않은 노드입니다. 강의노트와 근거 인용은 해당 개념이 대화에
            등장할 때 생성됩니다.
          </p>
        )}
      </div>
    </aside>
  );
}
