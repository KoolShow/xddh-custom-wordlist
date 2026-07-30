import { readdirSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const dir = 'public/bank'

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
  build: {
    outDir: 'dist'
  }
})