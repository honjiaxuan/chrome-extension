# 冒烟清单（2.12）

改动涉及后台路由、内容脚本、设置页、自动静音状态机和 OneTab bundle，任何一项都可能静默失效
（不报错、只是“不生效”），所以每次改完按下面顺序过一遍。

## 自动化

```bash
node scripts/verify.mjs                                     # 静态：manifest 引用 / 死文件 / 版本号 / 域名一致
node scripts/unit-auto-mute.mjs                             # 自动静音状态机（纯 Node，36 项）
NODE_PATH=/home/hjx/node_modules node scripts/e2e-smoke.mjs # 真浏览器（50 项）
```

`e2e-smoke.mjs` 覆盖（50 项）：

- 扩展能以未打包形式加载、service worker 起来、manifest 版本与 package.json 一致
- `corePing` 与 manifest 版本一致（OneTab bundle 版本补丁没打歪）
- OneTab 页能初始化、options 页版本号来自 manifest
- 设置页：整页四卡片、版本渲染、关键词增删、内容过滤开关、自动静音域名增删（归一化 / 拒绝重复 / 非法输入）
- 后台：`Na` 恢复整组真的开标签、`Ba` 跨组移动并清理空组、`Da` 删除分组
- 内容脚本：wnacg 分类/关键词隐藏、标题清洗、临时解锁后还原、关掉过滤后不动页面
- 内容脚本：知乎首页带查询参数仍被拦截、问答页不拦截、SPA pushState 到首页 1 秒内被拦截
- AI 快捷键：Enter 发送、Shift/Ctrl+Enter 不发送、总开关和单站开关生效
- 自动静音（真实 `chrome.tabs` 静音状态）：帖子 URL 带查询参数自动静音、子域名静音、
  离开域名还原、回来重新静音、关标签清状态、关闭/开启功能、域名增删、`notthreads.com` 误匹配、
  service worker 被停止后重启又自动对齐

`unit-auto-mute.mjs` 覆盖（36 项）：域名归一化与误匹配、override 生命周期、
用户/其他扩展静音的所有权判定、竞态补偿、tab replacement 状态迁移。

## 手动清单（真机 Edge，10 分钟）

1. `edge://extensions` 重新加载扩展，无红色错误。
2. 右键菜单出现 OneTab 那 6 项；`Alt+Shift+1` 打开 OneTab 页。
3. 右键“仅发送当前标签”→ 该标签被关闭，OneTab 新分组里有它。
4. 打开一组里的单个标题 → 在当前窗口打开；点“恢复全部”→ 该组所有标签打开。
5. 拖一个标签到另一个分组 → 刷新 OneTab 页后位置仍然正确。
6. 删除一个分组、删除组内单个标签 → 刷新后状态保持；组空了自动消失。
7. 右键“排除此站点”/“排除此域名” → 该站点不再被收集。
8. 打开 `https://www.zhihu.com/`（带任何查询参数）→ 页面被替换成 OneTab 队列里的一条；
   队列空时打开 OneTab 页。打开一篇问答 → 正常浏览。
9. 小红书 `https://www.xiaohongshu.com/explore` 同上。
10. wnacg 列表页：同人誌/单行本/杂志分类不显示；加一个关键词 → 该关键词条目隐藏（无需刷新）；
    标题里的 `[汉化]`、`(COMIC BAVEL)` 被去掉。
11. 设置页点“临时解锁 15 分钟” → 已隐藏的条目立刻出现、标题还原成原文；15 分钟后自动恢复隐藏。
12. 设置页关掉“内容过滤” → 所有隐藏恢复；关掉“访问拦截” → 知乎首页不再被顶替。
13. ChatGPT / Gemini / Claude：Enter 发送、Shift+Enter 换行、中文输入法选词按 Enter 不发送。
    在设置页里关掉某一站 → 该站恢复原生行为。
14. missav：播放中切到别的标签，回来视频仍在播；标题不截断；右下角广告浮层消失。
15. 打开任意 Threads 页面 → 标签立刻静音。**手动点一下取消静音**，然后同站内点开另一条帖子、
    再刷新页面 → 仍然保持未静音（自动化合成不了 `reason:'user'`，这条必须真机验证）。
16. 再开一个新的 Threads 标签 → 新标签是静音的（旧的未静音标签不受影响）。
17. 在 Threads 标签里导航到别的站点 → 恢复为未静音；返回 Threads → 重新静音。
18. 设置页关闭“自动静音网站” → 现有 Threads 标签取消静音；重新打开 → 恢复静音。
    在域名列表里加 `example.org` → 打开该站点被静音；删掉 → 取消静音。
19. 浏览器完全退出再启动、恢复上次会话 → Threads 标签仍然是静音的。
20. 用户自己原本就静音的标签（右键“静音标签页”）：进入/离开配置域名都不会被扩展改回未静音。
21. 点工具栏的 HJX Extension 图标 → 在新标签打开整页设置（四个卡片、宽屏两列）；再点一次 →
    聚焦已打开的那个设置标签，不会开第二个。

## 2.13 变更摘要

- 工具栏图标不再弹 320px 的 popup：`action.default_popup` 移除，改由 background 的
  `chrome.action.onClicked` 在新标签打开 `settings.html`；已打开时聚焦原标签，不重复开。
- `popup.html/js` 更名为 `settings.html/js`，布局从 320px 单列改成整页响应式卡片（宽屏两列），
  所有控件 id 与存储键保持不变。
- 版本：manifest / package.json 升到 2.13。
- 测试：e2e 加了两项（manifest 无 default_popup、设置页四个卡片），共 52 项。

## 2.12 变更摘要

- 新增：`auto_mute.js` 域名自动静音状态机 + 设置页“自动静音网站”区块（开关、域名列表、增删）。
- 修复：popup 的 `storage.get(默认值对象)` 只返回对象里列出的键，导致新增域名后列表不刷新
  （把 `autoMuteEnabled` / `autoMuteDomains` 加进默认值）。
- 版本：manifest / package.json 升到 2.12；OneTab bundle 仍从 manifest 读版本。
- 权限：没有新增（复用 `tabs` + `storage`），没有新增 host 权限，也没有注入内容脚本。
- 工程：新增 `scripts/unit-auto-mute.mjs`；e2e 扩到 50 项，覆盖真实 `chrome.tabs` 静音状态与 SW 重启。

## 2.11 变更摘要

- 修复：`Na` 恢复整组分派被前面的 `'Ba'|'Na'|'Ra'` 分支提前吃掉（永远不执行）；`Ra`/`Ba` 从空实现补成真正的移动。
- 修复：临时解锁期间 MutationObserver 仍在隐藏内容 / 改标题；标题清洗改成可还原（原文存 `data-acg-original-title`）。
- 修复：中文输入法选词时按 Enter 会被当成发送。
- 优化：三个 AI 站脚本合并成 `ai_shortcuts.js` + `config.js` 选择器表；找不到发送按钮时不再吞掉 Enter。
- 优化：拦截判断从 `href` 全等改成 host+pathname，带查询参数也命中；SPA 跳转 1 秒内生效。
- 优化：关键词/开关改动走 `storage.onChanged` 即时生效，去掉 30 秒全量轮询。
- 结构：新增 `config.js` 站点表；`background.js` 抽出 `readGroups/writeGroups`；删除约 20KB 死文件与 100 行死代码。
- 版本：manifest 成为唯一来源；`minimum_chrome_version: 111`。
- 权限：移除未使用的 `activeTab` / `scripting` / `favicon`。
- 工程：新增 `scripts/verify.mjs`、`scripts/e2e-smoke.mjs`、本清单与 README。
