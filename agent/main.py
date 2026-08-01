"""에이전트 스켈레톤.

  .venv/bin/python -m agent.main                 픽스처 대화로 실행
  .venv/bin/python -m agent.main --raw           raw 이벤트까지 전부 출력
  .venv/bin/python -m agent.main --reset         그래프를 시드로 되돌리고 실행
  .venv/bin/python -m agent.main --offline       API 없이 스트림 형식만 확인

컨텍스트 구성 순서가 중요하다. 시스템 프롬프트(INSTRUCTIONS)와 툴 스키마는
모듈 상수라 실행마다 바이트가 동일하고, 매번 달라지는 대화 본문은 input 으로
맨 뒤에 붙는다. 프롬프트 캐싱이 먹으려면 이 순서를 깨면 안 된다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from agents import Agent, ItemHelpers, MaxTurnsExceeded, Runner

from contract.schema import Conversation, LimitPayload, Turn

from agent import READ_ENCODING
from agent import tools as tool_module
from agent.config import (
    DEFAULT_CONVERSATION,
    GRAPH_PATH,
    LAST_RUN_PATH,
    MAX_STEPS,
    MAX_STEPS_LECTURE,
    MODE,
    MODEL,
)
from agent.store import load_conversation
from agent.stream import StreamWriter

# ════════════════════════════════════════════════════════════════
#  시스템 프롬프트 — 컨텍스트 맨 앞. 실행마다 바뀌지 않는다.
# ════════════════════════════════════════════════════════════════
#
# 단계를 강제하지 않는다. 목표만 주고 어떤 툴을 몇 번 어떤 순서로 부를지는
# 모델이 정한다. 대신 상태를 바꾸기 전에 판단 근거를 남기게 한다.

CONVERSATION_INSTRUCTIONS = """\
너는 사용자의 개인 지식그래프를 관리하는 에이전트다.

목표: 주어진 대화를 읽고, 거기서 다뤄진 개념들을 기존 지식그래프에 반영하라.

작업 방식은 네가 정한다. 어떤 툴을 몇 번 어떤 순서로 부를지 스스로 결정하고,
할 일이 끝났다고 판단하면 멈춰라. 정해진 단계는 없다.

지켜야 할 것:

1. 그래프 상태를 바꾸는 툴을 호출하기 전에, 왜 그렇게 판단했는지 한 줄을 먼저 써라.
   근거를 밝히지 않은 변경은 하지 않는다.

2. 새 노드를 만들기 전에 search_nodes 로 기존 노드를 확인하라. 표기만 다른 같은
   개념을 중복으로 만들지 않는다. 한글 표기와 영문 표기를 모두 검색해볼 것.

3. search_nodes 가 주는 score 는 문자열이 얼마나 겹치는지일 뿐이다. 같은 개념인지는
   점수가 아니라 네가 판단한다. 점수가 높아도 다른 개념일 수 있고, 낮아도 같을 수 있다.

4. 대화에 근거가 없는 것은 그래프에 넣지 않는다. 네가 일반적으로 아는 사실이더라도
   이 대화에서 다뤄지지 않았다면 넣지 마라.

5. 사용자가 되물었거나, 잘못 알고 있다가 정정된 지점이 있으면 그 개념을 눈여겨봐라.
   그게 이 그래프에서 가장 중요한 정보다. mark_progress 의 comment 로 남긴다.

6. 코멘트의 quote 는 그 노드 document 안에 있는 문장을 그대로 넣어라. 프론트가
   문서에서 그 문자열을 찾아 하이라이트한다. 고쳐 쓰면 하이라이트가 걸리지 않는다.

7. 약점의 evidence 는 대화 원문 그대로여야 한다. 기억해서 옮겨 적지 말고
   quote_conversation 으로 가져와서 그 텍스트를 그대로 써라. 요약하거나 줄이면
   근거가 아니게 된다. 화면에는 이 문장이 "대화에서 실제로 이렇게 말했다" 로 표시된다.

8. 단원과 소주제는 새로 만들지 않는다. 이미 있는 소주제 중에서 고르기만 하라.
   아래 목록에 맞는 게 없으면 subtopic_id 를 비워 둬라.

9. 끝나면 무엇을 어떻게 바꿨는지 짧게 정리하라.
"""

LECTURE_INSTRUCTIONS = """\
너는 사용자의 개인 지식그래프를 만드는 에이전트다.

