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

const escapeXml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const excelCell = (value) => {
    if (value === null || value === undefined || value === "") {
        return "<Cell><Data ss:Type=\"String\"></Data></Cell>";
    }

    if (typeof value === "object") {
        return `<Cell><Data ss:Type="String">${escapeXml(JSON.stringify(value))}</Data></Cell>`;
    }

    const number = Number(value);
    if (typeof value !== "string" && Number.isFinite(number)) {
        return `<Cell><Data ss:Type="Number">${number}</Data></Cell>`;
    }

    return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
};

const excelRow = (cells) => `<Row>${cells.map(excelCell).join("")}</Row>`;

const excelSheet = (name, rows) => `
    <Worksheet ss:Name="${escapeXml(name).slice(0, 31)}">
        <Table>${rows.map(excelRow).join("")}</Table>
    </Worksheet>`;

const createSecurityEventsExcel = (sheets) => `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Styles>
        <Style ss:ID="Default" ss:Name="Normal">
            <Alignment ss:Vertical="Center"/>
            <Font ss:FontName="Arial" ss:Size="10"/>
        </Style>
    </Styles>
    ${sheets.map((sheet) => excelSheet(sheet.name, sheet.rows)).join("")}
</Workbook>`;

const formatSheetDate = (createdAt) => {
    const date = new Date(Number(createdAt));
    if (Number.isNaN(date.getTime())) return "날짜없음";

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

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

const toFiniteNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const average = (items) => {
    const numbers = items
        .map(toFiniteNumber)
        .filter((value) => value !== null);

    if (numbers.length === 0) return null;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

const parseJsonArray = (rawValue) => {
    if (!rawValue) return [];
    try {
        const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
};

const hasMatchedBehaviorFlag = (event) =>
    parseJsonArray(event.analysis_details).some((item) => item && item.matched === true);

const createBehaviorDetail = ({ id, label, value, matched, result, detail }) => ({
    id,
    label,
    value,
    matched,
    result,
    detail,
});

const summarizeBehaviorFlags = (details) => {
    const matched = details.filter((item) => item.matched);
    if (matched.length === 0) return "정상";
    return matched.map((item) => item.label).join(", ");
};

const analyzeBehaviorFlags = (metrics) => {
    const traj = Array.isArray(metrics.mouseTrajectory) ? metrics.mouseTrajectory : [];
    const clicks = Array.isArray(metrics.clickData) ? metrics.clickData : [];
    const details = [];
    let linearMse = null;
    let speedCv = null;
    let straightness = null;

    const trajectoryTooShort = traj.length < 10;

    let totalDistance = 0;
    const speeds = [];
    if (traj.length >= 2) {
        for (let i = 1; i < traj.length; i++) {
            const distance = getDistance(traj[i - 1], traj[i]);
            const dt = Math.max(Number(traj[i].t) - Number(traj[i - 1].t), 1);
            totalDistance += distance;
            speeds.push(distance / dt);
        }

        const baseline = Math.max(getDistance(traj[0], traj[traj.length - 1]), 1);
        straightness = totalDistance > 0 ? getDistance(traj[0], traj[traj.length - 1]) / totalDistance : 0;

        let squaredDeviationSum = 0;
        for (let i = 0; i < traj.length; i++) {
            const deviation = getPointToLineDistance(traj[i], traj[0], traj[traj.length - 1]);
            squaredDeviationSum += Math.pow(deviation, 2);
        }

        const rmsDeviation = Math.sqrt(squaredDeviationSum / traj.length);
        linearMse = Number.isFinite((rmsDeviation / baseline) * 100)
            ? (rmsDeviation / baseline) * 100
            : null;

        const meanSpeed = speeds.length > 0 ? calculateMean(speeds) : 0;
        const speedStdDev = calculateStdDev(speeds);
        speedCv = meanSpeed > 0 ? speedStdDev / meanSpeed : null;
    }

    const tooStraight = !trajectoryTooShort
        && linearMse !== null
        && linearMse < 1.2
        && straightness > 0.985
        && totalDistance > 100;

    const speedTooConstant = !trajectoryTooShort
        && speedCv !== null
        && speedCv < 0.15
        && speeds.length >= 10;

    const holdTimes = [];
    for (let i = 0; i < clicks.length - 1; i++) {
        const c1 = clicks[i];
        const c2 = clicks[i + 1];
        if (c1.type === "down" && c2.type === "up") {
            holdTimes.push(Number(c2.t) - Number(c1.t));
        }
    }

    const clickHoldStd = holdTimes.length > 0 ? calculateStdDev(holdTimes) : null;
    const clickHoldTooConstant = holdTimes.length >= 2
        && clickHoldStd !== null
        && clickHoldStd < 5.0;

    details.push(createBehaviorDetail({
        id: "trajectory_too_short",
        label: "궤적 10개 미만",
        value: `${traj.length}개`,
        matched: trajectoryTooShort,
        result: trajectoryTooShort ? "해당" : "해당 없음",
        detail: "수집된 마우스 궤적 좌표가 10개 미만인지 확인합니다.",
    }));

    details.push(createBehaviorDetail({
        id: "too_straight",
        label: "시작점-끝점 기준 직선 이동",
        value: linearMse === null || straightness === null
            ? "-"
            : `편차 ${formatMetric(linearMse)}%, 직선성 ${formatMetric(straightness)}`,
        matched: tooStraight,
        result: tooStraight ? "해당" : trajectoryTooShort ? "검사 생략" : "해당 없음",
        detail: "시작점과 끝점을 잇는 기준선에서 거의 벗어나지 않고 총 이동거리 대비 직선성이 높은지 확인합니다.",
    }));

    details.push(createBehaviorDetail({
        id: "speed_too_constant",
        label: "속도 변화율 일정",
        value: speedCv === null ? "-" : `CV ${formatMetric(speedCv)}`,
        matched: speedTooConstant,
        result: speedTooConstant ? "해당" : trajectoryTooShort ? "검사 생략" : "해당 없음",
        detail: "연속 좌표 사이의 속도 변화율이 지나치게 일정한지 확인합니다.",
    }));

    details.push(createBehaviorDetail({
        id: "click_hold_too_constant",
        label: "클릭 유지 시간 일정",
        value: clickHoldStd === null ? "클릭쌍 없음" : `${formatMetric(clickHoldStd, 1)}ms`,
        matched: clickHoldTooConstant,
        result: clickHoldTooConstant ? "해당" : holdTimes.length < 2 ? "검사 불가" : "해당 없음",
        detail: "여러 클릭의 down/up 유지 시간이 지나치게 일정한지 확인합니다.",
    }));

    console.log(`[Behavior Flags] trajectory: ${traj.length}, click pairs: ${holdTimes.length}, matched: ${details.filter((item) => item.matched).length}`);

    return {
        matchedCount: details.filter((item) => item.matched).length,
        mouseReason: summarizeBehaviorFlags(details),
        trajectoryPoints: traj.length,
        linearMse,
        clickHoldStd,
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
                captcha_name VARCHAR(255),
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

            db.query(
                "ALTER TABLE security_events ADD COLUMN captcha_name VARCHAR(255) AFTER captcha_type",
                (alterErr) => {
                    if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                        console.error("security_events captcha_name migration error:", alterErr);
                    }
                }
            );
        });
    };

    ensureSecurityEventsTable();

    const recordSecurityEvent = (event) => {
        const sql = `
            INSERT INTO security_events (
                phase, userid, captcha_type, captcha_name, captcha_level, captcha_result,
                mouse_result, bot_score, trajectory_points, linear_mse,
                click_hold_std, click_pairs, trajectory_sample, analysis_details, click_time, badtime, result,
                message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            event.phase,
            event.userid || null,
            event.captchaType || null,
            event.captchaName || null,
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

    const getCaptchaResultLabel = (result) => {
        if (result === "success") return "성공";
        if (result === "too_fast") return "너무 빠름";
        if (result === "timeout") return "시간 초과";
        if (result === "d_stage_unlocked") return "Level 2 전환";
        if (result === "aborted") return "중단";
        if (result === "fail") return "실패";
        return result || "-";
    };

    const emptyBehaviorInfo = {
        behaviorMatches: null,
        behaviorDetails: [],
        behaviorLabel: "-",
        hasBehaviorData: false,
    };

    const getBehaviorInfo = (event) => {
        const analysisDetails = parseJsonArray(event?.analysis_details);
        const behaviorMatches = analysisDetails.filter((item) => item.matched === true).length;

        return {
            behaviorMatches,
            behaviorDetails: analysisDetails,
            behaviorLabel: `${behaviorMatches}/4`,
            hasBehaviorData: analysisDetails.length > 0,
        };
    };

    const formatCaptchaSolvingRow = (event, behaviorInfo = emptyBehaviorInfo) => {
        const clickTime = toFiniteNumber(event.click_time);
        const targetTime = toFiniteNumber(event.badtime);
        const errorSeconds = clickTime !== null && targetTime !== null
            ? Math.abs(clickTime - targetTime)
            : null;

        return {
            id: `EV-${event.id}`,
            user: event.userid || "-",
            type: event.captcha_type || "-",
            name: event.captcha_name || "-",
            level: event.captcha_level || (event.captcha_type ? getCaptchaLevel(event.captcha_type) : "-"),
            result: event.captcha_result || "-",
            resultLabel: getCaptchaResultLabel(event.captcha_result),
            clickTime,
            targetTime,
            errorSeconds,
            behaviorMatches: behaviorInfo.behaviorMatches,
            behaviorDetails: behaviorInfo.behaviorDetails,
            behaviorLabel: behaviorInfo.behaviorLabel,
            hasBehaviorData: behaviorInfo.hasBehaviorData,
            time: formatTime(event.created_at),
            phase: "captcha",
        };
    };

    const formatSecurityEventRow = (event) => {
        const analysisDetails = parseJsonArray(event.analysis_details);
        const clickTime = toFiniteNumber(event.click_time);
        const targetTime = toFiniteNumber(event.badtime);
        const errorSeconds = clickTime !== null && targetTime !== null
            ? Math.abs(clickTime - targetTime)
            : null;

        return {
            id: `EV-${event.id}`,
            rawId: event.id,
            phase: event.phase,
            phaseLabel: event.phase === "captcha" ? "문제풀이" : "로그인",
            user: event.userid || "-",
            captcha: event.captcha_type || "-",
            captchaName: event.captcha_name || "-",
            captchaLevel: event.captcha_type ? getCaptchaLevel(event.captcha_type) : "-",
            captchaResult: event.captcha_result || "-",
            captchaResultLabel: getCaptchaResultLabel(event.captcha_result),
            mouse: event.mouse_result || (event.phase === "captcha" ? "CAPTCHA 판정" : "-"),
            behaviorMatches: analysisDetails.filter((item) => item.matched === true).length,
            behaviorDetails: analysisDetails,
            clickTime,
            targetTime,
            errorSeconds,
            result: getStatusLabel(event),
            rawResult: event.result,
            message: event.message || "-",
            time: formatTime(event.created_at),
        };
    };

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
                    const behaviorAnalysis = analyzeBehaviorFlags(payload.behaviorMetrics || {});
                    const trajectorySample = sampleTrajectory(payload.behaviorMetrics?.mouseTrajectory);

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
            const mouseAnomalies = loginEvents.filter(hasMatchedBehaviorFlag).length;
            const blocked = events.filter((event) => event.result === "blocked").length;

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

            const timedCaptchaEvents = captchaEvents.filter((event) => toFiniteNumber(event.click_time) !== null);
            const captchaErrors = timedCaptchaEvents
                .map((event) => {
                    const clickTime = toFiniteNumber(event.click_time);
                    const targetTime = toFiniteNumber(event.badtime);
                    return clickTime !== null && targetTime !== null
                        ? Math.abs(clickTime - targetTime)
                        : null;
                })
                .filter((value) => value !== null);
            const captchaResultCounts = captchaEvents.reduce((counts, event) => {
                const key = event.captcha_result || "unknown";
                counts[key] = (counts[key] || 0) + 1;
                return counts;
            }, {});

            const findLinkedLoginBehavior = (captchaEvent) => {
                if (!captchaEvent.userid) return emptyBehaviorInfo;

                const captchaCreatedAt = Number(captchaEvent.created_at) || 0;
                const matchedLogin = loginEvents
                    .filter((event) => (
                        event.userid === captchaEvent.userid
                        && Number(event.created_at) >= captchaCreatedAt
                    ))
                    .sort((a, b) => Number(a.created_at) - Number(b.created_at))[0];

                return matchedLogin ? getBehaviorInfo(matchedLogin) : emptyBehaviorInfo;
            };

            const captchaEventsWithBehavior = captchaEvents.map((event) => ({
                ...event,
                behaviorInfo: findLinkedLoginBehavior(event),
            }));

            const captchaProblemStats = Object.values(captchaEventsWithBehavior.reduce((groups, event) => {
                const name = event.captcha_name || "-";
                const clickTime = toFiniteNumber(event.click_time);
                const targetTime = toFiniteNumber(event.badtime);
                const errorSeconds = clickTime !== null && targetTime !== null
                    ? Math.abs(clickTime - targetTime)
                    : null;

                if (!groups[name]) {
                    groups[name] = {
                        name,
                        type: event.captcha_type || "-",
                        level: event.captcha_level || (event.captcha_type ? getCaptchaLevel(event.captcha_type) : "-"),
                        total: 0,
                        success: 0,
                        fail: 0,
                        solveTimes: [],
                        errors: [],
                        behaviorDataCount: 0,
                        behaviorWarnings: 0,
                        behaviorMatches: [],
                    };
                }

                groups[name].total += 1;
                if (event.captcha_result === "success") {
                    groups[name].success += 1;
                } else {
                    groups[name].fail += 1;
                }
                if (clickTime !== null) groups[name].solveTimes.push(clickTime);
                if (errorSeconds !== null) groups[name].errors.push(errorSeconds);
                if (event.behaviorInfo?.hasBehaviorData) {
                    groups[name].behaviorDataCount += 1;
                    groups[name].behaviorMatches.push(event.behaviorInfo.behaviorMatches);
                    if (event.behaviorInfo.behaviorMatches > 0) {
                        groups[name].behaviorWarnings += 1;
                    }
                }

                return groups;
            }, {}))
                .map((item) => ({
                    name: item.name,
                    type: item.type,
                    level: item.level,
                    total: item.total,
                    success: item.success,
                    fail: item.fail,
                    successRate: item.total > 0 ? Math.round((item.success / item.total) * 1000) / 10 : 0,
                    avgSolveTime: average(item.solveTimes),
                    avgErrorSeconds: average(item.errors),
                    behaviorDataCount: item.behaviorDataCount,
                    behaviorWarnings: item.behaviorWarnings,
                    behaviorWarningRate: item.behaviorDataCount > 0 ? Math.round((item.behaviorWarnings / item.behaviorDataCount) * 1000) / 10 : null,
                    avgBehaviorMatches: average(item.behaviorMatches),
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 8);
            const latestCaptchaRows = captchaEventsWithBehavior.slice(0, 8)
                .map((event) => formatCaptchaSolvingRow(event, event.behaviorInfo));

            const recentLogins = loginEvents.slice(0, 12);
            const riskTrend = [...recentLogins]
                .reverse()
                .map((event) => parseJsonArray(event.analysis_details).filter((item) => item.matched === true).length);

            while (riskTrend.length < 12) {
                riskTrend.unshift(0);
            }

            const latestLogin = loginEvents[0] || {};
            const latestAnomalyLogin = loginEvents.find(hasMatchedBehaviorFlag) || {};
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
                captchaSolving: {
                    total: captchaEvents.length,
                    success: captchaResultCounts.success || 0,
                    fail: captchaEvents.filter((event) => event.captcha_result && event.captcha_result !== "success").length,
                    avgSolveTime: average(timedCaptchaEvents.map((event) => event.click_time)),
                    avgTargetTime: average(timedCaptchaEvents.map((event) => event.badtime)),
                    avgErrorSeconds: average(captchaErrors),
                    resultCounts: captchaResultCounts,
                    problemStats: captchaProblemStats,
                    recentRows: latestCaptchaRows,
                },
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
                    analysisDetails: parseJsonArray(latestLogin.analysis_details),
                },
            });
        } catch (error) {
            console.error("dashboard security api error:", error);
            res.status(500).json({ message: "대시보드 데이터를 불러오지 못했습니다." });
        }
    });

    router.get("/api/dashboard/security/export", async (req, res) => {
        try {
            const columns = await query("SHOW COLUMNS FROM security_events");
            const events = await query(
                `SELECT * FROM security_events
                 ORDER BY created_at DESC`
            );
            const columnNames = columns.map((column) => column.Field);
            const groupedByDate = events.reduce((groups, event) => {
                const sheetDate = formatSheetDate(event.created_at);
                if (!groups[sheetDate]) groups[sheetDate] = [];
                groups[sheetDate].push(event);
                return groups;
            }, {});

            const sheets = Object.keys(groupedByDate)
                .sort((a, b) => b.localeCompare(a))
                .map((sheetDate) => ({
                    name: sheetDate,
                    rows: [
                        columnNames,
                        ...groupedByDate[sheetDate].map((event) => (
                            columnNames.map((columnName) => event[columnName])
                        )),
                    ],
                }));

            const workbook = createSecurityEventsExcel(
                sheets.length > 0 ? sheets : [{ name: "데이터 없음", rows: [columnNames] }]
            );
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

            res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="security-dashboard-${timestamp}.xls"`);
            return res.send(workbook);
        } catch (error) {
            console.error("dashboard export api error:", error);
            return res.status(500).json({ message: "엑셀 파일을 생성하지 못했습니다." });
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
