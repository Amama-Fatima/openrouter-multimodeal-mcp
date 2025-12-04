import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import sharp from "sharp";
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
  n: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .default(1)
    .describe("Number of images to generate (1-4, default: 1)"),

  // Image Processing Options
  output_format: z
    .enum(["png", "jpeg", "jpg", "webp", "avif"])
    .optional()
    .default("png")
    .describe("Output image format (png, jpeg, webp, avif)"),
  quality: z
    .enum(["low", "medium", "high"])
    .optional()
    .default("medium")
    .describe("Image quality: low (50), medium (70), high (90)"),
  output_compression: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe(
      "PNG compression level (0-9, only for PNG format). 0=fastest/largest, 9=slowest/smallest"
    ),
  size: z
    .enum(["auto", "1K", "2K", "4K"])
    .optional()
    .default("auto")
    .describe(
      "Resize image: auto (original), 1K (1024px), 2K (2048px), 4K (4096px)"
    ),
  background: z
    .enum(["auto", "transparent", "white", "black"])
    .optional()
    .default("auto")
    .describe(
      "Background handling: auto (keep original), transparent, white, black"
    ),

  // Cloudinary Options
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
 * Get quality value from quality level
 */
function getQualityValue(quality: string): number {
  switch (quality) {
    case "low":
      return 50;
    case "high":
      return 90;
    case "medium":
    default:
      return 70;
  }
}

/**
 * Get size in pixels from size option
 */
function getSizeInPixels(size: string): number | null {
  switch (size) {
    case "1K":
      return 1024;
    case "2K":
      return 2048;
    case "4K":
      return 4096;
    case "auto":
    default:
      return null;
  }
}

/**
 * Process image with Sharp
 */
async function processImageWithSharp(
  base64Data: string,
  options: {
    output_format: string;
    quality: string;
    output_compression?: number;
    size: string;
    background: string;
  }
): Promise<{ buffer: Buffer; mimeType: string; format: string }> {
  console.log("[SHARP] Starting image processing with options:", options);

  // Convert base64 to buffer
  const inputBuffer = Buffer.from(base64Data, "base64");

  // Initialize sharp instance
  let sharpInstance = sharp(inputBuffer);

  // Get image metadata for logging
  const metadata = await sharpInstance.metadata();
  console.log(
    `[SHARP] Input image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`
  );

  // Handle background
  if (options.background !== "auto") {
    let bgColor: any;
    switch (options.background) {
      case "transparent":
        bgColor = { r: 0, g: 0, b: 0, alpha: 0 };
        break;
      case "white":
        bgColor = { r: 255, g: 255, b: 255, alpha: 1 };
        break;
      case "black":
        bgColor = { r: 0, g: 0, b: 0, alpha: 1 };
        break;
    }

    if (bgColor) {
      sharpInstance = sharpInstance.flatten({ background: bgColor });
      console.log(`[SHARP] Applied background: ${options.background}`);
    }
  }

  // Resize if needed
  const targetSize = getSizeInPixels(options.size);
  if (targetSize) {
    sharpInstance = sharpInstance.resize(targetSize, targetSize, {
      fit: "inside",
      withoutEnlargement: true,
    });
    console.log(`[SHARP] Resizing to max ${targetSize}px`);
  }

  // Get quality value
  const qualityValue = getQualityValue(options.quality);

  // Format conversion with quality/compression settings
  const format =
    options.output_format === "jpg" ? "jpeg" : options.output_format;

  switch (format) {
    case "jpeg":
      sharpInstance = sharpInstance.jpeg({
        quality: qualityValue,
        mozjpeg: true, // Use mozjpeg for better compression
      });
      console.log(`[SHARP] Converting to JPEG with quality ${qualityValue}`);
      break;

    case "png":
      const compressionLevel = options.output_compression ?? 6;
      sharpInstance = sharpInstance.png({
        compressionLevel: compressionLevel,
        quality: qualityValue,
      });
      console.log(
        `[SHARP] Converting to PNG with compression level ${compressionLevel}, quality ${qualityValue}`
      );
      break;

    case "webp":
      sharpInstance = sharpInstance.webp({
        quality: qualityValue,
      });
      console.log(`[SHARP] Converting to WebP with quality ${qualityValue}`);
      break;

    case "avif":
      sharpInstance = sharpInstance.avif({
        quality: qualityValue,
      });
      console.log(`[SHARP] Converting to AVIF with quality ${qualityValue}`);
      break;
  }

  // Convert to buffer
  const outputBuffer = await sharpInstance.toBuffer({
    resolveWithObject: true,
  });

  console.log(
    `[SHARP] Processing complete: ${outputBuffer.info.width}x${
      outputBuffer.info.height
    }, ${outputBuffer.info.format}, ${(outputBuffer.info.size / 1024).toFixed(
      2
    )} KB`
  );

  return {
    buffer: outputBuffer.data,
    mimeType: `image/${outputBuffer.info.format}`,
    format: outputBuffer.info.format,
  };
}

