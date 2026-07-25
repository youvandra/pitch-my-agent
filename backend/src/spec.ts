// VideoSpec builder — the only place an LLM writes anything.
//
// It emits DATA (headlines, taglines, card copy), never code. The Remotion
// template is fixed and consumes this as props, so a bad model response can
// degrade the copy but can never break the render.
import { config, hasAi } from "./config.js";
import type {
  AgentProfile,
  AgentService,
  DemoFlow,
  Palette,
  ResultKind,
  SceneCopy,
  SceneKey,
  ScenePlan,
  ServiceCard,
  VideoSpec,
  VisualStyle,
} from "./types.js";

const MAX_CARDS = 4;

/** Trim to a whole word — cutting mid-word ("or qui...") looks like a bug. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

/**
 * Trim a service description to something that ends properly.
 *
 * Hard-clamping every description put an ellipsis on all four rows of the price
 * list, which reads as a rendering bug rather than an edit. Most of these
 * descriptions open with a sentence that says the thing and then continue into
 * detail, so taking whole sentences while they fit gives a clean ending far
 * more often than not. The word-clamp remains for the ones written as a single
 * long sentence.
 */
function summarize(text: string, max: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences) {
    let kept = "";
    for (const sentence of sentences) {
      if ((kept + sentence).trim().length > max) break;
      kept += sentence;
    }
    if (kept.trim().length > 0) return kept.trim();
  }
  return clamp(text, max);
}

function serviceCards(agent: AgentProfile): ServiceCard[] {
  return agent.services.slice(0, MAX_CARDS).map((s) => ({
    name: s.name,
    description: summarize(s.description, 112),
    price: s.fee ? `$${Number(s.fee).toFixed(2)}` : "—",
  }));
}

/** The service the video demos: the cheapest, i.e. the easiest first purchase. */
function demoService(agent: AgentProfile): AgentService | undefined {
  if (agent.services.length === 0) return undefined;
  const fee = (svc: AgentService): number => {
    const n = Number(svc.fee);
    return Number.isFinite(n) && n > 0 ? n : Infinity;
  };
  return [...agent.services].sort((a, b) => fee(a) - fee(b))[0];
}

/**
 * Guess what this agent's delivery looks like from how it describes itself.
 * Coarse on purpose — the model refines it; this only has to be sane without one.
 */
function classifyResult(agent: AgentProfile): ResultKind {
  const text = `${agent.description} ${agent.services.map((s) => s.description).join(" ")}`.toLowerCase();
  if (/comic|image|art|illustrat|design|logo|video|photo|picture|nft|avatar/.test(text)) return "image-grid";
  if (/price|trad|market|chart|swap|token|yield|portfolio|pnl|candle/.test(text)) return "chart";
  if (/report|scan|audit|analy|research|verif|check|monitor|track|score/.test(text)) return "report";
  return "text";
}

/** Deterministic demo flow. Real service name and fee; a generic but honest request. */
function fallbackDemoFlow(agent: AgentProfile): DemoFlow | undefined {
  const svc = demoService(agent);
  if (!svc) return undefined;
  const kind = classifyResult(agent);
  const lines: Record<ResultKind, string[]> = {
    "image-grid": ["Page 1", "Page 2", "Page 3"],
    chart: ["Signal", "Entry", "Result"],
    report: ["Summary", "Findings", "Verdict"],
    text: ["Response", "Details"],
  };
  return {
    request: `Use "${svc.name}" on a representative example and send back the result.`,
    price: svc.fee ? `$${Number(svc.fee).toFixed(2)}` : "$—",
    serviceName: svc.name,
    resultKind: kind,
    resultLines: lines[kind],
    resultCaption: svc.name,
  };
}

const PLAN_OPTIONS = {
  style: ["terminal", "playful", "saas"],
  hook: ["portrait", "statement", "badge"],
  problem: ["chat", "wall"],
  reveal: ["card", "banner"],
  services: ["list", "grid", "hero"],
} as const;

/**
 * Deterministic per-agent architecture.
 *
 * A different prime multiplier per slot keeps the choices from moving in
 * lockstep — without that, agents 6006 and 6007 would differ in every slot by
 * the same rotation and the catalogue would still have a visible pattern.
 */
function fallbackPlan(agent: AgentProfile): ScenePlan {
  let h = 0;
  for (const ch of agent.agentId + agent.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    hook: PLAN_OPTIONS.hook[(h * 7) % 3],
    problem: PLAN_OPTIONS.problem[(h * 11) % 2],
    reveal: PLAN_OPTIONS.reveal[(h * 13) % 2],
    services: PLAN_OPTIONS.services[(h * 17) % 3],
  };
}

