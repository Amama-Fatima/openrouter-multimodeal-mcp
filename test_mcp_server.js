// Test MCP server with image analysis
import { promises as fs } from 'fs';
import path from 'path';

// Path to test image
const IMAGE_PATH = process.argv[2] || 'test.png';

// Function to convert image to base64
async function imageToBase64(imagePath) {
  try {
    // Read the file
    const imageBuffer = await fs.readFile(imagePath);
    
    // Determine MIME type based on file extension
    const fileExt = path.extname(imagePath).toLowerCase();
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
        mimeType = 'image/png'; // Default to PNG
    }
    
    // Convert to base64 and add the data URI prefix
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

// Main function to test the MCP server
async function main() {
  try {
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
    
    // Create the request for analyze_image
    const analyzeImageRequest = {
      jsonrpc: '2.0',
      id: '1',
      method: 'mcp/call_tool',
      params: {
        tool: 'mcp_openrouter_analyze_image',
        arguments: {
          image_path: base64Image,
          question: "What's in this image?",
          model: 'qwen/qwen2.5-vl-32b-instruct:free'
        }
      }
    };
    
    // Send the request to the MCP server's stdin
    console.log('Sending request to MCP server...');
    process.stdout.write(JSON.stringify(analyzeImageRequest) + '\n');
    
    // The MCP server will write the response to stdout, which we can read
    console.log('Waiting for response...');
    
    // In a real application, you would read from the server's stdout stream
    // Here we just wait for input to be processed by the MCP server
    console.log('Request sent to MCP server. Check the server logs for the response.');
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the main function
main().catch(error => {
  console.error("Unhandled error in main:", error);
}); 