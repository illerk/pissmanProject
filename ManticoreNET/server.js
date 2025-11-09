import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const USERS_FILE = path.join(__dirname, "users.json");
const POSTS_FILE = path.join(__dirname, "posts.json");
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const BASE_PATH = process.env.BASE_PATH || ""; // e.g. "/ManticoreNET"
const API_BASE = (BASE_PATH === "/") ? "/api" : (BASE_PATH + "/api");

// changed: increase JSON and urlencoded body size limits to allow large base64 images
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// serve static files under BASE_PATH
if (BASE_PATH && BASE_PATH !== "/") {
  app.use(BASE_PATH, express.static(path.join(__dirname, "public")));
} else {
  app.use(express.static(path.join(__dirname, "public")));
}

// move API routes onto a router and mount under `${API_BASE}`
const api = express.Router();

// ensure users file exists
if (!fs.existsSync(USERS_FILE)) {
  fs.writeJsonSync(USERS_FILE, []);
}

// ensure posts file exists
if (!fs.existsSync(POSTS_FILE)) {
  fs.writeJsonSync(POSTS_FILE, []);
}

// ensure messages file exists
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeJsonSync(MESSAGES_FILE, []);
}

// helper to save base64 image to public/posts
async function saveDataUrlImage(dataUrl, destNamePrefix) {
  const matches = String(dataUrl).match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!matches) throw new Error("Invalid image data");
  const mime = matches[1];
  const base64 = matches[2];
  const ext = mime.split("/")[1] || "png";
  const postsDir = path.join(__dirname, "public", "posts");
  await fs.ensureDir(postsDir);
  const filename = `${destNamePrefix}.${ext}`;
  const filepath = path.join(postsDir, filename);
  await fs.writeFile(filepath, Buffer.from(base64, "base64"));
  return `/posts/${filename}`;
}

// регистрация нового пользователя
api.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }

  const users = await fs.readJson(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: "Username already exists" });
  }

  const hash = await bcrypt.hash(password, 10);
  users.push({ username, password: hash });
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });
  res.json({ success: true });
});

// вход в систему
api.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const users = await fs.readJson(USERS_FILE);

  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(400).json({ error: "User not found" });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ error: "Wrong password" });
  }

  res.json({ success: true });
});

// получить профиль пользователя
api.get("/user/:username", async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: "Missing username" });
  const users = await fs.readJson(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user) return res.status(404).json({ error: "User not found" });
  // возвращаем профиль без пароля
  const { password, ...profile } = user;
  res.json({ success: true, profile });
});

// обновить профиль (age, gender и т.д.)
api.post("/profile", async (req, res) => {
  const { username, age, gender } = req.body;
  if (!username) return res.status(400).json({ error: "Missing username" });
  const users = await fs.readJson(USERS_FILE);
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  users[idx].age = age ?? users[idx].age ?? "";
  users[idx].gender = gender ?? users[idx].gender ?? "";
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });
  res.json({ success: true, profile: { ...users[idx], password: undefined } });
});

// загрузка аватарки (ожидается dataURL в поле image)
api.post("/avatar", async (req, res) => {
  const { username, image } = req.body;
  if (!username || !image) return res.status(400).json({ error: "Missing username or image" });

  const users = await fs.readJson(USERS_FILE);
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  // data:image/png;base64,AAA...
  const matches = image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: "Invalid image data" });

  const mime = matches[1]; // e.g. image/png
  const base64 = matches[2];
  const ext = mime.split("/")[1] || "png";

  const avatarsDir = path.join(__dirname, "public", "avatars");
  await fs.ensureDir(avatarsDir);

  const filename = `${username}.${ext}`;
  const filepath = path.join(avatarsDir, filename);
  const buffer = Buffer.from(base64, "base64");
  await fs.writeFile(filepath, buffer);

  const publicPath = `/avatars/${filename}`;
  users[idx].avatar = publicPath;
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });

  res.json({ success: true, url: publicPath });
});

