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
import type { NarrationLine, SceneKey, VoiceGender } from "./types.js";

const BYTES_PER_SAMPLE = 2; // 16-bit mono

// PCM sample rate actually in use. Starts at the configured rate and downgrades
// itself if the account's tier rejects it: pcm_44100 is Pro-and-above, while
// pcm_22050 works on lower tiers. 22.05kHz mono is plenty for narration that
// gets mixed under a music bed.
const FALLBACK_SAMPLE_RATE = 22050;
let activeSampleRate = config.elevenSampleRate;

/** Wrap raw 16-bit mono PCM in a WAV container. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
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

/**
 * Curated first choices per gender, best-fit first.
 *
 * Chosen for product-demo narration specifically: clear, trustworthy, adult.
 * Deliberately excluded are the character voices (Callum, Harry), the hyped
 * social-media reads (Laura, Liam), and the hard-sell ones (Adam) — they make a
 * technical demo sound like an advert.
 */
const VOICE_PICKS: Record<VoiceGender, Array<{ id: string; name: string }>> = {
  male: [
    { id: "cjVigY5qzO86Huf0OWal", name: "Eric — Smooth, Trustworthy" },
    { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel — Steady Broadcaster" },
    { id: "nPczCjzI2devNBz1zQrb", name: "Brian — Deep, Resonant" },
  ],
  female: [
    { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda — Knowledgable, Professional" },
    { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella — Professional, Bright, Warm" },
    { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice — Clear, Engaging Educator" },
  ],
  neutral: [{ id: "SAz9YHcvj6GT2YYXdXww", name: "River — Relaxed, Neutral, Informative" }],
};

/** Label use-cases that suit narration, in preference order. */
const GOOD_USE_CASES = /informative|educational|narrative|narration|broadcast|advertisement/i;

/**
 * The pitch is always narrated in English — the audience is the OKX.ai
 * marketplace. A voice trained on another accent reading English text drifts in
 * pronunciation, so non-English voices are excluded from auto-resolution even
 * when they match the requested gender. ELEVENLABS_VOICE_ID still overrides, for
 * when a specific voice (a clone, say) is chosen deliberately.
 */
const ENGLISH_ACCENTS = /american|british|english|australian|irish|canadian|scottish|transatlantic/i;

function isEnglishVoice(v: ElevenVoice): boolean {
  const language = v.labels?.language ?? "";
  if (language) return language.toLowerCase().startsWith("en");
  const accent = v.labels?.accent ?? "";
  // No language label: trust the accent, and reject anything explicitly foreign
  // (e.g. an "id-standard" clone).
  return accent === "" || ENGLISH_ACCENTS.test(accent);
}

const resolved = new Map<string, string>();

/**
 * Pick a voice for the requested gender.
 *
 * Premade voice ids are public and shared across accounts, so the curated picks
 * above are just ids — but ElevenLabs retires its current default voices after
 * 2026-12-31, so we never trust a pinned id blindly. We list the account's real
 * voices and only use a pick that is actually present, then fall back to
 * matching on labels, then to anything available.
 */
async function resolveVoiceId(gender: VoiceGender): Promise<string> {
  if (config.elevenVoiceId) return config.elevenVoiceId;

  const cached = resolved.get(gender);
  if (cached) return cached;

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

  const english = voices.filter(isEnglishVoice);
  const available = new Set(english.map((v) => v.voice_id));
  const byGender = english.filter((v) => (v.labels?.gender ?? "") === gender);

  const pick =
    // 1. a curated choice the account actually has
    VOICE_PICKS[gender].find((p) => available.has(p.id)) ??
    // 2. same gender, narration-friendly use case
    byGender
      .filter((v) => GOOD_USE_CASES.test(v.labels?.use_case ?? ""))
      .map((v) => ({ id: v.voice_id, name: v.name }))[0] ??
    // 3. same gender, anything
    byGender.map((v) => ({ id: v.voice_id, name: v.name }))[0] ??
    // 4. any English voice — give up on gender rather than on the video
    (english[0] ? { id: english[0].voice_id, name: english[0].name } : null) ??
    // 5. nothing English at all: better a narrated video than a silent one
    { id: voices[0].voice_id, name: voices[0].name };

  resolved.set(gender, pick.id);
  console.log(`voiceover: ${gender} -> "${pick.name}" (${pick.id})`);
  return pick.id;
}

async function requestPcm(voiceId: string, text: string, rate: number): Promise<Response> {
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_${rate}`,
    {
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
    },
  );
}

async function elevenLabsPcm(text: string, gender: VoiceGender): Promise<Buffer> {
  const voiceId = await resolveVoiceId(gender);
  let res = await requestPcm(voiceId, text, activeSampleRate);

  // Higher PCM rates are gated behind paid tiers. Rather than making the
  // operator discover that through a failed render, downgrade once and carry on.
  if (!res.ok && activeSampleRate !== FALLBACK_SAMPLE_RATE) {
    const body = await res.text().catch(() => "");
    if (/output_format/i.test(body)) {
      console.warn(
        `voiceover: pcm_${activeSampleRate} not available on this plan, falling back to pcm_${FALLBACK_SAMPLE_RATE}`,
      );
      activeSampleRate = FALLBACK_SAMPLE_RATE;
      res = await requestPcm(voiceId, text, activeSampleRate);
    } else {
      throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
    }
  }

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
  gender: VoiceGender = config.voiceGender,
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
      const pcm = await elevenLabsPcm(text, gender);
      // Read the rate AFTER the request: a tier downgrade may have changed it.
      const rate = activeSampleRate;
      const durationSec = pcm.length / (rate * BYTES_PER_SAMPLE);
      if (durationSec <= 0) continue;

      const file = `vo-${entry.scene}.wav`;
      fs.writeFileSync(path.join(outDir, file), pcmToWav(pcm, rate));

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
