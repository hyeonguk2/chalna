const express = require('express');
const crypto = require('crypto');
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (err) => {
    console.error("Redis Client Error:", err);
});

const redisReady = redisClient.connect().catch((err) => {
    console.error("Redis connect error:", err);
});

const getRedisClient = async () => {
    await redisReady;

    if (!redisClient.isOpen) {
        throw new Error("Redis is not connected");
    }

    return redisClient;
};

const getSessionKey = (token) => `session:${token}`;

const getCookie = (req, name) => {
    const cookieHeader = req.headers.cookie || "";
    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};

const createSession = async (user) => {
    const token = crypto.randomBytes(32).toString("hex");
    const client = await getRedisClient();

    await client.set(getSessionKey(token), JSON.stringify({
        user: {
            id: user.id,
            userid: user.userid,
            email: user.email,
        },
    }), {
        EX: SESSION_TTL_SECONDS,
    });

    return token;
};

const getSession = async (req) => {
    const token = getCookie(req, "sid");
    if (!token) return null;

    const client = await getRedisClient();
    const rawSession = await client.get(getSessionKey(token));
    if (!rawSession) return null;

    const session = JSON.parse(rawSession);

    return { token, ...session };
};

const setSessionCookie = (res, token) => {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
        "Set-Cookie",
        `sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`
    );
};

const clearSessionCookie = (res) => {
    res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
};

// ==========================================
// 수학적 유틸리티 함수 (Python numpy 대체)
// ==========================================
const calculateMean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

const calculateStdDev = (arr) => {
    if (arr.length <= 1) return 0;
    const mean = calculateMean(arr);
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
};

// 1차 선형 회귀 (Linear Regression) 
const calculateLinearRegression = (xCoords, yCoords) => {
    const n = xCoords.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        sumX += xCoords[i];
        sumY += yCoords[i];
        sumXY += xCoords[i] * yCoords[i];
        sumXX += xCoords[i] * xCoords[i];
    }

    // y = slope * x + intercept
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
};

// ==========================================
// 2. 인지적 직관 기반 봇 판별 알고리즘
// ==========================================
const analyzeBotBehavior = (metrics) => {
    let botScore = 0;
    let linearMse = null;
    let mouseReason = "정상 흔들림";

    // --- [1] 마우스 궤적 선형성 분석 (배점 60점) ---
    const traj = metrics.mouseTrajectory || [];

    if (traj.length < 5) {
        botScore += 60;
        mouseReason = "궤적 부족";
    } else {
        const xCoords = traj.map(pt => pt.x);
        const yCoords = traj.map(pt => pt.y);
        const xStdDev = calculateStdDev(xCoords);

        if (xStdDev === 0) {
            botScore += 60;
            mouseReason = "수직 고정 궤적";
        } else {
            const { slope, intercept } = calculateLinearRegression(xCoords, yCoords);

            let squaredErrorsSum = 0;
            for (let i = 0; i < traj.length; i++) {
                const predictedY = slope * xCoords[i] + intercept;
                squaredErrorsSum += Math.pow(yCoords[i] - predictedY, 2);
            }
            const mse = squaredErrorsSum / traj.length;
            linearMse = Number.isFinite(mse) ? mse : null;

            if (linearMse !== null && linearMse < 2.0) {
                botScore += 60;
                mouseReason = "선형 궤적";
            }
        }
    }

    // --- [2] 클릭 타이밍 분포 분석 (배점 40점) ---
    const clicks = metrics.clickData || [];
    const holdTimes = [];

    for (let i = 0; i < clicks.length - 1; i++) {
        const c1 = clicks[i];
        const c2 = clicks[i + 1];

        if (c1.type === 'down' && c2.type === 'up') {
            holdTimes.push(c2.t - c1.t);
        }
    }

    if (holdTimes.length > 0) {
        const stdDev = calculateStdDev(holdTimes);
        if (stdDev < 1.0) {
            botScore += 40;
            mouseReason = mouseReason === "정상 흔들림" ? "클릭 간격 일정" : `${mouseReason}, 클릭 일정`;
        }
    } else {
        botScore += 20;
    }

    console.log(`[Bot Detection] 트래킹 수: ${traj.length}, 클릭 쌍: ${holdTimes.length} -> 산출된 위험 점수: ${botScore}`);

    return {
        isBot: botScore >= 60,
        botScore,
        mouseReason,
        trajectoryPoints: traj.length,
        linearMse,
        clickHoldStd: holdTimes.length > 0 ? calculateStdDev(holdTimes) : null,
        clickPairs: holdTimes.length,
    };
};