// получить всех пользователей (для contacts) — без паролей
api.get("/users", async (req, res) => {
  const users = await fs.readJson(USERS_FILE);
  const safe = users.map(u => {
    const { password, ...rest } = u;
    return rest;
  });
  res.json({ success: true, users: safe });
});

// получить посты пользователя
api.get("/posts/:username", async (req, res) => {
  const { username } = req.params;
  const posts = await fs.readJson(POSTS_FILE);
  const userPosts = posts.filter(p => p.username === username).sort((a,b)=>b.createdAt-a.createdAt);
  res.json({ success: true, posts: userPosts });
});

// создать пост (username, text, optional image as dataURL)
api.post("/posts", async (req, res) => {
  const { username, text, image } = req.body;
  if (!username) return res.status(400).json({ error: "Missing username" });
  const posts = await fs.readJson(POSTS_FILE);
  const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
  const post = {
    id,
    username,
    text: text ?? "",
    image: null,
    createdAt: Date.now(),
    votes: [], // {username, vote}
    comments: [] // {id, username, text, createdAt, votes:[]}
  };
  if (image) {
    try {
      post.image = await saveDataUrlImage(image, `post-${id}`);
    } catch (e) {
      return res.status(400).json({ error: "Invalid image data" });
    }
  }
  posts.push(post);
  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
  res.json({ success: true, post });
});

// удалить пост (только владелец)
api.delete("/posts/:id", async (req, res) => {
  const { id } = req.params;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Missing username" });
  const posts = await fs.readJson(POSTS_FILE);
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Post not found" });
  if (posts[idx].username !== username) return res.status(403).json({ error: "Not allowed" });
  // optionally remove image file
  if (posts[idx].image) {
    const imgPath = path.join(__dirname, "public", posts[idx].image.replace(/^\//,""));
    if (fs.existsSync(imgPath)) await fs.remove(imgPath);
  }
  posts.splice(idx,1);
  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
  res.json({ success: true });
});

// голос по посту (body: username, vote = 1 or -1)
api.post("/posts/:id/vote", async (req, res) => {
  const { id } = req.params;
  const { username, vote } = req.body;
  if (!username || ![1,-1].includes(Number(vote))) return res.status(400).json({ error: "Invalid input" });
  const posts = await fs.readJson(POSTS_FILE);
  const p = posts.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Post not found" });
  const existing = p.votes.find(v => v.username === username);
  if (!existing) {
    p.votes.push({ username, vote: Number(vote) });
  } else if (existing.vote === Number(vote)) {
    // same vote => remove (toggle)
    p.votes = p.votes.filter(v => v.username !== username);
  } else {
    // change vote
    existing.vote = Number(vote);
  }
  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
  res.json({ success: true, votes: p.votes });
});

// добавить комментарий к посту
api.post("/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const { username, text } = req.body;
  if (!username || !text) return res.status(400).json({ error: "Missing data" });
  const posts = await fs.readJson(POSTS_FILE);
  const p = posts.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Post not found" });
  const cid = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);
  const comment = { id: cid, username, text, createdAt: Date.now(), votes: [] };
  p.comments.push(comment);
  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
  res.json({ success: true, comment });
});

// голос по комменту (body: username, vote)
api.post("/comments/:id/vote", async (req, res) => {
  const { id } = req.params;
  const { username, vote } = req.body;
  if (!username || ![1,-1].includes(Number(vote))) return res.status(400).json({ error: "Invalid input" });
  const posts = await fs.readJson(POSTS_FILE);
  let found = false;
  for (const p of posts) {
    const c = p.comments.find(cm => cm.id === id);
    if (c) {
      found = true;
      const existing = c.votes.find(v => v.username === username);
      if (!existing) c.votes.push({ username, vote: Number(vote) });
      else if (existing.vote === Number(vote)) c.votes = c.votes.filter(v => v.username !== username);
      else existing.vote = Number(vote);
      await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
      return res.json({ success: true, votes: c.votes });
    }
  }
  if (!found) return res.status(404).json({ error: "Comment not found" });
});

