# Video craft: how not to render slop

Research notes for the Remotion template. The goal is a video that reads as
*designed*, not *generated*. Everything here is actionable in this repo.

## Why generated video looks like slop

Six failure modes, in rough order of how much damage they do:

1. **Linear or uniform motion.** Constant-speed movement reads as robotic and
   soulless — the eye expects acceleration and settle. Never `linear`.
2. **No audio, or audio not locked to the cuts.** Silence is the loudest slop
   tell. Music that merely plays *underneath* arbitrary cuts is nearly as bad.
3. **Everything animates at once.** When several elements arrive together the eye
   has nowhere to land. One typographic element should move at a time.
4. **One scene grammar, repeated.** Centered headline fades in, again, again. Even
   with perfect easing, repetition reads as a template.
5. **Weak hierarchy.** Too many fonts, too many colors, sizes too close together.
6. **Motion as decoration.** Movement that does not carry meaning is noise.
   Good motion is not noticed; the emotion it carries is.

## Our unfair advantage: we own the music, so we know the BPM

The single biggest separator for kinetic typography is **rhythm** — each word or
cut arriving *precisely* on the beat, not approximately. Most pipelines cannot do
this because they license a track and guess.

We generate the backing track ourselves (see `bored-comic/demo/video-src/generate-music.js`
— pure Node, no deps, fixed BPM and explicit sections). Because the BPM is an
input, every scene boundary and every text arrival can be **derived** from it:

```ts
// video/src/beat.ts
export const BPM = 112;
export const FPS = 30;

/** Frame number of beat n. Snap cuts and arrivals to these. */
export const beat = (n: number): number => Math.round(n * (60 / BPM) * FPS);
/** Frame number of bar n (4/4). */
export const bar = (n: number): number => beat(n * 4);
```

Then scene durations become `bar(8)`, `bar(4)` — not `14` seconds — and text
delays become `beat(3)`, not `delay={18}`. Cuts land on downbeats, accents land
on off-beats. This is the change that makes it feel authored.

**Do this before adding any effects library.** It is free and it matters more.

## Rules for our scenes

- **Easing vocabulary: pick three, reuse them.** Springs (`spring()`) for
  entrances that should feel physical; a cubic ease-out for transforms; a linear
  ramp *only* for continuous background drift. Do not invent a curve per scene.
- **Stagger, then settle.** Each element gets its own beat, and finishes moving
  before the next starts. Currently `scenes.tsx` staggers by frames — move those
  to beats.
- **Vary the composition.** Our template has three copy scenes sharing one
  centered layout (`CopyScene`). At least differentiate: full-bleed statement,
  split (text left / visual right), list build, and a zoom onto one detail.
- **One display font, one body, one mono.** Already the case — keep it. Push size
  contrast harder instead of adding faces.
- **Restrained palette.** The per-agent brand palette gives primary + accent;
  that is the budget. Everything else is background and text.
- **Add depth, cheaply.** A faint noise/grain layer and a soft radial gradient
  kill the "flat CSS" look. Motion blur on fast moves sells speed.
- **Sound design, not just music.** A few short ticks on key arrivals (card
  lands, price appears) plus the music bed. Two or three cues is enough.

## Free / open-source tooling worth pulling in

Ordered by value for this project.

| Package | What it buys us |
|---|---|
| `@remotion/transitions` | Real scene transitions (slide/wipe/clock) instead of only cross-fades |
| `remotion-time` | Express timing in seconds/beats rather than raw frames |
| `@remotion/motion-blur` | Cinematic blur on fast transforms — a big polish delta |
| `@remotion/noise` | Grain / organic texture to break flatness |
| `@remotion/google-fonts` | Already in use — keep weights and subsets narrow |
| `@remotion/lottie` | Drop in designer-grade vector animation when we need a flourish |
| `remotion-animate-text` | Per-character / per-word text animation primitives |
| Tone.js | Audio synthesis if we outgrow the hand-rolled WAV generator |

Component libraries to read for ideas (not necessarily to depend on): **Onda**
(70 components, 18 transitions), **RemotionUI**, **Remocn**, **Remotion Bits**.
Template galleries: [remotiontemplates.dev](https://remotiontemplates.dev/) (81
free templates), [React Video Editor's free set](https://www.reactvideoeditor.com/remotion-templates),
and [ali-abassi/remotion-templates](https://github.com/ali-abassi/remotion-templates)
(curated specifically for AI coding agents).

## On MCP servers: mostly not the lever here

Design-oriented MCP servers exist (Figma MCP for reading design files, Freepik /
IconScout for asset retrieval, Playwright for browser control). Honest assessment:

- **Playwright MCP** — genuinely useful, but for the *live segment* recording,
  not for making the render prettier.
- **Figma MCP** — only pays off if we first design the template in Figma. Could
  be worth it later for a hand-designed scene set.
- **Asset MCPs (Freepik, IconScout, stock)** — **avoid for delivered output.** We
  *sell* these videos, so every embedded asset needs commercial redistribution
  rights. Stick to self-generated visuals, the agent's own avatar, and
  OFL-licensed fonts. Licensing risk is not worth a stock icon.

No MCP server makes motion feel authored. Beat-locked timing, easing discipline,
and varied composition do.

## Priority order

1. `beat.ts` + move all scene timing onto beats; generate the track per video from
   its known BPM.
2. Differentiate the three copy scenes into distinct compositions.
3. `@remotion/transitions` for real transitions.
4. Grain + motion blur pass.
5. Two or three sound cues.
6. Only then consider Lottie flourishes.
