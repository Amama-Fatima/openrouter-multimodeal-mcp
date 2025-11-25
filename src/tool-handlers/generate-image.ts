import OpenAI from "openai";
import {
  uploadToCloudinary,
  uploadMultipleToCloudinary,
} from "../utils/cloudinary.js";

export interface GenerateImageToolRequest {
  prompt: string;
  model?: string;
  aspect_ratio?:
    | "1:1"
    | "2:3"
    | "3:2"
    | "3:4"
    | "4:3"
    | "4:5"
    | "5:4"
    | "9:16"
    | "16:9"
    | "21:9";
  n?: number;
  cloudinary_folder?: string;
}

const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

/**
 * Extract base64 from data URI
 */
function extractBase64(dataUri: string): string {
  if (dataUri.startsWith("data:")) {
    const parts = dataUri.split(",");
    return parts[1];
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
 * Handle image generation using OpenRouter
 */
export async function handleGenerateImage(
  request: { params: { arguments: GenerateImageToolRequest } },
  openai: OpenAI,
  defaultModel?: string
) {
  const args = request.params.arguments;

  console.error("[generate-image] 🎨 Starting image generation");
  console.error(
    `[generate-image] 📝 Prompt: ${args.prompt.substring(0, 100)}...`
  );

  // Validate prompt
  if (!args.prompt || args.prompt.trim().length === 0) {
    return {
      content: [{ type: "text", text: "Error: Prompt cannot be empty." }],
      isError: true,
    };
  }

  try {
    const model = args.model || defaultModel || DEFAULT_IMAGE_MODEL;

    // OpenRouter uses Chat Completions API for image generation
    const requestParams: any = {
      model: model,
      messages: [{ role: "user", content: args.prompt }],
      modalities: ["image", "text"],
    };

    // Add image_config for Gemini models
    if (model.toLowerCase().includes("gemini") && args.aspect_ratio) {
      requestParams.image_config = { aspect_ratio: args.aspect_ratio };
    }

    // Generate the image
    console.error("[generate-image] 🚀 Calling OpenRouter...");
    const startTime = Date.now();

    const result = await openai.chat.completions.create(requestParams);

    const generationTime = Date.now() - startTime;
    console.error(`[generate-image] ✅ Image generated in ${generationTime}ms`);

    const message = result.choices?.[0]?.message;
    if (!message) {
      return {
        content: [{ type: "text", text: "Error: No response from model." }],
        isError: true,
      };
    }

    // Extract images from OpenRouter response
    const images = (message as any).images || [];
    console.error(`[generate-image] 🖼️  Found ${images.length} image(s)`);

    if (!images || images.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Model did not generate images. Message: ${
              message.content || "No content"
            }`,
          },
        ],
        isError: true,
      };
    }

    // Extract base64 image URLs
    const base64DataUris: string[] = images
      .map((img: any) => {
        if (img.image_url?.url) return img.image_url.url;
        if (img.url) return img.url;
        return null;
      })
      .filter((url: string | null): url is string => url !== null);

    if (base64DataUris.length === 0) {
      return {
        content: [{ type: "text", text: "Error: No valid images found." }],
        isError: true,
      };
    }

    // Prepare images for upload - extract base64 and mime type
    const imagesToUpload = base64DataUris.map((dataUri) => ({
      base64: extractBase64(dataUri),
      mimeType: extractMimeType(dataUri),
    }));

    // Upload to Cloudinary using the SDK function
    console.error("[generate-image] 🌥️  Uploading to Cloudinary...");

    const folderName = args.cloudinary_folder || "ai-generated";
    const uploadResults = await uploadMultipleToCloudinary(imagesToUpload, {
      folder: folderName,
      tags: ["ai-generated", "openrouter", model.split("/")[0]],
      prompt: args.prompt,
    });

    const uploadTime = Date.now() - startTime - generationTime;
    console.error(
      `[generate-image] ✅ Cloudinary upload complete in ${uploadTime}ms`
    );

    // Check if any uploads failed
    const successfulUploads = uploadResults.filter((r) => r.success);
    const failedUploads = uploadResults.filter((r) => !r.success);

    if (failedUploads.length > 0) {
      console.error(
        `[generate-image] ⚠️  ${failedUploads.length} upload(s) failed`
      );
    }

    if (successfulUploads.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `❌ All Cloudinary uploads failed.\n\nErrors: ${failedUploads
              .map((r) => r.error)
              .join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Build response with Cloudinary URLs AND base64 images
    const responseContent: Array<{
      type: "text" | "image";
      text?: string;
      data?: string;
      mimeType?: string;
    }> = [
      {
        type: "text",
        text: `✅ Generated ${
          successfulUploads.length
        } image(s) and uploaded to Cloudinary!\n\n📝 Prompt: "${
          args.prompt
        }"\n🤖 Model: ${model}${
          args.aspect_ratio ? `\n📐 Aspect Ratio: ${args.aspect_ratio}` : ""
        }\n\n⏱️  Generation: ${generationTime}ms | Upload: ${uploadTime}ms\n`,
      },
    ];

    // Add images with both Cloudinary URLs and embedded base64
    successfulUploads.forEach((result, index) => {
      // Add metadata
      responseContent.push({
        type: "text",
        text: `\n🖼️  Image ${index + 1}:\n🔗 ${result.secure_url}\n📦 ${
          result.format
        } | 📏 ${result.width}x${result.height} | 💾 ${
          result.bytes?.toLocaleString() || "N/A"
        } bytes`,
      });

      // Add the actual image using Cloudinary URL (faster to load)
      responseContent.push({
        type: "image",
        data: result.secure_url || result.url!,
        mimeType: `image/${result.format}`,
      });
    });

    if (failedUploads.length > 0) {
      responseContent.push({
        type: "text",
        text: `\n⚠️  ${failedUploads.length} upload(s) failed: ${failedUploads
          .map((r) => r.error)
          .join(", ")}`,
      });
    }

    const totalTime = Date.now() - startTime;
    console.error(
      `[generate-image] ✅ Returning response to Claude (${totalTime}ms total)`
    );

    return {
      content: responseContent,
      isError: false,
    };
  } catch (error: any) {
    console.error("[generate-image] ❌ Error:", error.message);

    let errorMessage = `Failed to generate image: ${
      error.message || "Unknown error"
    }`;

    if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
      errorMessage += "\n\nRequest timed out. Try a simpler prompt.";
    } else if (error.status === 429) {
      errorMessage += "\n\nRate limit exceeded. Please wait.";
    } else if (error.status === 400) {
      errorMessage += "\n\nInvalid request. Check your prompt.";
    } else if (error.status === 401) {
      errorMessage += "\n\nAuthentication failed. Check OpenRouter API key.";
    }

    return {
      content: [{ type: "text", text: errorMessage }],
      isError: true,
    };
  }
}
