import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_URL = "http://localhost:3001";

export default function Signup() {
  const [userid, setUserid] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [resendTimeLeft, setResendTimeLeft] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const resetVerification = () => {
    setCodeSent(false);
    setVerified(false);
    setVerifiedEmail("");
    setCode("");
    setTimeLeft(0);
    setResendTimeLeft(0);
  };

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    resetVerification();
  };

  const sendCode = async () => {
    if (!email) return alert("이메일을 입력해 주세요.");
    if (!isValidEmail(email)) return alert("이메일 형식이 올바르지 않습니다.");

    try {
      setSendingCode(true);

      const res = await fetch(`${API_URL}/send-email-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await res.text();

      if (!res.ok) {
        if (res.status === 429) {
          const { retryAfter } = JSON.parse(data);
          setResendTimeLeft(retryAfter);
          return alert(`${retryAfter}초 후에 다시 요청해 주세요.`);
        }

        if (data === "email config missing") {
          return alert("서버 이메일 설정이 필요합니다.");
        }

        return alert("인증번호 전송에 실패했습니다.");
      }

      setCodeSent(true);
      setVerified(false);
      setVerifiedEmail("");
      setCode("");
      setTimeLeft(180);
      setResendTimeLeft(30);
      alert("인증번호를 이메일로 보냈습니다.");
    } catch (err) {
      console.error(err);
      alert("서버 오류가 발생했습니다.");
    } finally {
      setSendingCode(false);
    }
  };

  const verifyCode = async () => {
    if (!code) return alert("인증번호를 입력해 주세요.");
    if (timeLeft <= 0) return alert("인증 시간이 만료되었습니다.");

    try {
      setCheckingCode(true);

      const res = await fetch(`${API_URL}/verify-email-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, code }),
      });

      const data = await res.text();

      if (!res.ok) {
        if (data === "expired") {
          return alert("인증 시간이 만료되었습니다. 다시 요청해 주세요.");
        }

        return alert("인증번호가 올바르지 않습니다.");
      }

      setVerified(true);
      setVerifiedEmail(email);
      setCodeSent(false);
      setTimeLeft(0);
      alert("이메일 인증이 완료되었습니다.");
    } catch (err) {
      console.error(err);
      alert("서버 오류가 발생했습니다.");
    } finally {
      setCheckingCode(false);
    }
  };

  useEffect(() => {
    if (!codeSent || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [codeSent, timeLeft]);

  useEffect(() => {
    if (!codeSent || resendTimeLeft <= 0) return;

    const timer = setInterval(() => {
      setResendTimeLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [codeSent, resendTimeLeft]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSignup = async () => {
    if (!userid || !password || !email) return alert("모든 항목을 입력해 주세요.");
    if (!verified || verifiedEmail !== email) return alert("이메일 인증이 필요합니다.");

    try {
      setSigningUp(true);

      const res = await fetch(`${API_URL}/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userid,
          email,
          password,
        }),
      });

      const data = await res.text();

      if (!res.ok) {
        if (data === "duplicate") {
          return alert("이미 사용 중인 아이디 또는 이메일입니다.");
        }

        if (data === "email not verified") {
          resetVerification();
          return alert("이메일 인증이 필요합니다.");
        }

        return alert("회원가입에 실패했습니다.");
      }

      alert("회원가입이 완료되었습니다.");
    } catch (err) {
      console.error(err);
      alert("서버 오류가 발생했습니다.");
    } finally {
      setSigningUp(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-zinc-900 p-8 rounded-xl border border-zinc-800">
        <div className="mb-4">
          <Link to="/" className="text-sm text-zinc-400 underline">
            홈으로
          </Link>
        </div>

        <h1 className="text-white text-2xl mb-6 text-center">회원가입</h1>

        <input
          className="w-full mb-3 p-3 bg-zinc-800 rounded"
          placeholder="아이디"
          value={userid}
          onChange={(e) => setUserid(e.target.value)}
        />

        <input
          className="w-full mb-3 p-3 bg-zinc-800 rounded"
          placeholder="비밀번호"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <input
          className="w-full mb-3 p-3 bg-zinc-800 rounded"
          placeholder="이메일"
          value={email}
          onChange={handleEmailChange}
        />

        {!verified && (
          <button
            onClick={sendCode}
            disabled={!email || !isValidEmail(email) || sendingCode || (codeSent && resendTimeLeft > 0)}
            className={`w-full mb-3 py-2 rounded ${
              email && isValidEmail(email) && !sendingCode && (!codeSent || resendTimeLeft <= 0)
                ? "bg-blue-600"
                : "bg-gray-600 cursor-not-allowed"
            }`}
          >
            {sendingCode
              ? "전송 중..."
              : codeSent
                ? resendTimeLeft > 0
                  ? `인증번호 재전송 (${formatTime(resendTimeLeft)})`
                  : "인증번호 재전송"
                : "인증번호 받기"}
          </button>
        )}

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

        {codeSent && !verified && (
          <button
            onClick={verifyCode}
            disabled={checkingCode}
            className="w-full bg-green-600 py-2 rounded mb-3 disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            {checkingCode ? "확인 중..." : "확인"}
          </button>
        )}

        {verified && (
          <p className="text-green-400 text-center mb-3">인증 완료</p>
        )}

        <button
          onClick={handleSignup}
          disabled={signingUp}
          className="w-full bg-purple-600 py-3 rounded disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
          {signingUp ? "가입 중..." : "가입하기"}
        </button>
      </div>
    </div>
  );
}
