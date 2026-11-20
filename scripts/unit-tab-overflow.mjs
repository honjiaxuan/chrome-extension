#!/usr/bin/env node
// tab_overflow.js 的状态机单测（不需要浏览器）
//   node scripts/unit-tab-overflow.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

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

// ---------- chrome 桩 ----------

const local = {};
const session = {};
let tabs = [];
let archiveCalls = [];

const fakeChrome = {
  runtime: { id: 'test-extension', onStartup: { addListener() {} } },
  storage: {
    local: {
      get: async (keys) => {
        if (keys === null || keys === undefined) return { ...local };
        if (typeof keys === 'string') return { [keys]: local[keys] };
        if (Array.isArray(keys)) {
          const out = {};
          for (const key of keys) out[key] = local[key];
          return out;
        }
        const out = {};
        for (const key of Object.keys(keys)) {
          out[key] = local[key] === undefined ? keys[key] : local[key];
        }
        return out;
      },
      set: async (obj) => Object.assign(local, obj)
    },
    session: {
      get: async (key) => (typeof key === 'string' ? { [key]: session[key] } : { ...session }),
      set: async (obj) => Object.assign(session, obj)
    }
  },
  tabs: {
    query: async ({ windowId }) => tabs.filter((tab) => tab.windowId === windowId),
    onCreated: { addListener() {} },
    onAttached: { addListener() {} },
    onRemoved: { addListener() {} }
  },
  windows: { onRemoved: { addListener() {} } },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
};

const ctx = vm.createContext({ console, URL, chrome: fakeChrome, setTimeout, clearTimeout });
vm.runInContext(readFileSync(join(root, 'tab_overflow.js'), 'utf8'), ctx);
const api = ctx.HJX_TAB_OVERFLOW;

let failNext = false;
api.init({
  archiveTabs: async (list) => {
    const ids = list.map((tab) => tab.id);
    archiveCalls.push(ids);
    if (failNext) {
      failNext = false;
      throw new Error('boom');
    }
    return ids.length;
  }
});

function reset() {
  for (const key of Object.keys(local)) delete local[key];
  for (const key of Object.keys(session)) delete session[key];
  local.tabOverflowEnabled = true;
  local.tabOverflowThreshold = 50;
  tabs = [];
  archiveCalls = [];
  failNext = false;
}

function makeTabs(windowId, count, activeIndex = count - 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: windowId * 1000 + i,
    index: i,
    windowId,
    active: i === activeIndex,
    pinned: false,
    url: 'https://example.com/' + windowId + '/' + i
  }));
}

console.log('\n[1] clampThreshold');
check('空值回落到 50', api.clampThreshold(undefined) === 50);
check('低于 5 抬到 5', api.clampThreshold(1) === 5);
check('高于 500 压到 500', api.clampThreshold(9999) === 500);
check('小数四舍五入', api.clampThreshold(49.6) === 50);
check('非数字回落到 50', api.clampThreshold('abc') === 50);

console.log('\n[2] pickArchiveTabs');
{
  const list = makeTabs(1, 3, 1);
  const picked = api.pickArchiveTabs(list).map((tab) => tab.id);
  check('活动标签不在归档列表', !picked.includes(list[1].id), JSON.stringify(picked));
  check('其余标签全部归档', picked.length === 2, JSON.stringify(picked));
}
{
  const only = makeTabs(1, 1, 0);
  check('只有一个标签时不动', api.pickArchiveTabs(only).length === 0);
}
{
  const list = makeTabs(1, 4);
  list.forEach((tab, i) => {
    tab.active = false;
    tab.index = i + 10;
  });
  list[3].index = 0;
  const picked = api.pickArchiveTabs(list).map((tab) => tab.id);
  check('没有活动标签时保留 index 最小的', !picked.includes(list[3].id), JSON.stringify(picked));
}

