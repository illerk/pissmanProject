import OpenAI from "openai";
import express from "express";
import cors from "cors";

const client = new OpenAI({
  apiKey: "zu-777b06f0d45675ad241ad4ce5d3f84d0",
  baseURL: "https://zukijourney.com/v1"
});

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, model } = req.body;
    const response = await client.chat.completions.create({
      model: model || "gpt-4.1",
      messages
    });
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log("Server started!");
});