목표: 주어진 강의안을 읽고, 거기서 다뤄진 개념들로 지식그래프의 첫 모습을 만들어라.

작업 방식은 네가 정한다. 어떤 툴을 몇 번 어떤 순서로 부를지 스스로 결정하고,
할 일이 끝났다고 판단하면 멈춰라. 정해진 단계는 없다.

지켜야 할 것:

1. 그래프 상태를 바꾸는 툴을 호출하기 전에, 왜 그렇게 판단했는지 한 줄을 먼저 써라.

2. 단원(create_chapter)과 소주제(create_subtopic)는 지금 이 실행에서만 만들 수 있다.
   나중에 대화로 추가되는 개념들도 전부 여기서 만든 분류 안으로 들어온다.
   그러니 강의안의 큰 흐름을 담되, 나중 개념도 들어올 자리가 있게 잡아라.

3. 단원은 강의안의 큰 목차 단위다. 개념 하나마다 만들지 않는다.
   소주제는 그 안에서 문서 몇 개를 묶는 단위이고, blurb 에 한 문장으로 설명을 단다.

4. 노드는 개념 단위로 만든다. document 에는 그 개념을 설명하는 읽을 수 있는 글을 써라.
   summary 는 그래프에 붙는 한 줄이고, document 는 노트에서 읽는 본문이다. 둘은 다르다.

5. document 는 강의안에 실제로 있는 내용으로 쓴다. 네가 아는 사실이라도 강의안이
   다루지 않았으면 넣지 마라. 나중에 학생이 무엇을 덜 이해했는지 판정하는 기준선이 된다.

6. 개념 사이 관계가 강의안에 드러나 있으면 link_nodes 로 이어라.

7. 끝나면 무엇을 만들었는지 짧게 정리하라.

문서 작성의 목표:

각 document는 "이 개념을 덮고도 무엇을 설명할 수 있어야 하는가?"라는 질문에서
출발한다. 정의를 더 짧게 줄이는 것이 아니라, 학생이 개념의 역할·작동·조건·경계를
자기 말로 설명하게 만드는 글을 써라.

문서는 보통 4~7개의 실질적인 문단으로 쓴다. 단순한 용어라도 최소 3개의 실질적
문단을 쓴다. 다만 강의안의 근거가 부족한데 분량만 맞추기 위해 문장을 부풀리지 마라.
강의안의 정보 밀도에 맞춰 충분하지만 군더더기 없는 길이를 선택하라.

모든 문서에 같은 제목·같은 순서·같은 마무리를 반복하지 마라.
"출발 문제 / 핵심 주장 / 내부 구조" 같은 템플릿 이름을 본문에 출력하지 마라.
문서마다 강의안의 설명 방식과 해당 개념의 학습 병목에 맞는 자연스러운 서술 흐름을
만들어라.

예를 들어 어떤 문서는 문제 상황에서 시작해 해결 원리로 들어갈 수 있고, 어떤 문서는
관찰되는 현상에서 시작해 그 원인을 풀 수 있으며, 어떤 문서는 구성 요소의 관계를
먼저 보여 준 뒤 전체 역할을 설명할 수 있다. 수식이 중심인 문서는 식보다 그 식이
답하려는 질문에서 시작할 수 있고, 역사·인문·사회 주제는 쟁점이나 주장과 근거의
관계에서 시작할 수 있다.

단, 이러한 다양성은 문체를 꾸미기 위한 것이 아니다. 강의안의 실제 내용에 가장
잘 맞는 설명 순서를 고르기 위한 것이다.

문서의 공통 품질 기준:

- 첫 문단은 가능한 한 사전식 정의 대신 문제, 현상, 질문, 대조, 또는 핵심 역할로
  독자를 해당 개념 안으로 이끈다. 단, 그 출발점은 반드시 강의안에 근거해야 한다.
