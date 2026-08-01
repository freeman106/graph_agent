import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import defaultNotePdfDataUrl from '../output/pdf/transformer-lecture-note.pdf?inline';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfNoteDocument {
  fileName: string;
  title: string;
  pageCount: number;
  characterCount: number;
  /** 화면 표시용이 아니라 이후 모델 입력으로 넘길 원문. 현재는 전달하지 않고 보관만 한다. */
  extractedText: string;
}

const MAX_PDF_BYTES = 30 * 1024 * 1024;

function pageText(content: TextContent) {
  const lines: Array<{ y: number; items: TextItem[] }> = [];
  let currentLine: { y: number; items: TextItem[] } | null = null;
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const y = item.transform[5];
    if (currentLine && Math.abs(currentLine.y - y) <= 2.5) {
      currentLine.items.push(item);
    } else {
      currentLine = { y, items: [item] };
      lines.push(currentLine);
    }
    if (item.hasEOL) currentLine = null;
  }

  const renderedLines = lines
    .map((line) => {
      const items = line.items.sort((a, b) => a.transform[4] - b.transform[4]);
      let text = '';
      let previousEnd: number | null = null;
      let previousHeight = 0;
      for (const item of items) {
        const x = item.transform[4];
        const gap = previousEnd === null ? 0 : x - previousEnd;
        const spaceThreshold = Math.max(1.2, Math.min(previousHeight || item.height, item.height) * 0.28);
        if (text && gap > spaceThreshold && !/\s$/.test(text) && !/^\s|^[,.;:!?%)\]}〉》」』’”]/.test(item.str)) {
          text += ' ';
        }
        text += item.str;
        previousEnd = x + item.width;
        previousHeight = item.height;
      }
      return {
        height: Math.max(...items.map((item) => item.height)),
        text: text.replace(/\u00a0/g, ' ').replace(/[ \t]+$/g, ''),
        y: line.y,
      };
    })
    .filter((line) => line.text);

  let result = '';
  for (let index = 0; index < renderedLines.length; index += 1) {
    const current = renderedLines[index];
    const next = renderedLines[index + 1];
    result += current.text;
    if (!next) continue;
    const verticalGap = current.y - next.y;
    const paragraphBreak = verticalGap < -2.5 || verticalGap > Math.max(current.height, next.height) * 2.55;
    result += paragraphBreak ? '\n\n' : ' ';
  }

  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .normalize('NFC');
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim() || '가져온 PDF 노트';
}

export async function extractPdfNote(source: Blob, fileName: string): Promise<PdfNoteDocument> {
  if (source.size === 0) throw new Error('비어 있는 PDF 파일입니다.');
  if (source.size > MAX_PDF_BYTES) throw new Error('PDF는 30MB 이하만 가져올 수 있습니다.');

  const bytes = new Uint8Array(await source.arrayBuffer());
  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 5));
  if (signature !== '%PDF-') throw new Error('PDF 형식의 파일이 아닙니다.');

  const task = getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const metadata = await pdf.getMetadata().catch(() => null);
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(pageText(content));
      page.cleanup();
    }

    const extractedText = pageTexts.filter(Boolean).join('\n\n');
    const characterCount = extractedText.length;
    if (characterCount === 0) {
      throw new Error('텍스트 레이어가 없는 PDF입니다. 스캔 이미지 PDF는 지원하지 않습니다.');
    }

    const metadataTitle = metadata?.info && 'Title' in metadata.info
      ? String(metadata.info.Title ?? '').trim()
      : '';
    return {
      fileName,
      title: metadataTitle || titleFromFileName(fileName),
      pageCount: pdf.numPages,
      characterCount,
      extractedText,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('텍스트 레이어')) throw error;
    throw new Error('PDF를 읽지 못했습니다. 손상되었거나 암호화된 파일인지 확인해 주세요.');
  } finally {
    await task.destroy();
  }
}

export async function loadDefaultPdfNote() {
  const marker = ';base64,';
  const markerIndex = defaultNotePdfDataUrl.indexOf(marker);
  if (markerIndex < 0) throw new Error('기본 강의노트 PDF 데이터가 올바르지 않습니다.');
  const mimeType = defaultNotePdfDataUrl.slice(5, markerIndex) || 'application/pdf';
  const encoded = defaultNotePdfDataUrl.slice(markerIndex + marker.length);
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return extractPdfNote(new Blob([bytes], { type: mimeType }), 'transformer-lecture-note.pdf');
}
