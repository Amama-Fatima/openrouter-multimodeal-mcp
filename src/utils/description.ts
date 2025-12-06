/**
 * Comprehensive descriptions for settings management tools
 */

export const SETTINGS_DESCRIPTIONS = {
  get: `Retrieve current default settings for image generation. These defaults are used when parameters aren't explicitly provided in generation requests.

Returns all 10 configurable settings including model, format, quality, size, and Cloudinary options.`,

  update: `Update default settings for image generation. Only specify settings you want to change - others remain unchanged.

**Available Settings:**

• **model** (string) - OpenRouter model to use
  Examples: "google/gemini-2.5-flash-image", "google/imagen-4.0-generate-001"
  
• **aspect_ratio** (enum) - Image dimensions
  Values: "1:1", "16:9", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"
  
• **n** (number) - Number of images per request
  Range: 1-4
  
• **output_format** (enum) - Image file format
  Values: "png", "jpeg", "jpg", "webp", "avif"
  
• **quality** (enum) - Image quality level
  Values: "low" (50), "medium" (70), "high" (90)
  
• **output_compression** (number) - PNG compression only
  Range: 0-9 (0=fastest/largest, 9=slowest/smallest)
  
• **size** (enum) - Output resolution
  Values: "auto" (original), "1K" (1024px), "2K" (2048px), "4K" (4096px)
  
• **background** (enum) - Background handling
  Values: "auto" (keep original), "transparent", "white", "black"
  
• **upload_to_cloudinary** (boolean) - Enable/disable Cloudinary upload
  Values: true, false
  
• **cloudinary_folder** (string) - Cloudinary destination folder
  Example: "ai-generated", "my-images"

**Usage Examples:**
- Change format only: {output_format: "webp"}
- Multiple settings: {quality: "high", size: "2K", n: 2}
- Switch model: {model: "google/imagen-4.0-generate-001"}`,

  reset: `Reset all image generation settings to factory defaults.

**Default Values:**
• Model: google/gemini-2.5-flash-image
• Aspect Ratio: 1:1
• Number: 1
• Format: png
• Quality: medium
• Compression: 6
• Size: auto
• Background: auto
• Upload: true
• Folder: ai-generated

Requires confirmation parameter set to true to prevent accidental resets.`,
};

/**
 * Image generation tool description
 */
export const IMAGE_GEN_DESCRIPTION = `Generate AI images from text prompts using OpenRouter models (Gemini, Imagen, etc.) with advanced post-processing via Sharp.

**Only 'prompt' is required** - all other parameters are optional and use saved defaults if not provided.

**Key Features:**
• Multi-model support (Gemini for speed, Imagen for quality/batch)
• Generate 1-4 images per request
• Post-processing: format conversion, quality control, compression, resizing
• Background handling: transparent, white, black, or original
• Automatic Cloudinary upload with folder organization

**Parameter Override:**
Any parameter you provide overrides the corresponding default setting. For example, if defaults are webp/high quality but you specify output_format="png", only format changes - quality stays high.

**Model Notes:**
• Gemini models: Support aspect_ratio, make sequential calls for n>1
• Imagen models: Support native multi-image (1-4) in single call

**Common Usage:**
- Quick generation: {prompt: "sunset over mountains"}
- Override format: {prompt: "cat", output_format: "webp"}
- Multiple images: {prompt: "dog", n: 3}
- Full control: {prompt: "bird", output_format: "png", quality: "high", size: "2K"}

Check current defaults with mcp_openrouter_get_settings before generating.`;

/**
 * Model information for reference
 */
export const MODEL_INFO = {
  gemini: {
    name: "google/gemini-2.5-flash-image",
    features: [
      "Fast generation",
      "Aspect ratio support",
      "Sequential multi-image",
    ],
    note: "Requires multiple API calls for n>1",
  },
  imagen: {
    name: "google/imagen-4.0-generate-001",
    features: [
      "High quality",
      "Native multi-image (1-4)",
      "Single API call for n>1",
    ],
    note: "Best for batch generation",
  },
};
