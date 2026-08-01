# AGENTS.md

지식그래프 학습 도우미. **4명이 24시간 동안 각자 다른 환경에서 병렬로 개발한다.**

이 문서는 각 담당자의 Claude Code가 읽는 지시문이다. 아래 규칙은 협상 대상이 아니다.

---

## 0. 환경 전제 — Windows 기준

**팀 4명 중 3명이 Windows다. 기준은 Windows다.**

- **Windows에서 안 도는 건 없는 것과 같다.** macOS에서만 되는 코드는 만들지 않는다.
- **bash 전제 스크립트를 만들지 않는다.** `.sh` 파일, 셸 파이프라인, `&&` 체인,
  `rm -rf`, `export FOO=bar cmd` 같은 것을 실행 경로에 두지 않는다.
- **실행 명령은 OS와 무관하게 동일한 한 줄이어야 한다.** 새 작업을 추가할 때도
  `npm run <name>` 형태를 유지한다. OS 차이는 `scripts/*.mjs` 안에서 흡수한다.
- 파이썬을 직접 부르지 않는다. `.venv/bin/python`(macOS)과 `.venv\Scripts\python.exe`
  (Windows)는 경로가 다르고, 직접 부르면 인코딩 강제가 빠진다. 항상 `npm run agent`.

새 명령이 필요하면 `scripts/`에 `.mjs`를 만들고 `package.json`에 등록한다.
Node는 네 명 모두 이미 설치돼 있고 동작이 동일하다.

---

## 1. 실행 명령 — 이게 전부다

| 명령 | 하는 일 |
|---|---|
| `npm install` | npm 패키지 (클론 직후 1회) |
| `npm run setup` | .venv 생성 + 고정 버전 설치 + git 설정 + .env 생성 (1회) |
| `npm run check` | **내 환경이 정상인지 확인.** 막히면 제일 먼저 이걸 돌린다 |
| `npm run dev` | 프론트 개발 서버 |
| `npm run agent` | 에이전트 실행 (API 키 필요) |
| `npm run agent:offline` | **API 키 없이** 에이전트 실행 — 세 명은 이걸 쓴다 |
| `npm run contract:check` | 계약 검사만 빠르게 |
| `npm run contract:seal` | **계약 소유자 전용.** 계약 변경 확정 |

Windows/macOS 모두 위 명령이 글자 그대로 동일하다.

---

## 2. 절대 규칙 — 계약

- **`contract/` 아래 파일은 수정하지 않는다.** 필요하면 팀에 먼저 알린다.
- **타입을 새로 선언하지 말고 `contract/`에서 import한다.**
- **필드를 추가하고 싶으면 코드를 고치지 말고 왜 필요한지 먼저 말한다.**

이 세 줄이 병렬 개발이 성립하는 유일한 근거다. 계약을 조용히 고치면 다른 세 명의
작업이 소리 없이 깨진다. 계약이 부족해 보이면 그게 신호다 — 고치지 말고 말할 것.

### 계약 변경 권한은 한 명에게만 있다

**계약 소유자: A (에이전트 코어 담당).** `contract/.lock`의 `owner` 필드가 정본이다.

계약을 바꾸려면:
1. 소유자에게 무엇이 왜 필요한지 말한다 (본인이 직접 고치지 않는다)
2. 소유자가 `contract/schema.py`와 `contract/schema.ts`를 **같이** 고친다
3. 소유자가 `npm run contract:seal` 을 실행한다
4. 소유자가 팀에 알린다. 나머지 세 명은 `git pull` 전까지 계약 검사가 실패한다

### 위반은 자동으로 드러난다

`npm run dev`와 `npm run agent`는 실행 **전에** 계약 검사를 통과해야 한다.
계약이 깨진 상태로는 작업을 시작할 수 없다. 검사 항목:

| 검사 | 잡아내는 것 |
|---|---|
| 계약 잠금 해시 | 소유자 아닌 사람이 `contract/schema.*`를 고침 |
| `schema.py` ↔ `schema.ts` 필드 대조 | 한쪽만 고쳐 백엔드/프론트가 어긋남 |
| 타입 재선언 스캔 | `src/`나 `agent/`에서 계약 타입을 다시 선언함 |
| 픽스처 간선 무결성 | 존재하지 않는 노드를 가리키는 간선 |

