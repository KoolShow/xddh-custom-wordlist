import { isXddhChunkUrl } from './chunk';
import { seenResourceUrls, state } from './state';

function recordResourceUrl(url: string): void {
  if (!url || !isXddhChunkUrl(url) || seenResourceUrls.has(url)) {
    return;
  }

  seenResourceUrls.add(url);
  state.resources.push(url);
  console.info('[XDDH Hook] 浏览器加载了 chunk：', url);
}

export function installResourceObserver(): void {
  try {
    for (const entry of performance.getEntriesByType('resource')) {
      recordResourceUrl(entry.name);
    }

    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        recordResourceUrl(entry.name);
      }
    });

    observer.observe({ type: 'resource', buffered: true });
  } catch (error) {
    console.warn('[XDDH Hook] ResourceObserver 不可用', error);
  }
}
