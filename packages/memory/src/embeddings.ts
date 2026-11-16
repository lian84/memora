import path from 'node:path';

export const DEFAULT_EMBEDDING_MODEL = 'Horizon-Labs/multilingual-embedding-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingModelInfo {
  model: string;
  dimensions: number;
}

/** Provider contract: no memory content is sent to remote inference services. */
export interface EmbeddingService {
  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  getModelInfo(): EmbeddingModelInfo;
  isAvailable(): boolean;
  close(): Promise<void>;
}

export class TransformersEmbeddingService implements EmbeddingService {
  private initialization: Promise<void> | undefined;
  private tokenizer: Awaited<ReturnType<typeof import('@huggingface/transformers').AutoTokenizer.from_pretrained>> | undefined;
  private model: Awaited<ReturnType<typeof import('@huggingface/transformers').AutoModel.from_pretrained>> | undefined;

  constructor(
    private readonly dataDir: string,
    private readonly info: EmbeddingModelInfo = { model: DEFAULT_EMBEDDING_MODEL, dimensions: DEFAULT_EMBEDDING_DIMENSIONS },
    private readonly allowDownload = false,
  ) {}

  getModelInfo(): EmbeddingModelInfo { return { ...this.info }; }
  isAvailable(): boolean { return !!this.model && !!this.tokenizer; }

  initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.load();
    return this.initialization;
  }

  private async load(): Promise<void> {
    const { env, AutoTokenizer, AutoModel } = await import('@huggingface/transformers');
    env.cacheDir = path.resolve(this.dataDir, 'models');
    env.localModelPath = `${env.cacheDir}${path.sep}`;
    env.allowRemoteModels = this.allowDownload;
    env.allowLocalModels = true;
    this.tokenizer = await AutoTokenizer.from_pretrained(this.info.model);
    try {
      this.model = await AutoModel.from_pretrained(this.info.model, { dtype: 'q8' });
    } catch (error) {
      this.tokenizer = undefined;
      throw error;
    }
  }

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedBatch([text]);
    return vector!;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    await this.initialize();
    const inputs = await this.tokenizer!(texts, { padding: true, truncation: true });
    const outputs = await this.model!(inputs);
    const tensor = outputs.sentence_embedding;
    if (!tensor || tensor.dims.length !== 2 || tensor.dims[0] !== texts.length || tensor.dims[1] !== this.info.dimensions) {
      throw new Error(`Embedding shape mismatch: expected ${texts.length} x ${this.info.dimensions}`);
    }
    const data = tensor.data;
    return texts.map((_, i) => Float32Array.from(Array.from(data.slice(i * this.info.dimensions, (i + 1) * this.info.dimensions), Number)));
  }

  async close(): Promise<void> {
    if (this.initialization) await this.initialization.catch(() => {});
    await this.model?.dispose();
    this.model = undefined;
    this.tokenizer = undefined;
    this.initialization = undefined;
  }
}
