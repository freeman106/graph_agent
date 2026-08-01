/**
 * ChatGPT 공유 링크에서 대화를 꺼낸다.
 *
 * 공유 페이지는 서버에서 그냥 받아진다(HTTP 200). 반면 backend-api/share 는
 * 403 이라 쓸 수 없어서, HTML 안에 박힌 JSON 을 파싱한다.
 *
 * 데이터는 window.__REACT_QUERY_CACHE__ 안에 있는데 그 안의 경로는 ChatGPT
 * 배포마다 달라진다. 그래서 경로를 고정하지 않고 **메시지처럼 생긴 객체**를
 * 재귀로 찾는다 — author.role 과 content.parts 를 가진 것. 구조가 바뀌어도
 * 이 두 필드는 남아 있을 가능성이 높다.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** 공유 링크에서 id 를 꺼낸다. 잘못된 주소는 여기서 걸러진다. */
export function parseShareUrl(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(url.hostname)) return null;
  const match = url.pathname.match(/\/share\/(?:[a-z-]+\/)?([0-9a-f-]{16,})/i);
  return match ? { id: match[1], url: `https://chatgpt.com/share/${match[1]}` } : null;
}

/**
 * 공유 페이지의 대화는 React Router 의 turbo-stream 페이로드에 들어 있다.
 * 평평한 배열 하나에 값을 모아 두고 정수 인덱스로 서로를 참조하는 형태라
 * 그냥 JSON.parse 해서는 구조가 나오지 않는다.
 *
 *   [{"_1":2}, "loaderData", {...}, …]
 *    └ 키는 arr[1], 값은 arr[2]
 */
function streamPayload(html) {
  let joined = '';
  for (const m of html.matchAll(/streamController\.enqueue\((".*?")\);/gs)) {
    joined += JSON.parse(m[1]);
  }
  if (!joined) return null;
  // 본문 뒤에 P<n>:[...] 형태의 프로미스 청크가 붙으므로 첫 배열만 잘라낸다.
  const start = joined.indexOf('[');
  return start === -1 ? null : balancedFrom(joined, start);
}

/** 인덱스 참조를 실제 객체로 편다. 음수는 undefined 류 sentinel 이라 null 로 접는다. */
function inflate(flat) {
  const cache = new Map();
  const resolve = (index) => {
    if (typeof index !== 'number') return index;
    if (index < 0) return null;
    if (cache.has(index)) return cache.get(index);
    const raw = flat[index];
    let out;
    if (Array.isArray(raw)) {
      out = [];
      cache.set(index, out);
      for (const item of raw) out.push(resolve(item));
    } else if (raw && typeof raw === 'object') {
      out = {};
      cache.set(index, out);
      for (const [key, value] of Object.entries(raw)) {
        const name = key.startsWith('_') ? resolve(Number(key.slice(1))) : key;
        out[typeof name === 'string' ? name : String(name)] = resolve(value);
      }
    } else {
      out = raw;
      cache.set(index, out);
    }
    return out;
  };
  return resolve(0);
}

/** 여는 괄호에서 시작해 짝이 맞는 지점까지 잘라낸다. 문자열 안의 괄호는 세지 않는다. */
function balancedFrom(text, start) {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 메시지처럼 생긴 객체를 재귀로 모은다. 경로를 고정하지 않는 이유는 파일 맨 위 주석 참고. */
function collectMessages(value, out, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectMessages(item, out, seen);
    return;
  }

  const role = value?.author?.role;
  const parts = value?.content?.parts;
  if (typeof role === 'string' && Array.isArray(parts)) {
    const text = parts
      .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('\n')
      .trim();
    if (text) {
      out.push({
        role,
        text,
        // 순서를 세울 근거. 없으면 발견 순서를 쓴다.
        at: typeof value.create_time === 'number' ? value.create_time : null,
        id: typeof value.id === 'string' ? value.id : null,
      });
    }
  }

  for (const key of Object.keys(value)) collectMessages(value[key], out, seen);
}

/**
 * 공유 링크를 받아 "나: … / ChatGPT: …" 형태의 텍스트로 돌려준다.
 * agent 의 parse_pasted 가 그대로 읽을 수 있는 모양이다.
 */
export async function fetchSharedConversation(shareInput) {
  const target = parseShareUrl(shareInput);
  if (!target) {
    throw new Error('ChatGPT 공유 링크가 아닙니다. 예) https://chatgpt.com/share/<id>');
  }

  const res = await fetch(target.url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`공유 페이지를 가져오지 못했습니다 (HTTP ${res.status}).`);
  }
  const html = await res.text();

  const payload = streamPayload(html);
  if (!payload) {
    throw new Error('공유 페이지에서 대화 데이터를 찾지 못했습니다.');
  }
  const messages = [];
  try {
    collectMessages(inflate(JSON.parse(payload)), messages);
  } catch {
    throw new Error('공유 페이지 형식이 바뀐 것 같습니다. 대화를 읽지 못했습니다.');
  }

  // 같은 메시지가 여러 캐시 항목에 중복으로 들어 있을 수 있다.
  const unique = [];
  const seenKey = new Set();
  for (const message of messages) {
    const key = message.id ?? `${message.role}:${message.text.slice(0, 80)}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    unique.push(message);
  }

  if (unique.length > 0 && unique.every((m) => m.at !== null)) {
    unique.sort((a, b) => a.at - b.at);
  }

  // ChatGPT 가 대화 앞에 끼워 넣는 시스템 잔여물은 학습 내용이 아니다.
  const NOISE = /^Original custom instructions no longer available/;
  const turns = unique.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      m.text.trim() &&
      !NOISE.test(m.text.trim()),
  );
  if (turns.length === 0) {
    throw new Error(
      '대화를 찾지 못했습니다. 링크가 공개 공유 상태인지 확인해 주세요.',
    );
  }

  const text = turns
    .map((m) => `${m.role === 'user' ? '나' : 'ChatGPT'}: ${m.text}`)
    .join('\n\n');

  return { url: target.url, turnCount: turns.length, text };
}