/** Keep only recognised values from the model's plan; anything else falls back. */
function mergePlan(base: ScenePlan, ai: Record<string, unknown> | undefined): ScenePlan {
  if (!ai) return base;
  const pick = <K extends keyof typeof PLAN_OPTIONS>(key: K): string | undefined => {
    const v = ai[key];
    return typeof v === "string" && (PLAN_OPTIONS[key] as readonly string[]).includes(v) ? v : undefined;
  };
  return {
    style: (pick("style") as VisualStyle | undefined) ?? base.style,
    hook: (pick("hook") as ScenePlan["hook"]) ?? base.hook,
    problem: (pick("problem") as ScenePlan["problem"]) ?? base.problem,
    reveal: (pick("reveal") as ScenePlan["reveal"]) ?? base.reveal,
    services: (pick("services") as ScenePlan["services"]) ?? base.services,
  };
}

/** Deterministic spec. Always valid, used verbatim when no AI key is set. */
function fallbackSpec(
  agent: AgentProfile,
  style: VisualStyle,
  theme: Palette,
  durationSec: number,
): VideoSpec {
  const firstSentence = agent.description.split(/(?<=\.)\s/)[0] ?? agent.description;
  return {
    agentId: agent.agentId,
    agentName: agent.name,
    avatarUrl: agent.avatarUrl,
    tagline: firstSentence.slice(0, 120),
    style,
    theme,
    hook: { eyebrow: "On OKX.ai", headline: agent.name, sub: firstSentence.slice(0, 140) },
    problem: {
      eyebrow: "The problem",
      headline: "Your agent hits a wall.",
      sub: "Some work needs a specialist. Paying one should take a single call.",
    },
    problemExchange: {
      user: "Can you handle this for me?",
      agent: "I can't do that on my own.",
    },
    reveal: {
      eyebrow: "Meet",
      headline: agent.name,
      sub: `${agent.services.length} service${agent.services.length === 1 ? "" : "s"}, pay-per-call over x402.`,
    },
    services: serviceCards(agent),
    cta: {
      eyebrow: "Try it",
      headline: `Agent #${agent.agentId}`,
      sub: "Find it on OKX.ai and call it from your own agent.",
    },
    demoFlow: fallbackDemoFlow(agent),
    scenePlan: fallbackPlan(agent),
    bpm: config.bpm,
    durationSec,
  };
}

interface AiCopy {
  tagline?: string;
  hook?: SceneCopy;
  problem?: SceneCopy;
  problemExchange?: { user?: string; agent?: string };
  reveal?: SceneCopy;
  cta?: SceneCopy;
  demoFlow?: { request?: string; resultKind?: string; resultLines?: string[]; resultCaption?: string };
  plan?: Record<string, unknown>;
}

const RESULT_KINDS = new Set<ResultKind>(["image-grid", "report", "chart", "text"]);

/**
 * Merge the model's demo copy over the deterministic flow.
 *
 * The service name and price never come from the model — they are listing data,
 * and inventing either would stage a lie. The model only writes the request and
 * describes the shape of the result.
 */
function mergeDemoFlow(base: DemoFlow | undefined, ai: AiCopy["demoFlow"]): DemoFlow | undefined {
  if (!base) return undefined;
  if (!ai) return base;
  const kind = RESULT_KINDS.has(ai.resultKind as ResultKind) ? (ai.resultKind as ResultKind) : base.resultKind;
  const lines = (ai.resultLines ?? [])
    .map((l) => clamp(String(l).trim(), 44))
    .filter((l) => l.length > 0)
    .slice(0, 4);
  return {
    ...base,
    request: ai.request?.trim() ? clamp(ai.request.trim(), 110) : base.request,
    resultKind: kind,
    resultLines: lines.length >= 2 ? lines : base.resultLines,
    resultCaption: ai.resultCaption?.trim() ? clamp(ai.resultCaption.trim(), 64) : base.resultCaption,
  };
}

