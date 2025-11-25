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
  upload_to_cloudinary?: boolean; // DEPRECATED: Always uploads to Cloudinary now
  cloudinary_folder?: string;
}

const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 3000,
  operationName: string = "Operation"
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
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

  console.error("╔════════════════════════════════════════════════════════════════╗");
  console.error("║       [generate-image] START IMAGE GENERATION                  ║");
  console.error("╚════════════════════════════════════════════════════════════════╝");
  console.error("[generate-image] 📝 Request args:", JSON.stringify(args, null, 2));
  console.error("[generate-image] 🤖 Default model:", defaultModel);
  console.error("[generate-image] 🌥️  Cloudinary env check:", {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ? "✅ SET" : "❌ NOT SET",
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ? "✅ SET" : "❌ NOT SET",
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ? "✅ SET" : "❌ NOT SET"
  });

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

    console.error(`[generate-image] 🎨 Starting image generation with model: ${model}`);
    console.error(`[generate-image] 💬 Prompt: "${args.prompt.substring(0, 100)}${args.prompt.length > 100 ? '...' : ''}"`);

    // OpenRouter uses Chat Completions API for ALL image generation models
    console.error(`[generate-image] 🔄 Using Chat Completions API for ${model}`);

    const requestParams: any = {
      model: model,
      messages: [
        {
          role: "user",
          content: args.prompt,
        },
      ],
      modalities: ["image", "text"], // Required for image generation
    };

    // Add image_config for Gemini models (most OpenRouter image models use Gemini)
    if (model.toLowerCase().includes("gemini") && args.aspect_ratio) {
      requestParams.image_config = {
        aspect_ratio: args.aspect_ratio,
      };
      console.error(`[generate-image] 📐 Using aspect ratio: ${args.aspect_ratio}`);
    }

    // Generate the image with retry logic
    console.error("[generate-image] 🚀 Sending request to OpenRouter...");
    const result = await retryWithBackoff(
      async () => {
        const completion = await openai.chat.completions.create(requestParams);
        return completion;
      },
      3,
      3000,
      "OpenRouter Image Generation"
    );

    const message = result.choices?.[0]?.message;
    if (!message) {
      console.error("[generate-image] ❌ ERROR: No response message from model");
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

    console.error("[generate-image] ✅ Response received, checking for images...");
    console.error("[generate-image] 🔍 Message keys:", Object.keys(message));
    console.error("[generate-image] 📊 Message content type:", typeof message.content);

    // OpenRouter returns images in message.images array
    const images = (message as any).images || [];
    console.error("[generate-image] 🖼️  Images array length:", images.length);
    console.error("[generate-image] 🗂️  Images data:", JSON.stringify(images).substring(0, 500));

    // Also log the message content if available
    if (message.content) {
      console.error(`[generate-image] 💬 Message content: ${message.content.toString().substring(0, 100)}...`);
    }

    // Check if images were generated
    if (!images || images.length === 0) {
      console.error("[generate-image] ❌ ERROR: No images in response");
      return {
        content: [
          {
            type: "text",
            text: `The model responded but did not generate images.\n\nMessage: ${
              message.content || "No content"
            }\n\nPlease ensure:\n1. The model supports image generation (check output_modalities)\n2. Your prompt requests image generation\n3. The model ID is correct`,
          },
        ],
        isError: true,
      };
    }

    console.error(`[generate-image] ✅ Generated ${images.length} image(s)`);

    // Extract base64 image URLs from OpenRouter's response format
    console.error("[generate-image] 🔄 Starting base64 extraction...");
    const base64Images: string[] = images
      .map((img: any, index: number) => {
        console.error(`[generate-image] 📦 Processing image ${index + 1}:`, JSON.stringify(img).substring(0, 200));
        // OpenRouter format: { type: "image_url", image_url: { url: "..." } }
        if (img.image_url && img.image_url.url) {
          console.error(`[generate-image] ✅ Found image_url.url for image ${index + 1}`);
          return img.image_url.url;
        }
        // Fallback for other possible formats
        if (img.url) {
          console.error(`[generate-image] ✅ Found url for image ${index + 1}`);
          return img.url;
        }
        console.error(`[generate-image] ❌ No valid format found for image ${index + 1}`);
        return null;
      })
      .filter((url: string | null): url is string => url !== null);

    console.error(`[generate-image] ✅ Extracted ${base64Images.length} base64 image(s)`);

    if (base64Images.length === 0) {
      console.error("[generate-image] ❌ FATAL: No valid base64 images extracted!");
      return {
        content: [
          {
            type: "text",
            text: "Error: No valid image URLs found in the response. Image format may not be supported.",
          },
        ],
        isError: true,
      };
    }

    // ========================================================================
    // CLOUDINARY UPLOAD - ALWAYS ENABLED
    // ========================================================================
    console.error("[generate-image] ╔════════════════════════════════════════════════════════════════╗");
    console.error("[generate-image] ║            🌥️  CLOUDINARY UPLOAD (ALWAYS ENABLED)              ║");
    console.error("[generate-image] ╚════════════════════════════════════════════════════════════════╝");
    
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    console.error("[generate-image] 🔐 Cloudinary credentials:", {
      cloudName: cloudName || "❌ MISSING",
      apiKey: apiKey ? "✅ SET" : "❌ MISSING",
      apiSecret: apiSecret ? "✅ SET" : "❌ MISSING"
    });

    if (!cloudName) {
      console.error("[generate-image] ❌ FATAL: CLOUDINARY_CLOUD_NAME is required!");
      return {
        content: [
          {
            type: "text",
            text: "❌ Error: CLOUDINARY_CLOUD_NAME environment variable is required.\n\nPlease set it in your Railway environment variables.",
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
    console.error(`[generate-image] 📁 Upload folder: ${folderName}`);
    console.error(`[generate-image] 📦 Uploading ${base64Images.length} image(s)...`);

    try {
      console.error("[generate-image] 🚀 Calling uploadMultipleToCloudinary with retry...");
      const uploadResults = await retryCloudinaryUpload(
        async () =>
          await uploadMultipleToCloudinary(base64Images, cloudinaryConfig, {
            folder: folderName,
            tags: ["ai-generated", "openrouter", model.split("/")[0]],
            prompt: args.prompt,
          }),
        3,
        2000
      );

      console.error("[generate-image] ✅ SUCCESS: Cloudinary upload complete!");
      console.error("[generate-image] 📊 Upload results:", uploadResults.map(r => ({
        public_id: r.public_id,
        url: r.secure_url.substring(0, 80) + "...",
        format: r.format,
        size: `${r.width}x${r.height}`
      })));

      // Build response with ONLY Cloudinary URLs (no base64)
      const responseContent = [
        {
          type: "text",
          text: `✅ Successfully generated ${uploadResults.length} image(s) and uploaded to Cloudinary!\n\n📝 **Prompt:** "${args.prompt}"\n🤖 **Model:** ${model}${args.aspect_ratio ? `\n📐 **Aspect Ratio:** ${args.aspect_ratio}` : ""}\n`,
        },
      ];

      // Add Cloudinary URLs and image resources
      uploadResults.forEach((result, index) => {
        responseContent.push({
          type: "text",
          text: `\n🖼️ **Image ${index + 1}:**\n🔗 URL: ${result.secure_url}\n🆔 Public ID: ${result.public_id}\n📦 Format: ${result.format}\n📏 Size: ${result.width}x${result.height}\n💾 Bytes: ${result.bytes.toLocaleString()}`,
        });

        // Include the image as a resource (using Cloudinary URL, not base64)
        responseContent.push({
          type: "resource",
          resource: {
            uri: result.secure_url,
            mimeType: `image/${result.format}`,
            text: `Image ${index + 1}: ${args.prompt.substring(0, 50)}${args.prompt.length > 50 ? '...' : ''}`
          }
        } as any);
      });

      console.error("[generate-image] ╔════════════════════════════════════════════════════════════════╗");
      console.error("[generate-image] ║              ✅ SUCCESS - RETURNING CLOUDINARY URLS            ║");
      console.error("[generate-image] ╚════════════════════════════════════════════════════════════════╝");
      return { content: responseContent };

    } catch (cloudinaryError: any) {
      console.error("[generate-image] ╔════════════════════════════════════════════════════════════════╗");
      console.error("[generate-image] ║            ❌ CLOUDINARY UPLOAD FAILED                         ║");
      console.error("[generate-image] ╚════════════════════════════════════════════════════════════════╝");
      console.error("[generate-image] 🔥 Error:", cloudinaryError);
      console.error("[generate-image] 🔍 Error details:", {
        message: cloudinaryError.message,
        stack: cloudinaryError.stack?.split('\n').slice(0, 5),
        code: cloudinaryError.code,
        statusCode: cloudinaryError.statusCode
      });

      return {
        content: [
          {
            type: "text",
            text: `❌ Image generation succeeded, but Cloudinary upload FAILED.\n\n🔴 **Error:** ${cloudinaryError.message}\n\n📝 **Prompt:** "${args.prompt}"\n🤖 **Model:** ${model}\n\n⚠️ Please check your Cloudinary credentials in Railway environment variables:\n- CLOUDINARY_CLOUD_NAME\n- CLOUDINARY_API_KEY\n- CLOUDINARY_API_SECRET\n\n🔧 Debug: ${cloudinaryError.stack?.split('\n')[0] || 'No stack trace available'}`,
          },
        ],
        isError: true,
      };
    }

  } catch (error: any) {
    console.error("[generate-image] ╔════════════════════════════════════════════════════════════════╗");
    console.error("[generate-image] ║              ❌ FATAL ERROR                                    ║");
    console.error("[generate-image] ╚════════════════════════════════════════════════════════════════╝");
    console.error("[generate-image] 🔥 Error details:", {
      message: error.message,
      code: error.code,
      status: error.status,
      stack: error.stack?.split('\n').slice(0, 10),
    });

    // Build error message with helpful context
    let errorMessage = `Failed to generate image: ${
      error.message || "Unknown error"
    }`;

    // Add helpful context based on error type
    if (
      error.code === "ERR_STREAM_PREMATURE_CLOSE" ||
      error.message?.includes("Premature close")
    ) {
      errorMessage +=
        "\n\nThis error occurs when the connection to OpenRouter is interrupted. This has been retried 3 times but still failed. Try:\n- Simplifying your prompt\n- Waiting a moment and trying again";
    } else if (error.status === 429) {
      errorMessage +=
        "\n\nRate limit exceeded. Please wait a moment before trying again.";
    } else if (error.status === 400) {
      errorMessage +=
        "\n\nInvalid request. Please check your prompt and ensure the model supports image generation.";
    } else if (error.status === 401) {
      errorMessage +=
        "\n\nAuthentication failed. Please check your OpenRouter API key.";
    } else if (error.status && error.status >= 500) {
      errorMessage +=
        "\n\nOpenRouter server error. Please try again in a moment.";
    } else if (
      error.message?.includes("modalities") ||
      error.message?.includes("image generation")
    ) {
      errorMessage +=
        '\n\nThe selected model may not support image generation. Try using "google/gemini-2.5-flash-image" or another model with image generation capabilities.';
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
