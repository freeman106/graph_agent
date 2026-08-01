import { useEffect, useMemo, useRef, useState } from 'react';
import { STEP_NAMES, type StreamLine } from '../mock';

interface Props {
  lines: StreamLine[];
  activeStep: number;
  phase: 'idle' | 'running' | 'done';
  verified: boolean;
  onVerify: () => void;
  onSelect: (id: string) => void;
}

const FRIENDLY_STEPS = [
  ['개념 발견', '대화에서 실제로 다룬 개념만 찾습니다'],
  ['기존 지식과 대조', '이미 아는 것과 새로 나온 것을 구분합니다'],
  ['지식지도 확장', '근거가 있는 관계만 연결합니다'],
  ['오해 탐지', '질문과 정정에서 막힌 전제를 찾습니다'],
  ['학습 기록 작성', '내 표현과 근거를 함께 남깁니다'],
  ['스스로 재검수', '중복과 근거 없는 연결을 제거합니다'],
] as const;

export default function StreamPanel({
  lines,
  activeStep,
  phase,
  verified,
  onVerify,
  onSelect,
}: Props) {
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [attempted, setAttempted] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === 'idle') {
      setChallengeOpen(false);
      setAnswer('');
      setAttempted(false);
    }
  }, [phase]);

  const checks = useMemo(() => {
    const normalized = answer.toLowerCase().replace(/\s/g, '');
    const training = ['학습', 'teacher', '병렬', '한번', '전체'].some((word) =>
      normalized.includes(word),
    );
    const inference = ['추론', '순차', '이전', '스텝', '재사용', '캐시'].some((word) =>
      normalized.includes(word),
    );
    return { training, inference, passed: training && inference && answer.trim().length >= 28 };
  }, [answer]);

  const checkAnswer = () => {
    setAttempted(true);
    if (checks.passed) onVerify();
  };

  const importantLines = lines
    .filter((line) => ['result', 'warn', 'done'].includes(line.kind))
    .slice(-3);

  if (phase === 'idle') {
    return (
      <aside className="flex h-full w-full flex-col bg-[#0b1020] px-5 py-5 text-white">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-sky-300">
          <span className="h-2 w-2 rounded-full bg-sky-400" />
          LEARNING SESSION
        </div>
        <h2 className="mt-7 text-[28px] leading-[1.12] font-bold tracking-[-0.035em]">
          대화가 끝난 뒤,
          <br />
          <span className="text-sky-300">진짜 학습</span>이 시작됩니다.
        </h2>
        <p className="mt-4 max-w-[310px] text-[13px] leading-relaxed text-slate-400">
          무엇을 말했는지가 아니라, 무엇을 이해했고 어디서 착각했는지를 찾아냅니다.
        </p>

        <div className="mt-8 grid gap-2.5">
          {[
            ['01', '사고의 흔적', '재질문과 정정에서 막힌 전제를 발견'],
            ['02', '근거가 있는 지도', '모든 노드와 연결을 원문에 다시 접지'],
            ['03', '이해 검증', '직접 설명해야 비로소 학습 완료'],
          ].map(([number, title, body]) => (
            <div key={number} className="rounded-xl border border-white/8 bg-white/[0.035] p-3.5">
              <div className="flex gap-3">
                <span className="font-mono-term text-[10px] font-bold text-sky-400">{number}</span>
                <div>
                  <div className="text-[13px] font-bold text-slate-100">{title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{body}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-[11px] leading-relaxed text-sky-100/70">
          좌측에 학습 대화를 붙여넣으면 약 15초 뒤 지식지도의 변화와 이해 확인 질문이 준비됩니다.
        </div>
      </aside>
    );
  }

  if (phase === 'running') {
    const progress = Math.max(8, Math.min(96, ((activeStep + 1) / STEP_NAMES.length) * 100));
    const safeStep = Math.max(0, Math.min(activeStep, FRIENDLY_STEPS.length - 1));
    const [title, description] = FRIENDLY_STEPS[safeStep];

    return (
      <aside className="flex h-full w-full flex-col bg-[#0b1020] px-5 py-5 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-sky-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            THINKING TRACE
          </div>
          <span className="font-mono-term text-[10px] text-slate-500">자동 분석 중</span>
        </div>

        <div className="mt-6 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-right font-mono-term text-[10px] text-slate-500">
          {Math.round(progress)}%
        </div>

        <div className="mt-8">
          <div className="font-mono-term text-[11px] font-bold text-sky-400">
            0{safeStep + 1} / 06
          </div>
          <h2 className="mt-2 text-[25px] font-bold tracking-tight">{title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{description}</p>
        </div>

        <div className="mt-7 flex flex-col gap-2">
          {FRIENDLY_STEPS.map(([stepTitle], index) => {
            const done = index < activeStep;
            const active = index === activeStep;
            return (
              <div
                key={stepTitle}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[11px] transition ${
                  active ? 'bg-white/7 text-white' : done ? 'text-slate-500' : 'text-slate-700'
                }`}
              >
                <span className={done ? 'text-emerald-400' : active ? 'text-sky-400' : ''}>
                  {done ? '✓' : active ? '◉' : '○'}
                </span>
                <span className="font-semibold">{stepTitle}</span>
              </div>
            );
          })}
        </div>

        {importantLines.length > 0 && (
          <div className="mt-auto border-t border-white/8 pt-4">
            <div className="mb-2 text-[9px] font-bold tracking-widest text-slate-600">방금 발견</div>
            <p className="line-clamp-3 text-[11px] leading-relaxed text-slate-400">
              {importantLines[importantLines.length - 1]?.text}
            </p>
          </div>
        )}
      </aside>
    );
  }

  if (verified) {
    return (
      <aside className="flex h-full w-full flex-col bg-[#071a16] px-5 py-5 text-white">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-emerald-300">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-400 text-[11px] font-black text-emerald-950">
            ✓
          </span>
          UNDERSTANDING VERIFIED
        </div>

        <div className="mt-10 text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-emerald-300/20 bg-emerald-400/10 shadow-[0_0_50px_rgba(52,211,153,0.15)]">
            <span className="text-[34px]">✓</span>
          </div>
          <h2 className="mt-6 text-[26px] font-bold tracking-tight">KV Cache 이해 검증 완료</h2>
          <p className="mx-auto mt-3 max-w-[310px] text-[12.5px] leading-relaxed text-emerald-100/60">
            학습의 병렬 처리와 추론의 순차 처리 차이를 정확히 설명했습니다. 이 개념은 이제 초록색으로 기록됩니다.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-emerald-300/15 bg-white/[0.035] p-4">
          <div className="text-[10px] font-bold tracking-widest text-emerald-300/70">새 경로 해금</div>
          <div className="mt-2 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-bold">Grouped-Query Attention</div>
              <div className="mt-1 text-[11px] text-emerald-100/45">학습 준비도 86% → 96%</div>
            </div>
            <span className="text-[24px] text-emerald-300">↗</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
            <div className="h-full w-[96%] rounded-full bg-emerald-400" />
          </div>
        </div>

        <button
          onClick={() => onSelect('grouped-query-attention')}
          className="mt-4 rounded-xl bg-emerald-400 px-4 py-3 text-[12px] font-extrabold text-emerald-950 transition hover:bg-emerald-300"
        >
          새로 열린 개념 살펴보기 →
        </button>
        <p className="mt-auto text-center text-[10.5px] text-emerald-100/35">
          기억이 흐려지기 전, 3일 뒤 1분 복습이 예약되었습니다.
        </p>
      </aside>
    );
  }

  if (challengeOpen) {
    return (
      <aside className="flex h-full w-full flex-col bg-[#0b1020] px-5 py-5 text-white">
        <button
          onClick={() => setChallengeOpen(false)}
          className="w-fit text-[11px] font-semibold text-slate-500 hover:text-white"
        >
          ← 오늘의 변화
        </button>
        <div className="mt-6 flex items-center justify-between">
          <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold text-violet-300">
            90초 TEACH-BACK
          </span>
          <span className="font-mono-term text-[10px] text-slate-600">1 / 1</span>
        </div>
        <h2 className="mt-5 text-[21px] leading-snug font-bold tracking-tight">
          왜 KV Cache는 추론에는 유효하지만, 학습에는 필요 없을까요?
        </h2>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
          정답을 외우지 말고, 두 과정의 계산 순서 차이를 직접 설명해보세요.
        </p>

        <textarea
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value);
            setAttempted(false);
          }}
          placeholder="내 말로 설명하기…"
          className="mt-5 h-40 resize-none rounded-xl border border-white/10 bg-white/[0.045] p-3.5 text-[13px] leading-relaxed text-white outline-none placeholder:text-slate-700 focus:border-violet-400/60"
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2 py-1 text-[9.5px] font-semibold ${checks.training ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-slate-600'}`}>
            {checks.training ? '✓' : '○'} 학습의 계산 방식
          </span>
          <span className={`rounded-full px-2 py-1 text-[9.5px] font-semibold ${checks.inference ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-slate-600'}`}>
            {checks.inference ? '✓' : '○'} 추론의 재사용 이유
          </span>
        </div>

        {attempted && !checks.passed && (
          <div className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2.5 text-[10.5px] leading-relaxed text-amber-100/70">
            거의 다 왔습니다. 학습은 전체 위치를 어떻게 계산하는지, 추론은 이전 스텝의 무엇을 다시 쓰는지 함께 설명해보세요.
          </div>
        )}

        <button
          onClick={checkAnswer}
          disabled={answer.trim().length < 12}
          className="mt-auto rounded-xl bg-violet-400 px-4 py-3 text-[12px] font-extrabold text-violet-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          내 설명 확인하기
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col bg-[#0b1020] px-5 py-5 text-white">
      <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-sky-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        TODAY'S KNOWLEDGE CHANGE
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          ['+3', '새 개념', 'text-violet-300'],
          ['1', '오해 교정', 'text-amber-300'],
          ['2', '오류 제거', 'text-sky-300'],
        ].map(([value, label, color]) => (
          <div key={label} className="rounded-xl border border-white/8 bg-white/[0.035] px-2 py-3 text-center">
            <div className={`text-[24px] font-black tracking-tight ${color}`}>{value}</div>
            <div className="mt-0.5 text-[9.5px] font-semibold text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.055] p-4">
        <button onClick={() => onSelect('kv-cache')} className="w-full text-left">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-wider text-amber-300">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-amber-400 text-[10px] font-black text-amber-950">!</span>
            핵심 오해 발견
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-amber-50/90">
            “학습이 오래 걸리니 KV Cache를 적용하면 더 이득일 것이다.”
          </p>
          <div className="my-3 h-px bg-amber-200/10" />
          <p className="text-[11px] leading-relaxed text-amber-100/55">
            놓친 전제: 학습은 전체 위치를 한 번에 병렬 계산하므로 재사용할 ‘이전 스텝’이 없습니다.
          </p>
          <div className="mt-3 text-right text-[10px] font-bold text-amber-300/70">원문 근거 보기 →</div>
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-300">현재 상태</span>
          <span className="rounded-full bg-violet-400/10 px-2 py-1 text-[9px] font-bold text-violet-300">검증 전</span>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">
          대화에서 정정되었지만, 아직 스스로 설명하지 않았습니다. 초록색은 이해를 확인한 뒤에만 부여됩니다.
        </p>
      </div>

      <button
        onClick={() => setChallengeOpen(true)}
        className="mt-4 rounded-xl bg-gradient-to-r from-violet-400 to-sky-400 px-4 py-3.5 text-[12px] font-black text-slate-950 shadow-[0_10px_35px_rgba(56,189,248,0.16)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(56,189,248,0.24)]"
      >
        90초 이해 확인 시작 →
      </button>

      <details className="mt-auto rounded-lg border border-white/5 px-3 py-2 text-[10px] text-slate-600">
        <summary className="cursor-pointer font-semibold hover:text-slate-400">에이전트 판단 과정 보기</summary>
        <div ref={detailRef} className="stream-scroll mt-3 max-h-40 space-y-1.5 overflow-y-auto pr-1 font-mono-term leading-relaxed">
          {lines.map((line) => (
            <div key={line.id}>{line.text}</div>
          ))}
        </div>
      </details>
    </aside>
  );
}
