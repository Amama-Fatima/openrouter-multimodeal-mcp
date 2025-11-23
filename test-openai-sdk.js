import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { OpenAI } from 'openai';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const TEST_IMAGE_PATH = 'test.png'; // Adjust to your image path

/**
 * Convert an image file to base64
 */
async function imageToBase64(filePath) {
  try {
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
      default:
        console.log(`Using default MIME type for extension: ${fileExt}`);
    }
    
    // Convert to base64 and add the data URI prefix
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

/**
 * Send an image to OpenRouter using OpenAI SDK
 */
async function analyzeImageWithOpenRouter(base64Image, question = "What's in this image?") {
  try {
    console.log('Initializing OpenAI client with OpenRouter...');
    
    // Initialize the OpenAI client with OpenRouter base URL
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
        'X-Title': 'OpenRouter MCP Test'
      }
    });
    
    console.log('Sending image for analysis to Qwen free model...');
    // Create the message with text and image
    const completion = await openai.chat.completions.create({
      model: 'qwen/qwen2.5-vl-32b-instruct:free', // Using Qwen free model with vision capabilities
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: question
            },
            {
              type: 'image_url',
              image_url: {
                url: base64Image
              }
            }
          ]
        }
      ]
    });
    
    // Debug the completion response structure
    console.log('\n----- Debug: API Response -----');
    console.log(JSON.stringify(completion, null, 2));
    console.log('----- End Debug -----\n');
    
    // Check if completion has expected structure before accessing properties
    if (completion && completion.choices && completion.choices.length > 0 && completion.choices[0].message) {
      console.log('\n----- Analysis Results -----\n');
      console.log(completion.choices[0].message.content);
      console.log('\n----------------------------\n');
      
      // Print additional information about the model used and token usage
      console.log('Model used:', completion.model);
      if (completion.usage) {
        console.log('Token usage:');
        console.log('- Prompt tokens:', completion.usage.prompt_tokens);
        console.log('- Completion tokens:', completion.usage.completion_tokens);
        console.log('- Total tokens:', completion.usage.total_tokens);
      }
    } else {
      console.log('Unexpected response structure from OpenRouter API.');
    }
    
    return completion;
  } catch (error) {
    console.error('Error analyzing image with OpenRouter:');
    if (error.response) {
      console.error('API error status:', error.status);
      console.error('API error details:', JSON.stringify(error.response, null, 2));
    } else if (error.cause) {
      console.error('Error cause:', error.cause);
    } else {
      console.error(error);
    }
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not found in environment variables. Create a .env file with your API key.');
    }
    
    console.log(`Converting image at ${TEST_IMAGE_PATH} to base64...`);
    const base64Image = await imageToBase64(TEST_IMAGE_PATH);
    console.log('Image converted successfully!');
    
    // Log the first 100 chars of the base64 string to verify format
    console.log('Base64 string preview:', base64Image.substring(0, 100) + '...');
    
    // Analyze the image
    await analyzeImageWithOpenRouter(base64Image, "Please describe this image in detail. What do you see?");
    
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  }
}

// Run the script
main(); 