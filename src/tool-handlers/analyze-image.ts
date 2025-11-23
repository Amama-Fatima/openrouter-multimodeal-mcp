import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import { findSuitableFreeModel } from './multi-image-analysis.js';

// Default model for image analysis
const DEFAULT_FREE_MODEL = 'qwen/qwen2.5-vl-32b-instruct:free';

let sharp: any;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('Warning: sharp module not available, using fallback image processing');
  // Mock implementation that just passes through the base64 data
  sharp = (buffer: Buffer) => ({
    metadata: async () => ({ width: 800, height: 600 }),
    resize: () => ({
      jpeg: () => ({
        toBuffer: async () => buffer
      })
    }),
    jpeg: () => ({
      toBuffer: async () => buffer
    })
  });
}

export interface AnalyzeImageToolRequest {
  image_path: string;
  question?: string;
  model?: string;
}

/**
 * Normalizes a file path to be OS-neutral
 * Handles Windows backslashes, drive letters, etc.
 */
function normalizePath(filePath: string): string {
  // Skip normalization for URLs and data URLs
  if (filePath.startsWith('http://') || 
      filePath.startsWith('https://') || 
      filePath.startsWith('data:')) {
    return filePath;
  }
  
  // Handle Windows paths and convert them to a format that's usable
  // First normalize the path according to the OS
  let normalized = path.normalize(filePath);
  
  // Make sure any Windows backslashes are handled
  normalized = normalized.replace(/\\/g, '/');
  
  return normalized;
}

