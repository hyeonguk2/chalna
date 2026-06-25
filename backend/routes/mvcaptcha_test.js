//env에 추가 => MVCAPTCHA_TEST=1

const express = require("express");
const crypto = require("crypto");
const mysql = require("mysql2");
const { createClient } = require("redis");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Change only this value for testing: "A", "B", "C", or "D".
const TEST_CAPTCHA_TYPE = "B";

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

const calculateMean = (values) => {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const getDistance = (a, b) => {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    return Math.sqrt((dx * dx) + (dy * dy));
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

const getClickStats = (clickData = []) => {
    if (!Array.isArray(clickData)) {
        return { clickHoldStd: null, clickPairs: 0, holdTimes: [] };
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
        holdTimes,
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
    const details = [];
    let botScore = 0;
    let mouseResult = "CAPTCHA mouse normal";
    let linearMse = null;

    if (mouseTrajectory.length === 0) {
        botScore += 35;
        mouseResult = "No CAPTCHA mouse data";
        details.push({ label: "trajectory", result: "missing", score: 35 });
    } else if (mouseTrajectory.length < 10) {
        botScore += 20;
        mouseResult = "CAPTCHA mouse trajectory too short";
        details.push({ label: "trajectory", result: "too_short", score: 20 });
    } else {
        const xStdDev = calculateStdDev(mouseTrajectory.map((point) => Number(point.x)));
        const yStdDev = calculateStdDev(mouseTrajectory.map((point) => Number(point.y)));

        if (xStdDev === 0 && yStdDev === 0) {
            botScore += 35;
            mouseResult = "CAPTCHA mouse fixed coordinates";
            details.push({ label: "trajectory", result: "fixed_coordinates", score: 35 });
        } else {
            let totalDistance = 0;
            const speeds = [];

            for (let i = 1; i < mouseTrajectory.length; i++) {
                const distance = getDistance(mouseTrajectory[i - 1], mouseTrajectory[i]);
                const elapsed = Math.max(Number(mouseTrajectory[i].t) - Number(mouseTrajectory[i - 1].t), 1);
                totalDistance += distance;
                speeds.push(distance / elapsed);
            }

            const directDistance = getDistance(mouseTrajectory[0], mouseTrajectory[mouseTrajectory.length - 1]);
            const straightness = totalDistance > 0 ? directDistance / totalDistance : 0;
            const baseline = Math.max(directDistance, 1);
            const squaredDeviationSum = mouseTrajectory.reduce((sum, point) => (
                sum + Math.pow(getPointToLineDistance(point, mouseTrajectory[0], mouseTrajectory[mouseTrajectory.length - 1]), 2)
            ), 0);
            const rmsDeviation = Math.sqrt(squaredDeviationSum / mouseTrajectory.length);
            linearMse = Number.isFinite((rmsDeviation / baseline) * 100)
                ? (rmsDeviation / baseline) * 100
                : null;

            if (linearMse !== null && linearMse < 1.2 && straightness > 0.985 && totalDistance > 100) {
                botScore += 35;
                mouseResult = "CAPTCHA mouse too linear";
                details.push({ label: "trajectory", result: "too_linear", score: 35 });
            }

            const meanSpeed = calculateMean(speeds);
            const speedStdDev = calculateStdDev(speeds);
            const speedCv = meanSpeed > 0 ? speedStdDev / meanSpeed : null;

            if (speedCv !== null && speedCv < 0.15 && speeds.length >= 10) {
                botScore += 20;
                mouseResult = mouseResult === "CAPTCHA mouse normal"
                    ? "CAPTCHA mouse uniform speed"
                    : `${mouseResult}, uniform speed`;
                details.push({ label: "speed", result: "too_uniform", score: 20 });
            }
        }
    }

    if (clickStats.clickPairs === 0) {
        botScore += 10;
        details.push({ label: "click", result: "no_click_pairs", score: 10 });
    } else if (clickStats.clickPairs >= 2 && clickStats.clickHoldStd !== null && clickStats.clickHoldStd < 5.0) {
        botScore += 25;
        mouseResult = mouseResult === "CAPTCHA mouse normal"
            ? "CAPTCHA click timing too uniform"
            : `${mouseResult}, click timing too uniform`;
        details.push({ label: "click", result: "too_uniform", score: 25 });
    }

    return {
        botScore,
        mouseResult,
        trajectoryPoints: mouseTrajectory.length,
        linearMse,
        clickHoldStd: clickStats.clickHoldStd,
        clickPairs: clickStats.clickPairs,
        trajectorySample: sampleTrajectory(mouseTrajectory),
        analysisDetails: details,
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

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
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
        shuffle(options);
    } else if (captchaType !== "A") {
        shuffle(options);
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
        botScore: behaviorSummary.botScore,
        trajectoryPoints: behaviorSummary.trajectoryPoints,
        linearMse: behaviorSummary.linearMse,
        clickHoldStd: behaviorSummary.clickHoldStd,
        clickPairs: behaviorSummary.clickPairs,
        trajectorySample: behaviorSummary.trajectorySample,
        analysisDetails: behaviorSummary.analysisDetails,
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