`npm run check`는 여기에 더해 파이썬 패키지 버전, 한국어 인코딩 왕복,
픽스처 ↔ pydantic 검증, TypeScript 타입 검사까지 돈다.

### import 경로

```python
from contract.schema import Node, Edge, Graph, StreamEvent, Weakpoint
```

```ts
import type { Node, Edge, Graph, StreamEvent } from '../contract/schema';
```

렌더링 전용 플래그처럼 계약에 없어야 할 것은 계약 타입을 **확장**해서 쓴다
(`src/view.ts`의 `RuntimeNode = Node & Point & RuntimeFlags` 참고). 다시 선언하지 않는다.

---

## 3. 절대 규칙 — 한국어 인코딩

**대화 텍스트, 학습 노트, 그래프 데이터가 전부 한국어를 포함한다.**
한국어 Windows의 기본 인코딩은 cp949다. macOS에서는 재현되지 않으므로
**코드 레벨에서 예방해야 한다.**

### 파이썬

```python
from agent import READ_ENCODING, WRITE_ENCODING

path.read_text(encoding=READ_ENCODING)      # utf-8-sig — Windows 편집기의 BOM 을 흡수
path.write_text(text, encoding=WRITE_ENCODING)  # utf-8 — BOM 안 붙임
```

- **`open()` / `read_text()` / `write_text()` 에 `encoding=` 을 빠뜨리지 않는다.**
  빠뜨리면 한국어 Windows에서 cp949로 열려 `UnicodeDecodeError`가 나거나 글자가 깨진다.
- **`json.dump` / `json.dumps` 에는 항상 `ensure_ascii=False`.**
  안 그러면 한국어가 `\uXXXX`로 이스케이프되어 diff가 읽을 수 없게 된다.
- pydantic의 `model_dump_json()`은 그대로 써도 된다 (UTF-8 출력).

### TypeScript / Node

Node는 기본이 UTF-8이라 특별히 할 일이 없다. 다만 파일을 읽을 때 BOM을 걷어낸다:

```ts
readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')
```

### 파일 저장

`.editorconfig`가 편집기에 **BOM 없는 UTF-8 + LF**를 지시한다. VS Code는 이걸
자동으로 따른다. 다른 편집기를 쓴다면 인코딩을 "UTF-8"로 맞춰라 —
"UTF-8 with BOM"이나 "ANSI/EUC-KR"로 저장하지 않는다.

---

## 4. 담당 경계 — 폴더가 곧 담당자다

| 폴더 | 담당 | 내용 |
|---|---|---|
| `agent/` | **A** 에이전트 코어 | Agents SDK 루프, 툴 스키마, 판단 근거 강제, 스텝 상한 |
| `agent/store.py` | **B** 그래프 엔진 | 툴 구현, 별칭 사전, JSON 상태 저장 |
| `src/` | **C** 프론트 + 스트림 | 그래프 렌더링, raw/요약 스트림 뷰, 노트 패널 |
| `contract/fixtures/` | **D** 노트 + 발표물 | 약점 탐지 프롬프트, 시연용 그래프, 슬라이드 |
| `contract/schema.*` | **A** (소유자) | 계약 타입. 나머지는 읽기만 |
| `scripts/`, 루트 설정 | **A** (소유자) | 실행 기반. 바꾸려면 팀에 알린다 |

**자기 영역 밖의 파일을 수정하지 않는다.** 다른 영역에 변경이 필요하면 담당자에게 말한다.

### 여러 명이 건드리는 파일 — 최소화한다

`package.json`, `.gitignore`, `AGENTS.md`, `README.md` 네 개뿐이다.
**수정 전에 팀에 알린다.** 이 파일들은 기반이 잡힌 뒤로는 거의 바뀌지 않아야 한다.

`agent/state/`와 `.env`는 git에 올라가지 않으므로 충돌하지 않는다.

---

## 5. 리베이스 안전 — 줄바꿈과 경로

리베이스로 자주 푸시하는 팀이다. 다음이 이미 설정돼 있으니 **되돌리지 않는다**:

