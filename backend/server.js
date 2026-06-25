const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();

const CODE_TTL_MS = 3 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

const FRONT_URL = process.env.FRONT_URL || "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";

if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
}

const corsOptions = {
    origin: FRONT_URL,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
};

app.use(cors(corsOptions));

app.use(express.json());

const createRateLimiter = ({ windowMs, max, keyPrefix }) => {
    const hits = new Map();

    return (req, res, next) => {
        const now = Date.now();
        const key = `${keyPrefix}:${req.ip}`;
        const entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (entry.count >= max) {
            res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
            return res.status(429).json({ error: "too_many_requests" });
        }

        entry.count += 1;
        return next();
    };
};

app.use("/api/login", createRateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: "login" }));
app.use("/mvcaptcha/verify", createRateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: "captcha_verify" }));
app.use("/mvcaptcha", createRateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: "captcha" }));

app.use(session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax"
    }
}));

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

const query = (sql, values = []) =>
    new Promise((resolve, reject) => {
        db.query(sql, values, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });

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
            password VARCHAR(255),
            captchatype ENUM('A','B','C','D'),
            captcha_level INT DEFAULT 1,
            login_attempts INT DEFAULT 0,
            lockout_time BIGINT DEFAULT 0,
            lockout_count INT DEFAULT 0
        )
    `;

    db.query(createTable, (err) => {
        if (err) {
            console.log("table create error:", err);
            return;
        }

        console.log("users table ready");

        db.query("ALTER TABLE users ADD COLUMN captcha_level INT DEFAULT 1", (alterErr) => {
            if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                console.log("captcha_level alter error:", alterErr);
            }

            db.query("UPDATE users SET captcha_level = 2, login_attempts = 0 WHERE login_attempts = -222");
            db.query("UPDATE users SET captcha_level = 1, login_attempts = 0 WHERE login_attempts < 0");
        });

        db.query("ALTER TABLE users ADD COLUMN lockout_count INT DEFAULT 0", (alterErr) => {
            if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
                console.log("lockout_count alter error:", alterErr);
            }
        });

        const createVerificationTable = `
            CREATE TABLE IF NOT EXISTS email_verifications (
                email VARCHAR(100) PRIMARY KEY,
                code VARCHAR(6) NOT NULL,
                expires_at BIGINT NOT NULL,
                last_sent_at BIGINT NOT NULL DEFAULT 0,
                verified BOOLEAN NOT NULL DEFAULT FALSE
            )
        `;

        db.query(createVerificationTable, (err) => {
            if (err) {
                console.log("verification table create error:", err);
                return;
            }

            console.log("email verifications table ready");
        });
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
    const now = Date.now();
    const expiresAt = now + CODE_TTL_MS;

    try {
        const rows = await query(
            "SELECT last_sent_at FROM email_verifications WHERE email = ?",
            [email]
        );

        const verification = rows[0];

        if (verification && now - verification.last_sent_at < RESEND_COOLDOWN_MS) {
            const retryAfter = Math.ceil(
                (RESEND_COOLDOWN_MS - (now - verification.last_sent_at)) / 1000
            );

            return res.status(429).json({
                error: "resend too soon",
                retryAfter
            });
        }

        await query(
            `
            INSERT INTO email_verifications 
                (email, code, expires_at, last_sent_at, verified)
            VALUES (?, ?, ?, ?, FALSE)
            ON DUPLICATE KEY UPDATE
                code = VALUES(code),
                expires_at = VALUES(expires_at),
                last_sent_at = VALUES(last_sent_at),
                verified = FALSE
            `,
            [email, code, expiresAt, now]
        );
    } catch (err) {
        console.log("save verification error:", err);
        return res.status(500).send("db error");
    }

    try {
        await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: email,
            subject: "회원가입 이메일 인증번호",
            text: `인증번호는 ${code} 입니다. 3분 안에 입력해 주세요.`,
        });

        res.send("sent");
    } catch (err) {
        await query("DELETE FROM email_verifications WHERE email = ?", [email]).catch(() => {});
        console.log("send mail error:", err);
        res.status(500).send("email send error");
    }
});

app.post("/verify-email-code", async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return res.status(400).send("invalid code");
    }

    try {
        const rows = await query(
            "SELECT code, expires_at FROM email_verifications WHERE email = ?",
            [email]
        );

        const verification = rows[0];

        if (!verification) {
            return res.status(400).send("invalid code");
        }

        if (verification.expires_at < Date.now()) {
            await query("DELETE FROM email_verifications WHERE email = ?", [email]);
            return res.status(400).send("expired");
        }

        if (verification.code !== code) {
            return res.status(400).send("invalid code");
        }

        await query(
            "UPDATE email_verifications SET verified = TRUE WHERE email = ?",
            [email]
        );

        res.send("verified");
    } catch (err) {
        console.log("verify email error:", err);
        res.status(500).send("db error");
    }
});

app.post("/signup", async (req, res) => {
    const { userid, email, password } = req.body;

    if (!userid || !email || !password) {
        return res.status(400).send("missing fields");
    }

    try {
        const rows = await query(
            "SELECT expires_at, verified FROM email_verifications WHERE email = ?",
            [email]
        );

        const verification = rows[0];

        if (!verification || !verification.verified || verification.expires_at < Date.now()) {
            return res.status(403).send("email not verified");
        }

        const passwordHash = await bcrypt.hash(password, 12);

        await query(
            "INSERT INTO users (userid, password, email) VALUES (?, ?, ?)",
            [userid, passwordHash, email]
        );

        await query("DELETE FROM email_verifications WHERE email = ?", [email]);

        res.send("success");
    } catch (err) {
        if (err && err.code === "ER_DUP_ENTRY") {
            return res.status(409).send("duplicate");
        }

        console.log("signup error:", err);
        res.status(500).send("db error");
    }
});

app.use("/mvcaptcha", require("./routes/mvcaptcha"));

const mousebehaviorRouter = require("./routes/mousebehavior")(db);
app.use(mousebehaviorRouter);
app.use("/mousebehavior", mousebehaviorRouter);

const port = process.env.PORT || 3001;

app.listen(port, () => {
    console.log(`server running on port ${port}`);
});
