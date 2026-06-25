//env에 추가 => MVCAPTCHA_TEST=1

const express = require("express");
const crypto = require("crypto");
const mysql = require("mysql2");
const { createClient } = require("redis");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Change only this value for testing: "A", "B", "C", or "D".
const TEST_CAPTCHA_TYPE = "A";

const VALID_TYPES = ["A", "B", "C", "D"];
const CAPTCHA_PASS_TTL_SECONDS = 2 * 60;
const challengeStore = new Map();
const cursors = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
};

const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
});

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

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error("CAPTCHA test DB connect error:", err);
    }
});

const calculateStdDev = (values) => {
    if (!Array.isArray(values) || values.length === 0) return null;

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
};

const getClickStats = (clickData = []) => {
    if (!Array.isArray(clickData)) {
        return { clickHoldStd: null, clickPairs: 0 };
    }

    const holdTimes = [];

    for (let i = 0; i < clickData.length - 1; i++) {
        const current = clickData[i];
        const next = clickData[i + 1];

        if (current?.type === "down" && next?.type === "up") {
            holdTimes.push(Number(next.t) - Number(current.t));
        }
    }

    return {
        clickHoldStd: holdTimes.length > 0 ? calculateStdDev(holdTimes) : null,
        clickPairs: holdTimes.length,
    };
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

const summarizeBehaviorMetrics = (metrics = {}) => {
    const mouseTrajectory = Array.isArray(metrics.mouseTrajectory) ? metrics.mouseTrajectory : [];
    const clickData = Array.isArray(metrics.clickData) ? metrics.clickData : [];
    const clickStats = getClickStats(clickData);

    return {
        mouseResult: mouseTrajectory.length > 0 ? "CAPTCHA mouse tracked" : "No CAPTCHA mouse data",
        trajectoryPoints: mouseTrajectory.length,
        clickHoldStd: clickStats.clickHoldStd,
        clickPairs: clickStats.clickPairs,
        trajectorySample: sampleTrajectory(mouseTrajectory),
    };
};

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
            event.mouseResult || null,
            0,
            event.trajectoryPoints || 0,
            null,
            event.clickHoldStd ?? null,
            event.clickPairs || 0,
            event.trajectorySample ? JSON.stringify(event.trajectorySample) : null,
            null,
            event.clickTime ?? null,
            event.badtime ?? null,
            event.result,
            event.message || null,
            Date.now(),
        ],
        (err) => {
            if (err) console.error("CAPTCHA test security event insert error:", err);
        }
    );
}

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

function getAssetKind(captchaType) {
    return captchaType === "C" || captchaType === "D" ? "img" : "video";
}

function getAssetExtension(captchaType) {
    return getAssetKind(captchaType) === "img" ? ".png" : ".mp4";
}

function getTypeDir(captchaType) {
    return path.join(
        __dirname,
        "..",
        "public",
        "videos",
        "captchatype",
        `captchatype_${captchaType}`
    );
}

function getAssetDir(captchaType) {
    return path.join(getTypeDir(captchaType), getAssetKind(captchaType));
}

function getAssetPath(captchaType, assetName) {
    return path.join(getAssetDir(captchaType), `${assetName}${getAssetExtension(captchaType)}`);
}

