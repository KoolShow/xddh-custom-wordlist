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

writeFileSync(`public/list.html`, `<ul>${list}</ul>`)


export default defineConfig({
  build: {
    outDir: 'dist'
  }
})