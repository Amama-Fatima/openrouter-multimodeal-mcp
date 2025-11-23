import axios, { AxiosError, AxiosInstance } from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Client for interacting with the OpenRouter API
 */
export class OpenRouterAPIClient {
  private apiKey: string;
  private axiosInstance: AxiosInstance;
  private retryCount: number = 3;
  private retryDelay: number = 1000; // Initial delay in ms

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.axiosInstance = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
        'X-Title': 'OpenRouter MCP Multimodal Server'
      },
      timeout: 60000 // 60 seconds timeout
    });
  }

  /**
   * Get all available models from OpenRouter
   */
  public async getModels(): Promise<any[]> {
    try {
      const response = await this.axiosInstance.get('/models');
      return response.data.data;
    } catch (error) {
      this.handleRequestError(error);
      return [];
    }
  }

  /**
   * Send a request to the OpenRouter API with retry functionality
   */
  public async request(endpoint: string, method: string, data?: any): Promise<any> {
    let lastError: Error | null = null;
    let retries = 0;

    while (retries <= this.retryCount) {
      try {
        const response = await this.axiosInstance.request({
          url: endpoint,
          method,
          data
        });

        return response.data;
      } catch (error) {
        lastError = this.handleRetryableError(error, retries);
        retries++;

        if (retries <= this.retryCount) {
          // Exponential backoff with jitter
          const delay = this.retryDelay * Math.pow(2, retries - 1) * (0.5 + Math.random() * 0.5);
          console.error(`Retrying in ${Math.round(delay)}ms (${retries}/${this.retryCount})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // If we get here, all retries failed
    throw lastError || new Error('Request failed after multiple retries');
  }

  /**
   * Handle retryable errors
   */
  private handleRetryableError(error: any, retryCount: number): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      // Rate limiting (429) or server errors (5xx)
      if (axiosError.response?.status === 429 || (axiosError.response?.status && axiosError.response.status >= 500)) {
        console.error(`Request error (retry ${retryCount}): ${axiosError.message}`);
        if (axiosError.response?.status === 429) {
          console.error('Rate limit exceeded. Retrying with backoff...');
        }
        return new Error(`OpenRouter API error: ${axiosError.response?.status} ${axiosError.message}`);
      }
      
      // For other status codes, don't retry
      if (axiosError.response) {
        const responseData = axiosError.response.data as any;
        const message = responseData?.error?.message || axiosError.message;
        throw new McpError(ErrorCode.InternalError, `OpenRouter API error: ${message}`);
      }
    }
    
    // Network errors should be retried
    console.error(`Network error (retry ${retryCount}): ${error.message}`);
    return new Error(`Network error: ${error.message}`);
  }

  /**
   * Handle request errors
   */
  private handleRequestError(error: any): never {
    console.error('Error in OpenRouter API request:', error);
    
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        const status = axiosError.response.status;
        const responseData = axiosError.response.data as any;
        const message = responseData?.error?.message || axiosError.message;
        
        if (status === 401 || status === 403) {
          throw new McpError(ErrorCode.InvalidRequest, `Authentication error: ${message}`);
        } else if (status === 429) {
          throw new McpError(ErrorCode.InternalError, `Rate limit exceeded: ${message}`);
        } else {
          throw new McpError(ErrorCode.InternalError, `OpenRouter API error (${status}): ${message}`);
        }
      } else if (axiosError.request) {
        throw new McpError(ErrorCode.ConnectionClosed, `Network error: ${axiosError.message}`);
      }
    }
    
    throw new McpError(ErrorCode.InternalError, `Unknown error: ${error.message || 'No error message'}`);
  }
}
