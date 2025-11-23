import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import { handleChatCompletion } from "../tool-handlers/chat-completion.js";

const chatCompletionSchema = z.object({
  model: z
    .string()
    .optional()
    .describe(
      'The model to use (e.g., "google/gemini-2.5-pro-exp-03-25:free"). If not provided, uses the default model.'
    ),
  messages: z
    .array(
      z.object({
        role: z
          .enum(["system", "user", "assistant"])
          .describe("The role of the message sender"),
        content: z.union([
          z.string().describe("The text content of the message"),
          z
            .array(
              z.object({
                type: z
                  .enum(["text", "image_url"])
                  .describe("The type of content"),
                text: z
                  .string()
                  .optional()
                  .describe("The text content (for text type)"),
                image_url: z
                  .object({
                    url: z
                      .string()
                      .describe("The URL or data URL of the image"),
                  })
                  .optional()
                  .describe("The image URL object (for image_url type)"),
              })
            )
            .describe("Array of content parts for multimodal messages"),
        ]),
      })
    )
    .min(1)
    .max(100)
    .describe("An array of conversation messages"),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe("Sampling temperature (0-2)"),
});

export function registerChatTools(
  server: McpServer,
  apiKey: string,
  defaultModel: string
) {
  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/stabgan/openrouter-mcp-multimodal",
      "X-Title": "OpenRouter MCP Multimodal Server",
    },
  });

  server.tool(
    "mcp_openrouter_chat_completion",
    "Send a message to OpenRouter.ai and get a response",
    chatCompletionSchema.shape,
    async (args) => {
      try {
        const result = await handleChatCompletion(
          { params: { arguments: args as any } },
          openai,
          defaultModel
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
              text: `Failed to complete chat: ${
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
