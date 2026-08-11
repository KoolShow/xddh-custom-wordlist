import { getActiveWordlist, setWordlistChangeHandler } from '../storage';
import type {
  TargetFactorySignature,
  WebpackExports,
  WebpackFactory,
  WebpackModule,
  WebpackRequire
} from '../types';
import { reloadWordImages, replaceVisibleWords } from '../word-renderer';
import { buildReplacementN, copyArray } from '../wordlist';
import { EXPORT_NAME, PATCHED_FACTORY, patchedFactories, type PatchedFactory, state } from './state';

export function createPatchedFactory(
  moduleId: string,
  originalFactory: WebpackFactory,
  signature: TargetFactorySignature
): PatchedFactory {
  const patchedFactory: PatchedFactory = function (
    this: unknown,
    module: WebpackModule,
    exports: WebpackExports,
    webpackRequire: WebpackRequire
  ) {
    const replacementN: unknown[] = [];
    let originalGetter: (() => unknown) | null = null;
    let originalN: unknown;
    const originalDefineExports = webpackRequire.d;

    if (typeof originalDefineExports !== 'function') {
      console.warn('[XDDH Hook] webpackRequire.d 不存在', { moduleId, webpackRequire });
      return Reflect.apply(originalFactory, this, [module, exports, webpackRequire]);
    }

    const requireProxy = new Proxy(webpackRequire, {
      apply(target, thisArg: unknown, args: [string]) {
        return Reflect.apply(target, thisArg, args);
      },
      get(target, property, receiver) {
        if (property !== 'd') {
          return Reflect.get(target, property, receiver);
        }

        return function defineExportsHook(
          exportObject: WebpackExports,
          definitions: Record<string, () => unknown>
        ): void {
          if (
            exportObject === exports &&
            definitions &&
            typeof definitions[EXPORT_NAME] === 'function'
          ) {
            originalGetter = definitions[EXPORT_NAME];
            const patchedDefinitions = {
              ...definitions,
              [EXPORT_NAME]: () => replacementN
            };

            console.log('[XDDH Hook] 已拦截 C 导出', { moduleId, originalGetter });
            Reflect.apply(originalDefineExports, target, [exportObject, patchedDefinitions]);
            return;
          }

          Reflect.apply(originalDefineExports, target, [exportObject, definitions]);
        };
      }
    });

    const result = Reflect.apply(originalFactory, this, [module, exports, requireProxy]);

    if (originalGetter) {
      try {
        originalN = Reflect.apply(originalGetter, undefined, []);
      } catch (error) {
        console.error('[XDDH Hook] 读取原始 n 失败', error);
      }
    }

    let generatedReplacement: unknown[];

    try {
      generatedReplacement = buildReplacementN(originalN, getActiveWordlist());
    } catch (error) {
      console.error('[XDDH Hook] 生成替代 n 失败', error);
      generatedReplacement = Array.isArray(originalN) ? originalN : [];
    }

    copyArray(replacementN, generatedReplacement);
    state.target = { moduleId, signature, originalFactory, originalGetter, originalN, replacementN, exports };

    console.log('[XDDH Hook] 目标模块执行完成', {
      moduleId,
      originalN,
      replacementN,
      exportedC: exports.C,
      sameReference: exports.C === replacementN
    });

    return result;
  };

  Object.defineProperty(patchedFactory, PATCHED_FACTORY, {
    value: { moduleId, signature, originalFactory }
  });
  patchedFactories.add(originalFactory);
  patchedFactories.add(patchedFactory);

  return patchedFactory;
}

export function patchTargetFactory(
  modules: Record<string, WebpackFactory>,
  moduleId: string,
  factory: WebpackFactory,
  signature: TargetFactorySignature
): boolean {
  const candidateFactory = factory as PatchedFactory;

  if (candidateFactory[PATCHED_FACTORY] || patchedFactories.has(factory)) {
    return false;
  }

  modules[moduleId] = createPatchedFactory(moduleId, factory, signature);
  console.info('[XDDH Hook] 已替换目标 factory', {
    moduleId,
    score: signature.score,
    accumulatorName: signature.accumulatorName,
    reasons: signature.reasons
  });

  return true;
}

export function patchExecutedModuleExports(
  moduleId: string,
  exportsObject: WebpackExports | undefined,
  signature: TargetFactorySignature,
  originalFactory: WebpackFactory
): boolean {
  if (!exportsObject || !Array.isArray(exportsObject[EXPORT_NAME])) {
    return false;
  }

  const exportedC = exportsObject[EXPORT_NAME];

  if (state.target?.moduleId === moduleId && state.target.replacementN === exportedC) {
    console.info('[XDDH Hook] 目标 factory 已执行，无需缓存恢复', { moduleId });
    return true;
  }

  const originalN = exportedC.slice();
  let replacementN: unknown[];

  try {
    replacementN = buildReplacementN(originalN, getActiveWordlist());
  } catch (error) {
    console.error('[XDDH Hook] 缓存恢复时生成替代词库失败', error);
    replacementN = originalN.slice();
  }

  copyArray(exportedC, replacementN);
  state.target = {
    moduleId,
    signature,
    originalFactory,
    originalGetter: null,
    originalN,
    replacementN: exportedC,
    exports: exportsObject,
    recoveredFromRuntimeCache: true
  };
  console.info('[XDDH Hook] 已原地修改缓存模块的 C 数组', {
    moduleId,
    originalLength: originalN.length,
    replacementLength: exportedC.length,
    sameReference: exportsObject[EXPORT_NAME] === exportedC
  });

  return true;
}

export function applyStoredWordListToCurrentTarget(): boolean {
  const target = state.target;

  if (!target || !Array.isArray(target.originalN) || !Array.isArray(target.replacementN)) {
    return false;
  }

  const nextWords = buildReplacementN(target.originalN, getActiveWordlist());
  const previousWords = target.replacementN.slice();
  copyArray(target.replacementN, nextWords);
  replaceVisibleWords(previousWords, nextWords);
  queueMicrotask(reloadWordImages);
  console.info('[XDDH Hook] 已应用本地词库', {
    originalLength: target.originalN.length,
    replacementLength: target.replacementN.length
  });

  return true;
}

setWordlistChangeHandler(applyStoredWordListToCurrentTarget);
