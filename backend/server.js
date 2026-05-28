const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const verificationCodes = new Map();
const CODE_TTL_MS = 3 * 60 * 1000;

app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const createMailTransporter = () => {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        return null;
    }

    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
        },
    });
};

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

db.connect((err) => {
    if (err) {
        console.log("db connect error:", err);
        return;
    }

    console.log("mysql connected");

    const createTable = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            userid VARCHAR(50) UNIQUE,
            email VARCHAR(100) UNIQUE,
            password VARCHAR(255)
        )
    `;

    db.query(createTable, (err) => {
        if (err) {
            console.log("table create error:", err);
            return;
        }

        console.log("users table ready");
    });
});

app.post("/send-email-code", async (req, res) => {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
        return res.status(400).send("invalid email");
    }

    const transporter = createMailTransporter();
    if (!transporter) {
        return res.status(500).send("email config missing");
    }

    const code = generateCode();
    verificationCodes.set(email, {
        code,
        expiresAt: Date.now() + CODE_TTL_MS,
        verified: false,
    });

    try {
        await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: email,
            subject: "회원가입 이메일 인증번호",
            text: `인증번호는 ${code} 입니다. 3분 안에 입력해 주세요.`,
        });

        res.send("sent");
    } catch (err) {
        verificationCodes.delete(email);
        console.log("send mail error:", err);
        res.status(500).send("email send error");
    }
});

app.post("/verify-email-code", (req, res) => {
    const { email, code } = req.body;
    const verification = verificationCodes.get(email);

    if (!email || !code || !verification) {
        return res.status(400).send("invalid code");
    }

    if (verification.expiresAt < Date.now()) {
        verificationCodes.delete(email);
        return res.status(400).send("expired");
    }

    if (verification.code !== code) {
        return res.status(400).send("invalid code");
    }

    verificationCodes.set(email, {
        ...verification,
        verified: true,
    });

    res.send("verified");
});

app.post("/signup", (req, res) => {
    const { userid, email, password } = req.body;
    const verification = verificationCodes.get(email);

    if (!userid || !email || !password) {
        return res.status(400).send("missing fields");
    }

    if (!verification || !verification.verified || verification.expiresAt < Date.now()) {
        return res.status(403).send("email not verified");
    }

    const sql =
        "INSERT INTO users (userid, password, email) VALUES (?, ?, ?)";

    db.query(sql, [userid, password, email], (err) => {
        if (err && err.code === "ER_DUP_ENTRY") {
            return res.status(409).send("duplicate");
        }

        if (err) {
            console.log(err);
            return res.status(500).send("db error");
        }

        verificationCodes.delete(email);
        res.send("success");
    });
});

const port = process.env.PORT || 3001;

app.listen(port, () => {
    console.log(`server running on port ${port}`);
});
