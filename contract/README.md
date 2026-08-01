# 팀 데이터 계약

4명이 병렬로 개발하기 위한 단일 진실 원본. **이 폴더만 보고 각자 개발할 수 있어야 한다.**

```
contract/
  README.md          ← 지금 보는 문서
  schema.py          ← pydantic 모델 (원본)
  schema.ts          ← 동일 타입의 TS 버전 (프론트용)
  fixtures/
    seed_graph.json            초기 지식그래프 22노드 / 25간선
    kv_cache_conversation.json 확인용 대화 (KV Cache, 오해→정정 대목 포함)
    reference.json             lookup_reference 가 조회하는 로컬 용어 사전
```

`schema.py` 가 원본이고 `schema.ts` 가 사본이다. **한쪽을 고치면 반드시 다른 쪽도 같이 고친다.**

## 담당별로 읽을 곳

| | 읽을 계약 | 안 봐도 되는 것 |
|---|---|---|
| **A** 에이전트 코어 | B(툴 시그니처) · C(스트림 이벤트) | 좌표, 렌더링 |
| **B** 그래프 엔진 | A(그래프 상태) · B(툴 시그니처) | 스트림, 좌표, LLM |
| **C** 프론트 + 스트림 | A(그래프 상태) · C(스트림 이벤트) | 툴 구현, 모델 |
| **D** 노트 + 발표물 | A 의 `Weakpoint` / `Evidence` | 나머지 전부 |

## 설계 원칙 두 개

**1. 좌표는 계약에 없다.** 레이아웃은 전적으로 프론트 책임이고 백엔드는 그래프 구조만 다룬다.
노드 좌표는 `src/layout.ts` 에 프론트 로컬 상태로 있다. 백엔드가 새 노드를 만들면
프론트가 자기 규칙으로 자리를 잡는다.

**2. 툴은 조회하거나 변경만 한다. 판단은 전부 LLM 이 한다.**
어떤 툴 안에서도 LLM 을 호출하지 않는다. `search_nodes` 는 유사도 점수를 돌려주되
"같은 개념인지"는 판정하지 않는다. 임계값으로 자동 병합하는 코드를 넣지 말 것 —
병합은 모델이 `merge_nodes` 를 불러서 결정한다.

---

## 계약 A — 그래프 상태

```
Node   : id, name, aliases[], summary, status, weakpoints[], source_conversation_id
Edge   : id, from_id, to_id, relation, rationale
Graph  : version, nodes[], edges[]
```

| 필드 | 값 |
|---|---|
| `status` | `unlearned` \| `learned` \| `weak` |
| `relation` | `prerequisite` \| `component` \| `variant` \| `contrast` \| `application` |

### 간선 방향 규칙 (중요)

> **`from_id` 노드가 `to_id` 노드의 `relation` 이다.**

예) `Softmax --component--> Attention` = "Softmax 는 Attention 의 구성 요소".
이 규칙을 어기면 그래프 전체의 화살표가 뒤집힌다. 간선을 만들 때마다 이 문장에
넣어보고 말이 되는지 확인할 것.

### Weakpoint — 이 제품의 차별점이 담기는 자리

강의노트를 위한 별도 툴은 두지 않는다. 노드에 붙는 `weakpoints[]` 가 노트 본문 역할을 하고,
`mark_progress(node_id, "weak", weakpoint=...)` 로 쓴다.

```
Weakpoint:
  description    막혔던 지점 — 무엇에서 어떻게 막혔는지
  misconception  정정 전 — 잘못 알고 있던 내용        (없으면 null)
  correction     정정 후 — 무엇이 맞는 설명인지        (없으면 null)
  evidence[]     근거가 된 대화 구간 {index, speaker, text}
  source_conversation_id
```

프론트 노트 패널이 이 네 칸을 그대로 렌더링한다. D 는 이 구조체를 채우는 프롬프트만
만들면 되고, 새 타입을 협상할 필요가 없다.

---

## 계약 B — 툴 시그니처

### 조회

```python
search_nodes(query: str, limit: int = 5)          -> list[SearchHit]
get_neighbors(node_id: str, depth: int = 1)       -> list[Edge]
lookup_reference(term: str)                       -> ReferenceEntry
quote_conversation(keyword: str, window: int = 2) -> list[ConversationQuote]
```

```
SearchHit         { node_id, name, score }          score 는 0~1 참고 수치. 판정이 아니다
ReferenceEntry    { found, canonical_name, summary, source }
ConversationQuote { index, text }                   index 는 대화 턴 번호 (0-based)
```

### 변경

```python
create_node(name: str, summary: str, aliases: list[str])                    -> node_id
link_nodes(from_id: str, to_id: str, relation: Relation, rationale: str)    -> edge_id
merge_nodes(keep_id: str, merge_id: str, reason: str)                       -> node_id
mark_progress(node_id: str, status: NodeStatus, weakpoint: Weakpoint | None)-> ok
```

### `search_nodes` 구현 규칙

