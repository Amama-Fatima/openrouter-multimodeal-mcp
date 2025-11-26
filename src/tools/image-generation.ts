import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import { uploadToCloudinary } from "../utils/cloudinary.js";

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
    .default(true)
    .describe("Whether to upload the generated image to Cloudinary"),
  cloudinary_folder: z
    .string()
    .optional()
    .default("ai-generated")
    .describe("Cloudinary folder to upload to"),
});

/**
 * Extract base64 from data URI
 */
function extractBase64(dataUri: string): string {
  if (dataUri.startsWith("data:")) {
    return dataUri.split(",")[1];
  }
  return dataUri;
}

/**
 * Extract mime type from data URI
 */
function extractMimeType(dataUri: string): string {
  if (dataUri.startsWith("data:")) {
    const match = dataUri.match(/data:([^;]+);/);
    return match ? match[1] : "image/png";
  }
  return "image/png";
}

/**
 * Format success message
 */
function formatSuccessMessage(uploadResult: any): string {
  return `✅ **Image Generated & Uploaded Successfully!**

🔗 **Cloudinary URL**: ${uploadResult.url}
📦 **Format**: ${uploadResult.format}
📏 **Dimensions**: ${uploadResult.width}x${uploadResult.height}
💾 **Size**: ${(uploadResult.bytes / 1024).toFixed(2)} KB
🆔 **Public ID**: ${uploadResult.public_id}`;
}

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

  // Use registerTool like OpenAI MCP
  server.registerTool(
    "mcp_openrouter_generate_image",
    {
      title: "AI Image Generation (OpenRouter)",
      description:
        "Generate an image from a text prompt using OpenRouter image generation models (Gemini, etc.). Images are automatically uploaded to Cloudinary.",
      inputSchema: generateImageSchema.shape,
    },
    async (args, extra) => {
      console.log("[IMAGE-GEN] Starting generation");
      console.log("[IMAGE-GEN] Prompt:", args.prompt);
      console.log("[IMAGE-GEN] Model:", args.model || defaultImageModel);

      const model = args.model || defaultImageModel;
      const folder = args.cloudinary_folder || "ai-generated";

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

        console.log(`[IMAGE-GEN] Processing ${images.length} image(s)`);

        // Process images - convert to base64 and mimeType format like OpenAI MCP
        const processedImages = images
          .map((img: any) => {
            const dataUri = img.image_url?.url || img.url;
            if (!dataUri) return null;

            return {
              b64: extractBase64(dataUri),
              mimeType: extractMimeType(dataUri),
            };
          })
          .filter((img: any) => img !== null);

        if (processedImages.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "❌ No valid image data found",
              },
            ],
            isError: true,
          };
        }

        // Upload to Cloudinary if requested
        if (args.upload_to_cloudinary) {
          console.log(
            `[IMAGE-GEN] Uploading ${processedImages.length} image(s) to Cloudinary folder: ${folder}`
          );

          const responses = [];

          // Upload each image - exactly like OpenAI MCP
          for (let i = 0; i < processedImages.length; i++) {
            const img = processedImages[i];

            const uploadResult = await uploadToCloudinary(
              img.b64,
              img.mimeType,
              {
                folder,
                context: `prompt=${args.prompt}`,
                tags: ["ai-generated", "openrouter", model.split("/")[0]],
              }
            );

            if (uploadResult.success && uploadResult.url) {
              const successMessage = formatSuccessMessage(uploadResult);

              responses.push({
                type: "text" as const,
                text: successMessage,
              });

              // Add image using Cloudinary URL (NOT base64)
              responses.push({
                type: "image" as const,
                data: uploadResult.url,
                mimeType: `image/${uploadResult.format}`,
              });
            } else {
              // Fallback to base64 if upload fails
              responses.push({
                type: "text" as const,
                text: `⚠️ Cloudinary upload failed: ${uploadResult.error}\n\nShowing image using base64 data instead:`,
              });
              responses.push({
                type: "image" as const,
                data: `data:${img.mimeType};base64,${img.b64}`,
                mimeType: img.mimeType,
              });
            }
          }

          console.log(`[IMAGE-GEN] Successfully uploaded to Cloudinary`);
          return { content: responses };
        } else {
          // Return without Cloudinary upload
          return {
            content: [
              {
                type: "text",
                text: `✅ Image generated in ${genTime}ms\n\nPrompt: "${args.prompt}"\nModel: ${model}\n\n(Upload to Cloudinary disabled)`,
              },
            ],
          };
        }
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
