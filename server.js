const http = require("http");
const express = require("express");
const socketIo = require("socket.io");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// dotenv 절대 내리면 안됨
require("dotenv").config();
const openaii = require("openai");
const openai = new openaii.OpenAI();

const db = require("./database/db");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 업로드 폴더가 존재하지 않으면 생성
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// 정적 파일 서빙 설정
app.use('/uploads', express.static(uploadDir));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true,
  },
});

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage: storage });

// 클라이언트 소켓 연결 관리
let socketConnected = false;

io.on("connection", (socket) => {
  console.log("A user connected");
  socketConnected = true;

  socket.on("chat message", async (msg) => {
    console.log("Received message from client:", msg);

    let sentToRasa = false;

    try {
      console.log("Trying to communicate with Rasa...");
      const response = await axios.post(
        "http://localhost:5005/webhooks/rest/webhook",
        {
          sender: "test_user",
          message: msg,
        },
        {
          timeout: 10000, // 10초 타임아웃 설정
        }
      );

      if (response.data && response.data.length > 0) {
        response.data.forEach((message) => {
          socket.emit("chat message", message.text);
        });
        sentToRasa = true;
        console.log("Message sent to Rasa:", response.data);
      } else {
        throw new Error("Rasa response is empty");
      }
    } catch (error) {
      console.error("Error communicating with Rasa or timeout occurred:", error);
    }

    if (!sentToRasa) {
      // Rasa가 응답하지 않거나 오류가 발생하면 ChatGPT로 요청
      try {
        console.log("Trying to communicate with ChatGPT...");
        const gptResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "현재 너의 역할은 내가 [지역 명]을 주면 [대한민국 청년 대상]으로 하는 [정책]을 알려주는 것이다. [대한민국 지역 별]로 [일자리분야/주거분야/교육분야/복지문화분야/참여권리분야] 이렇게 4개 분야로 나누고 해당 분야마다의 정책을 소개해주는 것이다. 그리고 답변의 말투는 일반적인 챗봇처럼 ~~다, 제한 :~~~ 이런씩으로 깔끔하고 간결하고 명확하게 보이게 반말 금지하고 답변해주면 되",
            },
            { role: "user", content: msg },
          ],
          max_tokens: 1000,
        });

        console.log("ChatGPT response:", gptResponse.choices.length > 0);

        if (
          gptResponse &&
          gptResponse.choices &&
          gptResponse.choices.length > 0
        ) {
          const gptAnswer = gptResponse.choices[0].message.content;
          socket.emit("chat message", gptAnswer);
        } else {
          throw new Error("Invalid ChatGPT response");
        }
      } catch (gptError) {
        console.error("Error communicating with ChatGPT:", gptError);
        socket.emit(
          "chat message",
          "현재 시스템에 문제가 발생했습니다. 나중에 다시 시도해주세요."
        );
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
    socketConnected = false;
  });
});

// 회원가입
app.post("/signup", (req, res) => {
  const { userName, userId, userPw, userJob } = req.body;
  const query =
    "INSERT INTO userinfo (userName, userId, userPw, userJob) VALUES (?, ?, ?, ?)";
  db.query(query, [userName, userId, userPw, userJob], (err, result) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.send("User registered successfully!");
  });
});

// 로그인
app.post("/login", (req, res) => {
  const { userId, userPw } = req.body;
  console.log("Received login request:", { userId, userPw });

  const query = "SELECT * FROM userinfo WHERE userId = ? AND userPw = ?";
  db.query(query, [userId, userPw], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).send(err);
    }
    console.log("Database query results:", results);
    if (results.length > 0) {
      // 로그인 성공
      res.send({ message: "Login successful!", user: results[0] });
    } else {
      // 로그인 실패
      res.status(401).send({ message: "Invalid credentials" });
    }
  });
});

// 게시글 작성
app.post("/api/submit-post", upload.single('file'), (req, res) => {
  const { title, content, userName, userJob } = req.body;
  const file = req.file ? req.file.filename : null; // 파일 이름만 저장

  const query = "INSERT INTO board (title, content, userName, userJob, file, createdAt, comments) VALUES (?, ?, ?, ?, ?, NOW(), '')";
  db.query(query, [title, content, userName, userJob, file], (err, result) => {
    if (err) {
      console.error("Error submitting post:", err);
      return res.status(500).send(err);
    }
    res.send("Post submitted successfully!");
  });
});

