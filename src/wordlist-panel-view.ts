export type WordlistPanelView = {
  panel: HTMLElement
  toggleButton: HTMLButtonElement
  closeButton: HTMLButtonElement
  urlInput: HTMLInputElement
  textInput: HTMLTextAreaElement
  importUrlButton: HTMLButtonElement
  importTextButton: HTMLButtonElement
  resetButton: HTMLButtonElement
  wordlistSelect: HTMLSelectElement
  storedCount: HTMLElement
  targetCount: HTMLElement
  sourceElement: HTMLElement
  statusElement: HTMLElement
}

const PANEL_HOST_ID = 'xddh-word-list-panel-host'
const TAILWIND_CSS_URL = 'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css'

const WORDLIST_PANEL_HTML = `
  <section id="xddh-word-panel" class="hidden min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
    <header class="shrink-0 flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <div>
        <h2 class="text-base font-semibold text-gray-900">自定义词库</h2>
        <p class="mt-1 text-xs text-gray-500">导入内容会保存在浏览器本地</p>
      </div>
      <button id="xddh-close-panel" type="button" class="rounded-md px-2 py-1 text-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="关闭">×</button>
    </header>
    <div class="min-h-0 space-y-4 overflow-y-auto p-4">
      <div class="rounded-lg bg-gray-50 p-3 text-sm">
        <div class="flex justify-between"><span class="text-gray-500">本地词库</span><span id="xddh-stored-count" class="font-medium text-gray-900">0</span></div>
        <div class="mt-1 flex justify-between"><span class="text-gray-500">游戏词库长度</span><span id="xddh-target-count" class="font-medium text-gray-900">等待模块</span></div>
        <div class="mt-1 flex items-start justify-between gap-3"><span class="shrink-0 text-gray-500">来源</span><span id="xddh-source" class="break-all text-right font-medium text-gray-900">游戏原词库</span></div>
      </div>
      <div class="space-y-2">
        <label for="xddh-wordlist-select" class="block text-sm font-medium text-gray-700">选择词库</label>
        <select id="xddh-wordlist-select" class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"></select>
      </div>
      <div class="space-y-2">
        <label for="xddh-word-url" class="block text-sm font-medium text-gray-700">从网址导入</label>
        <input id="xddh-word-url" type="url" placeholder="https://example.com/words.txt" class="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200">
        <button id="xddh-import-url" type="button" class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">从网址导入</button>
      </div>
      <div class="flex items-center gap-3"><div class="h-px flex-1 bg-gray-200"></div><span class="text-xs text-gray-400">或</span><div class="h-px flex-1 bg-gray-200"></div></div>
      <div class="space-y-2">
        <label for="xddh-word-text" class="block text-sm font-medium text-gray-700">粘贴词库</label>
        <textarea id="xddh-word-text" rows="7" placeholder="一行一个词&#10;苹果&#10;香蕉&#10;西瓜" class="block w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"></textarea>
        <p class="text-xs text-gray-400">也可以把本地 .txt 词库文件拖到输入框中</p>
        <button id="xddh-import-text" type="button" class="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black">导入粘贴内容</button>
      </div>
      <button id="xddh-reset-words" type="button" class="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">删除当前词库并恢复默认</button>
      <p id="xddh-word-status" class="min-h-5 text-sm text-gray-500"></p>
      <p class="text-xs leading-5 text-gray-400">导入后会立即修改当前导出数组。游戏已经缓存词库时，刷新页面后可确保全部生效。</p>
    </div>
  </section>
  <button id="xddh-toggle-panel" type="button" class="shrink-0 rounded-full bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-xl hover:bg-black">词库</button>
`

function getElement<T extends HTMLElement>(root: ShadowRoot, id: string): T {
  const element = root.getElementById(id)

  if (!element) {
    throw new Error(`缺少 UI 元素：${id}`)
  }

  return element as T
}

export function hasWordlistPanelView(): boolean {
  return document.getElementById(PANEL_HOST_ID) !== null
}

export function createWordlistPanelView(): WordlistPanelView {
  const host = document.createElement('div')
  host.id = PANEL_HOST_ID
  Object.assign(host.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    width: 'min(384px, calc(100vw - 32px))',
    maxHeight: 'calc(100dvh - 32px)',
    pointerEvents: 'none',
  })

  const shadow = host.attachShadow({ mode: 'open' })
  const tailwindStyle = document.createElement('link')
  tailwindStyle.rel = 'stylesheet'
  tailwindStyle.href = TAILWIND_CSS_URL
  shadow.appendChild(tailwindStyle)

  const container = document.createElement('div')
  container.className = 'max-h-full min-h-0 flex flex-col items-end space-y-3'
  container.style.pointerEvents = 'auto'
  container.style.maxHeight = 'calc(100dvh - 32px)'
  container.style.overflow = 'hidden'
  container.innerHTML = WORDLIST_PANEL_HTML
  shadow.appendChild(container)
  document.documentElement.appendChild(host)

  return {
    panel: getElement<HTMLElement>(shadow, 'xddh-word-panel'),
    toggleButton: getElement<HTMLButtonElement>(shadow, 'xddh-toggle-panel'),
    closeButton: getElement<HTMLButtonElement>(shadow, 'xddh-close-panel'),
    urlInput: getElement<HTMLInputElement>(shadow, 'xddh-word-url'),
    textInput: getElement<HTMLTextAreaElement>(shadow, 'xddh-word-text'),
    importUrlButton: getElement<HTMLButtonElement>(shadow, 'xddh-import-url'),
    importTextButton: getElement<HTMLButtonElement>(shadow, 'xddh-import-text'),
    resetButton: getElement<HTMLButtonElement>(shadow, 'xddh-reset-words'),
    wordlistSelect: getElement<HTMLSelectElement>(shadow, 'xddh-wordlist-select'),
    storedCount: getElement<HTMLElement>(shadow, 'xddh-stored-count'),
    targetCount: getElement<HTMLElement>(shadow, 'xddh-target-count'),
    sourceElement: getElement<HTMLElement>(shadow, 'xddh-source'),
    statusElement: getElement<HTMLElement>(shadow, 'xddh-word-status'),
  }
}
