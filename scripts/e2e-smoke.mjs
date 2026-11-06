// 真浏览器冒烟测试：加载未打包扩展，验证后台路由、设置页与内容脚本
// 运行：
//   NODE_PATH=/home/hjx/node_modules node scripts/e2e-smoke.mjs
// 或先 `npm i -D playwright` 后 `node scripts/e2e-smoke.mjs`
//
// 用 channel:'chromium' 的新 headless 模式，扩展才真的会被加载
// （默认 headless shell 不支持扩展）。
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = mkdtempSync(join(tmpdir(), 'hjx-ext-'));

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 6000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await sleep(interval);
  }
  return false;
}

// 页面里注入的 chrome API 桩：记录 sendMessage，提供 storage + onChanged
const CHROME_STUB = (state) => {
  window.__hjx = { messages: [], state: state || {}, listeners: [] };
  const api = window.chrome || {};
  api.storage = {
    local: {
      get: () => Promise.resolve({ ...window.__hjx.state })
    },
    onChanged: {
      addListener: (fn) => window.__hjx.listeners.push(fn)
    }
  };
  api.runtime = {
    sendMessage: (msg) => {
      window.__hjx.messages.push(msg);
      return Promise.resolve({ success: true });
    },
    getManifest: () => ({ version: 'test' })
  };
  try {
    Object.defineProperty(window, 'chrome', { value: api, configurable: true, writable: true });
  } catch (e) {
    window.chrome = api;
  }
};

