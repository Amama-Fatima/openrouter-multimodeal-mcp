/**
 * OpenRouter Image Analysis using OpenAI SDK
 * 
 * This script demonstrates how to analyze local images using OpenRouter's API
 * through the OpenAI SDK. It supports both command-line usage and can be imported
 * as a module for use in other applications.
 * 
 * Usage: 
 *   - Direct: node openrouter-image-sdk.js <image_path> [prompt]
 *   - As module: import { analyzeImage } from './openrouter-image-sdk.js'
 * 
 * Environment variables:
 *   - OPENROUTER_API_KEY: Your OpenRouter API key (required)
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { OpenAI } from 'openai';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const DEFAULT_MODEL = 'qwen/qwen2.5-vl-32b-instruct:free';
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000; // milliseconds

/**
 * Convert a local image file to base64 format
 * 
 * @param {string} filePath - Path to the image file
 * @returns {Promise<string>} - Base64 encoded image with data URI prefix
 */
export async function imageToBase64(filePath) {
  try {
    // Ensure the file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`Image file not found: ${filePath}`);
    }

    // Read the file
    const imageBuffer = await fs.readFile(filePath);
    
    // Determine MIME type based on file extension
    const fileExt = path.extname(filePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    
    switch (fileExt) {
      case '.png':
        mimeType = 'image/png';
        break;
      case '.jpg':
      case '.jpeg':
        mimeType = 'image/jpeg';
        break;
      case '.webp':
        mimeType = 'image/webp';
        break;
      case '.gif':
        mimeType = 'image/gif';
        break;
      default:
        console.warn(`Unknown file extension: ${fileExt}, using default MIME type`);
    }
    
    // Convert to base64 and add the data URI prefix
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw new Error(`Failed to convert image to base64: ${error.message}`);
  }
}

/**
 * Sleep for a specified amount of time
 * 
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Analyze an image using OpenRouter's API via OpenAI SDK
 * 
 * @param {Object} options - Options for image analysis
 * @param {string} options.imagePath - Path to the local image file
 * @param {string} [options.imageBase64] - Base64 encoded image (alternative to imagePath)
 * @param {string} [options.prompt="Please describe this image in detail."] - The prompt to send with the image
 * @param {string} [options.model=DEFAULT_MODEL] - The model to use for analysis
 * @param {string} [options.apiKey] - OpenRouter API key (defaults to OPENROUTER_API_KEY env var)
 * @returns {Promise<Object>} - The analysis results
 */
export async function analyzeImage({
  imagePath,
  imageBase64,
  prompt = "Please describe this image in detail.",
  model = DEFAULT_MODEL,
  apiKey
}) {
  // Check for API key
  const openrouterApiKey = apiKey || process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    throw new Error('OpenRouter API key is required. Set OPENROUTER_API_KEY in your environment or pass it as an option.');
  }

  // Check that we have either imagePath or imageBase64
  if (!imagePath && !imageBase64) {
    throw new Error('Either imagePath or imageBase64 must be provided.');
  }

  // Get base64 data if not provided
  let base64Data = imageBase64;
  if (!base64Data && imagePath) {
    console.log(`Converting image at ${imagePath} to base64...`);
    base64Data = await imageToBase64(imagePath);
    console.log('Image converted successfully!');
  }

  // Initialize the OpenAI client with OpenRouter base URL
  const openai = new OpenAI({
    apiKey: openrouterApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
      'X-Title': 'OpenRouter Local Image Analysis'
    }
  });

  // Implement retry logic
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry attempt ${attempt}/${MAX_RETRIES}...`);
        await sleep(RETRY_DELAY * attempt); // Exponential backoff
      }
      
      console.log(`Sending image analysis request to model: ${model}`);
      
      // Create the message with text and image
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: base64Data
                }
              }
            ]
          }
        ]
      });
      
      // Extract the relevant information from the response
      if (completion && completion.choices && completion.choices.length > 0) {
        const result = {
          analysis: completion.choices[0].message.content,
          model: completion.model,
          usage: completion.usage,
          requestId: completion.id,
          finishReason: completion.choices[0].finish_reason
        };
        
        return result;
      } else {
        throw new Error('Unexpected response structure from OpenRouter API.');
      }
    } catch (error) {
      lastError = error;
      
      // If this is a 402 Payment Required error, we won't retry
      if (error.status === 402 || (error.response && error.response.status === 402)) {
        console.error('Payment required error. Not retrying.');
        break;
      }
      
      if (attempt === MAX_RETRIES) {
        console.error('Maximum retry attempts reached.');
      }
    }
  }
  
  // If we've exhausted all retries, throw the last error
  throw lastError || new Error('Failed to analyze image after multiple attempts.');
}

/**
 * Command line interface for image analysis
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.log('Usage: node openrouter-image-sdk.js <image_path> [prompt]');
      console.log('Example: node openrouter-image-sdk.js test.png "What objects do you see in this image?"');
      process.exit(0);
    }
    
    const imagePath = args[0];
    const prompt = args[1] || "Please describe this image in detail. What do you see?";
    
    console.log(`Analyzing image: ${imagePath}`);
    console.log(`Prompt: ${prompt}`);
    
    const result = await analyzeImage({ imagePath, prompt });
    
    console.log('\n----- Analysis Results -----\n');
    console.log(result.analysis);
    console.log('\n----------------------------\n');
    
    console.log('Model used:', result.model);
    if (result.usage) {
      console.log('Token usage:');
      console.log('- Prompt tokens:', result.usage.prompt_tokens);
      console.log('- Completion tokens:', result.usage.completion_tokens);
      console.log('- Total tokens:', result.usage.total_tokens);
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('API error details:', JSON.stringify(error.response, null, 2));
    }
    process.exit(1);
  }
}

// Run the main function directly
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 