console.log('\n[3] 阈值边界与武装状态');
(async () => {
  reset();
  tabs = makeTabs(1, 49);
  let result = await api.evaluateWindow(1, 'created');
  check('49 个标签不触发', result.skipped === 'below-threshold' && archiveCalls.length === 0, JSON.stringify(result));

  tabs = makeTabs(1, 50);
  result = await api.evaluateWindow(1, 'created');
  check('50 个标签触发归档', result.archived === 49 && archiveCalls.length === 1, JSON.stringify(result));
  check('归档数量写进 storage', local.tabOverflowLastResult?.archived === 49, JSON.stringify(local.tabOverflowLastResult));
  check('归档时保留活动标签', !archiveCalls[0].includes(50 * 1000 + 49), JSON.stringify(archiveCalls[0]));

  result = await api.evaluateWindow(1, 'created');
  check('解除武装后不再重复归档', result.skipped === 'already-fired' && archiveCalls.length === 1, JSON.stringify(result));

  tabs = makeTabs(1, 49);
  result = await api.evaluateWindow(1, 'removed');
  check('回落到阈值以下重新武装', result.skipped === 're-armed', JSON.stringify(result));

  tabs = makeTabs(1, 50);
  result = await api.evaluateWindow(1, 'created');
  check('再次越线可以再归档', archiveCalls.length === 2, JSON.stringify(result));

  console.log('\n[4] 窗口隔离');
  reset();
  tabs = [...makeTabs(1, 60), ...makeTabs(2, 10)];
  await api.evaluateWindow(2, 'created');
  check('另一个窗口计数独立', archiveCalls.length === 0, JSON.stringify(archiveCalls));
  await api.evaluateWindow(1, 'created');
  check('只有越线的窗口被归档', archiveCalls.length === 1 && archiveCalls[0].length === 59, JSON.stringify(archiveCalls));

  console.log('\n[5] 开关与阈值');
  reset();
  local.tabOverflowEnabled = false;
  tabs = makeTabs(1, 80);
  result = await api.evaluateWindow(1, 'created');
  check('关闭后完全不触发', result.skipped === 'disabled' && archiveCalls.length === 0, JSON.stringify(result));

  local.tabOverflowEnabled = true;
  local.tabOverflowThreshold = 80;
  result = await api.evaluateWindow(1, 'created');
  check('阈值 80 时 80 个标签触发', result.archived === 79, JSON.stringify(result));

  reset();
  local.tabOverflowThreshold = 5;
  tabs = makeTabs(1, 5);
  result = await api.evaluateWindow(1, 'created');
  check('阈值 5 时 5 个标签触发', result.archived === 4, JSON.stringify(result));

  console.log('\n[6] 抑制窗口');
  reset();
  tabs = makeTabs(1, 60);
  await api.suppressFor(5000);
  result = await api.evaluateWindow(1, 'created');
  check('抑制期间不归档', result.skipped === 'suppressed' && archiveCalls.length === 0, JSON.stringify(result));
  await api.suppressFor(0);
  session.tabOverflowSuppressUntil = 0;
  result = await api.evaluateWindow(1, 'created');
  check('抑制结束后可以归档', archiveCalls.length === 1, JSON.stringify(result));

  console.log('\n[7] 归档失败要能重试');
  reset();
  tabs = makeTabs(1, 60);
  failNext = true;
  result = await api.evaluateWindow(1, 'created');
  check('归档抛错时不标记完成', result.skipped === 'archive-failed', JSON.stringify(result));
  result = await api.evaluateWindow(1, 'created');
  check('下一次事件重试成功', result.archived === 59 && archiveCalls.length === 2, JSON.stringify(result));

  console.log('\n[8] 五条标签窗口的完整流程');
  reset();
  local.tabOverflowThreshold = 5;
  tabs = makeTabs(3, 5, 4);
  await api.evaluateWindow(3, 'created');
  check('归档 4 个、保留当前的 1 个', archiveCalls[0].length === 4 && !archiveCalls[0].includes(3 * 1000 + 4), JSON.stringify(archiveCalls));
  const state = await api.readState();
  check('窗口状态记录在 session', state[3] && state[3].armed === false, JSON.stringify(state));

  console.log('\n----------------------------------------');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 条 / 通过 ' + passed + ' 条');
    for (const f of failures) console.log(' - ' + f);
    process.exit(1);
  }
  console.log('全部通过 ✅ (' + passed + ' 项)');
  process.exit(0);
})();
