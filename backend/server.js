const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// DB 연결
db.connect((err) => {
    if (err) {
        console.log("db connect error:", err);
        return;
    }

    console.log("mysql connected");

    // 테이블 자동 생성
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

app.post("/signup", (req, res) => {
    const { userid, email, password } = req.body;

    const sql =
        "INSERT INTO users (userid, password, email) VALUES (?, ?, ?)";

    db.query(sql, [userid, password, email], (err, result) => {
        if (err && err.code === "ER_DUP_ENTRY") {
            return res.status(409).send("duplicate");
        }

        if (err) {
            console.log(err);
            return res.status(500).send("db error");
        }

        res.send("success");
    });
});

const port = process.env.PORT || 3001;

app.listen(port, () => {
    console.log(`server running on port ${port}`);
});
