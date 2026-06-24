from dotenv import load_dotenv
from browser_use import Agent
from browser_use.llm.google.chat import ChatGoogle
from pathlib import Path
import asyncio

load_dotenv(Path(__file__).parent / ".env")

agent = Agent(
    task="""
목표: localhost:5173 로그인 후 영상 CAPTCHA 해결

절차:
1. http://localhost:5173 접속
2. 아이디 입력칸에 a 입력
3. 비밀번호 입력칸에 a 입력
4. 로그인 버튼 클릭
5. 영상 CAPTCHA 화면 확인
6. 시작 버튼이 있으면 클릭
7. 문제 지시문을 읽고 보기 버튼 중 정답 클릭
8. 실패 시 다시 시도

예외 처리:
- 버튼이 안 보이면 스크롤 또는 다시 탐색
    """,
    llm=ChatGoogle(model="gemini-2.5-flash"),
    max_actions_per_step=3,
    max_failures=5,
    enable_planning=True,
    max_steps=15,
)

asyncio.run(agent.run())
