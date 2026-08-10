// ==UserScript==
// @name         行动代号自定义词库
// @namespace    https://xddh.koolshow.top
// @version      1.1.0
// @description  hullqin xddh替换默认词库, 支持链接与直接输入
// @match        https://game.hullqin.cn/xddh/*
// @run-at       document-start
// @sandbox      raw
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @connect      *
// @resource     TAILWIND_CSS https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css
// ==/UserScript==

(() => {
    const W = unsafeWindow;

    /**
     * 根据你提供的代码：
     *
     * (self.webpackChunkgame =
     *     self.webpackChunkgame || []).push(...)
     */
    const CHUNK_GLOBAL = 'webpackChunkgame';

    const EXPORT_NAME = 'C';

    const WRAPPED_PUSH = Symbol('xddhWrappedPush');
    const PATCHED_FACTORY = Symbol('xddhPatchedFactory');
    const PATCHED_CHUNK_LOAD = Symbol('xddhPatchedChunkLoad');

    const seenChunks = new WeakSet();
    const patchedFactories = new WeakSet();
    const seenResourceUrls = new Set();

    /**
     * 所有运行结果都可以从控制台读取：
     *
     * window.__xddhWebpackHook
     */
    const state = {
        resources: [],
        chunks: [],
        candidates: [],
        target: null,

        webpackRequire: null,
        runtimeCaptured: false,
        runtimeRecoveryCount: 0,

        installInfo: {
            time: performance.now(),
            readyState: document.readyState,
            queueAlreadyExisted: false,
            existingChunkCount: 0
        }
    };

    W.__xddhWebpackHook = state;

    const FORCE_REQUIRE_TARGET = true;

    const DB_NAME = 'xddh-custom-wordlist';
    const DB_VERSION = 1;
    const STORE_WORDLISTS = 'wordlists';
    const STORE_META = 'meta';
    const ACTIVE_KEY = 'activeWordlistId';

    let dbPromise = null;
    let activeWordlist = null;

    let wordListReady = false;
    let resolveWordListReady = null;

    const wordListReadyPromise =
        new Promise(resolve => {
            resolveWordListReady = resolve;
        });

    let wordListUI = null;
    let runtimeCaptureQueued = false;

    function normalizeWordText(text) {
        return String(text ?? '')
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .map(word => word.trim())
            .filter(Boolean);
    }

    function openWordListDb() {
        if (dbPromise) {
            return dbPromise;
        }

        dbPromise = new Promise((resolve, reject) => {
            if (!W.indexedDB) {
                reject(new Error('当前环境不支持 IndexedDB'));
                return;
            }

            const request =
                W.indexedDB.open(
                    DB_NAME,
                    DB_VERSION
                );

            request.onupgradeneeded = () => {
                const db = request.result;

                if (
                    !db.objectStoreNames.contains(
                        STORE_WORDLISTS
                    )
                ) {
                    db.createObjectStore(
                        STORE_WORDLISTS,
                        { keyPath: 'id' }
                    );
                }

                if (
                    !db.objectStoreNames.contains(
                        STORE_META
                    )
                ) {
                    db.createObjectStore(
                        STORE_META,
                        { keyPath: 'key' }
                    );
                }
            };

            request.onsuccess = () =>
                resolve(request.result);

            request.onerror = () =>
                reject(request.error);
        });

        return dbPromise;
    }

    function dbRequest(
        storeName,
        mode,
        operation
    ) {
        return openWordListDb().then(db =>
            new Promise((resolve, reject) => {
                const transaction =
                    db.transaction(
                        storeName,
                        mode
                    );

                const store =
                    transaction.objectStore(
                        storeName
                    );

                const request =
                    operation(store);

                request.onsuccess = () =>
                    resolve(request.result);

                request.onerror = () =>
                    reject(request.error);
            })
        );
    }

    function dbGetAllWordlists() {
        return dbRequest(
            STORE_WORDLISTS,
            'readonly',
            store => store.getAll()
        );
    }

    function dbPutWordlist(record) {
        return dbRequest(
            STORE_WORDLISTS,
            'readwrite',
            store => store.put(record)
        );
    }

    function dbDeleteWordlist(id) {
        return dbRequest(
            STORE_WORDLISTS,
            'readwrite',
            store => store.delete(id)
        );
    }

    function dbGetActiveId() {
        return dbRequest(
            STORE_META,
            'readonly',
            store => store.get(ACTIVE_KEY)
        ).then(row => row?.value ?? null);
    }

    function dbSetActiveId(id) {
        return dbRequest(
            STORE_META,
            'readwrite',
            store => store.put({
                key: ACTIVE_KEY,
                value: id
            })
        );
    }

    function getActiveWordlist() {
        return activeWordlist;
    }

    function deriveWordlistNameFromUrl(url) {
        try {
            let filename =
                new URL(url).pathname
                    .split('/')
                    .pop() || '';

            try {
                filename =
                    decodeURIComponent(filename);
            } catch {
                // 保留原始文件名
            }

            const base =
                filename.replace(
                    /\.[^.]*$/,
                    ''
                ) || filename;

            return base || '网址词库';
        } catch {
            return '网址词库';
        }
    }

    function pickUniqueName(
        lists,
        preferred
    ) {
        if (
            !lists.some(
                list => list.name === preferred
            )
        ) {
            return preferred;
        }

        let index = 2;

        while (
            lists.some(
                list =>
                    list.name ===
                    `${preferred} (${index})`
            )
        ) {
            index += 1;
        }

        return `${preferred} (${index})`;
    }

    async function addWordlist({
        name,
        words,
        source
    }) {
        const normalizedWords = words
        .map(word => String(word).trim())
        .filter(Boolean);

        if (normalizedWords.length === 0) {
            throw new Error('词库中没有有效内容');
        }

        const lists =
            await dbGetAllWordlists();

        const record = {
            id:
                `wl-${Date.now().toString(36)}-${Math.random()
                    .toString(36)
                    .slice(2)}`,
            name: pickUniqueName(
                lists,
                name
            ),
            words: normalizedWords,
            source,
            updatedAt: Date.now()
        };

        await dbPutWordlist(record);

        activeWordlist = record;

        await dbSetActiveId(record.id);

        applyStoredWordListToCurrentTarget();

        return record;
    }

    async function selectWordlist(id) {
        if (id) {
            const lists =
                await dbGetAllWordlists();

            activeWordlist =
                lists.find(
                    list => list.id === id
                ) ?? null;

            await dbSetActiveId(id);
        } else {
            activeWordlist = null;
            await dbSetActiveId(null);
        }

        applyStoredWordListToCurrentTarget();

        return activeWordlist;
    }

    async function deleteWordlist(id) {
        await dbDeleteWordlist(id);

        if (activeWordlist?.id === id) {
            activeWordlist = null;
            await dbSetActiveId(null);
            applyStoredWordListToCurrentTarget();
        }
    }

    async function initWordListStorage() {
        setTimeout(() => {
            if (!wordListReady) {
                wordListReady = true;
                resolveWordListReady?.();
            }
        }, 8000);

        try {
            const activeId =
                await dbGetActiveId();

            if (activeId) {
                const lists =
                    await dbGetAllWordlists();

                activeWordlist =
                    lists.find(
                        list => list.id === activeId
                    ) ?? null;
            }
        } catch (error) {
            console.error(
                '[XDDH Hook] 读取 IndexedDB 词库失败',
                error
            );
        }

        applyStoredWordListToCurrentTarget();
        wordListUI?.refresh?.();

        wordListReady = true;
        resolveWordListReady?.();
    }

    /**
     * 将词库调整到指定长度。
     *
     * 少于目标数量：循环复制。
     * 多于目标数量：只取前面的内容。
     */
    function resizeWordList(
    words,
     targetLength
    ) {
        if (
            !Array.isArray(words) ||
            words.length === 0 ||
            targetLength <= 0
        ) {
            return [];
        }

        return Array.from(
            {
                length: targetLength
            },
            (_, index) =>
            words[index % words.length]
        );
    }

    function applyStoredWordListToCurrentTarget() {
        const target = state.target;

        if (
            !target ||
            !Array.isArray(target.originalN) ||
            !Array.isArray(target.replacementN)
        ) {
            return false;
        }

        const nextWords =
              buildReplacementN(
                  target.originalN
              );

        copyArray(
            target.replacementN,
            nextWords
        );

        console.info(
            '[XDDH Hook] 已应用本地词库',
            {
                originalLength:
                target.originalN.length,
                replacementLength:
                target.replacementN.length
            }
        );

        return true;
    }

    function requestText(url) {
        return new Promise(
            (resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: 20000,

                    onload(response) {
                        if (
                            response.status >= 200 &&
                            response.status < 300
                        ) {
                            resolve(
                                response.responseText
                            );

                            return;
                        }

                        reject(
                            new Error(
                                `请求失败：HTTP ${response.status}`
                            )
                        );
                    },

                    onerror() {
                        reject(
                            new Error(
                                '网络请求失败'
                            )
                        );
                    },

                    ontimeout() {
                        reject(
                            new Error(
                                '请求超时'
                            )
                        );
                    }
                });
            }
        );
    }

    const nativeFunctionToString =
        W.Function.prototype.toString;

    function getFunctionSource(fn) {
        try {
            return Reflect.apply(
                nativeFunctionToString,
                fn,
                []
            );
        } catch {
            return '';
        }
    }

    function compactSource(fn) {
        return getFunctionSource(fn)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\r\n]*/g, '')
            .replace(/\s+/g, '');
    }

    function escapeRegExp(value) {
        return value.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );
    }

    function countMatches(source, pattern) {
        return (source.match(pattern) || []).length;
    }

    /**
     * 根据你给出的 1993 模块建立结构指纹。
     *
     * 目标特征：
     *
     * 1. 通过 e.d 导出 C；
     * 2. C 的 getter 返回某个局部变量；
     * 3. 这个局部变量初始化为空数组；
     * 4. 至少两个 forEach；
     * 5. 至少两个 slice；
     * 6. 至少两次向导出数组 push。
     *
     * 不要求局部变量仍然叫 n。
     */
    function identifyTargetFactory(factory) {
        const source = compactSource(factory);

        if (!source) {
            return null;
        }

        let exportMatch = source.match(
            /(?:C|["']C["']):function\(\)\{return([A-Za-z_$][\w$]*)\}/
        );

        // 兼容可能出现的箭头函数形式：C:()=>n
        if (!exportMatch) {
            exportMatch = source.match(
                /(?:C|["']C["']):\(\)=>([A-Za-z_$][\w$]*)/
            );
        }

        if (!exportMatch) {
            return null;
        }

        const accumulatorName = exportMatch[1];
        const escapedName =
            escapeRegExp(accumulatorName);

        let score = 0;
        const reasons = [];

        if (
            new RegExp(
                `(?:var|let|const)${escapedName}=\\[\\]`
            ).test(source)
        ) {
            score += 5;
            reasons.push('导出变量初始化为空数组');
        }

        const forEachCount =
            countMatches(source, /\.forEach\(/g);

        if (forEachCount >= 2) {
            score += 3;
            reasons.push(`forEach × ${forEachCount}`);
        }

        const sliceCount =
            countMatches(source, /\.slice\(/g);

        if (sliceCount >= 2) {
            score += 3;
            reasons.push(`slice × ${sliceCount}`);
        }

        const pushCount = countMatches(
            source,
            new RegExp(
                `${escapedName}\\.push\\(`,
                'g'
            )
        );

        if (pushCount >= 2) {
            score += 5;
            reasons.push(
                `${accumulatorName}.push × ${pushCount}`
            );
        }

        const forCount =
            countMatches(source, /for\(/g);

        if (forCount >= 2) {
            score += 2;
            reasons.push(`for 循环 × ${forCount}`);
        }

        if (/\.d\([^,]+,\{/.test(source)) {
            score += 2;
            reasons.push('Webpack e.d 导出');
        }

        /*
         * 分数不够时不自动修改，避免误伤。
         */
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

    function buildReplacementN(originalN) {
        if (!Array.isArray(originalN)) {
            return [];
        }

        const targetLength =
              originalN.length;

        if (targetLength === 0) {
            return [];
        }

        const record =
              getActiveWordlist();

        /*
     * 未导入本地词库时，继续使用游戏原词库。
     */
        if (
            !record ||
            record.words.length === 0
        ) {
            return originalN.slice();
        }

        return resizeWordList(
            record.words,
            targetLength
        );
    }

    function copyArray(target, source) {
        target.length = 0;

        for (const item of source) {
            target.push(item);
        }
    }

    /**
     * 包裹目标模块 factory。
     *
     * 注意：这里不是直接修改局部变量 n，
     * 而是修改 e.d 注册的 C 导出 getter。
     */
    function createPatchedFactory(
        moduleId,
        originalFactory,
        signature
    ) {
        function patchedFactory(
            module,
            exports,
            webpackRequire
        ) {
            /*
             * 使用稳定的占位数组。
             *
             * 即使存在循环依赖，提前读取 exports.C
             * 也能得到同一个数组引用。
             */
            const replacementN = [];

            let originalGetter = null;
            let originalN;

            const originalDefineExports =
                webpackRequire.d;

            if (
                typeof originalDefineExports !==
                'function'
            ) {
                console.warn(
                    '[XDDH Hook] webpackRequire.d 不存在',
                    {
                        moduleId,
                        webpackRequire
                    }
                );

                return Reflect.apply(
                    originalFactory,
                    this,
                    [
                        module,
                        exports,
                        webpackRequire
                    ]
                );
            }

            /*
             * 不修改全局 webpackRequire.d。
             *
             * 只给当前目标 factory 传入一个 Proxy，
             * 影响范围限定在当前模块。
             */
            const requireProxy = new Proxy(
                webpackRequire,
                {
                    apply(target, thisArg, args) {
                        return Reflect.apply(
                            target,
                            thisArg,
                            args
                        );
                    },

                    get(target, property, receiver) {
                        if (property !== 'd') {
                            return Reflect.get(
                                target,
                                property,
                                receiver
                            );
                        }

                        return function defineExportsHook(
                            ...defineArgs
                        ) {
                            const [
                                exportObject,
                                definitions
                            ] = defineArgs;

                            if (
                                exportObject === exports &&
                                definitions &&
                                typeof definitions[
                                    EXPORT_NAME
                                ] === 'function'
                            ) {
                                originalGetter =
                                    definitions[
                                        EXPORT_NAME
                                    ];

                                const patchedDefinitions = {
                                    ...definitions,

                                    /*
                                     * 原来是：
                                     *
                                     * C: function () {
                                     *     return n;
                                     * }
                                     *
                                     * 现在改为返回 replacementN。
                                      */
                                    [EXPORT_NAME]:
                                        () => replacementN
                                };

                                console.log(
                                    '[XDDH Hook] 已拦截 C 导出',
                                    {
                                        moduleId,
                                        originalGetter
                                    }
                                );

                                return Reflect.apply(
                                    originalDefineExports,
                                    target,
                                    [
                                        exportObject,
                                        patchedDefinitions
                                    ]
                                );
                            }

                            return Reflect.apply(
                                originalDefineExports,
                                target,
                                defineArgs
                            );
                        };
                    }
                }
            );

            /*
             * 执行原始模块。
             *
             * 模块内部仍然构建自己的局部变量 n。
             */
            const result = Reflect.apply(
                originalFactory,
                this,
                [
                    module,
                    exports,
                    requireProxy
                ]
            );

            /*
             * 原 getter 仍然闭包引用局部变量 n，
             * 所以模块执行结束后可以调用它取得原始 n。
             */
            if (originalGetter) {
                try {
                    originalN = Reflect.apply(
                        originalGetter,
                        undefined,
                        []
                    );
                } catch (error) {
                    console.error(
                        '[XDDH Hook] 读取原始 n 失败',
                        error
                    );
                }
            }

            let generatedReplacement;

            try {
                generatedReplacement =
                    buildReplacementN(originalN);
            } catch (error) {
                console.error(
                    '[XDDH Hook] 生成替代 n 失败',
                    error
                );

                generatedReplacement =
                    Array.isArray(originalN)
                        ? originalN
                        : [];
            }

            if (
                !Array.isArray(
                    generatedReplacement
                )
            ) {
                throw new TypeError(
                    'buildReplacementN 必须返回数组'
                );
            }

            /*
             * 保持 replacementN 引用不变，
             * 只填充内容。
             */
            copyArray(
                replacementN,
                generatedReplacement
            );

            state.target = {
                moduleId,
                signature,
                originalFactory,
                originalGetter,
                originalN,
                replacementN,
                exports
            };

            console.log(
                '[XDDH Hook] 目标模块执行完成',
                {
                    moduleId,
                    originalN,
                    replacementN,
                    exportedC: exports.C,
                    sameReference:
                        exports.C === replacementN
                }
            );

            return result;
        }

        Object.defineProperty(
            patchedFactory,
            PATCHED_FACTORY,
            {
                value: {
                    moduleId,
                    signature,
                    originalFactory
                }
            }
        );

        patchedFactories.add(originalFactory);
        patchedFactories.add(patchedFactory);

        return patchedFactory;
    }

    function patchTargetFactory(
        modules,
        moduleId,
        factory,
        signature
    ) {
        if (
            typeof factory !== 'function' ||
            factory[PATCHED_FACTORY] ||
            patchedFactories.has(factory)
        ) {
            return false;
        }

        modules[moduleId] =
            createPatchedFactory(
                moduleId,
                factory,
                signature
            );

        console.info(
            '[XDDH Hook] 已替换目标 factory',
            {
                moduleId,
                score: signature.score,
                accumulatorName:
                    signature.accumulatorName,
                reasons: signature.reasons
            }
        );

        return true;
    }

    function patchExecutedModuleExports(
        moduleId,
        exportsObject,
        signature,
        originalFactory
    ) {
        if (
            !exportsObject ||
            !Array.isArray(
                exportsObject[EXPORT_NAME]
            )
        ) {
            return false;
        }

        const exportedC =
            exportsObject[EXPORT_NAME];

        if (
            state.target &&
            state.target.moduleId === moduleId &&
            state.target.replacementN === exportedC
        ) {
            console.info(
                '[XDDH Hook] 目标 factory 已执行，无需缓存恢复',
                {
                    moduleId
                }
            );

            return true;
        }

        const originalN =
            exportedC.slice();

        let replacementN;

        try {
            replacementN =
                buildReplacementN(originalN);
        } catch (error) {
            console.error(
                '[XDDH Hook] 缓存恢复时生成替代词库失败',
                error
            );

            replacementN =
                originalN.slice();
        }

        if (!Array.isArray(replacementN)) {
            console.error(
                '[XDDH Hook] 缓存恢复结果不是数组',
                {
                    moduleId,
                    replacementN
                }
            );

            return false;
        }

        copyArray(
            exportedC,
            replacementN
        );

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

        console.info(
            '[XDDH Hook] 已原地修改缓存模块的 C 数组',
            {
                moduleId,
                originalLength:
                    originalN.length,
                replacementLength:
                    exportedC.length,
                sameReference:
                    exportsObject[EXPORT_NAME] ===
                    exportedC
            }
        );

        wordListUI?.refresh?.();

        return true;
    }

    function installChunkLoadGate(
        webpackRequire
    ) {
        const originalChunkLoad =
            webpackRequire.e;

        if (
            typeof originalChunkLoad !==
                'function' ||
            originalChunkLoad[
                PATCHED_CHUNK_LOAD
            ]
        ) {
            return;
        }

        webpackRequire.e =
            function (...chunkIds) {
                return wordListReadyPromise.then(
                    () =>
                        originalChunkLoad.apply(
                            this,
                            chunkIds
                        )
                );
            };

        Object.defineProperty(
            webpackRequire.e,
            PATCHED_CHUNK_LOAD,
            { value: true }
        );

        console.info(
            '[XDDH Hook] 已包装 chunk 加载函数，等待词库就绪'
        );
    }

    function recoverFromWebpackRuntime(
        webpackRequire
    ) {
        if (
            typeof webpackRequire !==
                'function' ||
            !webpackRequire.m ||
            typeof webpackRequire.m !==
                'object'
        ) {
            console.warn(
                '[XDDH Hook] 捕获到的 Webpack require 无效',
                webpackRequire
            );

            return false;
        }

        state.webpackRequire =
            webpackRequire;
        state.runtimeCaptured = true;
        state.runtimeRecoveryCount += 1;

        const runtimeModules =
            webpackRequire.m;

        const candidates = [];

        for (
            const [moduleId, factory]
            of Object.entries(runtimeModules)
        ) {
            if (typeof factory !== 'function') {
                continue;
            }

            const patchedMetadata =
                factory[PATCHED_FACTORY];

            if (
                patchedMetadata &&
                typeof patchedMetadata ===
                    'object' &&
                patchedMetadata.moduleId
            ) {
                candidates.push({
                    moduleId,
                    factory,
                    signature:
                        patchedMetadata.signature,
                    originalFactory:
                        patchedMetadata.originalFactory,
                    alreadyPatched: true
                });

                continue;
            }

            const signature =
                identifyTargetFactory(factory);

            if (!signature) {
                continue;
            }

            candidates.push({
                moduleId,
                factory,
                originalFactory: factory,
                signature,
                alreadyPatched: false
            });
        }

        const selected =
            selectTargetCandidate(
                candidates,
                'webpackRequire.m'
            );

        if (!selected) {
            console.info(
                '[XDDH Hook] 运行时模块表中暂未发现目标',
                {
                    moduleCount:
                        Object.keys(
                            runtimeModules
                        ).length
                }
            );

            return false;
        }

        const {
            moduleId,
            signature
        } = selected;

        if (!selected.alreadyPatched) {
            runtimeModules[moduleId] =
                createPatchedFactory(
                    moduleId,
                    selected.factory,
                    signature
                );

            console.info(
                '[XDDH Hook] 已修改 Webpack 运行时模块表',
                {
                    moduleId,
                    score:
                        signature.score
                }
            );
        } else {
            console.info(
                '[XDDH Hook] 运行时模块表中的目标已被包装',
                {
                    moduleId
                }
            );
        }

        const cachedModule =
            webpackRequire.c?.[moduleId];

        if (
            cachedModule &&
            patchExecutedModuleExports(
                moduleId,
                cachedModule.exports,
                signature,
                selected.originalFactory
            )
        ) {
            return true;
        }

        if (!FORCE_REQUIRE_TARGET) {
            console.info(
                '[XDDH Hook] 已修改运行时 factory，等待游戏执行目标模块',
                {
                    moduleId
                }
            );

            return true;
        }

        let exportsObject;

        try {
            exportsObject =
                webpackRequire(moduleId);
        } catch (error) {
            console.error(
                '[XDDH Hook] 主动执行目标模块失败',
                {
                    moduleId,
                    error
                }
            );

            return false;
        }

        if (
            state.target &&
            state.target.moduleId === moduleId &&
            state.target.replacementN ===
                exportsObject?.[EXPORT_NAME]
        ) {
            console.info(
                '[XDDH Hook] 目标模块已通过修改后的 factory 执行',
                {
                    moduleId
                }
            );

            return true;
        }

        return patchExecutedModuleExports(
            moduleId,
            exportsObject,
            signature,
            selected.originalFactory
        );
    }

    function queueWebpackRuntimeCapture(queue) {
        if (runtimeCaptureQueued) {
            return;
        }

        runtimeCaptureQueued = true;

        const runtimeChunkId =
            `xddh-runtime-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`;

        const runtimeChunk = [
            [runtimeChunkId],
            {},
            webpackRequire => {
                console.info(
                    '[XDDH Hook] 已捕获 Webpack Runtime',
                    {
                        runtimeChunkId,
                        moduleCount:
                            Object.keys(
                                webpackRequire.m || {}
                            ).length
                    }
                );

                installChunkLoadGate(
                    webpackRequire
                );

                wordListReadyPromise.then(() => {
                    recoverFromWebpackRuntime(
                        webpackRequire
                    );
                });
            }
        ];

        queue.push(runtimeChunk);

        console.info(
            '[XDDH Hook] 已提交 Runtime 捕获 chunk',
            {
                runtimeChunkId
            }
        );
    }

    function getCurrentScriptUrl() {
        try {
            return document.currentScript?.src || '';
        } catch {
            return '';
        }
    }

    function isXddhChunkUrl(url) {
        return /(?:^|\/)xddh\.[^/?#]+\.chunk\.js(?:[?#]|$)/i
            .test(url);
    }

    function selectTargetCandidate(
        candidates,
        sourceLabel
    ) {
        if (!Array.isArray(candidates)) {
            return null;
        }

        if (candidates.length === 1) {
            return candidates[0];
        }

        if (candidates.length === 0) {
            return null;
        }

        const knownCandidate =
            candidates.find(
                candidate =>
                    candidate.moduleId === '1993'
            );

        if (knownCandidate) {
            console.info(
                '[XDDH Hook] 多候选时使用已知模块 ID',
                {
                    sourceLabel,
                    moduleId:
                        knownCandidate.moduleId
                }
            );

            return knownCandidate;
        }

        console.warn(
            '[XDDH Hook] 存在多个候选模块，拒绝自动选择',
            {
                sourceLabel,
                candidates
            }
        );

        return null;
    }

    /**
     * 每次 Webpack chunk 调用 push 时执行。
     */
    function inspectChunk(chunkData) {
        if (
            !Array.isArray(chunkData) ||
            seenChunks.has(chunkData)
        ) {
            return;
        }

        seenChunks.add(chunkData);

        const chunkIds = chunkData[0];
        const modules = chunkData[1];

        if (
            !modules ||
            typeof modules !== 'object'
        ) {
            return;
        }

        const moduleIds =
            Object.keys(modules);

        const scriptUrl =
            getCurrentScriptUrl();

        const record = {
            time: performance.now(),
            scriptUrl,
            isXddhChunk:
                isXddhChunkUrl(scriptUrl),
            chunkIds: Array.isArray(chunkIds)
                ? chunkIds.slice()
                : [chunkIds],
            moduleIds
        };

        state.chunks.push(record);

        console.groupCollapsed(
            `[XDDH Hook] chunk ${record.chunkIds.join(', ')}，模块数 ${moduleIds.length}`
        );

        console.log('脚本地址：', scriptUrl);
        console.log('Chunk IDs：', record.chunkIds);
        console.log('Module IDs：', moduleIds);

        console.groupEnd();

        const candidates = [];

        for (
            const [moduleId, factory]
            of Object.entries(modules)
        ) {
            if (
                typeof factory !== 'function' ||
                factory[PATCHED_FACTORY]
            ) {
                continue;
            }

            const signature =
                identifyTargetFactory(factory);

            if (!signature) {
                continue;
            }

            const candidate = {
                moduleId,
                factory,
                signature,
                chunkIds: record.chunkIds,
                scriptUrl
            };

            candidates.push(candidate);
            state.candidates.push(candidate);

            console.info(
                '[XDDH Hook] 找到候选模块',
                {
                    moduleId,
                    score: signature.score,
                    localAccumulator:
                        signature.accumulatorName,
                    reasons:
                        signature.reasons,
                    scriptUrl
                }
            );
        }

        const selected =
            selectTargetCandidate(
                candidates,
                'chunk'
            );

        if (selected) {
            patchTargetFactory(
                modules,
                selected.moduleId,
                selected.factory,
                selected.signature
            );

            if (state.webpackRequire) {
                installChunkLoadGate(
                    state.webpackRequire
                );

                queueMicrotask(() => {
                    wordListReadyPromise.then(() => {
                        recoverFromWebpackRuntime(
                            state.webpackRequire
                        );
                    });
                });
            }
        }
    }

    function wrapPush(pushFunction) {
        if (
            typeof pushFunction !== 'function' ||
            pushFunction[WRAPPED_PUSH]
        ) {
            return pushFunction;
        }

        function interceptedPush(...chunks) {
            for (const chunk of chunks) {
                inspectChunk(chunk);
            }

            return Reflect.apply(
                pushFunction,
                this,
                chunks
            );
        }

        Object.defineProperty(
            interceptedPush,
            WRAPPED_PUSH,
            {
                value: true
            }
        );

        return interceptedPush;
    }

    function installWebpackInterceptor() {
        const queueAlreadyExisted =
            Array.isArray(
                W[CHUNK_GLOBAL]
            );

        const queue =
            W[CHUNK_GLOBAL] || [];

        W[CHUNK_GLOBAL] = queue;

        if (!Array.isArray(queue)) {
            throw new TypeError(
                `${CHUNK_GLOBAL} 不是数组`
            );
        }

        const existingChunks =
            queue.slice();

        state.installInfo = {
            time: performance.now(),
            readyState:
                document.readyState,
            queueAlreadyExisted,
            existingChunkCount:
                existingChunks.length
        };

        let activePush =
            wrapPush(queue.push);

        Object.defineProperty(
            queue,
            'push',
            {
                configurable: true,

                get() {
                    return activePush;
                },

                set(nextPush) {
                    activePush =
                        wrapPush(nextPush);

                    console.info(
                        '[XDDH Hook] Webpack 更新了 push，已重新包装',
                        {
                            functionName:
                                nextPush?.name || ''
                        }
                    );
                }
            }
        );

        console.info(
            `[XDDH Hook] 已监听 ${CHUNK_GLOBAL}.push`,
            state.installInfo
        );

        for (const chunk of existingChunks) {
            inspectChunk(chunk);
        }

        queueWebpackRuntimeCapture(queue);
    }

    /**
     * 补充记录浏览器加载到的 xddh.*.chunk.js URL。
     *
     * 这只用于资源日志；
     * 真正的模块捕获由 webpackChunkgame.push 完成。
     */
    function recordResourceUrl(url) {
        if (
            !url ||
            !isXddhChunkUrl(url) ||
            seenResourceUrls.has(url)
        ) {
            return;
        }

        seenResourceUrls.add(url);
        state.resources.push(url);

        console.info(
            '[XDDH Hook] 浏览器加载了 chunk：',
            url
        );
    }

    function installResourceObserver() {
        try {
            for (
                const entry
                of performance.getEntriesByType(
                    'resource'
                )
            ) {
                recordResourceUrl(entry.name);
            }

            const observer =
                new PerformanceObserver(list => {
                    for (
                        const entry
                        of list.getEntries()
                    ) {
                        recordResourceUrl(
                            entry.name
                        );
                    }
                });

            observer.observe({
                type: 'resource',
                buffered: true
            });
        } catch (error) {
            console.warn(
                '[XDDH Hook] ResourceObserver 不可用',
                error
            );
        }
    }

function installWordListPanel() {
    const install = () => {
        if (
            document.getElementById(
                'xddh-word-list-panel-host'
            )
        ) {
            return;
        }

        const host =
            document.createElement('div');

        host.id =
            'xddh-word-list-panel-host';

        Object.assign(
            host.style,
            {
                position: 'fixed',
                right: '16px',
                bottom: '16px',
                zIndex: '2147483647',
                width:
                    'min(384px, calc(100vw - 32px))',
                pointerEvents: 'none'
            }
        );

        const shadow =
            host.attachShadow({
                mode: 'open'
            });

        const tailwindStyle =
            document.createElement('style');

        tailwindStyle.textContent =
            GM_getResourceText(
                'TAILWIND_CSS'
            );

        shadow.appendChild(
            tailwindStyle
        );

        const container =
            document.createElement('div');

        container.className =
            'flex flex-col items-end space-y-3';

        container.style.pointerEvents =
            'auto';

        container.innerHTML = `
            <section
                id="xddh-word-panel"
                class="hidden w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
            >
                <header class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                    <div>
                        <h2 class="text-base font-semibold text-gray-900">
                            自定义词库
                        </h2>
                        <p class="mt-1 text-xs text-gray-500">
                            导入内容会保存在浏览器本地
                        </p>
                    </div>

                    <button
                        id="xddh-close-panel"
                        type="button"
                        class="rounded-md px-2 py-1 text-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        aria-label="关闭"
                    >
                        ×
                    </button>
                </header>

                <div class="space-y-4 p-4">
                    <div class="rounded-lg bg-gray-50 p-3 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-500">
                                本地词库
                            </span>
                            <span
                                id="xddh-stored-count"
                                class="font-medium text-gray-900"
                            >
                                0
                            </span>
                        </div>

                        <div class="mt-1 flex justify-between">
                            <span class="text-gray-500">
                                游戏词库长度
                            </span>
                            <span
                                id="xddh-target-count"
                                class="font-medium text-gray-900"
                            >
                                等待模块
                            </span>
                        </div>

                        <div class="mt-1 flex items-start justify-between gap-3">
                            <span class="shrink-0 text-gray-500">
                                来源
                            </span>
                            <span
                                id="xddh-source"
                                class="break-all text-right font-medium text-gray-900"
                            >
                                游戏原词库
                            </span>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label
                            for="xddh-wordlist-select"
                            class="block text-sm font-medium text-gray-700"
                        >
                            选择词库
                        </label>

                        <select
                            id="xddh-wordlist-select"
                            class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        ></select>
                    </div>

                    <div class="space-y-2">
                        <label
                            for="xddh-word-url"
                            class="block text-sm font-medium text-gray-700"
                        >
                            从网址导入
                        </label>

                        <input
                            id="xddh-word-url"
                            type="url"
                            placeholder="https://example.com/words.txt"
                            class="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        >

                        <button
                            id="xddh-import-url"
                            type="button"
                            class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            从网址导入
                        </button>
                    </div>

                    <div class="flex items-center gap-3">
                        <div class="h-px flex-1 bg-gray-200"></div>
                        <span class="text-xs text-gray-400">
                            或
                        </span>
                        <div class="h-px flex-1 bg-gray-200"></div>
                    </div>

                    <div class="space-y-2">
                        <label
                            for="xddh-word-text"
                            class="block text-sm font-medium text-gray-700"
                        >
                            粘贴词库
                        </label>

                        <textarea
                            id="xddh-word-text"
                            rows="7"
                            placeholder="一行一个词&#10;苹果&#10;香蕉&#10;西瓜"
                            class="block w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        ></textarea>

                        <button
                            id="xddh-import-text"
                            type="button"
                            class="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
                        >
                            导入粘贴内容
                        </button>
                    </div>

                    <button
                        id="xddh-reset-words"
                        type="button"
                        class="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                    >
                        删除当前词库并恢复默认
                    </button>

                    <p
                        id="xddh-word-status"
                        class="min-h-5 text-sm text-gray-500"
                    ></p>

                    <p class="text-xs leading-5 text-gray-400">
                        导入后会立即修改当前导出数组。游戏已经缓存词库时，刷新页面后可确保全部生效。
                    </p>
                </div>
            </section>

            <button
                id="xddh-toggle-panel"
                type="button"
                class="rounded-full bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-xl hover:bg-black"
            >
                词库
            </button>
        `;

        shadow.appendChild(
            container
        );

        document.documentElement.appendChild(
            host
        );

        const panel =
            shadow.getElementById(
                'xddh-word-panel'
            );

        const toggleButton =
            shadow.getElementById(
                'xddh-toggle-panel'
            );

        const closeButton =
            shadow.getElementById(
                'xddh-close-panel'
            );

        const urlInput =
            shadow.getElementById(
                'xddh-word-url'
            );

        const textInput =
            shadow.getElementById(
                'xddh-word-text'
            );

        const importUrlButton =
            shadow.getElementById(
                'xddh-import-url'
            );

        const importTextButton =
            shadow.getElementById(
                'xddh-import-text'
            );

        const resetButton =
            shadow.getElementById(
                'xddh-reset-words'
            );

        const wordlistSelect =
            shadow.getElementById(
                'xddh-wordlist-select'
            );

        const storedCount =
            shadow.getElementById(
                'xddh-stored-count'
            );

        const targetCount =
            shadow.getElementById(
                'xddh-target-count'
            );

        const sourceElement =
            shadow.getElementById(
                'xddh-source'
            );

        const statusElement =
            shadow.getElementById(
                'xddh-word-status'
            );

        function setStatus(
            message,
            type = 'normal'
        ) {
            statusElement.textContent =
                message;

            const classNames = {
                normal:
                    'min-h-5 text-sm text-gray-500',

                success:
                    'min-h-5 text-sm text-green-600',

                error:
                    'min-h-5 text-sm text-red-600'
            };

            statusElement.className =
                classNames[type] ??
                classNames.normal;
        }

        async function refresh() {
            let lists = [];

            try {
                lists = await dbGetAllWordlists();
            } catch (error) {
                console.error(
                    '[XDDH Hook] 读取词库列表失败',
                    error
                );
            }

            wordlistSelect.innerHTML = '';

            const defaultOption =
                document.createElement('option');

            defaultOption.value = '';
            defaultOption.textContent =
                '默认词库（游戏原词库）';

            wordlistSelect.appendChild(
                defaultOption
            );

            for (const list of lists) {
                const option =
                    document.createElement('option');

                option.value = list.id;
                option.textContent = list.name;

                wordlistSelect.appendChild(
                    option
                );
            }

            wordlistSelect.value =
                activeWordlist?.id ?? '';

            storedCount.textContent =
                String(
                    activeWordlist?.words.length ?? 0
                );

            targetCount.textContent =
                state.target?.originalN
                    ?.length != null
                    ? String(
                        state.target
                            .originalN
                            .length
                    )
                    : '等待模块';

            if (!activeWordlist) {
                sourceElement.textContent =
                    '游戏原词库';

                return;
            }

            if (
                activeWordlist.source?.type ===
                'url'
            ) {
                sourceElement.textContent =
                    activeWordlist.source.value;
            } else {
                sourceElement.textContent =
                    '用户粘贴文本';
            }
        }

        async function importWords(
            name,
            words,
            source
        ) {
            if (words.length === 0) {
                throw new Error(
                    '没有读取到有效词语'
                );
            }

            const record =
                await addWordlist({
                    name,
                    words,
                    source
                });

            const applied =
                applyStoredWordListToCurrentTarget();

            refresh();

            setStatus(
                applied
                    ? `已导入「${record.name}」${words.length} 个词，并应用到当前词库`
                    : `已导入「${record.name}」${words.length} 个词，刷新页面后生效`,
                'success'
            );
        }

        toggleButton.addEventListener(
            'click',
            () => {
                panel.classList.toggle(
                    'hidden'
                );

                refresh();
            }
        );

        closeButton.addEventListener(
            'click',
            () => {
                panel.classList.add(
                    'hidden'
                );
            }
        );

        importTextButton.addEventListener(
            'click',
            async () => {
                try {
                    const words =
                        normalizeWordText(
                            textInput.value
                        );

                    await importWords(
                        `粘贴词库 ${new Date()
                            .toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                            })}`,
                        words,
                        {
                            type: 'text'
                        }
                    );
                } catch (error) {
                    setStatus(
                        error.message,
                        'error'
                    );
                }
            }
        );

        importUrlButton.addEventListener(
            'click',
            async () => {
                importUrlButton.disabled =
                    true;

                setStatus(
                    '正在下载词库……'
                );

                try {
                    const parsedUrl =
                        new URL(
                            urlInput.value.trim(),
                            W.location.href
                        );

                    if (
                        parsedUrl.protocol !==
                            'http:' &&
                        parsedUrl.protocol !==
                            'https:'
                    ) {
                        throw new Error(
                            '仅支持 HTTP 或 HTTPS 地址'
                        );
                    }

                    const text =
                        await requestText(
                            parsedUrl.href
                        );

                    const words =
                        normalizeWordText(
                            text
                        );

                    await importWords(
                        deriveWordlistNameFromUrl(
                            parsedUrl.href
                        ),
                        words,
                        {
                            type: 'url',
                            value:
                                parsedUrl.href
                        }
                    );
                } catch (error) {
                    setStatus(
                        error.message,
                        'error'
                    );
                } finally {
                    importUrlButton.disabled =
                        false;
                }
            }
        );

        wordlistSelect.addEventListener(
            'change',
            async () => {
                try {
                    await selectWordlist(
                        wordlistSelect.value
                    );

                    refresh();
                } catch (error) {
                    setStatus(
                        error.message,
                        'error'
                    );
                }
            }
        );

        resetButton.addEventListener(
            'click',
            async () => {
                if (!activeWordlist) {
                    setStatus(
                        '当前已经是默认词库',
                        'normal'
                    );

                    return;
                }

                try {
                    await deleteWordlist(
                        activeWordlist.id
                    );

                    refresh();

                    setStatus(
                        '已删除当前词库，恢复默认词库',
                        'success'
                    );
                } catch (error) {
                    setStatus(
                        error.message,
                        'error'
                    );
                }
            }
        );

        wordListUI = {
            refresh,
            setStatus
        };

        refresh();
    };

    if (document.documentElement) {
        install();
    } else {
        document.addEventListener(
            'DOMContentLoaded',
            install,
            {
                once: true
            }
        );
    }
}

function installWordButtonStyle() {
    const style = document.createElement('style');

    style.textContent = `
        .xddh-word {
            height: auto !important;
            min-height: 2.5rem;
            padding: 0.5rem 0.375rem;
            line-height: 1.2 !important;
            white-space: normal !important;
            word-break: break-all;
            overflow-wrap: anywhere;
            display: flex !important;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
        }

        :has(> .xddh-word) {
            align-self: stretch !important;
        }

        :has(> .xddh-word) > .xddh-word {
            height: 100% !important;
        }

        .xddh-word-img {
            display: block;
            width: 100%;
            height: auto;
            object-fit: contain;
        }
    `;

    document.documentElement.appendChild(style);

    function processWordElement(el) {
        if (el.dataset.xddhImg === '1') {
            return;
        }

        const raw = el.textContent;

        if (raw.indexOf('\\') === -1 &&
            raw.indexOf('[') === -1) {
            return;
        }

        el.dataset.xddhImg = '1';

        el.innerHTML = raw.replace(
            /\\(.)|\[([^\[\]]*)\]/g,
            (m, esc, url) => {
                if (esc !== undefined) {
                    return esc
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;');
                }

                return (
                    '<img class="xddh-word-img" src="' +
                    url
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;') +
                    '">'
                );
            }
        );
    }

    function processAllWordElements() {
        const words =
            document.querySelectorAll(
                '.xddh-word'
            );

        for (const w of words) {
            processWordElement(w);
        }
    }

    const observer = new MutationObserver(
        () => {
            requestAnimationFrame(
                processAllWordElements
            );
        }
    );

    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

    processAllWordElements();
}

installWebpackInterceptor();
installResourceObserver();
installWordListPanel();
installWordButtonStyle();
initWordListStorage();
})();
