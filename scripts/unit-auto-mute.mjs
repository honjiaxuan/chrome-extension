#!/usr/bin/env node
// auto_mute.js 的状态机单测（不需要浏览器）
//   node scripts/unit-auto-mute.mjs
//
// 覆盖自动化里无法真实合成的东西：用户手动取消静音（mutedInfo.reason === 'user'）
// 以及它与自动静音之间的竞态。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'auto_mute.js'), 'utf8');

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

function makeChrome() {
  const SELF = 'self-id';
  const tabs = new Map();
  const storage = { local: {}, session: {} };
  const listeners = { updated: [], removed: [], replaced: [], created: [], changed: [] };
  let updateCalls = 0;

  const pick = (area, keys) => {
    const data = storage[area];
    if (keys == null) return { ...data };
    if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {};
    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) if (key in data) out[key] = data[key];
      return out;
    }
    const out = { ...keys };
    for (const key of Object.keys(keys)) if (key in data) out[key] = data[key];
    return out;
  };

  const chrome = {
    runtime: { id: SELF },
    storage: {
      local: {
        get: (keys) => Promise.resolve(pick('local', keys)),
        set: (obj) => {
          Object.assign(storage.local, obj);
          return Promise.resolve();
        }
      },
      session: {
        get: (keys) => Promise.resolve(pick('session', keys)),
        set: (obj) => {
          Object.assign(storage.session, obj);
          return Promise.resolve();
        }
      },
      onChanged: { addListener: (fn) => listeners.changed.push(fn) }
    },
    tabs: {
      get: (id) => {
        if (!tabs.has(id)) return Promise.reject(new Error('No tab with id: ' + id));
        return Promise.resolve({ ...tabs.get(id), mutedInfo: { ...tabs.get(id).mutedInfo } });
      },
      query: () => Promise.resolve([...tabs.values()].map((t) => ({ ...t }))),
      update: (id, props) => {
        if (!tabs.has(id)) return Promise.reject(new Error('No tab with id: ' + id));
        const tab = tabs.get(id);
        if (typeof props.muted === 'boolean') {
          updateCalls += 1;
          tab.mutedInfo = { muted: props.muted, reason: 'extension', extensionId: SELF };
        }
        return Promise.resolve({ ...tab });
      },
      onUpdated: { addListener: (fn) => listeners.updated.push(fn) },
      onRemoved: { addListener: (fn) => listeners.removed.push(fn) },
      onReplaced: { addListener: (fn) => listeners.replaced.push(fn) },
      onCreated: { addListener: (fn) => listeners.created.push(fn) }
    }
  };

  return {
    chrome,
    tabs,
    storage,
    listeners,
    get updateCalls() {
      return updateCalls;
    },
    setUpdateCalls: (n) => {
      updateCalls = n;
    }
  };
}

function loadModule(env) {
  // vm 的干净上下文里没有 URL 等宿主 API，需要显式注入
  const ctx = vm.createContext({ chrome: env.chrome, console, URL, setTimeout, clearTimeout });
  vm.runInContext(source, ctx);
  return ctx.HJX_AUTO_MUTE;
}

function addTab(env, { id, url, muted = false, reason = undefined, extensionId = undefined }) {
  const tab = {
    id,
    url,
    pendingUrl: undefined,
    mutedInfo: { muted, reason, extensionId }
  };
  env.tabs.set(id, tab);
  return tab;
}

