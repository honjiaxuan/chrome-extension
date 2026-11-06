// OneTab 后端 + ACG 拦截后端
// 版本号唯一来源是 manifest.json（options.html 与 OneTab 前端也都改成读它）
importScripts('domain_utils.js');
importScripts('auto_mute.js');
importScripts('dedupe.js');

const wt = chrome.runtime.getManifest().version;

chrome.runtime.onInstalled.addListener(async () => {
    createContextMenu();

    // 自动静音 / 重复标签清理的默认配置只在键缺失时写入，避免覆盖用户已经删空的域名列表
    const data = await chrome.storage.local.get([
        'autoMuteEnabled',
        'autoMuteDomains',
        'dedupeEnabled',
        'dedupeDomains'
    ]);
    const patch = {};
    if (typeof data.autoMuteEnabled !== 'boolean') patch.autoMuteEnabled = true;
    if (!Array.isArray(data.autoMuteDomains)) patch.autoMuteDomains = ['threads.com'];
    if (typeof data.dedupeEnabled !== 'boolean') patch.dedupeEnabled = true;
    if (!Array.isArray(data.dedupeDomains)) patch.dedupeDomains = ['threads.com', 'zhihu.com'];
    if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch);
});

// ---------- 分组存储：兼容 tabGroups / sessionStore.tabGroups 两套键 ----------

async function readGroups() {
    const data = await chrome.storage.local.get(null);
    if (Array.isArray(data.tabGroups)) return { groups: data.tabGroups, storageKey: 'tabGroups' };
    if (Array.isArray(data.sessionStore?.tabGroups)) {
        return { groups: data.sessionStore.tabGroups, storageKey: 'sessionStore' };
    }
    return { groups: [], storageKey: 'tabGroups' };
}

async function writeGroups(groups, storageKey) {
    if (storageKey === 'sessionStore') {
        const { sessionStore = {} } = await chrome.storage.local.get('sessionStore');
        await chrome.storage.local.set({ sessionStore: { ...sessionStore, tabGroups: groups } });
    } else {
        await chrome.storage.local.set({ tabGroups: groups });
    }
}

const newId = () => Math.random().toString(36).substring(2);

// ---------- 右键菜单 ----------

function createContextMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'displayOneTab',
            title: chrome.i18n.getMessage('displayOneTab'),
            contexts: ['all']
        });
        chrome.contextMenus.create({
            id: 'separator1',
            type: 'separator',
            contexts: ['all']
        });
        chrome.contextMenus.create({
            id: 'sendOnlyThisTabToOneTab',
            title: chrome.i18n.getMessage('sendOnlyThisTabToOneTab'),
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'sendAllTabsToOneTab',
            title: chrome.i18n.getMessage('sendAllTabsToOneTab'),
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'sendAllTabsAllWindowsToOneTab',
            title: chrome.i18n.getMessage('sendAllTabsAllWindowsToOneTab'),
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'sendAllTabsExceptThisToOneTab',
            title: chrome.i18n.getMessage('sendAllTabsExceptThisToOneTab'),
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'sendLeftTabsToOneTab',
            title: chrome.i18n.getMessage('sendLeftTabsToOneTab'),
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'sendRightTabsToOneTab',
            title: chrome.i18n.getMessage('sendRightTabsToOneTab'),
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'separator2',
            type: 'separator',
            contexts: ['page', 'action']
        });
        chrome.contextMenus.create({
            id: 'sendThisWebLinkToOneTab',
            title: chrome.i18n.getMessage('sendThisWebLinkToOneTab'),
            contexts: ['link']
        });
        chrome.contextMenus.create({
            id: 'separator3',
            type: 'separator',
            contexts: ['page']
        });
        chrome.contextMenus.create({
            id: 'excludeWebSiteFromOneTab',
            title: chrome.i18n.getMessage('excludeWebSiteFromOneTab'),
            contexts: ['page']
        });
        chrome.contextMenus.create({
            id: 'excludeDomainFromOneTab',
            title: chrome.i18n.getMessage('excludeDomainFromOneTab').replace('DOMAIN.COM', 'this domain'),
            contexts: ['page']
        });
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
        case 'displayOneTab':
            displayOneTab();
            break;
        case 'sendOnlyThisTabToOneTab':
            if (tab) sendTabsToOneTab([tab], true);
            break;
        case 'sendAllTabsToOneTab':
            chrome.tabs.query({ currentWindow: true }, (tabs) => sendTabsToOneTab(tabs));
            break;
        case 'sendAllTabsAllWindowsToOneTab':
            chrome.tabs.query({}, (tabs) => sendTabsToOneTab(tabs));
            break;
        case 'sendAllTabsExceptThisToOneTab':
            chrome.tabs.query({ currentWindow: true }, (tabs) => {
                sendTabsToOneTab(tabs.filter((t) => t.id !== tab.id));
            });
            break;
        case 'sendLeftTabsToOneTab':
            chrome.tabs.query({ currentWindow: true }, (tabs) => {
                sendTabsToOneTab(tabs.filter((t) => t.index < tab.index));
            });
            break;
        case 'sendRightTabsToOneTab':
            chrome.tabs.query({ currentWindow: true }, (tabs) => {
                sendTabsToOneTab(tabs.filter((t) => t.index > tab.index));
            });
            break;
        case 'sendThisWebLinkToOneTab':
            if (info.linkUrl) sendTabsToOneTab([{ url: info.linkUrl, title: info.linkUrl }], true);
            break;
        case 'excludeWebSiteFromOneTab':
            if (tab && tab.url) excludeUrl(tab.url, false);
            break;
        case 'excludeDomainFromOneTab':
            if (tab && tab.url) excludeUrl(tab.url, true);
            break;
    }
});

