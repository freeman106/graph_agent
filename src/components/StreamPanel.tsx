import { useEffect, useRef } from 'react';
import type { RuntimePipelineStep, StreamLine, StreamLineKind } from '../view';

interface Props {
  lines: StreamLine[];
  phase: 'idle' | 'running' | 'done';
  pipelineSteps: RuntimePipelineStep[];
}

const KIND: Record<StreamLineKind, { className: string; prefix: string }> = {
  system: { className: 'text-[#727b80]', prefix: '·' },
  call: { className: 'text-[#8eb6de]', prefix: '>' },
  result: { className: 'text-[#93b99f]', prefix: '✓' },
  reason: { className: 'text-[#a39f95]', prefix: ' ' },
  detail: { className: 'text-[#686f72]', prefix: ' ' },
  place: { className: 'text-[#8eb6de]', prefix: '+' },
  edge: { className: 'text-[#687f98]', prefix: ' ' },
  warn: { className: 'text-[#e6a17f]', prefix: '!' },
  fix: { className: 'text-[#b9836c]', prefix: '↳' },
  done: { className: 'text-[#b5d0bd] font-bold', prefix: '■' },
};

export default function StreamPanel({ lines, phase, pipelineSteps }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const pipelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    if (pipelineRef.current) pipelineRef.current.scrollTop = pipelineRef.current.scrollHeight;
  }, [pipelineSteps.length]);

  const finishedSteps = pipelineSteps.filter((step) => step.status === 'done').length;

  return (
    <div className="flex h-full flex-col bg-[#171a1b] text-[#d4d0c7]">
      <header className="flex h-14 shrink-0 items-center border-b border-[#3b3f40] px-4">
        <div>
          <div className="text-[10px] font-black tracking-[0.16em] text-[#d4d0c7]">처리 기록</div>
        </div>
        <div className="ml-auto flex items-center gap-2 font-mono-term text-[9.5px] text-[#899094]">
          <span className={`h-2 w-2 ${phase === 'running' ? 'animate-pulse bg-[#e47c57]' : phase === 'done' ? 'bg-[#6fa27c]' : 'bg-[#565c5f]'}`} />
          {phase === 'idle' ? 'WAITING' : phase === 'running' ? 'RUNNING' : 'COMPLETE'}
        </div>
      </header>

      <section className="shrink-0 border-b border-[#3b3f40] px-4 py-3">
        <div className="mb-2 flex items-center justify-between font-mono-term text-[8.5px] tracking-wider text-[#686f72]">
          <span>EXECUTION PIPELINE</span>
          <span>{pipelineSteps.length === 0 ? '0 STEPS' : `${finishedSteps} / ${pipelineSteps.length} STEPS`}</span>
        </div>
        <div ref={pipelineRef} className="max-h-52 overflow-y-auto">
          {pipelineSteps.length === 0 && (
            <div className="border border-dashed border-[#303536] px-3 py-4 text-center font-mono-term text-[9px] text-[#565c5f]">
              실행하면 실제 단계와 도구가 표시됩니다
            </div>
          )}
          <div className="flex flex-col gap-2">
            {pipelineSteps.map((step, index) => {
              const complete = step.status === 'done';
              return (
                <div key={step.id} className={`border px-2.5 py-2 ${complete ? 'border-[#34453a] bg-[#1a211d]' : 'border-[#624638] bg-[#211d1a]'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`grid h-4 w-4 shrink-0 place-items-center border font-mono-term text-[8px] ${complete ? 'border-[#6fa27c] text-[#8fbc9a]' : 'animate-pulse border-[#e47c57] text-[#e9a184]'}`}>
                      {complete ? '✓' : index + 1}
                    </span>
                    <span className={`text-[9.5px] font-bold ${complete ? 'text-[#aab8ad]' : 'text-[#f0ede6]'}`}>{step.label}</span>
                    <span className="ml-auto font-mono-term text-[7.5px] text-[#596064]">STEP {(index + 1).toString().padStart(2, '0')}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                    {step.tools.map((tool) => (
                      <span key={tool.id} className={`border px-1.5 py-0.5 font-mono-term text-[8px] ${tool.status === 'done' ? 'border-[#3e5144] text-[#83a88c]' : 'border-[#614536] text-[#d99576]'}`}>
                        {tool.status === 'done' ? '✓' : '·'} {tool.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="flex items-center border-b border-[#2d3031] px-4 py-2 font-mono-term text-[8.5px] text-[#5d6467]">
        <span>TIME</span><span className="ml-8">EVENT</span><span className="ml-auto">{lines.length.toString().padStart(3, '0')} LINES</span>
      </div>

      <div ref={logRef} className="stream-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {lines.length === 0 && (
          <div className="mt-2 border-l border-[#3b3f40] pl-4 font-mono-term text-[10.5px] text-[#565c5f]">대화 입력 대기</div>
        )}
        <div className="flex flex-col gap-[4px]">
          {lines.map((line) => {
            const style = KIND[line.kind];
            return (
              <div key={line.id} className={`line-in grid grid-cols-[28px_12px_1fr] font-mono-term text-[10.5px] leading-[1.55] ${style.className} ${line.kind === 'call' ? 'mt-2 border-t border-[#2d3031] pt-2' : ''}`}>
                <span className="text-right text-[#454a4c] tabular-nums">{line.id.toString().padStart(2, '0')}</span>
                <span className="text-right opacity-80">{style.prefix}</span>
                <span className="min-w-0 whitespace-pre-wrap pl-2">{line.text}</span>
              </div>
            );
          })}
          {phase === 'running' && (
            <div className="grid grid-cols-[28px_12px_1fr] font-mono-term text-[10.5px] text-[#899094]">
              <span /><span /><span className="caret pl-2">▊</span>
            </div>
          )}
        </div>
      </div>

      <footer className="flex h-9 shrink-0 items-center border-t border-[#3b3f40] px-4 font-mono-term text-[8.5px] text-[#565c5f]">
        <span>기록 {lines.length.toString().padStart(3, '0')}개</span><span className="ml-auto">schema.v1</span>
      </footer>
    </div>
  );
}
