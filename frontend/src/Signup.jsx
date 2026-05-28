import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

export default function Signup() {

  const [userid, setUserid] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");


  const [codeSent, setCodeSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);

  // 이메일 검증
  const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // 인증번호 전송 (백엔드 연결 안 되어있어서 UI용)
  const sendCode = () => {
    if (!email) return alert("이메일 입력");
    if (!isValidEmail(email)) return alert("이메일 형식 오류");

    setCodeSent(true);
    setVerified(false);
    setCode("");
    setTimeLeft(180);
  };

  // 인증 확인 (임시 로직)
  const verifyCode = () => {
    if (!code) return alert("인증번호 입력");
    if (timeLeft <= 0) return alert("시간 만료");

    setVerified(true);
    setCodeSent(false);
  };

  // 타이머
  useEffect(() => {
    if (!codeSent || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [codeSent, timeLeft]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // 회원가입 (DB 연결 핵심)
  const handleSignup = async () => {
    if (!verified) return alert("이메일 인증 필요");
    if (!email || !password) return alert("입력 확인");

    try {
      const res = await fetch("http://localhost:3001/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userid: userid,
          email,
          password,
        }),
      });

      const data = await res.text();
      console.log(data);

      alert("회원가입 완료");
    } catch (err) {
      console.error(err);
      alert("서버 오류");
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white flex items-center justify-center">
      <div className="w-full max-w-md bg-zinc-900 p-8 rounded-xl border border-zinc-800">

        {/* 홈 */}
        <div className="mb-4">
          <Link to="/" className="text-sm text-zinc-400 underline">
            ← 홈으로
          </Link>
        </div>

        <h1 className="text-white text-2xl mb-6 text-center">회원가입</h1>

        {/* 아이디 */}
        <input
          className="w-full mb-3 p-3 bg-zinc-800 rounded"
          placeholder="아이디"
          value={userid}
          onChange={(e) => setUserid(e.target.value)}
        />

        {/* 비밀번호 */}
        <input
          className="w-full mb-3 p-3 bg-zinc-800 rounded"
          placeholder="비밀번호"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* 이메일 */}
        <input
          className="w-full mb-3 p-3 bg-zinc-800 rounded"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {/* 인증 버튼 */}
        {!verified && (
          <button
            onClick={sendCode}
            disabled={!email || !isValidEmail(email)}
            className={`w-full mb-3 py-2 rounded ${email && isValidEmail(email)
              ? "bg-blue-600"
              : "bg-gray-600 cursor-not-allowed"
              }`}
          >
            인증번호 받기
          </button>
        )}

        {/* 인증 입력 + 타이머 */}
        {codeSent && !verified && (
          <div className="mb-3 relative">
            <input
              className="w-full p-3 pr-16 bg-zinc-800 rounded"
              placeholder="인증번호"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />

            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-red-400">
              {timeLeft > 0 ? formatTime(timeLeft) : "만료"}
            </div>
          </div>
        )}

        {/* 확인 */}
        {codeSent && !verified && (
          <button
            onClick={verifyCode}
            className="w-full bg-green-600 py-2 rounded mb-3"
          >
            확인
          </button>
        )}

        {/* 완료 */}
        {verified && (
          <p className="text-green-400 text-center mb-3">
            인증 완료
          </p>
        )}

        {/* 가입 */}
        <button
          onClick={handleSignup}
          className="w-full bg-purple-600 py-3 rounded"
        >
          가입하기
        </button>
      </div>
    </div>
  );
}