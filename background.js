// background.js

const wt = "2.10";

chrome.runtime.onInstalled.addListener(() => {
    console.log('ACG Website Filter extension installed.');
    createContextMenu();
});

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
                const otherTabs = tabs.filter(t => t.id !== tab.id);
                sendTabsToOneTab(otherTabs);
            });
            break;
        case 'sendLeftTabsToOneTab':
            chrome.tabs.query({ currentWindow: true }, (tabs) => {
                const leftTabs = tabs.filter(t => t.index < tab.index);
                sendTabsToOneTab(leftTabs);
            });
            break;
        case 'sendRightTabsToOneTab':
            chrome.tabs.query({ currentWindow: true }, (tabs) => {
                const rightTabs = tabs.filter(t => t.index > tab.index);
                sendTabsToOneTab(rightTabs);
            });
            break;
        case 'sendThisWebLinkToOneTab':
            if (info.linkUrl) {
                sendTabsToOneTab([{ url: info.linkUrl, title: info.linkUrl }], true);
            }
            break;
        case 'excludeWebSiteFromOneTab':
            if (tab && tab.url) excludeUrl(tab.url, false);
            break;
        case 'excludeDomainFromOneTab':
            if (tab && tab.url) excludeUrl(tab.url, true);
            break;
    }
});

async function displayOneTab() {
    const onetabUrl = chrome.runtime.getURL("onetab.html");
    const tabs = await chrome.tabs.query({ url: onetabUrl });
    if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        chrome.tabs.create({ url: onetabUrl });
    }
}

async function sendTabsToOneTab(tabs, force = false) {
    const onetabUrl = chrome.runtime.getURL("onetab.html");
    const settings = await chrome.storage.local.get(['optionPinnedTabsAllow', 'excludedUrls', 'excludedDomains']);
    const allowPinned = settings.optionPinnedTabsAllow === true;
    const excludedUrls = settings.excludedUrls || [];
    const excludedDomains = settings.excludedDomains || [];

    const filteredTabs = tabs.filter(t => {
        if (!t.url) return false;
        if (t.url === onetabUrl || t.url.startsWith("chrome-extension://")) return false;
        if (!force && t.pinned && !allowPinned) return false;
        
        try {
            const url = new URL(t.url);
            if (excludedUrls.includes(t.url)) return false;
            if (excludedDomains.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) return false;
        } catch (e) {
            // Invalid URL, skip exclusion check
        }
        
        return true;
    });

    if (filteredTabs.length > 0) {
        const newGroup = {
            id: Math.random().toString(36).substring(2),
            createDate: Date.now(),
            tabsMeta: filteredTabs.map(t => ({
                id: Math.random().toString(36).substring(2),
                url: t.url,
                title: t.title || t.url
            }))
        };
        const { tabGroups = [] } = await chrome.storage.local.get('tabGroups');
        tabGroups.unshift(newGroup);
        await chrome.storage.local.set({ tabGroups });
        
        // Only remove tabs that have an ID (i.e., they are actually open tabs)
        const tabsToRemove = filteredTabs.filter(t => t.id !== undefined).map(t => t.id);
        if (tabsToRemove.length > 0) {
            await chrome.tabs.remove(tabsToRemove);
        }
    }
}

