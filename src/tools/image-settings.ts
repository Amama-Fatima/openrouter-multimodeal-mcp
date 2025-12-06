import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { SETTINGS_DESCRIPTIONS } from "../utils/description.js";

// Settings schema matching your image generation options
interface ImageGenerationSettings {
  model?: string;
  aspect_ratio?:
    | "1:1"
    | "16:9"
    | "21:9"
    | "2:3"
    | "3:2"
    | "4:5"
    | "5:4"
    | "9:16"
    | "9:21";
  n?: number;
  output_format?: "png" | "jpeg" | "jpg" | "webp" | "avif";
  quality?: "low" | "medium" | "high";
  output_compression?: number;
  size?: "auto" | "1K" | "2K" | "4K";
  background?: "auto" | "transparent" | "white" | "black";
  upload_to_cloudinary?: boolean;
  cloudinary_folder?: string;
}

// Default settings
const DEFAULT_SETTINGS: ImageGenerationSettings = {
  model: "google/gemini-2.5-flash-image",
  aspect_ratio: "1:1",
  n: 1,
  output_format: "png",
  quality: "medium",
  output_compression: 6,
  size: "auto",
  background: "auto",
  upload_to_cloudinary: true,
  cloudinary_folder: "ai-generated",
};

// Settings file path
const SETTINGS_FILE = path.join(process.cwd(), "image-gen-settings.json");

/**
 * Load settings from file
 */
async function loadSettings(): Promise<ImageGenerationSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    const settings = JSON.parse(data);
    console.log("[SETTINGS] Loaded settings from file");
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log("[SETTINGS] No settings file found, using defaults");
      return { ...DEFAULT_SETTINGS };
    }
    console.error("[SETTINGS] Error loading settings:", error.message);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to file
 */
async function saveSettings(settings: ImageGenerationSettings): Promise<void> {
  try {
    await fs.writeFile(
      SETTINGS_FILE,
      JSON.stringify(settings, null, 2),
      "utf-8"
    );
    console.log("[SETTINGS] Saved settings to file");
  } catch (error: any) {
    console.error("[SETTINGS] Error saving settings:", error.message);
    throw new Error(`Failed to save settings: ${error.message}`);
  }
}

/**
 * Format settings for display
 */
function formatSettings(settings: ImageGenerationSettings): string {
  return `**Current Image Generation Settings:**

🤖 **Model**: ${settings.model || "Not set"}
📐 **Aspect Ratio**: ${settings.aspect_ratio || "Not set"}
🔢 **Number of Images**: ${settings.n || 1}
🖼️ **Output Format**: ${settings.output_format || "png"}
⭐ **Quality**: ${settings.quality || "medium"}
🗜️ **Compression**: ${settings.output_compression ?? 6} (PNG only)
📏 **Size**: ${settings.size || "auto"}
🎨 **Background**: ${settings.background || "auto"}
☁️ **Upload to Cloudinary**: ${settings.upload_to_cloudinary ? "Yes" : "No"}
📁 **Cloudinary Folder**: ${settings.cloudinary_folder || "ai-generated"}`;
}

/**
 * Register settings management tools
 */
export function registerSettingsTools(server: McpServer) {
  // Tool 1: Get current settings
  server.registerTool(
    "mcp_openrouter_get_settings",
    {
      title: "Get Image Generation Settings",
      description: `${SETTINGS_DESCRIPTIONS.get}`,
      inputSchema: z.object({}).shape,
    },
    async (args, extra) => {
      try {
        const settings = await loadSettings();

        return {
          content: [
            {
              type: "text",
              text: formatSettings(settings),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to get settings: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: Update settings
  server.registerTool(
    "mcp_openrouter_update_settings",
    {
      title: "Update Image Generation Settings",
      description: `${SETTINGS_DESCRIPTIONS.update}`,
      inputSchema: z.object({
        model: z
          .string()
          .optional()
          .describe(
            'Default OpenRouter model (e.g., "google/gemini-2.5-flash-image", "google/imagen-4.0-generate-001")'
          ),
        aspect_ratio: z
          .enum([
            "1:1",
            "16:9",
            "21:9",
            "2:3",
            "3:2",
            "4:5",
            "5:4",
            "9:16",
            "9:21",
          ])
          .optional()
          .describe("Default aspect ratio for generated images"),
        n: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe("Default number of images to generate (1-4)"),
        output_format: z
          .enum(["png", "jpeg", "jpg", "webp", "avif"])
          .optional()
          .describe("Default output format"),
        quality: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Default image quality"),
        output_compression: z
          .number()
          .int()
          .min(0)
          .max(9)
          .optional()
          .describe("Default PNG compression level (0-9)"),
        size: z
          .enum(["auto", "1K", "2K", "4K"])
          .optional()
          .describe("Default image size"),
        background: z
          .enum(["auto", "transparent", "white", "black"])
          .optional()
          .describe("Default background handling"),
        upload_to_cloudinary: z
          .boolean()
          .optional()
          .describe("Default: upload to Cloudinary or not"),
        cloudinary_folder: z
          .string()
          .optional()
          .describe("Default Cloudinary folder"),
      }).shape,
    },
    async (args, extra) => {
      try {
        // Load current settings
        const currentSettings = await loadSettings();

        // Count how many settings are being updated
        const updatedFields = Object.keys(args).filter(
          (key) => args[key as keyof typeof args] !== undefined
        );

        if (updatedFields.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "⚠️ No settings provided to update. Please specify at least one setting to change.",
              },
            ],
          };
        }

        // Merge with new settings
        const newSettings: ImageGenerationSettings = {
          ...currentSettings,
          ...args,
        };

        // Save settings
        await saveSettings(newSettings);

        const updatedList = updatedFields
          .map((field) => `  • ${field}: ${args[field as keyof typeof args]}`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `✅ **Settings Updated Successfully!**

**Updated ${updatedFields.length} setting(s):**
${updatedList}

${formatSettings(newSettings)}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to update settings: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: Reset settings to defaults
  server.registerTool(
    "mcp_openrouter_reset_settings",
    {
      title: "Reset Image Generation Settings",
      description: `${SETTINGS_DESCRIPTIONS.reset}`,
      inputSchema: z.object({
        confirm: z
          .boolean()
          .describe(
            "Set to true to confirm you want to reset all settings to defaults"
          ),
      }).shape,
    },
    async (args, extra) => {
      try {
        if (!args.confirm) {
          return {
            content: [
              {
                type: "text",
                text: "⚠️ Please confirm that you want to reset all settings to defaults by setting `confirm: true`",
              },
            ],
          };
        }

        // Save default settings
        await saveSettings(DEFAULT_SETTINGS);

        return {
          content: [
            {
              type: "text",
              text: `✅ **Settings Reset to Defaults!**

${formatSettings(DEFAULT_SETTINGS)}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to reset settings: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  console.log("[SETTINGS] Registered settings management tools");
}

/**
 * Export helper function to load settings for image generation tool
 */
export { loadSettings, ImageGenerationSettings };