async function fetchImageAsBuffer(url: string): Promise<Buffer> {
  try {
    // Handle data URLs
    if (url.startsWith('data:')) {
      const matches = url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid data URL');
      }
      return Buffer.from(matches[2], 'base64');
    }
    
    // Normalize the path before proceeding
    const normalizedUrl = normalizePath(url);
    
    // Handle file URLs
    if (normalizedUrl.startsWith('file://')) {
      const filePath = normalizedUrl.replace('file://', '');
      return await fs.readFile(filePath);
    }
    
    // Handle http/https URLs
    if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
      const response = await fetch(normalizedUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }
    
    // Handle regular file paths
    try {
      return await fs.readFile(normalizedUrl);
    } catch (error: any) {
      // Try the original path as a fallback
      if (normalizedUrl !== url) {
        try {
          return await fs.readFile(url);
        } catch (secondError) {
          console.error(`Failed to read file with normalized path (${normalizedUrl}) and original path (${url})`);
          throw error; // Throw the original error
        }
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error fetching image from ${url}:`, error);
    throw error;
  }
}

/**
 * Processes an image with minimal processing when sharp isn't available
 */
async function processImageFallback(buffer: Buffer): Promise<string> {
  try {
    // Just return the buffer as base64 without processing
    return buffer.toString('base64');
  } catch (error) {
    console.error('Error in fallback image processing:', error);
    throw error;
  }
}

async function processImage(buffer: Buffer): Promise<string> {
  try {
    if (typeof sharp !== 'function') {
      console.warn('Using fallback image processing (sharp not available)');
      return processImageFallback(buffer);
    }
    
    // Get image metadata
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (error) {
      console.warn('Error getting image metadata, using fallback:', error);
      return processImageFallback(buffer);
    }
    
    // Calculate dimensions to keep base64 size reasonable
    const MAX_DIMENSION = 800;
    const JPEG_QUALITY = 80; 
    
    if (metadata.width && metadata.height) {
      const largerDimension = Math.max(metadata.width, metadata.height);
      if (largerDimension > MAX_DIMENSION) {
        const resizeOptions = metadata.width > metadata.height
          ? { width: MAX_DIMENSION }
          : { height: MAX_DIMENSION };
        
        const resizedBuffer = await sharp(buffer)
          .resize(resizeOptions)
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer();
        
        return resizedBuffer.toString('base64');
      }
    }
    
    // If no resizing needed, just convert to JPEG
    const jpegBuffer = await sharp(buffer)
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    
    return jpegBuffer.toString('base64');
  } catch (error) {
    console.error('Error processing image, using fallback:', error);
    return processImageFallback(buffer);
  }
}

/**
 * Processes an image from a path or base64 string to a proper base64 format for APIs
 */
async function prepareImage(imagePath: string): Promise<{ base64: string; mimeType: string }> {
  try {
    // Check if already a base64 data URL
    if (imagePath.startsWith('data:')) {
      const matches = imagePath.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid base64 data URL format');
      }
      return { base64: matches[2], mimeType: matches[1] };
    }
    
    // Normalize the path first
    const normalizedPath = normalizePath(imagePath);
    
    // Check if image is a URL
    if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
      try {
        const buffer = await fetchImageAsBuffer(normalizedPath);
        const processed = await processImage(buffer);
        return { base64: processed, mimeType: 'image/jpeg' }; // We convert everything to JPEG
      } catch (error: any) {
        throw new McpError(ErrorCode.InvalidParams, `Failed to fetch image from URL: ${error.message}`);
      }
    }
    
    // Handle file paths
    let absolutePath = normalizedPath;
    
    // For local file paths, ensure they are absolute 
    // Don't check URLs or data URIs
    if (!normalizedPath.startsWith('data:') && 
        !normalizedPath.startsWith('http://') && 
        !normalizedPath.startsWith('https://')) {
      
      if (!path.isAbsolute(normalizedPath)) {
        throw new McpError(ErrorCode.InvalidParams, 'Image path must be absolute');
      }
      
      // For Windows paths that include a drive letter but aren't recognized as absolute
      // by path.isAbsolute in some environments
      if (/^[A-Za-z]:/.test(normalizedPath) && !path.isAbsolute(normalizedPath)) {
        absolutePath = path.resolve(normalizedPath);
      }
    }

    try {
      // Check if the file exists
      await fs.access(absolutePath);
    } catch (error) {
      // Try the original path as a fallback
      try {
        await fs.access(imagePath);
        absolutePath = imagePath; // Use the original path if that works
      } catch (secondError) {
        throw new McpError(ErrorCode.InvalidParams, `File not found: ${absolutePath}`);
      }
    }

    // Read the file as a buffer
    let buffer;
    try {
      buffer = await fs.readFile(absolutePath);
    } catch (error) {
      // Try the original path as a fallback
      try {
        buffer = await fs.readFile(imagePath);
      } catch (secondError) {
        throw new McpError(ErrorCode.InvalidParams, `Failed to read file: ${absolutePath}`);
      }
    }
    
    // Determine MIME type from file extension
    const extension = path.extname(absolutePath).toLowerCase();
    let mimeType: string;
    
    switch (extension) {
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
      case '.bmp':
        mimeType = 'image/bmp';
        break;
      default:
        mimeType = 'application/octet-stream';
    }
    
    // Process and optimize the image
    const processed = await processImage(buffer);
    return { base64: processed, mimeType };
  } catch (error) {
    console.error('Error preparing image:', error);
    throw error;
  }
}

/**
 * Handler for analyzing a single image
 */
export async function handleAnalyzeImage(
  request: { params: { arguments: AnalyzeImageToolRequest } },
  openai: OpenAI,
  defaultModel?: string
) {
  const args = request.params.arguments;
  
  try {
    // Validate inputs
    if (!args.image_path) {
      throw new McpError(ErrorCode.InvalidParams, 'An image path, URL, or base64 data is required');
    }
    
    const question = args.question || "What's in this image?";
    
    console.error(`Processing image: ${args.image_path.substring(0, 100)}${args.image_path.length > 100 ? '...' : ''}`);
    
    // Convert the image to base64
    const { base64, mimeType } = await prepareImage(args.image_path);
    
    // Create the content array for the OpenAI API
    const content = [
      {
        type: 'text',
        text: question
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`
        }
      }
    ];
    
    // Select model with priority:
    // 1. User-specified model
    // 2. Default model from environment
    // 3. Default free vision model (qwen/qwen2.5-vl-32b-instruct:free)
    let model = args.model || defaultModel || DEFAULT_FREE_MODEL;
    
    // If a model is specified but not our default free model, verify it exists
    if (model !== DEFAULT_FREE_MODEL) {
      try {
        await openai.models.retrieve(model);
      } catch (error) {
        console.error(`Specified model ${model} not found, falling back to auto-selection`);
        model = await findSuitableFreeModel(openai);
      }
    }
    
    console.error(`Making API call with model: ${model}`);
    
    // Make the API call
    const completion = await openai.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content
      }] as any
    });
    
    // Return the analysis result
    return {
      content: [
        {
          type: 'text',
          text: completion.choices[0].message.content || '',
        },
      ],
      metadata: {
        model: completion.model,
        usage: completion.usage
      }
    };
  } catch (error) {
    console.error('Error in image analysis:', error);
    
    if (error instanceof McpError) {
      throw error;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Error analyzing image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
      metadata: {
        error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        error_message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
