# 지식그래프 학습 도우미

공부한 대화를 통째로 붙여넣으면, 에이전트가 다룬 개념을 뽑아 기존 지식그래프에
자동으로 연결하고 어디서 막혔는지까지 짚어낸 노트를 만든다.

> **작업 규칙은 [AGENTS.md](AGENTS.md)에 있다. 코드를 건드리기 전에 먼저 읽는다.**

---

## 클론 직후 할 일

**Windows / macOS 모두 명령이 동일하다.** 아래 세 줄이 전부다.

```
npm install
npm run setup
npm run check
```

`npm run check`가 `환경 정상`을 찍으면 준비 완료다. 실패하면 무엇이 왜 틀렸는지와
다음에 할 일이 같이 나온다. 그대로 따르고 다시 `npm run check`.

### 사전 준비 — Windows

1. **Node.js LTS** — [nodejs.org](https://nodejs.org) 에서 설치.
   설치 후 **터미널을 새로 연다** (PATH 반영).
2. **Python 3.11 ~ 3.13** — [python.org](https://www.python.org/downloads/windows/) 에서 설치.
   설치 화면에서 **"Add python.exe to PATH" 를 반드시 체크한다.**
   - ⚠️ **Microsoft Store 버전은 쓰지 않는다.** 가상환경 생성이 실패한다.
     `python`을 쳤을 때 스토어가 열리면 그게 스토어 스텁이다.
   - 터미널은 **PowerShell 또는 명령 프롬프트** 아무거나 좋다. Git Bash도 된다.
3. **Git** — [git-scm.com](https://git-scm.com/download/win).
   설치 중 줄바꿈 옵션은 무엇을 골라도 된다. `npm run setup`이 이 저장소에 맞게
   다시 잡아준다.

확인:

```
node -v
py -3 --version
```

### 사전 준비 — macOS

1. **Node.js LTS** — `brew install node` 또는 [nodejs.org](https://nodejs.org)
2. **Python 3.11 ~ 3.13** — `brew install python@3.13`

확인:

```
node -v
python3 --version
```

---

## 매일 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 프론트 개발 서버 → http://localhost:5173 |
| `npm run agent:offline` | **API 키 없이** 에이전트 실행 |
| `npm run agent` | 에이전트 실행 (API 키 필요, A 담당자만) |
| `npm run check` | 환경 진단. 뭔가 이상하면 제일 먼저 |
| `npm run contract:check` | 계약 검사만 빠르게 |

`npm run dev`와 `npm run agent`는 실행 전에 계약 검사를 통과해야 한다.
계약이 깨진 상태로는 작업을 시작할 수 없다.

### API 키

키는 **A 담당자 한 명만** 가진다. 나머지 세 명은 키 없이 개발한다.

- 백엔드 → `npm run agent:offline`
- 프론트 → `src/mock.ts` 목 데이터, 또는 `agent/state/last_run.jsonl`의 실제 이벤트 기록

키를 가진 사람은 `.env`에 넣는다 (`npm run setup`이 만들어 둔다):

```
OPENAI_API_KEY=sk-...
```

`.env`는 절대 커밋되지 않는다. `npm run check`가 추적 여부를 감시한다.

---

## 구조

```
contract/          팀 데이터 계약. 단일 진실 원본. 소유자 외 수정 금지
  README.md          계약 A(그래프) / B(툴) / C(스트림) 설명
  schema.py          pydantic 모델 — 원본
  schema.ts          동일 타입의 TS 사본
  .lock              계약 잠금 해시. 무단 변경을 자동으로 잡는다
  fixtures/          시드 그래프 · 확인용 대화 · 용어 사전

agent/             에이전트 코어 (A) + 그래프 엔진 (B) — Python
src/               프론트 (C) — Vite + React + TypeScript
scripts/           OS 차이를 흡수하는 실행 스크립트 (A)
```

담당별로 읽을 계약은 `contract/README.md` 상단 표에 있다.

---

## 시연

```
npm run dev
```

1. 시작 상태 — 22개 노드가 채워진 트랜스포머 지식그래프
2. `contract/fixtures/kv_cache_conversation.json`의 대화를 textarea에 붙여넣기
   (또는 우측 하단 `샘플 대화 붙여넣기` 링크)
3. **3단계**에서 새 노드가 관계 라벨과 함께 그래프에 붙는 장면
4. **6단계**에서 에이전트가 자기 결과의 문제를 스스로 잡아 그래프에 반영하는 장면
5. 주황색 **KV Cache** 노드 클릭 → 막혔던 지점 / 정정 전·후 / 근거 인용

---

## 문제가 생기면

**`npm run check`를 먼저 돌린다.** 대부분 원인과 조치가 같이 나온다.

| 증상 | 원인과 조치 |
|---|---|
| `Python 을 찾지 못했습니다` | PATH 미반영 → 터미널 새로 열기. 또는 Microsoft Store 버전 |
| `.venv 생성 실패` | Microsoft Store 파이썬. python.org 버전으로 재설치 |
| `Python 패키지 ... ≠ ...` | `npm run setup` 다시 |
| `한국어 인코딩 왕복` 실패 | 파이썬을 직접 불렀다. `npm run agent`를 쓴다 |
| `계약 위반` | AGENTS.md 2절. 자기가 고쳤으면 `git checkout -- contract/` |
| 리베이스에서 파일 전체가 변경으로 잡힘 | `npm run setup` 다시 (git 설정을 잡아준다) |
| 파일 안의 한글이 `占쏙옙`으로 보임 | 그 파일이 cp949/BOM으로 저장됐다. UTF-8(BOM 없음)로 다시 저장 |

### Windows 전용

| 증상 | 원인과 조치 |
|---|---|
| PowerShell에서 `npm : 이 시스템에서 스크립트를 실행할 수 없으므로` | 실행 정책 차단. **명령 프롬프트(cmd)를 쓰거나** `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| 콘솔 출력의 한글만 깨져 보임 (파일은 멀쩡) | 콘솔 코드페이지가 949. **Windows Terminal**을 쓰거나 `chcp 65001` 먼저 실행. `npm run check`가 감지해서 알려준다 |
| `py` 를 찾을 수 없음 | Python 설치 시 py 런처를 뺐다. `python` 으로도 동작하니 `npm run setup` 을 그냥 돌려본다 |
| venv 생성이나 pip 설치가 이상하게 실패 | 클론 경로에 한글/공백이 있을 수 있다. `C:\dev\graph_agent` 같은 영문 경로로 다시 클론. `npm run check`가 경고한다 |
| 설치가 비정상적으로 느림 | 백신 실시간 검사. 저장소 폴더를 예외로 등록하면 빨라진다 |
