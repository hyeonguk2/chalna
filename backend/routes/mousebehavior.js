const express = require('express');

// ==========================================
// 수학적 유틸리티 함수 (Python numpy 대체)
// ==========================================
const calculateMean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

const calculateStdDev = (arr) => {
    if (arr.length <= 1) return 0;
    const mean = calculateMean(arr);
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
};

// 1차 선형 회귀 (Linear Regression) 
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

// ==========================================
// 2. 인지적 직관 기반 봇 판별 알고리즘
// ==========================================
const analyzeBotBehavior = (metrics) => {
    let botScore = 0;

    // --- [1] 마우스 궤적 선형성 분석 (배점 60점) ---
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

    // --- [2] 클릭 타이밍 분포 분석 (배점 40점) ---
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

    console.log(`[Bot Detection] 트래킹 수: ${traj.length}, 클릭 쌍: ${holdTimes.length} -> 산출된 위험 점수: ${botScore}`);

    return botScore >= 60;
};

// ==========================================
// 3. 로그인 및 캡차 검증 API 라우터 (DB 연동)
// ==========================================
// 외부에서 db 객체를 주입받도록 module.exports를 함수형태로 변경합니다.
module.exports = (db) => {
    const router = express.Router();

    router.post("/analyze-login", (req, res) => {
        try {
            const payload = req.body;

            // (1) 기본 유효성 검증
            if (!payload.username || !payload.password) {
                return res.status(400).json({ success: false, isBot: false, message: "ID/PW 누락" });
            }
            // === 👇 이 부분을 추가하세요 👇 ===
            console.log("=== [프론트에서 넘어온 마우스 데이터] ===");
            console.log(JSON.stringify(payload.behaviorMetrics, null, 2));
            // ===================================
            // (2) 실제 DB 연동: 아이디/비밀번호 검증
            const sql = "SELECT * FROM users WHERE userid = ? AND password = ?";
            db.query(sql, [payload.username, payload.password], (err, results) => {
                if (err) {
                    console.error("DB Query Error:", err);
                    return res.status(500).json({ success: false, message: "내부 서버 오류 (DB)" });
                }

                // 일치하는 유저 정보가 없을 때
                if (results.length === 0) {
                    return res.status(401).json({ success: false, isBot: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." });
                }

                // (3) 팀원이 만든 캡차 모듈 결과값 검증
                if (payload.captchaData && payload.captchaData.answer === false) {
                    return res.status(401).json({ success: false, isBot: false, message: "캡차 인증 실패" });
                }

                // (4) 핵심 로직: 마우스 행동 기반 봇 분석 수행
                const isBot = analyzeBotBehavior(payload.behaviorMetrics);

                // (5) 결과 응답
                if (isBot) {
                    return res.json({ success: true, isBot: true, message: "비정상 패턴 감지" });
                } else {
                    return res.json({ success: true, isBot: false, message: "로그인 및 인증 성공" });
                }
            });
        } catch (error) {
            console.error("서버 에러 발생:", error);
            return res.status(500).json({ success: false, message: "내부 서버 오류" });
        }
    });

    return router;
};