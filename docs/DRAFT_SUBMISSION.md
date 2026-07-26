# OKX.AI Genesis Hackathon — Submission Draft (Pitch My Agent)

Updated 2026-07-26 — reflects shipped state: **one A2MCP service** (`generate_pitch`
paid at $0.40; `preview_spec`, `get_job`, `retry_job`, `get_quota` free), live at
**https://pitchokxai.web.id** with x402 v2 settling on X Layer. Narrated 1080p
output, per-agent scene architecture, palette contract verified across 36 real
marketplace avatars, licensed beat-locked soundtracks, and a staged x402 purchase
as the centrepiece scene.

## Story Behind Pitch My Agent

I kept looking at the marketplace and noticing the same thing about my own
listings: a name, a paragraph, a price list. That is enough to be *found* and not
nearly enough to be *chosen*. Nobody browsing can tell what using the thing
actually feels like, and the agents doing the browsing have even less to go on
than a human would.

I had already built two ASPs, and both times the hardest part of shipping was not
the code — it was the twenty minutes at the end where I had to explain the thing
to somebody else. Making a real demo video by hand is a day of work per agent, and
nobody does it, which is why almost every listing looks like every other listing.

So the tool became the thing I wished existed while shipping the previous two:
hand it an agent ID, get back a video that explains that agent the way I would
explain it — using its own colours, its own service names, its own prices, and the
one thing a generic promo tool can never show, which is what buying it over x402
actually looks like.

## Google Form Fields

### ASP Name
```
Pitch My Agent — Your agent has a listing. It should have a trailer.
```

### Agent ID
```
9480
```

### ASP Description
```
Pitch My Agent is an A2MCP Agentic Service Provider that turns any agent on the
OKX.ai marketplace into a narrated 1080p demo video. Give it an agent ID and it
reads that agent's public profile, services and prices straight from the
marketplace, pulls two brand colours out of its logo, writes the script and the
narration, and renders a finished mp4 — no assets, no brief, no human in the loop.

The output is not a recoloured template. Each scene role has several compositions
that were designed rather than generated, and the architecture is chosen per
agent: hook as a portrait, a tagline statement or a badge; the problem as a staged
refusal or a single blunt question; services as rows, a card grid or one hero
offer; all on one of three visual styles. A model picks the combination that fits
the agent's character, and a hash of the agent ID picks it when no model is
configured — so two agents never collapse onto the same build.

Three guarantees keep it honest. Colour is held to a contract: the two palette
colours must sit at least 40 degrees apart in hue and 1.8 in contrast, and both
must stay legible on the backdrop — verified across 36 real marketplace palettes,
with the vision model allowed to propose but never to decide. Motion is derived
from the music: every licensed backing track declares its tempo in its filename,
and every cut, entrance and caption is quantised to that grid. And copy is the
agent's own — service names and prices come from the listing, never from the
model, because inventing either would stage a lie.

The middle of every video is the part a generic promo tool cannot produce: one
x402 purchase staged end to end. The request typed into a session, the 402
challenge carrying that service's real fee in USDT0 on X Layer, settlement, and
the delivery arriving in the shape that agent actually returns — panels for an
illustrator, a chart for a market feed, a report for an analyser. The window is
labelled SIMULATED because the session is an illustration; the service name, the
price and the protocol are not.

Billing is stated rather than implied. Payment settles when a job is accepted, not
when it is delivered, because the facilitator's authorization window is far
shorter than a render. Malformed input is rejected before payment, so a bad
request costs nothing; a render that fails after acceptance has already been paid
for, and retry_job re-runs it free. Every layer degrades instead of failing: no AI
key gives a deterministic script, no voice credit gives a music-only cut, no
licensed track gives a synthesised bed.
```

### ASP Type
```
A2MCP
```

### Example Agent Tasks
```
- "Make a demo video for agent 6006."                        -> generate_pitch (1080p mp4 + poster + watch page)
- "What would that video say before I pay for it?"           -> preview_spec (script, palette, scene plan — free)
- "What does one pitch cost, and how long does it take?"     -> get_quota (live pricing, real host ETA — free)
- "Is my render done yet?"                                   -> get_job (stage while running, full delivery when done — free)
- "The render failed and I was charged."                     -> retry_job (re-runs the paid job at no cost — free)
- "I want a male narrator this time."                        -> generate_pitch (voice: male)
- "Make it feel like a technical tool, not a toy."           -> generate_pitch (style: terminal)
```

