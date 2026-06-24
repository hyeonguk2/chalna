import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const emptyDashboard = {
  summary: {
    totalAttempts: 0,
    captchaPassRate: 0,
    mouseAnomalies: 0,
    blocked: 0,
  },
  captchaTypes: ["A", "B", "C", "D"].map((type) => ({ type, pass: 0, fail: 0 })),
  captchaLevels: [
    { level: 1, label: "Level 1", types: ["A", "B", "C"], pass: 0, fail: 0 },
    { level: 2, label: "Level 2", types: ["D"], pass: 0, fail: 0 },
  ],
  riskTrend: Array(12).fill(0),
  recentRows: [],
  latestMetrics: {
    trajectoryPoints: 0,
    linearMse: null,
    clickHoldStd: null,
    botScore: 0,
    analysisDetails: [],
  },
};

function formatNumber(value, suffix = "") {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${Math.round(number * 10) / 10}${suffix}`;
}

function clampPercent(value) {
  const number = Number(value) || 0;
  return Math.min(Math.max(number, 0), 100);
}

function getMetricStatus(value, threshold, mode = "under") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return { label: "데이터 없음", color: "bg-zinc-500", text: "text-zinc-400", percent: 0 };
  }

  const number = Number(value);
  const risky = mode === "under" ? number < threshold : number >= threshold;
  return {
    label: risky ? "위험" : "정상",
    color: risky ? "bg-amber-400" : "bg-emerald-400",
    text: risky ? "text-amber-200" : "text-emerald-200",
    percent: mode === "under"
      ? clampPercent((1 - Math.min(number / threshold, 1)) * 100)
      : clampPercent((number / threshold) * 100),
  };
}

function StatusBadge({ status }) {
  const classes = {
    정상: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    이상: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    차단: "border-red-400/20 bg-red-400/10 text-red-200",
    재시도: "border-sky-400/20 bg-sky-400/10 text-sky-200",
  };

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs ${classes[status] || classes.이상}`}>
      {status}
    </span>
  );
}

