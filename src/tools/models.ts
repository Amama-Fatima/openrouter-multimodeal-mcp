import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ModelCache } from "../model-cache.js";
import { OpenRouterAPIClient } from "../openrouter-api.js";
import { handleSearchModels } from "../tool-handlers/search-models.js";
import { handleGetModelInfo } from "../tool-handlers/get-model-info.js";
import { handleValidateModel } from "../tool-handlers/validate-model.js";

const searchModelsSchema = z.object({
  query: z.string().describe("Search query for models"),
  limit: z.number().optional().describe("Maximum number of results to return"),
});

const getModelInfoSchema = z.object({
  model_id: z.string().describe("Model ID to get information for"),
});

const validateModelSchema = z.object({
  model_id: z.string().describe("Model ID to validate"),
  require_vision: z
    .boolean()
    .optional()
    .describe("Whether the model must support vision"),
});

export function registerModelTools(
  server: McpServer,
  apiClient: OpenRouterAPIClient,
  modelCache: ModelCache
) {
  server.tool(
    "mcp_openrouter_search_models",
    "Search for available OpenRouter models",
    searchModelsSchema.shape,
    async (args) => {
      try {
        const result = await handleSearchModels(
          { params: { arguments: args as any } },
          apiClient,
          modelCache
        );
        return {
          ...result,
          content: result.content.map((c) => ({ ...c, type: "text" as const })),
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to search models: ${
                error.message || String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "mcp_openrouter_get_model_info",
    "Get detailed information about a specific OpenRouter model",
    getModelInfoSchema.shape,
    async (args) => {
      try {
        const result = await handleGetModelInfo(
          { params: { arguments: args as any } },
          modelCache
        );
        return {
          ...result,
          content: result.content.map((c) => ({ ...c, type: "text" as const })),
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get model info: ${
                error.message || String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "mcp_openrouter_validate_model",
    "Validate if a model exists and optionally check for vision support",
    validateModelSchema.shape,
    async (args) => {
      try {
        const result = await handleValidateModel(
          { params: { arguments: args as any } },
          modelCache
        );
        return {
          ...result,
          content: result.content.map((c) => ({ ...c, type: "text" as const })),
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to validate model: ${
                error.message || String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
