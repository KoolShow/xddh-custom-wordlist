import type { HookState, TargetFactorySignature, WebpackFactory, WebpackRequire } from '../types';

export const CHUNK_GLOBAL = 'webpackChunkgame';
export const EXPORT_NAME = 'C';
export const WRAPPED_PUSH = Symbol('xddhWrappedPush');
export const PATCHED_FACTORY = Symbol('xddhPatchedFactory');
export const PATCHED_CHUNK_LOAD = Symbol('xddhPatchedChunkLoad');

export const seenChunks = new WeakSet<object>();
export const patchedFactories = new WeakSet<WebpackFactory>();
export const seenResourceUrls = new Set<string>();

export type PatchedFactory = WebpackFactory & {
  [PATCHED_FACTORY]?: {
    moduleId: string;
    signature: TargetFactorySignature;
    originalFactory: WebpackFactory;
  };
};

export type WrappedPush = Array<unknown>['push'] & {
  [WRAPPED_PUSH]?: boolean;
};

export type PatchedChunkLoad = NonNullable<WebpackRequire['e']> & {
  [PATCHED_CHUNK_LOAD]?: boolean;
};

export const state: HookState = {
  resources: [],
  chunks: [],
  candidates: [],
  target: null,
  webpackRequire: null,
  runtimeCaptured: false,
  runtimeRecoveryCount: 0,
  installInfo: {
    time: performance.now(),
    readyState: document.readyState,
    queueAlreadyExisted: false,
    existingChunkCount: 0
  }
};
