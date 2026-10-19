/**
 * freeflow-omniroute — Model definitions
 *
 * All 35 free models from pi-freeflow, adapted for standalone operation.
 * Each model is exposed with OpenAI-compatible metadata for OmniRoute.
 */

export type Upstream = "opencode" | "kilo" | "ovh";

export interface ModelDef {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input?: ("text" | "image" | "video")[];
  /** "openrouter" format for Kilo thinking blocks */
  thinkingFormat?: "openrouter";
  thinkingLevelMap?: Partial<Record<string, string | null>>;
  source: Upstream;
}

// ── Shared thinking level maps ────────────────────────────────────

const KILO_REASONING_MAP: Record<string, string | null> = {
  off: null, minimal: "minimal", low: "low", medium: "medium",
  high: "high", xhigh: "xhigh", max: null,
};

const OVH_REASONING_MAP: Record<string, string | null> = {
  off: null, minimal: null, low: "low", medium: null,
  high: "high", xhigh: null, max: null,
};

// ── OpenCode Zen (12 models) ────────────────────────────────────

export const OPENCODE_MODELS: ModelDef[] = [
  {
    id: "cat-jam-free", name: "Cat Jam [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 262_144, maxTokens: 131_072, input: ["text"],
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  },
  {
    id: "mimo-v2.6-flash-free", name: "MiMo V2.6 Flash [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_048_576, maxTokens: 131_072, input: ["text", "image", "video"],
    thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: null },
  },
  {
    id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_000_000, maxTokens: 128_000, input: ["text"],
    thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
  },
  {
    id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_000_000, maxTokens: 262_144, input: ["text"],
    thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
  },
  {
    id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_000_000, maxTokens: 131_072, input: ["text", "image"],
    thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
  },
  {
    id: "big-pickle", name: "Big Pickle [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 200_000, maxTokens: 32_000, input: ["text"],
    thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
  },
  {
    id: "space-bunny-free", name: "Space Bunny Free [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_048_576, maxTokens: 524_288, input: ["text", "image", "video"],
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  },
  {
    id: "longcat-2.5-preview-free", name: "LongCat 2.5 Preview [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_000_000, maxTokens: 131_072, input: ["text", "image"],
    thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  },
  {
    id: "glm-5.3-flash-free", name: "GLM-5.3 Flash [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_000_000, maxTokens: 32_000, input: ["text", "image"],
    thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  },
  {
    id: "beam-free", name: "Beam Free [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_048_576, maxTokens: 131_072, input: ["text"],
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  },
  {
    id: "exo-free", name: "Exo [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_048_576, maxTokens: 131_072, input: ["text", "image"],
    thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null },
  },
  {
    id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash [OpenCode]", reasoning: true, source: "opencode",
    contextWindow: 1_000_000, maxTokens: 384_000, input: ["text", "image"],
    thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
  },
];

// ── KiloCode Gateway (13 models) ────────────────────────────────

