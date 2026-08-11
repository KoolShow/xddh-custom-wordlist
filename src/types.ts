export type WordlistSource =
  | { type: 'text' }
  | { type: 'url'; value: string };

export type WordlistRecord = {
  id: string;
  name: string;
  words: string[];
  source: WordlistSource;
  updatedAt: number;
};

export type TargetFactorySignature = {
  score: number;
  accumulatorName: string;
  reasons: string[];
  source: string;
};

export type TargetState = {
  moduleId: string;
  signature: TargetFactorySignature;
  originalFactory: WebpackFactory;
  originalGetter: (() => unknown) | null;
  originalN: unknown;
  replacementN: unknown[];
  exports: WebpackExports;
  recoveredFromRuntimeCache?: boolean;
};

export type Candidate = {
  moduleId: string;
  factory: WebpackFactory;
  originalFactory: WebpackFactory;
  signature: TargetFactorySignature;
  alreadyPatched?: boolean;
  chunkIds?: unknown[];
  scriptUrl?: string;
};

export type ChunkRecord = {
  time: number;
  scriptUrl: string;
  isXddhChunk: boolean;
  chunkIds: unknown[];
  moduleIds: string[];
};

export type HookState = {
  resources: string[];
  chunks: ChunkRecord[];
  candidates: Candidate[];
  target: TargetState | null;
  webpackRequire: WebpackRequire | null;
  runtimeCaptured: boolean;
  runtimeRecoveryCount: number;
  installInfo: {
    time: number;
    readyState: DocumentReadyState;
    queueAlreadyExisted: boolean;
    existingChunkCount: number;
  };
};

export type WebpackExports = Record<string, unknown>;
export type WebpackModule = { exports: WebpackExports };
export type WebpackFactory = (
  module: WebpackModule,
  exports: WebpackExports,
  webpackRequire: WebpackRequire
) => unknown;

export type WebpackRequire = {
  (moduleId: string): WebpackExports;
  d?: (exports: WebpackExports, definitions: Record<string, () => unknown>) => void;
  e?: (...chunkIds: unknown[]) => Promise<unknown>;
  m?: Record<string, WebpackFactory>;
  c?: Record<string, WebpackModule>;
};

export type WebpackChunk = [unknown, Record<string, WebpackFactory>?, unknown?];

export type WordListUI = {
  refresh(): Promise<void> | void;
  setStatus(message: string, type?: 'normal' | 'success' | 'error'): void;
};
