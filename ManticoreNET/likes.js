import express from "express";
import fs from "fs-extra";

/*
  createLikesRouter(POSTS_FILE) -> express.Router
  Usage in server.js: api.use(createLikesRouter(POSTS_FILE));
*/
export default function createLikesRouter(POSTS_FILE) {
  const router = express.Router();

  router.post("/posts/:id/like", async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    if (!id) return res.status(400).json({ error: "Missing post id" });
    if (!username) return res.status(400).json({ error: "Missing username" });

    try {
      const posts = await fs.readJson(POSTS_FILE);
      const idx = (Array.isArray(posts) ? posts : []).findIndex(p => p.id === id);
      if (idx === -1) return res.status(404).json({ error: "Post not found" });

      // normalize likes to array
      posts[idx].likes = Array.isArray(posts[idx].likes)
        ? posts[idx].likes
        : (posts[idx].likes ? Object.values(posts[idx].likes) : []);
      const has = posts[idx].likes.includes(username);
      if (has) {
        posts[idx].likes = posts[idx].likes.filter(u => u !== username);
      } else {
        posts[idx].likes.push(username);
      }
      posts[idx].likesCount = posts[idx].likes.length;

      await fs.writeJson(POSTS_FILE, posts, { spaces: 2 });
      return res.json({ success: true, post: posts[idx] });
    } catch (e) {
      return res.status(500).json({ error: "Failed to update post" });
    }
  });

  return router;
}