- 각 문단은 하나의 역할을 맡는다. 같은 말을 다른 표현으로 반복하지 마라.
- 문단과 문단 사이에는 원인, 대조, 결과, 조건, 확대 같은 논리적 연결이 읽혀야 한다.
- 전문 용어는 처음 등장할 때 문맥 안에서 역할을 드러내라.
- "중요하다", "핵심이다", "효율적이다"라고만 쓰지 말고 무엇에 대해 왜 그런지 쓴다.
- 불릿 목록, 표, 용어 사전, 슬라이드 제목의 연속으로 문서를 만들지 마라.
- "강의안에 따르면", "이 문서에서는", "요약하면" 같은 메타 표현을 반복하지 마라.
- 노드명은 UI에 이미 보이므로 본문 첫 줄에 제목을 반복하지 마라.
- 마지막에는 학생이 원문 없이 답할 수 있는 확인 질문을 1~2개 남길 수 있다.
  단, 모든 문서를 똑같이 "스스로 확인"이라는 제목으로 끝내지 말고,
  본문 흐름에 어울리는 방식으로 자연스럽게 배치하라.
- 확인 질문 역시 강의안에 있는 내용만으로 답할 수 있어야 한다.

주 서술 방식 선택:

각 노드에서 학생이 가장 먼저 해결해야 할 학습 질문 하나를 정하고,
아래 방식 중 하나를 주 서술 방식으로 선택하라.
한 문서에 모든 방식을 기계적으로 섞지 마라.
가장 많은 내용을 담는 방식이 아니라, 이 개념을 이해할 때 가장 큰 병목을
해소하는 방식을 선택하라.

A. 개념 모델형
적용: "이것은 무엇이며 왜 필요한가?"가 핵심인 경우.
활용: 문제 또는 역할 → 핵심 개념 → 구성 요소나 관점 → 적용 범위 또는 경계.
주의: 정의와 구성 요소를 나열하는 데 그치지 말고, 각 요소가 전체에서 왜 필요한지
설명한다.

B. 인과·메커니즘형
적용: "무엇이 어떤 과정을 거쳐 무엇을 바꾸는가?"가 핵심인 경우.
활용: 시작 상태 → 변화의 계기 → 핵심 과정 → 결과 → 병목·비용·제약.
주의: 단계 번호만 나열하지 말고, 한 변화가 다음 변화를 낳는 이유를 연결한다.

C. 구조·계층형
적용: 여러 부분이 관계를 맺어 하나의 체계를 이루는 경우.
활용: 전체 역할 → 구성 부분의 책임 → 부분 간 흐름 또는 연결 → 전체에서 생기는 성질.
주의: 하위 노드의 본문을 반복하지 말고, 이 노드에서만 보이는 구조적 관계를 다룬다.

D. 절차·실행형
적용: 방법, 알고리즘, 실험, 진단, 수행 순서가 핵심인 경우.
활용: 목표와 시작 조건 → 단계와 각 단계의 이유 → 중간 확인 → 실패 또는 예외 조건.
주의: 강의 슬라이드의 순서를 베끼지 말고, 학생이 실제로 순서를 재현할 수 있게 쓴다.

E. 수량·수식 해석형
적용: 수식·변수·확률·측정 관계가 핵심인 경우.
활용: 수식이 답하는 질문 → 항과 기호의 역할 → 값 변화의 의미 → 가정과 경계 사례.
주의: 수식을 복사한 뒤 "계산한다"라고 끝내지 말고, 관계가 의미하는 변화를 설명한다.

F. 주장·근거·해석형
적용: 주장, 해석, 법리, 역사적 관점, 사회과학적 설명이 핵심인 경우.
활용: 쟁점 → 중심 주장 → 강의안의 근거와 논리 → 성립 조건 또는 경쟁 관점 → 의미.
주의: 강의안에 없는 반론이나 해석을 임의로 만들지 말고, 사실과 해석을 구별한다.

G. 사례·응용·설계형
적용: "언제 이 방법을 쓰며 무엇을 얻고 잃는가?"가 핵심인 경우.
활용: 문제 신호 → 선택 이유 → 작동 방식 → 트레이드오프 → 부적절한 조건.
주의: 서로 보완적인 개념을 대체재처럼 다루지 말고, 실제 선택 관계가 있을 때만
선택 기준을 쓴다.

H. 변화·발전형
적용: 시간적 변화, 상태 전이, 단계적 발전이 핵심인 경우.
활용: 초기 상태 → 변화 동인 → 전환점 → 이후 상태 → 지속되는 요소와 변한 요소.
주의: 시간 순서가 곧 인과관계라고 과장하지 마라.

선택 보조 절:

