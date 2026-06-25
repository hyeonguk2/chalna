const express = require("express");
const mysql = require("mysql2");
const crypto = require("crypto");
const { createClient } = require("redis");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");

const router = express.Router();
const store = {};
const LOCKOUT_DURATIONS_MS = [
    3 * 60 * 1000,
    10 * 60 * 1000,
    30 * 60 * 1000,
];
const CAPTCHA_PASS_TTL_SECONDS = 2 * 60;
const BADTIME_FAST_TOLERANCE_SEC = 0.15;
const D_STAGE_WINDOW_SEC = Number(process.env.D_STAGE_WINDOW_SEC || 0.5);
const CHALLENGE_TTL_SECONDS = 5 * 60;
const CAPTCHA_START_RATE_LIMIT_WINDOW_SECONDS = 60;
const CAPTCHA_START_RATE_LIMIT_MAX = 20;
const CAPTCHA_VERIFY_RATE_LIMIT_WINDOW_SECONDS = 60;
const CAPTCHA_VERIFY_RATE_LIMIT_MAX = 30;

const getLockoutDuration = (lockoutCount) =>
    LOCKOUT_DURATIONS_MS[Math.min(Math.max(lockoutCount, 1), LOCKOUT_DURATIONS_MS.length) - 1];

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

const getCaptchaPassKey = (token) => `captcha_pass:${token}`;
const getChallengeKey = (token) => `captcha_challenge:${token}`;

const setChallenge = async ({ challengeToken, captchaId, userId }) => {
    const client = await getRedisClient();
    await client.set(
        getChallengeKey(challengeToken),
        JSON.stringify({ captchaId, userId, createdAt: Date.now() }),
        { EX: CHALLENGE_TTL_SECONDS }
    );
};

const consumeChallenge = async (challengeToken) => {
    const client = await getRedisClient();
    const raw = await client.get(getChallengeKey(challengeToken));
    if (!raw) return null;
    await client.del(getChallengeKey(challengeToken));
    return JSON.parse(raw);
};

const storeCaptchaPass = async (userId) => {
    const token = crypto.randomBytes(32).toString("hex");
    const client = await getRedisClient();
    await client.set(
        getCaptchaPassKey(token),
        JSON.stringify({ userId, createdAt: Date.now() }),
        { EX: CAPTCHA_PASS_TTL_SECONDS }
    );
    return token;
};

const recordRateLimit = async (key, limit, windowSeconds) => {
    const client = await getRedisClient();
    const count = await client.incr(key);
    if (count === 1) {
        await client.expire(key, windowSeconds);
    }
    return count <= limit;
};

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error("DB connect error:", err);
        return;
    }

    const createTable = `
        CREATE TABLE IF NOT EXISTS captcha (
            captchaid VARCHAR(100) PRIMARY KEY,
            answer VARCHAR(10),
            badtime DECIMAL(3,1),
            video VARCHAR(100),
            level INT,
            captchatype CHAR(1),
            userid VARCHAR(50),
            created_at BIGINT
        )
    `;

    db.query(createTable, (err) => {
        if (err) {
            console.error("table create error:", err);
            return;
        }

        db.query("ALTER TABLE captcha ADD COLUMN userid VARCHAR(50)", (alterErr) => {
            if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                console.error("captcha userid alter error:", alterErr);
            }
        });

    });

    const createSecurityEventsTable = `
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

    db.query(createSecurityEventsTable, (err) => {
        if (err) {
            console.error("security events table create error:", err);
            return;
        }

        db.query("ALTER TABLE security_events ADD COLUMN trajectory_sample JSON AFTER click_pairs", (alterErr) => {
            if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                console.error("security_events trajectory_sample alter error:", alterErr);
            }
        });

        db.query("ALTER TABLE security_events ADD COLUMN analysis_details JSON AFTER trajectory_sample", (alterErr) => {
            if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                console.error("security_events analysis_details alter error:", alterErr);
            }
        });
    });
});

function recordCaptchaSecurityEvent(event) {
    const sql = `
        INSERT INTO security_events (
            phase, userid, captcha_type, captcha_level, captcha_result,
            mouse_result, bot_score, trajectory_points, linear_mse,
            click_hold_std, click_pairs, trajectory_sample, analysis_details,
            click_time, badtime, result, message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            "captcha",
            event.userId || null,
            event.captchaType || null,
            event.captchaLevel || null,
            event.captchaResult,
            null,
            0,
            0,
            null,
            null,
            0,
            null,
            null,
            event.clickTime ?? null,
            event.badtime ?? null,
            event.result,
            event.message || null,
            Date.now(),
        ],
        (err) => {
            if (err) console.error("captcha security event insert error:", err);
        }
    );
}

