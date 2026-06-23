const express = require("express");
const mysql = require("mysql2");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");

const router = express.Router();
const store = {};

// =========================
// DB 연결
// =========================
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// =========================
// DB 자동 생성
// =========================
db.connect((err) => {
    if (err) {
        console.log("DB connect error:", err);
        return;
    }

    console.log("captcha DB connected");

    const createTable = `
        CREATE TABLE IF NOT EXISTS captcha (
            captchaid VARCHAR(100) PRIMARY KEY,
            answer VARCHAR(10),
            badtime DECIMAL(3,1),
            video VARCHAR(100),
            level INT,
            captchatype CHAR(1),
            created_at BIGINT
        )
    `;

    db.query(createTable, (err) => {
        if (err) {
            console.log("table create error:", err);
            return;
        }
        console.log("captcha table ready");
    });
});

// =========================
// 랜덤 값 생성
// =========================
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

// =========================
// 캡차 생성 (오류 해결 버전)
// =========================
router.get("/", async (req, res) => {
    const { userId, forceType } = req.query;
    const id = uuidv4();

    // 🎬 영상 폴더 세팅
    const captchaTypeDir = path.join(__dirname, "..", "public", "videos", "captchatype");

    let captchaTypes = fs.readdirSync(captchaTypeDir)
        .filter(file => fs.statSync(path.join(captchaTypeDir, file)).isDirectory());

    // Set FORCE_CAPTCHA_TYPE=D locally to test only one CAPTCHA type.
    const requestedForcedType = forceType || process.env.FORCE_CAPTCHA_TYPE;
    const forcedCaptchaType = ["A", "B", "C", "D"].includes(requestedForcedType)
        ? requestedForcedType
        : null;
    if (forcedCaptchaType) {
        captchaTypes = captchaTypes.filter(
            (file) => file === `captchatype_${forcedCaptchaType}`
        );

        // D 단계 전용 자산이 아직 없으면 C 이미지 자산을 D 단계 문제로 재사용한다.
        if (captchaTypes.length === 0 && forcedCaptchaType === "D") {
            captchaTypes = ["captchatype_C"];
        }
    }

    // 💡 변수 스코프 에러 방지를 위해 확실하게 let으로 최상단 선언
    let isUserTargetLevel2 = false;

    // 1. 해당 유저가 직전에 실패한 타입 조회 & 현재 대상 레벨 상태 판별
    if (userId) {
        try {
            const userData = await new Promise((resolve) => {
                db.query("SELECT captchatype, login_attempts FROM users WHERE userid = ?", [userId], (err, rows) => {
                    if (err || rows.length === 0) resolve(null);
                    else resolve(rows[0]);
                });
            });

            if (userData) {
                // 직전 실패 타입 제외
                if (userData.captchatype) {
                    const filteredTypes = captchaTypes.filter(file => !file.endsWith(`_${userData.captchatype}`));
                    if (filteredTypes.length > 0) captchaTypes = filteredTypes;
                }
                // login_attempts가 -222이면 레벨 2 진입 대상 유저임
                if (userData.login_attempts === -222) {
                    isUserTargetLevel2 = true;
                }
            }
        } catch (dbErr) {
            console.error("유저 상태 조회 실패:", dbErr);
        }
    }

    const randomCaptchaType = captchaTypes[Math.floor(Math.random() * captchaTypes.length)];
    const captchaType = forcedCaptchaType === "D" ? "D" : randomCaptchaType.replace("captchatype_", "");

    const metaPath = path.join(captchaTypeDir, randomCaptchaType, "meta.json");
    if (!fs.existsSync(metaPath)) {
        return res.status(404).send("meta.json not found");
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

    // ==========================================================
    // 2. 유저 조건에 맞게 비디오(문제) 필터링 (ReferenceError 해결 구간)
    // ==========================================================
    const videos = Object.keys(meta).filter(key => {
        const isActive = meta[key]?.active === true;
        const videoLevel = Number(meta[key]?.level || 1);

        if (isUserTargetLevel2) {
            return isActive && videoLevel === 2; // 레벨 2 문제만 출제
        } else {
            return isActive && videoLevel !== 2; // 레벨 1 문제 출제
        }
    });

    // 만약 레벨 2에 맞는 특화 문제가 폴더에 없을 경우를 대비한 롤백 방어 코드
    let finalVideos = videos;
    if (finalVideos.length === 0) {
        finalVideos = Object.keys(meta).filter(key => meta[key]?.active === true);
    }

    if (finalVideos.length === 0) {
        return res.status(404).send("no available video folders");
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

    db.query(
        "INSERT INTO captcha (captchaid, answer, badtime, video, level, captchatype, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, answer, badtime, randomVideo, level, captchaType, createdAt],
        (insErr) => {
            if (insErr) console.error("캡차 데이터 삽입 실패:", insErr);
        }
    );

    res.json({
        captchaId: id,
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
            let videoUrl = "";

            if (data.captchatype === "C" || data.captchatype === "D") {
                const dImagePath = path.join(__dirname, "..", "public", "videos", "captchatype", "captchatype_D", "img", `${data.video}.png`);
                const assetType = data.captchatype === "D" && !fs.existsSync(dImagePath) ? "C" : data.captchatype;
                videoUrl = `/videos/captchatype/captchatype_${assetType}/img/${data.video}.png`;
            } else {
                videoUrl = `/videos/captchatype/captchatype_${data.captchatype}/video/${data.video}.mp4`;
            }
            res.json({
                video: videoUrl
            });
        }
    );
});

// =========================
// 검증 (로그인 ID 기준 실패 횟수 처리 추가)
// =========================
router.post("/verify", (req, res) => {
    // 1. 프론트엔드에서 전송한 userid(로그인 ID)를 추가로 받습니다.
    const { captchaId, answer, userId, clickTime, type, answeredInDeadTime } = req.body;

    // 만약 로그인 시도가 아니라 비로그인 상태(예: ID 입력 전)에서 호출되었다면 방어 코드
    if (!userId) {
        return res.json({ ok: false, reason: "사용자 ID가 필요합니다." });
    }
    db.query(
        "SELECT * FROM captcha WHERE captchaid = ?",
        [captchaId],
        (err, rows) => {
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
            const badtimeNum = Number(data.badtime);
            const clickTimeNum = Number(clickTime);
            const currentCaptchaLevel = Number(data.level || 1);
            const failReason = answer === "" ? "timeout" : "fail";

            console.log(badtimeNum, clickTime);
            const solveTime =
    (Date.now() - Number(data.created_at)) / 1000;

let aiScore = 0;

if (solveTime < 1.5) aiScore += 50;

if (answeredInDeadTime === true)
    aiScore += 60;

const shouldEnterDStage =
    currentCaptchaLevel !== 2 &&
    data.captchatype !== "D" &&
    aiScore >= 60;

console.log("D_STAGE_CHECK", {
    solveTime,
    answeredInDeadTime,
    aiScore,
    currentCaptchaLevel,
    captchaType: data.captchatype,
    shouldEnterDStage
});

            // 1. 먼저 시간 체크
            if (clickTimeNum < badtimeNum) {
                // 먼저 현재 실패 횟수를 조회해서 1회였다면 이번에 2회가 되므로 락아웃 시간을 세팅해야 합니다.
                db.query("SELECT login_attempts FROM users WHERE userid = ?", [userId], (selErr, userRows) => {
                    const currentAttempts = userRows[0]?.login_attempts || 0;
                    const nextAttempts = currentAttempts + 1;
                    const now = nextAttempts >= 2 ? Date.now() : 0; // 2회 이상이면 현재 시간 기록

                    db.query(
                        "UPDATE users SET login_attempts = login_attempts + 1, captchatype = ?, lockout_time = ? WHERE userid = ?",
                        [type, now, userId]
                    );
                });
                return res.json({ ok: false, reason: "too_fast" });
            }
            // 조건 2: 영상/이미지 종료 후 정답 제한시간(dead time) 안에 맞춘 경우 다음 단계로 보낸다.
            
            // ❌ 사용한 캡차 데이터 삭제 (1회성 유지)
            db.query("DELETE FROM captcha WHERE captchaid = ?", [captchaId]);

            // 2. 캡차 결과에 따른 사용자 실패 횟수 후처리
            if (String(answer) === data.answer) {
                // 캡차 정답 ⭕ : 해당 유저의 로그인 실패 횟수를 0으로 초기화
                if (currentCaptchaLevel === 2) {
                    db.query(
                        "UPDATE users SET login_attempts = 2, captchatype = NULL WHERE userid = ?",
                        [userId],
                        (updateErr) => {
                            if (updateErr) console.error(updateErr);
                            return res.json({ ok: true, reason: "success", clearAll: true });
                        }
                    );
                }
                // 만약 [레벨 1 문제]에서 0.5초 타이밍 조절을 성공하여 레벨 2 진입 자격을 딴 경우
                else if (shouldEnterDStage) {
                    // 유저의 상태 플래그값을 변경하여 다음 GET 요청 시 후속 문제를 배정하도록 유도
                    db.query(
                        "UPDATE users SET login_attempts = -222, captchatype = NULL WHERE userid = ?",
                        [userId],
                        (updateErr) => {
                            if (updateErr) console.error("레벨 상태 기록 실패:", updateErr);

                            // 프론트엔드에게 통과가 아니라 "D 단계 문제를 새로 요청하라"는 신호를 전송
                            
                            return res.json({ ok: true, reason: "d_stage_unlocked", goToLevel2: true, nextType: "D" });
                        }
                    );
                }
                // 일반 성공 처리 (시간 초과 상태로 글자만 맞춤) -> 기획에 따라 실패 처리 혹은 재시도 유도 가능
                else {
                    db.query(
                        "UPDATE users SET login_attempts = 0, captchatype = NULL WHERE userid = ?",
                        [userId],
                        (updateErr) => {
                            if (updateErr) console.error(updateErr);
                            return res.json({ ok: true, reason: "success", clearAll: true });
                        }
                    );
                }
            } else {
                if (currentCaptchaLevel === 2) {
                    // 🎯 [추가] 레벨 2 문제를 틀린 경우 실패 횟수를 0으로 초기화 (최종 실패 처리 후 리셋 등)
                    db.query(
                        "UPDATE users SET login_attempts = 0, captchatype = NULL WHERE userid = ?",
                        [userId],
                        (updateErr) => {
                            if (updateErr) console.error("레벨 2 오답 후 초기화 실패:", updateErr);
                            return res.json({ ok: false, reason: failReason, level2_fail: true });
                        }
                    );
                } else {
                    // 레벨 1 문제를 틀린 경우 실패 횟수 증가 및 2회 도달 시 락아웃 처리
                    db.query("SELECT login_attempts FROM users WHERE userid = ?", [userId], (selErr, userRows) => {
                        const currentAttempts = userRows[0]?.login_attempts || 0;
                        const nextAttempts = currentAttempts + 1;
                        const now = nextAttempts >= 2 ? Date.now() : 0;

                        db.query(
                            "UPDATE users SET login_attempts = login_attempts + 1, captchatype = ?, lockout_time = ? WHERE userid = ?",
                            [type, now, userId],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error(updateErr);
                                    return res.status(500).json({ ok: false, reason: "db_error" });
                                }
                                return res.json({ ok: false, reason: failReason });
                            }
                        );
                    });
                }
            }
        }
    );
});

module.exports = router;
