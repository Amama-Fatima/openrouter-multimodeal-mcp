#!/usr/bin/env node
/**
 * OpenRouter MCP Server Examples
 * 
 * This script demonstrates how to use the OpenRouter MCP Server for various tasks:
 * 1. Text chat with LLMs
 * 2. Single image analysis
 * 3. Multiple image analysis
 * 4. Model search and selection
 */
import { ClientSession, StdioServerParameters } from '@modelcontextprotocol/sdk/client/index.js';
import { stdio_client } from '@modelcontextprotocol/sdk/client/stdio.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execPromise = promisify(exec);

// Load environment variables
dotenv.config();
const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
  console.error('Error: OPENROUTER_API_KEY environment variable is missing');
  console.error('Please set it in a .env file or in your environment');
  process.exit(1);
}

// OpenAI client for direct API calls if needed
const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
    'X-Title': 'OpenRouter MCP Multimodal Examples',
  },
});

// Image file paths for examples
const testImage = path.join(__dirname, '..', 'test.png');

/**
 * Convert an image to base64
 */
async function imageToBase64(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error(`Error reading image ${imagePath}: ${error.message}`);
    throw error;
  }
}

/**
 * Example 1: Start the MCP server
 */
async function startMcpServer() {
  try {
    // Path to the project's main script
    const serverScriptPath = path.join(__dirname, '..', 'dist', 'index.js');

    // Start the MCP server as a child process
    console.log('Starting MCP server...');
    
    // Command to start the server with environment variables
    const command = `OPENROUTER_API_KEY=${API_KEY} node ${serverScriptPath}`;
    
    const { stdout, stderr } = await execPromise(command);
    
    if (stderr) {
      console.error('Server start error:', stderr);
    }
    
    console.log('MCP server output:', stdout);
    console.log('MCP server started successfully!');
    
    return serverScriptPath;
  } catch (error) {
    console.error('Failed to start MCP server:', error.message);
    throw error;
  }
}

/**
 * Example 2: Connect to the MCP server
 */
async function connectToMcpServer(serverPath) {
  try {
    // Configuration for the MCP server
    const serverConfig = {
      command: 'node',
      args: [serverPath],
      env: {
        OPENROUTER_API_KEY: API_KEY,
      }
    };

    // Connect to the server
    const session = await establishMcpSession(serverConfig);
    console.log('Connected to MCP server');
    
    return session;
  } catch (error) {
    console.error('Failed to connect to MCP server:', error.message);
    throw error;
  }
}

/**
 * Establish an MCP session
 */
async function establishMcpSession(serverConfig) {
  // Set up server parameters
  const serverParams = new StdioServerParameters(
    serverConfig.command,
    serverConfig.args,
    serverConfig.env
  );
  
  // Create client connection
  const client = await stdio_client(serverParams);
  const [stdio, write] = client;
  
  // Create and initialize session
  const session = new ClientSession(stdio, write);
  await session.initialize();
  
  // List available tools
  const response = await session.list_tools();
  console.log('Available tools:', response.tools.map(tool => tool.name).join(', '));
  
  return session;
}

/**
 * Example 3: Simple text chat using the MCP server
 */
async function textChatExample(session) {
  console.log('\n--- Text Chat Example ---');
  
  try {
    // Call the text chat tool
    const result = await session.call_tool('mcp_openrouter_chat_completion', {
      messages: [
        { role: 'user', content: 'What is the Model Context Protocol (MCP) and how is it useful?' }
      ],
      model: 'deepseek/deepseek-chat-v3-0324:free'
    });
    
    console.log('Response:', result.content[0].text);
  } catch (error) {
    console.error('Text chat error:', error.message);
  }
}

/**
 * Example 4: Image analysis using the MCP server
 */
async function imageAnalysisExample(session) {
  console.log('\n--- Image Analysis Example ---');
  
  try {
    // Convert image to base64
    const base64Image = await imageToBase64(testImage);
    
    // Call the image analysis tool
    const result = await session.call_tool('mcp_openrouter_analyze_image', {
      image_path: testImage, 
      question: 'What can you see in this image? Please describe it in detail.'
    });
    
    console.log('Response:', result.content[0].text);
  } catch (error) {
    console.error('Image analysis error:', error.message);
  }
}

/**
 * Example 5: Multiple image analysis using the MCP server
 */
async function multiImageAnalysisExample(session) {
  console.log('\n--- Multiple Image Analysis Example ---');
  
  try {
    // Call the multi-image analysis tool
    const result = await session.call_tool('mcp_openrouter_multi_image_analysis', {
      images: [
        { url: testImage }
      ],
      prompt: 'What can you see in this image? Please describe it in detail.',
      markdown_response: true
    });
    
    console.log('Response:', result.content[0].text);
  } catch (error) {
    console.error('Multi-image analysis error:', error.message);
  }
}

/**
 * Example 6: Search available models
 */
async function searchModelsExample(session) {
  console.log('\n--- Search Models Example ---');
  
  try {
    // Call the search models tool
    const result = await session.call_tool('search_models', {
      query: 'free',
      capabilities: {
        vision: true
      },
      limit: 5
    });
    
    console.log('Available free vision models:');
    result.content[0].models.forEach((model, index) => {
      console.log(`${index + 1}. ${model.id} - Context length: ${model.context_length}`);
    });
  } catch (error) {
    console.error('Search models error:', error.message);
  }
}

/**
 * Run all examples
 */
async function runExamples() {
  try {
    // Start the MCP server
    const serverPath = await startMcpServer();
    
    // Connect to the MCP server
    const session = await connectToMcpServer(serverPath);
    
    // Run the text chat example
    await textChatExample(session);
    
    // Run the image analysis example
    await imageAnalysisExample(session);
    
    // Run the multi-image analysis example
    await multiImageAnalysisExample(session);
    
    // Run the search models example
    await searchModelsExample(session);
    
    console.log('\nAll examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error.message);
  }
}

// Run the examples
runExamples().catch(console.error); 