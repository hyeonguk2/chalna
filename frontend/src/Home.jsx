import { Link, useNavigate } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import img1 from "/1.png";
import "./App.css";

export default function HomePage() {
    const API = import.meta.env.VITE_API_URL;

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

    //캡챠데이터용
    const [captchaId, setCaptchaId] = useState(null); //문제 고유id
    const [options, setOptions] = useState([]);  //문제 선택지
    const [guideText, setGuideText] = useState(""); //영상 위 문자
    const [startTime, setStartTime] = useState(null); // 시작시간 
    const [badtime, setBadTime] = useState(null); // 찍기 및 빠른 클릭 차단
    const [type, setType] = useState(null); // 영상 타입
    const [duration, setDuration] = useState(0);

    const [userId, setUserId] = useState("a");       // 💡 테스트용 임의 ID 저장 변수 추가

    //users table 에 login_attempts 컬럼을 임시로 추가했는데 이걸 fk로 따로 테이블 만들어서 연결할지 결정필요
    //fk로 별도로 만들면 captcha 시도횟수, 시도한 영상 제목이나 유형을 넣을 컬럼이 필요할것같아요.(같은 captcha시도 방지)

    const openVideoCaptcha = async () => {
        reset();
        setCaptchaopen(true);
    };

    //영상 캡차 불러오기
    const startCaptcha = async (userId) => {
        reset();
        if (!userId) return;

        const res = await fetch(`${API}/mvcaptcha`);
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
        setBadTime(data.badtime);
        setType(data.type);
        setStarted(true);
    };

    // 정답 전송
    const handleAnswer = (answer) => {
        if (!startTime) return;

        // 1. 버튼을 누른 순간 타이머가 돌지 못하도록 endedTime을 즉시 비웁니다. (중요!)
        setEndedTime(null);

        const timeDiffMs = Date.now() - startTime;
        const t = timeDiffMs / 1000;

        // 2. 만약 영상이 끝난 후에 누른 거였다면 (남아있던 remainTime 기반으로 체크)
        // 5초 타임아웃 처리는 타이머 useEffect가 아니라 여기서 직접 계산해 자릅니다.
        if (ended && remainTime <= 0) {
            setResult("fail");
            return;
        }

        const video = videoRef.current;
        if (video) {
            video.pause();
        }
        console.log(t);
        // 정답 전송
        submitCaptcha(t, answer);
    };

    //영상 캡차 검증
    const submitCaptcha = async (t, answer) => {
        const res = await fetch(`${API}/mvcaptcha/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                captchaId,
                answer,
                userId: userId,
                clickTime: t,
                type
            })
        });

        const data = await res.json();
        console.log(data.reason);
        setResult(data.reason || "fail");
    };

    // 비디오 모듈 제어 및 시작 시간 기록
    useEffect(() => {
        if (!started || !videoUrl || !videoRef.current) return;

        const url = `${API}${videoUrl}`;

        videoRef.current.src = url;
        videoRef.current.load();

        // 영상이 재생되는 순간의 타임스탬프를 기록
        videoRef.current.play().then(() => {
            setStartTime(Date.now());
        }).catch(err => console.log("자동 재생 차단 또는 오류:", err));

    }, [started, videoUrl]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let raf;

        const update = () => {
            if (video.duration) {
                setProgress((video.currentTime / video.duration) * 100);
            }
            raf = requestAnimationFrame(update);
        };

        raf = requestAnimationFrame(update);

        return () => cancelAnimationFrame(raf);
    }, [videoUrl]);

    // 5초 카운트다운 및 0초 도달 시 자동 실패 처리
    useEffect(() => {
        if (!endedTime) return;

        const timer = setInterval(() => {
            const totalDuration = 5000;
            const elapsed = Date.now() - endedTime;
            const remain = Math.max(0, totalDuration - elapsed);

            const remainSeconds = remain / 1000; // 밀리초를 초 단위로 변환

            if (remainSeconds <= 1.0) {
                // 1초 이하일 때는 소수점 첫째 자리까지 표현 (예: 0.9, 0.8 ... 0.0)
                setRemainTime(remainSeconds.toFixed(1));
            } else {
                // 1초 초과일 때는 올림(Math.ceil) 처리하여 정수로 표현 (예: 5, 4, 3, 2)
                setRemainTime(Math.ceil(remainSeconds));
            }
            // 0초에 도달했을 때
            if (remain <= 0 || remain < badtime) {
                clearInterval(timer);
                setEndedTime(null); // 0초가 되어 종료될 때도 확실하게 비워줌

                const video = videoRef.current;
                let currentVideoTime = 0;
                if (video && video.readyState >= 2) {
                    currentVideoTime = video.currentTime;
                    video.pause();
                }
                submitCaptcha(currentVideoTime, "");
            }
        }, 50);

        return () => clearInterval(timer);
    }, [endedTime]);

    //영상 초기화
    const reset = () => {
        const video = videoRef.current;
        if (!video) return;

        if (video) {
            video.pause();
            video.removeAttribute("src");
            video.load();
            video.currentTime = 0;
        }
        setRemainTime(0);
        setStarted(false);
        setResult(null);
        setVideoUrl(null);
        setOptions([]);
        setGuideText("");
        setStartTime(null);
        setProgress(0);
        setBadTime(Infinity);
        setEndedTime(null);
        setRemainTime(0);
        setEnded(false);
        setResult(null);

    };
    return (

        <div className="min-h-screen w-full bg-zinc-950 text-white">
            {/* Header */}
            <header className="border-b border-zinc-800 backdrop-blur">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <h1 className="text-white text-2xl font-bold tracking-tight">
                        Vision CAPTCHA
                    </h1>
                    <nav className="flex gap-6 text-sm text-zinc-300">
                        <Link to="/login" className="hover:text-white transition">
                            로그인
                        </Link>
                        <a href="#about" className="hover:text-white transition">
                            소개
                        </a>
                        <a href="#features" className="hover:text-white transition">
                            기능
                        </a>
                        <a href="#demo" className="hover:text-white transition">
                            데모
                        </a>
                    </nav>
                </div>
            </header>

            {/* Hero */}
            <section
                id="about"
                className="max-w-7xl mx-auto px-6 pt-24 pb-20"
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

                        <div className="flex gap-4">
                            <button
                                onClick={openVideoCaptcha}
                                className="px-6 py-3 rounded-2xl bg-white text-black font-medium"
                            >
                                데모 시작
                            </button>
                            {captchaopen && (
                                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                                    <div className="bg-zinc-900 p-6 rounded-2xl w-[800px] max-w-[95vw]">
                                        <div className="aspect-video relative overflow-hidden rounded-xl">
                                            {/* 영상 */}
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
                                            />
                                            {started && result === null && (
                                                <>
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
                                                                            const left = ((time - 0.2) / duration) * 100;

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
                                                                    <div className="absolute inset-0 flex z-20">
                                                                        {[...Array(4)].map((_, i) => (
                                                                            <div key={`slot-${i}`} className="flex-1 border-r border-zinc-300/70" />
                                                                        ))}
                                                                    </div>

                                                                    {/* 진행바 */}
                                                                    <div
                                                                        className="h-full bg-white relative z-30"
                                                                        style={{ width: `${progress}%` }}
                                                                    />
                                                                </div>
                                                            )}

                                                            {/* 버튼 영역 */}
                                                            <div className="grid grid-cols-4 gap-5">

                                                                {/* A 타입 → 1~4 */}
                                                                {type === "A" &&
                                                                    [1, 2, 3, 4].map((num) => (
                                                                        <button
                                                                            key={`a-${num}`}
                                                                            onClick={() => handleAnswer(num - 1)}
                                                                            className="bg-zinc-800/70 backdrop-blur-sm p-2 rounded text-xl"
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
                                                                            className="bg-zinc-800/70 backdrop-blur-sm p-2 rounded text-xl"
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

                                            {/* 성공 시 다시시도 있음 */}
                                            {result && (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-20">
                                                    <div
                                                        className={`text-2xl font-bold mb-4 ${result === "success"
                                                            ? "text-green-400"
                                                            : result === "too_fast"
                                                                ? "text-yellow-400"
                                                                : "text-red-400"
                                                            }`}
                                                    >
                                                        {result === "success"
                                                            ? "성공🎉"
                                                            : result === "too_fast"
                                                                ? "너무 빠름"
                                                                : "실패"}
                                                    </div>

                                                    <button
                                                        onClick={reset}
                                                        className="px-5 py-2 bg-white text-black rounded-xl"
                                                    >
                                                        다시 시도
                                                    </button>
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
                                                        className="px-6 py-2 bg-white text-black rounded-xl"
                                                    >
                                                        시작
                                                    </button>
                                                </div>
                                            )}

                                        </div>

                                        <div className="flex justify-end mt-4">
                                            <button
                                                onClick={() => {
                                                    reset();
                                                    setCaptchaopen(false);
                                                }}
                                                className="px-4 py-2 bg-white text-black rounded"
                                            >
                                                닫기
                                            </button>
                                        </div>

                                    </div>
                                </div>
                            )}
                            <button className="px-6 py-3 rounded-2xl border border-zinc-700 hover:border-zinc-500 transition">
                                자세히 보기
                            </button>
                        </div>
                    </div>

                    {/* Preview Card */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl">

                        <div className="aspect-video rounded-2xl bg-zinc-800 flex items-center justify-center overflow-hidden relative">

                            <div className="absolute inset-0 bg-gradient-to-br from-zinc-700/20 to-zinc-900" />

                            {/* 초기 화면 */}

                            <div className="w-full h-full flex justify-center relative">

                                {/* 영상 */}
                                <video
                                    ref={videoRef}
                                    muted
                                    playsInline
                                    className="w-full h-full object-cover"
                                />

                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-center px-6 z-20">
                                    <div className="text-6xl mb-4">🐶</div>

                                    <p className="text-lg font-medium mb-2">
                                        영상 CAPTCHA
                                    </p>

                                    <p className="text-sm text-zinc-400 mb-4">
                                        시연연상 넣을곳
                                    </p>
                                </div>

                            </div>
                        </div>

                        <div className="mt-6 flex items-center justify-between text-sm text-zinc-400">

                            <span>세션 기반 동적 챌린지</span>


                            <span>위험 점수: 낮음</span>

                        </div>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section
                id="features"
                className="max-w-7xl mx-auto px-6 pb-24"
            >
                <div className="grid md:grid-cols-3 gap-6">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                        <h3 className="text-xl font-semibold mb-4">동적 DOM</h3>

                        <p className="text-zinc-400 leading-relaxed text-sm">
                            세션마다 UI 구조를 변경하여 자동화 패턴을 방해합니다.
                        </p>
                    </div>

                    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                        <h3 className="text-xl font-semibold mb-4">
                            Vision 기반 챌린지
                        </h3>

                        <p className="text-zinc-400 leading-relaxed text-sm">
                            객체 인식과 시간 기반 반응을 요구하는 영상 CAPTCHA
                            시스템입니다.
                        </p>
                    </div>

                    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                        <h3 className="text-xl font-semibold mb-4">
                            행동 패턴 분석
                        </h3>

                        <p className="text-zinc-400 leading-relaxed text-sm">
                            사용자의 상호작용 패턴과 자동화 행동을 실시간으로
                            분석합니다.
                        </p>
                    </div>
                </div>
            </section>

            {/* Demo_ 추가 페이지 틀 */}

            <section id="demo" className="border-t border-zinc-800">
                <div className="max-w-7xl mx-auto px-6 py-24">
                    <div className="text-center max-w-3xl mx-auto">
                        <h2 className="text-4xl font-bold mb-6">
                            실시간 인터랙션 챌린지
                        </h2>

                        <p className="text-zinc-400 leading-relaxed mb-10">
                            사용자는 영상 내 객체 이벤트에 맞춰 반응해야 합니다.
                        </p>

                        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10">
                            <div className="aspect-video rounded-2xl bg-zinc-800 flex items-center justify-center mb-6 relative overflow-hidden">

                                <img
                                    src="/1.png"
                                    className="absolute animate-move"
                                    alt="event"
                                />

                    

                            </div>
                            {/* <div className="aspect-video rounded-2xl bg-zinc-800 flex items-center justify-center mb-6">
                                
                                <div className="text-center">

                                    <div className="text-7xl mb-4">🦴</div>

                                    <p className="text-zinc-400 text-sm">
                                        이벤트 발생 대기 중...
                                    </p>
                                </div>
                            </div> */}

                            <button className="px-8 py-4 rounded-2xl bg-white text-black font-semibold hover:opacity-90 transition">
                                이벤트 확인
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
