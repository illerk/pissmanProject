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

// 💡 Исправлено: задаём путь для сайта
const BASE_PATH = "/ManticoreNET";
const API_BASE = BASE_PATH + "/api";

const USERS_FILE = path.join(__dirname, "users.json");
const POSTS_FILE = path.join(__dirname, "posts.json");
const MESSAGES_FILE = path.join(__dirname, "messages.json");

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// 💡 теперь сервер обслуживает public из /ManticoreNET
app.use(BASE_PATH, express.static(path.join(__dirname, "public")));

const api = express.Router();

// ensure data files exist
for (const f of [USERS_FILE, POSTS_FILE, MESSAGES_FILE]) {
  if (!fs.existsSync(f)) fs.writeJsonSync(f, []);
}

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

// ====================== USERS ======================
api.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing username or password" });

  const users = await fs.readJson(USERS_FILE);
  if (users.find(u => u.username === username))
    return res.status(400).json({ error: "Username already exists" });

  const hash = await bcrypt.hash(password, 10);
  users.push({ username, password: hash });
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });
  res.json({ success: true });
});

api.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const users = await fs.readJson(USERS_FILE);

  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: "User not found" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: "Wrong password" });

  res.json({ success: true });
});

api.get("/user/:username", async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: "Missing username" });
  const users = await fs.readJson(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { password, ...profile } = user;
  res.json({ success: true, profile });
});

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

api.post("/avatar", async (req, res) => {
  const { username, image } = req.body;
  if (!username || !image)
    return res.status(400).json({ error: "Missing username or image" });

  const users = await fs.readJson(USERS_FILE);
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  const matches = image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: "Invalid image data" });

  const mime = matches[1];
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

api.get("/users", async (req, res) => {
  const users = await fs.readJson(USERS_FILE);
  const safe = users.map(u => {
    const { password, ...rest } = u;
    return rest;
  });
  res.json({ success: true, users: safe });
});

// ====================== POSTS ======================
api.get("/posts/:username", async (req, res) => {
  const { username } = req.params;
  const posts = await fs.readJson(POSTS_FILE);
  const userPosts = posts.filter(p => p.username === username).sort((a,b)=>b.createdAt-a.createdAt);
  res.json({ success: true, posts: userPosts });
});

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
    votes: [],
    comments: []
  };
  if (image) {
    try {
      post.image = await saveDataUrlImage(image, `post-${id}`);
    } catch {
      return res.status(400).json({ error: "Invalid image data" });
    }
  }
  posts.push(post);
  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
  res.json({ success: true, post });
});

api.delete("/posts/:id", async (req, res) => {
  const { id } = req.params;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Missing username" });
  const posts = await fs.readJson(POSTS_FILE);
  const idx = posts.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Post not found" });
  if (posts[idx].username !== username) return res.status(403).json({ error: "Not allowed" });

  if (posts[idx].image) {
    const imgPath = path.join(__dirname, "public", posts[idx].image.replace(/^\//,""));
    if (fs.existsSync(imgPath)) await fs.remove(imgPath);
  }
  posts.splice(idx,1);
  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
  res.json({ success: true });
});

api.get("/posts", async (req, res) => {
  const posts = await fs.readJson(POSTS_FILE);
  const sorted = posts.slice().sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, posts: sorted });
});

// ====================== MESSAGES ======================
function convoKey(a, b) {
  return [String(a), String(b)].sort().join("--");
}
async function saveMessage(a, b, message) {
  const messages = await fs.readJson(MESSAGES_FILE);
  const key = convoKey(a, b);
  const convo = messages.find(m => m.key === key);
  if (convo) convo.messages.push(message);
  else messages.push({ key, users: [a, b], messages: [message] });
  await fs.writeJson(MESSAGES_FILE, messages, { spaces: 2 });
}

app.get(BASE_PATH + "/api/messages/:a/:b", async (req, res) => {
  const { a, b } = req.params;
  const msgsAll = await fs.readJson(MESSAGES_FILE);
  const key = convoKey(a, b);
  const convo = msgsAll.find(m => m.key === key);
  const msgs = convo ? convo.messages : [];
  res.json({ success: true, messages: msgs });
});

app.get(BASE_PATH + "/api/unread/:username", async (req, res) => {
  const { username } = req.params;
  const messages = await fs.readJson(MESSAGES_FILE);
  const counts = {};
  let total = 0;
  for (const convo of messages) {
    for (const m of convo.messages || []) {
      if (m.to === username && (!m.readBy || !m.readBy.includes(username))) {
        counts[m.from] = (counts[m.from] || 0) + 1;
        total++;
      }
    }
  }
  res.json({ success: true, unread: counts, total });
});

// подключаем API
app.use(API_BASE, api);

// ====================== WEBSOCKET ======================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: BASE_PATH + "/ws" });
const clients = new Map();

wss.on("connection", (ws) => {
  let username = null;
  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

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
        from, to, text: text ?? "", image: image ?? null,
        createdAt: Date.now(), readBy: [from]
      };
      await saveMessage(from, to, message);
      const rws = clients.get(to);
      if (rws && rws.readyState === WebSocket.OPEN)
        rws.send(JSON.stringify({ type: "message", message }));
      if (clients.get(from) && clients.get(from).readyState === WebSocket.OPEN)
        clients.get(from).send(JSON.stringify({ type: "message", message }));
    }
  });
  ws.on("close", () => { if (username) clients.delete(username); });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}${BASE_PATH}`);
});