function makeAnswer() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let t = "";
    for (let i = 0; i < 5; i++) {
        t += chars[Math.floor(Math.random() * chars.length)];
    }
    return t;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function getCaptchaAssetPath(captchaType, assetName) {
    const assetKind = captchaType === "C" || captchaType === "D" ? "img" : "video";
    const assetExt = assetKind === "img" ? "png" : "mp4";

    return path.join(
        __dirname,
        "..",
        "public",
        "videos",
        "captchatype",
        `captchatype_${captchaType}`,
        assetKind,
        `${assetName}.${assetExt}`
    );
}

function hasAvailableCaptchaAssets(captchaTypeDir, captchaTypeFolder, targetLevel2) {
    const captchaType = captchaTypeFolder.replace("captchatype_", "");
    const metaPath = path.join(captchaTypeDir, captchaTypeFolder, "meta.json");

    if (!fs.existsSync(metaPath)) return false;

    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

        return Object.keys(meta).some((key) => {
            const isActive = meta[key]?.active === true;
            const captchaLevel = Number(meta[key]?.level || 1);
            const matchesLevel = targetLevel2 ? captchaLevel === 2 : captchaLevel !== 2;

            return isActive && matchesLevel && fs.existsSync(getCaptchaAssetPath(captchaType, key));
        });
    } catch (err) {
        console.error("CAPTCHA meta read error:", err);
        return false;
    }
}

