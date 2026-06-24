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
  mousePoints: [],
  recentRows: [],
  latestMetrics: {
    trajectoryPoints: 0,
    linearMse: null,
    clickHoldStd: null,
    botScore: 0,
  },
};

function buildLinePath(values) {
  const safeValues = values.length > 0 ? values : [0];
  return safeValues
    .map((value, index) => {
      const x = safeValues.length === 1 ? 0 : (index / (safeValues.length - 1)) * 100;
      const y = 100 - Math.min(Math.max(Number(value) || 0, 0), 100);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

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

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
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
      } catch (err) {
        console.error(err);
        setError("대시보드 API에 연결할 수 없습니다.");
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
    const timer = setInterval(loadDashboard, 10000);
    return () => clearInterval(timer);
  }, []);

  const summaryCards = useMemo(() => ([
    { label: "오늘 보안 이벤트", value: dashboard.summary.totalAttempts, suffix: "건", tone: "text-zinc-300" },
    { label: "CAPTCHA 통과율", value: dashboard.summary.captchaPassRate, suffix: "%", tone: "text-emerald-300" },
    { label: "마우스 이상 탐지", value: dashboard.summary.mouseAnomalies, suffix: "건", tone: "text-amber-300" },
    { label: "차단/락아웃", value: dashboard.summary.blocked, suffix: "건", tone: "text-red-300" },
  ]), [dashboard.summary]);

  const linePath = buildLinePath(dashboard.riskTrend || []);
  const botScore = Number(dashboard.latestMetrics.botScore) || 0;
  const botStatus = getMetricStatus(botScore, 60, "over");
  const linearStatus = getMetricStatus(dashboard.latestMetrics.linearMse, 2, "under");
  const clickStatus = getMetricStatus(dashboard.latestMetrics.clickHoldStd, 1, "under");
  const pointCount = Number(dashboard.latestMetrics.trajectoryPoints) || 0;
  const pointStatus = getMetricStatus(pointCount, 5, "under");
  const mouseChecks = [
    {
      label: "궤적 수집량",
      value: formatNumber(pointCount, "개"),
      description: "5개 미만이면 판단 근거 부족",
      status: pointStatus,
    },
    {
      label: "선형성 MSE",
      value: formatNumber(dashboard.latestMetrics.linearMse),
      description: "2.0 미만이면 너무 직선적",
      status: linearStatus,
    },
    {
      label: "클릭 유지 편차",
      value: formatNumber(dashboard.latestMetrics.clickHoldStd, "ms"),
      description: "1.0ms 미만이면 반복 클릭 의심",
      status: clickStatus,
    },
  ];

  const speedRows = [
    { label: "궤적 포인트", value: formatNumber(dashboard.latestMetrics.trajectoryPoints, "개"), detail: "30ms 샘플링" },
    { label: "선형성 MSE", value: formatNumber(dashboard.latestMetrics.linearMse), detail: "2.0 미만 위험" },
    { label: "클릭 유지 편차", value: formatNumber(dashboard.latestMetrics.clickHoldStd, "ms"), detail: "1.0 미만 위험" },
    { label: "최종 봇 점수", value: formatNumber(dashboard.latestMetrics.botScore, "점"), detail: "60점 이상 이상" },
  ];

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
              {loading ? "동기화 중" : error || "10초마다 갱신"}
            </span>
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
              <p className="text-sm text-zinc-400">{item.label}</p>
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
                <h2 className="text-xl font-semibold text-white">이상 탐지 위험 추이</h2>
                <p className="mt-1 text-sm text-zinc-400">최근 로그인 시도 기준 봇 점수</p>
              </div>
              <span className="rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1 text-sm text-red-200">
                임계값 60점
              </span>
            </div>
            <div className="h-64 rounded-xl border border-white/5 bg-zinc-950/60 p-4">
              <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="none">
                <line x1="0" y1="40" x2="100" y2="40" stroke="rgba(248,113,113,0.45)" strokeDasharray="3 3" />
                <path d={linePath} fill="none" stroke="#a78bfa" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                <path d={`${linePath} L 100 100 L 0 100 Z`} fill="rgba(167,139,250,0.12)" />
              </svg>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">마우스 이상 탐지</h2>
                <p className="mt-1 text-sm text-zinc-400">최근 로그인 시도 기준 판정 요약</p>
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
            </div>

            <div className="mt-5 space-y-4">
              {mouseChecks.map((item) => (
                <div key={item.label}>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <span className="font-medium text-white">{item.label}</span>
                      <span className="ml-2 text-zinc-500">{item.description}</span>
                    </div>
                    <span className={item.status.text}>
                      {item.value} · {item.status.label}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${item.status.color}`}
                      style={{ width: `${item.status.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
            <h2 className="text-xl font-semibold text-white">CAPTCHA 레벨별 결과</h2>
            <p className="mt-1 text-sm text-zinc-400">Level 1은 A/B/C, Level 2는 D 기준</p>
            <div className="mt-6 space-y-5">
              {(dashboard.captchaLevels || emptyDashboard.captchaLevels).map((item) => {
                const total = item.pass + item.fail;
                const passWidth = total > 0 ? (item.pass / total) * 100 : 0;
                return (
                  <div key={item.level}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-white">
                        {item.label} <span className="text-zinc-500">Type {item.types.join("/")}</span>
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

            <div className="mt-7 border-t border-white/10 pt-5">
              <p className="mb-4 text-sm font-medium text-zinc-300">타입별 상세</p>
              <div className="space-y-4">
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
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
            <h2 className="text-xl font-semibold text-white">최근 로그인 판정</h2>
            <p className="mt-1 text-sm text-zinc-400">CAPTCHA 결과와 마우스 이상 탐지를 분리 표시</p>
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
                  {dashboard.recentRows.length > 0 ? dashboard.recentRows.map((row) => (
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
              <p className="text-sm text-zinc-400">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
              <p className="mt-2 text-xs text-zinc-500">{item.detail}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
