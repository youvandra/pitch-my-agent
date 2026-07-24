// VideoSpec builder — the only place an LLM writes anything.
//
// It emits DATA (headlines, taglines, card copy), never code. The Remotion
// template is fixed and consumes this as props, so a bad model response can
// degrade the copy but can never break the render.
import { config, hasAi } from "./config.js";
import type {
  AgentProfile,
  Palette,
  SceneCopy,
  SceneKey,
  ServiceCard,
  VideoSpec,
  VisualStyle,
} from "./types.js";

const MAX_CARDS = 4;

function serviceCards(agent: AgentProfile): ServiceCard[] {
  return agent.services.slice(0, MAX_CARDS).map((s) => ({
    name: s.name,
    description: s.description.length > 110 ? `${s.description.slice(0, 107)}...` : s.description,
    price: s.fee ? `$${Number(s.fee).toFixed(2)}` : "—",
  }));
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
    bpm: config.bpm,
    durationSec,
  };
}

interface AiCopy {
  tagline?: string;
  hook?: SceneCopy;
  problem?: SceneCopy;
  reveal?: SceneCopy;
  cta?: SceneCopy;
}

async function generateCopy(agent: AgentProfile): Promise<AiCopy | null> {
  const services = agent.services
    .map((s) => `- ${s.name} ($${s.fee}): ${s.description}`)
    .join("\n");

  const prompt =
    `Write the copy for a short promo video about an AI agent sold on the OKX.ai marketplace.\n\n` +
    `Agent: ${agent.name}\nDescription: ${agent.description}\nServices:\n${services}\n\n` +
    `Return ONLY minified JSON: {"tagline":"","hook":{"eyebrow":"","headline":"","sub":""},` +
    `"problem":{"eyebrow":"","headline":"","sub":""},"reveal":{"eyebrow":"","headline":"","sub":""},` +
    `"cta":{"eyebrow":"","headline":"","sub":""}}\n` +
    `Rules: WRITE IN ENGLISH. Headline <= 42 chars, sub <= 120 chars, eyebrow <= 18 chars. ` +
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
    { scene: "live", text: "Here it is, being paid and called for real." },
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
    `Return ONLY minified JSON: {"hook":"","problem":"","reveal":"","live":"","services":"","cta":""}\n` +
    `Rules: WRITE IN ENGLISH regardless of the agent's own language. One sentence per scene, ` +
    `8-22 words, spoken register (contractions are fine). ` +
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
  const order: SceneKey[] = ["hook", "problem", "reveal", "live", "services", "cta"];
  const lines = order
    .map((scene) => ({ scene, text: (parsed[scene] ?? "").trim() }))
    .filter((l) => l.text.length > 0);

  return lines.length > 0 ? lines : null;
}

/**
 * Build the narration script. Never throws — falls back to deterministic lines so
 * a flaky model cannot cost the buyer their voiceover.
 */
export async function buildScript(spec: VideoSpec, agent: AgentProfile): Promise<ScriptLine[]> {
  const base = fallbackScript(spec, agent);
  if (!hasAi()) return base;
  try {
    return (await generateScript(spec, agent)) ?? base;
  } catch (err) {
    console.error(`narration script generation failed for agent ${agent.agentId}:`, err);
    return base;
  }
}
