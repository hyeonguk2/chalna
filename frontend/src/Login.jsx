import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  // 1. 입력값 및 마우스 궤적 데이터를 담을 React State 선언
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mouseTrajectory, setMouseTrajectory] = useState([]);

  // 2. 실시간 마우스 움직임 감지 (30ms 간격으로 효율적 수집)
  useEffect(() => {
    let lastLoggedTime = 0;

    const handleMouseMove = (event) => {
      const now = Date.now();

      if (now - lastLoggedTime > 30) {
        setMouseTrajectory((prev) => [
          ...prev,
          { 
            x: event.clientX, // 브라우저 창 기준 X 좌표
            y: event.clientY, // 브라우저 창 기준 Y 좌표
            t: now            // 타임스탬프 (밀리초)
          }
        ]);
        lastLoggedTime = now;
      }
    };

    // 화면 전체에 마우스 움직임 감지기 부착
    window.addEventListener("mousemove", handleMouseMove);

    // 컴포넌트가 언마운트(종료)될 때 감지기 제거
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  // 3. 로그인 버튼 제출(Submit) 핸들러 함수
  const handleSubmit = async (event) => {
    event.preventDefault(); // 페이지 새로고침 방지

    // 최종 백엔드로 보낼 포장 데이터
    const loginData = {
      username: username,
      password: password,
      mouseTrajectory: mouseTrajectory // 수집한 마우스 데이터 배열 추가!
    };

    // 작동 여부 확인용 로컬 콘솔 로그
    console.log("=== [Frontend] 마우스 궤적 수집 완료 ===");
    console.log("수집된 좌표 개수:", mouseTrajectory.length);
    console.log("전송 데이터 패키지:", loginData);

    try {
      // 팀장님이 설정할 백엔드 API 주소로 전송
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginData)
      });

      const result = await response.json();
      
      if (result.success) {
        alert("로그인 성공!");
        navigate("/"); // 로그인 성공 시 메인 화면으로 이동
      } else {
        alert(`로그인 실패: ${result.message}`);
      }

    } catch (error) {
      console.error("백엔드 전송 중 에러 발생:", error);
      alert("서버 연결 실패! 개발자 도구(F12) 콘솔에서 수집된 데이터를 확인해 보세요.");
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 flex items-center justify-center text-white">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-8">
        
        {/* 홈 버튼 */}
        <div className="mb-4">
          <Link
            to="/"
            className="text-sm text-zinc-400 hover:text-white underline"
          >
            ← 홈으로 돌아가기
          </Link>
        </div>

        <h1 className="text-white text-2xl font-semibold mb-6 text-center">
          로그인
        </h1>

        {/* 기존의 버튼 클릭 방식 대신, 정석적인 onSubmit 폼 구조로 변경하여 이벤트를 처리합니다 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          
          <input
            type="text"
            placeholder="아이디"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg outline-none focus:border-purple-500"
            required
          />

          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg outline-none focus:border-purple-500"
            required
          />

          {/* type="button"을 type="submit"으로 변경하여 엔터를 쳐도 로그인이 되도록 개선했습니다 */}
          <button
            type="submit"
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition"
          >
            로그인
          </button>

        </form>

        <div className="text-sm text-zinc-400 mt-4 text-center">
          계정이 없으면{" "}
          <Link to="/signup" className="underline text-zinc-400">
            회원가입
          </Link>
        </div>

      </div>
    </div>
  );
}