- `.gitattributes` — 저장소 안의 줄바꿈은 항상 LF. `core.autocrlf` 설정이 사람마다
  달라도 리베이스에서 파일 전체가 변경으로 잡히지 않는다.
- `npm run setup`이 저장소 로컬 git 설정을 잡는다:
  `core.autocrlf=false`, `core.eol=lf`, `core.quotepath=false`,
  `core.longpaths=true`, `pull.rebase=true`

코드 안에서 경로를 쓸 때:

- 파이썬은 `pathlib.Path`를 쓴다. 문자열 `/` 연결이나 `\\` 하드코딩 금지.
- Node는 `path.join()`을 쓴다. import 경로는 항상 `/`.
- **절대 경로를 커밋하지 않는다.** `C:\Users\...`나 `/Users/...`가 코드에 들어가면 안 된다.

---

## 6. 비밀값

- **API 키는 A 한 명만 가진다.** 나머지 세 명은 키 없이 자기 영역을 개발한다.
- 키는 `.env`에만 넣는다. `.env`는 `.gitignore`에 있고 `npm run check`가 추적 여부를 감시한다.
- **키를 코드, 커밋 메시지, 로그, 스크린샷에 넣지 않는다.** 출력할 일이 있으면 마지막 4자만.
- 키 없이 개발하는 방법:
  - 백엔드: `npm run agent:offline` — 모델 호출 없이 계약 C 스트림을 만든다
  - 프론트: `agent/state/last_run.jsonl` — 실제 실행의 이벤트 기록이 픽스처가 된다
  - 프론트: `src/mock.ts` — 목 데이터만으로 완결 동작한다

---

## 7. 설계 원칙 (기존 결정 — 뒤집지 않는다)

**좌표는 계약에 없다.** 레이아웃은 전적으로 프론트 책임이다. 백엔드는 그래프 구조만
다룬다. 노드 좌표는 `src/layout.ts`에 프론트 로컬 상태로 있다.

**툴은 조회하거나 변경만 한다. 판단은 전부 LLM이 한다.** 어떤 툴 안에서도 LLM을
호출하지 않는다. `search_nodes`는 유사도 점수를 돌려주되 "같은 개념인지" 판정하지
않는다. 임계값으로 자동 병합하는 코드를 넣지 말 것 — 병합은 모델이 `merge_nodes`로
결정한다.

**에이전트에게 단계를 강제하지 않는다.** 목표만 주고 어떤 툴을 몇 번 어떤 순서로
부를지는 모델이 정한다. 대신 상태 변경 전에 판단 근거를 남기게 한다.

**간선 방향 규칙**: `from_id` 노드가 `to_id` 노드의 `relation`이다.
예) `Softmax --component--> Attention` = "Softmax는 Attention의 구성 요소".
간선을 만들 때마다 이 문장에 넣어보고 말이 되는지 확인할 것.

**모델명은 `agent/config.py` 한 곳에만 있다.** `KG_MODE=demo`로 발표용 모델로 전환한다.
코드 다른 곳에 모델명을 적지 않는다.

---

## 8. 하지 말 것 — 24시간짜리다

다음은 **이 프로젝트에서 만들지 않는다.** 시간이 남아도 만들지 않는다:

- CI 파이프라인 (GitHub Actions 등)
- 컨테이너 (Dockerfile, docker-compose)
- 린터 / 포매터 설정 (ESLint 규칙, Prettier, ruff, black)
- 테스트 프레임워크 도입 (vitest, pytest, jest)
- 데이터베이스. 그래프 상태는 JSON 파일 하나다
- 인증, 사용자 관리, 배포 설정
- 추상화 레이어. 쓰이는 곳이 한 군데면 인라인으로 둔다

`npm run check`가 테스트를 대신한다. 새 검사가 필요하면 `scripts/check.mjs`에
한 줄 추가하는 것으로 끝낸다.

---

## 9. 막혔을 때

1. `npm run check` — 대부분의 문제가 여기서 원인과 조치까지 나온다
2. 계약 관련이면 `contract/README.md`
3. 그래도 막히면 담당자에게 말한다. **자기 영역 밖을 고치지 않는다.**
