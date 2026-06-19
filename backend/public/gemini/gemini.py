import os
import time
from dotenv import load_dotenv
from google import genai

load_dotenv()

VIDEO_PATH = "video/word2.mp4"
MODEL = "gemini-2.5-flash"

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise Exception("GEMINI_API_KEY가 없습니다. .env 확인")

client = genai.Client(api_key=api_key)


def wait_until_ready(file):
    while file.state.name == "PROCESSING":
        print("영상 처리 중...")
        time.sleep(1)
        file = client.files.get(name=file.name)

    if file.state.name != "ACTIVE":
        raise Exception(f"파일 처리 실패: {file.state.name}")

    return file


def ask_problem_setting():
    print("\n문제 설정")
    question = "두 글자를 합한 단어를 고르세요."

    choices = ["과인","과일","타일","과실"]
    print("\n보기 입력. 끝내려면 빈 값 Enter")

    return question, choices


def build_prompt(question, choices):
    choices_text = "\n".join(
        [f"{i + 1}. {choice}" for i, choice in enumerate(choices)]
    )

    return f"""
너는 영상 문제를 푸는 agent다.

아래 영상을 처음부터 끝까지 보고 문제를 풀어라.

문제:
{question}

보기:
{choices_text}

규칙:
- 정답만 출력해라.
- 설명하지 마라.
- 예: 1
"""


def main():
    if not os.path.exists(VIDEO_PATH):
        raise Exception(f"영상 파일이 없습니다: {VIDEO_PATH}")

    question, choices = ask_problem_setting()

    print("\n영상 업로드 중...")
    video_file = client.files.upload(file=VIDEO_PATH)
    video_file = wait_until_ready(video_file)

    prompt = build_prompt(question, choices)

    print("AI 분석 중...")

    start = time.perf_counter()

    response = client.models.generate_content(
        model=MODEL,
        contents=[video_file, prompt],
    )

    elapsed = time.perf_counter() - start

    answer = response.text.strip()

    print("\n====================")
    print("정답:", answer)
    print(f"풀이 시간: {elapsed:.3f}초")
    print("====================")


if __name__ == "__main__":
    main()