async function generateCopy(agent: AgentProfile): Promise<AiCopy | null> {
  const services = agent.services
    .map((s) => `- ${s.name} ($${s.fee}): ${s.description}`)
    .join("\n");

  const prompt =
    `Write the copy for a short promo video about an AI agent sold on the OKX.ai marketplace.\n\n` +
    `Agent: ${agent.name}\nDescription: ${agent.description}\nServices:\n${services}\n\n` +
    `Return ONLY minified JSON: {"tagline":"","hook":{"eyebrow":"","headline":"","sub":""},` +
    `"problem":{"eyebrow":"","headline":"","sub":""},"problemExchange":{"user":"","agent":""},` +
    `"reveal":{"eyebrow":"","headline":"","sub":""},"cta":{"eyebrow":"","headline":"","sub":""},` +
    `"demoFlow":{"request":"","resultKind":"","resultLines":[""],"resultCaption":""},` +
    `"plan":{"style":"","hook":"","problem":"","reveal":"","services":""}}\n` +
    `Rules: WRITE IN ENGLISH. Headline <= 42 chars, sub <= 120 chars, eyebrow <= 18 chars.\n` +
    `demoFlow stages one purchase of "${demoService(agent)?.name ?? "the service"}" on screen. ` +
    `"request" is the exact message a buyer would send — concrete, carrying every needed input, ` +
    `<= 100 chars. "resultKind" is what the delivery looks like: "image-grid" (pages/panels/art), ` +
    `"chart" (market/price data), "report" (analysis/verdict), or "text". "resultLines" are 2-4 ` +
    `fragments naming what came back (panel titles, findings, series), each <= 40 chars. ` +
    `"resultCaption" names the artifact in one line, <= 60 chars.\n` +
    `plan chooses the video's architecture — pick what fits this agent's character, not a default. ` +
    `style: "playful" for creative/fun agents, "terminal" for technical/trading ones, "saas" for ` +
    `polished b2b tools. hook: "portrait" (logo-led), "statement" (tagline-led — use when the ` +
    `tagline is the strongest asset), "badge" (logo + tagline side by side). problem: "chat" (a ` +
    `staged refusal — use when the failure is conversational) or "wall" (one blunt question — use ` +
    `when it is not). reveal: "card" (product card) or "banner" (name-led). services: "list" ` +
    `(4 rows), "grid" (2x2 cards), "hero" (cheapest service leads, rest follow small).\n` +
    `problemExchange is a two-line chat staged on screen: "user" is someone asking an AI ` +
    `assistant for the specific thing THIS agent does, and "agent" is that assistant admitting ` +
    `it cannot. Both under 48 chars, natural speech, no mention of the agent's name.\n` +
    `Concrete and specific to what this agent actually does. No hype, no emoji, no invented features.`;

  const res = await fetch(`${config.sumopodBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.sumopodApiKey}`,
    },
    body: JSON.stringify({
      model: config.sumopodModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const match = (body.choices?.[0]?.message?.content ?? "").match(/\{[\s\S]*\}/);
  return match ? (JSON.parse(match[0]) as AiCopy) : null;
}

const pickScene = (ai: SceneCopy | undefined, base: SceneCopy): SceneCopy =>
  ai?.headline ? { eyebrow: ai.eyebrow ?? base.eyebrow, headline: ai.headline, sub: ai.sub ?? base.sub } : base;

/**
 * Build the spec for an agent. Never throws: if the AI step fails the
 * deterministic spec is returned, so a video is always produced.
 */
export async function buildSpec(
  agent: AgentProfile,
  style: VisualStyle,
  theme: Palette,
  durationSec: number,
): Promise<VideoSpec> {
  const base = fallbackSpec(agent, style, theme, durationSec);
  if (!hasAi()) return base;

  try {
    const ai = await generateCopy(agent);
    if (!ai) return base;
    return {
      ...base,
      tagline: ai.tagline || base.tagline,
      hook: pickScene(ai.hook, base.hook),
      problem: pickScene(ai.problem, base.problem),
      reveal: pickScene(ai.reveal, base.reveal),
      cta: pickScene(ai.cta, base.cta),
      problemExchange: {
        user: clamp(ai.problemExchange?.user?.trim() || base.problemExchange.user, 52),
        agent: clamp(ai.problemExchange?.agent?.trim() || base.problemExchange.agent, 52),
      },
      demoFlow: mergeDemoFlow(base.demoFlow, ai.demoFlow),
      scenePlan: mergePlan(base.scenePlan ?? fallbackPlan(agent), ai.plan),
    };
  } catch (err) {
    console.error(`spec copy generation failed for agent ${agent.agentId}:`, err);
    return base;
  }
}

// ─── Narration script ────────────────────────────────────────────────────────

export interface ScriptLine {
  scene: SceneKey;
  text: string;
}

/**
 * Spoken lines derived from the on-screen copy.
 *
 * Narration must not simply read the headline aloud — hearing the same words you
 * are reading is the flattest possible voiceover. These lines carry the
 * connective tissue the text leaves out.
 */
function fallbackScript(spec: VideoSpec, agent: AgentProfile): ScriptLine[] {
  const count = agent.services.length;
  return [
    { scene: "hook", text: `This is ${spec.agentName}, on the OKX dot AI marketplace.` },
    { scene: "problem", text: spec.problem.sub ?? "Some work needs a specialist." },
    {
      scene: "reveal",
      text: `It exposes ${count} service${count === 1 ? "" : "s"} your agent can call directly, and pay for per call.`,
    },
    { scene: "demo", text: "One call does it: the request goes in, x402 settles the payment, the work comes back." },
    { scene: "services", text: "Every service is priced up front, so your agent can budget before it spends." },
    { scene: "cta", text: `Find agent number ${spec.agentId} on OKX dot AI.` },
  ];
}

async function generateScript(spec: VideoSpec, agent: AgentProfile): Promise<ScriptLine[] | null> {
  const services = agent.services.map((s) => `- ${s.name} ($${s.fee}): ${s.description}`).join("\n");

  const prompt =
    `Write the voiceover narration for a short promo video about an AI agent on the OKX.ai marketplace.\n\n` +
    `Agent: ${agent.name}\nDescription: ${agent.description}\nServices:\n${services}\n\n` +
    `The following text is ALREADY on screen — do not repeat it, narrate around it:\n` +
    `- hook: "${spec.hook.headline}"\n- problem: "${spec.problem.headline}"\n` +
    `- reveal: "${spec.reveal.headline}"\n- cta: "${spec.cta.headline}"\n\n` +
    `Return ONLY minified JSON: {"hook":"","problem":"","reveal":"","demo":"","services":"","cta":""}\n` +
    `Rules: WRITE IN ENGLISH regardless of the agent's own language. One sentence per scene, ` +
    `18-26 words, spoken register (contractions are fine) — the delivered video is as long as ` +
    `its narration, and lines of 8-10 words produce a 30-second pitch that feels rushed. ` +
    `Write numbers and symbols as they should be SPOKEN ("dot AI", "two dollars"), never as digits or symbols. ` +
    `Be concrete about what this agent actually does. No hype, no emoji, no invented features.`;

  const res = await fetch(`${config.sumopodBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.sumopodApiKey}`,
    },
    body: JSON.stringify({
      model: config.sumopodModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
    }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const match = (body.choices?.[0]?.message?.content ?? "").match(/\{[\s\S]*\}/);
  if (!match) return null;

  const parsed = JSON.parse(match[0]) as Partial<Record<SceneKey, string>>;
  const order: SceneKey[] = ["hook", "problem", "reveal", "demo", "services", "cta"];
  const lines = order
    .map((scene) => ({ scene, text: (parsed[scene] ?? "").trim() }))
    .filter((l) => l.text.length > 0);

  return lines.length > 0 ? lines : null;
}

/**
 * Hard cap on spoken words per scene.
 *
 * The delivered length follows the narration, so an unbounded script means an
 * unbounded video: the same agent at the same tier came back as 19s on one run
 * and 31s on another purely because the model felt chattier. Asking for a
 * length in the prompt is a request; enforcing it here is a guarantee.
 *
 * The cap sits well above the requested range rather than at it — clipping a
 * line mid-thought to save two words reads worse than a slightly long one.
 */
const MAX_WORDS_PER_LINE = 26;

/** Trim to a whole sentence if one fits, otherwise to a word boundary. */
function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();

  const cut = words.slice(0, maxWords).join(" ");
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"));
  // Prefer ending on a sentence, but not if that throws most of the line away.
  if (lastStop > cut.length * 0.5) return cut.slice(0, lastStop + 1);
  return `${cut.replace(/[,;:\s]+$/, "")}.`;
}

/**
 * Build the narration script. Never throws — falls back to deterministic lines so
 * a flaky model cannot cost the buyer their voiceover.
 */
export async function buildScript(spec: VideoSpec, agent: AgentProfile): Promise<ScriptLine[]> {
  const base = fallbackScript(spec, agent);
  let lines = base;

  if (hasAi()) {
    try {
      lines = (await generateScript(spec, agent)) ?? base;
    } catch (err) {
      console.error(`narration script generation failed for agent ${agent.agentId}:`, err);
    }
  }

  // Clamp before synthesis: trimming after the fact would mean paying for audio
  // that gets cut, and the video length is derived from what is actually spoken.
  return lines.map((l) => ({ ...l, text: clampWords(l.text, MAX_WORDS_PER_LINE) }));
}
