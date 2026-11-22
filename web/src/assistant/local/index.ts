import { geocode } from '../../services';
// Which assistant the app talks to by default:
//   - a gateway URL is configured (VITE_ASSISTANT_GATEWAY_URL): the owner's remote service, through the gateway;
//   - otherwise: Global SAR AI in the browser (adapter.ts), which needs no server and so also works on a static site.
//     It answers from its knowledge base, the open view and the map's catalog, searches the web live for questions
//     outside them, and, when the build names one (VITE_ASSISTANT_MODEL), offers a language model that words answers.
// One shared instance, so the chat in the top bar and the one inside an investigation share what is loaded.
import { UnavailableAdapter, createAdapter, type AssistantAdapter } from '../adapter';
import { LocalAssistantAdapter } from './adapter';
import { createEngine } from './engine';
import { createWikipediaResearch } from './research';

interface Env {
  VITE_ASSISTANT_GATEWAY_URL?: string;
  /** Where the language-model weights are published (assistant-model/MODEL.md). Unset: no model is offered. */
  VITE_ASSISTANT_MODEL?: string;
  VITE_ASSISTANT_MODEL_DTYPE?: string;
  VITE_ASSISTANT_MODEL_SIZE?: string;
  /** '0' turns live web research off. */
  VITE_ASSISTANT_RESEARCH?: string;
}

let local: LocalAssistantAdapter | null = null;

export function defaultAdapter(env: Env = import.meta.env as Env): AssistantAdapter {
  const remote = createAdapter(env);
  if (!(remote instanceof UnavailableAdapter)) return remote;
  if (!local) {
    const model = env.VITE_ASSISTANT_MODEL?.trim();
    local = new LocalAssistantAdapter({
      research: env.VITE_ASSISTANT_RESEARCH?.trim() === '0' ? null : createWikipediaResearch(),
      geocode: async (q) => { const h = (await geocode(q))[0]; return h ? { lat: h.lat, lon: h.lon, label: h.label } : undefined; },
      engine: model ? createEngine({ model, dtype: env.VITE_ASSISTANT_MODEL_DTYPE?.trim() || 'q4', size: env.VITE_ASSISTANT_MODEL_SIZE?.trim() || 'about 1.7 GB' }) : null,
    });
  }
  return local;
}
