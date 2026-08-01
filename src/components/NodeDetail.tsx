import { RELATION_LABEL, STATUS_LABEL } from '../../contract/schema';
import type { RuntimeEdge, RuntimeNode } from '../view';

interface Props {
  node: RuntimeNode;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function NodeDetail({ node, nodes, edges, onSelect, onClose }: Props) {
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
            {node.isNew && <span className="border border-[#255c99] px-1.5 py-0.5 text-[8.5px] font-black text-[#255c99]">NEW</span>}
          </div>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center border border-[#aaa59b] text-[14px] hover:border-[#262624]" aria-label="닫기">×</button>
      </div>

      <div className="divide-y divide-[#c9c4ba] px-5">
        <section className="py-5">
          <div className="mb-2 text-[9px] font-black tracking-[0.16em] text-[#8c877d]">DEFINITION</div>
          <p className="text-[13px] leading-[1.75] text-[#3c3a36]">{node.summary}</p>
          {node.aliases.length > 0 && <p className="mt-3 font-mono-term text-[9.5px] leading-relaxed text-[#8c877d]">ALSO: {node.aliases.join(' / ')}</p>}
        </section>

        {node.weakpoints.map((weakpoint, index) => (
          <section key={index} className="py-5">
            <div className="mb-3 flex items-center gap-2 text-[9px] font-black tracking-[0.16em] text-[#9f4025]">
              <span className="grid h-4 w-4 place-items-center bg-[#d85b35] text-[9px] text-white">!</span>
              MISCONCEPTION LOG
            </div>
            <p className="border-l-2 border-[#d85b35] pl-3 text-[12px] leading-relaxed text-[#5f3428]">{weakpoint.description}</p>
            {(weakpoint.misconception || weakpoint.correction) && (
              <div className="mt-4 grid grid-cols-[52px_1fr] gap-y-3 text-[11.5px] leading-relaxed">
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
