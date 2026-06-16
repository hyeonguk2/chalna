const express = require("express");
const { createCanvas } = require("canvas");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

const store = {};

function randomText(len = 5) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let t = "";
    for (let i = 0; i < len; i++) {
        t += chars[Math.floor(Math.random() * chars.length)];
    }
    return t;
}

router.get("/", (req, res) => {

    const id = uuidv4();
    const text = randomText();

    store[id] = {
        text,
        time: Date.now()
    };

    const canvas = createCanvas(180, 70);
    const ctx = canvas.getContext("2d");

    // 배경 (그라데이션)
    const grad = ctx.createLinearGradient(0,0,180,70);
    grad.addColorStop(0, "#f5f5f5");
    grad.addColorStop(1, "#ddd");
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,180,70);

    // 노이즈 점
    for (let i = 0; i < 40; i++) {
        ctx.fillStyle = "#999";
        ctx.fillRect(
            Math.random()*180,
            Math.random()*70,
            1,
            1
        );
    }

    // 글자 왜곡 출력
    ctx.font = "bold 32px Arial";

    for (let i = 0; i < text.length; i++) {

        const x = 30 + i * 25;
        const y = 40 + Math.random()*5;

        const angle = (Math.random() - 0.5) * 0.5;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        ctx.fillStyle = "#111";
        ctx.fillText(text[i], 0, 0);

        ctx.restore();
    }

    // 선 추가
    for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = "#888";
        ctx.beginPath();
        ctx.moveTo(Math.random()*180, Math.random()*70);
        ctx.lineTo(Math.random()*180, Math.random()*70);
        ctx.stroke();
    }

    res.json({
        captchaId: id,
        image: canvas.toDataURL()
    });
});

// =======================
// 검증
// =======================
router.post("/verify", (req,res)=>{

    const { captchaId, answer } = req.body;

    const data = store[captchaId];

    if(!data) return res.status(400).send("expired");

    // 시간 제한 (10초)
    if(Date.now() - data.time > 10000){
        delete store[captchaId];
        return res.status(403).send("timeout");
    }

    if(data.text === answer){
        delete store[captchaId];
        return res.send("success");
    }

    return res.status(401).send("fail");
});

module.exports = router;