function readMeta(captchaType) {
    const metaPath = path.join(getTypeDir(captchaType), "meta.json");

    if (!fs.existsSync(metaPath)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch (err) {
        console.error("CAPTCHA test meta read error:", err);
        return {};
    }
}

function getAssets(captchaType) {
    const assetDir = getAssetDir(captchaType);
    const extension = getAssetExtension(captchaType);
    const meta = readMeta(captchaType);

    if (!fs.existsSync(assetDir)) {
        return [];
    }

    return fs.readdirSync(assetDir)
        .filter((file) => path.extname(file).toLowerCase() === extension)
        .map((file) => path.basename(file, extension))
        .filter((assetName) => meta[assetName]?.active === true)
        .sort((a, b) => collator.compare(a, b));
}

function getNextAsset(captchaType) {
    const assets = getAssets(captchaType);

    if (assets.length === 0) {
        return null;
    }

    const index = cursors[captchaType] % assets.length;
    cursors[captchaType] = (cursors[captchaType] + 1) % assets.length;

    return {
        assetName: assets[index],
        index: index + 1,
        total: assets.length,
    };
}

function makeChallenge(captchaType, selectedAsset, userId) {
    const meta = readMeta(captchaType);
    const item = meta[selectedAsset.assetName] || {};
    const captchaId = crypto.randomBytes(16).toString("hex");
    const challengeToken = crypto.randomBytes(32).toString("hex");

    let answer = item.answer || "";
    let question = item.question || `[TEST] ${captchaType} ${selectedAsset.assetName}`;
    let badtime = Number(item.badtime || 1);
    let options = Array.isArray(item.options) ? [...item.options] : [];
    let testQuestionIndex = null;

    if (captchaType === "A" && Array.isArray(item.options) && item.options.length > 0) {
        answer = crypto.randomInt(item.options.length);
        testQuestionIndex = answer + 1;
        question = item.options[answer].question || question;
        badtime = Number(item.options[answer].badtime || badtime);
        options = item.options.map((option) => option.badtime);
    } else if (answer !== "" && !options.includes(answer)) {
        options = [answer, ...options];
    }

    challengeStore.set(challengeToken, {
        captchaId,
        captchaType,
        assetName: selectedAsset.assetName,
        userId,
        answer,
        badtime,
        createdAt: Date.now(),
    });

    return {
        captchaId,
        challengeToken,
        question,
        options,
        type: captchaType,
        currentLevel: captchaType === "D" ? "D" : Number(item.level || 1),
        testAsset: selectedAsset.assetName,
        testQuestionIndex,
        testIndex: selectedAsset.index,
        testTotal: selectedAsset.total,
    };
}

router.get("/", (req, res) => {
    const captchaType = TEST_CAPTCHA_TYPE;
    const userId = String(req.query.userId || "");

    if (!VALID_TYPES.includes(captchaType)) {
        return res.status(400).json({ error: "invalid_test_captcha_type" });
    }

    const selectedAsset = getNextAsset(captchaType);

    if (!selectedAsset) {
        return res.status(404).json({ error: "no_test_assets", type: captchaType });
    }

    return res.json(makeChallenge(captchaType, selectedAsset, userId));
});

router.post("/video", (req, res) => {
    const { captchaId, challengeToken } = req.body;
    const challenge = challengeStore.get(challengeToken);

    if (!captchaId || !challengeToken || !challenge || challenge.captchaId !== captchaId) {
        return res.status(403).json({ error: "invalid_challenge" });
    }

    if (!fs.existsSync(getAssetPath(challenge.captchaType, challenge.assetName))) {
        return res.status(404).json({ error: "asset_not_found" });
    }

    return res.json({
        video: `${req.baseUrl}/asset/${challenge.captchaType}/${challenge.assetName}`,
        testAsset: challenge.assetName,
    });
});

router.get("/asset/:captchaType/:assetName", (req, res) => {
    const { captchaType, assetName } = req.params;

    if (!VALID_TYPES.includes(captchaType) || !/^[a-zA-Z0-9_-]+$/.test(assetName)) {
        return res.status(400).send("invalid_asset");
    }

    const assetPath = getAssetPath(captchaType, assetName);

    if (!fs.existsSync(assetPath)) {
        return res.status(404).send("asset_not_found");
    }

    return res.sendFile(assetPath);
});

router.post("/verify", async (req, res) => {
    const { captchaId, challengeToken, answer, clickTime, aborted, behaviorMetrics } = req.body;
    const challenge = challengeStore.get(challengeToken);

    if (!captchaId || !challengeToken || !challenge || challenge.captchaId !== captchaId) {
        return res.status(403).json({ ok: false, reason: "captcha_not_found" });
    }

    challengeStore.delete(challengeToken);
    const behaviorSummary = summarizeBehaviorMetrics(behaviorMetrics);
    const makeCaptchaEvent = (captchaResult, result, message) => ({
        userId: challenge.userId,
        captchaType: challenge.captchaType,
        captchaLevel: challenge.captchaType === "D" ? 2 : 1,
        captchaResult,
        mouseResult: behaviorSummary.mouseResult,
        trajectoryPoints: behaviorSummary.trajectoryPoints,
        clickHoldStd: behaviorSummary.clickHoldStd,
        clickPairs: behaviorSummary.clickPairs,
        trajectorySample: behaviorSummary.trajectorySample,
        clickTime: Number(clickTime),
        badtime: Number(challenge.badtime),
        result,
        message,
    });

    if (aborted === true) {
        recordCaptchaSecurityEvent(makeCaptchaEvent("aborted", "retry", "CAPTCHA test aborted"));
        return res.json({
            ok: false,
            reason: "aborted",
            testAnswer: challenge.answer,
            testAsset: challenge.assetName,
        });
    }

    const ok = String(answer) === String(challenge.answer);

    if (!ok) {
        recordCaptchaSecurityEvent(makeCaptchaEvent("fail", "retry", "CAPTCHA test fail"));
        return res.json({
            ok: false,
            reason: "fail",
            testAnswer: challenge.answer,
            testAsset: challenge.assetName,
        });
    }

    if (!challenge.userId) {
        recordCaptchaSecurityEvent(makeCaptchaEvent("success", "fail", "CAPTCHA test missing user"));
        return res.status(400).json({
            ok: false,
            reason: "missing_user",
            testAnswer: challenge.answer,
            testAsset: challenge.assetName,
        });
    }

    const passToken = await storeCaptchaPass(challenge.userId).catch((err) => {
        console.error("CAPTCHA test pass store error:", err);
        return null;
    });

    if (!passToken) {
        return res.status(500).json({
            ok: false,
            reason: "db_error",
            testAnswer: challenge.answer,
            testAsset: challenge.assetName,
        });
    }

    recordCaptchaSecurityEvent(makeCaptchaEvent("success", "success", "CAPTCHA test success"));

    return res.json({
        ok: true,
        reason: "success",
        clearAll: true,
        captchaToken: passToken,
        testAnswer: challenge.answer,
        testAsset: challenge.assetName,
    });
});

if (require.main === module) {
    const app = express();
    const port = process.env.MVCAPTCHA_TEST_PORT || 3002;

    app.use(express.json());
    app.use("/mvcaptcha", router);

    app.listen(port, () => {
        console.log(`mvcaptcha test server running on port ${port}`);
        console.log(`test type: ${TEST_CAPTCHA_TYPE}`);
    });
}

module.exports = router;