// ---------- 标签页操作 ----------

async function displayOneTab() {
    const onetabUrl = chrome.runtime.getURL('onetab.html');
    const tabs = await chrome.tabs.query({ url: onetabUrl });
    if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        chrome.tabs.create({ url: onetabUrl });
    }
}

// 工具栏图标：没有 default_popup，点一下就在标签页里打开整页设置（已开则聚焦）
async function openSettingsPage() {
    const settingsUrl = chrome.runtime.getURL('settings.html');
    const tabs = await chrome.tabs.query({ url: settingsUrl });
    if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
        return;
    }
    chrome.tabs.create({ url: settingsUrl });
}

chrome.action.onClicked.addListener(() => {
    // 点图标 = 清一遍配置域名里的重复标签，然后打开整页设置（能看到清理结果）
    HJX_DEDUPE.closeDuplicates()
        .catch((err) => console.warn('[dedupe] 清理失败:', err))
        .finally(() => openSettingsPage());
});

async function sendTabsToOneTab(tabs, force = false) {
    const onetabUrl = chrome.runtime.getURL('onetab.html');
    const settings = await chrome.storage.local.get(['optionPinnedTabsAllow', 'excludedUrls', 'excludedDomains']);
    const allowPinned = settings.optionPinnedTabsAllow === true;
    const excludedUrls = settings.excludedUrls || [];
    const excludedDomains = settings.excludedDomains || [];

    const filteredTabs = tabs.filter((t) => {
        if (!t.url) return false;
        if (t.url === onetabUrl || t.url.startsWith('chrome-extension://')) return false;
        if (!force && t.pinned && !allowPinned) return false;

        try {
            const url = new URL(t.url);
            if (excludedUrls.includes(t.url)) return false;
            if (excludedDomains.some((d) => url.hostname === d || url.hostname.endsWith('.' + d))) return false;
        } catch (e) {
            // about: / data: 之类解析失败的直接放过，由下面 tabs.remove 决定
        }

        return true;
    });

    if (filteredTabs.length === 0) return;

    const newGroup = {
        id: newId(),
        createDate: Date.now(),
        tabsMeta: filteredTabs.map((t) => ({
            id: newId(),
            url: t.url,
            title: t.title || t.url
        }))
    };

    const { groups, storageKey } = await readGroups();
    groups.unshift(newGroup);
    await writeGroups(groups, storageKey);

    const tabsToRemove = filteredTabs.filter((t) => t.id !== undefined).map((t) => t.id);
    if (tabsToRemove.length > 0) await chrome.tabs.remove(tabsToRemove);
}

