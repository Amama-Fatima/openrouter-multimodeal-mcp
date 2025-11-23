import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ModelCache } from '../model-cache.js';

export interface GetModelInfoToolRequest {
  model: string;
}

export async function handleGetModelInfo(
  request: { params: { arguments: GetModelInfoToolRequest } },
  modelCache: ModelCache
) {
  const args = request.params.arguments;
  
  try {
    if (!modelCache.isCacheValid()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Model cache is empty or expired. Please call search_models first to populate the cache.',
          },
        ],
        isError: true,
      };
    }
    
    const model = modelCache.getModel(args.model);
    if (!model) {
      throw new McpError(ErrorCode.InvalidParams, `Model '${args.model}' not found`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(model, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving model info: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
