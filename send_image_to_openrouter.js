// Send an image to OpenRouter using JavaScript
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import { OpenAI } from 'openai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

console.log("Starting script...");

// Constants
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'your_openrouter_api_key'; // Get from env or replace
const IMAGE_PATH = process.argv[2] || 'test.png'; // Get from command line or use default
const DEFAULT_MODEL = 'qwen/qwen2.5-vl-32b-instruct:free';

console.log(`Arguments: ${process.argv.join(', ')}`);
console.log(`Using image path: ${IMAGE_PATH}`);

// Load environment variables from .env file
async function loadEnv() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const envPath = path.join(__dirname, '.env');
    const envFile = await fs.readFile(envPath, 'utf-8');
    
    envFile.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        
        // Remove quotes if they exist
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/^"|"$/g, '');
        }
        
        process.env[key] = value;
      }
    });
    
    console.log('Environment variables loaded from .env file');
  } catch (error) {
    console.error('Error loading .env file:', error.message);
  }
}

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
      // Add other supported types as needed
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
 * Example 1: Send a base64 image using the MCP server analyze_image tool
 */
async function testMcpAnalyzeImage(base64Image, question = "What's in this image?") {
  try {
    console.log('Testing MCP analyze_image tool with base64 image...');
    
    // This would normally be handled by the MCP server client
    // This is a simulation of how to structure the data for the MCP server
    console.log(`
To analyze the image using MCP, send this request to the MCP server:

{
  "tool": "mcp_openrouter_analyze_image",
  "arguments": {
    "image_path": "${base64Image.substring(0, 50)}...", // Truncated for display
    "question": "${question}",
    "model": "${DEFAULT_MODEL}"
  }
}

The MCP server will convert the image path (which is already a base64 data URL) 
and send it to OpenRouter in the correct format.
`);
  } catch (error) {
    console.error('Error testing MCP analyze_image:', error);
  }
}

/**
 * Example 2: Send multiple base64 images using the MCP server multi_image_analysis tool
 */
async function testMcpMultiImageAnalysis(base64Images, prompt = "Describe these images in detail.") {
  try {
    console.log('Testing MCP multi_image_analysis tool with base64 images...');
    
    // Create the images array for the MCP request
    const images = base64Images.map(base64 => ({ url: base64 }));
    
    // This would normally be handled by the MCP server client
    // This is a simulation of how to structure the data for the MCP server
    console.log(`
To analyze multiple images using MCP, send this request to the MCP server:

{
  "tool": "mcp_openrouter_multi_image_analysis",
  "arguments": {
    "images": [
      { "url": "${base64Images[0].substring(0, 50)}..." } // Truncated for display
      ${base64Images.length > 1 ? `, { "url": "${base64Images[1].substring(0, 50)}..." }` : ''}
      ${base64Images.length > 2 ? ', ...' : ''}
    ],
    "prompt": "${prompt}",
    "model": "${DEFAULT_MODEL}"
  }
}

The MCP server will process these base64 images and send them to OpenRouter
in the correct format.
`);
  } catch (error) {
    console.error('Error testing MCP multi_image_analysis:', error);
  }
}

/**
 * Example 3: Direct OpenRouter API call with base64 image (for comparison)
 */
async function sendImageDirectAPI(base64Image, question = "What's in this image?", apiKey) {
  try {
    console.log('Sending image directly to OpenRouter API (for comparison)...');
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: DEFAULT_MODEL,
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
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/yourusername/your-repo',
          'X-Title': 'MCP Server Demo'
        }
      }
    );
    
    console.log('\nDirect API response:');
    console.log(response.data.choices[0].message.content);
  } catch (error) {
    console.error('Error sending image via direct API:', error);
    if (error.response) {
      console.error('API error details:', error.response.data);
    }
  }
}

/**
 * Main function to run the examples
 */
async function main() {
  try {
    // Load environment variables from .env file
    await loadEnv();
    
    // Get API key from environment after loading
    const apiKey = process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY;
    
    // Debug: Show if API key is set in environment
    console.log(`API key from environment: ${process.env.OPENROUTER_API_KEY ? 'Yes (set)' : 'No (not set)'}`);
    console.log(`Using API key: ${apiKey === 'your_openrouter_api_key' ? 'Default placeholder (update needed)' : 'From environment'}`);
    
    // Check if API key is provided
    if (apiKey === 'your_openrouter_api_key') {
      console.error('Please set the OPENROUTER_API_KEY environment variable or update the script.');
      return;
    }
    
    console.log(`Converting image: ${IMAGE_PATH}`);
    
    // Check if the image file exists
    try {
      await fs.access(IMAGE_PATH);
      console.log(`Image file exists: ${IMAGE_PATH}`);
    } catch (err) {
      console.error(`Error: Image file does not exist: ${IMAGE_PATH}`);
      return;
    }
    
    // Convert the image to base64
    const base64Image = await imageToBase64(IMAGE_PATH);
    console.log('Image converted to base64 successfully.');
    console.log(`Base64 length: ${base64Image.length} characters`);
    console.log(`Base64 starts with: ${base64Image.substring(0, 50)}...`);
    
    // For multiple images demo, we'll use the same image twice
    const base64Images = [base64Image, base64Image];
    
    // Example 1: MCP server with analyze_image
    await testMcpAnalyzeImage(base64Image);
    
    // Example 2: MCP server with multi_image_analysis
    await testMcpMultiImageAnalysis(base64Images);
    
    // Example 3: Direct API call (if API key is available)
    if (apiKey !== 'your_openrouter_api_key') {
      await sendImageDirectAPI(base64Image, "What's in this image?", apiKey);
    }
    
    console.log('\nDone! You can now use the MCP server with base64 encoded images.');
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the main function directly
console.log("Running main function...");
main().catch(error => {
  console.error("Unhandled error in main:", error);
}); 