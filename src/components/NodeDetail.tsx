import { RELATION_LABEL, STATUS_LABEL } from '../../contract/schema';
import type { RuntimeEdge, RuntimeNode } from '../view';

interface Props {
  node: RuntimeNode;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  resolvedWeakpoints: Set<string>;
  onSelect: (id: string) => void;
  onOpenNote: (id: string) => void;
  onToggleLearned: (id: string, checked: boolean) => void;
  onToggleWeakpoint: (id: string, index: number, checked: boolean) => void;
  onClose: () => void;
}

export default function NodeDetail({
  node,
  nodes,
  edges,
  resolvedWeakpoints,
  onSelect,
  onOpenNote,
  onToggleLearned,
  onToggleWeakpoint,
  onClose,
}: Props) {
  const connected = edges
    .filter((edge) => edge.from_id === node.id || edge.to_id === node.id)
    .map((edge) => ({
      edge,
      node: nodes.find((candidate) => candidate.id === (edge.from_id === node.id ? edge.to_id : edge.from_id)),
    }))
    .filter((item) => item.node);

  return (
    <aside className="light-scroll absolute top-4 right-4 bottom-4 z-30 w-[368px] overflow-y-auto border border-[#262624] bg-[#f4f0e7] shadow-[10px_10px_0_rgba(38,38,36,0.12)]">
      <div className="sticky top-0 z-10 flex items-start border-b border-[#262624] bg-[#f4f0e7] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.16em] text-[#77736a]">
            <span>CONCEPT CARD</span>
            <span>№ {node.id.slice(0, 12).toUpperCase()}</span>
          </div>
          <h2 className="mt-3 text-[24px] leading-[1.05] font-black tracking-[-0.035em] text-[#262624]">{node.name}</h2>
          <div className="mt-2 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 ${node.status === 'weak' ? 'rotate-45 bg-[#d85b35]' : node.status === 'learned' ? 'rounded-full bg-[#262624]' : 'rounded-full border border-dashed border-[#77736a]'}`} />
            <span className="text-[10px] font-bold text-[#666259]">{STATUS_LABEL[node.status]}</span>
            {node.isNew && <span className="border border-[#a65f2b] bg-[#fff4e8] px-1.5 py-0.5 text-[8.5px] font-black text-[#8b481f]">보충 개념</span>}
          </div>
          <button
            onClick={() => onOpenNote(node.id)}
            className="mt-4 flex w-full items-center justify-between border border-[#255c99] bg-[#edf3f8] px-3 py-2.5 text-left text-[10px] font-black text-[#255c99] transition hover:bg-[#255c99] hover:text-white"
          >
            <span>노트에서 보기</span>
            <span aria-hidden="true">↗</span>
          </button>
          {node.status !== 'weak' && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 border border-[#bdb8ad] bg-[#f8f6f0] px-3 py-2.5 text-[10px] font-black text-[#5f5b53]">
              <input
                type="checkbox"
                checked={node.status === 'learned'}
                onChange={(event) => onToggleLearned(node.id, event.target.checked)}
                className="h-4 w-4 accent-[#255c99]"
              />
              <span>{node.status === 'learned' ? '학습 완료됨' : '학습 완료로 표시'}</span>
            </label>
          )}
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center border border-[#aaa59b] text-[14px] hover:border-[#262624]" aria-label="닫기">×</button>
      </div>

      <div className="divide-y divide-[#c9c4ba] px-5">
        <section className="py-5">
          <div className="mb-2 text-[9px] font-black tracking-[0.16em] text-[#8c877d]">DEFINITION</div>
          <p className="text-[13px] leading-[1.75] text-[#3c3a36]">{node.summary}</p>
          {node.aliases.length > 0 && <p className="mt-3 font-mono-term text-[9.5px] leading-relaxed text-[#8c877d]">ALSO: {node.aliases.join(' / ')}</p>}
        </section>

        {node.comments
          .map((comment) => comment.weakpoint)
          .filter((weakpoint): weakpoint is NonNullable<typeof weakpoint> => weakpoint !== null)
          .map((weakpoint, index) => (
          <section key={index} className="py-5">
            {(() => {
              const resolved = resolvedWeakpoints.has(`${node.id}::${index}`);
              return <>
            <label className={`mb-3 flex cursor-pointer items-start gap-3 border p-3 transition ${resolved ? 'border-[#8daf96] bg-[#eef5ef]' : 'border-[#d8a08d] bg-[#fff4ef]'}`}>
              <input
                type="checkbox"
                checked={resolved}
                onChange={(event) => onToggleWeakpoint(node.id, index, event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#255c99]"
              />
              <span>
                <span className={`block text-[9px] font-black tracking-[0.13em] ${resolved ? 'text-[#3d7650]' : 'text-[#9f4025]'}`}>
                  {resolved ? '해결 완료' : '막힌 지점 · 해결하면 체크'}
                </span>
                <span className={`mt-1.5 block text-[12px] leading-relaxed ${resolved ? 'text-[#66806c] line-through decoration-[#8daf96]' : 'text-[#5f3428]'}`}>{weakpoint.description}</span>
              </span>
            </label>
            {(weakpoint.misconception || weakpoint.correction) && (
              <div className={`mt-4 grid grid-cols-[52px_1fr] gap-y-3 text-[11.5px] leading-relaxed ${resolved ? 'opacity-55' : ''}`}>
                {weakpoint.misconception && <><span className="font-black text-[#a24b36]">BEFORE</span><p className="text-[#76574e] line-through decoration-[#c17a67]">{weakpoint.misconception}</p></>}
                {weakpoint.correction && <><span className="font-black text-[#255c99]">AFTER</span><p className="font-medium text-[#28445f]">{weakpoint.correction}</p></>}
              </div>
            )}
            {weakpoint.evidence.length > 0 && (
              <details className="mt-4 border-t border-[#d5d0c6] pt-3">
                <summary className="cursor-pointer text-[9.5px] font-black tracking-wider text-[#77736a]">원문 근거 {weakpoint.evidence.length}건 보기</summary>
                <div className="mt-3 space-y-3">
                  {weakpoint.evidence.map((evidence) => (
                    <blockquote key={evidence.index} className="text-[11px] leading-relaxed text-[#77736a]">
                      <span className="mr-2 font-mono-term text-[#255c99]">#{evidence.index} {evidence.speaker === 'user' ? '나' : 'ChatGPT'}</span>
                      “{evidence.text}”
                    </blockquote>
                  ))}
                </div>
              </details>
            )}
              </>;
            })()}
          </section>
        ))}

        <section className="py-5">
          <div className="mb-3 text-[9px] font-black tracking-[0.16em] text-[#8c877d]">RELATIONS / {connected.length}</div>
          <div className="space-y-1">
            {connected.map(({ edge, node: connectedNode }) => connectedNode && (
              <button key={edge.id} onClick={() => onSelect(connectedNode.id)} className="group flex w-full items-center border-t border-[#ddd8ce] py-2 text-left first:border-t-0">
                <span className="w-[72px] shrink-0 font-mono-term text-[8.5px] font-bold text-[#9a958b]">{RELATION_LABEL[edge.relation]}</span>
                <span className="text-[11.5px] font-bold text-[#3c3a36] group-hover:text-[#255c99]">{connectedNode.name}</span>
                <span className="ml-auto text-[#aaa59b]">→</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
