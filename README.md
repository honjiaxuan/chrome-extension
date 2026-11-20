# HJX Extension

个人用的 Edge/Chromium 扩展（Manifest V3），一个包里塞了三件事：

1. **OneTab**：标签页聚合成列表页、分组恢复/删除、导入导出、右键 6 种收集范围、`Ctrl+Shift+P` 固定标签、`Alt+Shift+1` 打开 OneTab。
   底座是 OneTab 2.10 的解包源码（`ext-onetab-*.js`），做了少量补丁。
2. **ACG 站点过滤**：知乎首页/关注/热榜/专栏广场、小红书发现页会“被 OneTab 队列里的下一条顶替”；
   wnacg 列表按分类/关键词隐藏并清洗标题；chunman4 隐藏指定标题的帖子；jmcomic / wnacg 列表入口直接跳阅读模式。
3. **AI 聊天快捷键**：Gemini / ChatGPT / Claude 上把 Enter 改成发送，Shift+Enter / Ctrl+Enter 换行。
4. **missav**：阻止“切走标签就暂停”的检测，标题不截断，隐藏右下角广告浮层。
5. **域名自动静音**：打开配置域名（默认 `threads.com`，含子域名）的标签自动静音；用户手动取消静音后，该标签在本次停留期间不再被静音。
6. **重复标签清理**：点工具栏图标时，关闭配置域名（默认 `threads.com`、`zhihu.com`）下的重复标签；同一页面（忽略 `#` 与 `utm_*`/`xmt` 等跟踪参数）保留一个，固定标签不动。
7. **标签超限自动归档**：某个窗口的标签数达到阈值（默认 50）时，自动把除“当前标签”以外的标签收进 OneTab 列表；固定标签、排除名单、扩展页和浏览器内部页不动。按窗口独立计数，阈值可在设置页改（5–500）。

## 目录

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 唯一配置入口；版本号唯一来源 |
| `config.js` | 域名 / 选择器 / 清洗正则总表（改规则只改这里） |
| `background.js` | OneTab 后端 + 访问拦截落地动作 + 自动静音初始化 |
| `auto_mute.js` | 域名自动静音状态机（service worker 侧，`importScripts` 加载） |
| `dedupe.js` | 重复标签清理（点图标时执行，纯函数可单测） |
| `tab_overflow.js` | 标签超限自动归档状态机（按窗口计数、武装/解除武装、抑制窗口） |
| `domain_utils.js` | 域名归一化/匹配，SW 与设置页共用 |
| `content.js` | 访问拦截、wnacg / chunman 过滤、标题清洗 |
| `ai_shortcuts.js` | 三个 AI 站的键盘行为（共用一份） |
| `missav_main.js` | MAIN world 内容脚本，伪装可见性 |
| `css_injector.js` | missav 样式覆盖 |
| `settings.html/js` | 整页设置（点工具栏图标在新标签打开）：开关、临时解锁、关键词、自动静音域名 |
| `onetab.html` / `options.html` / `import-export.html` / `placeholder.html` | OneTab 页面 |
| `ext-onetab-*.js` | OneTab 2.10 解包 bundle（已把版本常量改成读 manifest） |

## 开发

```bash
# 静态自检（manifest 引用、死文件、版本号、config 与 manifest 一致性）
node scripts/verify.mjs

# 自动静音状态机单测（纯 Node，无需浏览器）
node scripts/unit-auto-mute.mjs

# 标签超限自动归档状态机单测（纯 Node）
node scripts/unit-tab-overflow.mjs

# 真浏览器冒烟（加载未打包扩展 + 内容脚本逻辑）
npm i -D playwright     # 只需一次
npx playwright install chromium
npm run test:e2e
# 已有全局 playwright 时：
NODE_PATH=/home/hjx/node_modules node scripts/e2e-smoke.mjs

# 设置页整页截图（改布局后人工看一眼）
NODE_PATH=/home/hjx/node_modules node scripts/shot-settings.mjs /tmp/settings.png
```

