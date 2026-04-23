import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { generateVoice } from "./voice-gen";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.send("Welcome to the Gemini Voice Generation API. POST to /voice with text, voice, emotion, speed, and pitch parameters.");
});

app.post("/voice", async (req, res) => {
  try {
    const params = req.body;

    const audioBuffer = await generateVoice(params);

    const base64Audio = audioBuffer.toString("base64");

    res.json({
      success: true,
      audio: base64Audio,
      mime: "audio/wav"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Voice generation failed" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});