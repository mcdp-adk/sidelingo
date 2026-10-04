/** Provider protocol data shared by Settings and the Provider client. */
const commonEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof commonEfforts)[number];

export const PRESET_REGISTRY = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyVariable: "OPENAI_API_KEY",
    effortField: "reasoning_effort",
    efforts: commonEfforts,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyVariable: "OPENROUTER_API_KEY",
    effortField: "reasoning",
    efforts: commonEfforts,
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    keyVariable: "DEEPSEEK_API_KEY",
    effortField: "reasoning_effort",
    efforts: ["none", "low", "high", "max"],
  },
  "ollama-cloud": {
    label: "Ollama Cloud",
    baseUrl: "https://ollama.com/v1",
    keyVariable: "OLLAMA_API_KEY",
    effortField: "reasoning_effort",
    efforts: commonEfforts,
  },
  custom: {
    label: "Custom",
    baseUrl: null,
    keyVariable: null,
    effortField: "reasoning_effort",
    efforts: commonEfforts,
  },
} as const;

export type Preset = keyof typeof PRESET_REGISTRY;
export const PRESETS = Object.keys(PRESET_REGISTRY) as Preset[];

/** Default is null; explicit levels must belong to the Preset's protocol. */
export function isReasoningEffort(preset: Preset, value: unknown): value is ReasoningEffort | null {
  return value === null || PRESET_REGISTRY[preset].efforts.some((effort) => effort === value);
}
