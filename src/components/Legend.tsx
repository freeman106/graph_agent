export default function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex items-center gap-4 border border-[#bdb8ad] bg-[#f7f5ef]/94 px-3 py-2 text-[9px] font-bold text-[#77736a]">
      <span className="font-black tracking-[0.14em] text-[#3c3a36]">MAP KEY</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#262624]" /> 학습</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-dashed border-[#77736a]" /> 미학습</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rotate-45 bg-[#d85b35]" /> 막힌 지점</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#255c99]" /> 이번 기록</span>
      <span className="h-3 border-l border-[#c9c4ba]" />
      <span>실선 선행 · 긴 점선 구성 · 짧은 점선 대비</span>
    </div>
  );
}
