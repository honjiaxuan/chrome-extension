// 读取存储的关键词列表，并隐藏匹配的 `li.gallary_item`
console.log(window.location.hostname);
console.log(window.location.pathname);

// Create block overlay function
function createBlockOverlay() {
    chrome.runtime.sendMessage({ action: "popAndRedirect" });
}

// Remove block overlay function
function removeBlockOverlay() {
    const overlay = document.getElementById('acg-block-overlay');
    if (overlay) {
        overlay.remove();
        console.log("Removed block overlay from page");
    }
}

const CHUNMAN_BLOCKED_TITLE_KEYWORDS = ["母", "妈", "媽", "偽娘", "伪娘"];
const CHUNMAN_HIDDEN_ATTRIBUTE = "data-acg-chunman-hidden";

function restoreChunmanHiddenThreads() {
    document.querySelectorAll(`[${CHUNMAN_HIDDEN_ATTRIBUTE}="true"]`).forEach(item => {
        item.style.display = "";
        item.removeAttribute(CHUNMAN_HIDDEN_ATTRIBUTE);
    });
}

function titleContainsBlockedKeyword(titleText) {
    return CHUNMAN_BLOCKED_TITLE_KEYWORDS.some(keyword => titleText.includes(keyword));
}

function hideChunmanForumThreads() {
    document.querySelectorAll("th.forumtit").forEach(threadCell => {
        const titleElement = threadCell.querySelector("a.s.xst");
        if (!titleElement) {
            return;
        }

        const titleText = titleElement.textContent.replace(/\s+/g, " ").trim();
        const targetElement = threadCell.closest("tr") || threadCell;

        if (!titleText) {
            return;
        }

        if (titleContainsBlockedKeyword(titleText)) {
            targetElement.style.display = "none";
            targetElement.setAttribute(CHUNMAN_HIDDEN_ATTRIBUTE, "true");
            return;
        }

        if (targetElement.getAttribute(CHUNMAN_HIDDEN_ATTRIBUTE) === "true") {
            targetElement.style.display = "";
            targetElement.removeAttribute(CHUNMAN_HIDDEN_ATTRIBUTE);
        }
    });
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "refreshBlocking") {
        applyBlocking();
        sendResponse({ success: true });
        return true;
    }

    if (message.action === "removeOverlay") {
        removeBlockOverlay();
        sendResponse({ success: true });
    } else if (message.action === "addOverlay") {
        createBlockOverlay();
        sendResponse({ success: true });
    }
    return true;
});





// --- Independent Redirect Logic (Always Active) ---

// Handle JMComic album to photo redirect
if (window.location.hostname === "jmcomic-zzz.one" && window.location.pathname.startsWith("/album/")) {
    const albumId = window.location.pathname.replace("/album/", "").split("/")[0];
    if (albumId) {
        const photoUrl = `https://jmcomic-zzz.one/photo/${albumId}`;
        console.log(`Redirecting from ${window.location.href} to ${photoUrl}`);
        window.location.href = photoUrl;
    }
}

// Handle WNACG photos-index-aid to photos-slide-aid redirect
if (window.location.hostname.endsWith("wnacg.com") && window.location.pathname.startsWith("/photos-index-aid-")) {
    const aid = window.location.pathname.match(/\/photos-index-aid-(\d+)/)?.[1];
    if (aid && /^\d+$/.test(aid)) {
        const slideUrl = `https://${window.location.hostname}/photos-slide-aid-${aid}`;
        console.log(`Redirecting from ${window.location.href} to ${slideUrl}`);
        window.location.href = slideUrl;
    }
}

// --- End of Independent Redirect Logic ---

// Check if sites should be temporarily unblocked
function checkIfTemporarilyUnblocked() {
    return safeStorageGet(["unblockUntil"]).then(data => {
        const unblockUntil = data.unblockUntil || 0;
        const currentTime = Date.now();
        return currentTime < unblockUntil;
    });
}

function safeStorageGet(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (data) => {
                if (chrome.runtime.lastError) {
                    console.debug("Storage access failed (extension context likely invalidated)");
                    resolve({});
                } else {
                    resolve(data);
                }
            });
        } catch (e) {
            console.debug("Extension context invalidated, stopping storage access");
            resolve({});
        }
    });
}

