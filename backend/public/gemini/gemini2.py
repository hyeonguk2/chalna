import os
import time
from dotenv import load_dotenv
from google import genai

load_dotenv()

VIDEO_PATH = "video/word11.mp4"
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
    print("\n[문제 설정]")
    print("AI가 영상 속 문제를 스스로 읽도록 설정합니다.")

    choices = ["사자","사과","가사","과일"]
    print("\n보기 입력. 끝내려면 빈 값 Enter")

    return choices


def build_prompt(choices):
    choices_text = "\n".join(
        [f"{i + 1}. {choice}" for i, choice in enumerate(choices)]
    )

    return f"""
너는 영상 문제를 푸는 agent다.

1. 영상 전체를 분석하여 화면에 적힌 '문제'가 무엇인지 파악해라.
2. 정답을 골라라.

보기:
{choices_text}

규칙:
- 문제 내용을 먼저 파악하고, 그 문제에 맞는 정답을 골라라.
- 설명하지 마라.
- 오직 정답 번호(숫자)만 출력해라.
- 예: 1
"""

def main():
    if not os.path.exists(VIDEO_PATH):
        raise Exception(f"영상 파일이 없습니다: {VIDEO_PATH}")

    choices = ask_problem_setting()

    print("\n영상 업로드 중...")
    video_file = client.files.upload(file=VIDEO_PATH)
    video_file = wait_until_ready(video_file)

    prompt = build_prompt(choices)

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