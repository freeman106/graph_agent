# 해커톤 작업 기록

[프로젝트 소개로 돌아가기](../README.md)

> **2026.08 해커톤 당시 사용한 내부 시작 안내의 보존본입니다. 현재 작업 지시가 아닙니다.**
> 아래의 미구현 항목과 파일 경로는 당시 상태를 나타냅니다.
> `store.py`의 `get_neighbors`, `link_nodes`, `merge_nodes`, `mark_progress`는 현재 구현되어 있습니다.
> 실행 기록은 현재 OS별 앱 데이터 디렉터리에 저장됩니다.
> 최신 실행 방법은 [개발 안내](development.md), 코드 변경 규칙은 [AGENTS.md](../AGENTS.md)를 확인하세요.

당시 역할은 A(에이전트 코어·계약), B(그래프 엔진), C(프론트·스트림), D(노트·발표물)로 나눴습니다.
실제 API 키는 A 담당자가 관리했고, 다른 팀원들은 오프라인 실행과 샘플 이벤트로 개발했습니다.
현재 저장소를 독립적으로 실행하는 사용자는 실제 모델 호출 시 본인의 API 키를 설정합니다.

## 각자 첫 세션 시작하기

저장소 폴더에서 Claude Code 또는 Codex CLI를 연다. 규칙은 자동으로 로드된다
(`CLAUDE.md` → Claude Code, `AGENTS.md` → Codex CLI. 둘은 같은 내용을 가리킨다).

**자기 역할을 첫 프롬프트로 선언한다.** 아래를 그대로 복사해서 쓰면 된다.

<details>
<summary><b>A — 에이전트 코어</b></summary>

```
나는 A(에이전트 코어) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 agent/ 이고, contract/ 의 소유자도 나다.
지금 할 일: agent/main.py 의 스트림 변환기를 실제 OpenAI 응답으로 검증하고,
계약 C 이벤트가 정확히 나오는지 확인한다.
시작 전에 npm run check 를 돌려 환경부터 확인해라.
```
</details>

<details>
<summary><b>B — 그래프 엔진</b></summary>

```
나는 B(그래프 엔진) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 agent/store.py 와 agent/tools.py 뿐이다. 다른 폴더는 읽기만 한다.
contract/README.md 의 계약 B(툴 시그니처)를 먼저 읽어라.
지금 할 일: store.py 의 NotImplementedError 로 남아 있는 get_neighbors,
link_nodes, merge_nodes, mark_progress 를 구현하고 tools.py 에 래퍼를 추가한다.
툴 안에서 LLM 을 호출하지 마라. search_nodes 는 임베딩을 쓰지 않는다.
확인은 npm run agent:offline 로 한다. API 키는 필요 없다.
```
</details>

<details>
<summary><b>C — 프론트 + 스트림</b></summary>

```
나는 C(프론트) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 src/ 뿐이다. agent/ 와 contract/ 는 읽기만 한다.
타입은 contract/schema.ts 에서 import 한다. 새로 선언하지 마라.
contract/README.md 의 계약 A(그래프)와 계약 C(스트림)를 먼저 읽어라.
지금 할 일: 실행 스트림 뷰에 raw 뷰 / 요약 뷰 토글을 붙인다.
요약 층이 비고 raw 만 있는 이벤트가 순수 원본 통과분이다.
실제 이벤트 예시는 agent/state/last_run.jsonl 에 있다. API 키는 필요 없다.
```
</details>

<details>
<summary><b>D — 노트 + 발표물</b></summary>

```
나는 D(노트/발표물) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 contract/fixtures/ 와 발표 자료뿐이다. 코드는 읽기만 한다.
contract/README.md 의 Weakpoint / Evidence 구조를 먼저 읽어라.
지금 할 일: 약점 탐지 프롬프트를 다듬고, 시연용 그래프에 쓸 대화 픽스처를
추가한다. Weakpoint 의 네 칸(description/misconception/correction/evidence)이
프론트 노트 패널에 그대로 렌더링된다.
contract/schema.py 와 schema.ts 는 건드리지 마라. 소유자는 A 다.
```
</details>