// Function to apply all blocking logic
function applyBlocking() {
    // 1. Check for Access Blocking Overlays (Affected by Switch)
    safeStorageGet(["extensionEnabled"]).then(data => {
        if (data.extensionEnabled === false) {
            console.log("Access blocking disabled by master switch");
            removeBlockOverlay();
        } else {
            checkIfTemporarilyUnblocked().then(isUnblocked => {
                if (isUnblocked) {
                    removeBlockOverlay();
                } else {
                    // Block access to zhihu.com homepage
                    if (window.location.href === "https://www.zhihu.com/" ||
                        window.location.href === "https://www.zhihu.com/follow" ||
                        window.location.href === "https://www.zhihu.com/hot" ||
                        window.location.href === "https://www.zhihu.com/column-square" 
                    ) {
                        createBlockOverlay();
                        console.log("Blocked access to zhihu.com homepage");
                    } 
                    // Block access to xiaohongshu.com/explore
                    else if (window.location.href === "https://www.xiaohongshu.com/explore" || 
                             window.location.href === "https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend") {
                        createBlockOverlay();
                        console.log("Blocked access to xiaohongshu.com explore page");
                    }
                }
            });
        }
    });

    // 2. Continuous Filtering & Keyword Logic (Always Active - NOT affected by switch)
    checkIfTemporarilyUnblocked().then(isUnblocked => {
        if (isUnblocked) {
            console.log("Filters temporarily disabled via meditation/unblock text");
            // Show all hidden elements if they were hidden by this script
            document.querySelectorAll(".li.gallary_item").forEach(item => {
                if (item.style.display === "none") {
                    item.style.display = "";
                }
            });
            restoreChunmanHiddenThreads();
            return;
        }

        // Apply filters for wnacg.com
        if (window.location.hostname.endsWith("wnacg.com")) {
            const isListPage = (
                window.location.pathname.startsWith("/albums-index-cate-") ||
                window.location.pathname.startsWith("/albums-index-page-") ||
                window.location.pathname.startsWith("/albums-favorite_ranking") ||
                window.location.pathname.startsWith("/search/") ||
                window.location.pathname.startsWith("/search/index.php") ||
                window.location.pathname === "/albums.html" ||
                window.location.pathname === "/"
            );

            if (isListPage) {
                let cachedBlockedKeywords = null;
                async function fetchBlockedKeywords() {
                    try {
                        const data = await chrome.storage.local.get(['blockedKeywords']);
                        cachedBlockedKeywords = data.blockedKeywords || [];
                    } catch (e) {
                        cachedBlockedKeywords = [];
                    }
                }

                async function hideItems() {
                    if (cachedBlockedKeywords === null) {
                        await fetchBlockedKeywords();
                    }

                    document.querySelectorAll(".li.gallary_item").forEach(item => {
                        // 1. Category Filtering via ::before content or class
                        let picBox = item.querySelector(".pic_box[class*='cate-']");
                        if (picBox) {
                            const rawContent = window.getComputedStyle(picBox, '::before').getPropertyValue('content');
                            // Normalize content: remove quotes and handle both full-width and half-width slashes/ampersands
                            const normalizedContent = rawContent.replace(/['"]/g, "")
                                .replace(/／/g, "/")
                                .replace(/＆/g, "&");

                            const isBlockedCategory = 
                                normalizedContent.includes("/日語") || 
                                normalizedContent.includes("同人誌/English") ||
                                picBox.classList.contains("cate-14") || // Direct class check for Magazine/Short Stories
                                picBox.classList.contains("cate-12") || // Doujinshi
                                picBox.classList.contains("cate-13");   // Single Volumes

                            if (isBlockedCategory) {
                                item.style.display = "none";
                                return;
                            }
                        }

                        let titleElement = item.querySelector(".title a");
                        if (!titleElement) return;

                        let rawHTML = titleElement.innerHTML;
                        let plainText = rawHTML.replace(/<\/?em>/g, "");

                        // 2. Blocked Keywords Hiding
                        if (cachedBlockedKeywords.length > 0) {
                            const titleText = titleElement.innerText || titleElement.textContent || "";
                            const isBlockedByKeyword = cachedBlockedKeywords.some(kw => titleText.includes(kw));
                            if (isBlockedByKeyword) {
                                item.style.display = "none";
                                return;
                            }
                        }

                        // 3. Title cleaning logic
                        let cleanedTitle = plainText.replace(/\[[^\]]*?汉化[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\[[^\]]*?个人[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\[[^\]]*?AI翻譯[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\[[^\]]*?個人[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\[[^\]]*?中国翻訳[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\[[^\]]*?漢化[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\[[^\]]*?DL版[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\[[^\]]*?無修正[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();

                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?COMIC BAVEL[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?COMIC アンスリウム[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?コミックリブート[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?アクションピザッツ[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?快楽天[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?COMIC 外楽[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?コミックゼロス[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?COMIC GEE[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?COMIC LO[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?COMIC 失楽天[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?G-エッヂ[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        cleanedTitle = cleanedTitle.replace(/\([^\)]*?コミックアンリアル[^\)]*?\)/g, "").replace(/\s+/g, " ").trim();
                        
                        if (titleElement.innerText !== cleanedTitle) {
                            titleElement.innerText = cleanedTitle;
                            titleElement.title = cleanedTitle;
                        }
                    });
                }
                
                fetchBlockedKeywords().then(() => hideItems());
                
                if (!window.acgWnacgObserverSet) {
                    let wnacgDebounceTimer;
                    const observer = new MutationObserver(() => {
                        clearTimeout(wnacgDebounceTimer);
                        wnacgDebounceTimer = setTimeout(() => {
                            hideItems().catch(e => console.debug("hideItems error:", e));
                        }, 300);
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                    window.acgWnacgObserverSet = true;
                }
            }
        }

        if (window.location.hostname === "chunman4.com") {
            hideChunmanForumThreads();

            if (!window.acgChunmanObserverSet) {
                let chunmanDebounceTimer;
                const observer = new MutationObserver(() => {
                    clearTimeout(chunmanDebounceTimer);
                    chunmanDebounceTimer = setTimeout(() => hideChunmanForumThreads(), 300);
                });
                observer.observe(document.body, { childList: true, subtree: true });
                window.acgChunmanObserverSet = true;
            }
        }




    });
}

// Set up periodic check for unblock status (every 30 seconds)
setInterval(() => {
    applyBlocking();
}, 30000);

// Execute main logic after checking unblock status
applyBlocking();
