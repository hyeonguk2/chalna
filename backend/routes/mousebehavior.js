const express = require('express');
const crypto = require('crypto');
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const LOCKOUT_DURATIONS_MS = [
    3 * 60 * 1000,
    10 * 60 * 1000,
    30 * 60 * 1000,
];
const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60;
const LOGIN_RATE_LIMIT_MAX = 8;
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
const getCaptchaPassKey = (token) => `captcha_pass:${token}`;
const getLoginRateLimitKey = (ip, userid) => `rl:login:${ip}:${userid}`;

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
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
};

const getLockoutDuration = (lockoutCount) =>
    LOCKOUT_DURATIONS_MS[Math.min(Math.max(lockoutCount, 1), LOCKOUT_DURATIONS_MS.length) - 1];

const consumeCaptchaPass = (db, userid, token) =>
    new Promise((resolve, reject) => {
        if (!token) {
            resolve(false);
            return;
        }

        getRedisClient().then((client) =>
            client.get(getCaptchaPassKey(token))
                .then((raw) => {
                    if (!raw) {
                        resolve(false);
                        return client.del(getCaptchaPassKey(token));
                    }

                    let parsed;
                    try {
                        parsed = JSON.parse(raw);
                    } catch (parseErr) {
                        reject(parseErr);
                        return;
                    }

                    if (!parsed || parsed.userId !== userid) {
                        resolve(false);
                        return client.del(getCaptchaPassKey(token));
                    }

                    return client.del(getCaptchaPassKey(token)).then(() => resolve(true));
                })
                .catch(reject)
        ).catch(reject);
    });

const recordRateLimit = async (key, limit, windowSeconds) => {
    const client = await getRedisClient();
    const count = await client.incr(key);
    if (count === 1) {
        await client.expire(key, windowSeconds);
    }
    return count <= limit;
};

const calculateMean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

const calculateStdDev = (arr) => {
    if (arr.length <= 1) return 0;
    const mean = calculateMean(arr);
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
};

const getDistance = (a, b) => {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    return Math.sqrt(dx * dx + dy * dy);
};

const getPointToLineDistance = (point, lineStart, lineEnd) => {
    const x0 = Number(point.x);
    const y0 = Number(point.y);
    const x1 = Number(lineStart.x);
    const y1 = Number(lineStart.y);
    const x2 = Number(lineEnd.x);
    const y2 = Number(lineEnd.y);

    const numerator = Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1);
    const denominator = Math.max(Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2)), 1);

    return numerator / denominator;
};

const formatMetric = (value, digits = 2) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
    return Number(value).toFixed(digits);
};

