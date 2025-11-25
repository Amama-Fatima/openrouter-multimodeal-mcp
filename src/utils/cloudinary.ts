import { v2 as cloudinary } from "cloudinary";

export interface CloudinaryUploadResult {
  success: boolean;
  url?: string;
  secure_url?: string;
  public_id?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  error?: string;
}

let isCloudinaryInitialized = false;

export function initializeCloudinary() {
  if (isCloudinaryInitialized) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Missing Cloudinary credentials. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET"
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });

  isCloudinaryInitialized = true;
  console.log("Cloudinary initialized successfully");
}

export async function uploadToCloudinary(
  base64Data: string,
  mimeType: string,
  options: any = {}
): Promise<CloudinaryUploadResult> {
  try {
    initializeCloudinary();
    console.log("Uploading to Cloudinary...");

    if (options.context) {
      const MAX_CONTEXT_LENGTH = 950;
      const contextStr =
        typeof options.context === "string"
          ? options.context
          : JSON.stringify(options.context);

      if (contextStr.length > MAX_CONTEXT_LENGTH) {
        console.warn(
          `[Cloudinary] Context too long (${contextStr.length} chars), truncating to ${MAX_CONTEXT_LENGTH}`
        );
        options.context = contextStr.substring(0, MAX_CONTEXT_LENGTH) + "...";
      }
    }

    const uploadResult = await cloudinary.uploader.upload(
      `data:${mimeType};base64,${base64Data}`,
      {
        resource_type: "image",
        folder: "claude-generated",
        unique_filename: true,
        ...options,
      }
    );

    console.log(
      "Successfully uploaded to Cloudinary:",
      uploadResult.secure_url
    );

    return {
      success: true,
      url: uploadResult.url,
      secure_url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
    };
  } catch (error: any) {
    console.error("Cloudinary upload failed:", {
      message: error.message,
      name: error.name,
      http_code: error.http_code,
    });

    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}

// Helper function to upload multiple images
export async function uploadMultipleToCloudinary(
  images: Array<{ base64: string; mimeType: string }>,
  options: {
    folder?: string;
    tags?: string[];
    prompt?: string;
  } = {}
): Promise<CloudinaryUploadResult[]> {
  const uploadPromises = images.map((img, index) =>
    uploadToCloudinary(img.base64, img.mimeType, {
      folder: options.folder || "ai-generated",
      tags: options.tags || ["ai-generated", "openrouter"],
      context: options.prompt ? `prompt=${options.prompt}` : undefined,
    })
  );

  return Promise.all(uploadPromises);
}
