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
            answerTime VARCHAR(10),
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
    const answerTime = meta[randomVideo].answerTime;

    const createdAt = Date.now();

    db.query(
        "INSERT INTO captcha (captchaId, answerTime, video, created_at) VALUES (?, ?, ?, ?)",
        [id, answerTime, randomVideo, createdAt]
    );

    res.json({
        captchaId: id,
        text: meta[randomVideo].text
        //video: videoUrl
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
// 검증
// =========================
router.post("/verify", (req, res) => {

    const { captchaId, clickTime } = req.body;

    db.query(
        "SELECT * FROM captcha WHERE captchaId = ?",
        [captchaId],
        (err, rows) => {

            if (err || rows.length === 0) {
                return res.status(400).send("invalid");
            }

            const data = rows[0];

            const diff = Math.abs(
                Number(data.answerTime) - Number(clickTime)
            );

            // ✔ 성공 시간설정 포함
            if (diff < 1.0) {
                db.query(
                    "DELETE FROM captcha WHERE captchaId = ?",
                    [captchaId]
                );
                return res.json({ ok: true });
            }

            // ❌ 실패도 삭제 (1회성 유지)
            db.query(
                "DELETE FROM captcha WHERE captchaId = ?",
                [captchaId]
            );

            return res.json({ ok: false });
        }
    );
});

module.exports = router;