router.get("/", async (req, res) => {
    const { userId, forceType } = req.query;
    const id = uuidv4();

    if (!userId) {
        return res.status(400).json({ error: "invalid_request" });
    }

    const startLimitKey = `rl:captcha_start:${req.ip}:${userId}`;
    const startAllowed = await recordRateLimit(startLimitKey, CAPTCHA_START_RATE_LIMIT_MAX, CAPTCHA_START_RATE_LIMIT_WINDOW_SECONDS).catch(() => false);
    if (!startAllowed) {
        return res.status(429).json({ error: "too_many_requests" });
    }

    const captchaTypeDir = path.join(__dirname, "..", "public", "videos", "captchatype");

    let captchaTypes = fs.readdirSync(captchaTypeDir)
        .filter(file => fs.statSync(path.join(captchaTypeDir, file)).isDirectory());

    // Set FORCE_CAPTCHA_TYPE=D locally to test only one CAPTCHA type.
    const requestedForcedType = forceType || process.env.FORCE_CAPTCHA_TYPE;
    const forcedCaptchaType = ["A", "B", "C", "D"].includes(requestedForcedType)
        ? requestedForcedType
        : null;

    let isUserTargetLevel2 = false;

    if (userId) {
        try {
            const userData = await new Promise((resolve) => {
                db.query("SELECT captchatype, login_attempts, captcha_level, lockout_time, lockout_count FROM users WHERE userid = ?", [userId], (err, rows) => {
                    if (err || rows.length === 0) resolve(null);
                    else resolve(rows[0]);
                });
            });

            if (userData) {
                if (Number(userData.login_attempts || 0) >= 2 && Number(userData.lockout_time || 0) > 0) {
                    const lockoutCount = Math.max(1, Number(userData.lockout_count || 1));
                    const lockoutDuration = getLockoutDuration(lockoutCount);

                    const passedTime = Date.now() - Number(userData.lockout_time);
                    if (passedTime < lockoutDuration) {
                        return res.status(423).json({
                            error: "locked",
                            remainingSec: Math.ceil((lockoutDuration - passedTime) / 1000)
                        });
                    }

                    await new Promise((resolve) => {
                        db.query(
                            "UPDATE users SET login_attempts = 0, captcha_level = 1, lockout_time = 0 WHERE userid = ?",
                            [userId],
                            () => resolve()
                        );
                    });

                    userData.login_attempts = 0;
                    userData.captcha_level = 1;
                    userData.lockout_time = 0;
                }

                if (userData.captchatype) {
                    const filteredTypes = captchaTypes.filter(file => !file.endsWith(`_${userData.captchatype}`));
                    if (filteredTypes.length > 0) captchaTypes = filteredTypes;
                }

                if (Number(userData.captcha_level || 1) === 2) {
                    isUserTargetLevel2 = true;
                } else if (userData.login_attempts === -222) {
                    isUserTargetLevel2 = true;
                    db.query(
                        "UPDATE users SET login_attempts = 0, captcha_level = 2 WHERE userid = ?",
                        [userId]
                    );
                } else if (Number(userData.login_attempts) < 0) {
                    db.query(
                        "UPDATE users SET login_attempts = 0, captcha_level = 1 WHERE userid = ?",
                        [userId]
                    );
                }
            }
        } catch (dbErr) {
            console.error("상태조회 실패:", dbErr);
        }
    }

    let effectiveForcedCaptchaType = forcedCaptchaType;

    if (isUserTargetLevel2) {
        effectiveForcedCaptchaType = "D";
    } else {
        captchaTypes = captchaTypes.filter(file => file !== "captchatype_D");

        if (effectiveForcedCaptchaType === "D") {
            effectiveForcedCaptchaType = null;
        }
    }

    if (effectiveForcedCaptchaType) {
        captchaTypes = captchaTypes.filter(
            (file) => file === `captchatype_${effectiveForcedCaptchaType}`
        );

        if (captchaTypes.length === 0 && effectiveForcedCaptchaType === "D") {
            return res.status(404).send("no available D captcha type");
        }
    }

    captchaTypes = captchaTypes.filter((file) =>
        hasAvailableCaptchaAssets(captchaTypeDir, file, isUserTargetLevel2)
    );

    if (captchaTypes.length === 0) {
        return res.status(404).send("no available captcha types");
    }

    const randomCaptchaType = captchaTypes[Math.floor(Math.random() * captchaTypes.length)];
    const captchaType = effectiveForcedCaptchaType === "D" ? "D" : randomCaptchaType.replace("captchatype_", "");

    const metaPath = path.join(captchaTypeDir, randomCaptchaType, "meta.json");
    if (!fs.existsSync(metaPath)) {
        return res.status(404).send("meta.json not found");
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

    const videos = Object.keys(meta).filter(key => {
        const isActive = meta[key]?.active === true;
        const videoLevel = Number(meta[key]?.level || 1);
        const hasAsset = fs.existsSync(getCaptchaAssetPath(captchaType, key));

        if (isUserTargetLevel2) {
            return isActive && hasAsset && videoLevel === 2;
        } else {
            return isActive && hasAsset && videoLevel !== 2;
        }
    });

    let finalVideos = videos;
    if (finalVideos.length === 0) {
        finalVideos = Object.keys(meta).filter(key => (
            meta[key]?.active === true &&
            fs.existsSync(getCaptchaAssetPath(captchaType, key))
        ));
    }

    if (finalVideos.length === 0) {
        return res.status(404).send("no available captcha assets");
    }

    const randomVideo = finalVideos[Math.floor(Math.random() * finalVideos.length)];

    let answer;
    let question;
    let badtime;
    let choices;
    let level = Number(meta[randomVideo]?.level || 1);

    if (captchaType === "A") {
        const options = meta[randomVideo].options;
        answer = Math.floor(Math.random() * options.length);
        question = options[answer].question;
        badtime = options[answer].badtime;
        choices = options.map(option => option.badtime);
    } else {
        answer = meta[randomVideo].answer;
        question = meta[randomVideo].question;
        badtime = meta[randomVideo].badtime;
        choices = [answer, ...meta[randomVideo].options];
        shuffle(choices);
    }

    const createdAt = Date.now();

    const challengeToken = crypto.randomBytes(32).toString("hex");

    try {
        await new Promise((resolve, reject) => {
            db.query(
                "INSERT INTO captcha (captchaid, answer, badtime, video, level, captchatype, userid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [id, answer, badtime, randomVideo, level, captchaType, userId, createdAt],
                (insErr) => {
                    if (insErr) reject(insErr);
                    else resolve();
                }
            );
        });

        await setChallenge({ challengeToken, captchaId: id, userId });
    } catch (err) {
        console.error("CAPTCHA create error:", err);
        return res.status(500).json({ error: "server_error", message: "CAPTCHA creation failed" });
    }

    res.json({
        captchaId: id,
        challengeToken,
        question,
        options: choices,
        type: captchaType,
        currentLevel: captchaType === "D" ? "D" : isUserTargetLevel2 ? 2 : 1
    });
});

router.post("/video", (req, res) => {
    const { captchaId } = req.body;
    db.query(
        "SELECT * FROM captcha WHERE captchaid = ?",
        [captchaId],
        (err, rows) => {

            if (err || rows.length === 0) {
                return res.status(403).send("invalid");
            }

            const data = rows[0];
            if (!fs.existsSync(getCaptchaAssetPath(data.captchatype, data.video))) {
                return res.status(404).json({ error: "asset_not_found" });
            }

            res.json({
                video: `/mvcaptcha/asset/${data.captchatype}/${data.video}`
            });
        }
    );
});

router.get("/asset/:captchaType/:assetName", (req, res) => {
    const { captchaType, assetName } = req.params;

    if (!["A", "B", "C", "D"].includes(captchaType) || !/^[a-zA-Z0-9_-]+$/.test(assetName)) {
        return res.status(400).send("invalid_asset");
    }

    const assetPath = getCaptchaAssetPath(captchaType, assetName);

    if (!fs.existsSync(assetPath)) {
        return res.status(404).send("asset_not_found");
    }

    res.sendFile(assetPath);
});

router.get("/asset/:captchaId", (req, res) => {
    const { captchaId } = req.params;

    db.query(
        "SELECT * FROM captcha WHERE captchaid = ?",
        [captchaId],
        (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).send("server_error");
            }

            if (rows.length === 0) {
                return res.status(404).send("not_found");
            }

            const data = rows[0];
            let assetPath = "";

            if (data.captchatype === "C" || data.captchatype === "D") {
                assetPath = path.join(__dirname, "..", "public", "videos", "captchatype", `captchatype_${data.captchatype}`, "img", `${data.video}.png`);
            } else {
                assetPath = path.join(__dirname, "..", "public", "videos", "captchatype", `captchatype_${data.captchatype}`, "video", `${data.video}.mp4`);
            }

            if (!fs.existsSync(assetPath)) {
                return res.status(404).send("asset_not_found");
            }

            res.sendFile(assetPath);
        }
    );
});

