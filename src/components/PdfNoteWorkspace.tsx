import { useRef } from 'react';
import type { PdfNoteDocument } from '../pdfNote';

interface Props {
  error: string | null;
  isLoading: boolean;
  note: PdfNoteDocument | null;
  onClose: () => void;
  onImportPdf: (file: File) => void;
  onRestoreDefault: () => void;
}

export default function PdfNoteWorkspace({
  error,
  isLoading,
  note,
  onClose,
  onImportPdf,
  onRestoreDefault,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const chooseFile = (file: File | undefined) => {
    if (file) onImportPdf(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="note-workspace absolute inset-0 z-10 flex min-h-0 flex-col bg-[#ede9df]">
      <header className="flex h-[62px] shrink-0 items-center border-b border-[#bdb8ad] bg-[#f7f5ef] pl-[382px] pr-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.18em] text-[#8c877d]">
            <span>PDF 강의자료</span>
            <span className="bg-[#dbe8f2] px-1.5 py-0.5 text-[7px] tracking-[0.08em] text-[#255c99]">MODEL SOURCE</span>
          </div>
          <h2 className="mt-1 truncate text-[15px] font-black tracking-[-0.02em] text-[#262624]">
            {note?.title ?? (isLoading ? 'PDF에서 원문을 가져오는 중…' : '강의자료를 불러오지 못했습니다')}
          </h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
          />
          <button
            type="button"
            disabled={isLoading}
            onClick={() => inputRef.current?.click()}
            className="border border-[#255c99] bg-[#edf3f8] px-3 py-2 text-[9px] font-black text-[#255c99] transition hover:bg-[#255c99] hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            {isLoading ? 'PDF 읽는 중…' : 'PDF 교체'}
          </button>
          <button type="button" disabled={isLoading} onClick={onRestoreDefault} className="border border-[#bdb8ad] px-3 py-2 text-[9px] font-black text-[#666259] hover:border-[#7b766d] disabled:opacity-50">기본 PDF</button>
          <button type="button" onClick={onClose} className="border border-[#262624] bg-[#262624] px-3 py-2 text-[10px] font-black text-[#f7f5ef] transition hover:bg-[#464640]">지도로 돌아가기</button>
        </div>
      </header>

      {error && (
        <div role="alert" className="shrink-0 border-b border-[#d8a08d] bg-[#fff4ef] px-6 py-2.5 text-center text-[10px] font-bold text-[#9f4025]">
          {error}
        </div>
      )}

      <div className="light-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[920px] items-center px-8 py-16">
          <article className="w-full border border-[#c9c4ba] bg-[#fbfaf6] px-12 py-12 shadow-[0_16px_48px_rgba(38,38,36,0.10)]">
            {isLoading && !note ? (
              <div className="grid min-h-[320px] place-items-center text-center">
                <div>
                  <div className="mx-auto mb-4 h-5 w-5 animate-spin rounded-full border-2 border-[#b9c7d4] border-t-[#255c99]" />
                  <p className="text-[12px] font-black text-[#4d4a44]">PDF 텍스트 레이어를 읽고 있습니다</p>
                  <p className="mt-2 text-[10px] text-[#8c877d]">추출된 원문은 화면에 펼치지 않고 입력 데이터로 준비합니다.</p>
                </div>
              </div>
            ) : note ? (
              <>
                <div className="flex items-start gap-5 border-b border-[#d8d3c9] pb-8">
                  <div className="grid h-14 w-12 shrink-0 place-items-center border border-[#255c99] bg-[#edf3f8] font-mono-term text-[10px] font-black text-[#255c99]">PDF</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.14em] text-[#3d7650]">
                      <span className="h-2 w-2 rounded-full bg-[#4f8b61]" />
                      원문 추출 완료
                    </div>
                    <h1 className="mt-3 truncate text-[24px] font-black tracking-[-0.035em] text-[#262624]">{note.title}</h1>
                    <p className="mt-2 truncate font-mono-term text-[9px] text-[#8c877d]" title={note.fileName}>{note.fileName}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px border border-[#d8d3c9] bg-[#d8d3c9]">
                  <div className="bg-[#f7f5ef] px-5 py-4"><div className="text-[8px] font-black tracking-[0.13em] text-[#8c877d]">PAGES</div><div className="mt-1 font-mono-term text-[17px] font-black text-[#34322e]">{note.pageCount}</div></div>
                  <div className="bg-[#f7f5ef] px-5 py-4"><div className="text-[8px] font-black tracking-[0.13em] text-[#8c877d]">EXTRACTED TEXT</div><div className="mt-1 font-mono-term text-[17px] font-black text-[#34322e]">{note.characterCount.toLocaleString()}자</div></div>
                </div>

                <section className="mt-8 border-l-4 border-[#255c99] bg-[#eef3f7] px-6 py-5">
                  <div className="text-[9px] font-black tracking-[0.14em] text-[#255c99]">LLM INPUT SOURCE</div>
                  <p className="mt-3 text-[13px] leading-[1.9] text-[#40464b]">PDF에서 꺼낸 텍스트는 사용자에게 직접 보여 주는 노트가 아니라, 이후 지식그래프를 만들 모델에 전달할 원문으로 보관됩니다.</p>
                  <p className="mt-3 text-[10px] leading-relaxed text-[#77818a]">현재 단계에서는 텍스트 추출과 보관까지만 동작하며 모델 전달은 아직 연결하지 않았습니다. LLM이나 OCR을 사용해 PDF를 읽지는 않습니다.</p>
                </section>

                <div className="mt-8 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3 text-center">
                  <div className="border border-[#d3cec4] bg-white px-3 py-4"><div className="font-mono-term text-[8px] font-black text-[#8c877d]">01</div><div className="mt-1 text-[10px] font-black">PDF 선택</div></div>
                  <span className="text-[#aaa59b]">→</span>
                  <div className="border border-[#d3cec4] bg-white px-3 py-4"><div className="font-mono-term text-[8px] font-black text-[#8c877d]">02</div><div className="mt-1 text-[10px] font-black">원문 추출</div></div>
                  <span className="text-[#aaa59b]">→</span>
                  <div className="border border-dashed border-[#9fb5ca] bg-[#f6f9fb] px-3 py-4"><div className="font-mono-term text-[8px] font-black text-[#255c99]">NEXT</div><div className="mt-1 text-[10px] font-black text-[#255c99]">모델 입력</div></div>
                </div>
              </>
            ) : (
              <div className="grid min-h-[320px] place-items-center text-center">
                <div>
                  <p className="text-[18px] font-black text-[#262624]">텍스트 PDF를 선택해 주세요</p>
                  <p className="mt-3 text-[11px] leading-relaxed text-[#77736a]">텍스트 레이어를 추출해 향후 모델 입력용 원문으로 보관합니다.<br />이미지만 들어 있는 스캔 PDF는 지원하지 않습니다.</p>
                  <button type="button" onClick={() => inputRef.current?.click()} className="mt-6 border border-[#255c99] bg-[#255c99] px-4 py-2.5 text-[10px] font-black text-white">PDF 선택</button>
                </div>
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