function Tooltip({ text }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="설명 보기"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-zinc-400 transition hover:border-violet-300/30 hover:text-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
      >
        ?
      </button>
      <span className="pointer-events-none absolute left-1/2 top-7 z-30 hidden w-64 -translate-x-1/2 rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-left text-xs leading-relaxed text-zinc-300 shadow-2xl shadow-black/40 group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [weekRows, setWeekRows] = useState([]);
  const [recentModalOpen, setRecentModalOpen] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard/security", { credentials: "include" });
      if (!res.ok) throw new Error("dashboard request failed");
      const data = await res.json();
      setDashboard({
        ...emptyDashboard,
        ...data,
        summary: { ...emptyDashboard.summary, ...(data.summary || {}) },
        captchaTypes: data.captchaTypes || emptyDashboard.captchaTypes,
        captchaLevels: data.captchaLevels || emptyDashboard.captchaLevels,
        latestMetrics: { ...emptyDashboard.latestMetrics, ...(data.latestMetrics || {}) },
      });
      setError("");
      setLastUpdatedAt(Date.now());
    } catch (err) {
      console.error(err);
      setError("대시보드 API에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const showWeekRows = async () => {
    try {
      setRecentLoading(true);
      const res = await fetch("/api/dashboard/security/recent?days=7&limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("recent request failed");
      const data = await res.json();
      setWeekRows(data.recentRows || []);
      setRecentModalOpen(true);
    } catch (err) {
      console.error(err);
      setError("최근 일주일 데이터를 불러올 수 없습니다.");
    } finally {
      setRecentLoading(false);
    }
  };

  const closeRecentModal = () => {
    setRecentModalOpen(false);
  };

  const summaryCards = useMemo(() => ([
    { label: "오늘 보안 이벤트", value: dashboard.summary.totalAttempts, suffix: "건", tone: "text-zinc-300", help: "최근 24시간 동안 저장된 CAPTCHA 판정과 로그인 판정 이벤트 수입니다." },
    { label: "CAPTCHA 통과율", value: dashboard.summary.captchaPassRate, suffix: "%", tone: "text-emerald-300", help: "CAPTCHA 이벤트 중 성공으로 기록된 비율입니다. Level 1과 Level 2 이벤트를 함께 계산합니다." },
    { label: "마우스 이상 탐지", value: dashboard.summary.mouseAnomalies, suffix: "건", tone: "text-amber-300", help: "로그인 이벤트 중 봇 점수가 60점 이상으로 계산된 건수입니다." },
    { label: "차단/락아웃", value: dashboard.summary.blocked, suffix: "건", tone: "text-red-300", help: "봇으로 판정되었거나 차단 상태로 기록된 이벤트 수입니다." },
  ]), [dashboard.summary]);

  const trendBars = (dashboard.riskTrend?.length ? dashboard.riskTrend : emptyDashboard.riskTrend)
    .map((value) => clampPercent(value));
  const botScore = Number(dashboard.latestMetrics.botScore) || 0;
  const botStatus = getMetricStatus(botScore, 60, "over");
  const pointCount = Number(dashboard.latestMetrics.trajectoryPoints) || 0;
  const linearMse = dashboard.latestMetrics.linearMse;
  const clickHoldStd = dashboard.latestMetrics.clickHoldStd;
  const hasLinearMse = linearMse !== null && linearMse !== undefined && Number.isFinite(Number(linearMse));
  const hasClickStd = clickHoldStd !== null && clickHoldStd !== undefined && Number.isFinite(Number(clickHoldStd));
  const trajectoryRisk = pointCount < 10;
  const straightRisk = !trajectoryRisk && hasLinearMse && Number(linearMse) < 1.2;
  const clickRisk = hasClickStd && Number(clickHoldStd) < 5;
  const fallbackMouseReasons = [
    {
      label: "움직임 데이터",
      value: formatNumber(pointCount, "개"),
      result: trajectoryRisk ? "부족" : "충분",
      score: trajectoryRisk ? 20 : 0,
      detail: "좌표가 10개 미만이면 분석 신뢰도가 낮아 위험 점수를 일부 더합니다.",
    },
    {
      label: "이동 경로",
      value: hasLinearMse ? formatNumber(linearMse, "%") : "-",
      result: trajectoryRisk ? "검사 생략" : straightRisk ? "너무 직선적" : "자연스러움",
      score: straightRisk ? 35 : 0,
      detail: "정규화된 선형성 지표와 직선도가 동시에 위험 기준을 넘으면 자동 생성 경로로 의심합니다.",
    },
    {
      label: "클릭 패턴",
      value: hasClickStd ? formatNumber(clickHoldStd, "ms") : "클릭쌍 없음",
      result: hasClickStd ? clickRisk ? "반복 의심" : "정상 편차" : "기본 가산",
      score: hasClickStd ? clickRisk ? 25 : 0 : 10,
      detail: "클릭쌍이 없으면 10점, 여러 클릭 유지시간이 거의 같으면 25점을 더합니다.",
    },
  ];
  const mouseReasons = dashboard.latestMetrics.analysisDetails?.length
    ? dashboard.latestMetrics.analysisDetails
    : fallbackMouseReasons;
  const positiveReasons = mouseReasons.filter((item) => Number(item.score) > 0);
  const speedRows = [
    { label: "궤적 포인트", value: formatNumber(dashboard.latestMetrics.trajectoryPoints, "개"), detail: "최근 로그인 시도에서 수집한 마우스 좌표 수입니다. 10개 미만이면 분석 신뢰도가 낮아 일부 점수가 더해집니다." },
    { label: "선형성 지표", value: formatNumber(dashboard.latestMetrics.linearMse, "%"), detail: "시작점과 끝점을 잇는 기준선에서 얼마나 벗어나는지 정규화한 값입니다. 낮을수록 더 직선적인 움직임입니다." },
    { label: "클릭 유지 편차", value: formatNumber(dashboard.latestMetrics.clickHoldStd, "ms"), detail: "여러 클릭의 down/up 유지 시간이 얼마나 다른지입니다. 5ms 미만이면 반복 클릭 가능성을 의심합니다." },
    { label: "최종 봇 점수", value: formatNumber(dashboard.latestMetrics.botScore, "점"), detail: "마우스 분석 항목별 점수를 합산한 값입니다. 60점 이상이면 이상 탐지로 처리됩니다." },
  ];
  const displayedRecentRows = dashboard.recentRows;

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-violet-200/60">
              Vision CAPTCHA
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">
              보안 분석 대시보드
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">
              {loading ? "불러오는 중" : error || (lastUpdatedAt ? `마지막 업데이트 ${new Date(lastUpdatedAt).toLocaleTimeString("ko-KR", { hour12: false })}` : "수동 업데이트")}
            </span>
            <button
              type="button"
              onClick={loadDashboard}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-300/15 bg-black/20 px-4 py-2 text-sm text-violet-100 transition hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-3.2-6.9" />
                <path d="M21 3v6h-6" />
              </svg>
              업데이트
            </button>
            <Link
              to="/"
              className="rounded-xl border border-violet-300/15 bg-black/20 px-4 py-2 text-sm text-violet-100 transition hover:bg-violet-400/15"
            >
              홈으로
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5 shadow-xl shadow-black/10"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm text-zinc-400">{item.label}</p>
                <Tooltip text={item.help} />
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <p className="text-3xl font-semibold text-white">{formatNumber(item.value, item.suffix)}</p>
                <p className={`text-sm font-medium ${item.tone}`}>실시간</p>
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">이상 탐지 위험 추이</h2>
                  <Tooltip text="최근 로그인 이벤트의 봇 점수 변화입니다. 0점에 가까우면 정상, 60점 이상이면 이상 탐지 대상입니다." />
                </div>
                <p className="mt-1 text-sm text-zinc-400">왼쪽은 오래된 시도, 오른쪽은 최신 시도</p>
              </div>
              <span className="rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1 text-sm text-red-200">
                임계값 60점
              </span>
            </div>
            <div className="h-64 rounded-xl border border-white/5 bg-zinc-950/60 p-4">
              <div className="flex h-full gap-3">
                <div className="flex flex-col justify-between py-1 text-right text-xs text-zinc-500">
                  <span>100</span>
                  <span className="text-red-300">60</span>
                  <span>0</span>
                </div>
                <div className="relative min-w-0 flex-1 pb-6">
                  <div className="absolute left-0 right-0 top-0 border-t border-white/10" />
                  <div className="absolute left-0 right-0 top-[40%] border-t border-dashed border-red-300/60" />
                  <div className="absolute left-0 right-0 bottom-6 border-t border-white/10" />
                  <div className="grid h-full grid-cols-12 items-end gap-2 pb-6">
                    {trendBars.map((value, index) => (
                      <div key={`${index}-${value}`} className="flex h-full flex-col justify-end gap-1">
                        <div
                          className={`min-h-1 rounded-t ${value >= 60 ? "bg-red-400" : value > 0 ? "bg-violet-300" : "bg-zinc-700"}`}
                          style={{ height: `${Math.max(value, value > 0 ? 4 : 2)}%` }}
                          title={`${index + 1}번째 시도: ${value}점`}
                        />
                        <span className={`text-center text-[10px] ${value >= 60 ? "text-red-300" : "text-zinc-500"}`}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-zinc-500">
                    <span>과거</span>
                    <span>최신</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">마우스 이상 탐지</h2>
                <Tooltip text="움직임 데이터, 정규화 선형성, 클릭 패턴에서 더해진 점수가 60점 이상이면 이상으로 판정합니다." />
                </div>
                <p className="mt-1 text-sm text-zinc-400">어떤 항목 때문에 점수가 더해졌는지 표시</p>
              </div>
              <span className={`rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm ${botStatus.text}`}>
                {botScore >= 60 ? "이상" : "정상"}
              </span>
            </div>

            <div className="mt-6 rounded-xl border border-white/5 bg-zinc-950/60 p-5">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <p className="text-sm text-zinc-400">최종 봇 점수</p>
                  <p className="mt-1 text-4xl font-semibold text-white">{formatNumber(botScore, "점")}</p>
                </div>
                <p className="text-sm text-zinc-500">임계값 60점</p>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${botScore >= 60 ? "bg-red-400" : "bg-emerald-400"}`}
                  style={{ width: `${clampPercent(botScore)}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-zinc-500">
                <span>0 정상</span>
                <span className="text-red-300">60 이상</span>
                <span>100</span>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-white">점수 구성 그래프</p>
                  <Tooltip text="노란 구간은 위험 점수가 더해진 항목입니다. 초록 구간은 이번 로그인에서 위험 점수를 더하지 않은 항목입니다." />
                </div>
                <span className="text-sm text-zinc-500">합계 {formatNumber(botScore, "점")}</span>
              </div>
              <div className="flex h-5 overflow-hidden rounded-full bg-zinc-800">
                {mouseReasons.map((item) => {
                  const score = Math.max(Number(item.score) || 0, 0);
                  return (
                    <div
                      key={item.label}
                      className={score > 0 ? "bg-amber-400" : "bg-emerald-400/50"}
                      style={{ width: `${Math.max(score, 6)}%` }}
                      title={`${item.label}: +${score}점`}
                    />
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                {positiveReasons.length > 0 ? positiveReasons.map((item) => (
                  <span key={item.label} className="rounded-lg bg-amber-400/10 px-2.5 py-1 text-amber-100">
                    {item.label} +{item.score}
                  </span>
                )) : (
                  <span className="rounded-lg bg-emerald-400/10 px-2.5 py-1 text-emerald-100">
                    위험 가산점 없음
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {mouseReasons.map((item) => {
                const risky = item.score > 0;
                return (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-white">{item.label}</p>
                          <Tooltip text={item.detail} />
                        </div>
                        <p className="mt-1 text-sm text-zinc-500">측정값 {item.value}</p>
                      </div>
                      <div className="text-right">
                        <p className={risky ? "text-amber-200" : "text-emerald-200"}>{item.result}</p>
                        <p className="mt-1 text-sm text-zinc-500">+{item.score}점</p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full ${risky ? "bg-amber-400" : "bg-emerald-400"}`}
                        style={{ width: `${item.score}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">판정식</span>
                <span className="text-zinc-200">이상 기준: 60점 이상</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {mouseReasons.map((item) => (
                  <span key={item.label} className="rounded-lg bg-zinc-900 px-3 py-1 text-zinc-300">
                    {item.label} +{item.score}
                  </span>
                ))}
                <span className="rounded-lg bg-violet-500/10 px-3 py-1 text-violet-100">
                  합계 {formatNumber(botScore, "점")}
                </span>
              </div>
            </div>

          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-white">CAPTCHA 타입별 결과</h2>
              <Tooltip text="각 CAPTCHA 타입별 성공/실패 수입니다. A/B/C는 Level 1, D는 Level 2에 속합니다." />
            </div>
            <p className="mt-1 text-sm text-zinc-400">Level 1은 A/B/C, Level 2는 D 기준</p>
            <div className="mt-6 space-y-4">
              {(dashboard.captchaTypes || emptyDashboard.captchaTypes).map((item) => {
                const total = item.pass + item.fail;
                const passWidth = total > 0 ? (item.pass / total) * 100 : 0;
                return (
                  <div key={item.type}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-white">
                        Type {item.type} <span className="text-zinc-500">Level {item.level || (item.type === "D" ? 2 : 1)}</span>
                      </span>
                      <span className="text-zinc-400">
                        통과 {item.pass} / 실패 {item.fail}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-red-400/20">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${passWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">최근 로그인 판정</h2>
                  <Tooltip text="기본 표는 최신 10개 이벤트입니다. 더보기를 누르면 최근 7일 데이터가 팝업으로 열립니다." />
                </div>
                <p className="mt-1 text-sm text-zinc-400">최신 10개 데이터</p>
              </div>
              <button
                type="button"
                onClick={showWeekRows}
                disabled={recentLoading}
                className="rounded-lg border border-violet-300/20 bg-violet-500/10 px-3 py-2 text-sm text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recentLoading ? "불러오는 중" : "더보기"}
              </button>
            </div>
            <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="bg-zinc-950/80 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">시도 ID</th>
                    <th className="px-4 py-3 font-medium">사용자</th>
                    <th className="px-4 py-3 font-medium">캡챠</th>
                    <th className="px-4 py-3 font-medium">마우스 판정</th>
                    <th className="px-4 py-3 font-medium">점수</th>
                    <th className="px-4 py-3 font-medium">결과</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {displayedRecentRows.length > 0 ? displayedRecentRows.map((row) => (
                    <tr key={row.id} className="text-zinc-200">
                      <td className="px-4 py-3 text-zinc-400">{row.id}</td>
                      <td className="px-4 py-3">{row.user}</td>
                      <td className="px-4 py-3">Level {row.captchaLevel} / Type {row.captcha}</td>
                      <td className="px-4 py-3">{row.mouse}</td>
                      <td className="px-4 py-3">{row.botScore}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.result} /></td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="px-4 py-8 text-center text-zinc-500" colSpan="6">
                        아직 기록된 보안 이벤트가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          {speedRows.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
              <div className="flex items-center gap-2">
                <p className="text-sm text-zinc-400">{item.label}</p>
                <Tooltip text={item.detail} />
              </div>
              <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
              <p className="mt-2 text-xs text-zinc-500">{item.detail}</p>
            </div>
          ))}
        </section>
      </main>

      {recentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-white">최근 일주일 로그인 판정</h2>
                <p className="mt-1 text-sm text-zinc-400">최근 7일 보안 이벤트 {weekRows.length}건</p>
              </div>
              <button
                type="button"
                onClick={closeRecentModal}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10"
              >
                닫기
              </button>
            </div>
            <div className="max-h-[calc(85vh-88px)] overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-zinc-950 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">시도 ID</th>
                    <th className="px-4 py-3 font-medium">사용자</th>
                    <th className="px-4 py-3 font-medium">캡챠</th>
                    <th className="px-4 py-3 font-medium">마우스 판정</th>
                    <th className="px-4 py-3 font-medium">점수</th>
                    <th className="px-4 py-3 font-medium">결과</th>
                    <th className="px-4 py-3 font-medium">시간</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {weekRows.length > 0 ? weekRows.map((row) => (
                    <tr key={row.id} className="text-zinc-200">
                      <td className="px-4 py-3 text-zinc-400">{row.id}</td>
                      <td className="px-4 py-3">{row.user}</td>
                      <td className="px-4 py-3">Level {row.captchaLevel} / Type {row.captcha}</td>
                      <td className="px-4 py-3">{row.mouse}</td>
                      <td className="px-4 py-3">{row.botScore}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.result} /></td>
                      <td className="px-4 py-3 text-zinc-400">{row.time}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="px-4 py-10 text-center text-zinc-500" colSpan="7">
                        최근 일주일 동안 기록된 보안 이벤트가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
