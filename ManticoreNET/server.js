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


if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeJsonSync(MESSAGES_FILE, []);
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
    votes: [], 
    comments: [] 
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

// Helper: normalize votes storage for an entity (post or comment).
// Supports old format "votes" array [{username, vote}] and new in-memory map "votesMap".
// After calling, entity.votesMap will be present. When persisting, we convert back to array.
function ensureVotesMap(entity) {
  if (!entity) return;
  if (!entity.votesMap) {
    entity.votesMap = {};
    if (Array.isArray(entity.votes)) {
      for (const v of entity.votes) {
        try { entity.votesMap[String(v.username)] = Number(v.vote) || 0; } catch(e) {}
      }
    }
  }
}
function votesMapToArray(map) {
  const arr = [];
  for (const [username, vote] of Object.entries(map || {})) {
    arr.push({ username, vote: Number(vote) });
  }
  return arr;
}

// Replace the posts/:id/vote handler with a robust implementation that supports both formats
// and returns aggregate score and the current user's vote.
api.post("/posts/:id/vote", async (req, res) => {
  const { id } = req.params;
  const { username, vote } = req.body;
  if (!username || ![1, -1].includes(Number(vote))) return res.status(400).json({ error: "Invalid input" });

  const posts = await fs.readJson(POSTS_FILE);
  const p = posts.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Post not found" });

  // ensure votesMap exists and is initialized from old array if necessary
  ensureVotesMap(p);

  const vnum = Number(vote);
  const prev = p.votesMap[String(username)] || 0;
  if (prev === vnum) {
    // toggle off
    delete p.votesMap[String(username)];
  } else {
    p.votesMap[String(username)] = vnum;
  }

  // persist back to array form for compatibility
  p.votes = votesMapToArray(p.votesMap);

  await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });

  // compute response values
  const score = Object.values(p.votesMap || {}).reduce((s, it) => s + Number(it || 0), 0);
  const userVote = Number(p.votesMap[String(username)] || 0);

  console.log(`[vote] post=${id} by=${username} vote=${vnum} -> score=${score} userVote=${userVote}`);

  res.json({ success: true, votes: p.votes, score, userVote });
});

// Replace the comments/:id/vote handler similarly
api.post("/comments/:id/vote", async (req, res) => {
  const { id } = req.params;
  const { username, vote } = req.body;
  if (!username || ![1, -1].includes(Number(vote))) return res.status(400).json({ error: "Invalid input" });

  const posts = await fs.readJson(POSTS_FILE);
  for (const p of posts) {
    const c = p.comments.find(cm => cm.id === id);
    if (c) {
      // ensure votesMap on comment
      ensureVotesMap(c);

      const vnum = Number(vote);
      const prev = c.votesMap[String(username)] || 0;
      if (prev === vnum) {
        delete c.votesMap[String(username)];
      } else {
        c.votesMap[String(username)] = vnum;
      }

      // persist back to array
      c.votes = votesMapToArray(c.votesMap);

      await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });

      const score = Object.values(c.votesMap || {}).reduce((s, it) => s + Number(it || 0), 0);
      const userVote = Number(c.votesMap[String(username)] || 0);

      console.log(`[vote] comment=${id} post=${p.id} by=${username} vote=${vnum} -> score=${score} userVote=${userVote}`);

      return res.json({ success: true, votes: c.votes, score, userVote });
    }
  }
  return res.status(404).json({ error: "Comment not found" });
});

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
// allow requests to /ManticoreNET/api to reach the same router (clients use that URL).
app.use("/ManticoreNET/api", api);

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
