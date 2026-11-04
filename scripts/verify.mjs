#!/usr/bin/env node
// 静态自检：改完扩展先跑这个，能抓住 manifest 引用错、死文件、
// 硬编码版本号、config 与 manifest 域名不一致这几类问题。
//   node scripts/verify.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), 'utf8');

const errors = [];
const warns = [];
const ok = (msg) => console.log('  ok   ' + msg);
const fail = (msg) => {
  errors.push(msg);
  console.log('  FAIL ' + msg);
};
const warn = (msg) => {
  warns.push(msg);
  console.log('  warn ' + msg);
};

console.log('\n[1] manifest.json');
let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
  ok('JSON 可解析');
} catch (e) {
  fail('manifest.json 解析失败: ' + e.message);
  process.exit(1);
}
if (manifest.manifest_version !== 3) fail('manifest_version 必须是 3');
if (!manifest.minimum_chrome_version) fail('缺少 minimum_chrome_version（storage.session / world:MAIN 有最低版本要求）');

console.log('\n[2] manifest 引用的文件都存在');
const manifestRefs = [
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
  ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || [])
].filter(Boolean);
for (const ref of new Set(manifestRefs)) {
  if (ref.includes('*')) continue;
  if (existsSync(join(root, ref))) ok(ref);
  else fail('manifest 引用了不存在的文件: ' + ref);
}

console.log('\n[3] HTML 里的本地 script/link 都存在');
const htmlFiles = readdirSync(root).filter((f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  const html = read(file);
  const refs = [
    ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g),
    ...html.matchAll(/<link[^>]+href=["']([^"']+)["']/g)
  ]
    .map((m) => m[1])
    .filter((src) => !/^(https?:)?\/\//.test(src) && !src.startsWith('data:'));
  for (const ref of refs) {
    if (existsSync(join(root, ref))) ok(file + ' -> ' + ref);
    else fail(file + ' 引用了不存在的文件: ' + ref);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html)) {
    fail(file + ' 含内联脚本（extension_pages CSP 会拦）');
  }
  if (/\son[a-z]+\s*=/i.test(html)) warn(file + ' 含内联事件处理属性（onclick 等）');
}

console.log('\n[4] 没有孤儿文件（顶层 js/html 必须被引用）');
const allSources = htmlFiles.map((f) => read(f)).concat(readdirSync(root).filter((f) => f.endsWith('.js')).map((f) => read(f)));
for (const file of readdirSync(root).filter((f) => f.endsWith('.js') || f.endsWith('.html'))) {
  if (manifestRefs.includes(file)) {
    ok(file);
    continue;
  }
  const referenced = allSources.some((src) => src.includes(file));
  if (referenced) ok(file);
  else fail('没人引用的死文件: ' + file);
}

console.log('\n[5] 扩展版本号只有一个来源（manifest.json）');
const version = manifest.version;
const versionedFiles = [
  'background.js',
  'ext-onetab-concatenated-sources-onetab.js',
  'ext-onetab-concatenated-sources-options.js',
  'options.html',
  'popup.html'
];
for (const file of versionedFiles) {
  if (read(file).includes(version)) fail(file + ' 里还有硬编码版本号 ' + version);
  else ok(file + ' 无硬编码版本号');
}

console.log('\n[6] config.js 与 manifest 域名一致');
let config;
try {
  const ctx = vm.createContext({});
  vm.runInContext(read('config.js'), ctx);
  config = ctx.HJX_CONFIG;
  ok('config.js 可执行');
} catch (e) {
  fail('config.js 执行失败: ' + e.message);
}

if (config) {
  const hosts = new Set([
    ...(config.accessBlocks || []).flatMap((b) => b.hosts),
    ...(config.registered?.hosts || []),
    ...(config.chunman?.hosts || []),
    ...(config.redirects || []).flatMap((r) => r.hosts),
    ...(config.missav?.hosts || []),
    ...(config.aiSites || []).flatMap((s) => s.hosts)
  ]);
  const manifestText = JSON.stringify(manifest);
  const matches = (manifest.content_scripts || []).flatMap((cs) => cs.matches || []);
  for (const host of hosts) {
    if (!manifestText.includes(host)) fail('config 里的域名没进 manifest: ' + host);
    else if (!matches.some((m) => m.includes(host))) fail('域名没有对应的 content_scripts.matches: ' + host);
    else ok(host);
  }
}

console.log('\n[7] 权限最小化');
const declared = new Set(manifest.permissions || []);
const sourceText = readdirSync(root)
  .filter((f) => f.endsWith('.js'))
  .map((f) => read(f))
  .join('\n');
for (const perm of declared) {
  if (perm === 'unlimitedStorage' || perm === 'storage' || perm === 'tabs' || perm === 'contextMenus') continue;
  if (!sourceText.includes('chrome.' + perm)) warn('声明了但没用到: ' + perm);
}

console.log('\n[8] 危险写法');
if (/\.innerHTML\s*=/.test(read('popup.js'))) warn('popup.js 用了 innerHTML');
for (const file of ['content.js', 'ai_shortcuts.js', 'missav_main.js', 'background.js', 'auto_mute.js']) {
  const src = read(file);
  if (/\beval\s*\(/.test(src)) fail(file + ' 用了 eval');
  if (/innerHTML\s*=/.test(src)) warn(file + ' 用了 innerHTML');
}
ok('检查完成');

console.log('\n----------------------------------------');
if (warns.length) console.log('警告 ' + warns.length + ' 条');
if (errors.length) {
  console.log('失败 ' + errors.length + ' 条');
  process.exit(1);
}
console.log('全部通过 ✅');