주 서술 방식만으로 이해가 부족할 때만 아래 요소를 짧게 사용한다.
보조 절은 별도 카드가 아니라 문서 흐름 속의 한 문단 또는 몇 문장이다.

- 같은 계열에서의 위치:
  실제로 같은 문제를 푸는 변형·대안이 있을 때만 사용한다.
  대주제 노트는 없으므로 비교가 필요하면 각 소주제 문서 안에서
  "현재 개념이 같은 계열에서 어디에 놓이는가"를 설명한다.
  현재 개념의 역할을 중심으로 쓰고, 비교 자체가 본문을 압도하게 하지 마라.

- 혼동 방지:
  비슷한 이름이나 기능 때문에 혼동될 수 있지만 실제로는 다른 층위·다른 역할인
  개념이 있을 때만 사용한다.
  "둘 중 무엇을 고를까?"가 아니라 "왜 같은 것이 아닌가?"를 짧게 설명한다.

- 범위와 예외:
  적용 조건, 전제, 한계가 해당 개념을 이해하는 데 핵심일 때만 사용한다.

- 증거 읽기:
  강의안의 그래프, 표, 실험, 사료, 사례가 핵심 근거일 때만 사용한다.
  자료가 직접 보여 주는 것과 보여 주지 않는 것을 구분한다.

- 용어 구분:
  비슷한 단어가 실제 판단 차이를 만들 때만 사용한다.
  단순 동의어 목록을 만들지 마라.

- 학습자 오해와 정정:
  이후 대화에서 실제 약점이 발견됐을 때만 Comment와 Weakpoint로 붙인다.
  강의안 단계에서 가상의 오개념을 만들어 넣지 마라.

문서를 지루하지 않고 사람의 해설처럼 만들기 위한 규칙:

- 매번 같은 문장으로 시작하거나 끝내지 마라.
- 모든 문단 길이를 똑같이 맞추지 마라. 핵심 전환점에는 충분한 설명을 쓰고,
  연결 문단은 짧고 선명하게 쓴다.
- 설명의 중심을 개념마다 다르게 잡아라. 어떤 노트는 "왜 필요한가",
  어떤 노트는 "무엇이 바뀌는가", 어떤 노트는 "무엇을 구별해야 하는가"가
  중심이 될 수 있다.
- 같은 사실을 정의, 예시, 결론으로 세 번 반복하지 마라.
- 독자를 과장되게 격려하거나 교과서식 상투어를 반복하지 마라.
- 자연스러운 연결어를 사용하되, "따라서", "즉", "예를 들어"를 습관적으로
  반복하지 마라.
- 화려한 비유보다 정확한 관계를 우선한다. 비유는 강의안이 이미 제공했고
  개념 이해에 실제 도움이 될 때만 사용한다.
- 문서를 읽은 학생이 "정보를 많이 봤다"가 아니라
  "이 개념이 왜 이런 모양인지 이해했다"라고 느끼게 하라.

create_node 직전 최종 확인:

- document의 모든 사실은 강의안에서 근거를 찾을 수 있는가?
- summary는 짧고 document는 충분히 다른 역할을 하는가?
- 이 문서의 주 서술 방식은 하나로 분명한가?
- 비교·예외·사례는 실제로 필요하고 강의안에 있는가?
- 다른 노드의 문서와 같은 문장 구조나 같은 표현을 기계적으로 반복하지 않았는가?
- 학생이 이 문서만 읽고 이 노드의 핵심 질문에 답할 수 있는가?

