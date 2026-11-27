// How the page shows a provider of models: its name and its logo. Only what a person
// recognises them by; which models they have is always asked (see engine/mind.ts).
//
// The logos are Simple Icons (CC0). Providers it has no logo for get their first letter.

import {
  siClaude, siCloudflare, siDeepseek, siGithubcopilot, siGooglecloud, siGooglegemini, siHuggingface, siKimi, siLmstudio,
  siMeta, siMinimax, siMistralai, siNvidia, siOllama, siOpencode, siOpenrouter, siPerplexity, siQwen, siVercel, siVllm, siX, siXiaomi,
} from 'simple-icons';

export interface Brand {
  title: string;
  logo?: { path: string; hex: string };
}

/** Provider ids as the minds name them ("anthropic", "zai-coding-cn", "ollama"), by what they start with. */
const BRANDS: [RegExp, Brand][] = [
  [/^(anthropic|claude)/, { title: 'Claude', logo: siClaude }],
  [/^(openai|codex|chatgpt|azure-openai)/, { title: 'OpenAI' }],
  [/^(google-vertex|vertex)/, { title: 'Google Vertex AI', logo: siGooglecloud }],
  [/^(google|gemini)/, { title: 'Google Gemini', logo: siGooglegemini }],
  [/^(zai|zhipu|glm)/, { title: 'Z.ai' }],
  [/^mistral/, { title: 'Mistral', logo: siMistralai }],
  [/^deepseek/, { title: 'DeepSeek', logo: siDeepseek }],
  [/^openrouter/, { title: 'OpenRouter', logo: siOpenrouter }],
  [/^(huggingface|hf)/, { title: 'Hugging Face', logo: siHuggingface }],
  [/^(xai|grok)/, { title: 'xAI', logo: siX }],
  [/^groq/, { title: 'Groq' }],
  [/^(github-copilot|copilot)/, { title: 'GitHub Copilot', logo: siGithubcopilot }],
  [/^nvidia/, { title: 'NVIDIA', logo: siNvidia }],
  [/^cerebras/, { title: 'Cerebras' }],
  [/^(kimi|moonshot)/, { title: 'Kimi', logo: siKimi }],
  [/^minimax/, { title: 'MiniMax', logo: siMinimax }],
  [/^qwen/, { title: 'Qwen', logo: siQwen }],
  [/^xiaomi/, { title: 'Xiaomi MiMo', logo: siXiaomi }],
  [/^meta/, { title: 'Meta', logo: siMeta }],
  [/^cloudflare/, { title: 'Cloudflare', logo: siCloudflare }],
  [/^vercel/, { title: 'Vercel AI Gateway', logo: siVercel }],
  [/^opencode/, { title: 'OpenCode', logo: siOpencode }],
  [/^perplexity/, { title: 'Perplexity', logo: siPerplexity }],
  [/^(amazon|bedrock)/, { title: 'Amazon Bedrock' }],
  [/^fireworks/, { title: 'Fireworks' }],
  [/^together/, { title: 'Together AI' }],
  [/^ollama/, { title: 'Ollama', logo: siOllama }],
  [/^lmstudio/, { title: 'LM Studio', logo: siLmstudio }],
  [/^vllm/, { title: 'vLLM', logo: siVllm }],
  [/^llamacpp/, { title: 'llama.cpp' }],
];

/** The brand of a provider. `title` is what its mind calls it: used when it says more than the id. */
export function brand(id: string, title: string): Brand {
  const known = BRANDS.find(([pattern]) => pattern.test(id))?.[1];
  return { title: title && title !== id ? title : known?.title ?? id, logo: known?.logo };
}

/** A provider's logo, or its first letter, in a rounded square. */
export function logo(id: string, title: string, size = 40): HTMLElement {
  const box = document.createElement('span');
  box.className = 'logo';
  box.style.setProperty('--size', `${size}px`);
  const { logo: found, title: named } = brand(id, title);
  if (found) {
    // (A logo that is black or nearly so takes the colour of the text, to be seen in the dark too.)
    const [r, g, b] = [0, 2, 4].map(at => parseInt(found.hex.slice(at, at + 2), 16));
    const dark = 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 60;
    box.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${found.path}" fill="${dark ? 'currentColor' : `#${found.hex}`}"/></svg>`;
  } else {
    let hue = 0;
    for (const letter of id) hue = (hue * 31 + letter.charCodeAt(0)) % 360;
    box.classList.add('letter');
    box.style.setProperty('--hue', String(hue));
    box.textContent = named.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?';
  }
  return box;
}
