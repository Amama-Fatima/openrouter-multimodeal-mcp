import axios from "axios";

export interface CloudinaryUploadResult {
  url: string;
  secure_url: string;
  public_id: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
}

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Upload a base64 image to Cloudinary
 */
export async function uploadToCloudinary(
  base64Image: string,
  config: CloudinaryConfig,
  options: {
    folder?: string;
    tags?: string[];
    public_id?: string;
    resource_type?: "image" | "video" | "raw" | "auto";
  } = {}
): Promise<CloudinaryUploadResult> {
  const {
    folder = "ai-generated",
    tags = ["ai-generated", "openrouter"],
    public_id,
    resource_type = "image",
  } = options;

  const uploadUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/${resource_type}/upload`;

  const formData = new URLSearchParams();
  formData.append("file", base64Image);
  formData.append("upload_preset", "ml_default"); // You can use an unsigned preset or sign the request
  formData.append("folder", folder);
  formData.append("tags", tags.join(","));

  if (public_id) {
    formData.append("public_id", public_id);
  }

  // If API key and secret are provided, add them for signed uploads
  if (config.apiKey && config.apiSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    formData.append("timestamp", timestamp);
    formData.append("api_key", config.apiKey);

    // For signed uploads, you'd need to generate a signature
    // This is a simplified version - in production, generate proper signature
    const crypto = await import("crypto");
    const paramsToSign = `folder=${folder}&tags=${tags.join(
      ","
    )}&timestamp=${timestamp}${config.apiSecret}`;
    const signature = crypto
      .createHash("sha1")
      .update(paramsToSign)
      .digest("hex");
    formData.append("signature", signature);
  }

  try {
    const response = await axios.post(uploadUrl, formData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data;
  } catch (error: any) {
    if (error.response) {
      throw new Error(
        `Cloudinary upload failed: ${
          error.response.data.error?.message || error.message
        }`
      );
    }
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  }
}

/**
 * Upload multiple base64 images to Cloudinary
 */
export async function uploadMultipleToCloudinary(
  base64Images: string[],
  config: CloudinaryConfig,
  options: {
    folder?: string;
    tags?: string[];
    prompt?: string;
  } = {}
): Promise<CloudinaryUploadResult[]> {
  const uploadPromises = base64Images.map((base64Image, index) =>
    uploadToCloudinary(base64Image, config, {
      ...options,
      public_id: options.prompt
        ? `${options.prompt.substring(0, 50).replace(/[^a-zA-Z0-9]/g, "_")}_${
            index + 1
          }`
        : undefined,
    })
  );

  return Promise.all(uploadPromises);
}

/**
 * Retry helper for Cloudinary uploads with exponential backoff
 */
export async function retryCloudinaryUpload<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
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
          `Cloudinary upload attempt ${
            attempt + 1
          } failed, retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Cloudinary upload failed after all retries");
}