async function newStubbedPage(pageCtx, url, html, state) {
  const page = await pageCtx.newPage();
  await page.route('**/*', (route) => {
    // 只给主文档返回测试 HTML，其它请求直接 abort（避免和扩展的注入互相干扰）
    if (route.request().resourceType() === 'document') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return route.abort();
  });
  await page.addInitScript(CHROME_STUB, state || {});
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

async function inject(page, ...files) {
  for (const file of files) {
    await page.addScriptTag({ path: join(root, file) });
  }
}

// 给“带扩展”的上下文用：只返回主文档，其它请求 abort，但保留真实 chrome API
async function newRoutedPage(context, url, html = '<!doctype html><html><body>page</body></html>') {
  const page = await context.newPage();
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

const wnacgHtml = `<!doctype html><html><body>
  <ul id="list">
    <li class="li gallary_item" id="cat"><div class="pic_box cate-12"></div><div class="title"><a href="#">单行本分类</a></div></li>
    <li class="li gallary_item" id="kw"><div class="pic_box cate-1"></div><div class="title"><a href="#">覚醒 催眠  vol.1</a></div></li>
    <li class="li gallary_item" id="clean"><div class="pic_box cate-1"></div><div class="title"><a href="#">[漢化] タイトル (COMIC BAVEL)</a></div></li>
  </ul>
</body></html>`;

const aiHtml = `<!doctype html><html><body>
  <div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"></div>
  <button data-testid="send-button" id="send">Send</button>
  <div id="out"></div>
  <script>
    window.__sent = 0;
    document.getElementById('send').addEventListener('click', () => {
      window.__sent += 1;
      document.getElementById('out').textContent = String(window.__sent);
    });
  </script>
</body></html>`;

const zhihuHtml = '<!doctype html><html><body><h1>zhihu</h1></body></html>';

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      '--no-sandbox'
    ]
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) {
    try {
      sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    } catch (e) {
      console.log('无法加载扩展 service worker:', e.message);
      await context.close();
      process.exit(1);
    }
  }
  const extensionId = new URL(sw.url()).host;
  console.log('\n扩展已加载: ' + extensionId);

  // 内容脚本测试用不带扩展的浏览器，否则真扩展会同时对同一域名注入，
  // 两个 content.js 会互相把对方隐藏的元素恢复回来（DOM 属性是共享的）。
  const plainBrowser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox'] });
  const pageCtx = await plainBrowser.newContext();

  // ---------- 1. manifest / 后台基础 ----------
  console.log('\n[1] 扩展与后台');
  const manifestVersion = await sw.evaluate(() => chrome.runtime.getManifest().version);
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version.replace(/\.0$/, '');
  check('manifest 版本与 package.json 一致', manifestVersion === packageVersion, `manifest ${manifestVersion} / package ${packageVersion}`);

  const manifestJson = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  check(
    '工具栏图标不再弹 popup，改为打开整页设置',
    !manifestJson.action?.default_popup && !!manifestJson.action?.default_icon,
    JSON.stringify(manifestJson.action)
  );

  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/settings.html`);
  await settings.waitForSelector('#keyword-list');
  check('设置页是整页（五个卡片）', (await settings.locator('.card').count()) === 5);

  const pong = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'corePing' }));
  check('corePing 与 manifest 版本一致', pong?.result?.pong === manifestVersion, JSON.stringify(pong));

  // OneTab 页面用的是打补丁后的 bundle（版本常量改成读 manifest），
  // 这里确认它和后台的 corePing 校验没有失配。
  const onetab = await context.newPage();
  const onetabErrors = [];
  onetab.on('console', (msg) => {
    if (msg.type() === 'error') onetabErrors.push(msg.text());
  });
  await onetab.goto(`chrome-extension://${extensionId}/onetab.html`);
  const onetabRendered = await onetab
    .waitForFunction(() => (document.getElementById('contentAreaDiv')?.children.length || 0) > 0, null, {
      timeout: 10000
    })
    .then(() => true)
    .catch(() => false);
  check('OneTab 页面能初始化', onetabRendered);
  check(
    'OneTab 版本校验通过',
    !onetabErrors.join(' ').includes('core version mismatch'),
    onetabErrors.join(' | ')
  );
  await onetab.close();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForSelector('#extension-version');
  check(
    'options 页版本号从 manifest 读取',
    (await options.textContent('#extension-version')) === 'OneTab build · v' + manifestVersion,
    await options.textContent('#extension-version')
  );
  await options.close();

  // ---------- 2. settings UI ----------
  console.log('\n[2] settings');
  check('版本号渲染', (await settings.textContent('#version')) === 'v' + manifestVersion);
  check('四个总开关 + 三个站点子开关', (await settings.locator('input[type=checkbox]').count()) === 8, '共 8 个复选框');

  await settings.fill('#keyword-input', '测试关键词');
  await settings.click('#add-keyword');
  check(
    '关键词写入 storage',
    await waitFor(async () => {
      const data = await settings.evaluate(() => chrome.storage.local.get('blockedKeywords'));
      return Array.isArray(data.blockedKeywords) && data.blockedKeywords.includes('测试关键词');
    })
  );
  check('关键词出现在列表', (await settings.textContent('#keyword-list')).includes('测试关键词'));

  await settings.click('#keyword-list button[data-keyword="测试关键词"]');
  check(
    '关键词可从列表删除',
    await waitFor(async () => {
      const data = await settings.evaluate(() => chrome.storage.local.get('blockedKeywords'));
      return Array.isArray(data.blockedKeywords) && !data.blockedKeywords.includes('测试关键词');
    })
  );

  await settings.uncheck('#content-filter');
  check(
    '内容过滤开关写入 storage',
    await waitFor(async () => (await settings.evaluate(() => chrome.storage.local.get('contentFilterEnabled'))).contentFilterEnabled === false)
  );
  await settings.check('#content-filter');
  await settings.waitForTimeout(100);

  // 自动静音的域名管理
  await settings.fill('#domain-input', 'https://www.instagram.com/some/path');
  await settings.click('#add-domain');
  check(
    '域名归一化后写入 storage',
    await waitFor(async () => {
      const data = await settings.evaluate(() => chrome.storage.local.get('autoMuteDomains'));
      return Array.isArray(data.autoMuteDomains) && data.autoMuteDomains.includes('instagram.com');
    })
  );
  check('归一化后的域名出现在列表', (await settings.textContent('#domain-list')).includes('instagram.com'));

  await settings.fill('#domain-input', 'not a domain');
  await settings.click('#add-domain');
  check('非法域名给出提示', (await settings.textContent('#domain-error')).trim().length > 0);

  await settings.fill('#domain-input', 'instagram.com');
  await settings.click('#add-domain');
  check('重复域名被拒绝', (await settings.textContent('#domain-error')).includes('已经'));

  await settings.click('#domain-list button[data-domain="instagram.com"]');
  check(
    '域名可以从列表删除',
    await waitFor(async () => {
      const data = await settings.evaluate(() => chrome.storage.local.get('autoMuteDomains'));
      return Array.isArray(data.autoMuteDomains) && !data.autoMuteDomains.includes('instagram.com');
    })
  );

  // ---------- 3. 后台消息路由（Na 死分支修复 / Ba 移动 / Da 删除） ----------
  console.log('\n[3] 后台消息路由');
  await settings.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      tabGroups: [
        { id: 'g1', createDate: 1, tabsMeta: [{ id: 't1', url: 'about:blank', title: 'A' }] },
        { id: 'g2', createDate: 2, tabsMeta: [{ id: 't2', url: 'about:blank', title: 'B' }] }
      ]
    });
  });

  const move = await settings.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'Ba', args: ['g1', 'g2', 't1', 0] })
  );
  check('Ba 跨组移动返回成功', move && move.error === undefined, JSON.stringify(move));
  const afterMove = await settings.evaluate(() => chrome.storage.local.get('tabGroups'));
  const groupsAfterMove = afterMove.tabGroups || [];
  check(
    'Ba 真的移动了标签且清理空组',
    groupsAfterMove.length === 1 &&
      groupsAfterMove[0].id === 'g2' &&
      groupsAfterMove[0].tabsMeta.map((t) => t.id).join(',') === 't1,t2',
    JSON.stringify(groupsAfterMove)
  );

  await settings.evaluate(() =>
    chrome.storage.local.set({
      tabGroups: [{ id: 'g3', createDate: 3, tabsMeta: [
        { id: 'a', url: 'about:blank', title: 'A' },
        { id: 'b', url: 'about:blank', title: 'B' }
      ] }]
    })
  );
  const pagesBefore = context.pages().length;
  await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'Na', args: ['g3', 'current'] }));
  const restored = await waitFor(() => context.pages().length >= pagesBefore + 2, 8000);
  check('Na 恢复整组会真的开标签（旧版死代码）', restored, `pages ${pagesBefore} -> ${context.pages().length}`);

  // 清理刚开的标签（保留 settings）
  for (const page of context.pages()) {
    if (page !== settings) await page.close();
  }

  const del = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'Da', args: ['g3'] }));
  const afterDel = await settings.evaluate(() => chrome.storage.local.get('tabGroups'));
  check('Da 删除分组', del && (afterDel.tabGroups || []).length === 0, JSON.stringify(afterDel));

  // ---------- 4. 内容脚本：wnacg 过滤 / 解锁还原 ----------
  console.log('\n[4] 内容脚本（wnacg）');
  const wnacg = await newStubbedPage(pageCtx, 'https://wnacg.com/albums.html', wnacgHtml, {
    extensionEnabled: true,
    contentFilterEnabled: true,
    unblockUntil: 0,
    blockedKeywords: ['催眠']
  });
  await inject(wnacg, 'config.js', 'content.js');
  await sleep(300);

  const hidden = async (id) => wnacg.evaluate((sel) => getComputedStyle(document.getElementById(sel)).display === 'none', id);
  check('分类 cate-12 被隐藏', await hidden('cat'));
  check('关键词命中的条目被隐藏', await hidden('kw'));
  check('标题被清洗', (await wnacg.textContent('#clean a')) === 'タイトル', await wnacg.textContent('#clean a'));

  await wnacg.evaluate(() => {
    window.__hjx.state.unblockUntil = Date.now() + 60000;
    window.__hjx.listeners.forEach((fn) =>
      fn({ unblockUntil: { newValue: window.__hjx.state.unblockUntil } }, 'local')
    );
  });
  await sleep(300);
  check('临时解锁后关键词条目恢复显示', !(await hidden('kw')));
  check(
    '临时解锁后标题还原成原文',
    (await wnacg.textContent('#clean a')) === '[漢化] タイトル (COMIC BAVEL)',
    await wnacg.textContent('#clean a')
  );
  await wnacg.close();

  const wnacgOff = await newStubbedPage(pageCtx, 'https://wnacg.com/albums.html', wnacgHtml, {
    extensionEnabled: true,
    contentFilterEnabled: false,
    unblockUntil: 0,
    blockedKeywords: ['催眠']
  });
  await inject(wnacgOff, 'config.js', 'content.js');
  await sleep(300);
  check(
    '关掉内容过滤后什么都不做',
    !(await wnacgOff.evaluate(() => getComputedStyle(document.getElementById('cat')).display === 'none')) &&
      !(await wnacgOff.evaluate(() => getComputedStyle(document.getElementById('kw')).display === 'none'))
  );
  await wnacgOff.close();

  // ---------- 5. 内容脚本：访问拦截（带查询参数也要命中） ----------
  console.log('\n[5] 内容脚本（访问拦截）');
  const zhihu = await newStubbedPage(pageCtx, 'https://www.zhihu.com/?utm_source=test', zhihuHtml, {
    extensionEnabled: true,
    contentFilterEnabled: true,
    unblockUntil: 0,
    blockedKeywords: []
  });
  await inject(zhihu, 'config.js', 'content.js');
  check(
    '知乎首页带查询参数仍然被拦截',
    await waitFor(async () => (await zhihu.evaluate(() => window.__hjx.messages)).some((m) => m.action === 'popAndRedirect'), 3000)
  );
  await zhihu.close();

  const zhihuQuestion = await newStubbedPage(pageCtx, 'https://www.zhihu.com/question/123', zhihuHtml, {
    extensionEnabled: true,
    contentFilterEnabled: true,
    unblockUntil: 0,
    blockedKeywords: []
  });
  await inject(zhihuQuestion, 'config.js', 'content.js');
  await sleep(400);
  check('问答页不拦截', (await zhihuQuestion.evaluate(() => window.__hjx.messages)).length === 0);

  await zhihuQuestion.evaluate(() => history.pushState({}, '', '/'));
  check(
    'SPA 跳转到首页后 1 秒内被拦截',
    await waitFor(
      async () => (await zhihuQuestion.evaluate(() => window.__hjx.messages)).some((m) => m.action === 'popAndRedirect'),
      3000
    )
  );
  await zhihuQuestion.close();

  // ---------- 6. AI 快捷键 ----------
  console.log('\n[6] AI 快捷键');
  const ai = await newStubbedPage(pageCtx, 'https://chatgpt.com/', aiHtml, {
    aiShortcutsEnabled: true,
    aiDisabledSites: []
  });
  await inject(ai, 'config.js', 'ai_shortcuts.js');
  await ai.click('#prompt-textarea');
  await ai.keyboard.type('hello');
  await ai.keyboard.press('Enter');
  check('Enter 触发发送', (await ai.evaluate(() => window.__sent)) === 1);
  await ai.keyboard.press('Shift+Enter');
  check('Shift+Enter 不发送', (await ai.evaluate(() => window.__sent)) === 1);
  await ai.keyboard.press('Control+Enter');
  check('Ctrl+Enter 不发送（走换行分支）', (await ai.evaluate(() => window.__sent)) === 1);

  await ai.evaluate(() => {
    window.__hjx.state.aiShortcutsEnabled = false;
    window.__hjx.listeners.forEach((fn) => fn({ aiShortcutsEnabled: { newValue: false } }, 'local'));
  });
  await sleep(100);
  await ai.keyboard.press('Enter');
  check('总开关关闭后 Enter 不再被拦截', (await ai.evaluate(() => window.__sent)) === 1);

  await ai.evaluate(() => {
    window.__hjx.state.aiShortcutsEnabled = true;
    window.__hjx.state.aiDisabledSites = ['chatgpt'];
    window.__hjx.listeners.forEach((fn) => fn({ aiDisabledSites: { newValue: ['chatgpt'] } }, 'local'));
  });
  await sleep(100);
  await ai.keyboard.press('Enter');
  check('单站关闭后 Enter 不再被拦截', (await ai.evaluate(() => window.__sent)) === 1);
  await ai.close();

  // ---------- 7. 域名自动静音（真实 chrome.tabs 静音状态） ----------
  console.log('\n[7] 域名自动静音');

  const tabInfoById = (tabId) =>
    settings.evaluate(async (id) => {
      try {
        const t = await chrome.tabs.get(id);
        return {
          id: t.id,
          url: t.url,
          muted: t.mutedInfo.muted,
          reason: t.mutedInfo.reason,
          extensionId: t.mutedInfo.extensionId
        };
      } catch (e) {
        return null;
      }
    }, tabId);

  const tabInfoByPrefix = (prefix) =>
    settings.evaluate(async (p) => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => (x.url || '').startsWith(p));
      return t
        ? {
            id: t.id,
            url: t.url,
            muted: t.mutedInfo.muted,
            reason: t.mutedInfo.reason,
            extensionId: t.mutedInfo.extensionId
          }
        : null;
    }, prefix);

  // waitFor 只返回 true/false，这里等条件成立后再取一次真实状态
  const waitForMuted = async (getInfo, expected, timeout = 8000) => {
    await waitFor(async () => {
      const info = await getInfo();
      return !!info && info.muted === expected;
    }, timeout);
    return getInfo();
  };

  const sessionState = () =>
    settings
      .evaluate(async () => (await chrome.storage.session.get('autoMuteTabState')).autoMuteTabState || {})
      .catch(() => ({}));

  await settings.evaluate(() =>
    chrome.storage.local.set({ autoMuteEnabled: true, autoMuteDomains: ['threads.com'] })
  );

  const threadsUrl = 'https://www.threads.com/@fatimabuildsai/post/DfR16SUDDbA?xmt=123';
  const threadsPage = await newRoutedPage(context, threadsUrl);
  const threadsTab = await waitForMuted(() => tabInfoByPrefix('https://www.threads.com/@fatimabuildsai'), true);
  check('打开 Threads 帖子（带查询参数）自动静音', threadsTab?.muted === true, JSON.stringify(threadsTab));
  check(
    '静音来源是我们的扩展',
    threadsTab?.reason === 'extension' && threadsTab?.extensionId === extensionId,
    JSON.stringify(threadsTab)
  );
  const threadsTabId = threadsTab?.id ?? -1;

  const threadsPage2 = await newRoutedPage(context, 'https://sub.threads.com/@another');
  const threadsTab2 = await waitForMuted(() => tabInfoByPrefix('https://sub.threads.com/'), true);
  check('子域名标签同样自动静音', threadsTab2?.muted === true, JSON.stringify(threadsTab2));
  check('两个标签各自独立记录', !!threadsTab && !!threadsTab2 && threadsTab.id !== threadsTab2.id);

  // 离开域名要还原（只还原我们自己造成的静音）
  await threadsPage.goto('https://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const leftTab = await waitForMuted(() => tabInfoById(threadsTabId), false);
  check('离开 Threads 后还原为未静音', leftTab?.muted === false, JSON.stringify(leftTab));

  await threadsPage.goto(threadsUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const backTab = await waitForMuted(() => tabInfoById(threadsTabId), true);
  check('回到 Threads 重新自动静音', backTab?.muted === true, JSON.stringify(backTab));

  // 关闭一个标签要清理状态
  const closedId = threadsTab2?.id ?? -1;
  await threadsPage2.close();
  check(
    '关闭标签后清理 session 状态',
    await waitFor(async () => !(await sessionState())[closedId], 5000)
  );

  // 关闭功能
  await settings.evaluate(() => chrome.storage.local.set({ autoMuteEnabled: false }));
  const disabledTab = await waitForMuted(() => tabInfoById(threadsTabId), false);
  check('关闭自动静音后现有标签被还原', disabledTab?.muted === false, JSON.stringify(disabledTab));

  const threadsOffPage = await newRoutedPage(context, 'https://www.threads.com/@off');
  await sleep(1500);
  const offInfo = await tabInfoByPrefix('https://www.threads.com/@off');
  check('关闭状态下新开的 Threads 不被静音', offInfo?.muted === false, JSON.stringify(offInfo));

  // 重新开启 + 域名增删
  await settings.evaluate(() =>
    chrome.storage.local.set({ autoMuteEnabled: true, autoMuteDomains: ['threads.com', 'example.org'] })
  );
  const reEnabled = await waitForMuted(() => tabInfoById(threadsTabId), true);
  check('重新开启后已有标签恢复静音', reEnabled?.muted === true, JSON.stringify(reEnabled));

  const exampleOrgPage = await newRoutedPage(context, 'https://example.org/hello');
  const exampleOrgInfo = await waitForMuted(() => tabInfoByPrefix('https://example.org/hello'), true);
  check('新增域名后该站点自动静音', exampleOrgInfo?.muted === true, JSON.stringify(exampleOrgInfo));

  await settings.evaluate(() => chrome.storage.local.set({ autoMuteDomains: ['threads.com'] }));
  const removedDomainTab = await waitForMuted(() => tabInfoByPrefix('https://example.org/hello'), false);
  check('移除域名后不再静音并还原', removedDomainTab?.muted === false, JSON.stringify(removedDomainTab));

  const falsePositivePage = await newRoutedPage(context, 'https://notthreads.com/');
  await sleep(1500);
  const falsePositive = await tabInfoByPrefix('https://notthreads.com/');
  check('notthreads.com 不被误静音', falsePositive?.muted === false, JSON.stringify(falsePositive));

  await falsePositivePage.close();
  await exampleOrgPage.close();
  await threadsOffPage.close();

  // 扩展 / service worker 重启后重新对齐
  await settings.evaluate(() =>
    chrome.storage.local.set({ autoMuteEnabled: true, autoMuteDomains: ['threads.com'] })
  );
  await waitForMuted(() => tabInfoById(threadsTabId), true);
  await settings.evaluate(async (id) => {
    await chrome.tabs.update(id, { muted: false });
  }, threadsTabId);
  const clearedTab = await waitForMuted(() => tabInfoById(threadsTabId), false);
  check('手动改回未静音（构造重启场景）', clearedTab?.muted === false, JSON.stringify(clearedTab));

  // 真正把 service worker 停掉再唤醒，验证“SW 重启后重新对齐”
  const cdp = await context.newCDPSession(settings);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await sleep(600);
  await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'corePing' })).catch(() => {});
  const restartedTab = await waitForMuted(() => tabInfoById(threadsTabId), true, 15000);
  check('service worker 重启后已有 Threads 标签重新被静音', restartedTab?.muted === true, JSON.stringify(restartedTab));

  // 状态仍在 session storage 里（重启不该丢）
  const stateAfterRestart = await sessionState();
  check(
    '重启后 session 里仍有该标签的状态',
    !!stateAfterRestart[threadsTabId],
    JSON.stringify(stateAfterRestart)
  );

  // ---------- 8. 重复标签清理 ----------
  console.log('\n[8] 重复标签清理');

  check(
    '默认清理域名是 threads.com + zhihu.com',
    (await settings.textContent('#dedupe-list')).includes('threads.com') &&
      (await settings.textContent('#dedupe-list')).includes('zhihu.com')
  );

  await settings.fill('#dedupe-input', 'https://www.example.org/some/path');
  await settings.click('#add-dedupe');
  check(
    '新增清理域名写入 storage',
    await waitFor(async () => {
      const data = await settings.evaluate(() => chrome.storage.local.get('dedupeDomains'));
      return Array.isArray(data.dedupeDomains) && data.dedupeDomains.includes('example.org');
    })
  );
  await settings.click('#dedupe-list button[data-dedupe-domain="example.org"]');
  check(
    '删除清理域名写回 storage',
    await waitFor(async () => {
      const data = await settings.evaluate(() => chrome.storage.local.get('dedupeDomains'));
      return Array.isArray(data.dedupeDomains) && !data.dedupeDomains.includes('example.org');
    })
  );

  const dedupePages = [];
  const openDedupePage = async (url) => {
    const page = await newRoutedPage(context, url);
    dedupePages.push(page);
    return page;
  };
  await openDedupePage('https://www.threads.com/@dedupe/post/1?xmt=aaa');
  await openDedupePage('https://www.threads.com/@dedupe/post/1?xmt=bbb');
  await openDedupePage('https://www.threads.com/@dedupe/post/2');
  await openDedupePage('https://www.zhihu.com/question/1?utm_source=x');
  await openDedupePage('https://www.zhihu.com/question/1');
  await openDedupePage('https://example.com/dup');
  await openDedupePage('https://example.com/dup');

  await settings.click('#dedupe-now');
  await waitFor(async () => {
    const text = await settings.textContent('#dedupe-status');
    return typeof text === 'string' && text.includes('关闭');
  }, 10000);
  const dedupeStatusText = await settings.textContent('#dedupe-status');
  check('点“立即清理”有结果反馈', /关闭\s*\d+\s*个/.test(dedupeStatusText || ''), String(dedupeStatusText));

  const countPages = (needle) => context.pages().filter((page) => page.url().includes(needle)).length;
  check('Threads 同页不同 xmt 只留一个', countPages('/@dedupe/post/1') === 1, 'count=' + countPages('/@dedupe/post/1'));
  check('Threads 不同帖子都保留', countPages('/@dedupe/post/2') === 1, 'count=' + countPages('/@dedupe/post/2'));
  check('知乎同题不同 utm 只留一个', countPages('zhihu.com/question/1') === 1, 'count=' + countPages('zhihu.com/question/1'));
  check('未配置域名不清理', countPages('example.com/dup') === 2, 'count=' + countPages('example.com/dup'));

  for (const page of dedupePages) {
    if (!page.isClosed()) await page.close().catch(() => {});
  }

  // ---------- 9. 工具栏图标 -> 整页设置 ----------
  console.log('\n[9] 工具栏图标');
  await settings.close();
  await sleep(400);

  const hasOpener = await sw.evaluate(() => typeof openSettingsPage === 'function');
  check('后台注册了 openSettingsPage（onClicked 的落地函数）', hasOpener === true);

  await sw.evaluate(() => openSettingsPage());
  const openedSettings = await waitFor(
    async () => context.pages().some((p) => p.url().endsWith('/settings.html')),
    8000
  );
  check('调用后打开整页设置标签', openedSettings === true);

  await sw.evaluate(() => openSettingsPage());
  await sleep(1000);
  const settingsCount = context.pages().filter((p) => p.url().endsWith('/settings.html')).length;
  check('已打开时只聚焦、不重复开', settingsCount === 1, 'count=' + settingsCount);

  await context.close();
  await plainBrowser.close();
  rmSync(profile, { recursive: true, force: true });

  console.log('\n----------------------------------------');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 条 / 通过 ' + passed + ' 条');
    for (const f of failures) console.log(' - ' + f);
    process.exit(1);
  }
  console.log('全部通过 ✅ (' + passed + ' 项)');
})().catch(async (e) => {
  console.error('FATAL', e);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch (_) {}
  process.exit(1);
});