加载方式：`edge://extensions` → 开启开发人员模式 → “加载解压缩的扩展” → 选这个目录。
改完 `manifest.json` 或 `background.js` 需要在扩展页点一次“重新加载”。

## 约定

- **版本号**：只改 `manifest.json`。`background.js` 和 OneTab bundle 都运行时读 `chrome.runtime.getManifest().version`，
  `options.html` 也由 `version_label.js` 渲染。`scripts/verify.mjs` 会拦下残留的硬编码版本号。
- **加站点/改选择器**：先改 `config.js`，再同步 `manifest.json` 的 `matches`，最后跑 `verify`。
- **改 OneTab bundle**：它是解包压缩代码，只做最小字符串级修改并在这里记录。
- **临时解锁**：`chrome.storage.local.unblockUntil`（毫秒时间戳）。设置页里的“临时解锁 15 分钟”写这个键，
  内容脚本通过 `storage.onChanged` 即时生效，不需要刷新页面。
- **重复标签清理**：`chrome.storage.local.dedupeEnabled` / `dedupeDomains`，上次结果写 `dedupeLastResult`；
  点图标时先清一遍再打开设置页，设置页里也有“立即清理”（走消息 `dedupeNow`）。
- **标签超限自动归档**：阈值 `chrome.storage.local.tabOverflowThreshold`（默认 50）、开关 `tabOverflowEnabled`，
  上次结果写 `tabOverflowLastResult`；每个窗口的武装状态记在 `chrome.storage.session.tabOverflowState`。
  只在“新标签 / 标签移入窗口”时评估；触发一次后解除武装，窗口标签数回落到阈值以下才重新武装。
  浏览器启动后 60 秒、OneTab 恢复分组后 20 秒内不触发，避免会话恢复或恢复分组被立刻收回。
- **自动静音**：配置在 `chrome.storage.local.autoMuteEnabled` / `autoMuteDomains`；
  每个标签的归属与 override 记在 `chrome.storage.session.autoMuteTabState`（SW 重启不丢，关标签即清）。
  只信 `mutedInfo.reason`：`user` 是用户，`extension` + 自己的 `extensionId` 才是我们。

## 已知限制

- wnacg / chunman 的 DOM 结构、AI 站的选择器都是硬编码的，站点改版会让规则失效；
  失效时的表现是“不再隐藏/不再发送”，不会报错到界面上，用 `npm run test:e2e` 的桩页面回归最省事。
- 自动静音默认只配 `threads.com`。如果实际访问被跳到 `threads.net`，在设置页里加一行即可
  （同一标签跨域名跳转会先把状态清掉再按新域名重新判断）。
- `aaccnn.com` / `8xbook.cc` 在 config.js 的 `registered` 里登记着，但没有站点专属规则：
  `content.js` 会注入但立刻 return，等于不生效。要真监控需要先给出页面上要隐藏的元素/标题规则。
- 用户手动取消静音只能靠 `mutedInfo.reason === 'user'` 识别，浏览器没有提供更可靠的“用户手势”信号；
  自动化测试无法合成这种事件，所以“刷新后仍保持未静音”必须真机验证。
- 自动归档保留“当前标签”，所以一次触发后窗口里至少还剩 1 个标签；活动标签永远不会被收走。
- 归档按窗口独立计数，不跨窗口汇总。固定标签计入阈值但不会被归档：极端情况下（例如 50 个固定标签）
  可能只归档很少甚至 0 个，然后要等计数回落到阈值以下才会重新武装。
- 触发点是新开标签或把标签拖进窗口，不是定时扫描；打开开关或调低阈值后，要等下一次标签数变化才生效。
- OneTab 的“恢复并删除”走消息 `Da(id, true, mode)`；2.15 起后台才真正做到“先恢复再删组”，
  旧版 `Da` 只删组。若以后替换 OneTab bundle，需要重新确认这个协议。
- OneTab bundle 内部还有一堆未接线的混淆残留（例如 `chrome.permissions` 请求 tabGroups），
  属于原厂代码，未做进一步清理。
