#!/usr/bin/env python3
"""
OpenRouter MCP Server - Python Example

This script demonstrates how to use the OpenRouter MCP Server from Python,
for various tasks such as text chat and image analysis.
"""

import os
import sys
import json
import asyncio
import subprocess
from typing import Optional, Dict, Any, List
from contextlib import AsyncExitStack
from dotenv import load_dotenv

# Try to import MCP client libraries, show a helpful error if not available
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError:
    print("Error: MCP client libraries not found. Please install them with:")
    print("pip install python-mcp")
    sys.exit(1)

# Try to import OpenAI, show a helpful error if not available
try:
    from openai import OpenAI
except ImportError:
    print("Error: OpenAI client not found. Please install it with:")
    print("pip install openai")
    sys.exit(1)

# Load environment variables from .env file
load_dotenv()

# Get API key from environment, or show error
API_KEY = os.getenv("OPENROUTER_API_KEY")
if not API_KEY:
    print("Error: OPENROUTER_API_KEY environment variable is missing")
    print("Please create a .env file with OPENROUTER_API_KEY=your_key")
    sys.exit(1)

# Default model to use
MODEL = "anthropic/claude-3-5-sonnet"

# Configuration for the MCP server
SERVER_CONFIG = {
    "command": "npx",
    "args": ["-y", "@stabgan/openrouter-mcp-multimodal"],
    "env": {"OPENROUTER_API_KEY": API_KEY}
}

def convert_tool_format(tool):
    """Convert MCP tool definition to OpenAI tool format"""
    converted_tool = {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": {
                "type": "object",
                "properties": tool.inputSchema["properties"],
                "required": tool.inputSchema["required"]
            }
        }
    }
    return converted_tool

class MCPClient:
    """MCP Client for interacting with the OpenRouter MCP server"""
    
    def __init__(self):
        self.session: Optional[ClientSession] = None
        self.exit_stack = AsyncExitStack()
        self.openai = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=API_KEY
        )
        self.messages = []
    
    async def connect_to_server(self, server_config):
        """Connect to the MCP server"""
        server_params = StdioServerParameters(**server_config)
        stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_params))
        self.stdio, self.write = stdio_transport
        self.session = await self.exit_stack.enter_async_context(ClientSession(self.stdio, self.write))
        
        await self.session.initialize()
        
        # List available tools from the MCP server
        response = await self.session.list_tools()
        print("\nConnected to server with tools:", [tool.name for tool in response.tools])
        
        return response.tools
    
    async def process_query(self, query: str) -> str:
        """Process a text query using the MCP server"""
        self.messages.append({
            "role": "user",
            "content": query
        })
        
        # Get available tools from the MCP server
        response = await self.session.list_tools()
        available_tools = [convert_tool_format(tool) for tool in response.tools]
        
        # Make the initial OpenRouter API call with tool definitions
        response = self.openai.chat.completions.create(
            model=MODEL,
            tools=available_tools,
            messages=self.messages
        )
        self.messages.append(response.choices[0].message.model_dump())
        
        final_text = []
        content = response.choices[0].message
        
        # Process tool calls if any
        if content.tool_calls is not None:
            tool_name = content.tool_calls[0].function.name
            tool_args = content.tool_calls[0].function.arguments
            tool_args = json.loads(tool_args) if tool_args else {}
            
            # Execute tool call
            try:
                result = await self.session.call_tool(tool_name, tool_args)
                final_text.append(f"[Calling tool {tool_name} with args {tool_args}]")
            except Exception as e:
                print(f"Error calling tool {tool_name}: {e}")
                result = None
            
            # Add tool result to messages
            self.messages.append({
                "role": "tool",
                "tool_call_id": content.tool_calls[0].id,
                "name": tool_name,
                "content": result.content if result else "Error executing tool call"
            })
            
            # Make a follow-up API call with the tool results
            response = self.openai.chat.completions.create(
                model=MODEL,
                max_tokens=1000,
                messages=self.messages,
            )
            
            final_text.append(response.choices[0].message.content)
        else:
            final_text.append(content.content)
        
        return "\n".join(final_text)
    
    async def chat_loop(self):
        """Run an interactive chat loop"""
        print("\nMCP Client Started!")
        print("Type your queries or 'quit' to exit.")
        
        while True:
            try:
                query = input("\nQuery: ").strip()
                if query.lower() in ['quit', 'exit']:
                    break
                
                result = await self.process_query(query)
                print("Result:")
                print(result)
                
            except Exception as e:
                print(f"Error: {str(e)}")
    
    async def cleanup(self):
        """Clean up resources"""
        await self.exit_stack.aclose()

async def main():
    """Main entry point for the example script"""
    client = MCPClient()
    try:
        await client.connect_to_server(SERVER_CONFIG)
        await client.chat_loop()
    finally:
        await client.cleanup()

if __name__ == "__main__":
    asyncio.run(main()) 