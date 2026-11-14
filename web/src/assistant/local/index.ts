// Which assistant the app talks to by default:
//   - a gateway URL is configured (VITE_ASSISTANT_GATEWAY_URL): the owner's remote model, through the gateway;
//   - otherwise: the in-browser chatbot (adapter.ts), which needs no server and so also works on a static site.
// One shared instance, so the chat in the top bar and the one inside an investigation use the same loaded model.
import { UnavailableAdapter, createAdapter, type AssistantAdapter } from '../adapter';
import { LocalAssistantAdapter } from './adapter';
import { createEngine } from './engine';

interface Env {
  VITE_ASSISTANT_GATEWAY_URL?: string;
  /** Hugging Face repository with the ONNX model to offer for download, e.g. "onnx-community/Qwen3-1.7B-ONNX". Unset = knowledge-base mode only. */
  VITE_ASSISTANT_MODEL?: string;
  VITE_ASSISTANT_MODEL_DTYPE?: string;
  VITE_ASSISTANT_MODEL_SIZE?: string;
}

let local: LocalAssistantAdapter | null = null;

export function defaultAdapter(env: Env = import.meta.env as Env): AssistantAdapter {
  const remote = createAdapter(env);
  if (!(remote instanceof UnavailableAdapter)) return remote;
  if (!local) {
    const model = env.VITE_ASSISTANT_MODEL?.trim();
    local = new LocalAssistantAdapter({
      engine: model ? createEngine({ model, dtype: env.VITE_ASSISTANT_MODEL_DTYPE?.trim() || 'q4', size: env.VITE_ASSISTANT_MODEL_SIZE?.trim() || 'about 1.7 GB' }) : null,
    });
  }
  return local;
}
