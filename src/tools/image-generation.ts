import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import { handleGenerateImage } from "../tool-handlers/generate-image.js";

const generateImageSchema = z.object({
  prompt: z.string().describe("Text prompt describing the image to generate"),
  model: z
    .string()
    .optional()
    .describe(
      'OpenRouter model to use for generation (e.g., "black-forest-labs/flux-1.1-pro")'
    ),
  aspect_ratio: z
    .enum(["1:1", "16:9", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"])
    .optional()
    .describe("Aspect ratio for the generated image"),
  upload_to_cloudinary: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to upload the generated image to Cloudinary"),
});

export function registerImageGenerationTools(
  server: McpServer,
  apiKey: string,
  defaultImageModel: string
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
    "mcp_openrouter_generate_image",
    "Generate an image from a text prompt using OpenRouter image generation models",
    generateImageSchema.shape,
    async (args) => {
      try {
        const result = await handleGenerateImage(
          { params: { arguments: args as any } },
          openai,
          defaultImageModel
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
              text: `Failed to generate image: ${
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
