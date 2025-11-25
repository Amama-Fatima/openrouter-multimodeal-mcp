import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";

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
      console.log("[IMAGE-GEN] Starting generation");
      console.log("[IMAGE-GEN] Prompt:", args.prompt);
      console.log("[IMAGE-GEN] Model:", args.model || defaultImageModel);

      const model = args.model || defaultImageModel;

      try {
        // Build request
        const requestParams: any = {
          model: model,
          messages: [{ role: "user", content: args.prompt }],
          modalities: ["image", "text"],
        };

        // Add aspect ratio for Gemini models
        if (model.toLowerCase().includes("gemini") && args.aspect_ratio) {
          requestParams.image_config = { aspect_ratio: args.aspect_ratio };
        }

        // Generate image
        const startTime = Date.now();
        const result = await openai.chat.completions.create(requestParams);
        const genTime = Date.now() - startTime;

        console.log(`[IMAGE-GEN] Generated in ${genTime}ms`);

        // Extract images
        const message = result.choices?.[0]?.message;
        const images = (message as any)?.images || [];

        if (!images || images.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "❌ No images generated",
              },
            ],
            isError: true,
          };
        }

        // Get the first image
        const imageData = images[0].image_url?.url || images[0].url;

        if (!imageData) {
          return {
            content: [
              {
                type: "text",
                text: "❌ No image data found",
              },
            ],
            isError: true,
          };
        }

        console.log("[IMAGE-GEN] Image data length:", imageData.length);
        console.log("[IMAGE-GEN] Returning response");

        // Return with base64 image
        return {
          content: [
            {
              type: "text",
              text: `✅ Image generated in ${genTime}ms\n\nPrompt: "${args.prompt}"\nModel: ${model}`,
            },
            {
              type: "image",
              data: imageData,
              mimeType: "image/png",
            },
          ],
        };
      } catch (error: any) {
        console.error("[IMAGE-GEN] Error:", error.message);
        return {
          content: [
            {
              type: "text",
              text: `❌ Generation failed: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
