import { Link, useNavigate } from "react-router-dom";

export default function Login() {
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

        <form className="flex flex-col gap-4">
          
          <input
            type="text"
            placeholder="아이디"
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg outline-none focus:border-purple-500"
          />

          <input
            type="password"
            placeholder="비밀번호"
            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg outline-none focus:border-purple-500"
          />

          <button
            type="button"
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition"
          >
            로그인
          </button>

        </form>

        <div className="text-sm text-zinc-400 mt-4 text-center">
          계정이 없으면 <Link to="/signup" className="underline text-zinc-400">
        회원가입
      </Link>
        </div>

      </div>
    </div>
  );
}