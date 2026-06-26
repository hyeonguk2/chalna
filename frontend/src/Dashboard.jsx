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
  captchaSolving: {
    total: 0,
    success: 0,
    fail: 0,
    avgSolveTime: null,
    avgTargetTime: null,
    avgErrorSeconds: null,
    resultCounts: {},
    problemStats: [],
    recentRows: [],
  },
  riskTrend: Array(12).fill(0),
  recentRows: [],
  latestMetrics: {
    trajectoryPoints: 0,
    linearMse: null,
    clickHoldStd: null,
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

function averageNumbers(items) {
  const numbers = items
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
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
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [solveQuery, setSolveQuery] = useState("");
  const [solveTypeFilter, setSolveTypeFilter] = useState("all");
  const [statsQuery, setStatsQuery] = useState("");
  const [statsTypeFilter, setStatsTypeFilter] = useState("all");
  const [problemSort, setProblemSort] = useState("total_desc");
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
        captchaSolving: { ...emptyDashboard.captchaSolving, ...(data.captchaSolving || {}) },
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

  const openEventDetail = (event) => {
    setSelectedEvent(event);
  };

  const closeEventDetail = () => {
    setSelectedEvent(null);
  };

  const summaryCards = useMemo(() => ([
    { label: "오늘 보안 이벤트", value: dashboard.summary.totalAttempts, suffix: "건", tone: "text-zinc-300", help: "최근 24시간 동안 저장된 CAPTCHA 판정과 로그인 판정 이벤트 수입니다." },
    { label: "CAPTCHA 통과율", value: dashboard.summary.captchaPassRate, suffix: "%", tone: "text-emerald-300", help: "CAPTCHA 이벤트 중 성공으로 기록된 비율입니다. Level 1과 Level 2 이벤트를 함께 계산합니다." },
    { label: "\uD589\uB3D9\uD328\uD134 \uACBD\uACE0", value: dashboard.summary.mouseAnomalies, suffix: "\uAC74", tone: "text-amber-300", help: "\uB85C\uADF8\uC778 \uC774\uBCA4\uD2B8 \uC911 4\uAC1C \uD589\uB3D9\uD328\uD134 \uD310\uC815\uC5D0 \uD558\uB098 \uC774\uC0C1 \uD574\uB2F9\uB41C \uAD00\uCC30 \uACBD\uACE0 \uAC74\uC218\uC785\uB2C8\uB2E4. \uC774 \uAC12\uC740 \uB85C\uADF8\uC778 \uCC28\uB2E8 \uD310\uC815\uC5D0 \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." },
    { label: "차단/락아웃", value: dashboard.summary.blocked, suffix: "건", tone: "text-red-300", help: "문제 풀이 실패나 차단 상태로 기록된 이벤트 수입니다." },
  ]), [dashboard.summary]);

  const trendBars = (dashboard.riskTrend?.length ? dashboard.riskTrend : emptyDashboard.riskTrend)
    .map((value) => Math.min(Math.max(Number(value) || 0, 0), 4));
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
      id: "trajectory_too_short",
      label: "\uADA4\uC801 10\uAC1C \uBBF8\uB9CC",
      value: formatNumber(pointCount, "\uAC1C"),
      result: trajectoryRisk ? "\uD574\uB2F9" : "\uD574\uB2F9 \uC5C6\uC74C",
      matched: trajectoryRisk,
      detail: "\uC218\uC9D1\uB41C \uB9C8\uC6B0\uC2A4 \uADA4\uC801 \uC88C\uD45C\uAC00 10\uAC1C \uBBF8\uB9CC\uC778\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4.",
    },
    {
      id: "too_straight",
      label: "\uC2DC\uC791\uC810-\uB05D\uC810 \uAE30\uC900 \uC9C1\uC120 \uC774\uB3D9",
      value: hasLinearMse ? formatNumber(linearMse, "%") : "-",
      result: trajectoryRisk ? "\uAC80\uC0AC \uC0DD\uB7B5" : straightRisk ? "\uD574\uB2F9" : "\uD574\uB2F9 \uC5C6\uC74C",
      matched: straightRisk,
      detail: "\uC2DC\uC791\uC810\uACFC \uB05D\uC810\uC744 \uC787\uB294 \uAE30\uC900\uC120\uC5D0\uC11C \uAC70\uC758 \uBC97\uC5B4\uB098\uC9C0 \uC54A\uB294\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4.",
    },
    {
      id: "speed_too_constant",
      label: "\uC18D\uB3C4 \uBCC0\uD654\uC728 \uC77C\uC815",
      value: "-",
      result: "\uC11C\uBC84 \uD310\uC815 \uD544\uC694",
      matched: false,
      detail: "\uC5F0\uC18D \uC88C\uD45C \uC0AC\uC774\uC758 \uC18D\uB3C4 \uBCC0\uD654\uC728\uC774 \uC9C0\uB098\uCE58\uAC8C \uC77C\uC815\uD55C\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4.",
    },
    {
      id: "click_hold_too_constant",
      label: "\uD074\uB9AD \uC720\uC9C0 \uC2DC\uAC04 \uC77C\uC815",
      value: hasClickStd ? formatNumber(clickHoldStd, "ms") : "\uD074\uB9AD\uC30D \uC5C6\uC74C",
      result: hasClickStd ? clickRisk ? "\uD574\uB2F9" : "\uD574\uB2F9 \uC5C6\uC74C" : "\uAC80\uC0AC \uBD88\uAC00",
      matched: clickRisk,
      detail: "\uC5EC\uB7EC \uD074\uB9AD\uC758 down/up \uC720\uC9C0 \uC2DC\uAC04\uC774 \uC9C0\uB098\uCE58\uAC8C \uC77C\uC815\uD55C\uC9C0 \uD655\uC778\uD569\uB2C8\uB2E4.",
    },
  ];
  const mouseReasons = dashboard.latestMetrics.analysisDetails?.length
    ? dashboard.latestMetrics.analysisDetails
    : fallbackMouseReasons;
  const positiveReasons = mouseReasons.filter((item) => item.matched === true);
  const matchedCount = positiveReasons.length;
  const speedRows = [
    { label: "\uADA4\uC801 \uD3EC\uC778\uD2B8", value: formatNumber(dashboard.latestMetrics.trajectoryPoints, "\uAC1C"), detail: "\uCD5C\uADFC \uB85C\uADF8\uC778 \uC2DC\uB3C4\uC5D0\uC11C \uC218\uC9D1\uD55C \uB9C8\uC6B0\uC2A4 \uC88C\uD45C \uC218\uC785\uB2C8\uB2E4." },
    { label: "\uC120\uD615\uC131 \uC9C0\uD45C", value: formatNumber(dashboard.latestMetrics.linearMse, "%"), detail: "\uC2DC\uC791\uC810\uACFC \uB05D\uC810\uC744 \uC787\uB294 \uAE30\uC900\uC120\uC5D0\uC11C \uC5BC\uB9C8\uB098 \uBC97\uC5B4\uB098\uB294\uC9C0 \uC815\uADDC\uD654\uD55C \uAC12\uC785\uB2C8\uB2E4. \uB0AE\uC744\uC218\uB85D \uB354 \uC9C1\uC120\uC801\uC778 \uC6C0\uC9C1\uC784\uC785\uB2C8\uB2E4." },
    { label: "\uD074\uB9AD \uC720\uC9C0 \uD3B8\uCC28", value: formatNumber(dashboard.latestMetrics.clickHoldStd, "ms"), detail: "\uC5EC\uB7EC \uD074\uB9AD\uC758 down/up \uC720\uC9C0 \uC2DC\uAC04\uC774 \uC5BC\uB9C8\uB098 \uB2E4\uB978\uC9C0\uC785\uB2C8\uB2E4. 5ms \uBBF8\uB9CC\uC774\uBA74 \uBC18\uBCF5 \uD074\uB9AD \uAC00\uB2A5\uC131\uC744 \uC758\uC2EC\uD569\uB2C8\uB2E4." },
    { label: "\uD589\uB3D9\uD328\uD134 \uD574\uB2F9 \uD56D\uBAA9", value: `${matchedCount}/4`, detail: "4\uAC1C \uD589\uB3D9\uD328\uD134 \uD310\uC815 \uC911 \uC774\uBC88 \uB85C\uADF8\uC778 \uC2DC\uB3C4\uC5D0 \uD574\uB2F9\uB41C \uD56D\uBAA9 \uC218\uC785\uB2C8\uB2E4." },
  ];
  const captchaSolving = dashboard.captchaSolving || emptyDashboard.captchaSolving;
  const normalizedSolveQuery = solveQuery.trim().toLowerCase();
  const normalizedStatsQuery = statsQuery.trim().toLowerCase();
  const solveTypeOptions = ["all", ...Array.from(new Set(
    (captchaSolving.recentRows || []).map((row) => row.type).filter(Boolean)
  ))];
  const statsTypeOptions = ["all", ...Array.from(new Set(
    (captchaSolving.problemStats || []).map((row) => row.type).filter(Boolean)
  ))];
  const matchesSolveFilter = (item) => {
    const name = String(item.name || "").toLowerCase();
    const type = String(item.type || "");
    const matchesName = !normalizedSolveQuery || name.includes(normalizedSolveQuery);
    const matchesType = solveTypeFilter === "all" || type === solveTypeFilter;
    return matchesName && matchesType;
  };
  const matchesStatsFilter = (item) => {
    const name = String(item.name || "").toLowerCase();
    const type = String(item.type || "");
    const matchesName = !normalizedStatsQuery || name.includes(normalizedStatsQuery);
    const matchesType = statsTypeFilter === "all" || type === statsTypeFilter;
    return matchesName && matchesType;
  };
  const filteredCaptchaRows = (captchaSolving.recentRows || []).filter(matchesSolveFilter);
  const problemSortOptions = [
    { id: "total_desc", label: "시도 많은 순" },
    { id: "success_rate_desc", label: "통과율 높은 순" },
    { id: "success_rate_asc", label: "통과율 낮은 순" },
    { id: "fail_desc", label: "실패 많은 순" },
    { id: "solve_time_desc", label: "풀이시간 긴 순" },
    { id: "solve_time_asc", label: "풀이시간 짧은 순" },
    { id: "error_desc", label: "오차 큰 순" },
    { id: "error_asc", label: "오차 작은 순" },
    { id: "behavior_warning_desc", label: "행동경고 많은 순" },
    { id: "behavior_avg_desc", label: "행동해당 평균 높은 순" },
  ];
  const getProblemSortValue = (item, sort) => {
    if (sort.startsWith("success_rate")) return Number(item.successRate) || 0;
    if (sort.startsWith("fail")) return Number(item.fail) || 0;
    if (sort.startsWith("solve_time")) return Number(item.avgSolveTime) || 0;
    if (sort.startsWith("error")) return Number(item.avgErrorSeconds) || 0;
    if (sort.startsWith("behavior_warning")) return Number(item.behaviorWarnings) || 0;
    if (sort.startsWith("behavior_avg")) return Number(item.avgBehaviorMatches) || 0;
    return Number(item.total) || 0;
  };
  const filteredProblemStats = [...(captchaSolving.problemStats || []).filter(matchesStatsFilter)]
    .sort((a, b) => {
      const direction = problemSort.endsWith("_asc") ? 1 : -1;
      const diff = getProblemSortValue(a, problemSort) - getProblemSortValue(b, problemSort);
      if (diff !== 0) return diff * direction;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  const filteredCaptchaSuccess = filteredCaptchaRows.filter((row) => row.result === "success").length;
  const filteredCaptchaStats = {
    total: filteredCaptchaRows.length,
    success: filteredCaptchaSuccess,
    avgSolveTime: averageNumbers(filteredCaptchaRows.map((row) => row.clickTime)),
    avgTargetTime: averageNumbers(filteredCaptchaRows.map((row) => row.targetTime)),
    avgErrorSeconds: averageNumbers(filteredCaptchaRows.map((row) => row.errorSeconds)),
  };
  const captchaSolveStats = [
    {
      label: "\uD3C9\uADE0 \uD480\uC774 \uC2DC\uAC04",
      value: formatNumber(filteredCaptchaStats.avgSolveTime, "\uCD08"),
      detail: "\uC0AC\uC6A9\uC790\uAC00 \uB2F5\uC744 \uC81C\uCD9C\uD55C \uC2DC\uC810\uC758 \uD3C9\uADE0\uAC12\uC785\uB2C8\uB2E4.",
    },
    {
      label: "\uD3C9\uADE0 \uC815\uB2F5 \uC2DC\uC810",
      value: formatNumber(filteredCaptchaStats.avgTargetTime, "\uCD08"),
      detail: "\uBB38\uC81C\uC5D0 \uC800\uC7A5\uB41C \uC815\uB2F5 \uAE30\uC900 \uC2DC\uC810\uC758 \uD3C9\uADE0\uAC12\uC785\uB2C8\uB2E4.",
    },
    {
      label: "\uD3C9\uADE0 \uC624\uCC28",
      value: formatNumber(filteredCaptchaStats.avgErrorSeconds, "\uCD08"),
      detail: "\uC81C\uCD9C \uC2DC\uC810\uACFC \uC815\uB2F5 \uAE30\uC900 \uC2DC\uC810 \uC0AC\uC774\uC758 \uD3C9\uADE0 \uC808\uB300 \uC624\uCC28\uC785\uB2C8\uB2E4.",
    },
    {
      label: "\uCD5C\uADFC \uBB38\uC81C \uC131\uACF5\uB960",
      value: formatNumber(filteredCaptchaStats.total > 0 ? (filteredCaptchaStats.success / filteredCaptchaStats.total) * 100 : 0, "%"),
      detail: "\uB300\uC2DC\uBCF4\uB4DC \uC9D1\uACC4 \uAE30\uAC04 \uB0B4 CAPTCHA \uBB38\uC81C \uC131\uACF5 \uBE44\uC728\uC785\uB2C8\uB2E4.",
    },
  ];
  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-violet-200/60 mt-6">
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
                  <h2 className="text-xl font-semibold text-white">{"\uD589\uB3D9\uD328\uD134 \uD574\uB2F9 \uCD94\uC774"}</h2>
                  <Tooltip text={"\uCD5C\uADFC \uB85C\uADF8\uC778 \uC774\uBCA4\uD2B8\uB9C8\uB2E4 4\uAC1C \uD589\uB3D9\uD328\uD134 \uD310\uC815 \uC911 \uBA87 \uAC1C\uAC00 \uD574\uB2F9\uB410\uB294\uC9C0 \uBCF4\uC5EC\uC90D\uB2C8\uB2E4."} />
                </div>
                <p className="mt-1 text-sm text-zinc-400">왼쪽은 오래된 시도, 오른쪽은 최신 시도</p>
              </div>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-sm text-amber-200">
                {"0~4\uAC1C"}
              </span>
            </div>
            <div className="h-64 rounded-xl border border-white/5 bg-zinc-950/60 p-4">
              <div className="flex h-full gap-3">
                <div className="flex flex-col justify-between py-1 text-right text-xs text-zinc-500">
                  <span>4</span>
                  <span className="text-amber-300">2</span>
                  <span>0</span>
                </div>
                <div className="relative min-w-0 flex-1 pb-6">
                  <div className="absolute left-0 right-0 top-0 border-t border-white/10" />
                  <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-amber-300/60" />
                  <div className="absolute left-0 right-0 bottom-6 border-t border-white/10" />
                  <div className="grid h-full grid-cols-12 items-end gap-2 pb-6">
                    {trendBars.map((value, index) => (
                      <div key={`${index}-${value}`} className="flex h-full flex-col justify-end gap-1">
                        <div
                          className={`min-h-1 rounded-t ${value > 0 ? "bg-amber-400" : "bg-zinc-700"}`}
                          style={{ height: `${Math.max((value / 4) * 100, value > 0 ? 12 : 2)}%` }}
                          title={`${index + 1}\uBC88\uC9F8 \uC2DC\uB3C4: ${value}\uAC1C \uD574\uB2F9`}
                        />
                        <span className={`text-center text-[10px] ${value > 0 ? "text-amber-300" : "text-zinc-500"}`}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-between text-xs text-zinc-500">
                <span>과거</span>
                <span>최신</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-white">{"\uD589\uB3D9\uD328\uD134 \uD310\uC815"}</h2>
                  <Tooltip text={"\uC810\uC218 \uC5C6\uC774 4\uAC1C \uD589\uB3D9\uD328\uD134 \uD56D\uBAA9\uC5D0 \uD574\uB2F9\uB418\uB294\uC9C0 \uC5EC\uBD80\uB9CC \uBCF4\uC5EC\uC90D\uB2C8\uB2E4."} />
                </div>
                <p className="mt-1 text-xs text-zinc-400">{"\uCD5C\uADFC \uB85C\uADF8\uC778 \uC2DC\uB3C4 \uAE30\uC900"}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-sm ${matchedCount > 0 ? "border-amber-400/20 bg-amber-400/10 text-amber-200" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>
                {matchedCount > 0 ? `${matchedCount}\uAC1C \uD574\uB2F9` : "\uD574\uB2F9 \uC5C6\uC74C"}
              </span>
            </div>

            <div className="mt-4 rounded-xl border border-white/5 bg-zinc-950/60 p-4">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <p className="text-xs text-zinc-400">{"\uD574\uB2F9 \uD56D\uBAA9"}</p>
                  <p className="mt-1 text-3xl font-semibold text-white">{matchedCount}/4</p>
                </div>
                <p className="text-xs text-zinc-500">{"\uC810\uC218 \uBBF8\uC0AC\uC6A9"}</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {mouseReasons.map((item) => (
                  <div
                    key={item.id || item.label}
                    className={`h-2 rounded-full ${item.matched ? "bg-amber-400" : "bg-emerald-400/50"}`}
                    title={`${item.label}: ${item.matched ? "\uD574\uB2F9" : "\uD574\uB2F9 \uC5C6\uC74C"}`}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-400">
                {positiveReasons.length > 0 ? positiveReasons.map((item) => (
                  <span key={item.id || item.label} className="rounded-lg bg-amber-400/10 px-2 py-0.5 text-amber-100">
                    {item.label}
                  </span>
                )) : (
                  <span className="rounded-lg bg-emerald-400/10 px-2 py-0.5 text-emerald-100">
                    {"\uD574\uB2F9\uB418\uB294 \uD589\uB3D9\uD328\uD134 \uC5C6\uC74C"}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {mouseReasons.map((item) => {
                const risky = item.matched === true;
                return (
                  <div key={item.id || item.label} className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white">{item.label}</p>
                          <Tooltip text={item.detail} />
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">{"\uCE21\uC815\uAC12"} {item.value}</p>
                      </div>
                      <p className={`text-sm ${risky ? "text-amber-200" : "text-emerald-200"}`}>
                        {item.result || (risky ? "\uD574\uB2F9" : "\uD574\uB2F9 \uC5C6\uC74C")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </section>

        <section className="mt-6">
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
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-white">{"\uBB38\uC81C\uD480\uC774 \uBD84\uC11D"}</h2>
                <Tooltip text={"\uC0AC\uC6A9\uC790\uAC00 CAPTCHA \uBB38\uC81C\uB97C \uD480 \uB54C \uC81C\uCD9C\uD55C \uC2DC\uAC04, \uC815\uB2F5 \uAE30\uC900 \uC2DC\uAC04, \uC624\uCC28, \uACB0\uACFC\uB97C \uBCF4\uC5EC\uC90D\uB2C8\uB2E4."} />
              </div>
              <p className="mt-1 text-sm text-zinc-400">{"\uCD5C\uADFC \uD480\uC774 \uAE30\uB85D\uACFC \uBB38\uC81C\uBCC4 \uD1B5\uACC4\uB97C \uAC01\uAC01 \uB530\uB85C \uAC80\uC0C9\uD558\uACE0 \uD544\uD130\uB9C1\uD569\uB2C8\uB2E4."}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            {captchaSolveStats.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-zinc-400">{item.label}</p>
                  <Tooltip text={item.detail} />
                </div>
                <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-white/10 bg-zinc-950/30">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-white">{"\uCD5C\uADFC \uBB38\uC81C\uD480\uC774 \uAE30\uB85D"}</h3>
                <p className="mt-1 text-xs text-zinc-500">{"\uAC1C\uBCC4 \uD480\uC774 \uC2DC\uB3C4\uC758 \uC81C\uCD9C \uC2DC\uAC04, \uC624\uCC28, \uACB0\uACFC\uB97C \uD655\uC778\uD569\uB2C8\uB2E4."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={solveQuery}
                  onChange={(event) => setSolveQuery(event.target.value)}
                  placeholder="문제 이름 검색"
                  className="h-9 min-w-[200px] rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/50"
                />
                <select
                  value={solveTypeFilter}
                  onChange={(event) => setSolveTypeFilter(event.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-violet-300/50"
                >
                  {solveTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type === "all" ? "전체 타입" : `Type ${type}`}
                    </option>
                  ))}
                </select>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">
                  {filteredCaptchaRows.length}/{captchaSolving.recentRows?.length || 0}건
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-zinc-950/80 text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">{"\uC2DC\uB3C4 ID"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC0AC\uC6A9\uC790"}</th>
                  <th className="px-4 py-3 font-medium">{"\uBB38\uC81C"}</th>
                  <th className="px-4 py-3 font-medium">{"\uBB38\uC81C \uC774\uB984"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC81C\uCD9C \uC2DC\uAC04"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC815\uB2F5 \uAE30\uC900"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC624\uCC28"}</th>
                  <th className="px-4 py-3 font-medium">{"\uD589\uB3D9\uD328\uD134"}</th>
                  <th className="px-4 py-3 font-medium">{"\uACB0\uACFC"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC2DC\uAC04"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredCaptchaRows.length > 0 ? filteredCaptchaRows.map((row) => {
                  const success = row.result === "success";
                  return (
                    <tr
                      key={row.id}
                      onClick={() => openEventDetail({
                        ...row,
                        phaseLabel: "문제풀이",
                        captcha: row.type,
                        captchaName: row.name,
                        captchaLevel: row.level,
                        captchaResult: row.result,
                        captchaResultLabel: row.resultLabel,
                        rawResult: row.result,
                        message: row.resultLabel,
                        behaviorMatches: row.behaviorMatches,
                        behaviorDetails: row.behaviorDetails || [],
                      })}
                      className="cursor-pointer text-zinc-200 transition hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 text-zinc-400">{row.id}</td>
                      <td className="px-4 py-3">{row.user}</td>
                      <td className="px-4 py-3">Level {row.level} / Type {row.type}</td>
                      <td className="px-4 py-3">{row.name}</td>
                      <td className="px-4 py-3">{formatNumber(row.clickTime, "\uCD08")}</td>
                      <td className="px-4 py-3">{formatNumber(row.targetTime, "\uCD08")}</td>
                      <td className="px-4 py-3">{formatNumber(row.errorSeconds, "\uCD08")}</td>
                      <td className="px-4 py-3">
                        {row.hasBehaviorData ? (
                          <span className={`rounded-full border px-2.5 py-1 text-xs ${Number(row.behaviorMatches) > 0 ? "border-amber-400/20 bg-amber-400/10 text-amber-200" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>
                            {row.behaviorLabel || `${row.behaviorMatches}/4`}
                          </span>
                        ) : (
                          <span className="text-zinc-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2.5 py-1 text-xs ${success ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-amber-400/20 bg-amber-400/10 text-amber-200"}`}>
                          {row.resultLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{row.time}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td className="px-4 py-8 text-center text-zinc-500" colSpan="10">
                      {"\uC544\uC9C1 \uAE30\uB85D\uB41C \uBB38\uC81C\uD480\uC774 \uC774\uBCA4\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-white/10 bg-zinc-950/30">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-white">{"\uBB38\uC81C\uBCC4 \uD1B5\uACC4"}</h3>
                <p className="mt-1 text-xs text-zinc-500">{"\uBB38\uC81C \uC774\uB984\uBCC4 \uC2DC\uB3C4\uC218, \uC2E4\uD328\uC218, \uC131\uACF5\uB960, \uD3C9\uADE0\uAC12\uC744 \uBE44\uAD50\uD569\uB2C8\uB2E4."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={statsQuery}
                  onChange={(event) => setStatsQuery(event.target.value)}
                  placeholder="문제 이름 검색"
                  className="h-9 min-w-[200px] rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/50"
                />
                <select
                  value={statsTypeFilter}
                  onChange={(event) => setStatsTypeFilter(event.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-violet-300/50"
                >
                  {statsTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type === "all" ? "전체 타입" : `Type ${type}`}
                    </option>
                  ))}
                </select>
                <select
                  value={problemSort}
                  onChange={(event) => setProblemSort(event.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-violet-300/50"
                >
                  {problemSortOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">
                  {filteredProblemStats.length}/{captchaSolving.problemStats?.length || 0}개
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-zinc-950/80 text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">{"\uBB38\uC81C \uC774\uB984"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC720\uD615"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC2DC\uB3C4"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC2E4\uD328"}</th>
                  <th className="px-4 py-3 font-medium">{"\uC131\uACF5\uB960"}</th>
                  <th className="px-4 py-3 font-medium">{"\uD3C9\uADE0 \uD480\uC774"}</th>
                  <th className="px-4 py-3 font-medium">{"\uD3C9\uADE0 \uC624\uCC28"}</th>
                  <th className="px-4 py-3 font-medium">{"\uD589\uB3D9\uACBD\uACE0"}</th>
                  <th className="px-4 py-3 font-medium">{"\uD3C9\uADE0 \uD574\uB2F9"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredProblemStats.length > 0 ? filteredProblemStats.map((item) => (
                  <tr key={`${item.type}-${item.name}`} className="text-zinc-200">
                    <td className="px-4 py-3 font-medium text-white">{item.name}</td>
                    <td className="px-4 py-3">Level {item.level} / Type {item.type}</td>
                    <td className="px-4 py-3">{item.total}건</td>
                    <td className="px-4 py-3">{item.fail}건</td>
                    <td className="px-4 py-3">{formatNumber(item.successRate, "%")}</td>
                    <td className="px-4 py-3">{formatNumber(item.avgSolveTime, "초")}</td>
                    <td className="px-4 py-3">{formatNumber(item.avgErrorSeconds, "초")}</td>
                    <td className="px-4 py-3">
                      {item.behaviorDataCount > 0 ? `${item.behaviorWarnings}/${item.behaviorDataCount}건` : "-"}
                    </td>
                    <td className="px-4 py-3">
                      {item.behaviorDataCount > 0 ? formatNumber(item.avgBehaviorMatches, "개") : "-"}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td className="px-4 py-8 text-center text-zinc-500" colSpan="9">
                      {"\uC544\uC9C1 \uBB38\uC81C\uBCC4 \uD1B5\uACC4 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}
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
            </div>
          ))}
        </section>
      </main>

      {selectedEvent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-violet-200/60">{selectedEvent.id}</p>
                <h2 className="mt-1 text-xl font-semibold text-white">이벤트 상세</h2>
                <p className="mt-1 text-sm text-zinc-400">{selectedEvent.phaseLabel || selectedEvent.phase || "-"} · {selectedEvent.time || "-"}</p>
              </div>
              <button
                type="button"
                onClick={closeEventDetail}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10"
              >
                닫기
              </button>
            </div>

            <div className="max-h-[calc(86vh-88px)] overflow-y-auto px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["사용자", selectedEvent.user],
                  ["결과", selectedEvent.resultLabel || selectedEvent.captchaResultLabel || selectedEvent.result],
                  ["문제", `Level ${selectedEvent.captchaLevel || selectedEvent.level || "-"} / Type ${selectedEvent.captcha || selectedEvent.type || "-"}`],
                  ["문제 이름", selectedEvent.captchaName || selectedEvent.name || "-"],
                  ["메시지", selectedEvent.message || "-"],
                  ["제출 시간", formatNumber(selectedEvent.clickTime, "초")],
                  ["정답 기준", formatNumber(selectedEvent.targetTime, "초")],
                  ["오차", formatNumber(selectedEvent.errorSeconds, "초")],
                  ["행동패턴 해당", selectedEvent.behaviorMatches === null || selectedEvent.behaviorMatches === undefined ? "-" : `${selectedEvent.behaviorMatches}/4`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-xs text-zinc-500">{label}</p>
                    <p className="mt-1 text-sm font-medium text-zinc-100">{value || "-"}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-zinc-950/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">행동패턴 세부 항목</h3>
                  <span className="text-xs text-zinc-500">관리자 참고용</span>
                </div>
                {selectedEvent.behaviorDetails?.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedEvent.behaviorDetails.map((item) => (
                      <div key={item.id || item.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{item.label}</p>
                            <p className="mt-1 text-xs text-zinc-500">측정값 {item.value}</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${item.matched ? "bg-amber-400/10 text-amber-200" : "bg-emerald-400/10 text-emerald-200"}`}>
                            {item.result || (item.matched ? "해당" : "해당 없음")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">행동패턴 세부 데이터가 없습니다.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
