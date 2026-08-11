import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

const dir = 'public/bank'
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const list = readdirSync(dir, { withFileTypes: true })
  .filter(item => item.name !== 'list.html')
  .map(item => {
    const name = item.name + (item.isDirectory() ? '/' : '')
    return `<li><a href="/bank/${encodeURIComponent(item.name)}">${name}</a></li>`
  })
  .join('')

writeFileSync(
  'public/list.html',
  `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>词库列表</title>
</head>
<body>
  <ul>${list}</ul>
</body>
</html>`
)


export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: '行动代号自定义词库',
        namespace: 'https://xddh.koolshow.top',
        version: packageJson.version,
        description: 'hullqin xddh替换默认词库, 支持链接与直接输入',
        match: ['https://game.hullqin.cn/xddh/*'],
        'run-at': 'document-start',
        sandbox: 'raw',
        grant: [
          'unsafeWindow',
          'GM_xmlhttpRequest'
        ],
        connect: ['*'],
        updateURL: 'https://xddh-custom-wordlist.koolshow.top/xddh.user.js',
        downloadURL: 'https://xddh-custom-wordlist.koolshow.top/xddh.user.js'
      },
      build: {
        fileName: 'xddh.user.js'
      }
    })
  ],
  build: {
    outDir: 'dist'
  }
})
