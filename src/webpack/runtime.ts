import { wordListReadyPromise } from '../storage';
import type { Candidate, WebpackExports, WebpackRequire } from '../types';
import { identifyTargetFactory } from './signature';
import { EXPORT_NAME, PATCHED_CHUNK_LOAD, PATCHED_FACTORY, type PatchedChunkLoad, type PatchedFactory, state } from './state';
import { createPatchedFactory, patchExecutedModuleExports } from './target';

let runtimeCaptureQueued = false;

export function installChunkLoadGate(webpackRequire: WebpackRequire): void {
  const originalChunkLoad = webpackRequire.e as PatchedChunkLoad | undefined;

  if (typeof originalChunkLoad !== 'function' || originalChunkLoad[PATCHED_CHUNK_LOAD]) {
    return;
  }

  const patchedChunkLoad: PatchedChunkLoad = function (this: unknown, ...chunkIds: unknown[]) {
    return wordListReadyPromise.then(() => originalChunkLoad.apply(this, chunkIds));
  };

  Object.defineProperty(patchedChunkLoad, PATCHED_CHUNK_LOAD, { value: true });
  webpackRequire.e = patchedChunkLoad;
  console.info('[XDDH Hook] 已包装 chunk 加载函数，等待词库就绪');
}

export function selectTargetCandidate(candidates: readonly Candidate[], sourceLabel: string): Candidate | null {
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length === 0) {
    return null;
  }

  const knownCandidate = candidates.find(candidate => candidate.moduleId === '1993');

  if (knownCandidate) {
    console.info('[XDDH Hook] 多候选时使用已知模块 ID', { sourceLabel, moduleId: knownCandidate.moduleId });
    return knownCandidate;
  }

  console.warn('[XDDH Hook] 存在多个候选模块，拒绝自动选择', { sourceLabel, candidates });

  return null;
}

export function recoverFromWebpackRuntime(webpackRequire: WebpackRequire): boolean {
  if (typeof webpackRequire !== 'function' || !webpackRequire.m || typeof webpackRequire.m !== 'object') {
    console.warn('[XDDH Hook] 捕获到的 Webpack require 无效', webpackRequire);
    return false;
  }

  state.webpackRequire = webpackRequire;
  state.runtimeCaptured = true;
  state.runtimeRecoveryCount += 1;

  const runtimeModules = webpackRequire.m;
  const candidates: Candidate[] = [];

  for (const [moduleId, factory] of Object.entries(runtimeModules)) {
    const patchedMetadata = (factory as PatchedFactory)[PATCHED_FACTORY];

    if (patchedMetadata?.moduleId) {
      candidates.push({
        moduleId,
        factory,
        signature: patchedMetadata.signature,
        originalFactory: patchedMetadata.originalFactory,
        alreadyPatched: true
      });
      continue;
    }

    const signature = identifyTargetFactory(factory);

    if (signature) {
      candidates.push({ moduleId, factory, originalFactory: factory, signature, alreadyPatched: false });
    }
  }

  const selected = selectTargetCandidate(candidates, 'webpackRequire.m');

  if (!selected) {
    console.info('[XDDH Hook] 运行时模块表中暂未发现目标', { moduleCount: Object.keys(runtimeModules).length });
    return false;
  }

  if (!selected.alreadyPatched) {
    runtimeModules[selected.moduleId] = createPatchedFactory(selected.moduleId, selected.factory, selected.signature);
    console.info('[XDDH Hook] 已修改 Webpack 运行时模块表', {
      moduleId: selected.moduleId,
      score: selected.signature.score
    });
  } else {
    console.info('[XDDH Hook] 运行时模块表中的目标已被包装', { moduleId: selected.moduleId });
  }

  const cachedModule = webpackRequire.c?.[selected.moduleId];

  if (
    cachedModule &&
    patchExecutedModuleExports(selected.moduleId, cachedModule.exports, selected.signature, selected.originalFactory)
  ) {
    return true;
  }

  let exportsObject: WebpackExports;

  try {
    exportsObject = webpackRequire(selected.moduleId);
  } catch (error) {
    console.error('[XDDH Hook] 主动执行目标模块失败', { moduleId: selected.moduleId, error });
    return false;
  }

  if (state.target?.moduleId === selected.moduleId && state.target.replacementN === exportsObject?.[EXPORT_NAME]) {
    console.info('[XDDH Hook] 目标模块已通过修改后的 factory 执行', { moduleId: selected.moduleId });
    return true;
  }

  return patchExecutedModuleExports(selected.moduleId, exportsObject, selected.signature, selected.originalFactory);
}

export function queueWebpackRuntimeCapture(queue: unknown[]): void {
  if (runtimeCaptureQueued) {
    return;
  }

  runtimeCaptureQueued = true;
  const runtimeChunkId = `xddh-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  queue.push([
    [runtimeChunkId],
    {},
    (webpackRequire: WebpackRequire) => {
      console.info('[XDDH Hook] 已捕获 Webpack Runtime', {
        runtimeChunkId,
        moduleCount: Object.keys(webpackRequire.m || {}).length
      });
      installChunkLoadGate(webpackRequire);
      wordListReadyPromise.then(() => recoverFromWebpackRuntime(webpackRequire));
    }
  ]);
  console.info('[XDDH Hook] 已提交 Runtime 捕获 chunk', { runtimeChunkId });
}