async function excludeUrl(urlStr, isDomain) {
    try {
        const url = new URL(urlStr);
        if (isDomain) {
            const { excludedDomains = [] } = await chrome.storage.local.get('excludedDomains');
            if (!excludedDomains.includes(url.hostname)) {
                excludedDomains.push(url.hostname);
                await chrome.storage.local.set({ excludedDomains });
            }
        } else {
            const { excludedUrls = [] } = await chrome.storage.local.get('excludedUrls');
            if (!excludedUrls.includes(urlStr)) {
                excludedUrls.push(urlStr);
                await chrome.storage.local.set({ excludedUrls });
            }
        }
    } catch (e) {
        console.error('Invalid URL for exclusion:', urlStr);
    }
}

// 从队列里弹出一条顶替当前标签（访问拦截的落地动作）
async function popFirstTabAndRedirect(tabId) {
    const { groups, storageKey } = await readGroups();
    const first = groups[0];

    if (!first || !Array.isArray(first.tabsMeta) || first.tabsMeta.length === 0) {
        chrome.tabs.update(tabId, { url: chrome.runtime.getURL('onetab.html') });
        return;
    }

    const next = first.tabsMeta.shift();
    if (first.tabsMeta.length === 0) groups.shift();
    await writeGroups(groups, storageKey);

    chrome.tabs.update(tabId, { url: next.url });
}

// 恢复整组（OneTab 的 restore all）
async function restoreGroup(groupId, opener) {
    const { groups } = await readGroups();
    const group = groups.find((g) => g.id === groupId);
    if (!group || !Array.isArray(group.tabsMeta) || group.tabsMeta.length === 0) return;

    const urls = group.tabsMeta.map((t) => t.url).filter(Boolean);
    if (urls.length === 0) return;

    if (typeof opener === 'string' && opener.startsWith('newWindow')) {
        await chrome.windows.create({ url: urls });
        return;
    }
    for (const url of urls) {
        await chrome.tabs.create({ url });
    }
}

// 组内 / 跨组移动标签（拖拽）
async function moveTab(sourceGroupId, targetGroupId, tabId, targetIndex) {
    const { groups, storageKey } = await readGroups();
    const source = groups.find((g) => g.id === sourceGroupId);
    const target = groups.find((g) => g.id === targetGroupId);
    if (!source || !target) return false;

    const index = source.tabsMeta.findIndex((t) => t.id === tabId);
    if (index === -1) return false;

    const [moved] = source.tabsMeta.splice(index, 1);
    const insertAt = Number.isInteger(targetIndex)
        ? Math.max(0, Math.min(targetIndex, target.tabsMeta.length))
        : target.tabsMeta.length;
    target.tabsMeta.splice(insertAt, 0, moved);

    // 源组空了就删掉（跨组移动时）
    const cleaned = groups.filter((g) => g.tabsMeta.length > 0 || g.id === target.id);
    await writeGroups(cleaned, storageKey);
    return true;
}

