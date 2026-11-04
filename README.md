# HJX Extension

个人用的 Edge/Chromium 扩展（Manifest V3），一个包里塞了三件事：

1. **OneTab**：标签页聚合成列表页、分组恢复/删除、导入导出、右键 6 种收集范围、`Ctrl+Shift+P` 固定标签、`Alt+Shift+1` 打开 OneTab。
   底座是 OneTab 2.10 的解包源码（`ext-onetab-*.js`），做了少量补丁。
2. **ACG 站点过滤**：知乎首页/关注/热榜/专栏广场、小红书发现页会“被 OneTab 队列里的下一条顶替”；
   wnacg 列表按分类/关键词隐藏并清洗标题；chunman4 隐藏指定标题的帖子；jmcomic / wnacg 列表入口直接跳阅读模式。
3. **AI 聊天快捷键**：Gemini / ChatGPT / Claude 上把 Enter 改成发送，Shift+Enter / Ctrl+Enter 换行。
4. **missav**：阻止“切走标签就暂停”的检测，标题不截断，隐藏右下角广告浮层。
5. **域名自动静音**：打开配置域名（默认 `threads.com`，含子域名）的标签自动静音；用户手动取消静音后，该标签在本次停留期间不再被静音。

## 目录

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 唯一配置入口；版本号唯一来源 |
| `config.js` | 域名 / 选择器 / 清洗正则总表（改规则只改这里） |
| `background.js` | OneTab 后端 + 访问拦截落地动作 + 自动静音初始化 |
| `auto_mute.js` | 域名自动静音状态机（service worker 侧，`importScripts` 加载） |
| `content.js` | 访问拦截、wnacg / chunman 过滤、标题清洗 |
| `ai_shortcuts.js` | 三个 AI 站的键盘行为（共用一份） |
| `missav_main.js` | MAIN world 内容脚本，伪装可见性 |
| `css_injector.js` | missav 样式覆盖 |
| `popup.html/js` | 开关、临时解锁、关键词管理 |
| `onetab.html` / `options.html` / `import-export.html` / `placeholder.html` | OneTab 页面 |
| `ext-onetab-*.js` | OneTab 2.10 解包 bundle（已把版本常量改成读 manifest） |

## 开发

```bash
# 静态自检（manifest 引用、死文件、版本号、config 与 manifest 一致性）
node scripts/verify.mjs

# 自动静音状态机单测（纯 Node，无需浏览器）
node scripts/unit-auto-mute.mjs

# 真浏览器冒烟（加载未打包扩展 + 内容脚本逻辑）
npm i -D playwright     # 只需一次
npx playwright install chromium
npm run test:e2e
# 已有全局 playwright 时：
NODE_PATH=/home/hjx/node_modules node scripts/e2e-smoke.mjs
```

加载方式：`edge://extensions` → 开启开发人员模式 → “加载解压缩的扩展” → 选这个目录。
改完 `manifest.json` 或 `background.js` 需要在扩展页点一次“重新加载”。

## 约定

- **版本号**：只改 `manifest.json`。`background.js` 和 OneTab bundle 都运行时读 `chrome.runtime.getManifest().version`，
  `options.html` 也由 `version_label.js` 渲染。`scripts/verify.mjs` 会拦下残留的硬编码版本号。
- **加站点/改选择器**：先改 `config.js`，再同步 `manifest.json` 的 `matches`，最后跑 `verify`。
- **改 OneTab bundle**：它是解包压缩代码，只做最小字符串级修改并在这里记录。
- **临时解锁**：`chrome.storage.local.unblockUntil`（毫秒时间戳）。popup 里的“临时解锁 15 分钟”写这个键，
  内容脚本通过 `storage.onChanged` 即时生效，不需要刷新页面。
- **自动静音**：配置在 `chrome.storage.local.autoMuteEnabled` / `autoMuteDomains`；
  每个标签的归属与 override 记在 `chrome.storage.session.autoMuteTabState`（SW 重启不丢，关标签即清）。
  只信 `mutedInfo.reason`：`user` 是用户，`extension` + 自己的 `extensionId` 才是我们。

## 已知限制

- wnacg / chunman 的 DOM 结构、AI 站的选择器都是硬编码的，站点改版会让规则失效；
  失效时的表现是“不再隐藏/不再发送”，不会报错到界面上，用 `npm run test:e2e` 的桩页面回归最省事。
- 自动静音默认只配 `threads.com`。如果实际访问被跳到 `threads.net`，在 popup 里加一行即可
  （同一标签跨域名跳转会先把状态清掉再按新域名重新判断）。
- 用户手动取消静音只能靠 `mutedInfo.reason === 'user'` 识别，浏览器没有提供更可靠的“用户手势”信号；
  自动化测试无法合成这种事件，所以“刷新后仍保持未静音”必须真机验证。
- OneTab bundle 内部还有一堆未接线的混淆残留（例如 `chrome.permissions` 请求 tabGroups），
  属于原厂代码，未做进一步清理。
