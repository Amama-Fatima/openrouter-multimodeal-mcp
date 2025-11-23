import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import { handleAnalyzeImage } from "../tool-handlers/analyze-image.js";
import { handleMultiImageAnalysis } from "../tool-handlers/multi-image-analysis.js";

const analyzeImageSchema = z.object({
  image_path: z
    .string()
    .describe(
      'Path to the image file to analyze (can be an absolute file path, URL, or base64 data URL starting with "data:")'
    ),
  question: z.string().optional().describe("Question to ask about the image"),
  model: z
    .string()
    .optional()
    .describe('OpenRouter model to use (e.g., "anthropic/claude-3.5-sonnet")'),
});

const multiImageAnalysisSchema = z.object({
  images: z
    .array(
      z.object({
        url: z.string().describe("URL or data URL of the image"),
        alt: z
          .string()
          .optional()
          .describe("Optional alt text or description of the image"),
      })
    )
    .describe("Array of image objects to analyze"),
  prompt: z.string().describe("Prompt for analyzing the images"),
  markdown_response: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to format the response in Markdown"),
  model: z.string().optional().describe("OpenRouter model to use"),
});

export function registerImageAnalysisTools(
  server: McpServer,
  apiKey: string,
  defaultModel: string
) {
  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/stabgan/openrouter-mcp-multimodal",
      "X-Title": "OpenRouter MCP Multimodal Server",
    },
  });

  server.tool(
    "mcp_openrouter_analyze_image",
    "Analyze an image using OpenRouter vision models",
    analyzeImageSchema.shape,
    async (args) => {
      try {
        const result = await handleAnalyzeImage(
          { params: { arguments: args as any } },
          openai,
          defaultModel
        );
        return {
          ...result,
          content: result.content.map((c) => ({ ...c, type: "text" as const })),
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to analyze image: ${
                error.message || String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "mcp_openrouter_multi_image_analysis",
    "Analyze multiple images at once with a single prompt and receive detailed responses",
    multiImageAnalysisSchema.shape,
    async (args) => {
      try {
        const result = await handleMultiImageAnalysis(
          { params: { arguments: args as any } },
          openai,
          defaultModel
        );
        return {
          ...result,
          content: result.content.map((c) => ({ ...c, type: "text" as const })),
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to analyze images: ${
                error.message || String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