// ---------- 消息路由 ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 内容脚本专用：访问拦截时把队列里的一条顶替当前标签
    if (message.action === 'popAndRedirect') {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
            popFirstTabAndRedirect(tabId).catch((e) => console.warn('[popAndRedirect]', e));
        }
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'setTemporaryUnblock') {
        chrome.storage.local
            .set({ unblockUntil: Number(message.unblockUntil) || 0 })
            .then(() => sendResponse({ success: true }))
            .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;
    }

    if (!message.type) return false;

    (async () => {
        try {
            let responseData;

            switch (message.type) {
                case 'getState': {
                    const localData = await chrome.storage.local.get(null);
                    const sessionData = chrome.storage.session ? await chrome.storage.session.get(null) : {};
                    const tabGroups = localData.tabGroups || localData.sessionStore?.tabGroups || [];
                    responseData = {
                        tabGroups,
                        ...localData,
                        ...(localData.sessionStore || {}),
                        ...sessionData
                    };
                    break;
                }
                case 'corePing':
                    responseData = { pong: wt };
                    break;
                case 'Ca':
                    responseData = false;
                    break;
                case 've': {
                    const key = message.args?.[0];
                    const localData = await chrome.storage.local.get(null);
                    responseData = localData[key] || '';
                    break;
                }
                case 'kt':
                case 'Je': {
                    const url = message.type === 'kt' ? chrome.runtime.getURL(message.args[0]) : message.args[0];
                    chrome.tabs.create({ url });
                    responseData = {};
                    break;
                }
                case 'Kt': {
                    const tabs = await chrome.tabs.query({ currentWindow: true });
                    await sendTabsToOneTab(tabs);
                    responseData = {};
                    break;
                }
                case 'Ua':
                    responseData = {};
                    break;
                case 'dedupeNow':
                    responseData = await HJX_DEDUPE.closeDuplicates();
                    break;
                case 'Da': {
                    const { groups, storageKey } = await readGroups();
                    await writeGroups(groups.filter((g) => g.id !== message.args[0]), storageKey);
                    responseData = {};
                    break;
                }
                // 恢复整组（旧版这里被上面的 'Ba'/'Na'/'Ra' 分支提前吃掉，永远不执行）
                case 'Na':
                    await restoreGroup(message.args?.[0], message.args?.[1]);
                    responseData = {};
                    break;
                // 组内移动 / 跨组移动
                case 'Ra':
                    await moveTab(message.args?.[0], message.args?.[0], message.args?.[1], message.args?.[2]);
                    responseData = {};
                    break;
                case 'Ba':
                    await moveTab(message.args?.[0], message.args?.[1], message.args?.[2], message.args?.[3]);
                    responseData = {};
                    break;
                case 'ka': {
                    const { groups, storageKey } = await readGroups();
                    const group = groups.find((g) => g.id === message.args?.[0]);
                    if (group) {
                        Object.assign(group, message.args?.[1] || {});
                        await writeGroups(groups, storageKey);
                    }
                    responseData = {};
                    break;
                }
                case 'Fa': {
                    const { groups, storageKey } = await readGroups();
                    const group = groups.find((g) => g.id === message.args?.[0]);
                    if (group) {
                        group.tabsMeta = group.tabsMeta.filter((t) => t.id !== message.args?.[1]);
                        await writeGroups(
                            groups.filter((g) => g.tabsMeta.length > 0),
                            storageKey
                        );
                    }
                    responseData = {};
                    break;
                }
                case 'getSettings':
                    responseData = await chrome.storage.local.get(null);
                    break;
                case 'se': {
                    const settings = message.args?.[0];
                    if (settings) await chrome.storage.local.set(settings);
                    responseData = {};
                    break;
                }
                case 'K': {
                    const text = message.args?.[0] || '';
                    const tabsMeta = [];
                    for (const line of text.split('\n')) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        const parts = trimmed.split(' | ');
                        const url = parts[0].trim();
                        const title = parts.length > 1 ? parts[1].trim() : url;
                        if (!url) continue;
                        tabsMeta.push({
                            id: newId(),
                            url: url.startsWith('http') ? url : 'http://' + url,
                            title
                        });
                    }
                    if (tabsMeta.length > 0) {
                        await chrome.storage.local.set({
                            lastImportedGroup: { id: newId(), createDate: Date.now(), tabsMeta }
                        });
                    }
                    responseData = {};
                    break;
                }
                case 'Z': {
                    const { lastImportedGroup } = await chrome.storage.local.get('lastImportedGroup');
                    if (lastImportedGroup) {
                        const { groups, storageKey } = await readGroups();
                        groups.unshift(lastImportedGroup);
                        await writeGroups(groups, storageKey);
                        await chrome.storage.local.remove('lastImportedGroup');
                    }
                    responseData = {};
                    break;
                }
                default:
                    responseData = {};
            }

            sendResponse({ result: responseData });
        } catch (err) {
            console.error('[Background] Error in message handler:', err);
            sendResponse({ result: {}, error: err.message });
        }
    })();

    return true;
});

// ---------- 快捷键 ----------

chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-pin') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (!activeTab || activeTab.id === undefined) return;
            chrome.tabs.update(activeTab.id, { pinned: !activeTab.pinned }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('Could not update tab: ' + chrome.runtime.lastError.message);
                }
            });
        });
    } else if (command === 'display-onetab') {
        displayOneTab();
    } else if (command === 'send-current-tab-to-onetab') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) sendTabsToOneTab([tabs[0]], true);
        });
    }
});

// 域名自动静音：注册监听 + 启动/SW 重启时按当前配置对齐所有标签
HJX_AUTO_MUTE.init();