// ==========================================
// 2. 인지적 직관 기반 봇 판별 알고리즘
// ==========================================
const analyzeBotBehavior = (metrics) => {
    let botScore = 0;
    let linearMse = null;
    let mouseReason = "정상 흔들림";
    const details = [];

    // --- [1] 마우스 궤적 분석 ---
    const traj = metrics.mouseTrajectory || [];

    if (traj.length === 0) {
        botScore += 35;
        mouseReason = "궤적 없음";
        details.push({
            label: "움직임 데이터",
            value: "0개",
            result: "없음",
            score: 35,
            detail: "마우스 좌표가 전혀 없으면 API 자동 호출 가능성을 의심합니다.",
        });
    } else if (traj.length < 10) {
        botScore += 20;
        mouseReason = "궤적 부족";
        details.push({
            label: "움직임 데이터",
            value: `${traj.length}개`,
            result: "부족",
            score: 20,
            detail: "좌표가 10개 미만이면 분석 신뢰도가 낮아 위험 점수를 일부 더합니다.",
        });
    } else {
        const xCoords = traj.map(pt => pt.x);
        const yCoords = traj.map(pt => pt.y);
        const xStdDev = calculateStdDev(xCoords);
        const yStdDev = calculateStdDev(yCoords);

        if (xStdDev === 0 && yStdDev === 0) {
            botScore += 35;
            mouseReason = "수직 고정 궤적";
            details.push({
                label: "움직임 데이터",
                value: `${traj.length}개`,
                result: "좌표 고정",
                score: 35,
                detail: "좌표 개수는 있지만 위치 변화가 없으면 실제 마우스 이동으로 보기 어렵습니다.",
            });
        } else {
            let totalDistance = 0;
            const speeds = [];
            for (let i = 1; i < traj.length; i++) {
                const distance = getDistance(traj[i - 1], traj[i]);
                const dt = Math.max(Number(traj[i].t) - Number(traj[i - 1].t), 1);
                totalDistance += distance;
                speeds.push(distance / dt);
            }

            const directDistance = getDistance(traj[0], traj[traj.length - 1]);
            const straightness = totalDistance > 0 ? directDistance / totalDistance : 0;
            const meanSpeed = speeds.length > 0 ? calculateMean(speeds) : 0;
            const speedStdDev = calculateStdDev(speeds);
            const speedCv = meanSpeed > 0 ? speedStdDev / meanSpeed : null;

            details.push({
                label: "움직임 데이터",
                value: `${traj.length}개`,
                result: "충분",
                score: 0,
                detail: "좌표 수가 충분해서 경로 형태와 속도 패턴을 분석했습니다.",
            });

            const baseline = Math.max(getDistance(traj[0], traj[traj.length - 1]), 1);
            let squaredDeviationSum = 0;
            for (let i = 0; i < traj.length; i++) {
                const deviation = getPointToLineDistance(traj[i], traj[0], traj[traj.length - 1]);
                squaredDeviationSum += Math.pow(deviation, 2);
            }
            const rmsDeviation = Math.sqrt(squaredDeviationSum / traj.length);
            linearMse = Number.isFinite((rmsDeviation / baseline) * 100)
                ? (rmsDeviation / baseline) * 100
                : null;

            if (linearMse !== null && linearMse < 1.2 && straightness > 0.985 && totalDistance > 100) {
                botScore += 35;
                mouseReason = "직선 이동";
                details.push({
                    label: "이동 경로",
                    value: `편차 ${formatMetric(linearMse)}%, 직선도 ${formatMetric(straightness)}`,
                    result: "너무 직선적",
                    score: 35,
                    detail: "시작점-끝점 기준 편차가 작고 총 이동거리 대비 직선성이 너무 높으면 자동 생성 경로로 의심합니다.",
                });
            } else {
                details.push({
                    label: "이동 경로",
                    value: `편차 ${formatMetric(linearMse)}%, 직선도 ${formatMetric(straightness)}`,
                    result: "자연스러움",
                    score: 0,
                    detail: "시작점-끝점 기준 편차가 충분하고 전체 이동도 완전히 직선적이지 않습니다.",
                });
            }

            if (speedCv !== null && speedCv < 0.15 && speeds.length >= 10) {
                botScore += 20;
                mouseReason = mouseReason === "정상 흔들림" ? "속도 일정" : `${mouseReason}, 속도 일정`;
                details.push({
                    label: "속도 변화",
                    value: `CV ${formatMetric(speedCv)}`,
                    result: "너무 일정",
                    score: 20,
                    detail: "마우스 속도 변화율이 지나치게 낮으면 사람이 움직인 패턴으로 보기 어렵습니다.",
                });
            } else {
                details.push({
                    label: "속도 변화",
                    value: speedCv === null ? "-" : `CV ${formatMetric(speedCv)}`,
                    result: "정상 변동",
                    score: 0,
                    detail: "속도가 충분히 변해 사람이 움직인 패턴에 가깝습니다.",
                });
            }
        }
    }

    // --- [2] 클릭 타이밍 분포 분석 ---
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
        if (holdTimes.length >= 2 && stdDev < 5.0) {
            botScore += 25;
            mouseReason = mouseReason === "정상 흔들림" ? "클릭 간격 일정" : `${mouseReason}, 클릭 일정`;
            details.push({
                label: "클릭 패턴",
                value: `${formatMetric(stdDev, 1)}ms`,
                result: "반복 의심",
                score: 25,
                detail: "여러 클릭의 누름 시간이 거의 같으면 자동 클릭 가능성을 의심합니다.",
            });
        } else {
            details.push({
                label: "클릭 패턴",
                value: `${formatMetric(stdDev, 1)}ms`,
                result: "정상 편차",
                score: 0,
                detail: "클릭 유지 시간 편차가 위험 기준보다 큽니다.",
            });
        }
    } else {
        botScore += 10;
        details.push({
            label: "클릭 패턴",
            value: "클릭쌍 없음",
            result: "근거 부족",
            score: 10,
            detail: "클릭 down/up 쌍이 없어서 낮은 위험 점수만 더합니다.",
        });
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
        details,
    };
};

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
                trajectory_sample JSON,
                analysis_details JSON,
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

            db.query(
                "ALTER TABLE security_events ADD COLUMN trajectory_sample JSON AFTER click_pairs",
                (alterErr) => {
                    if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                        console.error("security_events trajectory_sample migration error:", alterErr);
                    }
                }
            );

            db.query(
                "ALTER TABLE security_events ADD COLUMN analysis_details JSON AFTER trajectory_sample",
                (alterErr) => {
                    if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                        console.error("security_events analysis_details migration error:", alterErr);
                    }
                }
            );
        });
    };

    ensureSecurityEventsTable();

    const recordSecurityEvent = (event) => {
        const sql = `
            INSERT INTO security_events (
                phase, userid, captcha_type, captcha_level, captcha_result,
                mouse_result, bot_score, trajectory_points, linear_mse,
                click_hold_std, click_pairs, trajectory_sample, analysis_details, click_time, badtime, result,
                message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            event.trajectorySample ? JSON.stringify(event.trajectorySample) : null,
            event.analysisDetails ? JSON.stringify(event.analysisDetails) : null,
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

    const sampleTrajectory = (trajectory = [], maxPoints = 80) => {
        if (!Array.isArray(trajectory) || trajectory.length === 0) return [];

        const step = Math.max(1, Math.ceil(trajectory.length / maxPoints));
        return trajectory
            .filter((_, index) => index % step === 0)
            .slice(0, maxPoints)
            .map((point) => ({
                x: Number(point.x) || 0,
                y: Number(point.y) || 0,
                t: Number(point.t) || 0,
            }));
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

    const formatSecurityEventRow = (event) => ({
        id: `EV-${event.id}`,
        user: event.userid || "-",
        captcha: event.captcha_type || "-",
        captchaLevel: event.captcha_type ? getCaptchaLevel(event.captcha_type) : "-",
        mouse: event.mouse_result || (event.phase === "captcha" ? "CAPTCHA 판정" : "-"),
        botScore: Number(event.bot_score) || 0,
        result: getStatusLabel(event),
        time: formatTime(event.created_at),
    });

    router.post("/api/login-precheck", async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ valid: false, message: "Username and password are required." });
        }

        const rateLimitAllowed = await recordRateLimit(
            getLoginRateLimitKey(req.ip, `precheck:${username}`),
            LOGIN_RATE_LIMIT_MAX,
            LOGIN_RATE_LIMIT_WINDOW_SECONDS
        ).catch(() => false);

        if (!rateLimitAllowed) {
            return res.status(429).json({ valid: false, message: "Too many requests. Please try again shortly." });
        }

        db.query(
            "SELECT userid, password, login_attempts, lockout_time, lockout_count FROM users WHERE userid = ?",
            [username],
            async (err, rows) => {
                if (err) {
                    console.error("Login precheck query error:", err);
                    return res.status(500).json({ valid: false, message: "Unable to verify credentials." });
                }

                const user = rows[0];
                let passwordMatches = false;

                try {
                    passwordMatches = user && (
                        user.password.startsWith("$2")
                            ? await bcrypt.compare(password, user.password)
                            : password === user.password
                    );
                } catch (passwordError) {
                    console.error("Login precheck password error:", passwordError);
                    return res.status(500).json({ valid: false, message: "Unable to verify credentials." });
                }

                if (!passwordMatches) {
                    return res.status(401).json({ valid: false, message: "Invalid username or password." });
                }

                if (Number(user.login_attempts || 0) >= 2 && Number(user.lockout_time || 0) > 0) {
                    const lockoutDuration = getLockoutDuration(Math.max(1, Number(user.lockout_count || 1)));
                    const remainingMs = lockoutDuration - (Date.now() - Number(user.lockout_time));

                    if (remainingMs > 0) {
                        return res.json({
                            valid: false,
                            locked: true,
                            remainingSec: Math.ceil(remainingMs / 1000),
                            message: `Login is temporarily locked. Try again in ${Math.ceil(remainingMs / 1000)} seconds.`
                        });
                    }
                }

                return res.json({ valid: true });
            }
        );
    });

    router.post("/api/login", async (req, res) => {
        try {
            const payload = req.body;

            const rateLimitAllowed = await recordRateLimit(
                getLoginRateLimitKey(req.ip, payload.username || "unknown"),
                LOGIN_RATE_LIMIT_MAX,
                LOGIN_RATE_LIMIT_WINDOW_SECONDS
            ).catch(() => false);

            if (!rateLimitAllowed) {
                return res.status(429).json({
                    success: false,
                    isBot: false,
                    reason: "too_many_requests",
                    message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요."
                });
            }

            if (!payload.username || !payload.password) {
                return res.status(400).json({ success: false, isBot: false, message: "인증에 실패했습니다." });
            }
            const checkLockoutSql = "SELECT login_attempts, lockout_time, lockout_count FROM users WHERE userid = ?";
            db.query(checkLockoutSql, [payload.username], (lockErr, userRows) => {
                if (lockErr) {
                    console.error("Lockout Check Error:", lockErr);
                    return res.status(500).json({ success: false, message: "인증에 실패했습니다." });
                }

                if (userRows.length > 0) {
                    const user = userRows[0];
                    if (user.login_attempts >= 2 && user.lockout_time > 0) {
                        const lockoutCount = Math.max(1, Number(user.lockout_count || 1));
                        const lockoutDuration = getLockoutDuration(lockoutCount);
                        const passedTime = Date.now() - Number(user.lockout_time);

                        if (passedTime < lockoutDuration) {
                            const remainingSec = Math.ceil((lockoutDuration - passedTime) / 1000);
                            return res.json({
                                success: false,
                                isBot: false,
                                reason: "locked",
                                message: `잠시 후 다시 시도하세요. (${remainingSec}초)`
                            });
                        } else {

                            db.query("UPDATE users SET login_attempts = 0, captcha_level = 1, lockout_time = 0 WHERE userid = ?", [payload.username]);
                        }
                    }
                }

                const sql = "SELECT * FROM users WHERE userid = ?";
                db.query(sql, [payload.username], async (err, results) => {
                    if (err) {
                        console.error("DB Query Error:", err);
                        return res.status(500).json({ success: false, message: "인증에 실패했습니다." });
                    }

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
                        return res.status(500).json({ success: false, message: "인증에 실패했습니다." });
                    }

                    if (!passwordMatches) {

                        db.query("SELECT login_attempts FROM users WHERE userid = ?", [payload.username], (selErr, rows) => {
                            const currentAttempts = Math.max(0, Number(rows[0]?.login_attempts || 0));
                            const nextAttempts = currentAttempts + 1;
                            const now = nextAttempts >= 2 ? Date.now() : 0;
                            const lockoutIncrement = currentAttempts < 2 && nextAttempts >= 2 ? 1 : 0;

                            db.query(
                                "UPDATE users SET login_attempts = ?, captcha_level = 1, lockout_time = ?, lockout_count = COALESCE(lockout_count, 0) + ? WHERE userid = ?",
                                [nextAttempts, now, lockoutIncrement, payload.username]
                            );
                        });

                        recordSecurityEvent({
                            phase: "login",
                            userid: payload.username,
                            captchaResult: "unknown",
                            result: "fail",
                            message: "아이디 또는 비밀번호 불일치",
                        });

                        return res.status(401).json({ success: false, isBot: false, message: "인증에 실패했습니다." });
                    }

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
                    let captchaPassed = false;
                    try {
                        captchaPassed = await consumeCaptchaPass(db, payload.username, payload.captchaToken);
                    } catch (captchaPassError) {
                        console.error("Captcha pass validation error:", captchaPassError);
                        return res.status(500).json({ success: false, message: "인증에 실패했습니다." });
                    }

                    if (!captchaPassed) {
                        recordSecurityEvent({
                            phase: "login",
                            userid: payload.username,
                            captchaResult: "missing",
                            result: "fail",
                            message: "CAPTCHA 미완료",
                        });

                        return res.status(401).json({
                            success: false,
                            isBot: false,
                            message: "인증에 실패했습니다."
                        });
                    }
                    const behaviorAnalysis = analyzeBotBehavior(payload.behaviorMetrics || {});
                    const isBot = behaviorAnalysis.isBot;
                    const trajectorySample = sampleTrajectory(payload.behaviorMetrics?.mouseTrajectory);

                    if (isBot) {
                        db.query("SELECT login_attempts FROM users WHERE userid = ?", [payload.username], (selErr, rows) => {
                            const currentAttempts = Math.max(0, Number(rows[0]?.login_attempts || 0));
                            const nextAttempts = currentAttempts + 1;
                            const now = nextAttempts >= 2 ? Date.now() : 0;
                            const lockoutIncrement = currentAttempts < 2 && nextAttempts >= 2 ? 1 : 0;

                            db.query(
                                "UPDATE users SET login_attempts = ?, captcha_level = 1, lockout_time = ?, lockout_count = COALESCE(lockout_count, 0) + ? WHERE userid = ?",
                                [nextAttempts, now, lockoutIncrement, payload.username]
                            );
                        });

                        recordSecurityEvent({
                            phase: "login",
                            userid: payload.username,
                            captchaResult: "success",
                            mouseResult: behaviorAnalysis.mouseReason,
                            botScore: behaviorAnalysis.botScore,
                            trajectoryPoints: behaviorAnalysis.trajectoryPoints,
                            linearMse: behaviorAnalysis.linearMse,
                            clickHoldStd: behaviorAnalysis.clickHoldStd,
                            clickPairs: behaviorAnalysis.clickPairs,
                            trajectorySample,
                            analysisDetails: behaviorAnalysis.details,
                            result: "bot",
                            message: "비정상 패턴 감지",
                        });

                        return res.json({ success: true, isBot: true, message: "인증에 실패했습니다." });
                    }

                    let sessionToken;
                    try {
                        const existingSession = await getSession(req);
                        if (existingSession?.token) {
                            const client = await getRedisClient();
                            await client.del(getSessionKey(existingSession.token));
                        }
                        sessionToken = await createSession(user);
                        setSessionCookie(res, sessionToken);
                    } catch (error) {
                        console.error("Session create error:", error);
                        return res.status(500).json({ success: false, message: "인증에 실패했습니다." });
                    }

                    db.query("UPDATE users SET login_attempts = 0, captcha_level = 1, lockout_time = 0, lockout_count = 0, captchatype = NULL WHERE userid = ?", [payload.username]);

                    recordSecurityEvent({
                        phase: "login",
                        userid: payload.username,
                        captchaResult: "success",
                        mouseResult: behaviorAnalysis.mouseReason,
                        botScore: behaviorAnalysis.botScore,
                        trajectoryPoints: behaviorAnalysis.trajectoryPoints,
                        linearMse: behaviorAnalysis.linearMse,
                        clickHoldStd: behaviorAnalysis.clickHoldStd,
                        clickPairs: behaviorAnalysis.clickPairs,
                        trajectorySample,
                        analysisDetails: behaviorAnalysis.details,
                        result: "success",
                        message: "로그인 및 인증 성공",
                    });

                    return res.json({ success: true, isBot: false, message: "로그인 및 인증 성공" });
                });
            });
        } catch (error) {
            console.error("서버 에러 발생:", error);
            return res.status(500).json({ success: false, message: "인증에 실패했습니다." });
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
            const latestAnomalyLogin = loginEvents.find((event) => Number(event.bot_score) >= 60) || {};
            const recentRows = events.slice(0, 10).map(formatSecurityEventRow);

            const parseTrajectorySample = (rawSample) => {
                if (!rawSample) return [];
                try {
                    const parsed = typeof rawSample === "string" ? JSON.parse(rawSample) : rawSample;
                    return Array.isArray(parsed) ? parsed : [];
                } catch (error) {
                    return [];
                }
            };

            const parseAnalysisDetails = (rawDetails) => {
                if (!rawDetails) return [];
                try {
                    const parsed = typeof rawDetails === "string" ? JSON.parse(rawDetails) : rawDetails;
                    return Array.isArray(parsed) ? parsed : [];
                } catch (error) {
                    return [];
                }
            };

            const anomalyTrajectory = parseTrajectorySample(latestAnomalyLogin.trajectory_sample);

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
                anomalyTrajectory,
                latestMetrics: {
                    trajectoryPoints: Number(latestLogin.trajectory_points) || 0,
                    linearMse: latestLogin.linear_mse === null || latestLogin.linear_mse === undefined
                        ? null
                        : Number(latestLogin.linear_mse),
                    clickHoldStd: latestLogin.click_hold_std === null || latestLogin.click_hold_std === undefined
                        ? null
                        : Number(latestLogin.click_hold_std),
                    botScore: Number(latestLogin.bot_score) || 0,
                    analysisDetails: parseAnalysisDetails(latestLogin.analysis_details),
                },
            });
        } catch (error) {
            console.error("dashboard security api error:", error);
            res.status(500).json({ message: "대시보드 데이터를 불러오지 못했습니다." });
        }
    });

    router.get("/api/dashboard/security/recent", async (req, res) => {
        try {
            const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 7);
            const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 500);
            const since = Date.now() - days * 24 * 60 * 60 * 1000;
            const events = await query(
                `SELECT * FROM security_events
                 WHERE created_at >= ?
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [since, limit]
            );

            res.json({
                days,
                total: events.length,
                recentRows: events.map(formatSecurityEventRow),
            });
        } catch (error) {
            console.error("dashboard recent api error:", error);
            res.status(500).json({ message: "최근 로그인 판정을 불러오지 못했습니다." });
        }
    });

    return router;
};
