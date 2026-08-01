export default function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-4 z-10 grid grid-cols-[auto_1fr] gap-x-3 border border-[#bdb8ad] bg-[#f7f5ef]/96 px-3 py-2 text-[8.5px] font-bold text-[#77736a] shadow-[3px_3px_0_rgba(38,38,36,0.08)]">
      <span className="row-span-2 self-center whitespace-nowrap border-r border-[#c9c4ba] pr-3 font-black tracking-[0.14em] text-[#3c3a36]">MAP KEY</span>
      <span className="flex items-center gap-3 whitespace-nowrap">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#262624]" /> 학습</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-dashed border-[#77736a]" /> 미학습</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rotate-45 bg-[#d85b35]" /> 막힌 지점</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#a65f2b]" /> 대화 보충</span>
      </span>
      <span className="mt-1 flex items-center gap-3 whitespace-nowrap border-t border-[#ddd8ce] pt-1">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-2 border-[#d85b35] bg-[#f7f5ef]" /> 노트 코멘트</span>
        <span>실선 선행 · 긴 점선 구성 · 짧은 점선 대비</span>
      </span>
    </div>
  );
}
