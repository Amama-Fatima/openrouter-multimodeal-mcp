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

  // Validate prompt
  if (!args.prompt || args.prompt.trim().length === 0) {
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
    // Select model with priority:
    // 1. User-specified model
    // 2. Default model from environment
    // 3. Google Gemini Flash Image Preview (free model with image generation)
    const model = args.model || defaultModel || DEFAULT_IMAGE_MODEL;

    console.error(
      `[generate-image] Starting image generation with model: ${model}`
    );
    console.error(
      `[generate-image] Prompt: "${args.prompt.substring(0, 100)}${
        args.prompt.length > 100 ? "..." : ""
      }"`
    );

    // OpenRouter uses Chat Completions API for ALL image generation models
    console.error(`[generate-image] Using Chat Completions API for ${model}`);

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
      console.error(
        `[generate-image] Using aspect ratio: ${args.aspect_ratio}`
      );
    }

    // Generate the image with retry logic
    const result = await retryWithBackoff(
      async () => {
        const completion = await openai.chat.completions.create(requestParams);
        return completion;
      },
      3,
      3000,
      "OpenRouter Image Generation"
    );

    // Extract images from the response
    // According to OpenRouter docs, images are in message.images array
    const message = result.choices?.[0]?.message;
    if (!message) {
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

    console.error("[generate-image] Response received, checking for images...");

    // OpenRouter returns images in message.images array
    // Format: { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
    const images = (message as any).images || [];

    // Also log the message content if available
    if (message.content) {
      console.error(
        `[generate-image] Message content: ${message.content.substring(
          0,
          100
        )}...`
      );
    }

    // Check if images were generated
    if (!images || images.length === 0) {
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

    console.error(`[generate-image] Generated ${images.length} image(s)`);

    // Extract base64 image URLs from OpenRouter's response format
    const base64Images: string[] = images
      .map((img: any) => {
        // OpenRouter format: { type: "image_url", image_url: { url: "..." } }
        if (img.image_url && img.image_url.url) {
          return img.image_url.url;
        }
        // Fallback for other possible formats
        if (img.url) {
          return img.url;
        }
        return null;
      })
      .filter(Boolean);

    if (base64Images.length === 0) {
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

    console.error(
      `[generate-image] Successfully extracted ${base64Images.length} image URL(s)`
    );

    // Handle Cloudinary upload if requested
    if (args.upload_to_cloudinary) {
      // Load Cloudinary credentials from environment variables
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;

      if (!cloudName) {
        return {
          content: [
            {
              type: "text",
              text: "Error: CLOUDINARY_CLOUD_NAME environment variable is required for upload. Please set it in your environment or .env file.",
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

      console.error(
        `[generate-image] Uploading ${
          base64Images.length
        } image(s) to Cloudinary folder: ${
          args.cloudinary_folder || "ai-generated"
        }`
      );

      try {
        const uploadResults = await retryCloudinaryUpload(
          async () =>
            await uploadMultipleToCloudinary(base64Images, cloudinaryConfig, {
              folder: args.cloudinary_folder || "ai-generated",
              tags: ["ai-generated", "openrouter", model.split("/")[0]],
              prompt: args.prompt,
            }),
          3,
          2000
        );

        console.error("[generate-image] Successfully uploaded to Cloudinary");

        // Build response with both base64 and Cloudinary URLs
        const responseContent = [
          {
            type: "text",
            text: `Successfully generated ${
              uploadResults.length
            } image(s) and uploaded to Cloudinary.\n\nPrompt: "${
              args.prompt
            }"\nModel: ${model}\n${
              args.aspect_ratio ? `Aspect Ratio: ${args.aspect_ratio}\n` : ""
            }\n`,
          },
        ];

        // Add Cloudinary URLs
        uploadResults.forEach((result, index) => {
          responseContent.push({
            type: "text",
            text: `\n**Image ${index + 1}:**\n- Cloudinary URL: ${
              result.secure_url
            }\n- Public ID: ${result.public_id}\n- Format: ${
              result.format
            }\n- Size: ${result.width}x${result.height}\n- Bytes: ${
              result.bytes
            }`,
          });

          // Also include the image inline
          responseContent.push({
            type: "image",
            data: base64Images[index],
            mimeType: "image/png",
          } as any);
        });

        return { content: responseContent };
      } catch (cloudinaryError: any) {
        console.error(
          "[generate-image] Cloudinary upload failed:",
          cloudinaryError
        );

        // Return the images anyway, but note the upload failure
        const responseContent = [
          {
            type: "text",
            text: `Image(s) generated successfully, but Cloudinary upload failed: ${cloudinaryError.message}\n\nPrompt: "${args.prompt}"\nModel: ${model}\n\nImages are returned as base64 below:`,
          },
        ];

        base64Images.forEach((base64Image, index) => {
          responseContent.push({
            type: "image",
            data: base64Image,
            mimeType: "image/png",
          } as any);
        });

        return { content: responseContent };
      }
    }

    // Return images without Cloudinary upload
    const responseContent = [
      {
        type: "text",
        text: `Successfully generated ${
          base64Images.length
        } image(s).\n\nPrompt: "${args.prompt}"\nModel: ${model}\n${
          args.aspect_ratio ? `Aspect Ratio: ${args.aspect_ratio}\n` : ""
        }`,
      },
    ];

    // Add the images
    base64Images.forEach((base64Image, index) => {
      responseContent.push({
        type: "text",
        text: `\n**Image ${index + 1}:** (base64 data URL)`,
      });

      responseContent.push({
        type: "image",
        data: base64Image,
        mimeType: "image/png",
      } as any);
    });

    return { content: responseContent };
  } catch (error: any) {
    console.error("[generate-image] Failed after all retries:", {
      message: error.message,
      code: error.code,
      status: error.status,
      stack: error.stack,
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
        '\n\nThe selected model may not support image generation. Try using "google/gemini-2.5-flash-image-preview" or another model with image generation capabilities.';
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
