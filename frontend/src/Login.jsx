import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();
  const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mouseTrajectory, setMouseTrajectory] = useState([]);

  useEffect(() => {
    let lastLoggedTime = 0;

    const handleMouseMove = (event) => {
      const now = Date.now();

      if (now - lastLoggedTime > 30) {
        setMouseTrajectory((prev) => [
          ...prev,
          { 
            x: event.clientX,
            y: event.clientY,
            t: now
          }
        ]);
        lastLoggedTime = now;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const loginData = {
      username: username,
      password: password,
      behaviorMetrics: {
        mouseTrajectory: mouseTrajectory,
        clickData: []
      }
    };

    try {

      const response = await fetch(`${API}/api/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(loginData)
      });

      const result = await response.json().catch(() => ({
        success: false,
        message: `서버 응답을 읽을 수 없습니다. (${response.status})`
      }));
      
      if (result.success) {
        alert("로그인 성공!");
        navigate("/");
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
