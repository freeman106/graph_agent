# CLAUDE.md

**이 프로젝트의 작업 규칙은 [AGENTS.md](AGENTS.md)에 있다. 전체를 읽고 따를 것.**

@AGENTS.md

---

아래는 위 파일이 로드되지 않았을 때를 대비한 최소 요약이다.
충돌하면 항상 AGENTS.md가 정본이다.

## 절대 규칙

- **`contract/` 아래 파일은 수정하지 않는다.** 필요하면 팀에 먼저 알린다.
- **타입을 새로 선언하지 말고 `contract/`에서 import한다.**
- **필드를 추가하고 싶으면 코드를 고치지 말고 왜 필요한지 먼저 말한다.**
- **자기 담당 폴더 밖을 수정하지 않는다.** 담당 표는 AGENTS.md 4절.

## 환경

팀 4명 중 3명이 Windows다. **Windows에서 안 도는 건 없는 것과 같다.**
bash 전제 스크립트를 만들지 않는다. 실행 명령은 항상 `npm run <name>` 한 줄이고,
OS 차이는 `scripts/*.mjs` 안에서만 흡수한다. 파이썬을 직접 부르지 않는다.

## 한국어 인코딩

파이썬에서 파일을 열 때 `encoding=` 을 빠뜨리지 않는다. 한국어 Windows의 기본
인코딩은 cp949라 macOS에서는 재현되지 않는 사고가 난다.

```python
from agent import READ_ENCODING, WRITE_ENCODING
path.read_text(encoding=READ_ENCODING)          # utf-8-sig
path.write_text(text, encoding=WRITE_ENCODING)  # utf-8
```

`json.dumps` 에는 항상 `ensure_ascii=False`.

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run check` | 환경 진단. 막히면 제일 먼저 |
| `npm run dev` | 프론트 개발 서버 |
| `npm run agent:offline` | API 키 없이 에이전트 실행 |
| `npm run contract:check` | 계약 검사만 |

`npm run dev` 와 `npm run agent` 는 계약 검사를 통과해야 시작된다.
