// Backing track synthesis — pure Node, no dependencies.
//
// The track is generated per job rather than licensed, which is what makes the
// beat grid possible: the tempo is an input, so every cut and every line lands
// on a known beat (see docs/VIDEO_CRAFT.md). It is also seeded by agent id, so
// two agents do not get an identical bed while the same agent stays consistent
// across re-renders.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const SR = 44100;

/** Deterministic 0..1 from a string — same agent, same variation. */
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

const A4 = 440;
const semis = (n: number): number => A4 * 2 ** (n / 12);

/** Minor-key progressions: i–VI–III–VII and i–iv–VI–V, in semitones from A4. */
const PROGRESSIONS = [
  [-12, -3, -8, -2],
  [-12, -7, -3, -5],
];

function adsr(t: number, dur: number, a: number, d: number, s: number, r: number): number {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur - r) return s;
  return Math.max(0, s * (1 - (t - (dur - r)) / r));
}

/**
 * Render a music bed of `durationSec` at `bpm`.
 *
 * Deliberately sparse and low-passed: this sits under narration, so it has to
 * carry the pulse without competing with the voice. Structure follows the video
 * — a quiet intro bar, a fuller body, and a tail that thins out for the outro.
 */
export function synthesizeMusic(durationSec: number, bpm: number, seedText: string): Buffer {
  const seed = seedFrom(seedText);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const n = Math.ceil(durationSec * SR);
  const left = new Float64Array(n);
  const right = new Float64Array(n);

  const prog = PROGRESSIONS[Math.floor(seed * PROGRESSIONS.length) % PROGRESSIONS.length];
  const root = -2 + Math.floor(seed * 5); // a little key variation per agent
  const totalBars = Math.ceil(durationSec / bar);

  const add = (i: number, v: number, pan = 0): void => {
    if (i < 0 || i >= n) return;
    left[i] += v * (1 - Math.max(0, pan));
    right[i] += v * (1 + Math.min(0, pan));
  };

  for (let b = 0; b < totalBars; b++) {
    const barStart = b * bar;
    // Intro bar is bare; the last two bars thin out again for the outro.
    const intro = b === 0;
    const outro = b >= totalBars - 2;
    const body = !intro && !outro ? 1 : 0.55;

    const chordRoot = root + prog[b % prog.length];
    const chord = [chordRoot, chordRoot + 3, chordRoot + 7, chordRoot + 12];

    // ── pad: soft sustained chord, the harmonic ground
    for (let c = 0; c < chord.length; c++) {
      const f = semis(chord[c]) / 2;
      const dur = bar;
      const pan = (c % 2 === 0 ? -1 : 1) * 0.25;
      for (let s = 0; s < dur * SR; s++) {
        const t = s / SR;
        const env = adsr(t, dur, 0.35, 0.4, 0.55, 0.5) * 0.055 * body;
        const vib = 1 + Math.sin(2 * Math.PI * 4.5 * t) * 0.0015;
        add(Math.floor((barStart + t) * SR), Math.sin(2 * Math.PI * f * vib * t) * env, pan);
      }
    }

    if (intro) continue;

    // ── bass: root on beats 1 and 3, short and round
    for (const beatIndex of [0, 2]) {
      const f = semis(chordRoot - 12) / 2;
      const dur = beat * 0.9;
      for (let s = 0; s < dur * SR; s++) {
        const t = s / SR;
        const env = adsr(t, dur, 0.01, 0.12, 0.35, 0.25) * 0.12 * body;
        add(Math.floor((barStart + beatIndex * beat + t) * SR), Math.sin(2 * Math.PI * f * t) * env);
      }
    }

    // ── pluck: arpeggio on the offbeats, the part that carries the pulse
    if (!outro) {
      for (let k = 0; k < 4; k++) {
        const f = semis(chord[(k + Math.floor(seed * 3)) % chord.length]);
        const at = barStart + k * beat + beat * 0.5;
        const dur = beat * 0.45;
        for (let s = 0; s < dur * SR; s++) {
          const t = s / SR;
          const env = adsr(t, dur, 0.005, 0.09, 0.2, 0.14) * 0.05;
          // Triangle-ish tone: softer than a saw, cuts less into speech.
          const v = Math.asin(Math.sin(2 * Math.PI * f * t)) * (2 / Math.PI);
          add(Math.floor((at + t) * SR), v * env, k % 2 ? 0.3 : -0.3);
        }
      }
    }

    // ── drums: kick on 1 and 3, closed hat on eighths
    for (const beatIndex of [0, 2]) {
      const dur = 0.16;
      for (let s = 0; s < dur * SR; s++) {
        const t = s / SR;
        const f = 110 * Math.exp(-t * 26) + 42; // pitch drop
        const env = Math.exp(-t * 16) * 0.5 * body;
        add(Math.floor((barStart + beatIndex * beat + t) * SR), Math.sin(2 * Math.PI * f * t) * env);
      }
    }
    if (!outro) {
      for (let k = 0; k < 8; k++) {
        const at = barStart + k * beat * 0.5;
        const dur = 0.035;
        for (let s = 0; s < dur * SR; s++) {
          const t = s / SR;
          const env = Math.exp(-t * 90) * (k % 2 ? 0.018 : 0.03);
          add(Math.floor((at + t) * SR), (Math.random() * 2 - 1) * env, k % 2 ? 0.4 : -0.4);
        }
      }
    }
  }

  // ── master: gentle low-pass so the bed never fights the voice, then fades
  const out = Buffer.alloc(n * 4);
  let lpL = 0;
  let lpR = 0;
  const fade = Math.min(SR * 1.2, n / 4);
  for (let i = 0; i < n; i++) {
    lpL += (left[i] - lpL) * 0.28;
    lpR += (right[i] - lpR) * 0.28;
    let g = 1;
    if (i < fade) g = i / fade;
    else if (i > n - fade) g = (n - i) / fade;
    const l = Math.max(-1, Math.min(1, lpL * g));
    const r = Math.max(-1, Math.min(1, lpR * g));
    out.writeInt16LE(Math.round(l * 32767), i * 4);
    out.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
  }
  return out;
}

/** Write the bed as a stereo WAV into the job directory; returns the filename. */
export function writeMusic(jobId: string, durationSec: number, bpm: number, seedText: string): string {
  const pcm = synthesizeMusic(durationSec, bpm, seedText);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  const dir = path.join(config.outputDir, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "music.wav"), Buffer.concat([header, pcm]));
  return "music.wav";
}
