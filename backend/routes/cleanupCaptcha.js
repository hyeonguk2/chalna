module.exports = (db) => {
    setInterval(() => {
        const expire = Date.now() - 20 * 1000;

        db.query(
            "DELETE FROM captcha WHERE created_at < ?",
            [expire]
        );
    }, 5000);
};