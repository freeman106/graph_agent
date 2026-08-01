import { useEffect, useRef } from 'react';
import { STEP_NAMES } from '../mock';
import type { StreamLine, StreamLineKind } from '../view';

interface Props {
  lines: StreamLine[];
  activeStep: number;
  phase: 'idle' | 'running' | 'done';
}

const KIND: Record<StreamLineKind, { cls: string; prefix: string }> = {
  system: { cls: 'text-slate-500', prefix: '·' },
  call: { cls: 'text-sky-300', prefix: '▸' },
  result: { cls: 'text-emerald-300', prefix: '✓' },
  reason: { cls: 'text-slate-400', prefix: ' ' },
  detail: { cls: 'text-slate-500', prefix: ' ' },
  place: { cls: 'text-violet-300', prefix: '+' },
  edge: { cls: 'text-violet-400/80', prefix: ' ' },
  warn: { cls: 'text-amber-300', prefix: '⚠' },
  fix: { cls: 'text-amber-200/70', prefix: '↳' },
  done: { cls: 'text-emerald-200 font-semibold', prefix: '■' },
};

export default function StreamPanel({ lines, activeStep, phase }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="flex h-full flex-col bg-[#0b0f16] text-[13px]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-slate-800/80 px-4 py-3">
        <span
          className={`h-2 w-2 rounded-full ${
            phase === 'running'
              ? 'animate-pulse bg-emerald-400'
              : phase === 'done'
                ? 'bg-emerald-500'
                : 'bg-slate-600'
          }`}
        />
        <span className="font-mono-term text-[12px] tracking-wide text-slate-300">
          agent.run
        </span>
        <span className="font-mono-term text-[11px] text-slate-600">auto_approve=true</span>
        <span className="ml-auto font-mono-term text-[11px] text-slate-600">
          {phase === 'idle' ? '대기' : phase === 'running' ? '실행 중' : '완료'}
        </span>
      </div>

      {/* 6단계 진행 표시 */}
      <div className="border-b border-slate-800/80 px-4 py-2.5">
        <div className="flex flex-col gap-[3px]">
          {STEP_NAMES.map((name, i) => {
            const state = i < activeStep ? 'done' : i === activeStep ? 'active' : 'todo';
            return (
              <div key={name} className="flex items-center gap-2 font-mono-term text-[11px]">
                <span
                  className={
                    state === 'done'
                      ? 'text-emerald-500'
                      : state === 'active'
                        ? 'text-sky-400'
                        : 'text-slate-700'
                  }
                >
                  {state === 'done' ? '●' : state === 'active' ? '◐' : '○'}
                </span>
                <span
                  className={
                    state === 'done'
                      ? 'text-slate-500'
                      : state === 'active'
                        ? 'text-sky-300'
                        : 'text-slate-700'
                  }
                >
                  {i + 1}. {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 로그 */}
      <div ref={ref} className="stream-scroll flex-1 overflow-y-auto px-4 py-3">
        {lines.length === 0 && (
          <div className="font-mono-term text-[12px] leading-relaxed text-slate-600">
            좌측 하단에 대화를 붙여넣으면
            <br />
            에이전트가 바로 실행됩니다.
            <br />
            <span className="text-slate-700">중간 승인 단계 없음.</span>
          </div>
        )}
        <div className="flex flex-col gap-[3px]">
          {lines.map((l) => {
            const k = KIND[l.kind];
            return (
              <div
                key={l.id}
                className={`line-in font-mono-term text-[12px] leading-[1.55] ${k.cls} ${
                  l.kind === 'call' ? 'mt-2' : ''
                }`}
              >
                <span className="mr-1.5 inline-block w-2 text-right opacity-70">{k.prefix}</span>
                <span className="whitespace-pre-wrap">{l.text}</span>
              </div>
            );
          })}
          {phase === 'running' && (
            <div className="font-mono-term text-[12px] text-slate-500">
              <span className="mr-1.5 inline-block w-2 text-right"> </span>
              <span className="caret">▊</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