export const KILO_MODELS: ModelDef[] = [
  { id: "dots-studio/dots-3-note-preview:free", name: "Dots3-Note Preview (512K) [Kilo]", reasoning: true, source: "kilo", contextWindow: 512_000, maxTokens: 512_000, input: ["text", "image"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "Nemotron 3 Nano Omni [Kilo]", reasoning: true, source: "kilo", contextWindow: 256_000, maxTokens: 131_072, input: ["text", "image", "video"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B [Kilo]", reasoning: true, source: "kilo", contextWindow: 1_000_000, maxTokens: 128_000, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning [Kilo]", reasoning: true, source: "kilo", contextWindow: 1_000_000, maxTokens: 262_144, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B [Kilo]", reasoning: true, source: "kilo", contextWindow: 262_144, maxTokens: 262_144, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "cohere/north-mini-code:free", name: "North Mini Code [Kilo]", reasoning: true, source: "kilo", contextWindow: 256_000, maxTokens: 64_000, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "poolside/laguna-s-2.1:free", name: "Laguna S 2.1 [Kilo]", reasoning: true, source: "kilo", contextWindow: 262_144, maxTokens: 32_768, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "poolside/laguna-xs-2.1:free", name: "Laguna XS 2.1 [Kilo]", reasoning: true, source: "kilo", contextWindow: 262_144, maxTokens: 32_768, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "liquid/lfm-2.5-2.6b:free", name: "Liquid LFM 2.5 [Kilo]", reasoning: true, source: "kilo", contextWindow: 65_536, maxTokens: 32_768, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "kilo-auto/free", name: "Kilo Auto [Kilo]", reasoning: true, source: "kilo", contextWindow: 256_000, maxTokens: 10_000, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "openrouter/free", name: "OpenRouter Auto [Kilo]", reasoning: true, source: "kilo", contextWindow: 200_000, maxTokens: 65_536, input: ["text", "image"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "stealth/glyph-cluster", name: "Glyph Cluster [Kilo]", reasoning: true, source: "kilo", contextWindow: 256_000, maxTokens: 256_000, input: ["text"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
  { id: "thinkingmachines/inkling-small:free", name: "Inkling Small [Kilo]", reasoning: true, source: "kilo", contextWindow: 1_048_576, maxTokens: 262_144, input: ["text", "image"], thinkingFormat: "openrouter", thinkingLevelMap: KILO_REASONING_MAP },
];

// ── OVHcloud AI Endpoints (8 models) ────────────────────────────

export const OVH_MODEL_PREFIX = "ovh-free/";

export const OVH_MODELS: ModelDef[] = [
  { id: "ovh-free/gpt-oss-120b", name: "GPT-OSS 120B [OVH]", reasoning: true, source: "ovh", contextWindow: 131_072, maxTokens: 32_768, input: ["text"], thinkingLevelMap: OVH_REASONING_MAP },
  { id: "ovh-free/gpt-oss-20b", name: "GPT-OSS 20B [OVH]", reasoning: true, source: "ovh", contextWindow: 131_072, maxTokens: 32_768, input: ["text"], thinkingLevelMap: OVH_REASONING_MAP },
  { id: "ovh-free/Qwen3.5-397B-A17B", name: "Qwen3.5 397B A17B [OVH]", reasoning: true, source: "ovh", contextWindow: 262_144, maxTokens: 65_536, input: ["text", "image"], thinkingLevelMap: OVH_REASONING_MAP },
  { id: "ovh-free/Qwen3.5-9B", name: "Qwen3.5 9B [OVH]", reasoning: true, source: "ovh", contextWindow: 262_144, maxTokens: 65_536, input: ["text", "image"], thinkingLevelMap: OVH_REASONING_MAP },
  { id: "ovh-free/Qwen3.6-27B", name: "Qwen3.6 27B [OVH]", reasoning: true, source: "ovh", contextWindow: 262_144, maxTokens: 65_536, input: ["text", "image"], thinkingLevelMap: OVH_REASONING_MAP },
  { id: "ovh-free/Qwen3.8-27B", name: "Qwen3.8 27B [OVH]", reasoning: true, source: "ovh", contextWindow: 262_144, maxTokens: 32_768, input: ["text", "image"], thinkingLevelMap: OVH_REASONING_MAP },
  { id: "ovh-free/Mistral-Small-3.2-24B-Instruct-2506", name: "Mistral Small 3.2 24B [OVH]", reasoning: false, source: "ovh", contextWindow: 131_072, maxTokens: 16_384, input: ["text", "image"] },
  { id: "ovh-free/Meta-Llama-3_3-70B-Instruct", name: "Meta Llama 3.3 70B Instruct [OVH]", reasoning: false, source: "ovh", contextWindow: 131_072, maxTokens: 16_384, input: ["text"] },
];

// ── Combined catalog ────────────────────────────────────────────

export const ALL_MODELS: ModelDef[] = [...OPENCODE_MODELS, ...KILO_MODELS, ...OVH_MODELS];
// Note: Cline models are omitted — they require per-user browser login
// and are not suitable for a headless server deployment on EC2.

export const MODEL_MAP = new Map<string, ModelDef>(
  ALL_MODELS.map((m): [string, ModelDef] => [m.id, m]),
);

// ── Aliases ─────────────────────────────────────────────────────

export const MODEL_ALIASES: Record<string, string> = {
  "dots-3-note-preview": "dots-studio/dots-3-note-preview:free",
  "nemotron-3-nano-omni": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nemotron-3-ultra-550b": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nemotron-3.5-lightning": "nvidia/nemotron-3.5-lightning:free",
  "nemotron-3-super": "nvidia/nemotron-3-super-120b-a12b:free",
  "north-mini-code": "cohere/north-mini-code:free",
  "lfm-2.5": "liquid/lfm-2.5-2.6b:free",
  "glm-5.3-flash": "glm-5.3-flash-free",
  "exo": "exo-free",
  "glyph-cluster": "stealth/glyph-cluster",
  "inkling-small": "thinkingmachines/inkling-small:free",
  "mimo-v2.6-flash": "mimo-v2.6-flash-free",
  "nemotron-3.5-super-vl": "nemotron-3.5-super-vl-free",
  "space-bunny": "space-bunny-free",
  "longcat-2.5-preview": "longcat-2.5-preview-free",
  "longcat": "longcat-2.5-preview-free",
  "beam": "beam-free",
  "deepseek-v4.1-flash": "deepseek-v4.1-flash-free",
  "laguna-s-2.1:free": "poolside/laguna-s-2.1:free",
  "laguna-xs-2.1:free": "poolside/laguna-xs-2.1:free",
  "kilo-auto": "kilo-auto/free",
  "openrouter": "openrouter/free",
  "gpt-oss-120b": "ovh-free/gpt-oss-120b",
  "gpt-oss-20b": "ovh-free/gpt-oss-20b",
  "qwen3.5-397b": "ovh-free/Qwen3.5-397B-A17B",
  "qwen3.5-9b": "ovh-free/Qwen3.5-9B",
  "qwen3.6-27b": "ovh-free/Qwen3.6-27B",
  "qwen3.8-27b": "ovh-free/Qwen3.8-27B",
  "mistral-small-3.2": "ovh-free/Mistral-Small-3.2-24B-Instruct-2506",
  "llama-3.3-70b": "ovh-free/Meta-Llama-3_3-70B-Instruct",
};

export function resolveCanonicalModelId(id: string): string {
  const clean = (id || "").trim();
  return MODEL_ALIASES[clean] || clean;
}

export function getModelDef(id: string): ModelDef | undefined {
  return MODEL_MAP.get(id) || MODEL_MAP.get(resolveCanonicalModelId(id));
}

export function isKiloModel(id: string): boolean {
  const m = getModelDef(id);
  return m?.source === "kilo";
}

export function isOvhModel(id: string): boolean {
  const m = getModelDef(id);
  return m?.source === "ovh";
}

export function ovhUpstreamModelId(id: string): string {
  const canonical = resolveCanonicalModelId(id);
  return canonical.startsWith(OVH_MODEL_PREFIX)
    ? canonical.slice(OVH_MODEL_PREFIX.length)
    : canonical;
}
