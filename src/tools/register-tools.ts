import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ModelCache } from "../model-cache.js";
import { OpenRouterAPIClient } from "../openrouter-api.js";
import { registerChatTools } from "./chat.js";
import { registerImageAnalysisTools } from "./image-analysis.js";
import { registerImageGenerationTools } from "./image-generation.js";
import { registerModelTools } from "./models.js";
import { registerSettingsTools } from "./image-settings.js";

export function registerTools(
  server: McpServer,
  apiKey: string,
  defaultModel: string,
  defaultImageModel: string
) {
  const apiClient = new OpenRouterAPIClient(apiKey);
  const modelCache = ModelCache.getInstance();

  registerChatTools(server, apiKey, defaultModel);
  registerImageAnalysisTools(server, apiKey, defaultModel);
  registerImageGenerationTools(server, apiKey, defaultImageModel);
  registerModelTools(server, apiClient, modelCache);
  registerSettingsTools(server);
}
