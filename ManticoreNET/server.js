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
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, "users.json");
const POSTS_FILE = path.join(__dirname, "posts.json");
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const COMMENTS_FILE = path.join(__dirname, "comments.json");
const BASE_PATH = process.env.BASE_PATH || ""; 
const API_BASE = (BASE_PATH === "/") ? "/api" : (BASE_PATH + "/api");

app.use((req, res, next) => {
  const cl = req.headers['content-length'];
  if (cl) console.log(`[req] ${req.method} ${req.url} Content-Length: ${cl}`);
  return next();
});
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
	// If URL contains /api/ somewhere later, strip everything before it so routes mounted at /api/... match.
	const apiIndex = req.url.indexOf("/api/");
	if (apiIndex > 0) {
		req.url = req.url.slice(apiIndex);
		return next();
	}
	// If URL is prefixed with "/public/", strip that prefix so static files served from /public are reachable.
	if (req.url.startsWith("/public/")) {
		req.url = req.url.slice("/public".length); // "/public/xyz" -> "/xyz"
		return next();
	}
	// If nginx proxies with a base path like /ManticoreNET/, strip that base if present (for static files).
	// Detect common pattern: "/ManticoreNET/<rest>"
	const m = req.url.match(/^\/[A-Za-z0-9_-]+(\/.*)$/);
	if (m) {
		// only strip when the remaining path looks like an app path (e.g. starts with /api/ or /avatars/ or /index.html or /profile.html)
		const rest = m[1] || "/";
		if (rest.startsWith("/api/") || rest.startsWith("/avatars/") || rest.startsWith("/posts/") ||
			rest === "/" || rest.endsWith(".html") || rest.endsWith(".css") || rest.endsWith(".js")) {
			req.url = rest;
		}
	}
	return next();
});

app.use(express.static(path.join(__dirname, "public")));


const api = express.Router();


if (!fs.existsSync(USERS_FILE)) {
  fs.writeJsonSync(USERS_FILE, []);
}


if (!fs.existsSync(POSTS_FILE)) {
  fs.writeJsonSync(POSTS_FILE, []);
}

try {
  const postsRaw = fs.readJsonSync(POSTS_FILE);
  const sanitized = (Array.isArray(postsRaw) ? postsRaw : []).map(p => {
    const { ...keep } = p;
    // remove legacy voting fields if present
    delete keep.votesBy;
    delete keep.score;
    // ensure likes array and count exist
    keep.likes = Array.isArray(keep.likes) ? keep.likes : (keep.likes ? Object.values(keep.likes) : []);
    keep.likesCount = (typeof keep.likesCount === "number") ? keep.likesCount : (Array.isArray(keep.likes) ? keep.likes.length : 0);
    return keep;
  });
  fs.writeJsonSync(POSTS_FILE, sanitized, { spaces: 2 });
} catch (e) {
  // ignore if file not readable yet
}


if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeJsonSync(MESSAGES_FILE, []);
}


if (!fs.existsSync(COMMENTS_FILE)) {
  fs.writeJsonSync(COMMENTS_FILE, []);
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
  // add default bio empty
  users.push({ username, password: hash, bio: "" });
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });
  res.json({ success: true });
});


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
  const { username, age, gender, bio } = req.body;
  if (!username) return res.status(400).json({ error: "Missing username" });
  const users = await fs.readJson(USERS_FILE);
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  users[idx].age = age ?? users[idx].age ?? "";
  users[idx].gender = gender ?? users[idx].gender ?? "";
  users[idx].bio = (typeof bio === "string") ? bio : (users[idx].bio ?? "");
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });
  res.json({ success: true, profile: { ...users[idx], password: undefined } });
});


api.post("/avatar", async (req, res) => {
  const { username, image } = req.body;
  if (!username || !image) return res.status(400).json({ error: "Missing username or image" });

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
    likes: [],       // <-- initialize likes
    likesCount: 0    // <-- initialize likesCount
    // removed votesBy/score (voting disabled)
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

// --- NEW: simple likes toggle endpoint ---
api.post("/posts/:id/likes", async (req, res) => {
  const { id } = req.params;
  const { username } = req.body;
  if (!id) return res.status(400).json({ error: "Missing post id" });
  if (!username) return res.status(400).json({ error: "Missing username" });

  const posts = await fs.readJson(POSTS_FILE);
  const idx = (Array.isArray(posts) ? posts : []).findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Post not found" });

  posts[idx].likes = Array.isArray(posts[idx].likes) ? posts[idx].likes : (posts[idx].likes ? Object.values(posts[idx].likes) : []);
  const has = posts[idx].likes.includes(username);
  if (has) {
    posts[idx].likes = posts[idx].likes.filter(u => u !== username);
  } else {
    posts[idx].likes.push(username);
  }
  posts[idx].likesCount = posts[idx].likes.length;

  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
  res.json({ success: true, post: posts[idx] });
});

// --- NEW: comments endpoints ---
api.get("/comments/:postId", async (req, res) => {
  const { postId } = req.params;
  if (!postId) return res.status(400).json({ error: "Missing postId" });
  const comments = await fs.readJson(COMMENTS_FILE);
  const list = (Array.isArray(comments) ? comments : []).filter(c => c.postId === postId)
               .sort((a,b) => a.createdAt - b.createdAt);
  res.json({ success: true, comments: list });
});

api.post("/comments/:postId", async (req, res) => {
  const { postId } = req.params;
  const { username, text } = req.body;
  if (!postId) return res.status(400).json({ error: "Missing postId" });
  if (!username) return res.status(400).json({ error: "Missing username" });
  const comments = await fs.readJson(COMMENTS_FILE);
  const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
  const comment = {
    id,
    postId,
    username,
    text: String(text ?? ""),
    createdAt: Date.now()
  };
  comments.push(comment);
  await fs.writeJson(COMMENTS_FILE, comments, { spaces: 2 });

  // attempt to find post owner and notify over websockets
  try {
    const posts = await fs.readJson(POSTS_FILE);
    const post = (Array.isArray(posts) ? posts : []).find(p => p.id === postId);
    if (post) {
      const payload = JSON.stringify({ type: "comment", comment, post });
      // notify post owner
      const ownerWs = clients.get(post.username);
      if (ownerWs && ownerWs.readyState === WebSocket.OPEN) ownerWs.send(payload);
      // notify comment author (if connected)
      const authorWs = clients.get(username);
      if (authorWs && authorWs.readyState === WebSocket.OPEN) authorWs.send(payload);
    }
  } catch (e) {
    // ignore notification failures
  }

  res.json({ success: true, comment });
});

// --- REMOVED: DELETE /posts/:id endpoint (post deletion disabled) ---
// original handler removed so server no longer accepts requests to delete posts


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

// Ensure API also responds on plain "/api" so clients hitting "/api/..." (root) work
// This makes the server tolerant to requests that don't include the app base path.
if (API_BASE !== "/api") {
  app.use("/api", api);
}

// --- ADDED: accept API mounted under a dynamic first segment like "/ManticoreNET/api"
// This makes endpoints reachable when requests arrive as "/<someBase>/api/..." (e.g. "/ManticoreNET/api/posts/...")
app.use("/:base/api", api);

// --- ADDED: serve a tiny default-avatar fallback so clients won't 404 if default-avatar.png missing in /public
// Responds both on "/default-avatar.png" and "/:base/default-avatar.png"
const DEFAULT_AVATAR_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
app.get(['/default-avatar.png', '/:base/default-avatar.png'], (req, res) => {
  const buf = Buffer.from(DEFAULT_AVATAR_BASE64, 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.send(buf);
});

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
