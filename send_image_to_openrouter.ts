import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import axios from 'axios';

// Constants
const OPENROUTER_API_KEY = 'your_openrouter_api_key'; // Replace with your actual key
const IMAGE_PATH = 'path/to/your/image.jpg'; // Replace with your image path

/**
 * Convert an image file to base64
 */
async function imageToBase64(filePath: string): Promise<string> {
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
 * Method 1: Send an image to OpenRouter using direct API call
 */
async function sendImageDirectAPI(base64Image: string, question: string = "What's in this image?"): Promise<void> {
  try {
    console.log('Sending image via direct API call...');
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'anthropic/claude-3-opus', // Choose an appropriate model with vision capabilities
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
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://your-site-url.com', // Optional
          'X-Title': 'Your Site Name' // Optional
        }
      }
    );
    
    console.log('Response from direct API:');
    console.log(response.data.choices[0].message.content);
  } catch (error) {
    console.error('Error sending image via direct API:', error);
    if (axios.isAxiosError(error) && error.response) {
      console.error('API error details:', error.response.data);
    }
  }
}

/**
 * Method 2: Send an image to OpenRouter using OpenAI SDK
 */
async function sendImageOpenAISDK(base64Image: string, question: string = "What's in this image?"): Promise<void> {
  try {
    console.log('Sending image via OpenAI SDK...');
    
    // Initialize the OpenAI client with OpenRouter base URL
    const openai = new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://your-site-url.com', // Optional
        'X-Title': 'Your Site Name' // Optional
      }
    });
    
    // Create the message with text and image
    const completion = await openai.chat.completions.create({
      model: 'anthropic/claude-3-opus', // Choose an appropriate model with vision capabilities
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
    
    console.log('Response from OpenAI SDK:');
    console.log(completion.choices[0].message.content);
  } catch (error) {
    console.error('Error sending image via OpenAI SDK:', error);
  }
}

/**
 * Main function to run the examples
 */
async function main() {
  try {
    // Convert the image to base64
    const base64Image = await imageToBase64(IMAGE_PATH);
    console.log('Image converted to base64 successfully');
    
    // Example 1: Using direct API call
    await sendImageDirectAPI(base64Image);
    
    // Example 2: Using OpenAI SDK
    await sendImageOpenAISDK(base64Image);
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the examples
main(); 