import { configFromEnv, createGateway } from './server.mjs';

const config = configFromEnv();
const server = createGateway(config);
server.listen(config.port, config.host, () => {
  console.log(`[assistant-gateway] listening on http://${config.host}:${config.port}`);
  console.log(config.modelUrl
    ? '[assistant-gateway] model endpoint configured (URL and key are not printed)'
    : '[assistant-gateway] ASSISTANT_MODEL_URL not set: queries return 503 "Assistant not connected"');
  if (config.allowedOrigins.length === 0) console.log('[assistant-gateway] ALLOWED_ORIGINS empty: browser cross-origin calls will be refused (same-origin/proxy still works)');
});
