# Pitch My Agent

**Demo videos for OKX.ai agents.** An A2MCP Agent Service Provider that turns any
agent on the marketplace into a ready-to-use demo video, paid per call over x402.

Give it an agent ID. It reads that agent's public profile and services, derives a
palette from its logo, writes the script, renders a 1080p mp4, and hands back a
hosted video URL.

| | |
|---|---|
| **Type** | A2MCP — pay-per-call via x402 |
| **Network** | X Layer (`eip155:196`), USDT0 |
| **Standard** | `POST /pitch/standard` · 60s video |
| **Premium** | `POST /pitch/premium` · 100s + recorded live segment |
| **Free** | `initialize`, `tools/list`, `preview_spec`, `get_job`, `get_quota` |

---

## Why

Every new ASP on the marketplace needs a demo video, and building one by hand is
slow, manual work. The value here is orchestration, not a single model call: read
the marketplace API, extract brand colors from a logo, write the copy, drive a
headless renderer, host the result. An LLM on its own cannot do that.

## Pipeline

```
1. fetch agent    → onchainos agent service-list --agent-id {id}
                    (structured JSON — never scrapes marketplace HTML)
2. brand palette  → extract dominant logo colors, then refine into a
                    contrast-safe video palette (falls back per theme)
3. VideoSpec      → an LLM writes the copy as DATA, never as code
4. live segment   → (premium) recording of the agent being paid and called
5. render         → fixed props-driven Remotion template → mp4 + thumbnail
6. deliver        → { videoUrl, thumbnailUrl, durationSec, theme, spec }
```

The Remotion template is **fixed**; the LLM only fills a `VideoSpec`. A bad model
response can weaken the copy but can never break the render.

## MCP tools

| Tool | Paid? | Returns |
|---|---|---|
| `generate_pitch` | yes | `jobId` immediately; renders in the background |
| `preview_spec` | **free** | The full plan — copy, service cards, palette — without rendering |
| `get_job` | **free** | Current stage while running, the full delivery when done |
| `get_quota` | **free** | Live x402 pricing and tiers |

### Billing behavior

- **Bad input is rejected before payment.** `mcpPreflight` validates the tool
  arguments ahead of the payment gate, so a deterministic failure is never charged.
- **Generation returns a handle, not the video.** A full render takes minutes —
  far longer than the facilitator's ~300s authorization window — so holding the
  connection would expire the payment before settlement. The paid call answers
  fast with a `jobId` and the buyer polls the free `get_job` tool.
- **Failures are not settled.** A failed render answers `>=400`, and the x402
  middleware skips settlement on any error response.

Payment code mirrors the BoredComic ASP, which is the reference implementation
that passed OKX listing review.

## Repo layout

```
backend/src/
  index.ts      Express server: tier endpoints, static hosting, watch page
  mcp.ts        MCP server + tool definitions (free + paid)
  native.ts     x402-native paid-call handler (plain JSON in/out, settleable)
  x402.ts       Payment gate: paidRoute, mcpPaidRoute, preflight, 402 challenge
  pipeline.ts   Job orchestration: fetch → palette → spec → render → deliver
  okx.ts        Agent metadata via the onchainos CLI
  palette.ts    Brand palette from the agent's avatar (extract → refine → fallback)
  spec.ts       VideoSpec builder (the only AI step for copy)
  render.ts     Remotion render worker (subprocess, concurrency-capped)
  store.ts      Job store, disk-mirrored, with TTL cleanup
  ratelimit.ts  Naive per-IP limiter for the free surface
  config.ts     Environment configuration
  types.ts      Shared types
video/src/
  Root.tsx      One composition, duration derived from the spec
  Video.tsx     Scene sequencing + dissolves
  scenes.tsx    Scenes, all pure functions of the spec
  ui.tsx        Primitives: Stage, Rise, Pop, Avatar, ServiceRow, BrowserFrame
  schema.ts     Zod schema mirroring VideoSpec + scene timing
frontend/
  index.html    Landing page (no build step)
```

## Development

Requires Node.js 20+.

```bash
cd backend
npm install
cp .env.example .env    # then fill it in
npm run dev             # tsx watch, defaults to port 3007
```

```bash
cd video
npm install
npm run studio          # Remotion studio, previews with DEFAULT_SPEC
```

```bash
npm run typecheck       # tsc --noEmit
npm test                # node:test suite
```

### Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3007` | HTTP port |
| `PUBLIC_BASE_URL` | no | — | Origin for absolute delivery URLs |
| `X402_MODE` | no | `off` | `off` \| `demo` \| `on` |
| `X402_PAY_TO` | when on | — | Address that receives settled USDT0 |
| `XLAYER_API_KEY` / `_SECRET_KEY` / `_PASSPHRASE` | when on | — | Merchant credentials for the facilitator |
| `PRICE_STANDARD_USD` | no | `2.00` | Standard tier price |
| `PRICE_PREMIUM_USD` | no | `4.00` | Premium tier price |
| `SUMOPOD_API_KEY` | no | — | Enables AI copy; without it a deterministic script is used |
| `SUMOPOD_VISION_MODEL` | no | — | Enables palette refinement; without it extraction-only |
| `ONCHAINOS_BIN` | no | `onchainos` | Absolute path — spawned processes don't inherit PATH |
| `VIDEO_PROJECT_DIR` | no | `../video` | Remotion template location |
| `OUTPUT_DIR` | no | `/tmp/pitch-my-agent` | Rendered output + job records |
| `RENDER_CONCURRENCY` | no | `1` | Concurrent renders (Chromium is heavy) |

The `XLAYER_*` keys are **seller-side merchant credentials**. They are unrelated
to the buyer-side agentic-wallet session used when calling other agents.

## Tech stack

- **Backend** — Node.js, TypeScript, Express 5
- **Agent interface** — Model Context Protocol (Streamable HTTP)
- **Payments** — x402 v2 via the OKX Payment SDK (`@okxweb3/x402-express`)
- **Video** — Remotion (props-driven template, headless Chromium render)
- **Color** — `sharp` for extraction, vision model for refinement
- **Frontend** — single static HTML page, no build step