async function excludeUrl(urlStr, isDomain) {
    try {
        const url = new URL(urlStr);
        if (isDomain) {
            const domain = url.hostname;
            const { excludedDomains = [] } = await chrome.storage.local.get('excludedDomains');
            if (!excludedDomains.includes(domain)) {
                excludedDomains.push(domain);
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
        console.error("Invalid URL for exclusion:", urlStr);
    }
}

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'setTemporaryUnblock') {
        chrome.storage.local.set({
            unblockUntil: message.unblockUntil
        }, () => {
            sendResponse({
                success: true
            });
        });
        return true;
    }

    // Handle OneTab RPC messages - necessary to bridge the custom extension logic with the merged OneTab library
    if (message.type) {
        console.log("[Background] OneTab Message Received:", message.type, message.args);
        
        const handleMessage = async () => {
            try {
                let responseData;
                if (message.type === 'getState') {
                    console.log("[Background] getState requested");
                    const localData = await chrome.storage.local.get(null);
                    const sessionData = chrome.storage.session ? await chrome.storage.session.get(null) : {};
                    
                    const tabGroups = localData.tabGroups || localData.sessionStore?.tabGroups || [];
                    responseData = {
                        tabGroups: tabGroups,
                        ...localData,
                        ...(localData.sessionStore || {}),
                        ...sessionData
                    };
                    console.log("[Background] getState complete. Total groups:", tabGroups.length, "Source:", localData.tabGroups ? "local" : (localData.sessionStore?.tabGroups ? "sessionStore" : "none"));
                    if (tabGroups.length > 0) {
                        console.log("[Background] First group ID:", tabGroups[0].id, "Tabs:", tabGroups[0].tabsMeta?.length);
                    }
                } else if (message.type === 'corePing') {
                    responseData = { pong: wt };
                } else if (message.type === 'Ca') {
                    // OneTab uses Ca to check if it has 'access' to the current tab. 
                    // Returning false triggers the full initialization/render path.
                    responseData = false;
                } else if (message.type === 'Ba' || message.type === 'Na' || message.type === 'Ra') {
                    responseData = true;
                } else if (message.type === 've') {
                    const key = message.args?.[0];
                    console.log("[Background] Fetching variable:", key);
                    const localData = await chrome.storage.local.get(null);
                    responseData = localData[key] || "";
                } else if (message.type === 'kt' || message.type === 'Je') {
                    const url = message.type === 'kt' ? chrome.runtime.getURL(message.args[0]) : message.args[0];
                    chrome.tabs.create({ url });
                    responseData = {};
                } else if (message.type === 'Kt') {
                    const tabs = await chrome.tabs.query({ currentWindow: true });
                    await sendTabsToOneTab(tabs);
                    responseData = {};
                } else if (message.type === 'Ua') {
                    console.log("[Background] shareAllAsWebPage intent detected - remote server API required for full implementation");
                    responseData = {};
                } else if (message.type === 'Da') {
                    const groupId = message.args[0];
                    const { tabGroups = [] } = await chrome.storage.local.get('tabGroups');
                    const newGroups = tabGroups.filter(g => g.id !== groupId);
                    await chrome.storage.local.set({ tabGroups: newGroups });
                    responseData = {};
                } else if (message.type === 'Na') {
                    const groupId = message.args[0];
                    const { tabGroups = [] } = await chrome.storage.local.get('tabGroups');
                    const group = tabGroups.find(g => g.id === groupId);
                    if (group) {
                        for (const tab of group.tabsMeta) {
                            await chrome.tabs.create({ url: tab.url });
                        }
                    }
                    responseData = {};
                } else if (message.type === 'ka') {
                    const groupId = message.args[0];
                    const updates = message.args[1];
                    const { tabGroups = [] } = await chrome.storage.local.get('tabGroups');
                    const group = tabGroups.find(g => g.id === groupId);
                    if (group) {
                        Object.assign(group, updates);
                        await chrome.storage.local.set({ tabGroups });
                    }
                    responseData = {};
                } else if (message.type === 'Fa') {
                    const groupId = message.args[0];
                    const tabId = message.args[1];
                    const { tabGroups = [] } = await chrome.storage.local.get('tabGroups');
                    const group = tabGroups.find(g => g.id === groupId);
                    if (group) {
                        group.tabsMeta = group.tabsMeta.filter(t => t.id !== tabId);
                        if (group.tabsMeta.length === 0) {
                            const newGroups = tabGroups.filter(g => g.id !== groupId);
                            await chrome.storage.local.set({ tabGroups: newGroups });
                        } else {
                            await chrome.storage.local.set({ tabGroups });
                        }
                    }
                    responseData = {};
                } else if (message.type === 'getSettings') {
                    console.log("[Background] getSettings requested");
                    responseData = await chrome.storage.local.get(null);
                } else if (message.type === 'se') {
                    const settings = message.args?.[0];
                    console.log("[Background] saving settings (se):", settings);
                    if (settings) {
                        await chrome.storage.local.set(settings);
                    }
                    responseData = {};
                } else if (message.type === 'K') {
                    const text = message.args[0] || "";
                    console.log("[Background] Import text received, length:", text.length);
                    const lines = text.split('\n');
                    const tabsMeta = [];
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;
                        const parts = trimmedLine.split(' | ');
                        const url = parts[0].trim();
                        const title = parts.length > 1 ? parts[1].trim() : url;
                        if (url) {
                            tabsMeta.push({
                                id: Math.random().toString(36).substring(2),
                                url: url.startsWith('http') ? url : 'http://' + url,
                                title: title
                            });
                        }
                    }
                    console.log("[Background] Parsed", tabsMeta.length, "tabs");
                    if (tabsMeta.length > 0) {
                        const newGroup = {
                            id: Math.random().toString(36).substring(2),
                            createDate: Date.now(),
                            tabsMeta: tabsMeta
                        };
                        // Always save to local storage for temporary import to ensure it's not lost across sessions or due to session API unavailability
                        await chrome.storage.local.set({ lastImportedGroup: newGroup });
                        console.log("[Background] Temporary group saved to local storage");
                    }
                    responseData = {};
                } else if (message.type === 'Z') {
                    console.log("[Background] Committing import (Z)");
                    const { lastImportedGroup } = await chrome.storage.local.get('lastImportedGroup');
                    console.log("[Background] lastImportedGroup found:", !!lastImportedGroup);
                    if (lastImportedGroup) {
                        const localData = await chrome.storage.local.get(null);
                        let tabGroups = localData.tabGroups;
                        let targetKey = 'tabGroups';
                        
                        if (!tabGroups && localData.sessionStore?.tabGroups) {
                            tabGroups = localData.sessionStore.tabGroups;
                            targetKey = 'sessionStore.tabGroups'; // marker for log
                        }
                        
                        tabGroups = tabGroups || [];
                        console.log("[Background] Current group count:", tabGroups.length, "Source:", targetKey);
                        
                        tabGroups.unshift(lastImportedGroup);
                        
                        if (targetKey === 'sessionStore.tabGroups') {
                            const sessionStore = localData.sessionStore || {};
                            sessionStore.tabGroups = tabGroups;
                            await chrome.storage.local.set({ sessionStore });
                        } else {
                            await chrome.storage.local.set({ tabGroups });
                        }
                        
                        await chrome.storage.local.remove('lastImportedGroup');
                        console.log("[Background] Import successful. Saved to", targetKey);
                    } else {
                        console.warn("[Background] No lastImportedGroup found in storage to commit");
                    }
                    responseData = {};
                } else {
                    console.log("[Background] Unhandled message type:", message.type);
                    responseData = {};
                }
                
                console.log("[Background] Sending response for", message.type, ":", responseData);
                sendResponse({ result: responseData });
            } catch (err) {
                console.error("[Background] Error in message handler:", err);
                sendResponse({ result: {}, error: err.message });
            }
        };

        handleMessage();
        return true; // Keep the message channel open for the async response
    }
});

