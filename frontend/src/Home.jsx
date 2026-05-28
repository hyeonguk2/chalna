import { Link, useNavigate } from "react-router-dom";
import { useRef, useState } from "react";

export default function HomePage() {
    const videoRef = useRef(null);
    const startTimeRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [result, setResult] = useState(null);
    const [started, setStarted] = useState(false);

    const [startTime, setStartTime] = useState(null);
    const [reactionTime, setReactionTime] = useState(null);

    const handleStart = () => {
        const video = videoRef.current;
        if (!video) return;

        if (!started) {
            setStarted(true);
            setResult(null);
            setReactionTime(null);

            video.currentTime = 0;
            video.play();
            setStartTime(Date.now());
        } else {
            handleClick();
        }
    };
    

    const handleClick = () => {
        const video = videoRef.current;
        if (!video || !startTime) return;

        video.pause();

        const endTime = Date.now();
        const diff = endTime - startTime; // ms

        setReactionTime(diff);

        judgeResult(diff);
    };

    const reset = () => {
        const video = videoRef.current;
        if (!video) return;

        video.pause();
        video.currentTime = 0;

        setStarted(false);
        setResult(null);
    };

    const judgeResult = (time) => {
        if (time > 3000 && time <= 5000) {
            setResult("success");
        } else {
            setResult("fail");
        }
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
                            <button className="px-6 py-3 rounded-2xl bg-white text-black font-medium hover:opacity-90 transition">
                                데모 시작
                            </button>

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

                                <video
                                    ref={videoRef}
                                    src="/video/dog1.mp4"
                                    muted
                                    className="h-full object-cover"
                                />
                                {/* 결과 오버레이 ↓ 여기 넣는게 정답 */}
                                {result === "success" && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-green-400 text-2xl font-bold z-20">
                                        성공
                                    </div>
                                )}

                                {result === "fail" && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-20">
                                        <div className="text-red-400 text-2xl font-bold mb-4">
                                            실패
                                        </div>

                                        <button
                                            onClick={reset}
                                            className="px-5 py-2 bg-white text-black rounded-xl"
                                        >
                                            다시 시도
                                        </button>
                                    </div>
                                )}

                                {/* 필요하면 클릭/멈춤 UI도 여기에 */}
                                {!started && (
                                    <div className="absolute bg-gradient-to-br from-zinc-700/20 to-zinc-800 inset-0 flex flex-col items-center justify-center bg-zinc-900 text-center px-6">
                                        <div className="text-6xl mb-4">🐶</div>

                                        <p className="text-lg font-medium mb-2">
                                            영상 CAPTCHA 미리보기
                                        </p>

                                        <p className="text-sm text-zinc-400 mb-4">
                                            개가 뼈다귀를 물어가는 순간 클릭하세요.
                                        </p>
                                    </div>
                                )}


                            </div>
                        </div>

                        <div className="mt-6 flex items-center justify-between text-sm text-zinc-400">

                            <span>세션 기반 동적 챌린지</span>

                            <button
                                onClick={handleStart}
                                className="px-6 py-2 rounded-xl bg-white text-black font-medium"
                            >
                                {started ? "클릭" : "시작"}
                            </button>

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
            {/*
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
