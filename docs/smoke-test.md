# 冒烟清单（2.11）

改动涉及后台路由、内容脚本、popup 和 OneTab bundle，任何一项都可能静默失效
（不报错、只是“不生效”），所以每次改完按下面顺序过一遍。

## 自动化

```bash
node scripts/verify.mjs          # 静态：manifest 引用 / 死文件 / 版本号 / 域名一致
NODE_PATH=/home/hjx/node_modules node scripts/e2e-smoke.mjs   # 真浏览器 28 项
```

`e2e-smoke.mjs` 覆盖（28 项）：

- 扩展能以未打包形式加载，service worker 起来（manifest 合法）
- `corePing` 与 manifest 版本一致（OneTab bundle 版本补丁没打歪）
- OneTab 页面能初始化、options 页版本号来自 manifest
- popup：版本渲染、关键词增删、内容过滤开关写 storage
- 后台：`Na` 恢复整组真的开标签（旧版死分支）、`Ba` 跨组移动并清理空组、`Da` 删除分组
- 内容脚本：wnacg 分类/关键词隐藏、标题清洗、临时解锁后还原、关掉过滤后不动页面
- 内容脚本：知乎首页带查询参数仍被拦截、问答页不拦截
- AI 快捷键：Enter 发送、Shift/Ctrl+Enter 不发送、总开关和单站开关生效

## 手动清单（真机 Edge，10 分钟）

1. `edge://extensions` 重新加载扩展，无红色错误。
2. 右键菜单出现 OneTab 那 6 项；`Alt+Shift+1` 打开 OneTab 页。
3. 右键“仅发送当前标签”→ 该标签被关闭，OneTab 新分组里有它。
4. 打开一组里的单个标题 → 在当前窗口打开；点“恢复全部”→ 该组所有标签打开（**2.11 修的就是这个**）。
5. 拖一个标签到另一个分组 → 刷新 OneTab 页后位置仍然正确（**2.11 修的就是这个**）。
6. 删除一个分组、删除组内单个标签 → 刷新后状态保持；组空了自动消失。
7. 右键“排除此站点”/“排除此域名” → 该站点不再被收集。
8. 打开 `https://www.zhihu.com/`（带任何查询参数）→ 页面被替换成 OneTab 队列里的一条；
   队列空时打开 OneTab 页。打开一篇问答 → 正常浏览。
9. 小红书 `https://www.xiaohongshu.com/explore` 同上。
10. wnacg 列表页：同人誌/单行本/杂志分类不显示；加一个关键词 → 该关键词条目隐藏（**无需刷新**）；
    标题里的 `[汉化]`、`(COMIC BAVEL)` 被去掉。
11. popup 点“临时解锁 15 分钟” → 已隐藏的条目立刻出现、标题还原成原文；15 分钟后自动恢复隐藏。
12. popup 关掉“内容过滤” → 所有隐藏恢复；关掉“访问拦截” → 知乎首页不再被顶替。
13. ChatGPT / Gemini / Claude：Enter 发送、Shift+Enter 换行、中文输入法选词按 Enter 不发送。
    在 popup 里关掉某一站 → 该站恢复原生行为。
14. missav：播放中切到别的标签，回来视频仍在播；标题不截断；右下角广告浮层消失。

## 2.11 变更摘要

- 修复：`Na` 恢复整组分派被前面的 `'Ba'|'Na'|'Ra'` 分支提前吃掉（永远不执行）；`Ra`/`Ba` 从空实现补成真正的移动。
- 修复：临时解锁期间 MutationObserver 仍在隐藏内容 / 改标题；标题清洗改成可还原（原文存 `data-acg-original-title`）。
- 修复：中文输入法选词时按 Enter 会被当成发送。
- 优化：三个 AI 站脚本合并成 `ai_shortcuts.js` + `config.js` 选择器表；找不到发送按钮时不再吞掉 Enter。
- 优化：拦截判断从 `href` 全等改成 host+pathname，带查询参数也命中；SPA 跳转 1 秒内生效（原来最多 30 秒）。
- 优化：关键词/开关改动走 `storage.onChanged` 即时生效，去掉 30 秒全量轮询。
- 结构：新增 `config.js` 站点表；`background.js` 抽出 `readGroups/writeGroups`；删除约 20KB 死文件与 100 行死代码。
- 版本：manifest 成为唯一来源，`background.js` 与 OneTab bundle 运行时读取；`minimum_chrome_version: 111`。
- 权限：移除未使用的 `activeTab` / `scripting` / `favicon`（missav 改用声明式 `world: "MAIN"`，不再内联注入）。
- 工程：新增 `scripts/verify.mjs`、`scripts/e2e-smoke.mjs`、本清单与 README。