// 클라이언트 소켓 연결 상태 확인
app.get("/api/socket-status", (req, res) => {
  res.send({ connected: socketConnected });
});

// 게시글 목록 가져오기
app.get("/api/posts", (req, res) => {
  const query = "SELECT id, title, userName, userJob, createdAt FROM board";
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching posts:", err);
      return res.status(500).send(err);
    }
    console.log("Fetched posts:", results);  // 로그 추가
    res.json(results);
  });
});

// 특정 게시글 가져오기
app.get("/api/posts/:id", (req, res) => {
  const { id } = req.params;
  console.log(`Fetching post with id: ${id}`);  // 로그 추가
  const query = "SELECT * FROM board WHERE id = ?";
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching post:", err);
      return res.status(500).send(err);
    }
    if (results.length > 0) {
      const post = results[0];
      post.comments = post.comments ? post.comments.split('\n').filter(Boolean) : [];
      console.log("Fetched post:", post);  // 로그 추가
      res.json(post);
    } else {
      console.log("Post not found");  // 로그 추가
      res.status(404).send({ message: "Post not found" });
    }
  });
});

// 댓글 추가하기
app.post("/api/posts/comment", (req, res) => {
  const { postId, comment } = req.body;
  console.log(`Adding comment to post id: ${postId}`);  // 로그 추가
  const query = "UPDATE board SET comments = CONCAT(IFNULL(comments, ''), ?) WHERE id = ?";
  db.query(query, [comment + '\n', postId], (err, result) => {
    if (err) {
      console.error("Error adding comment:", err);
      return res.status(500).send(err);
    }
    console.log("Comment added successfully");  // 로그 추가
    res.send("Comment added successfully!");
  });
});

// 정책명 가져오기
app.get("/api/policies/:region/:field", (req, res) => {
  const { region, field } = req.params;
  const decodedRegion = decodeURIComponent(region);
  const decodedField = decodeURIComponent(field);
  console.log(`Fetching policies for region: ${decodedRegion}, field: ${decodedField}`); // 로그 추가
  const query = "SELECT policyName FROM policies WHERE region = ? AND field = ?";
  db.query(query, [decodedRegion, decodedField], (err, results) => {
    if (err) {
      console.error("Error fetching policies:", err);
      return res.status(500).send(err);
    }
    console.log("Fetched policies:", results);  // 로그 추가
    res.json(results);
  });
});

// 정책 설명 가져오기
app.get("/api/policy-description/:policyName", (req, res) => {
  const { policyName } = req.params;
  const decodedPolicyName = decodeURIComponent(policyName);
  console.log(`Fetching description for policy: ${decodedPolicyName}`); // 로그 추가
  const query = "SELECT description FROM policies WHERE policyName = ?";
  db.query(query, [decodedPolicyName], (err, results) => {
    if (err) {
      console.error("Error fetching policy description:", err);
      return res.status(500).send(err);
    }
    if (results.length > 0) {
      console.log("Fetched policy description:", results[0]); // 로그 추가
      res.json(results[0]);
    } else {
      console.log("Policy not found"); // 로그 추가
      res.status(404).send({ message: "Policy not found" });
    }
  });
});

// 게시글 삭제하기
app.delete("/api/posts/:id", (req, res) => {
  const { id } = req.params;
  console.log(`Attempting to delete post with id: ${id}`);
  const query = "DELETE FROM board WHERE id = ?";
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting post:", err);
      return res.status(500).send(err);
    }
    if (result.affectedRows > 0) {
      console.log(`Post with id: ${id} deleted successfully`);
      res.send({ message: "Post deleted successfully" });
    } else {
      console.log(`Post with id: ${id} not found`);
      res.status(404).send({ message: "Post not found" });
    }
  });
});

server.listen(5000, () => {
  console.log("Server is running on port 5000");
});