/**
 * Format success message
 */
function formatSuccessMessage(
  uploadResult: any,
  imageIndex: number,
  totalImages: number,
  processingStats?: {
    originalSize: string;
    processedSize: string;
    format: string;
  }
): string {
  const imageLabel =
    totalImages > 1 ? ` (Image ${imageIndex}/${totalImages})` : "";

  let message = `✅ **Image Generated & Uploaded Successfully!**${imageLabel}\n\n`;

  if (processingStats) {
    message += `🔧 **Processing**: ${processingStats.originalSize} → ${processingStats.processedSize} (${processingStats.format})\n`;
  }

  message += `🔗 **Cloudinary URL**: ${uploadResult.url}
📦 **Format**: ${uploadResult.format}
📏 **Dimensions**: ${uploadResult.width}x${uploadResult.height}
💾 **Size**: ${(uploadResult.bytes / 1024).toFixed(2)} KB
🆔 **Public ID**: ${uploadResult.public_id}`;

  return message;
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

  server.registerTool(
    "mcp_openrouter_generate_image",
    {
      title: "AI Image Generation with Post-Processing (OpenRouter + Sharp)",
      description:
        "Generate one or multiple images from a text prompt using OpenRouter (Gemini, etc.), with advanced post-processing options including format conversion, quality control, compression, resizing, and background handling. Images are automatically processed and uploaded to Cloudinary.",
      inputSchema: generateImageSchema.shape,
    },
    async (args, extra) => {
      console.log("[IMAGE-GEN] Starting generation");
      console.log("[IMAGE-GEN] Prompt:", args.prompt);
      console.log("[IMAGE-GEN] Model:", args.model || defaultImageModel);
      console.log("[IMAGE-GEN] Number of images:", args.n);
      console.log("[IMAGE-GEN] Processing options:", {
        format: args.output_format,
        quality: args.quality,
        size: args.size,
        background: args.background,
      });

      const model = args.model || defaultImageModel;
      const folder = args.cloudinary_folder || "ai-generated";
      const numImages = args.n || 1;

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

        // Add number of images parameter
        // Note: numberOfImages is only supported by Imagen models, not Gemini image models
        // Gemini models generate images conversationally and don't support this parameter
        if (numImages > 1) {
          if (model.toLowerCase().includes("imagen")) {
            requestParams.numberOfImages = numImages;
          } else if (!model.toLowerCase().includes("gemini")) {
            requestParams.n = numImages;
          }
          // For Gemini models, we'll need to make multiple sequential calls
        }

        // Generate image(s)
        // Note: Gemini models don't support generating multiple images in one call
        // so we need to make multiple sequential calls for n > 1
        const startTime = Date.now();
        let allImages: any[] = [];

        if (model.toLowerCase().includes("gemini") && numImages > 1) {
          console.log(
            `[IMAGE-GEN] Gemini model detected - making ${numImages} sequential calls`
          );

          for (let i = 0; i < numImages; i++) {
            console.log(
              `[IMAGE-GEN] Generating image ${i + 1}/${numImages}...`
            );
            const result = await openai.chat.completions.create(requestParams);
            const message = result.choices?.[0]?.message;
            const images = (message as any)?.images || [];
            allImages.push(...images);
          }
        } else {
          // Single call for Imagen or other models
          const result = await openai.chat.completions.create(requestParams);
          const message = result.choices?.[0]?.message;
          allImages = (message as any)?.images || [];
        }

        const genTime = Date.now() - startTime;
        console.log(
          `[IMAGE-GEN] Generated ${allImages.length} image(s) in ${genTime}ms`
        );

        // Extract images
        if (!allImages || allImages.length === 0) {
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

        console.log(`[IMAGE-GEN] Processing ${allImages.length} image(s)`);

        // Process images - convert to base64 and mimeType format
        const processedImages = allImages
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
            `[IMAGE-GEN] Processing and uploading ${processedImages.length} image(s) to Cloudinary folder: ${folder}`
          );

          const responses = [];

          // Add header if multiple images
          if (processedImages.length > 1) {
            responses.push({
              type: "text" as const,
              text: `🎨 **Generated ${processedImages.length} images**\n`,
            });
          }

          // Process and upload each image
          for (let i = 0; i < processedImages.length; i++) {
            const img = processedImages[i];
            if (!img) continue;
            const originalSize = (
              Buffer.from(img.b64, "base64").length / 1024
            ).toFixed(2);

            try {
              // Process image with Sharp
              const processed = await processImageWithSharp(img.b64, {
                output_format: args.output_format || "png",
                quality: args.quality || "medium",
                output_compression: args.output_compression,
                size: args.size || "auto",
                background: args.background || "auto",
              });

              const processedSize = (processed.buffer.length / 1024).toFixed(2);
              const processedBase64 = processed.buffer.toString("base64");

              // Upload processed image to Cloudinary
              const uploadResult = await uploadToCloudinary(
                processedBase64,
                processed.mimeType,
                {
                  folder,
                  context: `prompt=${args.prompt.substring(0, 75)}|image=${
                    i + 1
                  }/${processedImages.length}|format=${
                    processed.format
                  }|quality=${args.quality}`,
                  tags: [
                    "ai-generated",
                    "openrouter",
                    model.split("/")[0],
                    `format-${processed.format}`,
                    `quality-${args.quality}`,
                  ],
                }
              );

              if (uploadResult.success && uploadResult.url) {
                // Simple, minimal response with just the URL and key info
                const imageLabel =
                  processedImages.length > 1
                    ? ` [${i + 1}/${processedImages.length}]`
                    : "";

                responses.push({
                  type: "text" as const,
                  text: `✅ Image${imageLabel}: ${uploadResult.url}\n📊 ${originalSize}KB → ${processedSize}KB (${processed.format}, ${args.quality})`,
                });
              } else {
                responses.push({
                  type: "text" as const,
                  text: `⚠️ Cloudinary upload failed for image ${i + 1}: ${
                    uploadResult.error
                  }`,
                });
              }
            } catch (processingError: any) {
              console.error(
                `[SHARP] Processing failed for image ${i + 1}:`,
                processingError.message
              );
              responses.push({
                type: "text" as const,
                text: `❌ Image processing failed for image ${i + 1}: ${
                  processingError.message
                }`,
              });
            }
          }

          console.log(
            `[IMAGE-GEN] Successfully processed and uploaded to Cloudinary`
          );
          return { content: responses };
        } else {
          // Return without Cloudinary upload (but still process)
          return {
            content: [
              {
                type: "text",
                text: `✅ ${processedImages.length} image(s) generated in ${genTime}ms\n\nPrompt: "${args.prompt}"\nModel: ${model}\n\n(Upload to Cloudinary disabled - images were processed but not uploaded)`,
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
