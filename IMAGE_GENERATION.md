# Image Generation with OpenRouter MCP

This guide explains how to use the image generation feature with the OpenRouter MCP server.

## Overview

The `mcp_openrouter_generate_image` tool allows you to generate images using OpenRouter's image generation models (primarily Google Gemini models) and optionally upload them to Cloudinary for permanent storage.

## Supported Models

Image generation is available through models that support the `image` output modality. The default model is:

- **`google/gemini-2.5-flash-image-preview`** (Free, supports custom aspect ratios)

You can find more image-capable models on the [OpenRouter Models page](https://openrouter.ai/models) by filtering for "image" in output modalities.

## Basic Usage

### Simple Image Generation

```json
{
  "tool": "mcp_openrouter_generate_image",
  "arguments": {
    "prompt": "A beautiful sunset over mountains with vibrant colors"
  }
}
```

### With Custom Aspect Ratio (Gemini models)

```json
{
  "tool": "mcp_openrouter_generate_image",
  "arguments": {
    "prompt": "A futuristic cityscape at night",
    "aspect_ratio": "16:9",
    "model": "google/gemini-2.5-flash-image-preview"
  }
}
```

### With Cloudinary Upload

```json
{
  "tool": "mcp_openrouter_generate_image",
  "arguments": {
    "prompt": "An artistic portrait of a robot reading a book",
    "upload_to_cloudinary": true,
    "cloudinary_folder": "ai-generated-art"
  }
}
```

**Note:** Cloudinary credentials are loaded from environment variables (see Configuration section below).

## Parameters

### Required Parameters

- **`prompt`** (string): The text description of the image to generate. Be detailed and specific for best results.

### Optional Parameters

- **`model`** (string): The model to use for generation. Default: `google/gemini-2.5-flash-image-preview`

- **`aspect_ratio`** (string): Image aspect ratio (Gemini models only). Options:

  - `1:1` - 1024×1024 (default)
  - `2:3` - 832×1248
  - `3:2` - 1248×832
  - `3:4` - 864×1184
  - `4:3` - 1184×864
  - `4:5` - 896×1152
  - `5:4` - 1152×896
  - `9:16` - 768×1344 (portrait)
  - `16:9` - 1344×768 (landscape)
  - `21:9` - 1536×672 (ultrawide)

- **`n`** (number): Number of images to generate (1-4). Default: 1. Note: some models may not support multiple images.

- **`upload_to_cloudinary`** (boolean): Whether to upload to Cloudinary. Default: false. Requires `CLOUDINARY_CLOUD_NAME` environment variable.

- **`cloudinary_folder`** (string): Cloudinary folder name. Default: `ai-generated`

## Configuration

### Environment Variables

Set these environment variables in your `.env` file or system environment:

```bash
# Required for OpenRouter
OPENROUTER_API_KEY=your_openrouter_api_key

# Optional: Default model for image generation
OPENROUTER_DEFAULT_MODEL=google/gemini-2.5-flash-image-preview

# Required for Cloudinary uploads (if using upload_to_cloudinary)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key        # Optional, for signed uploads
CLOUDINARY_API_SECRET=your_api_secret  # Optional, for signed uploads
```

### Cloudinary Setup

1. Sign up for a free account at [Cloudinary](https://cloudinary.com/)
2. Get your credentials from the Dashboard
3. Add them to your `.env` file as shown above
4. Use `upload_to_cloudinary: true` in your requests

## Response Format

### Without Cloudinary Upload

The tool returns the generated images as base64 data URLs:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Successfully generated 1 image(s).\n\nPrompt: \"A beautiful sunset...\"\nModel: google/gemini-2.5-flash-image-preview\nAspect Ratio: 16:9"
    },
    {
      "type": "image",
      "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
      "mimeType": "image/png"
    }
  ]
}
```

### With Cloudinary Upload

The tool returns both Cloudinary URLs and the base64 images:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Successfully generated 1 image(s) and uploaded to Cloudinary..."
    },
    {
      "type": "text",
      "text": "**Image 1:**\n- Cloudinary URL: https://res.cloudinary.com/...\n- Public ID: ai-generated/...\n- Format: png\n- Size: 1344x768\n- Bytes: 245678"
    },
    {
      "type": "image",
      "data": "data:image/png;base64,...",
      "mimeType": "image/png"
    }
  ]
}
```