// ==========================================
// 3. 로그인 및 캡차 검증 API 라우터 (DB 연동)
// ==========================================
// 외부에서 db 객체를 주입받도록 module.exports를 함수형태로 변경합니다.
module.exports = (db) => {
    const router = express.Router();

    const query = (sql, values = []) =>
        new Promise((resolve, reject) => {
            db.query(sql, values, (err, results) => {
                if (err) return reject(err);
                resolve(results);
            });
        });

    const ensureSecurityEventsTable = () => {
        const createTable = `
            CREATE TABLE IF NOT EXISTS security_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                phase ENUM('captcha','login') NOT NULL,
                userid VARCHAR(50),
                captcha_type CHAR(1),
                captcha_level INT,
                captcha_result VARCHAR(30),
                mouse_result VARCHAR(80),
                bot_score INT DEFAULT 0,
                trajectory_points INT DEFAULT 0,
                linear_mse DOUBLE,
                click_hold_std DOUBLE,
                click_pairs INT DEFAULT 0,
                click_time DOUBLE,
                badtime DOUBLE,
                result VARCHAR(30) NOT NULL,
                message VARCHAR(255),
                created_at BIGINT NOT NULL,
                INDEX idx_security_created_at (created_at),
                INDEX idx_security_userid (userid),
                INDEX idx_security_phase (phase)
            )
        `;

        db.query(createTable, (err) => {
            if (err) {
                console.error("security_events table create error:", err);
                return;
            }

            console.log("security_events table ready");
        });
    };

    ensureSecurityEventsTable();

    const recordSecurityEvent = (event) => {
        const sql = `
            INSERT INTO security_events (
                phase, userid, captcha_type, captcha_level, captcha_result,
                mouse_result, bot_score, trajectory_points, linear_mse,
                click_hold_std, click_pairs, click_time, badtime, result,
                message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            event.phase,
            event.userid || null,
            event.captchaType || null,
            event.captchaLevel || null,
            event.captchaResult || null,
            event.mouseResult || null,
            event.botScore || 0,
            event.trajectoryPoints || 0,
            event.linearMse ?? null,
            event.clickHoldStd ?? null,
            event.clickPairs || 0,
            event.clickTime ?? null,
            event.badtime ?? null,
            event.result,
            event.message || null,
            Date.now(),
        ];

        db.query(sql, values, (err) => {
            if (err) console.error("security event insert error:", err);
        });
    };

    const getStatusLabel = (row) => {
        if (row.result === "blocked" || row.result === "bot") return "차단";
        if (row.result === "success") return "정상";
        if (row.result === "retry") return "재시도";
        return "이상";
    };

    const formatTime = (createdAt) => {
        const date = new Date(Number(createdAt));
        if (Number.isNaN(date.getTime())) return "-";
        return date.toLocaleTimeString("ko-KR", { hour12: false });
    };

    const getCaptchaLevel = (captchaType) => captchaType === "D" ? 2 : 1;

    const countCaptchaResults = (items) => ({
        pass: items.filter((event) => event.captcha_result === "success").length,
        fail: items.filter((event) => event.captcha_result && event.captcha_result !== "success").length,
    });

    router.post("/api/login", (req, res) => {
        try {
            const payload = req.body;

            // (1) 기본 유효성 검증
            if (!payload.username || !payload.password) {
                return res.status(400).json({ success: false, isBot: false, message: "ID/PW 누락" });
            }

            console.log("=== [프론트에서 넘어온 마우스 데이터] ===");
            console.log(JSON.stringify(payload.behaviorMetrics, null, 2));

            // ==========================================================
            // [추가] 락아웃 시간 제한 및 실패 횟수 검증 (시간 제한 입구컷)
            // ==========================================================
            const checkLockoutSql = "SELECT login_attempts, lockout_time FROM users WHERE userid = ?";
            db.query(checkLockoutSql, [payload.username], (lockErr, userRows) => {
                if (lockErr) {
                    console.error("Lockout Check Error:", lockErr);
                    return res.status(500).json({ success: false, message: "내부 서버 오류" });
                }

                if (userRows.length > 0) {
                    const user = userRows[0];
                    if (user.login_attempts >= 2 && user.lockout_time > 0) {
                        const LOCKOUT_DURATION = 3 * 60 * 1000; // 3분 제한 (밀리초)
                        const passedTime = Date.now() - Number(user.lockout_time);

                        if (passedTime < LOCKOUT_DURATION) {
                            const remainingSec = Math.ceil((LOCKOUT_DURATION - passedTime) / 1000);
                            return res.json({
                                success: false,
                                isBot: false,
                                reason: "locked",
                                message: `연속된 인증 실패로 인해 제한되었습니다. ${remainingSec}초 후 다시 시도하세요.`
                            });
                        } else {
                            // 3분이 지났다면 시도 횟수와 락아웃 시간을 초기화하고 로그인을 계속 진행시킴
                            db.query("UPDATE users SET login_attempts = 0, lockout_time = 0 WHERE userid = ?", [payload.username]);
                        }
                    }
                }

                // (2) 실제 DB 연동: 아이디/비밀번호 검증
                const sql = "SELECT * FROM users WHERE userid = ?";
                db.query(sql, [payload.username], async (err, results) => {
                    if (err) {
                        console.error("DB Query Error:", err);
                        return res.status(500).json({ success: false, message: "내부 서버 오류 (DB)" });
                    }

                    // ❌ [오답 처리] 일치하는 유저 정보가 없을 때 (비밀번호 틀림 등)
                    const user = results[0];
                    let passwordMatches = false;

                    try {
                        passwordMatches = user && (
                            user.password.startsWith("$2")
                                ? await bcrypt.compare(payload.password, user.password)
                                : payload.password === user.password
                        );
                    } catch (passwordError) {
                        console.error("Password verification error:", passwordError);
                        return res.status(500).json({ success: false, message: "Password verification failed" });
                    }

                    if (!passwordMatches) {
                        // 기존 실패 횟수를 조회하여 2회가 되는 순간 락아웃 처리
                        db.query("SELECT login_attempts FROM users WHERE userid = ?", [payload.username], (selErr, rows) => {
                            const currentAttempts = rows[0]?.login_attempts || 0;
                            const nextAttempts = currentAttempts + 1;
                            const now = nextAttempts >= 2 ? Date.now() : 0;

                            db.query(
                                "UPDATE users SET login_attempts = login_attempts + 1, lockout_time = ? WHERE userid = ?",
                                [now, payload.username]
                            );
                        });

                        recordSecurityEvent({
                            phase: "login",
                            userid: payload.username,
                            captchaType: payload.captchaData?.type,
                            captchaResult: payload.captchaData?.answer === true ? "success" : "missing",
                            result: "fail",
                            message: "아이디 또는 비밀번호 불일치",
                        });

                        return res.status(401).json({ success: false, isBot: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." });
                    }

                    // (3) 팀원이 만든 캡차 모듈 결과값 검증
                    // 프론트에서 captchaData가 안 넘어왔거나, answer가 true가 아니라면 불허 처리 ❌
                    if (!user.password.startsWith("$2")) {
                        try {
                            const passwordHash = await bcrypt.hash(payload.password, 12);
                            await new Promise((resolve, reject) => {
                                db.query(
                                    "UPDATE users SET password = ? WHERE id = ?",
                                    [passwordHash, user.id],
                                    (updateErr) => updateErr ? reject(updateErr) : resolve()
                                );
                            });
                        } catch (passwordUpgradeError) {
                            console.error("Password upgrade error:", passwordUpgradeError);
                            return res.status(500).json({ success: false, message: "Password upgrade failed" });
                        }
                    }

                    if (!payload.captchaData || payload.captchaData.answer !== true) {
                        recordSecurityEvent({
                            phase: "login",
                            userid: payload.username,
                            captchaType: payload.captchaData?.type,
                            captchaResult: "missing",
                            result: "fail",
                            message: "CAPTCHA 미완료",
                        });

                        return res.status(401).json({
                            success: false,
                            isBot: false,
                            message: "캡차 인증이 완료되지 않았거나 실패했습니다."
                        });
                    }
                    // (4) 핵심 로직: 마우스 행동 기반 봇 분석 수행
                    const behaviorAnalysis = analyzeBotBehavior(payload.behaviorMetrics || {});
                    const isBot = behaviorAnalysis.isBot;

                    // 🤖 [봇 감지 시 처리] 봇으로 판정되면 실패 횟수를 누적하고 차단 검사 진행
                    if (isBot) {
                        db.query("SELECT login_attempts FROM users WHERE userid = ?", [payload.username], (selErr, rows) => {
                            const currentAttempts = rows[0]?.login_attempts || 0;
                            const nextAttempts = currentAttempts + 1;
                            const now = nextAttempts >= 2 ? Date.now() : 0;

                            db.query(
                                "UPDATE users SET login_attempts = login_attempts + 1, lockout_time = ? WHERE userid = ?",
                                [now, payload.username]
                            );
                        });

                        recordSecurityEvent({
                            phase: "login",
                            userid: payload.username,
                            captchaType: payload.captchaData?.type,
                            captchaLevel: payload.captchaData?.level,
                            captchaResult: "success",
                            mouseResult: behaviorAnalysis.mouseReason,
                            botScore: behaviorAnalysis.botScore,
                            trajectoryPoints: behaviorAnalysis.trajectoryPoints,
                            linearMse: behaviorAnalysis.linearMse,
                            clickHoldStd: behaviorAnalysis.clickHoldStd,
                            clickPairs: behaviorAnalysis.clickPairs,
                            result: "bot",
                            message: "비정상 패턴 감지",
                        });

                        return res.json({ success: true, isBot: true, message: "비정상 패턴 감지" });
                    }

                    // ⭕ [최종 인증 성공] 일반인인 경우 세션 생성 및 로그인 처리
                    let sessionToken;
                    try {
                        sessionToken = await createSession(user);
                        setSessionCookie(res, sessionToken);
                    } catch (error) {
                        console.error("Session create error:", error);
                        return res.status(500).json({ success: false, message: "세션 생성 실패" });
                    }

                    // 로그인 최종 성공 시 유저 테이블의 실패 횟수 및 락아웃 리셋
                    db.query("UPDATE users SET login_attempts = 0, lockout_time = 0, captchatype = NULL WHERE userid = ?", [payload.username]);

                    recordSecurityEvent({
                        phase: "login",
                        userid: payload.username,
                        captchaType: payload.captchaData?.type,
                        captchaLevel: payload.captchaData?.level,
                        captchaResult: "success",
                        mouseResult: behaviorAnalysis.mouseReason,
                        botScore: behaviorAnalysis.botScore,
                        trajectoryPoints: behaviorAnalysis.trajectoryPoints,
                        linearMse: behaviorAnalysis.linearMse,
                        clickHoldStd: behaviorAnalysis.clickHoldStd,
                        clickPairs: behaviorAnalysis.clickPairs,
                        result: "success",
                        message: "로그인 및 인증 성공",
                    });

                    return res.json({ success: true, isBot: false, message: "로그인 및 인증 성공" });
                });
            });
        } catch (error) {
            console.error("서버 에러 발생:", error);
            return res.status(500).json({ success: false, message: "내부 서버 오류" });
        }
    });

    router.get("/api/me", async (req, res) => {
        try {
            const session = await getSession(req);
            if (!session) {
                return res.status(401).json({ authenticated: false });
            }

            return res.json({
                authenticated: true,
                user: session.user,
            });
        } catch (error) {
            console.error("Session read error:", error);
            return res.status(500).json({ authenticated: false, message: "세션 조회 실패" });
        }
    });

    router.post("/api/logout", async (req, res) => {
        try {
            const session = await getSession(req);
            if (session) {
                const client = await getRedisClient();
                await client.del(getSessionKey(session.token));
            }
        } catch (error) {
            console.error("Session logout error:", error);
        }

        clearSessionCookie(res);
        return res.json({ success: true });
    });

    router.get("/api/dashboard/security", async (req, res) => {
        try {
            const since = Date.now() - 24 * 60 * 60 * 1000;
            const events = await query(
                `SELECT * FROM security_events
                 WHERE created_at >= ?
                 ORDER BY created_at DESC
                 LIMIT 200`,
                [since]
            );

            const total = events.length;
            const captchaEvents = events.filter((event) => event.phase === "captcha");
            const loginEvents = events.filter((event) => event.phase === "login");
            const captchaPassed = captchaEvents.filter((event) => event.captcha_result === "success").length;
            const captchaPassRate = captchaEvents.length > 0
                ? Math.round((captchaPassed / captchaEvents.length) * 1000) / 10
                : 0;
            const mouseAnomalies = loginEvents.filter((event) => Number(event.bot_score) >= 60).length;
            const blocked = events.filter((event) => ["blocked", "bot"].includes(event.result)).length;

            const captchaTypes = ["A", "B", "C", "D"].map((type) => {
                const byType = captchaEvents.filter((event) => event.captcha_type === type);
                return {
                    type,
                    level: getCaptchaLevel(type),
                    ...countCaptchaResults(byType),
                };
            });

            const captchaLevels = [
                {
                    level: 1,
                    label: "Level 1",
                    types: ["A", "B", "C"],
                    ...countCaptchaResults(captchaEvents.filter((event) => ["A", "B", "C"].includes(event.captcha_type))),
                },
                {
                    level: 2,
                    label: "Level 2",
                    types: ["D"],
                    ...countCaptchaResults(captchaEvents.filter((event) => event.captcha_type === "D")),
                },
            ];

            const recentLogins = loginEvents.slice(0, 12);
            const riskTrend = [...recentLogins]
                .reverse()
                .map((event) => Number(event.bot_score) || 0);

            while (riskTrend.length < 12) {
                riskTrend.unshift(0);
            }

            const latestLogin = loginEvents[0] || {};
            const recentRows = events.slice(0, 12).map((event) => ({
                id: `EV-${event.id}`,
                user: event.userid || "-",
                captcha: event.captcha_type || "-",
                captchaLevel: event.captcha_type ? getCaptchaLevel(event.captcha_type) : "-",
                mouse: event.mouse_result || (event.phase === "captcha" ? "CAPTCHA 판정" : "-"),
                botScore: Number(event.bot_score) || 0,
                result: getStatusLabel(event),
                time: formatTime(event.created_at),
            }));

            const mousePoints = latestLogin.trajectory_points > 0
                ? Array.from({ length: Math.min(Number(latestLogin.trajectory_points), 10) }, (_, index) => {
                    const x = 6 + index * 9.8;
                    const baseY = 78 - index * 6;
                    const wobble = (Number(latestLogin.linear_mse) || 0) > 2 ? Math.sin(index) * 8 : 0;
                    return [Math.round(x), Math.max(12, Math.round(baseY + wobble))];
                })
                : [];

            res.json({
                summary: {
                    totalAttempts: total,
                    captchaPassRate,
                    mouseAnomalies,
                    blocked,
                },
                captchaTypes,
                captchaLevels,
                riskTrend,
                recentRows,
                mousePoints,
                latestMetrics: {
                    trajectoryPoints: Number(latestLogin.trajectory_points) || 0,
                    linearMse: latestLogin.linear_mse === null || latestLogin.linear_mse === undefined
                        ? null
                        : Number(latestLogin.linear_mse),
                    clickHoldStd: latestLogin.click_hold_std === null || latestLogin.click_hold_std === undefined
                        ? null
                        : Number(latestLogin.click_hold_std),
                    botScore: Number(latestLogin.bot_score) || 0,
                },
            });
        } catch (error) {
            console.error("dashboard security api error:", error);
            res.status(500).json({ message: "대시보드 데이터를 불러오지 못했습니다." });
        }
    });

    return router;
};
