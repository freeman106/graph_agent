# AGENTS.md

지식그래프 학습 도우미. 4명이 병렬로 개발한다.

## 절대 규칙

- **`contract/` 아래 파일은 수정하지 않는다.** 필요하면 팀에 먼저 알린다.
- **타입을 새로 선언하지 말고 `contract/`에서 import한다.**
- **필드를 추가하고 싶으면 코드를 고치지 말고 왜 필요한지 먼저 말한다.**

이 세 줄이 병렬 개발이 성립하는 유일한 근거다. 계약을 조용히 고치면 다른 세 명의
작업이 소리 없이 깨진다. 계약이 부족해 보이면 그게 신호다 — 고치지 말고 말할 것.

## 구조

```
contract/          팀 데이터 계약. 단일 진실 원본. 읽기 전용.
  README.md          계약 A(그래프) / B(툴) / C(스트림) 설명
  schema.py          pydantic 모델 — 원본
  schema.ts          동일 타입의 TS 사본
  fixtures/          시드 그래프 · 확인용 대화 · 용어 사전

agent/             에이전트 코어 (담당 A) — OpenAI Agents SDK
src/               프론트 (담당 C) — Vite + React + TS
```

담당별로 읽을 계약은 `contract/README.md` 상단 표에 있다.

## 타입 import 경로

```python
# Python
from contract.schema import Node, Edge, Graph, StreamEvent, Weakpoint
```

```ts
// TypeScript
import type { Node, Edge, Graph, StreamEvent } from '../contract/schema';
```

같은 모양의 인터페이스를 `src/` 나 `agent/` 안에 다시 선언하지 않는다.
렌더링 전용 플래그처럼 계약에 없어야 할 것은 계약 타입을 **확장**해서 쓴다.

## 설계 원칙

**좌표는 계약에 없다.** 레이아웃은 전적으로 프론트 책임이다. 백엔드는 그래프 구조만
다룬다. 노드 좌표는 `src/layout.ts` 에 프론트 로컬 상태로 있다.

**툴은 조회하거나 변경만 한다. 판단은 전부 LLM 이 한다.** 어떤 툴 안에서도 LLM 을
호출하지 않는다. `search_nodes` 는 유사도 점수를 돌려주되 "같은 개념인지" 판정하지
않는다. 임계값으로 자동 병합하는 코드를 넣지 말 것 — 병합은 모델이 `merge_nodes` 로
결정한다.

**에이전트에게 단계를 강제하지 않는다.** 목표만 주고 어떤 툴을 몇 번 어떤 순서로
부를지는 모델이 정한다. 대신 상태 변경 전에 판단 근거를 남기게 한다.

**간선 방향 규칙**: `from_id` 노드가 `to_id` 노드의 `relation` 이다.
예) `Softmax --component--> Attention` = "Softmax 는 Attention 의 구성 요소".
간선을 만들 때마다 이 문장에 넣어보고 말이 되는지 확인할 것.

## 실행

```bash
# 백엔드
python3 -m venv .venv
.venv/bin/pip install -r agent/requirements.txt
.venv/bin/python -m agent.main --offline     # API 키 없이 스트림 형식 확인
OPENAI_API_KEY=sk-... .venv/bin/python -m agent.main --reset --raw

# 프론트
npm install && npm run dev                   # http://localhost:5173
```

모델명은 `agent/config.py` 한 곳에만 있다. `KG_MODE=demo` 로 발표용 모델로 전환한다.
코드 다른 곳에 모델명을 적지 않는다.

## 크레딧

OpenAI 크레딧이 넉넉하지 않다. 실제 모델 호출이 필요한 사람은 A 한 명이다.

- 매 실행의 전체 이벤트 스트림이 `agent/state/last_run.jsonl` 에 기록된다.
- C 와 B 는 그 파일과 `--offline` 모드로 개발한다. 크레딧을 쓰지 않는다.
- 프론트는 `VITE_USE_MOCK=1` 로 목 데이터만으로 완결 동작한다. 발표 당일 보험이기도 하다.
