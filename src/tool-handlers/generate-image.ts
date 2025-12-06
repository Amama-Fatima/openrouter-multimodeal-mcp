import OpenAI from "openai";
import { uploadToCloudinary } from "../utils/cloudinary.js";

export interface GenerateImageToolRequest {
  prompt: string;
  model?: string;
  aspect_ratio?:
    | "1:1"
    | "16:9"
    | "21:9"
    | "2:3"
    | "3:2"
    | "3:4"
    | "4:3"
    | "4:5"
    | "5:4"
    | "9:16"
    | "9:21";
  cloudinary_folder?: string;
}

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
 * Format success message for image upload
 */
function formatSuccessMessage(uploadResult: any): string {
  return `✅ **Image Generated & Uploaded Successfully!**

🔗 **Cloudinary URL**: ${uploadResult.url}
📦 **Format**: ${uploadResult.format}
📏 **Dimensions**: ${uploadResult.width}x${uploadResult.height}
💾 **Size**: ${(uploadResult.bytes / 1024).toFixed(2)} KB
🆔 **Public ID**: ${uploadResult.public_id}`;
}

/**
 * Handle image generation using OpenRouter
 * MATCHES THE WORKING OPENAI MCP PATTERN
 */
export async function handleGenerateImage(
  request: { params: { arguments: GenerateImageToolRequest } },
  openai: OpenAI,
  defaultModel?: string
) {
  const args = request.params.arguments;

  console.log("[generate-image] Starting image generation");
  console.log("[generate-image] Prompt length:", args.prompt?.length || 0);

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
    const model = args.model || defaultModel || "google/gemini-2.5-flash-image";
    const folder = args.cloudinary_folder || "ai-generated";

    console.log("[generate-image] Parameters:", {
      model,
      aspect_ratio: args.aspect_ratio,
      folder,
    });

    // Build OpenRouter request parameters
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
      console.log(`[generate-image] Using aspect ratio: ${args.aspect_ratio}`);
    }

    // Generate the image
    console.log("[generate-image] Calling OpenRouter...");
    const result = await openai.chat.completions.create(requestParams);

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

    console.log(
      "[generate-image] OpenAI generation successful, processing results"
    );

    // Extract images from OpenRouter response
    const images = (message as any).images || [];
    console.log(`[generate-image] Found ${images.length} image(s)`);

    if (!images || images.length === 0) {
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

    // Process images - convert to base64 and mimeType format
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
            text: "Error: No valid image URLs found in the response.",
          },
        ],
        isError: true,
      };
    }

    console.log(
      `[generate-image] Uploading ${processedImages.length} image(s) to Cloudinary folder: ${folder}`
    );

    // Upload to Cloudinary and build responses - EXACTLY like OpenAI MCP
    const responses = [];

    for (let i = 0; i < processedImages.length; i++) {
      const img = processedImages[i];

      const uploadResult = await uploadToCloudinary(img.b64, img.mimeType, {
        folder,
        context: `prompt=${args.prompt}`,
        tags: ["ai-generated", "openrouter", model.split("/")[0]],
      });

      if (uploadResult.success) {
        const successMessage = formatSuccessMessage(uploadResult);

        responses.push({
          type: "text",
          text: successMessage,
        });

        // Add the image using Cloudinary URL - NOT base64
        responses.push({
          type: "image",
          data: uploadResult.url,
          mimeType: `image/${uploadResult.format}`,
        });
      } else {
        // Fallback to base64 if upload fails
        responses.push({
          type: "text",
          text: `⚠️ Cloudinary upload failed: ${uploadResult.error}\n\nShowing image using base64 data instead:`,
        });
        responses.push({
          type: "image",
          data: `data:${img.mimeType};base64,${img.b64}`,
          mimeType: img.mimeType,
        });
      }
    }

    console.log(`[generate-image] Successfully uploaded to Cloudinary`);

    // Return exactly like OpenAI MCP
    return { content: responses };
  } catch (error: any) {
    console.error("[generate-image] Failed:", {
      message: error.message,
      code: error.code,
      status: error.status,
      stack: error.stack,
    });

    // Return MCP-compliant error response
    let errorMessage = `Failed to generate image: ${
      error.message || "Unknown error"
    }`;

    // Add helpful context based on error type
    if (
      error.code === "ERR_STREAM_PREMATURE_CLOSE" ||
      error.message?.includes("Premature close")
    ) {
      errorMessage +=
        "\n\nThis error occurs when the connection to OpenRouter is interrupted. Try:\n- Simplifying your prompt\n- Waiting a moment and trying again";
    } else if (error.status === 429) {
      errorMessage +=
        "\n\nRate limit exceeded. Please wait a moment before trying again.";
    } else if (error.status === 400) {
      errorMessage +=
        "\n\nInvalid request. Please check your prompt and parameters.";
    } else if (error.status === 401) {
      errorMessage +=
        "\n\nAuthentication failed. Please check your OpenRouter API key.";
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
