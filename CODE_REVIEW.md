# 代码审查与迁移 TODO

## 审查范围

- `public/xddh.user.js`
- `package.json`
- 项目根目录结构

## 审查结论

### 冗余代码

- `public/xddh.user.js:64,1241-1250`：`FORCE_REQUIRE_TARGET` 恒为 `true`，对应分支永久不可达。
- `public/xddh.user.js:313,2092-2093`：导入时重复调用 `applyStoredWordListToCurrentTarget()`。
- `public/xddh.user.js:286-288,2079-2083`：空词库校验重复；应保留领域边界校验。

### 正确性风险

- `public/xddh.user.js:323-328`：无效词库 ID 会得到 `activeWordlist = null`，但仍持久化无效 ID。
- `public/xddh.user.js:94-144`：IndexedDB 首次打开失败后会缓存 rejected `dbPromise`，后续无法重试。
- `public/xddh.user.js:349-381`：初始化完成后 8 秒定时器仍保留至触发。

### 结构与性能

- `public/xddh.user.js` 共 2393 行，混合 IndexedDB、词库转换、Webpack Hook、UI、DOM 渲染和启动逻辑。
- `public/xddh.user.js:1687-2284`：UI 构建、状态刷新和事件处理集中在单个大型函数。
- `public/xddh.user.js:2369-2385`：每次 DOM mutation 都全量扫描 `.xddh-word`，且未合并重复 `requestAnimationFrame`。

### 工程现状

- `package.json:6-10` 仅提供 `dev`、`build`、`preview`。
- Vite 将 `public/xddh.user.js` 作为静态资源复制，不执行 TypeScript 编译或源码检查。
- 已验证：`npm run build` 通过；`node --check public/xddh.user.js` 通过。

## 实施 TODO

- [x] 配置 `vite-plugin-monkey`，项目模板迁移为 `vanilla-ts`。
- [x] 将 userscript metadata 迁移到 Vite 配置。
- [x] 将 `public/xddh.user.js` 迁移为 TypeScript 入口并输出单个 `.user.js`。
- [x] 删除 `FORCE_REQUIRE_TARGET` 永久不可达分支。
- [x] 消除重复词库应用和重复空词库校验。
- [x] 修复无效 active wordlist ID 持久化。
- [x] 修复 IndexedDB rejected promise 无法重试。
- [x] 清理词库初始化超时定时器。
- [x] 按 storage、wordlist、webpack hook、panel UI、word renderer、bootstrap 拆分模块。
- [x] 优化 `MutationObserver`，仅处理新增节点并合并帧调度。
- [x] 构建并验证生成的 userscript metadata、授权和运行行为。

## 约束

- 禁止调用 subagent。
- 最终产物保持单个可安装 `.user.js`。
- 不处理额外 test、lint 等工程保障项，除非后续明确要求。
