import type { TargetFactorySignature, WebpackFactory } from '../types';
import { pageWindow } from '../window-env';

const nativeFunctionToString = pageWindow.Function.prototype.toString;

function getFunctionSource(fn: Function): string {
  try {
    return Reflect.apply(nativeFunctionToString, fn, []);
  } catch {
    return '';
  }
}

function compactSource(fn: Function): string {
  return getFunctionSource(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')
    .replace(/\s+/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

export function identifyTargetFactory(factory: WebpackFactory): TargetFactorySignature | null {
  const source = compactSource(factory);

  if (!source) {
    return null;
  }

  let exportMatch = source.match(/(?:C|["']C["']):function\(\)\{return([A-Za-z_$][\w$]*)\}/);

  if (!exportMatch) {
    exportMatch = source.match(/(?:C|["']C["']):\(\)=>([A-Za-z_$][\w$]*)/);
  }

  if (!exportMatch) {
    return null;
  }

  const accumulatorName = exportMatch[1];
  const escapedName = escapeRegExp(accumulatorName);
  let score = 0;
  const reasons: string[] = [];

  if (new RegExp(`(?:var|let|const)${escapedName}=\\[\\]`).test(source)) {
    score += 5;
    reasons.push('导出变量初始化为空数组');
  }

  const forEachCount = countMatches(source, /\.forEach\(/g);

  if (forEachCount >= 2) {
    score += 3;
    reasons.push(`forEach × ${forEachCount}`);
  }

  const sliceCount = countMatches(source, /\.slice\(/g);

  if (sliceCount >= 2) {
    score += 3;
    reasons.push(`slice × ${sliceCount}`);
  }

  const pushCount = countMatches(source, new RegExp(`${escapedName}\\.push\\(`, 'g'));

  if (pushCount >= 2) {
    score += 5;
    reasons.push(`${accumulatorName}.push × ${pushCount}`);
  }

  const forCount = countMatches(source, /for\(/g);

  if (forCount >= 2) {
    score += 2;
    reasons.push(`for 循环 × ${forCount}`);
  }

  if (/\.d\([^,]+,\{/.test(source)) {
    score += 2;
    reasons.push('Webpack e.d 导出');
  }

  if (score < 15) {
    return null;
  }

  return {
    score,
    accumulatorName,
    reasons,
    source: getFunctionSource(factory)
  };
}
