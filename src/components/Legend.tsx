import { STATUS_STYLE } from '../mock';

const ITEMS = [
  { ...STATUS_STYLE.learned },
  { ...STATUS_STYLE.introduced },
  { ...STATUS_STYLE.unlearned },
  { ...STATUS_STYLE.weak },
];

/** 그래프 위에 항상 떠 있는 범례. 노드 패널이 열려도 사라지지 않는다. */
export default function Legend() {
  return (
    <div className="pointer-events-none absolute right-4 bottom-3 z-10 rounded-lg border border-slate-200 bg-white/90 px-3 py-2.5 backdrop-blur">
      <div className="mb-1.5 text-[10px] font-bold tracking-wider text-slate-400">범례</div>
      <ul className="flex flex-col gap-1">
        {ITEMS.map((l) => (
          <li key={l.label} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{
                background: l.fill,
                border: `1.5px ${l.dashed ? 'dashed' : 'solid'} ${l.stroke}`,
              }}
            />
            <span className="text-[11px] leading-tight text-slate-600">{l.label}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="grid h-3 w-3 shrink-0 place-items-center rounded-full bg-red-600 text-[8px] font-black text-white">
            !
          </span>
          <span className="text-[11px] leading-tight text-slate-600">약점 배지</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full border border-dashed border-sky-500 bg-sky-50" />
          <span className="text-[11px] leading-tight text-slate-600">지금 배울 수 있음</span>
        </li>
      </ul>
    </div>
  );
}