// получить все посты (лента)
api.get("/posts", async (req, res) => {
  const posts = await fs.readJson(POSTS_FILE);
  // newest first
  const sorted = posts.slice().sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, posts: sorted });
});

// helper: conversation key
function convoKey(a, b) {
  const arr = [String(a), String(b)].sort();
  return arr.join("--");
}

// helper: save message
async function saveMessage(a, b, message) {
  const messages = await fs.readJson(MESSAGES_FILE);
  const key = convoKey(a, b);
  const convo = messages.find(m => m.key === key);
  if (convo) {
    convo.messages.push(message);
  } else {
    messages.push({ key, users: [a, b], messages: [message] });
  }
  await fs.writeJson(MESSAGES_FILE, messages, { spaces: 2 });
}

// helper: load conversation
async function loadConversation(a, b) {
  const messages = await fs.readJson(MESSAGES_FILE);
  const key = convoKey(a, b);
  const convo = messages.find(m => m.key === key);
  return convo ? convo.messages : [];
}

// REST endpoint: get conversation between two users
app.get("/api/messages/:a/:b", async (req, res) => {
  const { a, b } = req.params;
  if (!a || !b) return res.status(400).json({ error: "Missing users" });

  // load messages, mark as read for requester 'a' messages that were sent to 'a'
  const msgsAll = await fs.readJson(MESSAGES_FILE);
  const key = convoKey(a, b);
  const convo = msgsAll.find(m => m.key === key);
  const msgs = convo ? convo.messages : [];

  // ensure messages have readBy array; mark those addressed to 'a' as read by 'a'
  let changed = false;
  for (const m of msgs) {
    if (!Array.isArray(m.readBy)) m.readBy = [];
    if (m.to === a && !m.readBy.includes(a)) {
      m.readBy.push(a);
      changed = true;
    }
  }
  if (changed) {
    // write back updated messages structure
    await fs.writeJson(MESSAGES_FILE, msgsAll, { spaces: 2 });
  }

  res.json({ success: true, messages: msgs });
});

// new: get unread counts for a user
app.get("/api/unread/:username", async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: "Missing username" });

  const messages = await fs.readJson(MESSAGES_FILE);
  const counts = {}; // partner -> count
  let total = 0;
  for (const convo of messages) {
    for (const m of convo.messages || []) {
      if (m.to === username) {
        if (!Array.isArray(m.readBy) || !m.readBy.includes(username)) {
          counts[m.from] = (counts[m.from] || 0) + 1;
          total++;
        }
      }
    }
  }
  res.json({ success: true, unread: counts, total });
});

// after defining all api.* routes:
app.use(API_BASE, api);

// adjust WebSocket server to listen on path `${BASE_PATH}/ws`
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: (BASE_PATH || "") + "/ws" });

const clients = new Map(); // username -> ws

wss.on("connection", (ws) => {
  let username = null;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.type === "auth" && msg.username) {
      username = msg.username;
      clients.set(username, ws);
      ws.send(JSON.stringify({ type: "auth_ok", username }));
      return;
    }

    if (msg.type === "message") {
      const { from, to, text, image } = msg;
      if (!from || !to) return;
      const message = {
        id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8),
        from,
        to,
        text: text ?? "",
        image: image ?? null,
        createdAt: Date.now(),
        readBy: [from] // sender has 'read' the message
      };
      // save
      await saveMessage(from, to, message);

      // deliver to recipient if connected
      const recipientWs = clients.get(to);
      if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
        recipientWs.send(JSON.stringify({ type: "message", message }));
      }
      // echo back to sender
      if (clients.get(from) && clients.get(from).readyState === WebSocket.OPEN) {
        clients.get(from).send(JSON.stringify({ type: "message", message }));
      }
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  ws.on("close", () => {
    if (username) clients.delete(username);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}${BASE_PATH}`);
});
