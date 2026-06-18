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
            captchaId VARCHAR(100) PRIMARY KEY,
            answer VARCHAR(10),
            badtime INT,
            video VARCHAR(100),
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
// 캡차 생성
// =========================
router.get("/", (req, res) => {

    const id = uuidv4();

    // 🎬 영상 폴더
    const baseDir = path.join(__dirname, "..", "public", "videos");

    // meta 읽기
    const meta = JSON.parse(
        fs.readFileSync(path.join(baseDir, "meta.json"), "utf-8")
    );

    // active 필터
    const videos = Object.keys(meta)
        .filter(key => meta[key]?.active === true);

    if (videos.length === 0) {
        return res.status(404).send("no video folders");
    }

    const randomVideo =
        videos[Math.floor(Math.random() * videos.length)];

    // 🎯 정답시간 가져오기
    const answer = meta[randomVideo].answer;
    const question = meta[randomVideo].question;
    const badtime = meta[randomVideo].badtime;
    const type = meta[randomVideo].type;
    const choices = [
        answer,
        ...meta[randomVideo].options
    ];

    shuffle(choices);

    const createdAt = Date.now();

    db.query(
        "INSERT INTO captcha (captchaId, answer, badtime, video, created_at) VALUES (?, ?,?, ?, ?)",
        [id, answer, badtime, randomVideo, createdAt]
    );

    res.json({
        captchaId: id,
        question,
        options: choices,
        type
    });
});

router.post("/video", (req, res) => {

    const { captchaId } = req.body;

    db.query(
        "SELECT * FROM captcha WHERE captchaId = ?",
        [captchaId],
        (err, rows) => {

            if (err || rows.length === 0) {
                return res.status(403).send("invalid");
            }

            const data = rows[0];

            const videoUrl = `/videos/${data.video}.mp4`;

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
    // 1. 프론트엔드에서 전송한 userId(로그인 ID)를 추가로 받습니다.
    const { captchaId, answer, userId, clickTime } = req.body;

    // 만약 로그인 시도가 아니라 비로그인 상태(예: ID 입력 전)에서 호출되었다면 방어 코드
    if (!userId) {
        return res.json({ ok: false, message: "사용자 ID가 필요합니다." });
    }

    db.query(
        "SELECT * FROM captcha WHERE captchaId = ?",
        [captchaId],
        (err, rows) => {
            if (err || rows.length === 0) {
                return res.json({ ok: false });
            }

            const data = rows[0];
            const badtimeNum = Number(data.badtime);
            const clickTimeNum = Number(clickTime);

            // 1. 먼저 시간 체크
            if (clickTimeNum < badtimeNum) {
                db.query("UPDATE users SET login_attempts = login_attempts + 1 WHERE userId = ?",
                    [userId]);
                return res.json({ ok: false, reason: "too_fast" });
            }
            // ❌ 사용한 캡차 데이터 삭제 (1회성 유지)
            db.query("DELETE FROM captcha WHERE captchaId = ?", [captchaId]);

            // 2. 캡차 결과에 따른 사용자 실패 횟수 후처리
            if (String(answer) === data.answer) {
                // 캡차 정답 ⭕ : 해당 유저의 로그인 실패 횟수를 0으로 초기화
                db.query(
                    "UPDATE users SET login_attempts = 0 WHERE userId = ?",
                    [userId],
                    (updateErr) => {
                        if (updateErr) console.error("실패 횟수 초기화 실패:", updateErr);

                        // 성공 응답 반환
                        return res.json({ ok: true, reason: "success" });
                    }
                );
            } else {
                // 캡차 오답 ❌ : 해당 유저의 로그인 실패 횟수를 +1 증가
                db.query(
                    "UPDATE users SET login_attempts = login_attempts + 1 WHERE userId = ?",
                    [userId],
                    (updateErr) => {
                        if (updateErr) console.error("실패 횟수 누적 실패:", updateErr);

                        // 실패 응답 반환
                        return res.json({ ok: false, reason: "fail" });
                    }
                );
            }
        }
    );
});

module.exports = router;