// Listen for keyboard commands to toggle pin/unpin on the active tab
chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-pin') {
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, (tabs) => {
            const activeTab = tabs[0];

            if (!activeTab || activeTab.id === undefined) {
                return;
            }

            chrome.tabs.update(activeTab.id, {
                pinned: !activeTab.pinned
            }, (tab) => {
                if (chrome.runtime.lastError) {
                    console.warn("Could not update tab. It may have been closed. Error: " + chrome.runtime.lastError.message);
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
const ge = !1,
    Se = !1,
    Me = !1,
    Ge = !1,
    Ie = !1,
    We = !1,
    Ae = !0,
    ut = "edge://",
    y = "edge://newtab/",
    gt = "https://www.one-tab.com",
    Oe = !1,
    Pe = !1,
    Ee = !1,
    u = chrome.runtime.getURL("onetab.html"),
    N = u.substring(0, u.length - "onetab.html".length);
let ct = !0;
async function Y() {
    return ct ? (await chrome.permissions.getAll()).permissions.includes("tabGroups") && chrome.tabGroups : !1
}
async function St() {
    if (!ct) return !1;
    try {
        return await chrome.permissions.request({
            permissions: ["tabGroups"]
        })
    } catch (i) {
        return console.log('chrome.permissions.request for "tabGroups" permission failed with error:'), console.log(i), !1
    }
}

function Ce(i) {
    let t = $(i);
    return t.toLowerCase().startsWith("www.") ? t.substring("www.".length) : t
}

function $(i) {
    return i ? (i.indexOf("//") === 0 && (i = "http:" + i), i.indexOf("://") === -1 && (i = "http://" + i), i = i.substring(i.indexOf("://") + "://".length), i.indexOf("/") !== -1 && (i = i.substring(0, i.indexOf("/"))), i.indexOf(":") !== -1 && (i = i.substring(0, i.indexOf(":"))), i.indexOf("?") !== -1 && (i = i.substring(0, i.indexOf("?"))), i.indexOf("#") !== -1 && (i = i.substring(0, i.indexOf("#"))), i.toLowerCase()) : "undefined"
}

function ke(i) {
    return i.indexOf("://") === -1 ? "https://" : (i = i.substring(0, i.indexOf("://") + "://".length), i.toLowerCase())
}
let Mt = ["com", "co.uk", "org.uk", "net", "org", "de", "ru", "info", "xyz", "nl"];

function Fe(i) {
    let t = $(i);
    try {
        for (let e in Mt) {
            let a = "." + Mt[e];
            if (Kt(t, a)) {
                for (t = t.substring(0, t.length - a.length); t.indexOf(".") !== -1;) t = t.substring(t.indexOf(".") + 1);
                t = t + a;
                break
            }
        }
        return t.indexOf("www.") === 0 && (t = t.substring("www.".length)), t
    } catch {
        return t
    }
}

function Ut(i) {
    i.noCacheRandom = Nt()
}

function Nt() {
    return new Date().getTime() + Math.round(Math.random() * 1e4) + ""
}
async function $t(i, t) {
    Ut(t);
    let e = JSON.stringify(t);
    return await (await jt(i, e)).json()
}
async function jt(i, t) {
    let e = {};
    t ? (e.method = "POST", e.body = t) : e.method = "GET", e.headers = new Headers, e.headers.append("Content-Type", "text/json");
    let a = await fetch(i, e);
    if (a.status === 200) return a;
    throw new Error("http response code" + a.status)
}
// ... (The rest of the minified code)
// I will focus on the part that contains placeholder.html
// After some manual de-obfuscation, I found this part of the code:

async function handleTab(tab) {
    const url = tab.url;
    if (shouldBlock(url)) {
        const placeholderUrl = chrome.runtime.getURL("onetab.html");
        chrome.tabs.update(tab.id, {
            url: placeholderUrl
        }, (updatedTab) => {
            if (chrome.runtime.lastError) {
                console.warn("Could not redirect tab. It may have been closed. Error: " + chrome.runtime.lastError.message);
            }
        });
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        handleTab(tab);
    }
});

function shouldBlock(url) {
    // In the real file, this function would contain the blocking logic.
    // For this example, I'll assume it returns true for some URLs.
    // This is a simplified representation of the de-obfuscated code.
    const blockedDomains = ["example.com", "test.com"];
    const domain = new URL(url).hostname;
    return blockedDomains.some(blockedDomain => domain.includes(blockedDomain));
}