router.post("/verify", async (req, res) => {
    const { challengeToken, captchaId, answer, clickTime, aborted } = req.body;

    if (!challengeToken || !captchaId) {
        return res.status(400).json({ ok: false, reason: "invalid_request" });
    }

    const challenge = await consumeChallenge(challengeToken).catch((err) => {
        console.error("Challenge consume error:", err);
        return null;
    });

    if (!challenge || challenge.captchaId !== captchaId) {
        return res.status(403).json({ ok: false, reason: "captcha_not_found" });
    }

    const userId = challenge.userId;

    const verifyAllowed = await recordRateLimit(
        `rl:captcha_verify:${req.ip}:${userId}`,
        CAPTCHA_VERIFY_RATE_LIMIT_MAX,
        CAPTCHA_VERIFY_RATE_LIMIT_WINDOW_SECONDS
    ).catch(() => false);

    if (!verifyAllowed) {
        return res.status(429).json({ ok: false, reason: "too_many_requests" });
    }

    db.query(
        "SELECT * FROM captcha WHERE captchaid = ?",
        [captchaId],
        async (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    ok: false,
                    reason: "server_error"
                });
            }

            if (rows.length === 0) {
                return res.status(404).json({
                    ok: false,
                    reason: "captcha_not_found"
                });
            }

            const data = rows[0];
            if (data.userid !== userId) {
                return res.status(403).json({
                    ok: false,
                    reason: "captcha_owner_mismatch"
                });
            }

            const currentCaptchaLevel = Number(data.level || 1);
            const isDStage = data.captchatype === "D" || currentCaptchaLevel === 2;
            const makeCaptchaEvent = (captchaResult, result, message, extra = {}) => ({
                userId,
                captchaType: data.captchatype,
                captchaLevel: currentCaptchaLevel,
                captchaResult,
                clickTime: Number(clickTime),
                badtime: Number(data.badtime),
                result,
                message,
                ...extra,
            });

            if (aborted === true) {
                recordCaptchaSecurityEvent(makeCaptchaEvent("aborted", isDStage ? "fail" : "retry", "CAPTCHA aborted"));
                db.query("DELETE FROM captcha WHERE captchaid = ?", [captchaId]);

                if (isDStage) {
                    db.query(
                        "UPDATE users SET login_attempts = GREATEST(COALESCE(login_attempts, 0), 1) + 1, captchatype = NULL, captcha_level = 1, lockout_time = ?, lockout_count = CASE WHEN COALESCE(login_attempts, 0) < 2 THEN COALESCE(lockout_count, 0) + 1 ELSE COALESCE(lockout_count, 0) END WHERE userid = ?",
                        [Date.now(), userId],
                        (updateErr) => {
                            if (updateErr) console.error("레벨 2 오답 후 초기화 실패:", updateErr);
                            return res.json({
                                ok: false,
                                reason: "aborted",
                                level2_fail: true,
                                locked: true
                            });
                        }
                    );
                } else {
                    db.query("SELECT login_attempts, lockout_count FROM users WHERE userid = ?", [userId], (selErr, userRows) => {
                        const currentAttempts = Math.max(0, Number(userRows[0]?.login_attempts || 0));
                        const nextAttempts = currentAttempts + 1;
                        const now = nextAttempts >= 2 ? Date.now() : 0;
                        const lockoutIncrement = currentAttempts < 2 && nextAttempts >= 2 ? 1 : 0;

                        db.query(
                            "UPDATE users SET login_attempts = ?, captchatype = ?, captcha_level = 1, lockout_time = ?, lockout_count = COALESCE(lockout_count, 0) + ? WHERE userid = ?",
                            [nextAttempts, data.captchatype, now, lockoutIncrement, userId],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error(updateErr);
                                    return res.status(500).json({ ok: false, reason: "db_error" });
                                }
                                return res.json({
                                    ok: false,
                                    reason: "aborted",
                                    locked: nextAttempts >= 2,
                                    remainingSec: nextAttempts >= 2 ? Math.ceil(getLockoutDuration(Math.max(1, Number(userRows[0]?.lockout_count || 0) + lockoutIncrement)) / 1000) : undefined
                                });
                            }
                        );
                    });
                }
                return;
            }

            const badtimeNum = Number(data.badtime);
            const clickTimeNum = Number(clickTime);
            if (!Number.isFinite(clickTimeNum)) {
                return res.status(400).json({ ok: false, reason: "invalid_click_time" });
            }

            db.query("DELETE FROM captcha WHERE captchaid = ?", [captchaId]);

            const failReason = answer === "" ? "timeout" : "fail";

            const shouldEnterDStage =
                !isDStage &&
                data.captchatype !== "D" &&
                clickTimeNum >= badtimeNum &&
                clickTimeNum <= badtimeNum + D_STAGE_WINDOW_SEC;

            if (clickTimeNum + BADTIME_FAST_TOLERANCE_SEC < badtimeNum) {
                recordCaptchaSecurityEvent(makeCaptchaEvent("too_fast", isDStage ? "fail" : "retry", "CAPTCHA too fast", {
                    clickTime: clickTimeNum,
                    badtime: badtimeNum,
                }));
                if (isDStage) {
                    db.query("SELECT login_attempts, lockout_count FROM users WHERE userid = ?", [userId], (selErr, userRows) => {
                        const currentAttempts = Math.max(1, Number(userRows[0]?.login_attempts || 0));
                        const nextAttempts = currentAttempts + 1;
                        const now = nextAttempts >= 2 ? Date.now() : 0;
                        const lockoutIncrement = currentAttempts < 2 && nextAttempts >= 2 ? 1 : 0;

                        db.query(
                            "UPDATE users SET login_attempts = ?, captchatype = NULL, captcha_level = 1, lockout_time = ?, lockout_count = COALESCE(lockout_count, 0) + ? WHERE userid = ?",
                            [nextAttempts, now, lockoutIncrement, userId],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error(updateErr);
                                    return res.status(500).json({ ok: false, reason: "db_error" });
                                }
                                return res.json({
                                    ok: false,
                                    reason: "too_fast",
                                    level2_fail: true,
                                    locked: true
                                });
                            }
                        );
                    });
                    return;
                }

                db.query("SELECT login_attempts, lockout_count FROM users WHERE userid = ?", [userId], (selErr, userRows) => {
                    const currentAttempts = Math.max(0, Number(userRows[0]?.login_attempts || 0));
                    const nextAttempts = currentAttempts + 1;
                    const now = nextAttempts >= 2 ? Date.now() : 0;
                    const lockoutIncrement = currentAttempts < 2 && nextAttempts >= 2 ? 1 : 0;

                    db.query(
                        "UPDATE users SET login_attempts = ?, captchatype = ?, captcha_level = 1, lockout_time = ?, lockout_count = COALESCE(lockout_count, 0) + ? WHERE userid = ?",
                        [nextAttempts, data.captchatype, now, lockoutIncrement, userId],
                        (updateErr) => {
                            if (updateErr) {
                                console.error(updateErr);
                                return res.status(500).json({ ok: false, reason: "db_error" });
                            }
                            return res.json({
                                ok: false,
                                reason: "too_fast",
                                locked: nextAttempts >= 2,
                                remainingSec: nextAttempts >= 2 ? Math.ceil(getLockoutDuration(Math.max(1, Number(userRows[0]?.lockout_count || 0) + lockoutIncrement)) / 1000) : undefined
                            });
                        }
                    );
                });
                return;
            }

            
            if (String(answer) === data.answer) {

                if (isDStage) {
                    recordCaptchaSecurityEvent(makeCaptchaEvent("success", "success", "CAPTCHA success", {
                        clickTime: clickTimeNum,
                        badtime: badtimeNum,
                    }));
                    const passToken = await storeCaptchaPass(userId).catch((passErr) => {
                        console.error("Captcha pass store error:", passErr);
                        return null;
                    });

                    if (!passToken) {
                        return res.status(500).json({ ok: false, reason: "db_error" });
                    }

                    db.query(
                        "UPDATE users SET captchatype = NULL, captcha_level = 1, lockout_time = 0 WHERE userid = ?",
                        [userId],
                        (updateErr) => {
                            if (updateErr) console.error(updateErr);
                            return res.json({ ok: true, reason: "success", clearAll: true, captchaToken: passToken });
                        }
                    );
                }

                else if (shouldEnterDStage) {
                    recordCaptchaSecurityEvent(makeCaptchaEvent("d_stage_unlocked", "retry", "CAPTCHA D stage unlocked", {
                        clickTime: clickTimeNum,
                        badtime: badtimeNum,
                    }));

                    db.query(
                        "UPDATE users SET login_attempts = GREATEST(COALESCE(login_attempts, 0), 0) + 1, captchatype = NULL, captcha_level = 2, lockout_time = 0 WHERE userid = ?",
                        [userId],
                        (updateErr) => {
                            if (updateErr) console.error("레벨 상태 기록 실패:", updateErr);

                            
                            return res.json({ ok: true, reason: "d_stage_unlocked", goToLevel2: true, nextType: "D" });
                        }
                    );
                }

                else {
                    recordCaptchaSecurityEvent(makeCaptchaEvent("success", "success", "CAPTCHA success", {
                        clickTime: clickTimeNum,
                        badtime: badtimeNum,
                    }));
                    const passToken = await storeCaptchaPass(userId).catch((passErr) => {
                        console.error("Captcha pass store error:", passErr);
                        return null;
                    });

                    if (!passToken) {
                        return res.status(500).json({ ok: false, reason: "db_error" });
                    }

                    db.query(
                        "UPDATE users SET captchatype = NULL, captcha_level = 1, lockout_time = 0 WHERE userid = ?",
                        [userId],
                        (updateErr) => {
                            if (updateErr) console.error(updateErr);
                            return res.json({ ok: true, reason: "success", clearAll: true, captchaToken: passToken });
                        }
                    );
                }
            } else {
                recordCaptchaSecurityEvent(makeCaptchaEvent(failReason, isDStage ? "fail" : "retry", "CAPTCHA fail", {
                    clickTime: clickTimeNum,
                    badtime: badtimeNum,
                }));
                if (isDStage) {

                    db.query(
                        "UPDATE users SET login_attempts = GREATEST(COALESCE(login_attempts, 0), 1) + 1, captchatype = NULL, captcha_level = 1, lockout_time = ?, lockout_count = CASE WHEN COALESCE(login_attempts, 0) < 2 THEN COALESCE(lockout_count, 0) + 1 ELSE COALESCE(lockout_count, 0) END WHERE userid = ?",
                        [Date.now(), userId],
                        (updateErr) => {
                            if (updateErr) console.error("레벨 2 오답 후 초기화 실패:", updateErr);
                            return res.json({
                                ok: false,
                                reason: failReason,
                                level2_fail: true,
                                locked: true
                            });
                        }
                    );
                } else {

                    db.query("SELECT login_attempts, lockout_count FROM users WHERE userid = ?", [userId], (selErr, userRows) => {
                        const currentAttempts = Math.max(0, Number(userRows[0]?.login_attempts || 0));
                        const nextAttempts = currentAttempts + 1;
                        const now = nextAttempts >= 2 ? Date.now() : 0;
                        const lockoutIncrement = currentAttempts < 2 && nextAttempts >= 2 ? 1 : 0;

                        db.query(
                            "UPDATE users SET login_attempts = ?, captchatype = ?, captcha_level = 1, lockout_time = ?, lockout_count = COALESCE(lockout_count, 0) + ? WHERE userid = ?",
                            [nextAttempts, data.captchatype, now, lockoutIncrement, userId],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error(updateErr);
                                    return res.status(500).json({ ok: false, reason: "db_error" });
                                }
                                return res.json({
                                    ok: false,
                                    reason: failReason,
                                    locked: nextAttempts >= 2,
                                    remainingSec: nextAttempts >= 2 ? Math.ceil(getLockoutDuration(Math.max(1, Number(userRows[0]?.lockout_count || 0) + lockoutIncrement)) / 1000) : undefined
                                });
                            }
                        );
                    });
                }
            }
        }
    );
});

module.exports = router;
