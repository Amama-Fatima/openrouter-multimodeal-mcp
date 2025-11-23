import { ModelCache } from '../model-cache.js';

export interface ValidateModelToolRequest {
  model: string;
}

export async function handleValidateModel(
  request: { params: { arguments: ValidateModelToolRequest } },
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
    
    const isValid = modelCache.hasModel(args.model);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ valid: isValid }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error validating model: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
