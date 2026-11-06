#!/usr/bin/env node
// dedupe.js 的纯函数单测（不需要浏览器）
//   node scripts/unit-dedupe.mjs
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

const ctx = vm.createContext({ console, URL });
vm.runInContext(readFileSync(join(root, 'domain_utils.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'dedupe.js'), 'utf8'), ctx);
const dedupe = ctx.HJX_DEDUPE;

const tab = (id, url, extra = {}) => ({ id, url, index: id, pinned: false, active: false, ...extra });

console.log('\n[1] dedupeKey');
check('同一 URL 相等', dedupe.dedupeKey('https://www.threads.com/@a/post/1') === dedupe.dedupeKey('https://www.threads.com/@a/post/1'));
check(
  'utm_* 被忽略',
  dedupe.dedupeKey('https://www.zhihu.com/question/1?utm_source=x&utm_medium=y') ===
    dedupe.dedupeKey('https://www.zhihu.com/question/1')
);
check(
  'xmt 被忽略',
  dedupe.dedupeKey('https://www.threads.com/@a/post/1?xmt=abc') ===
    dedupe.dedupeKey('https://www.threads.com/@a/post/1')
);
check(
  '查询参数顺序不影响',
  dedupe.dedupeKey('https://example.com/p?b=2&a=1') === dedupe.dedupeKey('https://example.com/p?a=1&b=2')
);
check('# 片段被忽略', dedupe.dedupeKey('https://example.com/p#top') === dedupe.dedupeKey('https://example.com/p'));
check(
  '有意义的查询参数保留（不误判重复）',
  dedupe.dedupeKey('https://example.com/list?page=1') !== dedupe.dedupeKey('https://example.com/list?page=2')
);
check(
  '不同路径不重复',
  dedupe.dedupeKey('https://www.threads.com/@a/post/1') !== dedupe.dedupeKey('https://www.threads.com/@a/post/2')
);
check('非法 URL 返回空串', dedupe.dedupeKey('not a url') === '');
check('tracking 参数识别', dedupe.isTrackingParam('UTM_Source') && dedupe.isTrackingParam('xmt') && !dedupe.isTrackingParam('page'));

console.log('\n[2] findDuplicateTabIds');
{
  const tabs = [
    tab(1, 'https://www.threads.com/@a/post/1?xmt=aaa'),
    tab(2, 'https://www.threads.com/@a/post/1?xmt=bbb'),
    tab(3, 'https://www.threads.com/@a/post/2')
  ];
  const ids = dedupe.findDuplicateTabIds(tabs, ['threads.com']);
  check('同页不同分享参数只关一个', ids.length === 1 && ids[0] === 2, JSON.stringify(ids));
}

{
  const tabs = [
    tab(1, 'https://www.zhihu.com/question/1?utm_source=a'),
    tab(2, 'https://www.zhihu.com/question/1'),
    tab(3, 'https://www.zhihu.com/question/2')
  ];
  const ids = dedupe.findDuplicateTabIds(tabs, ['zhihu.com']);
  check('知乎同题不同 utm 只关一个', ids.length === 1 && ids[0] === 2, JSON.stringify(ids));
}

{
  const tabs = [tab(1, 'https://www.threads.com/@a/post/1', { active: true }), tab(2, 'https://www.threads.com/@a/post/1')];
  const ids = dedupe.findDuplicateTabIds(tabs, ['threads.com']);
  check('保留当前激活的那个', ids.length === 1 && ids[0] === 2, JSON.stringify(ids));
}

{
  const tabs = [
    tab(1, 'https://www.threads.com/@a/post/1', { pinned: true }),
    tab(2, 'https://www.threads.com/@a/post/1')
  ];
  const ids = dedupe.findDuplicateTabIds(tabs, ['threads.com']);
  check('固定标签不关也不参与', ids.length === 0, JSON.stringify(ids));
}

{
  const tabs = [tab(1, 'https://example.com/dup'), tab(2, 'https://example.com/dup')];
  check('未配置域名完全不动', dedupe.findDuplicateTabIds(tabs, ['threads.com']).length === 0);
}

{
  const tabs = [tab(1, 'https://sub.threads.com/x'), tab(2, 'https://sub.threads.com/x')];
  const ids = dedupe.findDuplicateTabIds(tabs, ['threads.com']);
  check('子域名同样生效', ids.length === 1, JSON.stringify(ids));
}

{
  const tabs = [tab(1, 'https://notthreads.com/x'), tab(2, 'https://notthreads.com/x')];
  check('notthreads.com 不误判', dedupe.findDuplicateTabIds(tabs, ['threads.com']).length === 0);
}

{
  const tabs = [
    tab(1, 'https://www.threads.com/@a/post/1', { windowId: 1, index: 0 }),
    tab(2, 'https://www.threads.com/@a/post/1', { windowId: 2, index: 0 })
  ];
  const ids = dedupe.findDuplicateTabIds(tabs, ['threads.com']);
  check('跨窗口也算重复', ids.length === 1 && ids[0] === 2, JSON.stringify(ids));
}

{
  const tabs = [
    tab(1, 'chrome://extensions/'),
    tab(2, 'chrome://extensions/'),
    tab(3, undefined)
  ];
  check('非 http 页与空 URL 跳过', dedupe.findDuplicateTabIds(tabs, ['threads.com']).length === 0);
}

{
  const tabs = [
    tab(1, 'https://www.threads.com/@a/post/1', { active: true }),
    tab(2, 'https://www.threads.com/@a/post/1'),
    tab(3, 'https://www.threads.com/@a/post/1', { active: true })
  ];
  const ids = dedupe.findDuplicateTabIds(tabs, ['threads.com']);
  check('多个 active（异常数据）也只保留一个', ids.length === 2, JSON.stringify(ids));
}

console.log('\n----------------------------------------');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 条 / 通过 ' + passed + ' 条');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
console.log('全部通过 ✅ (' + passed + ' 项)');