## Cloudinary Setup

### Getting Cloudinary Credentials

1. Sign up for a free account at [Cloudinary](https://cloudinary.com/)
2. Get your credentials from the Dashboard:
   - Cloud Name
   - API Key
   - API Secret

### Cloudinary Features

- **Automatic Tagging**: Images are tagged with `ai-generated`, `openrouter`, and the model provider
- **Organized Folders**: Images are stored in customizable folders
- **Permanent URLs**: Get secure HTTPS URLs for long-term storage
- **Metadata**: Includes prompt info in the public_id for easy identification

## Best Practices

### Writing Effective Prompts

✅ **Good prompts:**

- "A photorealistic portrait of a golden retriever puppy in a sunny garden, professional photography style, shallow depth of field"
- "Minimalist logo design featuring a mountain peak and rising sun, using only blue and orange colors, flat design style"
- "Cyberpunk cityscape at night with neon signs, flying vehicles, and rain-slicked streets, cinematic composition"

❌ **Avoid vague prompts:**

- "A dog"
- "Something cool"
- "Make art"

### Performance Tips

1. **Retry Logic**: The tool automatically retries up to 3 times with exponential backoff
2. **Error Handling**: Comprehensive error messages help diagnose issues
3. **Cloudinary Fallback**: If upload fails, you still get the generated images
4. **Model Selection**: Use models specifically designed for image generation

### Rate Limits

- Image generation may have different rate limits than text generation
- Free models typically have lower rate limits
- Consider using paid models for production use

## Error Handling

Common errors and solutions:

### "Model does not support image generation"

- Use a model with image generation capabilities (check output_modalities)
- Default to `google/gemini-2.5-flash-image-preview`

### "CLOUDINARY_CLOUD_NAME environment variable is required"

- Set `CLOUDINARY_CLOUD_NAME` in your `.env` file or environment
- Verify the environment variable is loaded (check with `echo $CLOUDINARY_CLOUD_NAME`)
- Restart the MCP server after updating environment variables

### "Cloudinary upload failed"

- Check your environment variables are set correctly
- Verify your Cloudinary account is active
- For signed uploads, ensure both API key and secret are provided

### "Rate limit exceeded"

- Wait before retrying
- Consider upgrading your OpenRouter plan
- Use rate limiting in your application

### "Connection interrupted"

- The tool automatically retries
- Try simplifying your prompt
- Check your internet connection

## Examples

### Generate a Logo

```json
{
  "tool": "mcp_openrouter_generate_image",
  "arguments": {
    "prompt": "Professional minimalist logo for a tech startup, featuring geometric shapes, modern sans-serif font, navy blue and electric blue color scheme, white background",
    "aspect_ratio": "1:1",
    "upload_to_cloudinary": true,
    "cloudinary_folder": "logos"
  }
}
```

### Generate Social Media Banner

```json
{
  "tool": "mcp_openrouter_generate_image",
  "arguments": {
    "prompt": "Eye-catching social media banner with abstract gradient background, bold typography saying 'Innovation Summit 2025', modern and professional aesthetic",
    "aspect_ratio": "21:9",
    "model": "google/gemini-2.5-flash-image-preview"
  }
}
```

### Generate Multiple Variations

```json
{
  "tool": "mcp_openrouter_generate_image",
  "arguments": {
    "prompt": "Cute cartoon mascot character for a coffee shop, friendly expression, warm colors",
    "n": 3,
    "aspect_ratio": "1:1",
    "upload_to_cloudinary": true,
    "cloudinary_folder": "mascot-variations"
  }
}
```

## Limitations

1. **Model Availability**: Not all OpenRouter models support image generation
2. **Aspect Ratios**: Custom aspect ratios are primarily supported by Gemini models
3. **Output Format**: Images are returned as base64-encoded PNG data URLs
4. **File Size**: Large images may take longer to generate and upload
5. **Rate Limits**: Image generation typically has stricter rate limits than text

## Support

For issues or questions:

- Check the [OpenRouter Documentation](https://openrouter.ai/docs)
- Visit [GitHub Issues](https://github.com/stabgan/openrouter-mcp-multimodal/issues)
- Review [Cloudinary Documentation](https://cloudinary.com/documentation)