### Use Cases
```
PRIMARY
- ASP builders shipping a new agent — the listing goes live with a trailer instead
  of a paragraph, on the same day, for $0.40 instead of a day of manual editing.

OTHERS
- Marketplace discovery agents  — hand a user a watchable summary of an agent instead of a description
- Portfolio / directory agents  — generate a consistent video for every agent in a list, each still distinct
- Marketing / social agents     — a ready-to-post 1080p mp4 with narration and captions, no editor involved
- Onboarding agents             — show what an agent does before asking anyone to call it
- Agent owners iterating        — preview_spec is free, so the script and palette can be checked before paying
```

### X Account Handle
```
@[isi x handle lo]
```

### X Participation Post (Link)
```
[link ke X post — posting setelah demo video siap]
```

### Telegram Handle
```
@[isi telegram handle lo]
```

---

## X Post Template

```
Every agent on OKX.ai has a listing. Almost none have a trailer.

Pitch My Agent is an A2MCP ASP: send an agent ID, get a narrated
1080p demo video of that agent — built from its own listing.

🎨 palette pulled from its logo, held to a contrast contract
🏗 scene architecture chosen per agent — two agents, two builds
🎵 every cut quantised to the soundtrack's real tempo
💳 the centre scene stages the x402 purchase itself
🔁 retry_job re-runs a failed render free — payment settles on accept

$0.40 per pitch · x402 v2 · USDT0 on X Layer

Agent ID #9480 · pitchokxai.web.id

Built for @OKXAI Genesis Hackathon #OKXAI
```

---

## Demo Video Script (≤90 detik)

```
[0:00-0:08]  Marketplace listing on screen: name, paragraph, price list.
             VO: "This is how every agent on OKX.ai introduces itself.
                  A name, a paragraph, and a price."

[0:08-0:18]  Terminal: one call.
             POST /pitch/animated {"agentId":"6006"}
             VO: "Pitch My Agent takes the agent ID and nothing else."

[0:18-0:32]  Split: BoredComic's logo -> its extracted palette; then the
             generated video's hook scene in those exact colours.
             VO: "It reads the listing, pulls two colours out of the logo,
                  and holds them to a contrast contract before using them."

[0:32-0:50]  The demo scene playing full-frame: request typed, 402 challenge,
             settlement, panels arriving.
             VO: "The middle of every video stages the thing a generic promo
                  tool can't — what buying this agent over x402 looks like.
                  Real service name, real fee, labelled as a simulation."

[0:50-1:08]  Three videos side by side: BoredComic, HatchAI, Lumora.
             Overlay the plan table: different style, hook, problem, services.
             VO: "Two agents never get the same video. The architecture is
                  chosen per agent, not recoloured from one layout."

[1:08-1:20]  get_job returning the delivery payload; the finished mp4 playing.
             VO: "Forty cents, settled on X Layer when the job is accepted.
                  If a render fails, retry_job re-runs it free."

[1:20-1:30]  Landing page, agent ID card.
             VO: "Pitch My Agent. Your agent has a listing.
                  It should have a trailer."
```

---

## Submission checklist

- [x] `onchainos agent create` — identity registered (#9480), avatar uploaded
- [x] Service registered: A2MCP, fee `0.4`, endpoint `https://pitchokxai.web.id/pitch/animated`
- [~] Agent activated — submitted, approvalStatus 3 (live agents show 4); awaiting review
- [x] Agent ID filled into this draft, the landing page footer and the X post
- [ ] Demo video recorded and uploaded
- [ ] X participation post published, link filled in
- [ ] X + Telegram handles filled in
- [ ] Google Form submitted

## Post-hackathon

- [ ] Rotate both ElevenLabs API keys — both were pasted into chat during development
- [ ] Decide the narration credit budget: two free-tier keys ≈ 20 more videos
