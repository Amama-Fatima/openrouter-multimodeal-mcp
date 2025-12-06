import { z } from "zod";

const generateImageSchema = z.object({
  prompt: z.string().describe("Text prompt describing the image to generate"),
  model: z
    .string()
    .optional()
    .describe(
      'OpenRouter model to use for generation (e.g., "google/gemini-2.5-flash-image"). If not provided, uses the default model from settings.'
    ),
  aspect_ratio: z
    .enum(["1:1", "16:9", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"])
    .optional()
    .describe(
      "Aspect ratio for the generated image. If not provided, uses default from settings."
    ),
  n: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe(
      "Number of images to generate (1-4). If not provided, uses default from settings."
    ),

  // Image Processing Options
  output_format: z
    .enum(["png", "jpeg", "jpg", "webp", "avif"])
    .optional()
    .describe(
      "Output image format. If not provided, uses default from settings."
    ),
  quality: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "Image quality: low (50), medium (70), high (90). If not provided, uses default from settings."
    ),
  output_compression: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe(
      "PNG compression level (0-9, only for PNG format). 0=fastest/largest, 9=slowest/smallest. If not provided, uses default from settings."
    ),
  size: z
    .enum(["auto", "1K", "2K", "4K"])
    .optional()
    .describe(
      "Resize image: auto (original), 1K (1024px), 2K (2048px), 4K (4096px). If not provided, uses default from settings."
    ),
  background: z
    .enum(["auto", "transparent", "white", "black"])
    .optional()
    .describe(
      "Background handling: auto (keep original), transparent, white, black. If not provided, uses default from settings."
    ),

  // Cloudinary Options
  upload_to_cloudinary: z
    .boolean()
    .optional()
    .describe(
      "Whether to upload the generated image to Cloudinary. If not provided, uses default from settings."
    ),
  cloudinary_folder: z
    .string()
    .optional()
    .describe(
      "Cloudinary folder to upload to. If not provided, uses default from settings."
    ),
});

export { generateImageSchema };
