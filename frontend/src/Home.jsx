import { Link } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import "./App.css";

export default function HomePage() {
    const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
    const ANSWER_TIME_LIMIT_MS = 5000;
    const MAX_TRAJECTORY_POINTS = 800;
    const MAX_CLICK_EVENTS = 120;
    const IMAGE_DISPLAY_SECONDS = {
        C: 5,
        D: 3
    };

    const videoRef = useRef(null);
    const [videoUrl, setVideoUrl] = useState(null);
    const [captchaopen, setCaptchaopen] = useState(false);
    const [started, setStarted] = useState(false);
    const [ended, setEnded] = useState(false);
    const [result, setResult] = useState(null);
    const [endedTime, setEndedTime] = useState(null);
    const [remainTime, setRemainTime] = useState(0);
    const [progress, setProgress] = useState(0);
    const imgIntervalRef = useRef(null);
    const loginTransitionRef = useRef(null);
    const behaviorMetricsRef = useRef({
        mouseTrajectory: [],
        clickData: []
    });

    const [captchaId, setCaptchaId] = useState(null);
    const [options, setOptions] = useState([]);
    const [guideText, setGuideText] = useState("");
    const [startTime, setStartTime] = useState(null);
    const [type, setType] = useState(null);
    const [duration, setDuration] = useState(0);
    const [currentLevel, setCurrentLevel] = useState(1);
    const [solveElapsed, setSolveElapsed] = useState(0);
    const [finalSolveTime, setFinalSolveTime] = useState(null);

    const [isCaptchaPassed, setIsCaptchaPassed] = useState(false);
    const [captchaToken, setCaptchaToken] = useState("");
    const [challengeToken, setChallengeToken] = useState("");

    const [sessionUser, setSessionUser] = useState(null);
    const [loginUsername, setLoginUsername] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [mouseTrajectory, setMouseTrajectory] = useState([]);
    const [clickData, setClickData] = useState([]);
    const [loginError, setLoginError] = useState("");
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const formatSeconds = (value) => `${Number(value || 0).toFixed(1)}초`;
    const resetBehaviorMetrics = () => {
        behaviorMetricsRef.current = {
            mouseTrajectory: [],
            clickData: []
        };
        setMouseTrajectory([]);
        setClickData([]);
    };

    useEffect(() => {
        const loadSession = async () => {
            try {
                const res = await fetch(`${API}/api/me`, {
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
                setMouseTrajectory((prev) => {
                    const next = [
                        ...prev.slice(-(MAX_TRAJECTORY_POINTS - 1)),
                        {
                            x: event.clientX,
                            y: event.clientY,
                            t: now
                        }
                    ];
                    behaviorMetricsRef.current.mouseTrajectory = next;
                    return next;
                });
                lastLoggedTime = now;
            }
        };
        const handleMouseDown = (event) => {
            setClickData((prev) => {
                const next = [
                    ...prev.slice(-(MAX_CLICK_EVENTS - 1)),
                    {
                        type: "down",
                        x: event.clientX,
                        y: event.clientY,
                        t: Date.now()
                    }
                ];
                behaviorMetricsRef.current.clickData = next;
                return next;
            });
        };
        const handleMouseUp = (event) => {
            setClickData((prev) => {
                const next = [
                    ...prev.slice(-(MAX_CLICK_EVENTS - 1)),
                    {
                        type: "up",
                        x: event.clientX,
                        y: event.clientY,
                        t: Date.now()
                    }
                ];
                behaviorMetricsRef.current.clickData = next;
                return next;
            });
        };
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mousedown", handleMouseDown);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mousedown", handleMouseDown);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    const performLogin = async (tokenOverride = captchaToken) => {
        setIsLoggingIn(true);
        const latestBehaviorMetrics = behaviorMetricsRef.current;
        const loginData = {
            username: loginUsername,
            password: loginPassword,
            behaviorMetrics: {
                mouseTrajectory: latestBehaviorMetrics.mouseTrajectory,
                clickData: latestBehaviorMetrics.clickData
            },
            captchaToken: tokenOverride
        };

        try {
            const response = await fetch(`${API}/api/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
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
                alert(result.message || "로그인에 실패했습니다. 잠시 후 다시 시도하세요.");
                return;
            }

            const sessionResponse = await fetch(`${API}/api/me`, { credentials: "include" });
            const sessionData = await sessionResponse.json();

            if (!sessionResponse.ok || !sessionData.authenticated || !sessionData.user) {
                setLoginError("Session verification failed");
                setIsLoggingIn(false);
                return;
            }

            setSessionUser(sessionData.user);
            setLoginUsername("");
            setLoginPassword("");
            resetBehaviorMetrics();
            setCaptchaToken("");
        } catch (error) {
            console.error("login failed:", error);
            setLoginError("서버 연결 실패");
            setIsLoggingIn(false);
        }
    };

    const precheckCredentials = async () => {
        try {
            const response = await fetch(`${API}/api/login-precheck`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "include",
                body: JSON.stringify({
                    username: loginUsername,
                    password: loginPassword
                })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.valid) {
                const message = data.message || "Invalid username or password.";
                setLoginError(message);
                alert(message);
                return false;
            }

            return true;
        } catch (error) {
            console.error("login precheck failed:", error);
            setLoginError("Unable to verify credentials.");
            alert("Unable to verify credentials.");
            return false;
        }
    };

    const login = async (event) => {
        event.preventDefault();
        setLoginError("");

        if (!isCaptchaPassed) {
            resetBehaviorMetrics();
            reset();
            const credentialsValid = await precheckCredentials();
            if (!credentialsValid) return;
            setCaptchaopen(true);
            return;
        }

        performLogin();
    };

    const logout = async () => {
        try {
            await fetch(`${API}/api/logout`, {
                method: "POST",
                credentials: "include"
            });
        } finally {
            reset();
            setSessionUser(null);
            setIsCaptchaPassed(false);
            setCaptchaToken("");
            setLoginError("");
            setIsLoggingIn(false);
            resetBehaviorMetrics();
        }
    };

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

        if (!res.ok) {
            if (data.error === "locked") {
                alert(`${data.remainingSec}초 후 다시 시도하세요.`);
            } else {
                alert(data.message || "캡차를 시작할 수 없습니다.");
            }
            return;
        }

        const videoRes = await fetch(`${API}/mvcaptcha/video`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                captchaId: data.captchaId
            })
        });
        const videoData = await videoRes.json();
        setEnded(false);
        setVideoUrl(videoData.video);
        setGuideText(data.question);
        setCaptchaId(data.captchaId);
        setChallengeToken(data.challengeToken || "");
        setOptions(data.options);
        setType(data.type);
        setCurrentLevel(data.currentLevel || 1);
        if (data.type === "C" || data.type === "D") {
            setDuration(IMAGE_DISPLAY_SECONDS[data.type]);
        }
        setCaptchaopen(true);
        setStarted(true);
    };

    const handleAnswer = (answer) => {
        if (!startTime) return;

        const timeDiffMs = new Date().getTime() - startTime;
        const t = timeDiffMs / 1000;
        setFinalSolveTime(t);

        setEndedTime(null);
        setEnded(false);
        setRemainTime(0);

        if (imgIntervalRef.current) {
            clearInterval(imgIntervalRef.current);
            imgIntervalRef.current = "";
        }

        imgIntervalRef.current = null;

        const video = videoRef.current;
        if (video) {
            video.pause();
        }
        submitCaptcha(t, answer);
    };

    const submitCaptcha = async (t, answer) => {

        if (imgIntervalRef.current) {
            clearInterval(imgIntervalRef.current);
            imgIntervalRef.current = null;

            const virtualDuration = IMAGE_DISPLAY_SECONDS[type];
            const currentTimeSec = t;
            setProgress(Math.min((currentTimeSec / virtualDuration) * 100, 100));
            setRemainTime(Math.min(currentTimeSec, virtualDuration));
        }

        if (type !== "C" && type !== "D" && videoRef.current) {
            videoRef.current.pause();
        }

        try {
            const res = await fetch(`${API}/mvcaptcha/verify`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    answer,
                    clickTime: t,
                    type,
                    captchaId,
                    challengeToken
                })
            });

            const data = await res.json();

            if (data.goToLevel2 || data.reason === "d_stage_unlocked") {
                setIsCaptchaPassed(false);
                setCaptchaToken("");
                setChallengeToken("");
                setResult("d_stage");
                loginTransitionRef.current = setTimeout(() => {
                    startCaptcha(data.nextType || "D");
                }, 900);
                return;
            }

            if (data.reason === "success") {
                setIsCaptchaPassed(true);
                setCaptchaToken(data.captchaToken || "");
                setChallengeToken("");
                setResult("human");
                loginTransitionRef.current = setTimeout(() => {
                    setCaptchaopen(false);
                    setResult(null);
                    performLogin(data.captchaToken || "");
                }, 1000);
                return;
            }

            setIsCaptchaPassed(false);
            setCaptchaToken("");
            setChallengeToken("");
            setResult(data.reason || "fail");
        } catch (error) {
            console.error("검증 중 오류 발생:", error);
            setResult("fail");
        }
    };

    const abortCaptcha = async () => {
        if (!captchaId || !challengeToken) {
            reset();
            setCaptchaopen(false);
            return;
        }

        try {
            await fetch(`${API}/mvcaptcha/verify`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    captchaId,
                    challengeToken,
                    aborted: true
                })
            });
        } catch (error) {
            console.error("captcha abort failed:", error);
        } finally {
            reset();
            setCaptchaopen(false);
        }
    };

    const handleCaptchaClose = async () => {
        if (!started || result !== null || isCaptchaPassed) {
            reset();
            setCaptchaopen(false);
            return;
        }

        const confirmed = window.confirm("캡차를 닫으면 실패로 처리됩니다. 진행하시겠습니까?");
        if (!confirmed) return;
        await abortCaptcha();
    };

    useEffect(() => {
        if (!started || !videoUrl) return;

        if (type !== "C" && type !== "D" && videoRef.current) {
            const url = `${API}${videoUrl}`;
            videoRef.current.src = url;
            videoRef.current.load();

            videoRef.current.play().then(() => {
                setStartTime(Date.now());
                setSolveElapsed(0);
                setFinalSolveTime(null);
            }).catch(() => {});
        }

        else if (type === "C" || type === "D") {
            const virtualDuration = IMAGE_DISPLAY_SECONDS[type];
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

                    setProgress((currentTimeSec / virtualDuration) * 100);

                    if (currentTimeSec >= virtualDuration) {
                        clearInterval(intervalImg);
                        setEnded(true);
                        setEndedTime(new Date().getTime());
                        setRemainTime(5);
                    }
                    return prevStartTime;
                });
            }, 30);

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

    useEffect(() => {

        if (!endedTime || result !== null) return;

        const timer = setInterval(() => {
            const totalDuration = ANSWER_TIME_LIMIT_MS;
            const elapsed = new Date().getTime() - endedTime;
            const remain = Math.max(0, totalDuration - elapsed);

            const remainSeconds = remain / 1000;

            if (remainSeconds <= 1.0) {
                setRemainTime(remainSeconds.toFixed(1));
            } else {
                setRemainTime(Math.ceil(remainSeconds));
            }

            if (remain <= 0) {
                clearInterval(timer);
                setEndedTime(null);

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
                submitCaptcha(currentVerifyTime, "");
            }
        }, 50);

        return () => clearInterval(timer);
    }, [endedTime, type, duration, result, startTime]);

    const reset = () => {
        if (loginTransitionRef.current) {
            clearTimeout(loginTransitionRef.current);
            loginTransitionRef.current = null;
        }

        if (imgIntervalRef.current) {
            clearInterval(imgIntervalRef.current);
        }

        imgIntervalRef.current = null;

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
        setCaptchaId(null);
        setOptions([]);
        setGuideText("");
        setStartTime(null);
        setType(null);
        setDuration(0);
        setProgress(0);
        setEndedTime(null);
        setRemainTime(0);
        setEnded(false);
        setResult(null);
        setCurrentLevel(1);
        setSolveElapsed(0);
        setFinalSolveTime(null);
        setCaptchaToken("");
        setChallengeToken("");

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
                            <>
                                <Link
                                    to="/dashboard"
                                    className="px-4 py-2 rounded border border-violet-300/20 bg-violet-500/10 text-violet-100 transition hover:bg-violet-500/20"
                                >
                                    대시보드
                                </Link>
                                <button
                                    type="button"
                                    onClick={logout}
                                    className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white transition"
                                >
                                    로그아웃
                                </button>
                            </>
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
                                                onClick={handleCaptchaClose}
                                                className="rounded-xl border border-violet-300/15 bg-black/20 px-4 py-2 text-sm text-violet-100 transition hover:bg-violet-400/15"
                                            >
                                                닫기
                                            </button>
                                        </div>

                                        <div className="aspect-video relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
                                            {type === "C" || type === "D" ? (
                                                <div className="w-full h-full bg-zinc-900 relative flex items-center justify-center">
                                                    {started && (type !== "D" || !ended) && (
                                                        <img
                                                            src={`${API}${videoUrl}`}
                                                            alt="captcha"

                                                            className={`w-full h-full object-cover transition-all duration-300 ${ended ? type === "D" ? "opacity-0" : "opacity-40 filter blur-sm" : type === "C" ? "animate-move" : ""
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
                                                        
                                                        <div className="w-[80%] mx-auto">

                                                            
                                                            {type === "A" && (
                                                                <div className="relative w-full h-2 bg-zinc-700 rounded overflow-visible mb-6">

                                                                    
                                                                    {duration > 0 &&
                                                                        options.map((time, idx) => {
                                                                            const left = (time / duration) * 100;

                                                                            return (
                                                                                <div key={`options-${time}-${idx}`}>

                                                                                    
                                                                                    <div
                                                                                        className="absolute top-0 h-2 bg-green-500/50 z-10"
                                                                                        style={{
                                                                                            left: `${left}%`,
                                                                                            width: `${(0.7 / duration) * 100}%`,
                                                                                        }}
                                                                                    />

                                                                                    
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

                                                                    
                                                                    {/* <div className="absolute inset-0 flex z-20">
                                                                        {[...Array(4)].map((_, i) => (
                                                                            <div key={`slot-${i}`} className="flex-1 border-r border-zinc-300/70" />
                                                                        ))}
                                                                    </div> */}

                                                                    
                                                                    <div
                                                                        className="h-full bg-white relative z-30"
                                                                        style={{ width: `${progress}%` }}
                                                                    />
                                                                </div>
                                                            )}

                                                            
                                                            <div className={`grid gap-5 ${type === "D" ? "grid-cols-3" : "grid-cols-4"}`}>

                                                                
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

                                                                
                                                                {type !== "A" && (type !== "D" || ended) &&
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

            

            
        </div>
    );
}
