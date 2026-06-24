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

const analyzeBotBehavior = (metrics) => {
    let botScore = 0;

    const traj = metrics.mouseTrajectory || [];

    if (traj.length < 5) {
        botScore += 60;
    } else {
        const xCoords = traj.map(pt => pt.x);
        const yCoords = traj.map(pt => pt.y);
        const xStdDev = calculateStdDev(xCoords);

        if (xStdDev === 0) {
            botScore += 60;
        } else {
            const { slope, intercept } = calculateLinearRegression(xCoords, yCoords);

            let squaredErrorsSum = 0;
            for (let i = 0; i < traj.length; i++) {
                const predictedY = slope * xCoords[i] + intercept;
                squaredErrorsSum += Math.pow(yCoords[i] - predictedY, 2);
            }
            const mse = squaredErrorsSum / traj.length;

            if (mse < 2.0) {
                botScore += 60;
            }
        }
    }

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
        }
    } else {
        botScore += 20;
    }

    return botScore >= 60;
};

module.exports = (db) => {
    const router = express.Router();

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
                        return res.status(401).json({
                            success: false,
                            isBot: false,
                            message: "인증에 실패했습니다."
                        });
                    }

                    const isBot = analyzeBotBehavior(payload.behaviorMetrics || {});

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

    return router;
};
