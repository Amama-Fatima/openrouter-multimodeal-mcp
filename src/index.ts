#!/usr/bin/env node
// OpenRouter Multimodal MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/register-tools.js";

const DEFAULT_MODEL = "qwen/qwen2.5-vl-32b-instruct:free";

const server = new McpServer({
  name: "openrouter-multimodal-mcp",
  version: "1.5.0",
});

(async () => {
  try {
    // Check for API key
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error(
        "Error: OPENROUTER_API_KEY environment variable is required"
      );
      process.exit(1);
    }

    const defaultModel = process.env.OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL;

    // Register all tools
    registerTools(server, apiKey, defaultModel);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("OpenRouter Multimodal MCP server running on stdio");
    console.error(`Using default model: ${defaultModel}`);
    console.error(
      "Server is ready to process tool calls. Waiting for input..."
    );
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
})();
