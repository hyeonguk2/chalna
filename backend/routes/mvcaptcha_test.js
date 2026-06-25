//env에 추가 => MVCAPTCHA_TEST=1

const express = require("express");
const crypto = require("crypto");
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
    const { captchaId, challengeToken, answer } = req.body;
    const challenge = challengeStore.get(challengeToken);

    if (!captchaId || !challengeToken || !challenge || challenge.captchaId !== captchaId) {
        return res.status(403).json({ ok: false, reason: "captcha_not_found" });
    }

    challengeStore.delete(challengeToken);
    const ok = String(answer) === String(challenge.answer);

    if (!ok) {
        return res.json({
            ok: false,
            reason: "fail",
            testAnswer: challenge.answer,
            testAsset: challenge.assetName,
        });
    }

    if (!challenge.userId) {
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
