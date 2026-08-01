import { useEffect, useRef } from 'react';
import { STEP_NAMES } from '../mock';
import type { StreamLine, StreamLineKind } from '../view';

interface Props {
  lines: StreamLine[];
  activeStep: number;
  phase: 'idle' | 'running' | 'done';
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

const STEP_LABELS = ['대화 읽기', '기존 노드 대조', '지도에 배치', '약점 탐지', '기록 갱신', '결과 검수'];

export default function StreamPanel({ lines, activeStep, phase }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines.length]);

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
          <span>PIPELINE</span>
          <span>{Math.max(0, Math.min(activeStep + 1, STEP_NAMES.length))} / {STEP_NAMES.length}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {STEP_NAMES.map((name, index) => {
            const complete = index < activeStep || activeStep >= STEP_NAMES.length;
            const active = index === activeStep;
            return (
              <div key={name} className="flex min-w-0 items-center gap-2">
                <span className={`grid h-4 w-4 shrink-0 place-items-center border font-mono-term text-[8px] ${complete ? 'border-[#6fa27c] text-[#8fbc9a]' : active ? 'border-[#e47c57] text-[#e9a184]' : 'border-[#3b3f40] text-[#565c5f]'}`}>
                  {complete ? '✓' : index + 1}
                </span>
                <div className="min-w-0">
                  <div className={`truncate text-[9.5px] font-bold ${active ? 'text-[#f0ede6]' : complete ? 'text-[#899094]' : 'text-[#565c5f]'}`}>{STEP_LABELS[index]}</div>
                  <div className="truncate font-mono-term text-[7.5px] text-[#4d5355]">{name}</div>
                </div>
              </div>
            );
          })}
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
