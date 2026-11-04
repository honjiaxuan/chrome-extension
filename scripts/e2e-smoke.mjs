// 真浏览器冒烟测试：加载未打包扩展，验证后台路由、popup 与内容脚本
// 运行：
//   NODE_PATH=/home/hjx/node_modules node scripts/e2e-smoke.mjs
// 或先 `npm i -D playwright` 后 `node scripts/e2e-smoke.mjs`
//
// 用 channel:'chromium' 的新 headless 模式，扩展才真的会被加载
// （默认 headless shell 不支持扩展）。
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
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
  check('manifest 版本是 2.11', manifestVersion === '2.11', 'got ' + manifestVersion);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector('#keyword-list');

  const pong = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'corePing' }));
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

  // ---------- 2. popup UI ----------
  console.log('\n[2] popup');
  check('版本号渲染', (await popup.textContent('#version')) === 'v' + manifestVersion);
  check('三个开关都存在', (await popup.locator('input[type=checkbox]').count()) === 6, '含三个站点子开关');

  await popup.fill('#keyword-input', '测试关键词');
  await popup.click('#add-keyword');
  check(
    '关键词写入 storage',
    await waitFor(async () => {
      const data = await popup.evaluate(() => chrome.storage.local.get('blockedKeywords'));
      return Array.isArray(data.blockedKeywords) && data.blockedKeywords.includes('测试关键词');
    })
  );
  check('关键词出现在列表', (await popup.textContent('#keyword-list')).includes('测试关键词'));

  await popup.click('#keyword-list button[data-keyword="测试关键词"]');
  check(
    '关键词可从列表删除',
    await waitFor(async () => {
      const data = await popup.evaluate(() => chrome.storage.local.get('blockedKeywords'));
      return Array.isArray(data.blockedKeywords) && !data.blockedKeywords.includes('测试关键词');
    })
  );

  await popup.uncheck('#content-filter');
  check(
    '内容过滤开关写入 storage',
    await waitFor(async () => (await popup.evaluate(() => chrome.storage.local.get('contentFilterEnabled'))).contentFilterEnabled === false)
  );
  await popup.check('#content-filter');
  await popup.waitForTimeout(100);

  // ---------- 3. 后台消息路由（Na 死分支修复 / Ba 移动 / Da 删除） ----------
  console.log('\n[3] 后台消息路由');
  await popup.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      tabGroups: [
        { id: 'g1', createDate: 1, tabsMeta: [{ id: 't1', url: 'about:blank', title: 'A' }] },
        { id: 'g2', createDate: 2, tabsMeta: [{ id: 't2', url: 'about:blank', title: 'B' }] }
      ]
    });
  });

  const move = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'Ba', args: ['g1', 'g2', 't1', 0] })
  );
  check('Ba 跨组移动返回成功', move && move.error === undefined, JSON.stringify(move));
  const afterMove = await popup.evaluate(() => chrome.storage.local.get('tabGroups'));
  const groupsAfterMove = afterMove.tabGroups || [];
  check(
    'Ba 真的移动了标签且清理空组',
    groupsAfterMove.length === 1 &&
      groupsAfterMove[0].id === 'g2' &&
      groupsAfterMove[0].tabsMeta.map((t) => t.id).join(',') === 't1,t2',
    JSON.stringify(groupsAfterMove)
  );

  await popup.evaluate(() =>
    chrome.storage.local.set({
      tabGroups: [{ id: 'g3', createDate: 3, tabsMeta: [
        { id: 'a', url: 'about:blank', title: 'A' },
        { id: 'b', url: 'about:blank', title: 'B' }
      ] }]
    })
  );
  const pagesBefore = context.pages().length;
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'Na', args: ['g3', 'current'] }));
  const restored = await waitFor(() => context.pages().length >= pagesBefore + 2, 8000);
  check('Na 恢复整组会真的开标签（旧版死代码）', restored, `pages ${pagesBefore} -> ${context.pages().length}`);

  // 清理刚开的标签（保留 popup）
  for (const page of context.pages()) {
    if (page !== popup) await page.close();
  }

  const del = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'Da', args: ['g3'] }));
  const afterDel = await popup.evaluate(() => chrome.storage.local.get('tabGroups'));
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