위 조건을 만족할 때만 create_node를 호출하라.
"""

# 실행 종류에 따라 툴 목록이 다르다.
#
# 단원과 소주제는 강의안을 넣을 때만 만들어진다. 대화 실행에서는 기존 것으로
# 분류만 한다. 이걸 프롬프트로 부탁하지 않고 **툴을 안 주는 것으로** 강제한다 —
# 지시는 언젠가 무시되지만 없는 툴은 부를 수 없다.
#
# 순서를 강제하는 게 아니라 할 수 있는 일의 범위를 정하는 것이라
# "단계를 강제하지 않는다"(AGENTS.md 7절) 와 부딪히지 않는다.

_READ_TOOLS = [
    tool_module.get_neighbors,
    tool_module.lookup_reference,
]

_GRAPH_TOOLS = [
    tool_module.create_node,
    tool_module.link_nodes,
    tool_module.merge_nodes,
    tool_module.mark_progress,
]

# 강의안 실행 — 단원/소주제를 만들 수 있다.
#
# search_nodes 가 없다. 빈 그래프에서 시작하므로 첫 노드를 만들기 전 검색은
# 언제나 빈 결과이고, 노드 20여 개를 만드는 동안 그만큼 스텝을 쓴다. 같은 실행
# 안에서 중복이 생기는 문제는 store.create_node 가 막는다 — 같은 slug 면 새로
# 만들지 않고 기존 id 를 돌려준다.
# 대화가 없으므로 quote_conversation 도 없다.
LECTURE_TOOLS = [
    *_READ_TOOLS,
    tool_module.create_chapter,
    tool_module.create_subtopic,
    *_GRAPH_TOOLS,
]

# 대화 실행 — 단원/소주제를 만들 수 없다. 대신 기존 노드를 찾고 대화를 인용한다.
CONVERSATION_TOOLS = [
    tool_module.search_nodes,
    *_READ_TOOLS,
    tool_module.quote_conversation,
    *_GRAPH_TOOLS,
]


def build_agent() -> Agent:
    return Agent(
        name="knowledge-graph-agent",
        instructions=CONVERSATION_INSTRUCTIONS,
        tools=CONVERSATION_TOOLS,
        model=MODEL,
    )


def build_lecture_agent() -> Agent:
    """강의안 실행 전용. 단원/소주제를 만들 수 있고 대화 인용 툴은 없다."""
    return Agent(
        name="knowledge-graph-lecture-agent",
        instructions=LECTURE_INSTRUCTIONS,
        tools=LECTURE_TOOLS,
        model=MODEL,
    )


def render_chapters() -> str:
    """기존 단원/소주제 목록. 모델이 분류하려면 뭐가 있는지 봐야 한다.

    툴로 조회하게 하면 턴을 하나 쓰고 안 부를 수도 있다. 목록이 작으므로
    입력 앞에 붙인다. 가변부라 프롬프트 캐싱 순서도 깨지 않는다.
    """
    chapters = tool_module.STORE.graph.chapters
    if not chapters:
        return "분류 가능한 단원: (없음 — subtopic_id 는 비워 둔다)\n"
    lines = ["분류 가능한 단원과 소주제 (새로 만들 수 없다. 이 중에서만 고른다):"]
    for chapter in chapters:
        lines.append(f"  [{chapter.id}] {chapter.title}")
        for sub in chapter.subtopics:
            blurb = f" — {sub.blurb}" if sub.blurb else ""
            lines.append(f"     subtopic_id={sub.id}  {sub.title}{blurb}")
    return "\n".join(lines) + "\n"


def render_lecture(text: str, lecture_id: str) -> str:
    """강의안을 모델 입력으로 편다.

    맨 앞에 그래프 상태를 알려 준다. 이게 없으면 모델은 그래프가 비었는지 알
    도리가 없어서, 첫 노드를 만들기 전부터 search_nodes 로 중복을 확인한다 —
    빈 그래프에서는 항상 빈 결과라 스텝만 쓴다. 상태를 알면 그 확인을 건너뛰고,
    이 실행에서 자기가 만든 노드와 겹치는지 볼 때만 검색한다.
    """
    store = tool_module.STORE
    if not store.graph.nodes:
        state = "현재 지식그래프는 비어 있다. 이 실행이 첫 노드를 만든다."
    else:
        state = (
            f"현재 지식그래프에 노드 {len(store.graph.nodes)}개, "
            f"단원 {len(store.graph.chapters)}개가 이미 있다. "
            "겹치는 개념은 search_nodes 로 확인하고 중복으로 만들지 마라."
        )
    return f"{state}\n\n강의안 id: {lecture_id}\n\n{text}"


def render_conversation(conv: Conversation) -> str:
    """대화를 모델 입력으로 편다. 턴 인덱스를 남겨야 근거 인용이 가능하다."""
    lines = [render_chapters(), f"대화 id: {conv.id}", f"제목: {conv.title}", ""]
    speaker_ko = {"user": "사용자", "assistant": "어시스턴트"}
    for turn in conv.turns:
        lines.append(f"[{turn.index}] {speaker_ko[turn.speaker]}: {turn.text}")
    return "\n".join(lines)


# ════════════════════════════════════════════════════════════════
#  실행 — SDK 스트림을 계약 C 로 변환
# ════════════════════════════════════════════════════════════════


async def run_lecture(text: str, lecture_id: str, writer: StreamWriter) -> None:
    """강의안 하나로 그래프의 첫 모습을 만든다.

    대화 실행과 스트림 변환은 완전히 같다. 다른 것은 프롬프트와 툴 목록,
    그리고 만들어지는 노드의 origin 뿐이다.
    """
    tool_module.CURRENT_LECTURE_ID = lecture_id
    tool_module.CURRENT_CONVERSATION_ID = None
    tool_module.CURRENT_ORIGIN = "lecture"

    writer.emit(
        "note",
        result_summary=(
            f"강의안 실행 시작 — model={MODEL} mode={MODE} "
            f"max_steps={MAX_STEPS_LECTURE} chars={len(text)}"
        ),
    )
    await _drive(build_lecture_agent(), render_lecture(text, lecture_id), writer, MAX_STEPS_LECTURE)


async def run(conv: Conversation, writer: StreamWriter) -> None:
    tool_module.CURRENT_CONVERSATION_ID = conv.id
    tool_module.CURRENT_LECTURE_ID = None
    tool_module.CURRENT_ORIGIN = "conversation"

    writer.emit(
        "note",
        result_summary=(
            f"실행 시작 — model={MODEL} mode={MODE} "
            f"max_steps={MAX_STEPS} turns={len(conv.turns)}"
        ),
    )

    await _drive(build_agent(), render_conversation(conv), writer)


async def _drive(
    agent: Agent, model_input: str, writer: StreamWriter, max_steps: int = MAX_STEPS
) -> None:
    """SDK 스트림을 계약 C 로 옮긴다. 강의안 실행과 대화 실행이 공유한다."""
    result = Runner.run_streamed(
        agent,
        input=model_input,
        max_turns=max_steps,
    )

    # call_id -> tool_name. 결과를 못 본 호출이 곧 "미처리"다.
    pending: dict[str, str] = {}

    # 근거(message)와 툴 호출(tool_called)이 오는 순서는 하부 스트림에 따라 다르다.
    # 실제 OpenAI 스트리밍에서는 툴 호출이 먼저다 — SDK 가 툴 호출은 스트림 도중에
    # 바로 내보내고(run_loop), 메시지는 턴이 끝난 뒤에 내보내기 때문이다(streaming).
    # 반대로 output_item.done 을 주지 않는 백엔드에서는 메시지가 먼저 온다.
    # 어느 쪽이든 "툴 호출에는 같은 턴의 근거가 붙는다" 가 유지되게 한다:
    #   근거가 아직 없으면 툴 호출을 잡아뒀다가 근거가 나오면 그 뒤에 내보내고,
    #   근거를 이미 봤으면 바로 내보낸다. 턴이 끝나면(tool_result) 근거를 버린다.
    buffered: list[tuple[str, dict, object]] = []
    turn_rationale: str | None = None

    def flush(rationale: str | None) -> None:
        for name, args, raw in buffered:
            writer.emit("tool_call", tool=name, args=args, rationale=rationale, raw=raw)
        buffered.clear()

    try:
        async for event in result.stream_events():
            # ── raw 층: 하부 API 원본을 가공 없이 통과시킨다 ──
            if event.type == "raw_response_event":
                writer.emit("note", raw=event.data)
                continue

            if event.type != "run_item_stream_event":
                continue

            item = event.item

            # ── 모델이 남긴 판단 근거 ──
            if event.name == "message_output_created":
                text = ItemHelpers.text_message_output(item).strip()
                if text:
                    writer.emit("decision", rationale=text, raw=item.raw_item)
                    turn_rationale = text
                    flush(text)

            # ── 툴 호출 ──
            elif event.name == "tool_called":
                name = item.tool_name or "unknown"
                call_id = item.call_id or f"call-{writer._seq}"
                pending[call_id] = name
                args = _extract_args(item.raw_item)
                if turn_rationale is None:
                    buffered.append((name, args, item.raw_item))
                else:
                    writer.emit(
                        "tool_call",
                        tool=name,
                        args=args,
                        rationale=turn_rationale,
                        raw=item.raw_item,
                    )

            # ── 툴 반환 ── 여기서 턴이 끝난다
            elif event.name == "tool_output":
                # 근거 없이 툴만 부른 턴. 근거를 지어내지 않고 비워서 내보낸다.
                flush(None)
                turn_rationale = None
                call_id = item.call_id or ""
                name = pending.pop(call_id, "unknown")
                writer.emit(
                    "tool_result",
                    tool=name,
                    result_summary=_summarize(item.output),
                    raw=item.raw_item,
                )

    except MaxTurnsExceeded:
        # 보류 중인 호출을 삼키지 않는다 — 상한에 걸린 순간을 그대로 보여준다.
        flush(None)
        payload = LimitPayload(
            steps_used=result.current_turn,
            max_steps=max_steps,
            unprocessed=len(pending),
            unprocessed_tools=sorted(pending.values()),
        )
        writer.emit(
            "limit",
            result_summary=(
                f"상한 도달 — {payload.steps_used}/{payload.max_steps} 스텝, "
                f"미처리 {payload.unprocessed}개"
                + (f" ({', '.join(payload.unprocessed_tools)})" if payload.unprocessed else "")
            ),
        )
        return

    flush(None)
    final = (result.final_output or "").strip()
    writer.emit("note", result_summary=f"실행 완료 — {result.current_turn} 스텝")
    if final:
        writer.emit("note", result_summary=final)


def _extract_args(raw_item: object) -> dict:
    raw = getattr(raw_item, "arguments", None)
    if raw is None and isinstance(raw_item, dict):
        raw = raw_item.get("arguments")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"_unparsed": raw}
    return {}


def _summarize(output: object, width: int = 120) -> str:
    text = output if isinstance(output, str) else json.dumps(
        output, ensure_ascii=False, default=str
    )
    text = " ".join(text.split())
    return text if len(text) <= width else text[: width - 3] + "..."


# ════════════════════════════════════════════════════════════════
#  붙여넣은 대화 텍스트 → Conversation
# ════════════════════════════════════════════════════════════════

# 화자 표기. 사람이 복사해 오는 형태를 그대로 받는다.
_SPEAKER_PREFIX = {
    "user": ("나", "저", "사용자", "질문", "me", "user", "you"),
    "assistant": ("chatgpt", "claude", "gpt", "어시스턴트", "assistant", "ai", "답변"),
}


def parse_pasted(text: str, conversation_id: str = "pasted") -> Conversation:
    """붙여넣은 대화를 Conversation 으로 만든다.

    "나: ..." / "ChatGPT: ..." 처럼 화자 표기로 시작하는 줄을 턴 경계로 본다.
    표기가 하나도 없으면 전체를 사용자 발화 한 턴으로 둔다 — 대화가 아니어도
    최소한 내용은 모델에게 전달된다.
    """
    turns: list[Turn] = []
    speaker: str | None = None
    buffer: list[str] = []

    def flush_turn() -> None:
        if speaker is None:
            return
        body = "\n".join(buffer).strip()
        if body:
            turns.append(Turn(index=len(turns), speaker=speaker, text=body))

    for line in text.splitlines():
        head, sep, rest = line.partition(":")
        found = None
        if sep and len(head) <= 12:
            key = head.strip().lower()
            for role, prefixes in _SPEAKER_PREFIX.items():
                if key in prefixes:
                    found = role
                    break
        if found is not None:
            flush_turn()
            speaker = found
            buffer = [rest.strip()]
        elif speaker is not None:
            buffer.append(line)

    flush_turn()

    if not turns:
        body = text.strip()
        if body:
            turns = [Turn(index=0, speaker="user", text=body)]

    return Conversation(id=conversation_id, title="붙여넣은 대화", turns=turns)


# ════════════════════════════════════════════════════════════════
#  오프라인 확인 — API 키 없이 스트림 형식만 본다
# ════════════════════════════════════════════════════════════════


def run_offline(conv: Conversation, writer: StreamWriter) -> None:
    """모델 없이 툴을 직접 호출해 계약 C 스트림을 만든다.

    C(프론트) 와 B(그래프 엔진) 가 크레딧을 쓰지 않고 개발하기 위한 경로다.
    판단은 하드코딩돼 있으므로 에이전트의 동작을 검증하지는 않는다.
    """
    store = tool_module.STORE
    tool_module.CURRENT_CONVERSATION_ID = conv.id

    writer.emit("note", result_summary=f"오프라인 실행 — turns={len(conv.turns)}")

    script = [
        ("KV Cache", "대화 전체가 이 개념을 설명하고 있어 먼저 기존 노드가 있는지 확인한다."),
        ("자기회귀 생성", "캐시가 성립하는 전제로 반복 등장해 별도 개념인지 확인한다."),
    ]

    for query, why in script:
        writer.emit("decision", rationale=why)
        writer.emit("tool_call", tool="search_nodes", args={"query": query, "limit": 5}, rationale=why)
        hits = store.search_nodes(query, 5)
        writer.emit(
            "tool_result",
            tool="search_nodes",
            result_summary=_summarize([h.model_dump() for h in hits]),
        )

    why = "검색 결과에 일치하는 개념이 없고, 대화 전체가 이 개념을 설명하므로 새로 만든다."
    writer.emit("decision", rationale=why)
    args = {
        "name": "KV Cache",
        "summary": "자기회귀 생성에서 이전 토큰들의 Key/Value 텐서를 저장해 재사용하는 추론 전용 최적화.",
        "aliases": ["KV 캐시", "kv-cache", "key value cache"],
    }
    writer.emit("tool_call", tool="create_node", args=args, rationale=why)
    node_id = store.create_node(**args, source_conversation_id=conv.id)
    writer.emit("tool_result", tool="create_node", result_summary=json.dumps({"node_id": node_id}, ensure_ascii=False))

    writer.emit("note", result_summary="오프라인 실행 완료 (모델 호출 없음)")


# ════════════════════════════════════════════════════════════════


def main() -> int:
    parser = argparse.ArgumentParser(description="지식그래프 에이전트 스켈레톤")
    parser.add_argument("--raw", action="store_true", help="raw 원본 이벤트까지 출력")
    parser.add_argument("--reset", action="store_true", help="그래프를 시드로 되돌리고 실행")
    parser.add_argument("--offline", action="store_true", help="API 없이 스트림 형식만 확인")
    parser.add_argument(
        "--conversation", type=Path, default=DEFAULT_CONVERSATION, help="대화 JSON 경로"
    )
    parser.add_argument(
        "--conversation-text",
        type=Path,
        help="붙여넣은 대화 텍스트 파일. 주면 --conversation 대신 이걸 쓴다",
    )
    parser.add_argument(
        "--stream-json",
        action="store_true",
        help="사람이 읽는 출력 대신 계약 C 이벤트를 JSONL 로 stdout 에 흘린다",
    )
    parser.add_argument(
        "--lecture",
        type=Path,
        help="강의안 텍스트 파일. 주면 강의안 실행(단원·소주제·문서 생성)을 한다",
    )
    parser.add_argument(
        "--empty",
        action="store_true",
        help="시드가 아니라 빈 그래프에서 시작한다. 강의안 실행의 출발점",
    )
    args = parser.parse_args()

    if args.empty:
        tool_module.STORE.clear()
        if not args.stream_json:
            print(f"빈 그래프에서 시작합니다: {GRAPH_PATH}")
    elif args.reset:
        tool_module.STORE.reset()
        if not args.stream_json:
            print(f"그래프를 시드로 되돌렸습니다: {GRAPH_PATH}")

    before = len(tool_module.STORE.graph.nodes)

    if args.lecture is not None:
        text = args.lecture.read_text(encoding=READ_ENCODING)
        with StreamWriter(
            show_raw=args.raw, jsonl_path=LAST_RUN_PATH, json_stdout=args.stream_json
        ) as writer:
            asyncio.run(run_lecture(text, args.lecture.stem, writer))
    else:
        if args.conversation_text is not None:
            conv = parse_pasted(args.conversation_text.read_text(encoding=READ_ENCODING))
        else:
            conv = load_conversation(args.conversation)
        with StreamWriter(
            show_raw=args.raw, jsonl_path=LAST_RUN_PATH, json_stdout=args.stream_json
        ) as writer:
            if args.offline:
                run_offline(conv, writer)
            else:
                asyncio.run(run(conv, writer))

    store = tool_module.STORE
    after = len(store.graph.nodes)
    if not args.stream_json:
        print(
            f"\n노드 {before} → {after} (+{after - before}) · 간선 {len(store.graph.edges)}"
            f"\n그래프: {GRAPH_PATH}"
            f"\n스트림: {LAST_RUN_PATH}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
