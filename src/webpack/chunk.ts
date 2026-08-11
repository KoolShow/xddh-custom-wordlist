import { wordListReadyPromise } from '../storage';
import type { Candidate, WebpackChunk } from '../types';
import { pageWindow } from '../window-env';
import { identifyTargetFactory } from './signature';
import { CHUNK_GLOBAL, PATCHED_FACTORY, WRAPPED_PUSH, type PatchedFactory, seenChunks, state, type WrappedPush } from './state';
import { installChunkLoadGate, queueWebpackRuntimeCapture, recoverFromWebpackRuntime, selectTargetCandidate } from './runtime';
import { patchTargetFactory } from './target';

function getCurrentScriptUrl(): string {
  try {
    return document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '';
  } catch {
    return '';
  }
}

export function isXddhChunkUrl(url: string): boolean {
  return /(?:^|\/)xddh\.[^/?#]+\.chunk\.js(?:[?#]|$)/i.test(url);
}

function inspectChunk(chunkData: unknown): void {
  if (!Array.isArray(chunkData) || seenChunks.has(chunkData)) {
    return;
  }

  seenChunks.add(chunkData);
  const [chunkIds, modules] = chunkData as WebpackChunk;

  if (!modules || typeof modules !== 'object') {
    return;
  }

  const moduleIds = Object.keys(modules);
  const scriptUrl = getCurrentScriptUrl();
  const record = {
    time: performance.now(),
    scriptUrl,
    isXddhChunk: isXddhChunkUrl(scriptUrl),
    chunkIds: Array.isArray(chunkIds) ? chunkIds.slice() : [chunkIds],
    moduleIds
  };

  state.chunks.push(record);
  console.groupCollapsed(`[XDDH Hook] chunk ${record.chunkIds.join(', ')}，模块数 ${moduleIds.length}`);
  console.log('脚本地址：', scriptUrl);
  console.log('Chunk IDs：', record.chunkIds);
  console.log('Module IDs：', moduleIds);
  console.groupEnd();

  const candidates: Candidate[] = [];

  for (const [moduleId, factory] of Object.entries(modules)) {
    if ((factory as PatchedFactory)[PATCHED_FACTORY]) {
      continue;
    }

    const signature = identifyTargetFactory(factory);

    if (!signature) {
      continue;
    }

    const candidate: Candidate = { moduleId, factory, originalFactory: factory, signature, chunkIds: record.chunkIds, scriptUrl };
    candidates.push(candidate);
    state.candidates.push(candidate);
    console.info('[XDDH Hook] 找到候选模块', {
      moduleId,
      score: signature.score,
      localAccumulator: signature.accumulatorName,
      reasons: signature.reasons,
      scriptUrl
    });
  }

  const selected = selectTargetCandidate(candidates, 'chunk');

  if (!selected) {
    return;
  }

  patchTargetFactory(modules, selected.moduleId, selected.factory, selected.signature);

  if (state.webpackRequire) {
    installChunkLoadGate(state.webpackRequire);
    queueMicrotask(() => {
      wordListReadyPromise.then(() => {
        if (state.webpackRequire) {
          recoverFromWebpackRuntime(state.webpackRequire);
        }
      });
    });
  }
}

function wrapPush(pushFunction: unknown): WrappedPush | unknown {
  const wrapped = pushFunction as WrappedPush;

  if (typeof pushFunction !== 'function' || wrapped[WRAPPED_PUSH]) {
    return pushFunction;
  }

  const interceptedPush: WrappedPush = function (this: unknown, ...chunks: unknown[]) {
    for (const chunk of chunks) {
      inspectChunk(chunk);
    }

    return Reflect.apply(pushFunction, this, chunks);
  };

  Object.defineProperty(interceptedPush, WRAPPED_PUSH, { value: true });

  return interceptedPush;
}

export function installWebpackInterceptor(): void {
  const queueAlreadyExisted = Array.isArray(pageWindow[CHUNK_GLOBAL as keyof Window]);
  const queue = (pageWindow[CHUNK_GLOBAL as keyof Window] || []) as unknown[];

  Object.assign(pageWindow, { [CHUNK_GLOBAL]: queue });

  if (!Array.isArray(queue)) {
    throw new TypeError(`${CHUNK_GLOBAL} 不是数组`);
  }

  const existingChunks = queue.slice();
  state.installInfo = { time: performance.now(), readyState: document.readyState, queueAlreadyExisted, existingChunkCount: existingChunks.length };
  let activePush = wrapPush(queue.push);

  Object.defineProperty(queue, 'push', {
    configurable: true,
    get() {
      return activePush;
    },
    set(nextPush) {
      activePush = wrapPush(nextPush);
      console.info('[XDDH Hook] Webpack 更新了 push，已重新包装', {
        functionName: typeof nextPush === 'function' ? nextPush.name : ''
      });
    }
  });

  console.info(`[XDDH Hook] 已监听 ${CHUNK_GLOBAL}.push`, state.installInfo);

  for (const chunk of existingChunks) {
    inspectChunk(chunk);
  }

  queueWebpackRuntimeCapture(queue);
}