**임베딩을 쓰지 않는다.** 소문자 정규화 + 별칭 사전 + 부분 문자열 매칭.
노드 50개 규모에서는 그걸로 충분하고, **결과가 예측 가능한 게 더 중요하다.**
데모에서 같은 입력에 같은 결과가 나와야 한다.

점수 기준 (B 가 구현할 때 이 순서로):

| 조건 | score |
|---|---|
| 정규화 후 이름 또는 별칭과 완전 일치 | 1.0 |
| 이름/별칭이 질의를 포함 (또는 그 반대) | 0.6 ~ 0.9 (길이 비율) |
| 토큰 단위 부분 일치 | 0.3 ~ 0.6 |
| 그 외 | 결과에서 제외 |

정규화 = 소문자 + 하이픈/언더스코어/공백 통일 + 양끝 공백 제거.

### 툴 스키마와 strict 모드

OpenAI Agents SDK 의 `@function_tool` 은 `strict_mode=True` 가 기본이고,
기본값이 있는 인자를 자동으로 `required` + nullable 로 변환해준다.
**시그니처에 기본값을 그대로 써도 된다.** 직접 스키마를 손대지 말 것.

---

## 계약 C — 스트림 이벤트

```
{
  seq,             0부터 단조 증가. 실행 하나 안에서 유일
  ts,              ISO 8601 UTC
  kind,            tool_call | tool_result | decision | note | error | limit
  tool,            tool_call / tool_result 일 때 툴 이름
  args,            tool_call 의 인자
  result_summary,  사람이 읽는 한 줄 요약 (원본 아님)
  rationale,       모델이 왜 그렇게 판단했는지 한 줄. decision 에는 필수
  raw              하부 API 원본 이벤트를 가공 없이 담는 자리
}
```

### `raw` 가 있는 이유

대회 규칙상 **원본 이벤트를 가공 없이 실시간 출력해야 한다.** 그래서 스트림 하나에 두 층이 실린다.

```
raw 뷰    ← raw 필드만 흘림. 원본 그대로
요약 뷰   ← kind / tool / result_summary / rationale 로 조립
```

프론트는 **하나의 스트림을 받아 토글로 전환**한다. 두 개의 엔드포인트를 만들지 않는다.
`raw` 가 `null` 인 이벤트(백엔드가 자체 생성한 `note` / `limit` 등)는 raw 뷰에서 건너뛴다.

### kind 별 채워지는 필드

| kind | tool | args | result_summary | rationale | raw |
|---|---|---|---|---|---|
| `tool_call` | ✅ | ✅ | — | 직전 decision 내용 | ✅ |
| `tool_result` | ✅ | — | ✅ | — | ✅ |
| `decision` | — | — | — | **필수** | ✅ |
| `note` | — | — | ✅ | — | — |
| `error` | 가능 | — | ✅ | — | 가능 |
| `limit` | — | — | ✅ | — | — |

`decision` 은 모델이 상태 변경 툴을 부르기 전에 남긴 한 줄이다. A 의 스트림 변환기가
모델의 텍스트 출력을 이 이벤트로 바꾼다. 뒤따르는 `tool_call` 에 같은 문구가 실려 오므로
요약 뷰는 "왜 → 무엇을" 순서로 읽힌다.

### 스텝 상한

`max_steps = 20`. 상한에 걸리면 **조용히 멈추지 않고** `kind="limit"` 이벤트를 내보낸다.

```
LimitPayload { steps_used, max_steps, unprocessed, unprocessed_tools[] }
```

`unprocessed` = 상한에 걸린 턴에서 **실행하지 않고 버린 툴 호출 개수**. 스트림에서
"호출은 봤는데 결과를 못 본" 것들을 세면 그대로 나온다.

---

## 확인용 실행

```
npm install
npm run setup

npm run agent:offline          # API 키 없이 — 세 명은 이걸 쓴다
npm run agent                  # 픽스처 대화로 실행 (키 필요)
npm run agent -- --raw         # raw 이벤트까지 전부 출력
npm run agent -- --reset       # 그래프를 시드 상태로 되돌리고 실행
```

Windows / macOS 모두 위 명령이 글자 그대로 동일하다. 파이썬을 직접 부르지 말 것 —
경로가 OS 마다 다르고, 한국어 Windows 에서 필요한 UTF-8 강제가 빠진다.

`agent/` 스켈레톤은 아직 `search_nodes` 와 `create_node` **두 개만** 물려 있다.
나머지 툴은 B 가 `agent/tools.py` 에 채우고 `agent/main.py` 의 `TOOLS` 목록에 추가하면 된다.

그래프 상태는 `agent/state/graph.json` 한 파일. DB 없음.

## 지켜야 할 것

- 계약 필드를 조용히 늘리지 말 것. 늘려야 하면 `schema.py` + `schema.ts` 를 같이 고치고 팀에 알린다.
- 백엔드는 좌표를 모른다. 프론트는 툴 구현을 모른다.
- 툴 안에서 LLM 호출 금지.
- 에이전트에게 단계를 강제하지 않는다. 목표만 주고 툴 선택과 순서는 모델이 정한다.
