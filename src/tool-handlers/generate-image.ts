import OpenAI from "openai";
import {
  uploadMultipleToCloudinary,
  retryCloudinaryUpload,
  CloudinaryConfig,
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
  upload_to_cloudinary?: boolean;
  cloudinary_folder?: string;
}

const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2, // Reduced from 3
  initialDelay: number = 2000, // Reduced from 3000
  operationName: string = "Operation"
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(1.5, attempt); // Reduced exponential factor
        console.error(
          `${operationName} attempt ${
            attempt + 1
          } failed, retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error(`${operationName} failed after all retries`);
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
  console.error(
    `[generate-image] 🤖 Model: ${
      args.model || defaultModel || DEFAULT_IMAGE_MODEL
    }`
  );

  // Validate prompt
  if (!args.prompt || args.prompt.trim().length === 0) {
    console.error("[generate-image] ❌ ERROR: Empty prompt");
    return {
      content: [
        {
          type: "text",
          text: "Error: Prompt cannot be empty.",
        },
      ],
      isError: true,
    };
  }

  try {
    const model = args.model || defaultModel || DEFAULT_IMAGE_MODEL;

    // OpenRouter uses Chat Completions API for image generation
    const requestParams: any = {
      model: model,
      messages: [
        {
          role: "user",
          content: args.prompt,
        },
      ],
      modalities: ["image", "text"],
    };

    // Add image_config for Gemini models
    if (model.toLowerCase().includes("gemini") && args.aspect_ratio) {
      requestParams.image_config = {
        aspect_ratio: args.aspect_ratio,
      };
      console.error(`[generate-image] 📐 Aspect ratio: ${args.aspect_ratio}`);
    }

    // Generate the image with reduced retries
    console.error("[generate-image] 🚀 Calling OpenRouter...");
    const result = await retryWithBackoff(
      async () => {
        const completion = await openai.chat.completions.create(requestParams);
        return completion;
      },
      2, // Reduced retries
      2000, // Reduced initial delay
      "OpenRouter Image Generation"
    );

    const message = result.choices?.[0]?.message;
    if (!message) {
      console.error("[generate-image] ❌ No response message");
      return {
        content: [
          {
            type: "text",
            text: "Error: No response message from the model.",
          },
        ],
        isError: true,
      };
    }

    console.error("[generate-image] ✅ Response received");

    // Extract images from OpenRouter response
    const images = (message as any).images || [];
    console.error(`[generate-image] 🖼️  Found ${images.length} image(s)`);

    if (!images || images.length === 0) {
      console.error("[generate-image] ❌ No images in response");
      return {
        content: [
          {
            type: "text",
            text: `The model responded but did not generate images. Message: ${
              message.content || "No content"
            }`,
          },
        ],
        isError: true,
      };
    }

    // Extract base64 image URLs
    const base64Images: string[] = images
      .map((img: any) => {
        if (img.image_url && img.image_url.url) {
          return img.image_url.url;
        }
        if (img.url) {
          return img.url;
        }
        return null;
      })
      .filter((url: string | null): url is string => url !== null);

    console.error(
      `[generate-image] ✅ Extracted ${base64Images.length} base64 image(s)`
    );

    if (base64Images.length === 0) {
      console.error("[generate-image] ❌ No valid base64 images");
      return {
        content: [
          {
            type: "text",
            text: "Error: No valid image URLs found in the response.",
          },
        ],
        isError: true,
      };
    }

    // Upload to Cloudinary (always enabled)
    console.error("[generate-image] 🌥️  Uploading to Cloudinary...");

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName) {
      console.error("[generate-image] ❌ CLOUDINARY_CLOUD_NAME missing");
      return {
        content: [
          {
            type: "text",
            text: "❌ Error: CLOUDINARY_CLOUD_NAME environment variable is required.",
          },
        ],
        isError: true,
      };
    }

    const cloudinaryConfig: CloudinaryConfig = {
      cloudName: cloudName,
      apiKey: apiKey || "",
      apiSecret: apiSecret || "",
    };

    const folderName = args.cloudinary_folder || "ai-generated";

    try {
      const uploadResults = await retryCloudinaryUpload(
        async () =>
          await uploadMultipleToCloudinary(base64Images, cloudinaryConfig, {
            folder: folderName,
            tags: ["ai-generated", "openrouter", model.split("/")[0]],
            prompt: args.prompt,
          }),
        2, // Reduced retries
        1500 // Reduced delay
      );

      console.error("[generate-image] ✅ Cloudinary upload complete!");

      // Build response with ONLY text and Cloudinary URLs (no base64)
      const responseContent: Array<{
        type: "text" | "image";
        text?: string;
        data?: string;
        mimeType?: string;
      }> = [
        {
          type: "text",
          text: `✅ Generated ${
            uploadResults.length
          } image(s) and uploaded to Cloudinary!\n\n📝 Prompt: "${
            args.prompt
          }"\n🤖 Model: ${model}${
            args.aspect_ratio ? `\n📐 Aspect Ratio: ${args.aspect_ratio}` : ""
          }\n`,
        },
      ];

      // Add each image with its metadata
      uploadResults.forEach((result, index) => {
        // Add metadata as text
        responseContent.push({
          type: "text",
          text: `\n🖼️ Image ${index + 1}:\n🔗 ${result.secure_url}\n📦 ${
            result.format
          } | 📏 ${result.width}x${
            result.height
          } | 💾 ${result.bytes.toLocaleString()} bytes`,
        });

        // Add image using Cloudinary URL (NOT base64)
        responseContent.push({
          type: "image",
          data: result.secure_url,
          mimeType: `image/${result.format}`,
        });
      });

      console.error(
        "[generate-image] ✅ Response prepared, returning to Claude"
      );

      // Return with proper MCP format
      return {
        content: responseContent,
        isError: false,
      };
    } catch (cloudinaryError: any) {
      console.error(
        "[generate-image] ❌ Cloudinary upload failed:",
        cloudinaryError.message
      );

      return {
        content: [
          {
            type: "text",
            text: `❌ Image generation succeeded, but Cloudinary upload failed.\n\n🔴 Error: ${cloudinaryError.message}\n\n📝 Prompt: "${args.prompt}"\n🤖 Model: ${model}\n\n⚠️ Check Cloudinary credentials in Railway environment variables.`,
          },
        ],
        isError: true,
      };
    }
  } catch (error: any) {
    console.error("[generate-image] ❌ Fatal error:", error.message);

    let errorMessage = `Failed to generate image: ${
      error.message || "Unknown error"
    }`;

    // Add helpful context based on error type
    if (
      error.code === "ERR_STREAM_PREMATURE_CLOSE" ||
      error.message?.includes("Premature close")
    ) {
      errorMessage +=
        "\n\nConnection interrupted. Try simplifying your prompt or waiting a moment.";
    } else if (error.status === 429) {
      errorMessage +=
        "\n\nRate limit exceeded. Please wait before trying again.";
    } else if (error.status === 400) {
      errorMessage +=
        "\n\nInvalid request. Check your prompt and ensure the model supports image generation.";
    } else if (error.status === 401) {
      errorMessage +=
        "\n\nAuthentication failed. Check your OpenRouter API key.";
    } else if (error.status && error.status >= 500) {
      errorMessage +=
        "\n\nOpenRouter server error. Please try again in a moment.";
    }

    return {
      content: [
        {
          type: "text",
          text: errorMessage,
        },
      ],
      isError: true,
    };
  }
}
