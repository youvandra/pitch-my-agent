// Voiceover synthesis.
//
// Provider-agnostic by design: ElevenLabs is the implemented backend, but the
// shape here is just text -> (playable file, exact duration). Without a key the
// whole layer no-ops and the video renders silent — a missing voice must never
// fail a paid render.
//
// We request raw PCM rather than mp3 for two reasons: the duration is exact
// (bytes / (rate * 2)) with zero dependencies and no ffprobe, and the scene
// timing depends on knowing that duration precisely. We then wrap the PCM in a
// minimal WAV header so Remotion can play it directly.
import fs from "node:fs";
import path from "node:path";
import { config, hasVoice } from "./config.js";
import type { NarrationLine, SceneKey } from "./types.js";

const SAMPLE_RATE = 44100;
const BYTES_PER_SAMPLE = 2; // 16-bit mono

/** Wrap raw 16-bit mono PCM in a WAV container. */
function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ─── Voice resolution ────────────────────────────────────────────────────────

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

let resolvedVoiceId: string | null = null;

/**
 * Pick a voice when none is configured.
 *
 * Premade voice IDs are shared across accounts, so one could simply be hardcoded
 * — but ElevenLabs is retiring its current default voices (they stop working
 * after 2026-12-31), so a pinned legacy ID is a scheduled outage. Asking the
 * account which voices it actually has survives that swap.
 */
async function resolveVoiceId(): Promise<string> {
  if (config.elevenVoiceId) return config.elevenVoiceId;
  if (resolvedVoiceId) return resolvedVoiceId;

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": config.elevenApiKey },
  });
  if (!res.ok) {
    throw new Error(
      `Could not list ElevenLabs voices (${res.status}). Set ELEVENLABS_VOICE_ID explicitly.`,
    );
  }

  const { voices = [] } = (await res.json()) as { voices?: ElevenVoice[] };
  if (voices.length === 0) throw new Error("ElevenLabs returned no voices for this account.");

  const isEnglish = (v: ElevenVoice) =>
    !v.labels?.language || v.labels.language.toLowerCase().startsWith("en");

  // Prefer a narration-friendly English voice, then any premade one, then
  // whatever the account has.
  const preferred =
    voices.find((v) => isEnglish(v) && /narrat|present|news/i.test(v.labels?.use_case ?? "")) ??
    voices.find((v) => isEnglish(v) && v.category === "premade") ??
    voices.find((v) => v.category === "premade") ??
    voices[0];

  resolvedVoiceId = preferred.voice_id;
  console.log(`voiceover: using ElevenLabs voice "${preferred.name}" (${resolvedVoiceId})`);
  return resolvedVoiceId;
}

async function elevenLabsPcm(text: string): Promise<Buffer> {
  const voiceId = await resolveVoiceId();
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
    `?output_format=pcm_${SAMPLE_RATE}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenApiKey,
      "Content-Type": "application/json",
      Accept: "audio/pcm",
    },
    body: JSON.stringify({
      text,
      model_id: config.elevenModel,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function publicUrl(jobId: string, file: string): string {
  const rel = `/videos/${jobId}/${file}`;
  return config.publicBaseUrl ? `${config.publicBaseUrl}${rel}` : rel;
}

/**
 * Synthesize one audio clip per narration line.
 *
 * Returns only the lines that actually rendered: a provider failure on one line
 * degrades that scene to silence rather than sinking the whole video. Returns an
 * empty array when no voice provider is configured.
 */
export async function synthesizeNarration(
  jobId: string,
  script: Array<{ scene: SceneKey; text: string }>,
): Promise<NarrationLine[]> {
  if (!hasVoice()) return [];

  const outDir = path.join(config.outputDir, jobId);
  fs.mkdirSync(outDir, { recursive: true });

  const lines: NarrationLine[] = [];

  // Sequential on purpose: TTS providers rate-limit hard, and a demo video has
  // only a handful of lines, so there is nothing to gain from parallelism.
  for (const entry of script) {
    const text = entry.text.trim();
    if (!text) continue;
    try {
      const pcm = await elevenLabsPcm(text);
      const durationSec = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
      if (durationSec <= 0) continue;

      const file = `vo-${entry.scene}.wav`;
      fs.writeFileSync(path.join(outDir, file), pcmToWav(pcm));

      lines.push({
        scene: entry.scene,
        text,
        audioUrl: publicUrl(jobId, file),
        durationSec: Math.round(durationSec * 1000) / 1000,
      });
    } catch (err) {
      console.error(`voiceover failed for scene "${entry.scene}":`, err);
    }
  }

  return lines;
}