(async () => {
  console.log('\n[1] 域名归一化与匹配');
  {
    const env = makeChrome();
    const api = loadModule(env);

    check('裸域名', api.normalizeDomain('threads.com') === 'threads.com');
    check('大写 + 空格', api.normalizeDomain('  THREADS.COM  ') === 'threads.com');
    check('带协议和路径', api.normalizeDomain('https://www.threads.com/@x/post/1?a=2') === 'threads.com');
    check('带端口', api.normalizeDomain('threads.com:443') === 'threads.com');
    check('尾部点', api.normalizeDomain('threads.com.') === 'threads.com');
    check('非法输入为空', api.normalizeDomain('not a domain') === '');
    check('单词不是域名', api.normalizeDomain('localhost') === '');

    check('子域名匹配', api.hostMatchesDomain('sub.threads.com', 'threads.com'));
    check('www 匹配', api.hostMatchesDomain('www.threads.com', 'threads.com'));
    check('notthreads.com 不匹配', !api.hostMatchesDomain('notthreads.com', 'threads.com'));
    check(
      'threads.com.example.com 不匹配',
      !api.hostMatchesDomain('threads.com.example.com', 'threads.com')
    );
    check('匹配函数会归一化配置项', api.hostMatchesDomain('www.threads.com', 'https://www.threads.com/'));
  }

  console.log('\n[2] 新标签自动静音 / 幂等');
  {
    const env = makeChrome();
    const api = loadModule(env);
    env.storage.local.autoMuteEnabled = true;
    env.storage.local.autoMuteDomains = ['threads.com'];

    addTab(env, { id: 1, url: 'https://www.threads.com/@a/post/1?xmt=1' });
    await api.applyToTab(1);
    const tab = env.tabs.get(1);
    check('匹配域名被静音', tab.mutedInfo.muted === true && tab.mutedInfo.extensionId === 'self-id');
    const initialState = await env.chrome.storage.session.get('autoMuteTabState');
    check(
      '记录了 mutedByUs 与域名',
      initialState.autoMuteTabState['1']?.mutedByUs === true &&
        initialState.autoMuteTabState['1']?.domain === 'threads.com',
      JSON.stringify(initialState.autoMuteTabState)
    );

    const before = env.updateCalls;
    await api.applyToTab(1);
    check('已静音时不再重复调用 API', env.updateCalls === before);

    addTab(env, { id: 2, url: 'https://notthreads.com/' });
    await api.applyToTab(2);
    check('notthreads.com 不被静音', env.tabs.get(2).mutedInfo.muted === false);

    addTab(env, { id: 3, url: 'https://threads.com.example.com/' });
    await api.applyToTab(3);
    check('threads.com.example.com 不被静音', env.tabs.get(3).mutedInfo.muted === false);
  }

  console.log('\n[3] 用户手动取消静音（override）');
  {
    const env = makeChrome();
    const api = loadModule(env);
    env.storage.local.autoMuteEnabled = true;
    env.storage.local.autoMuteDomains = ['threads.com'];

    const tab = addTab(env, { id: 10, url: 'https://www.threads.com/@a' });
    await api.applyToTab(10);
    check('先被自动静音', tab.mutedInfo.muted === true);

    // 用户点取消静音
    tab.mutedInfo = { muted: false, reason: 'user' };
    await api.handleMuteChange(10, { muted: false, reason: 'user' }, tab);

    await api.applyToTab(10);
    check('override 后不再自动静音', tab.mutedInfo.muted === false);

    // 同域名内导航
    tab.url = 'https://www.threads.com/@a/post/999?x=1';
    await api.applyToTab(10);
    check('同域名导航后仍然不静音', tab.mutedInfo.muted === false);

    // 刷新（url 不变，只是重新应用）
    await api.applyToTab(10);
    check('刷新后仍然不静音', tab.mutedInfo.muted === false);

    // 新标签独立
    const other = addTab(env, { id: 11, url: 'https://www.threads.com/@b' });
    await api.applyToTab(11);
    check('另一个新标签照常静音', other.mutedInfo.muted === true);
    await api.applyToTab(10);
    check('新标签不影响旧标签的 override', tab.mutedInfo.muted === false);
  }

  console.log('\n[4] 导航离开 / 回来');
  {
    const env = makeChrome();
    const api = loadModule(env);
    env.storage.local.autoMuteEnabled = true;
    env.storage.local.autoMuteDomains = ['threads.com'];

    const tab = addTab(env, { id: 20, url: 'https://www.threads.com/' });
    await api.applyToTab(20);
    check('进入时静音', tab.mutedInfo.muted === true);

    tab.url = 'https://example.com/';
    await api.applyToTab(20);
    check('离开域名时还原静音', tab.mutedInfo.muted === false);

    tab.url = 'https://www.threads.com/@again';
    await api.applyToTab(20);
    check('再回来重新静音', tab.mutedInfo.muted === true);

    // 用户静音的标签，离开时不能动
    const userMuted = addTab(env, {
      id: 21,
      url: 'https://www.threads.com/@m',
      muted: true,
      reason: 'user'
    });
    await api.applyToTab(21);
    check('用户在站点上手动静音后不被夺权', userMuted.mutedInfo.muted === true);
    userMuted.url = 'https://example.com/';
    await api.applyToTab(21);
    check('离开域名也不还原用户自己静音的标签', userMuted.mutedInfo.muted === true);
  }

  console.log('\n[5] 其他扩展 / 关闭功能 / 删除域名');
  {
    const env = makeChrome();
    const api = loadModule(env);
    env.storage.local.autoMuteEnabled = true;
    env.storage.local.autoMuteDomains = ['threads.com'];

    const tab = addTab(env, {
      id: 30,
      url: 'https://www.threads.com/',
      muted: true,
      reason: 'extension',
      extensionId: 'other-extension'
    });
    await api.applyToTab(30);
    tab.url = 'https://example.com/';
    await api.applyToTab(30);
    check('别的扩展静音的标签离开时不动它', tab.mutedInfo.muted === true);

    const ours = addTab(env, { id: 31, url: 'https://www.threads.com/' });
    await api.applyToTab(31);
    check('我们的标签正常静音', ours.mutedInfo.muted === true);

    env.storage.local.autoMuteEnabled = false;
    await api.sweepAllTabs();
    check('关掉功能后还原我们静音的标签', ours.mutedInfo.muted === false);

    env.storage.local.autoMuteEnabled = true;
    env.storage.local.autoMuteDomains = ['example.org'];
    await api.applyToTab(31);
    check('删除域名后不再静音并还原', ours.mutedInfo.muted === false);
  }

  console.log('\n[6] 竞态与清理');
  {
    const env = makeChrome();
    const api = loadModule(env);
    env.storage.local.autoMuteEnabled = true;
    env.storage.local.autoMuteDomains = ['threads.com'];

    const tab = addTab(env, { id: 40, url: 'https://www.threads.com/' });
    await api.applyToTab(40);
    // 模拟：用户取消静音后，SW 启动 sweep 又把它静音回去
    tab.mutedInfo = { muted: false, reason: 'user' };
    await api.handleMuteChange(40, { muted: false, reason: 'user' }, tab);
    tab.mutedInfo = { muted: true, reason: 'extension', extensionId: 'self-id' };
    await api.applyToTab(40);
    check('override 状态下发现被误静音会补一次取消', tab.mutedInfo.muted === false);

    await api.forgetTab(40);
    const state = await env.chrome.storage.session.get('autoMuteTabState');
    check('关标签清理状态', !state.autoMuteTabState || !state.autoMuteTabState[40]);

    const a = addTab(env, { id: 41, url: 'https://www.threads.com/' });
    await api.applyToTab(41);
    await api.moveTabState(41, 42);
    const moved = await env.chrome.storage.session.get('autoMuteTabState');
    check(
      'tab replacement 迁移状态',
      moved.autoMuteTabState['42'] && !moved.autoMuteTabState['41'],
      JSON.stringify(moved.autoMuteTabState)
    );
    check('迁移后标签仍处于静音', a.mutedInfo.muted === true);
  }

  console.log('\n----------------------------------------');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 条 / 通过 ' + passed + ' 条');
    for (const f of failures) console.log(' - ' + f);
    process.exit(1);
  }
  console.log('全部通过 ✅ (' + passed + ' 项)');
})();
