# Pitch My Agent

**Your agent has a listing. It should have a trailer.**

An A2MCP Agent Service Provider on OKX.ai. Give it an agent ID; it reads that
agent's public profile, services and prices, pulls a palette out of its logo,
writes the script, and renders a narrated 1080p demo video cut to the beat of its
own soundtrack. Paid per call over x402.

Live: **https://pitchokxai.web.id** · endpoint `POST /pitch/animated` · **$2.00**
USDT0 on X Layer.

| | |
|---|---|
| **Type** | A2MCP — pay-per-call via x402 v2 |
| **Network** | X Layer (`eip155:196`), USDT0 |
| **Paid tool** | `generate_pitch` — $2.00 |
| **Free tools** | `preview_spec`, `get_job`, `retry_job`, `get_quota`, plus `initialize` / `tools/list` |
| **Delivery** | 1080p mp4 (~45–70s narrated), poster image, watch page, kept 7 days |

---

## The problem it actually solves

Every agent on the marketplace is a name, a paragraph and a price list. Buyers are
other agents and the people steering them, and none of them can tell from a
listing what using the thing feels like. Making a demo video by hand is a day's
work per agent.

The value here is orchestration, not one model call: read the marketplace, extract
brand colour from a logo under a contrast contract, plan a scene architecture,
write copy and narration, synthesise speech, pick a beat-matched track, drive a
headless renderer, host the result, and settle payment on-chain. No single LLM
call does that.

## Why it is not a template

Recolouring one layout is a template with new paint. Each scene role has several
compositions that were designed, and the architecture is chosen per agent — by the
model when one is configured, by a hash of the agent ID when it is not.

| Agent | Style | Hook | Problem | Reveal | Services |
|---|---|---|---|---|---|
| BoredComic #6006 | playful | statement | chat | card | list |
| HatchAI #5164 | terminal | statement | wall | card | hero |
| Lumora #5175 | terminal | statement | chat | banner | list |

Three guarantees hold that together:

- **Colour has a job.** Two colours come from the logo and are held to a contract:
  ≥40° apart in hue, ≥1.8 in contrast, both legible on the backdrop. Prose is
  neutral, the agent's mark is primary, numbers are accent. Verified across 36 real
  marketplace palettes — the model may propose a palette, it does not decide one.
- **Motion is derived from the music.** Each licensed track declares its tempo in
  its filename, and every cut, entrance and caption is quantised to that grid.
- **Copy is the agent's own.** Service names and prices come from the listing,
  never from the model. Inventing either would stage a lie.

## The scene at the centre

The middle of every video stages one x402 purchase: the request typed into a
session, the `402` challenge carrying the service's **real** fee in USDT0 on X
Layer, settlement, and the delivery arriving in the shape that agent actually
returns — panels for an illustrator, a chart for a market feed, a report for an
analyser. The window is labelled `SIMULATED`, because the session is a staged
illustration. The service name, the price and the protocol are not.

That scene is the part a generic promo tool cannot produce, because it requires
knowing how an agent on this marketplace is bought.

## Pipeline

```
1. fetch agent      onchainos agent service-list --agent-id {id}   (retried 3x)
2. brand palette    dominant logo colours by salience, then the contract above
3. VideoSpec        an LLM writes DATA — copy, narration, scene plan, demo flow
4. narration        ElevenLabs; keys tried in order so one dry key is not silence
5. soundtrack       licensed track for the style, or synthesis if none is present
6. render           Remotion, props-driven, headless Chromium
7. deliver          mp4 + poster + watch page, x402 already settled
```

Every layer degrades rather than fails: no AI key gives a deterministic spec, no
voice gives a music-only cut, no track gives a synthesised bed, and a failed
render is re-runnable free with `retry_job`.

## Billing, stated plainly

Payment settles when the job is **accepted**, not when it is delivered — the
facilitator's authorization window is far shorter than a render, so billing on
delivery is not available. Consequences, all surfaced in the API:

- Malformed input is rejected **before** payment; a bad request costs nothing.
- A render that fails after acceptance has already been paid for. `retry_job`
  re-runs it free. It is the remedy, not a refund.
- `get_quota` reports whether this deployment renders with narration or music
  only, the real ETA of the host, and the retry policy.

## Repository

```
backend/    Express + MCP + x402. Orchestration, palette, spec, voice, music.
video/      Remotion template. Fixed compositions; the spec is props.
frontend/   Landing page.
assets/     Avatar, and licensed backing tracks (see assets/music/README.md).
docs/       VIDEO_CRAFT.md — why the motion is built the way it is.
```

## Running it

```bash
cd backend && npm install && cp .env.example .env   # fill in the keys you have
cd ../video && npm install && npx remotion browser ensure
cd ../backend && npm run dev
```

With `X402_MODE=off` every endpoint is free, which is the local default. A render
takes ~2 minutes on a laptop and ~7 on a small VPS; set `RENDER_ETA_SECONDS` to
whatever the host actually does, because quoting the laptop number makes buyers
think the job has hung.

```bash
curl -s -X POST localhost:3007/pitch/animated \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"generate_pitch","arguments":{"agentId":"6006"}}}'
```

`npm run typecheck` in either project runs `tsc --noEmit`.

## Licensing note

Backing tracks are from Pixabay under the Pixabay Content License: commercial use
permitted, attribution not required. Their measured tempos, and the reasoning for
the three tracks held back, are recorded in `assets/music/LICENCES.md`. Anything
added to that directory must be cleared for commercial use — nothing in the
pipeline can verify it, and a buyer receiving an infringing video is the seller's
problem.

---

Built for the OKX.AI Genesis Hackathon.
