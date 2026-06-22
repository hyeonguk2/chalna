import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
// import CaptchaWidget from "./CaptchaWidget"; // 팀원이 만든 캡차 컴포넌트 (가정)

export default function Login() {
  const navigate = useNavigate(); // [수정 1] 부드러운 페이지 이동을 위한 훅
  const [phase, setPhase] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // ==========================================
  // 1. 행동 데이터 수집 저장소: 마우스 궤적, 클릭 패턴 (렌더링 영향 X)
  // ==========================================
  const behaviorData = useRef({
    mouseTrajectory: [],
    clickData: [],
  });

  // ==========================================
  // 2. 백그라운드 행동 감지 리스너
  // ==========================================
  useEffect(() => {
    let lastMouseTime = 0;

    const handleMouseMove = (e) => {
      const now = Date.now();
      if (now - lastMouseTime > 30) {
        behaviorData.current.mouseTrajectory.push({ x: e.clientX, y: e.clientY, t: now });
        lastMouseTime = now;
      }
    };

    const handleMouseDown = (e) => behaviorData.current.clickData.push({ type: "down", x: e.clientX, y: e.clientY, t: Date.now() });
    const handleMouseUp = (e) => behaviorData.current.clickData.push({ type: "up", x: e.clientX, y: e.clientY, t: Date.now() });
    
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // [로그인 폼 담당] 로그인 1차 시도 (캡차로 이동)
  const handleInitialSubmit = (e) => {
    e.preventDefault();
    if (username && password) setPhase(2);
  };

  // ==========================================
  // 3. 캡차 완료 시 데이터 패키징 및 백엔드 전송
  // ==========================================
const handleFinalSubmit = async (mvCaptchaData) => {
  const payload = {
    username,
    password,
    // boolean 대신, 캡차 위젯이 넘겨준 상세 데이터를 객체 형태로 전송
    captchaData: mvCaptchaData, 
    behaviorMetrics: behaviorData.current
  };

  try {
    const response = await fetch(`${API}/api/analyze-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

      const result = await response.json();

      // [결과페이지 담당] 결과 분기 처리 (로그인 실패 이유는 숨김)
      if (result.success && !result.isBot) {
        alert("로그인 성공");
        navigate("/"); // [수정 1] window.location.href 대신 SPA 라우팅 사용
      } else {
        alert("로그인에 실패했습니다. 다시 시도해주세요.");
        setPhase(1); // 다시 첫 로그인 화면으로
        setPassword("");
        // 실패 시 수집된 데이터 초기화
        behaviorData.current = { mouseTrajectory: [], clickData: [] };
      }
    } catch (error) {
      console.error("서버 에러:", error);
      alert("서버 통신 오류");
    }
  };

// 렌더링 영역 (Phase 1, 2 추후 입력 필요!)
  return (
    <div className="min-h-screen w-full bg-zinc-950 flex items-center justify-center text-white">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-8">
        
        {/* ================= [수정 2] Phase 1: 기본 로그인 폼 ================= */}
        {phase === 1 && (
          <>
            <div className="mb-4">
              <Link to="/" className="text-sm text-zinc-400 hover:text-white underline">
                ← 홈으로 돌아가기
              </Link>
            </div>

            <h1 className="text-white text-2xl font-semibold mb-6 text-center">
              로그인2
            </h1>

            <form onSubmit={handleInitialSubmit} className="flex flex-col gap-4">
              {/* 아이디 입력칸 */}
<input
  type="text"
  placeholder="아이디"
  value={username}
  onChange={(e) => setUsername(e.target.value)}
  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg outline-none focus:border-purple-500"
  autoComplete="username"       // <-- 이 줄 추가
  required
/>

{/* 비밀번호 입력칸 */}
<input
  type="password"
  placeholder="비밀번호"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg outline-none focus:border-purple-500"
  autoComplete="current-password" // <-- 이 줄 추가
  required
/>

              <button
                type="submit"
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition"
              >
                다음 (캡차 인증)
              </button>
            </form>

            <div className="text-sm text-zinc-400 mt-4 text-center">
              계정이 없으면{" "}
              <Link to="/signup" className="underline text-zinc-400">
                회원가입
              </Link>
            </div>
          </>
        )}

        {/* ================= [수정 2] Phase 2: 인지적 직관 캡차 영역 ================= */}
        {phase === 2 && (
          <div className="flex flex-col items-center">
            <h2 className="text-xl font-medium mb-4">보안 인증</h2>
            <p className="text-zinc-400 text-sm mb-6 text-center">
              아래 캡차 문제를 풀어주세요.
            </p>
            
            {/* 팀원이 개발 중인 직관 캡차 컴포넌트 위치 */}
            <div className="w-full h-48 bg-zinc-800 border border-dashed border-zinc-600 rounded-lg flex items-center justify-center mb-6">
              <span className="text-zinc-500">캡차 UI 영역</span>
            </div>

            {/* 임시 제출 버튼 (실제 연동 시 캡차 내부 콜백으로 대체) */}
            <button 
              onClick={() => handleFinalSubmit({ id: "temp_captcha", answer: true })}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition"
            >
              캡차 인증 완료 (서버 전송)
            </button>
            
            <button 
              onClick={() => setPhase(1)}
              className="mt-4 text-sm text-zinc-500 hover:text-zinc-300 underline"
            >
              취소하고 뒤로 가기
            </button>
          </div>
        )}

      </div>
    </div>
  );
}