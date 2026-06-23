import { Link } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import "./App.css";

export default function HomePage() {
    const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
    const ANSWER_TIME_LIMIT_MS = 5000;

    //모달용
    const videoRef = useRef(null); //영상모듈
    const [videoUrl, setVideoUrl] = useState(null); //영상 링크 - 보안문제 해결필요!
    const [captchaopen, setCaptchaopen] = useState(false); //모달 창 상태
    const [started, setStarted] = useState(false); //영상 시작
    const [ended, setEnded] = useState(false); //모달 영상 종료상태
    const [result, setResult] = useState(null); //실패,성공 문자
    const [endedTime, setEndedTime] = useState(null); //영상 끝난 시간
    const [remainTime, setRemainTime] = useState(0); //영상 후 5초 타이머
    const [progress, setProgress] = useState(0); //영상typeA 상태바
    const imgIntervalRef = useRef(null); // ⭐️ [추가] 이미지용 가상 타이머 Ref
    const loginTransitionRef = useRef(null);

    //캡챠데이터용
    const [captchaId, setCaptchaId] = useState(null); //문제 고유id
    const [options, setOptions] = useState([]);  //문제 선택지
    const [guideText, setGuideText] = useState(""); //영상 위 문자
    const [startTime, setStartTime] = useState(null); // 시작시간 
    const [type, setType] = useState(null); // 영상 타입
    const [duration, setDuration] = useState(0);
    const [currentLevel, setCurrentLevel] = useState(1);
    const [solveElapsed, setSolveElapsed] = useState(0);
    const [finalSolveTime, setFinalSolveTime] = useState(null);
    // ⭐️ [추가] 캡차 성공 여부를 기록할 상태 변수
    const [isCaptchaPassed, setIsCaptchaPassed] = useState(false);

    const [sessionUser, setSessionUser] = useState(null);
    const [loginUsername, setLoginUsername] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [mouseTrajectory, setMouseTrajectory] = useState([]);
    const [loginError, setLoginError] = useState("");
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const formatSeconds = (value) => `${Number(value || 0).toFixed(1)}초`;

    //users table 에 login_attempts 컬럼을 임시로 추가했는데 이걸 fk로 따로 테이블 만들어서 연결할지 결정필요
    //fk로 별도로 만들면 captcha 시도횟수, 시도한 영상 제목이나 유형을 넣을 컬럼이 필요할것같아요.(같은 captcha시도 방지)

    useEffect(() => {
        const loadSession = async () => {
            try {
                const res = await fetch("/api/me", {
                    credentials: "include"
                });
                if (!res.ok) {
                    setSessionUser(null);
                    return;
                } if (res.status === 401) {
                    setSessionUser(null);
                    return;
                }

                const data = await res.json();
                setSessionUser(data.user || null);
            } catch (error) {
                console.error("session check failed:", error);
                setSessionUser(null);
            }
        };

        loadSession();
    }, []);

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

    const performLogin = async () => {
        setIsLoggingIn(true);
        const loginData = {
            username: loginUsername,
            password: loginPassword,
            behaviorMetrics: {
            mouseTrajectory,
            clickData: []
            },
            captchaData: {
                answer: true
            }
        };

        try {
            const response = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(loginData)
            });

            const result = await response.json().catch(() => ({
                success: false,
                message: `서버 응답을 읽을 수 없습니다. (${response.status})`
            }));

            if (!response.ok || !result.success || result.isBot) {
                setLoginError(result.message || "로그인 실패");
                setIsLoggingIn(false);
                alert(result.message);
                return;
            }

            const sessionResponse = await fetch("/api/me", { credentials: "include" });
            const sessionData = await sessionResponse.json();

            if (!sessionResponse.ok || !sessionData.authenticated || !sessionData.user) {
                setLoginError("Session verification failed");
                setIsLoggingIn(false);
                return;
            }

            setSessionUser(sessionData.user);
            setLoginUsername("");
            setLoginPassword("");
            setMouseTrajectory([]);
        } catch (error) {
            console.error("login failed:", error);
            setLoginError("서버 연결 실패");
            setIsLoggingIn(false);
        }
    };

    const login = (event) => {
        event.preventDefault();
        setLoginError("");

        // 로그인 버튼은 CAPTCHA 안내 화면만 열고, 실제 영상은 안내 화면의 시작 버튼으로 재생한다.
        if (!isCaptchaPassed) {
            setCaptchaopen(true);
            return;
        }

        performLogin();
    };

    const logout = async () => {
        try {
            await fetch("/api/logout", { method: "POST", credentials: "include" });
        } finally {
            setSessionUser(null);
            setIsCaptchaPassed(false);
            setLoginError("");
            setIsLoggingIn(false);
        }
    };

    //영상 캡차 불러오기
    const startCaptcha = async (forceType = "") => {
        reset();
        if (!loginUsername) {
            alert("아이디를 먼저 입력해주세요.");
            return;
        }

        const params = new URLSearchParams({ userId: loginUsername });
        if (forceType) params.set("forceType", forceType);

        const res = await fetch(`${API}/mvcaptcha?${params.toString()}`);
        const data = await res.json();

        // 2. 영상 요청
        const videoRes = await fetch(`${API}/mvcaptcha/video`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                captchaId: data.captchaId
            })
        });
        const videoData = await videoRes.json();
        setEnded(false);
        setVideoUrl(videoData.video);   // ★ 중요
        setGuideText(data.question);
        setCaptchaId(data.captchaId);   // ★ 중요
        setOptions(data.options);   // ★ 중요
        setType(data.type);
        setCurrentLevel(data.currentLevel || 1);
        if (data.type === "C" || data.type === "D") {
            setDuration(5);
        }
        setStarted(true);
    };

    // 정답 전송
    const handleAnswer = (answer) => {
        if (!startTime) return;

        const answeredAt = new Date().getTime();
        const answeredInDeadTime = 
            ended &&
            endedTime &&
            answeredAt- endedTime <= 5000;

        const timeDiffMs = answeredAt - startTime;
        const t = timeDiffMs / 1000;
        setFinalSolveTime(t);

        // 1. 버튼을 누른 즉시 타이머 관련 상태를 모두 초기화/종료합니다. (스쳐 지나가는 현상 방지)
        setEndedTime(null);
        setEnded(false); // ⭐️ [추가] 이 상태를 false로 바꿔야 "X초 남음" 안내창이 즉시 닫힙니다.
        setRemainTime(0); // ⭐️ [추가] 남은 시간도 즉시 0으로 초기화

        // ⭐️ 이미지 타이머 정지 처리
        if (imgIntervalRef.current) {
            clearInterval(imgIntervalRef.current);
            imgIntervalRef.current = ""; // 빈 값으로 초기화
        }

        const video = videoRef.current;
        if (video) {
            video.pause();
        }
        console.log(t);

        // 정답 전송
        submitCaptcha(t, answer, answeredInDeadTime);
    };

    //영상/이미지 캡차 검증
    const submitCaptcha = async (t, answer, answeredInDeadTime = false) => {
        // 1. [강제 정지] 이미지 가상 타이머 인터벌 즉시 정지 및 값 고정
        if (imgIntervalRef.current) {
            clearInterval(imgIntervalRef.current);
            imgIntervalRef.current = null;

            // 클릭한 시점(t) 기준으로 progress와 remainTime을 화면에 강제 고정
            const virtualDuration = 5;
            const currentTimeSec = t;
            setProgress(Math.min((currentTimeSec / virtualDuration) * 100, 100));
            setRemainTime(Math.min(currentTimeSec, virtualDuration));
        }

        // 2. [강제 정지] 비디오 캡차일 경우 비디오 재생도 즉시 일시정지
        if (type !== "C" && type !== "D" && videoRef.current) {
            videoRef.current.pause();
        }

        // 3. 캡챠 종료 상태 지정
        setEnded(true);
        setEndedTime(new Date().getTime());

        // 4. 서버 검증 요청 수행
        try {
            const res = await fetch(`${API}/mvcaptcha/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    captchaId,
                    answer,
                    userId: loginUsername,
                    clickTime: t,
                    type,
                    answeredInDeadTime,
                    solveTime: Number(t.toFixed(3))
                })
            });

            const data = await res.json();
            console.log(data.reason);

            if (data.goToLevel2 || data.reason === "d_stage_unlocked") {
                setIsCaptchaPassed(false);
                setResult("d_stage");
                loginTransitionRef.current = setTimeout(() => {
                    startCaptcha(data.nextType || "D");
                }, 900);
                return;
            }

            if (data.reason === "success") {
                setIsCaptchaPassed(true);
                setResult("human");
                loginTransitionRef.current = setTimeout(() => {
                    setCaptchaopen(false);
                    setResult(null);
                    performLogin();
                }, 1000);
                return;
            }

            setIsCaptchaPassed(false);
            setResult(data.reason || "fail");
        } catch (error) {
            console.error("검증 중 오류 발생:", error);
            setResult("fail");
        }
    };

    // ⭐️ [수정] 비디오 및 이미지 초기 실행 흐름 제어 제어
    useEffect(() => {
        if (!started || !videoUrl) return;

        // 1. 비디오 타입일 때 제어
        if (type !== "C" && type !== "D" && videoRef.current) {
            const url = `${API}${videoUrl}`;
            videoRef.current.src = url;
            videoRef.current.load();

            videoRef.current.play().then(() => {
                setStartTime(Date.now());
                setSolveElapsed(0);
                setFinalSolveTime(null);
            }).catch(err => console.log("자동 재생 차단 또는 오류:", err));
        }

        // 2. 이미지 타입('C')일 때 제어 (가상 타이머 구동)
        else if (type === "C" || type === "D") {
            const virtualDuration = 5; // 5초 동안 이미지 활성화 및 CSS 애니메이션 진행
            const imageStartTime = new Date().getTime();
            setTimeout(() => {
                setStartTime(imageStartTime);
                setSolveElapsed(0);
                setFinalSolveTime(null);
            }, 0);

            const intervalImg = setInterval(() => {
                setStartTime(prevStartTime => {
                    if (!prevStartTime) return prevStartTime;

                    const currentTimeSec = (new Date().getTime() - prevStartTime) / 1000;

                    // 진행바 업데이트
                    setProgress((currentTimeSec / virtualDuration) * 100);

                    // 지정된 duration에 도달했을 때 (재생 종료 상황)
                    if (currentTimeSec >= virtualDuration) {
                        clearInterval(intervalImg);
                        setEnded(true);
                        setEndedTime(new Date().getTime());
                        setRemainTime(5); // 종료 후 정답 마킹 추가 5초 카운트다운 시작
                    }
                    return prevStartTime;
                });
            }, 30); // 약 30ms 간격으로 progress 갱신 (RAF 대용)

            imgIntervalRef.current = intervalImg;
        }

        return () => {
            if (imgIntervalRef.current) clearInterval(imgIntervalRef.current);
        };
    }, [started, videoUrl, type]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || type === "C" || type === "D") return;
        let raf;

        const update = () => {
            if (video.duration) {
                setProgress((video.currentTime / video.duration) * 100);
            }
            raf = requestAnimationFrame(update);
        };

        raf = requestAnimationFrame(update);

        return () => cancelAnimationFrame(raf);
    }, [videoUrl, type]);

    useEffect(() => {
        if (!started || !startTime || result !== null) return;

        const timer = setInterval(() => {
            setSolveElapsed((new Date().getTime() - startTime) / 1000);
        }, 100);

        return () => clearInterval(timer);
    }, [started, startTime, result]);

    // 5초 카운트다운 및 0초 도달 시 자동 실패 처리
    // 5초 카운트다운 및 0초 도달 시 자동 실패 처리
    useEffect(() => {
        // ⭐️endedTime이 없거나, 이미 성공/실패 결과(result)가 나왔다면 타이머를 돌리지 않음
        if (!endedTime || result !== null) return;

        const timer = setInterval(() => {
            const totalDuration = ANSWER_TIME_LIMIT_MS;
            const elapsed = new Date().getTime() - endedTime;
            const remain = Math.max(0, totalDuration - elapsed);

            const remainSeconds = remain / 1000; // 밀리초를 초 단위로 변환

            if (remainSeconds <= 1.0) {
                setRemainTime(remainSeconds.toFixed(1));
            } else {
                setRemainTime(Math.ceil(remainSeconds));
            }

            // 0초에 도달했을 때
            if (remain <= 0) {
                clearInterval(timer);
                setEndedTime(null);

                // ⭐️ 인터벌이 실행되는 순간 찰나의 타이밍에 result가 채워졌는지 다시 한번 체크
                if (result !== null) return;

                let currentVerifyTime = 0;

                if (type === "C" || type === "D") {
                    currentVerifyTime = duration;
                    if (imgIntervalRef.current) clearInterval(imgIntervalRef.current);
                } else {
                    const video = videoRef.current;
                    if (video && video.readyState >= 2) {
                        currentVerifyTime = video.currentTime;
                        video.pause();
                    }
                }
                setFinalSolveTime(startTime ? (new Date().getTime() - startTime) / 1000 : currentVerifyTime);
                submitCaptcha(currentVerifyTime, "", false);
            }
        }, 50);

        return () => clearInterval(timer);
    }, [endedTime, type, duration, result, startTime]); // ⭐️ 의존성 배열에 result 추가

    //영상 초기화
    const reset = () => {
        if (loginTransitionRef.current) {
            clearTimeout(loginTransitionRef.current);
            loginTransitionRef.current = null;
        }

        if (imgIntervalRef.current) {
            clearInterval(imgIntervalRef.current); // ⭐️ 이미지 타이머 초기화 필수
        }

        const video = videoRef.current;
        if (video) {
            video.pause();
            video.removeAttribute("src");
            video.load();
            video.currentTime = 0;
        }
        setRemainTime(0);
        setStarted(false);
        setResult(null);
        setVideoUrl("");
        setOptions([]);
        setGuideText("");
        setStartTime(null);
        setProgress(0);
        setEndedTime(null);
        setRemainTime(0);
        setEnded(false);
        setResult(null);
        setCurrentLevel(1);
        setSolveElapsed(0);
        setFinalSolveTime(null);


    };
    return (

        <div className="h-[100dvh] w-full overflow-hidden bg-zinc-950 text-white flex flex-col">
            {/* Header */}
            <header className="border-b border-zinc-800 backdrop-blur">
                <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
                    <h1 className="text-white text-2xl font-bold tracking-tight">
                        Vision CAPTCHA
                    </h1>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
                        {sessionUser ? (
                            <button
                                type="button"
                                onClick={logout}
                                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white transition"
                            >
                                로그아웃
                            </button>
                        ) : null}
                    </div>
                </div>
            </header>

            {/* Hero */}
            <section
                id="about"
                className="w-full max-w-7xl mx-auto flex flex-1 items-center px-6 py-8"
            >
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <div>
                        <p className="text-zinc-400 mb-4 text-sm uppercase tracking-[0.2em]">
                            AI 에이전트 탐지 시스템
                        </p>

                        <h2 className="text-white text-5xl font-bold leading-tight mb-6">
                            실시간 영상
                            <br />
                            CAPTCHA 플랫폼
                        </h2>

                        <p className="text-zinc-400 text-lg leading-relaxed mb-8 max-w-xl">
                            실시간 Vision 분석을 강제하여 자동화 비용을 증가시키는
                            CAPTCHA 시스템입니다.
                        </p>

                        {captchaopen && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm">
                                    <div className="w-[800px] max-w-[95vw] rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-950/80 via-zinc-900 to-zinc-950 p-6 shadow-2xl shadow-violet-950/40">
                                        <div className="mb-5 flex items-center justify-between">
                                            <div>
                                                <p className="text-sm text-violet-200/70">보안 인증</p>
                                                <h3 className="mt-1 text-xl font-semibold text-white">CAPTCHA 챌린지</h3>
                                                {started && (
                                                    <p className="mt-1 text-sm text-zinc-400">
                                                        {currentLevel === "D" ? "D 단계" : `${currentLevel}단계`}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => {
                                                    reset();
                                                    setCaptchaopen(false);
                                                }}
                                                className="rounded-xl border border-violet-300/15 bg-black/20 px-4 py-2 text-sm text-violet-100 transition hover:bg-violet-400/15"
                                            >
                                                닫기
                                            </button>
                                        </div>

                                        <div className="aspect-video relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
                                            {type === "C" || type === "D" ? (
                                                <div className="w-full h-full bg-zinc-900 relative flex items-center justify-center">
                                                    {started && (
                                                        <img
                                                            src={`${API}${videoUrl}`}
                                                            alt="captcha"
                                                            // 💡 ended가 되면 투명도를 주거나 필터를 먹여 '멈춤 효과' 비주얼을 제공할 수 있습니다.
                                                            className={`w-full h-full object-cover transition-all duration-300 ${ended ? "opacity-40 filter blur-sm" : type === "C" ? "animate-move" : ""
                                                                }`}
                                                        />)}
                                                </div>
                                            ) : (
                                                <video
                                                    ref={videoRef}
                                                    muted
                                                    playsInline
                                                    onLoadedMetadata={(e) => {
                                                        setDuration(e.target.duration);
                                                    }}
                                                    onEnded={() => {
                                                        setEnded(true);
                                                        setEndedTime(Date.now());
                                                        setRemainTime(5);
                                                    }}
                                                    className="w-full h-full object-cover"
                                                />)}
                                            {started && result === null && (
                                                <>
                                                    <div className="absolute right-4 top-4 z-40 flex flex-col items-end gap-1 rounded-lg bg-black/60 px-3 py-2 text-sm text-white pointer-events-none">
                                                        <span>풀이 {formatSeconds(finalSolveTime ?? solveElapsed)}</span>
                                                        {ended && <span className="text-red-300">제한 {remainTime}초</span>}
                                                    </div>
                                                    <div className="absolute top-4 left-0 w-full z-30 pointer-events-none">
                                                        <div className="mx-auto w-fit max-w-[90%] bg-black/50 text-white text-xl px-3 py-1 rounded-lg">
                                                            {ended ? "" : guideText}
                                                        </div>
                                                    </div>
                                                    <div className="absolute bottom-4 left-0 right-0 z-30 flex justify-center">
                                                        {/* 전체 컨트롤 영역 */}
                                                        <div className="w-[80%] mx-auto">

                                                            {/* progress bar (A만) */}
                                                            {type === "A" && (
                                                                <div className="relative w-full h-2 bg-zinc-700 rounded overflow-visible mb-6">

                                                                    {/* 초록 구간 + 숫자 */}
                                                                    {duration > 0 &&
                                                                        options.map((time, idx) => {
                                                                            const left = (time / duration) * 100;

                                                                            return (
                                                                                <div key={`options-${time}-${idx}`}>

                                                                                    {/* 초록 구간 */}
                                                                                    <div
                                                                                        className="absolute top-0 h-2 bg-green-500/50 z-10"
                                                                                        style={{
                                                                                            left: `${left}%`,
                                                                                            width: `${(0.7 / duration) * 100}%`,
                                                                                        }}
                                                                                    />

                                                                                    {/* 숫자 */}
                                                                                    <div
                                                                                        className="absolute top-[-20px] text-xs text-white z-30"
                                                                                        style={{
                                                                                            left: `${left + 2.5}%`,
                                                                                            transform: "translateX(-50%)",
                                                                                        }}
                                                                                    >
                                                                                        {idx + 1}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}

                                                                    {/* 구간 선 */}
                                                                    {/* <div className="absolute inset-0 flex z-20">
                                                                        {[...Array(4)].map((_, i) => (
                                                                            <div key={`slot-${i}`} className="flex-1 border-r border-zinc-300/70" />
                                                                        ))}
                                                                    </div> */}

                                                                    {/* 진행바 */}
                                                                    <div
                                                                        className="h-full bg-white relative z-30"
                                                                        style={{ width: `${progress}%` }}
                                                                    />
                                                                </div>
                                                            )}

                                                            {/* 버튼 영역 */}
                                                            <div className={`grid gap-5 ${type === "D" ? "grid-cols-3" : "grid-cols-4"}`}>

                                                                {/* A 타입 → 1~4 */}
                                                                {type === "A" &&
                                                                    [1, 2, 3, 4].map((num) => (
                                                                        <button
                                                                            key={`a-${num}`}
                                                                            onClick={() => handleAnswer(num - 1)}
                                                                            className="rounded-xl border border-violet-300/15 bg-zinc-900/80 p-2 text-xl backdrop-blur-sm transition hover:bg-violet-500/50"
                                                                        >
                                                                            {num}
                                                                        </button>
                                                                    ))
                                                                }

                                                                {/* A 제외 → options */}
                                                                {type !== "A" &&
                                                                    options.map((item, idx) => (
                                                                        <button
                                                                            key={`option-${item}-${idx}`}
                                                                            onClick={() => handleAnswer(item)}
                                                                            className="rounded-xl border border-violet-300/15 bg-zinc-900/80 p-2 text-xl backdrop-blur-sm transition hover:bg-violet-500/50"
                                                                        >
                                                                            {item}
                                                                        </button>
                                                                    ))
                                                                }

                                                            </div>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                            {started && ended && result === null && (
                                                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-20 pointer-events-none">
                                                    <div className="text-white text-2xl font-bold">
                                                        정답을 선택하세요
                                                    </div>
                                                    <div className="text-red-400 text-lg font-bold mt-2">
                                                        {remainTime}초 남음
                                                    </div>
                                                </div>
                                            )}

                                            {result && (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-20">
                                                    {result === "human" ? (
                                                        <>
                                                            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border-4 border-green-400 text-5xl text-green-400">
                                                                ✓
                                                            </div>
                                                            <div className="text-2xl font-bold text-green-400">사람입니다</div>
                                                            <p className="mt-2 text-sm text-zinc-300">풀이시간 {formatSeconds(finalSolveTime ?? solveElapsed)}</p>
                                                            <p className="mt-2 text-sm text-zinc-300">로그인 중입니다...</p>
                                                        </>
                                                    ) : result === "d_stage" ? (
                                                        <>
                                                            <div className="mb-4 text-2xl font-bold text-violet-200">
                                                                D 단계로 이동합니다
                                                            </div>
                                                            <p className="text-sm text-zinc-300">풀이시간 {formatSeconds(finalSolveTime ?? solveElapsed)}</p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className={`mb-4 text-2xl font-bold ${result === "too_fast" ? "text-yellow-400" : "text-red-400"}`}>
                                                                {result === "too_fast" ? "너무 빠름" : result === "timeout" ? "시간 초과" : "실패"}
                                                            </div>
                                                            <p className="mb-4 text-sm text-zinc-300">풀이시간 {formatSeconds(finalSolveTime ?? solveElapsed)}</p>
                                                            <button
                                                                onClick={reset}
                                                                className="rounded-xl bg-violet-500 px-5 py-2 font-medium text-white transition hover:bg-violet-400"
                                                            >
                                                                다시 시도
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}

                                            {!started && (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-center px-6 z-20">
                                                    <div className="text-6xl mb-4">🐱</div>

                                                    <p className="text-lg font-medium mb-2">
                                                        영상 CAPTCHA
                                                    </p>

                                                    <p className="text-sm text-zinc-400 mb-4">
                                                        나오는 문장에 맞춰 특정 순간에 화면을 클릭하세요.
                                                    </p>

                                                    <button
                                                        onClick={startCaptcha}
                                                        className="rounded-xl bg-violet-500 px-6 py-2 font-semibold text-white shadow-lg shadow-violet-950/50 transition hover:bg-violet-400"
                                                    >
                                                        시작
                                                    </button>
                                                </div>
                                            )}

                                        </div>

                                    </div>
                                </div>
                        )}
                    </div>

                    {/* Login Card */}
                    <div className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-950/70 via-zinc-900 to-zinc-950 p-8 shadow-2xl shadow-violet-950/20 sm:p-10">
                        {sessionUser ? (
                            <div className="flex min-h-64 flex-col items-center justify-center text-center">
                                <p className="mb-3 text-sm text-violet-200/70">로그인 완료</p>
                                <h3 className="text-3xl font-semibold text-white">
                                    {sessionUser.userid}님, 환영합니다!
                                </h3>
                                <p className="mt-4 text-zinc-400">Vision CAPTCHA 플랫폼을 이용할 수 있습니다.</p>
                            </div>
                        ) : isLoggingIn ? (
                            <div className="flex min-h-64 flex-col items-center justify-center text-center">
                                <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-violet-200/20 border-t-violet-300" />
                                <p className="text-lg font-medium text-white">로그인 중입니다...</p>
                            </div>
                        ) : (
                            <>
                            <p className="mb-2 text-sm text-violet-200/70">계정으로 로그인</p>
                            <h3 className="mb-7 text-2xl font-semibold text-white">로그인</h3>

                            <form onSubmit={login} className="space-y-4">
                                <label className="block">
                                    <span className="sr-only">아이디</span>
                                    <input
                                        type="text"
                                        value={loginUsername}
                                        onChange={(e) => setLoginUsername(e.target.value)}
                                        placeholder="아이디"
                                        className="w-full rounded-xl border border-violet-300/15 bg-black/30 px-4 py-3 text-white outline-none placeholder:text-zinc-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                                        required
                                    />
                                </label>
                                <label className="block">
                                    <span className="sr-only">비밀번호</span>
                                    <input
                                        type="password"
                                        value={loginPassword}
                                        onChange={(e) => setLoginPassword(e.target.value)}
                                        placeholder="비밀번호"
                                        className="w-full rounded-xl border border-violet-300/15 bg-black/30 px-4 py-3 text-white outline-none placeholder:text-zinc-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                                        required
                                    />
                                </label>
                                {loginError && <p className="text-sm text-red-400">{loginError}</p>}
                                <button
                                    type="submit"
                                    className="w-full rounded-xl bg-violet-500 px-5 py-3 font-semibold text-white shadow-lg shadow-violet-950/50 transition hover:bg-violet-400"
                                >
                                    로그인
                                </button>
                            </form>

                            <p className="mt-5 text-center text-sm text-zinc-400">
                                계정이 없으신가요? {" "}
                                <Link to="/signup" className="text-violet-200 underline underline-offset-4 hover:text-white">회원가입</Link>
                            </p>
                            </>
                        )}
                    </div>
                </div>
            </section>

            {/* Demo_ 추가 페이지 틀 */}

            {/*<section id="demo" className="border-t border-zinc-800">
                <div className="max-w-7xl mx-auto px-6 py-24">
                    <div className="text-center max-w-3xl mx-auto">
                        <h2 className="text-4xl font-bold mb-6">
                            실시간 인터랙션 챌린지
                        </h2>

                        <p className="text-zinc-400 leading-relaxed mb-10">
                            사용자는 영상 내 객체 이벤트에 맞춰 반응해야 합니다.
                        </p>

                        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10">
                            
                            <div className="aspect-video rounded-2xl bg-zinc-800 flex items-center justify-center mb-6">
                                
                                <div className="text-center">

                                    <div className="text-7xl mb-4">🦴</div>

                                    <p className="text-zinc-400 text-sm">
                                        이벤트 발생 대기 중...
                                    </p>
                                </div>
                            </div> 

                            <button className="px-8 py-4 rounded-2xl bg-white text-black font-semibold hover:opacity-90 transition">
                                이벤트 확인
                            </button>
                        </div>
                    </div>
                </div>
            </section>*/}
        </div>
    );
}
