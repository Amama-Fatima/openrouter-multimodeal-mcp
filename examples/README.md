# OpenRouter MCP Server Examples

This directory contains example scripts demonstrating how to use the OpenRouter MCP Server for various tasks such as text chat, image analysis, and model searching.

## Prerequisites

Before running these examples, ensure you have:

1. Node.js 18 or later installed
2. OpenRouter API key (get one from [OpenRouter](https://openrouter.ai))
3. Set up the environment variable:
   ```
   OPENROUTER_API_KEY=your_api_key_here
   ```
   You can create a `.env` file in the root directory with this variable.

## JavaScript Example

The `index.js` file demonstrates how to use the MCP server from Node.js:

1. Starting the MCP server
2. Connecting to the server
3. Simple text chat
4. Single image analysis
5. Multiple image analysis
6. Model search

### Running the JavaScript Example

```bash
# Install dependencies if you haven't already
npm install

# Run the example
npm run examples
```

## Python Example

The `python_example.py` script demonstrates how to use the MCP server from Python:

1. Connecting to the MCP server
2. Converting MCP tool definitions to OpenAI format
3. Interactive chat loop with tool calling

### Running the Python Example

```bash
# Install required Python packages
pip install python-mcp openai python-dotenv

# Run the example
python examples/python_example.py
```

## Using the MCP Server in Your Projects

To use the OpenRouter MCP Server in your own projects:

1. Install the package:
   ```bash
   npm install @stabgan/openrouter-mcp-multimodal
   ```

2. Create a client connection using the MCP client libraries:
   ```javascript
   import { ClientSession, StdioServerParameters } from '@modelcontextprotocol/sdk/client/index.js';
   import { stdio_client } from '@modelcontextprotocol/sdk/client/stdio.js';

   // Configure server
   const serverConfig = {
     command: 'npx',
     args: ['-y', '@stabgan/openrouter-mcp-multimodal'],
     env: { OPENROUTER_API_KEY: 'your_api_key_here' }
   };

   // Create connection
   const serverParams = new StdioServerParameters(
     serverConfig.command,
     serverConfig.args,
     serverConfig.env
   );
   const client = await stdio_client(serverParams);
   const [stdio, write] = client;
   
   // Initialize session
   const session = new ClientSession(stdio, write);
   await session.initialize();
   ```

3. Call tools:
   ```javascript
   // Get available tools
   const response = await session.list_tools();
   console.log('Available tools:', response.tools.map(tool => tool.name).join(', '));
   
   // Call a tool
   const result = await session.call_tool('mcp_openrouter_chat_completion', {
     messages: [
       { role: 'user', content: 'Hello, what can you do?' }
     ],
     model: 'deepseek/deepseek-chat-v3-0324:free'
   });
   
   console.log('Response:', result.content[0].text);
   ```

## Available Tools

The OpenRouter MCP Server provides the following tools:

1. `mcp_openrouter_chat_completion` - Text chat with LLMs
2. `mcp_openrouter_analyze_image` - Analyze a single image
3. `mcp_openrouter_multi_image_analysis` - Analyze multiple images 
4. `search_models` - Search for available models
5. `get_model_info` - Get details about a specific model
6. `validate_model` - Check if a model ID is valid

For detailed information about each tool's parameters, see the [main README](../README.md) file. 