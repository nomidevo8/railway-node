/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();


/**
 * Interface for the generation parameters
 */
export interface VoiceParams {
  text: string;
  voice: string;
  emotion: string;
  speed: number;
  pitch: number; // Pitch shift in cents context (-1200 to 1200)
}

/**
 * Generates a WAV audio buffer from text using the Gemini Live API.
 * This encapsulates the same logic used in the frontend App.tsx.
 */
export async function generateVoice(params: VoiceParams): Promise<Buffer> {
  const { text, voice, emotion, speed, pitch } = params;

  if (!text) {
    throw new Error("Text is required for voice generation.");
  }

    const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const collectedAudioChunks: Float32Array[] = [];
  let totalLength = 0;
  let turnIsFinished = false;

  // Determine pitch description for instructions
  const pitchDesc = pitch > 400 ? 'very high' : pitch > 0 ? 'slightly high' : pitch < -400 ? 'very low' : pitch < 0 ? 'slightly low' : 'normal';

  const config = {
    model: "gemini-3.1-flash-live-preview",
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
      systemInstruction: `You are a precision Multimodal Text-to-Speech engine. 
      READ the user's provided text EXACTLY as written. 
      Do not say "Sure", "Okay", or add any commentary. 
      Use a ${emotion.toLowerCase()} emotional tone as the baseline.
      
      AUDIO PREFERENCES:
      - SPEED: Speak at ${speed.toFixed(1)}x speed.
      - PITCH: Target a ${pitchDesc} pitch.
      - STYLE: Ensure character consistency with ${voice}.

      ENHANCED CAPABILITY: The user may include performance tags in square brackets like [laughing], [slow], [fast], [whispering], [shouting], [crying], [pause], [sarcastic].
      - DO NOT SPEAK the words inside the brackets.
      - PERFORM the style or emotion described by the tag for the text that follows it.
      - Transition your voice naturally based on these directions.
      
      Stop immediately after the last word of the user's text.`,
    },
    callbacks: {
      onmessage: (message: LiveServerMessage) => {
        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const binaryString = Buffer.from(base64Audio, 'base64');
          const int16Array = new Int16Array(binaryString.buffer, binaryString.byteOffset, binaryString.byteLength / 2);
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
          }
          collectedAudioChunks.push(float32Array);
          totalLength += float32Array.length;
        }

        if (message.serverContent?.turnComplete) {
          turnIsFinished = true;
        }
      },
      onerror: (err: any) => {
        console.error("Live API Error:", err);
      }
    }
  };

  const session = await ai.live.connect(config);
  
  // Inject the text to be "read"
  await session.sendRealtimeInput({ text: `Please read this text now: ${text}` });
  
  // Wait for synthesis (30s timeout)
  let waitTime = 0;
  const timeoutLimit = 30000;
  while (!turnIsFinished && waitTime < timeoutLimit) {
    await new Promise(r => setTimeout(r, 100));
    waitTime += 100;
  }
  
  session.close();

  if (totalLength === 0) {
    throw new Error("No audio was synthesized. Check your parameters.");
  }

  // Merge chunks
  const mergedArray = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of collectedAudioChunks) {
    mergedArray.set(chunk, offset);
    offset += chunk.length;
  }

  // Generate WAV Buffer
  return createWavBuffer(mergedArray, 24000);
}

/**
 * Utility to create a WAV file buffer from float samples
 */
function createWavBuffer(samples: Float32Array, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(32 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, offset);
  }

  return buffer;
}

// --- Example CLI Usage ---
// To run this: ts-node src/voice-gen.ts or npx tsx src/voice-gen.ts
const isMain = process.argv[1] && (process.argv[1].endsWith('voice-gen.ts') || process.argv[1].endsWith('voice-gen.js'));

if (isMain) {
    const testParams: VoiceParams = {
        text: "[laughing] Hello from Node.js! [whispering] This is working perfectly.",
        voice: "Kore",
        emotion: "Cheerful",
        speed: 1.2,
        pitch: 0
    };

    console.log("Generating voice for:", testParams.text);
    generateVoice(testParams)
        .then(async (audioBuffer) => {
            const fs = await import('fs');
            fs.writeFileSync('output_node.wav', audioBuffer);
            console.log("Success! Audio saved to output_node.wav");
            process.exit(0);
        })
        .catch(err => {
            console.error("Failed:", err);
            process.exit(1);
        });
}
