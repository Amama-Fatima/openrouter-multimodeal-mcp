/**
 * ModelCache - Caches OpenRouter model data to reduce API calls
 */
export class ModelCache {
  private static instance: ModelCache;
  private models: Record<string, any>;
  private lastFetchTime: number;
  private cacheExpiryTime: number; // in milliseconds (1 hour = 3600000)

  private constructor() {
    this.models = {};
    this.lastFetchTime = 0;
    this.cacheExpiryTime = 3600000; // 1 hour
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ModelCache {
    if (!ModelCache.instance) {
      ModelCache.instance = new ModelCache();
    }
    return ModelCache.instance;
  }

  /**
   * Check if the cache is valid
   */
  public isCacheValid(): boolean {
    return (
      Object.keys(this.models).length > 0 &&
      Date.now() - this.lastFetchTime < this.cacheExpiryTime
    );
  }

  /**
   * Store all models
   */
  public setModels(models: any[]): void {
    this.models = {};
    for (const model of models) {
      this.models[model.id] = model;
    }
    this.lastFetchTime = Date.now();
  }

  /**
   * Get all cached models
   */
  public getAllModels(): any[] {
    return Object.values(this.models);
  }

  /**
   * Get a specific model by ID
   */
  public getModel(modelId: string): any | null {
    return this.models[modelId] || null;
  }

  /**
   * Check if a model exists
   */
  public hasModel(modelId: string): boolean {
    return !!this.models[modelId];
  }

  /**
   * Search models based on criteria
   */
  public searchModels(params: {
    query?: string;
    provider?: string;
    minContextLength?: number | string;
    maxContextLength?: number | string;
    maxPromptPrice?: number | string;
    maxCompletionPrice?: number | string;
    capabilities?: {
      functions?: boolean;
      tools?: boolean;
      vision?: boolean;
      json_mode?: boolean;
    };
    limit?: number | string;
  }): any[] {
    let results = this.getAllModels();

    // Apply text search
    if (params.query) {
      const query = params.query.toLowerCase();
      results = results.filter((model) =>
        model.id.toLowerCase().includes(query) ||
        (model.description && model.description.toLowerCase().includes(query)) ||
        (model.provider && model.provider.toLowerCase().includes(query))
      );
    }

    // Filter by provider
    if (params.provider) {
      results = results.filter((model) =>
        model.provider && model.provider.toLowerCase() === params.provider!.toLowerCase()
      );
    }

    // Filter by context length
    if (params.minContextLength !== undefined) {
      const minContextLength = typeof params.minContextLength === 'string' 
        ? parseInt(params.minContextLength, 10) 
        : params.minContextLength;
      if (!isNaN(minContextLength)) {
        results = results.filter(
          (model) => model.context_length >= minContextLength
        );
      }
    }

    if (params.maxContextLength !== undefined) {
      const maxContextLength = typeof params.maxContextLength === 'string' 
        ? parseInt(params.maxContextLength, 10) 
        : params.maxContextLength;
      if (!isNaN(maxContextLength)) {
        results = results.filter(
          (model) => model.context_length <= maxContextLength
        );
      }
    }

    // Filter by price
    if (params.maxPromptPrice !== undefined) {
      const maxPromptPrice = typeof params.maxPromptPrice === 'string' 
        ? parseFloat(params.maxPromptPrice) 
        : params.maxPromptPrice;
      if (!isNaN(maxPromptPrice)) {
        results = results.filter(
          (model) =>
            !model.pricing?.prompt || model.pricing.prompt <= maxPromptPrice
        );
      }
    }

    if (params.maxCompletionPrice !== undefined) {
      const maxCompletionPrice = typeof params.maxCompletionPrice === 'string' 
        ? parseFloat(params.maxCompletionPrice) 
        : params.maxCompletionPrice;
      if (!isNaN(maxCompletionPrice)) {
        results = results.filter(
          (model) =>
            !model.pricing?.completion ||
            model.pricing.completion <= maxCompletionPrice
        );
      }
    }

    // Filter by capabilities
    if (params.capabilities) {
      if (params.capabilities.functions) {
        results = results.filter(
          (model) => model.capabilities?.function_calling
        );
      }
      if (params.capabilities.tools) {
        results = results.filter((model) => model.capabilities?.tools);
      }
      if (params.capabilities.vision) {
        results = results.filter((model) => model.capabilities?.vision);
      }
      if (params.capabilities.json_mode) {
        results = results.filter((model) => model.capabilities?.json_mode);
      }
    }

    // Apply limit
    if (params.limit !== undefined) {
      const limit = typeof params.limit === 'string' 
        ? parseInt(params.limit, 10) 
        : params.limit;
      if (!isNaN(limit) && limit > 0) {
        results = results.slice(0, limit);
      }
    }

    return results;
  }

  /**
   * Reset the cache
   */
  public resetCache(): void {
    this.models = {};
    this.lastFetchTime = 0;
  }
}
