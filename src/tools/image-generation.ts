import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const generateImageSchema = z.object({
  prompt: z.string().describe("Text prompt describing the image to generate"),
  model: z
    .string()
    .optional()
    .describe(
      'OpenRouter model to use for generation (e.g., "google/gemini-2.5-flash-image")'
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
  server.tool(
    "mcp_openrouter_generate_image",
    "Generate an image from a text prompt using OpenRouter image generation models",
    generateImageSchema.shape,
    async (args) => {
      console.log("[TEST] Received args:", args);

      // Return success immediately - NO IMAGE GENERATION
      return {
        content: [
          {
            type: "text",
            text: `✅ Test successful!\n\nPrompt: "${args.prompt}"\nModel: ${
              args.model || defaultImageModel
            }\nAspect ratio: ${args.aspect_ratio || "default"}`,
          },
        ],
      };
    }
  );
}
