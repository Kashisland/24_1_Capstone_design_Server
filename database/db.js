// TESTSERVER/database/db.js
const mysql = require("mysql");

const db = mysql.createConnection({
  host: "localhost",
  user: "root", // MySQL 사용자 이름
  password: "1234",
  database: "info", // 사용할 데이터베이스 이름
  port: 3307,
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err.stack);
    return;
  }
  console.log("Connected to database.");
});

module.exports = db;
