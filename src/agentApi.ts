/**
 * 개발 서버에 붙어 있는 에이전트 API 클라이언트.
 *
 * 키가 있는 사람은 실제 실행이 되고, 없는 사람은 status 가 available:false 를
 * 돌려주므로 화면이 알아서 목 데이터로 돈다. 토글을 두지 않는 이유가 이것 —
 * 사람이 켜고 끄면 잘못 켠 상태로 시연하게 된다.
 */

import type { Graph, StreamEvent } from '../contract/schema';

export interface AgentStatus {
  available: boolean;
  reason?: string;
  keyTail?: string;
  running?: boolean;
}

/** 이 개발 서버가 실제 실행을 할 수 있는지. 실패해도 던지지 않는다. */
export async function probeAgent(): Promise<AgentStatus> {
  try {
    const res = await fetch('/api/agent/status');
    if (!res.ok) return { available: false, reason: '개발 서버가 응답하지 않습니다.' };
    return (await res.json()) as AgentStatus;
  } catch {
    return { available: false, reason: '개발 서버에 연결할 수 없습니다.' };
  }
}

/** 실행이 끝난 뒤의 그래프. 저장소가 정본이라 이벤트로 재구성하지 않는다. */
export async function fetchGraph(): Promise<Graph | null> {
  try {
    const res = await fetch('/api/agent/graph');
    if (!res.ok) return null;
    return (await res.json()) as Graph;
  } catch {
    return null;
  }
}

/**
 * ChatGPT 공유 링크에서 대화를 가져온다.
 * 브라우저가 직접 chatgpt.com 을 부르면 CORS 에 막히므로 개발 서버가 대신 받는다.
 */
export async function fetchSharedChat(
  url: string,
): Promise<{ text: string; turnCount: number } | { error: string }> {
  try {
    const res = await fetch('/api/agent/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = await res.json();
    return res.ok ? body : { error: body.error ?? '공유 링크를 읽지 못했습니다.' };
  } catch {
    return { error: '개발 서버에 연결할 수 없습니다.' };
  }
}

/** 붙여넣은 값이 ChatGPT 공유 링크인가. */
export function isShareUrl(value: string): boolean {
  return /^https?:\/\/(chatgpt\.com|chat\.openai\.com)\/share\//i.test(value.trim());
}

type Handlers = {
  onEvent: (event: StreamEvent) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

/**
 * 대화 텍스트를 보내고 계약 C 이벤트를 받는다.
 *
 * EventSource 는 GET 만 되므로 fetch 로 SSE 를 직접 읽는다.
 * 청크가 이벤트 경계에서 잘려 오므로 빈 줄 기준으로 모았다 넘긴다.
 */
export async function runAgent(text: string, handlers: Handlers): Promise<void> {
  return runEndpoint('/api/agent/run', text, handlers);
}

/**
 * 강의안으로 그래프의 첫 모습을 만든다. **빈 그래프에서 시작한다** —
 * 기존 노드가 남아 있으면 모델이 그걸 재사용해 강의안 기반인지 알 수 없게 된다.
 */
export async function runLecture(text: string, handlers: Handlers): Promise<void> {
  return runEndpoint('/api/agent/lecture', text, handlers);
}

async function runEndpoint(url: string, text: string, handlers: Handlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    handlers.onError('개발 서버에 연결할 수 없습니다.');
    return;
  }

  if (!res.ok || !res.body) {
    let message = '실행을 시작하지 못했습니다.';
    try {
      const body = await res.json();
      message = body.reason ?? body.error ?? message;
    } catch {
      /* 본문이 없으면 기본 문구를 쓴다 */
    }
    handlers.onError(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let message: { type: string; event?: StreamEvent; message?: string };
      try {
        message = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (message.type === 'event' && message.event) handlers.onEvent(message.event);
      else if (message.type === 'done') handlers.onDone();
      else if (message.type === 'error') handlers.onError(message.message ?? '실행 실패');
    }
  }
}

/**
 * 계약 C 이벤트를 화면 스트림 한 줄로 옮긴다.
 *
 * raw 만 있고 요약층이 빈 이벤트는 원본 통과분이라 요약 뷰에서 건너뛴다.
 * 이 한 줄이 raw 뷰와 요약 뷰를 가르는 유일한 규칙이다 (계약 C).
 */
export function toStreamLine(
  event: StreamEvent,
): { kind: 'system' | 'call' | 'result' | 'reason' | 'detail'; text: string } | null {
  const summaryEmpty =
    event.result_summary === null && event.rationale === null && event.tool === null;
  if (event.raw !== null && summaryEmpty) return null;

  switch (event.kind) {
    case 'decision':
      return { kind: 'reason', text: event.rationale ?? '' };
    case 'tool_call':
      return {
        kind: 'call',
        text: `[호출 중] ${event.tool}(${JSON.stringify(event.args ?? {})})`,
      };
    case 'tool_result':
      return { kind: 'result', text: `[결과] ${event.tool} → ${event.result_summary ?? ''}` };
    case 'error':
    case 'limit':
      return { kind: 'system', text: event.result_summary ?? '' };
    default:
      return event.result_summary ? { kind: 'detail', text: event.result_summary } : null;
  }
}
