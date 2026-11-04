// 站点与规则总表 —— 域名、选择器、正则只应该在这里改。
//
// manifest.json 里的 content_scripts.matches / host_permissions 是静态的，
// 改完这里必须同步 manifest；`node scripts/verify.mjs` 会校验两边是否一致，
// 也会检查有没有残留的死文件、硬编码版本号。
globalThis.HJX_CONFIG = {
  // 访问拦截：命中 host + pathname 后，把当前标签换成 OneTab 队列里的下一条
  // （真正的顶替动作在 background.js 的 popAndRedirect）
  accessBlocks: [
    { name: '知乎', hosts: ['zhihu.com'], paths: ['/', '/follow', '/hot', '/column-square'] },
    { name: '小红书', hosts: ['xiaohongshu.com'], paths: ['/explore'] }
  ],

  // wnacg 列表页过滤与标题清洗
  wnacg: {
    listPrefixes: ['/albums-index-cate-', '/albums-index-page-', '/albums-favorite_ranking', '/search/'],
    listExact: ['/albums.html', '/'],
    // ::before 里出现即隐藏
    blockedCategoryText: ['/日語', '同人誌/English'],
    // 分类 class 直接隐藏
    blockedClasses: ['cate-12', 'cate-13', 'cate-14'],
    // 标题里剥掉的方括号标签与刊名后缀（顺序有影响，先标签后刊名）
    cleanupPatterns: [
      /\[[^\]]*?汉化[^\]]*?\]/g,
      /\[[^\]]*?漢化[^\]]*?\]/g,
      /\[[^\]]*?个人[^\]]*?\]/g,
      /\[[^\]]*?個人[^\]]*?\]/g,
      /\[[^\]]*?AI翻譯[^\]]*?\]/g,
      /\[[^\]]*?中国翻訳[^\]]*?\]/g,
      /\[[^\]]*?DL版[^\]]*?\]/g,
      /\[[^\]]*?無修正[^\]]*?\]/g,
      /\([^\)]*?COMIC BAVEL[^\)]*?\)/g,
      /\([^\)]*?COMIC アンスリウム[^\)]*?\)/g,
      /\([^\)]*?コミックリブート[^\)]*?\)/g,
      /\([^\)]*?アクションピザッツ[^\)]*?\)/g,
      /\([^\)]*?快楽天[^\)]*?\)/g,
      /\([^\)]*?COMIC 外楽[^\)]*?\)/g,
      /\([^\)]*?コミックゼロス[^\)]*?\)/g,
      /\([^\)]*?COMIC GEE[^\)]*?\)/g,
      /\([^\)]*?COMIC LO[^\)]*?\)/g,
      /\([^\)]*?COMIC 失楽天[^\)]*?\)/g,
      /\([^\)]*?G-エッヂ[^\)]*?\)/g,
      /\([^\)]*?コミックアンリアル[^\)]*?\)/g
    ]
  },

  // chunman4 论坛：标题含这些词的主题帖整行隐藏
  chunman: {
    hosts: ['chunman4.com'],
    blockedTitleKeywords: ['母', '妈', '媽', '偽娘', '伪娘']
  },

  // 纯跳转：把列表入口直接送到阅读模式（一次性，不涉及存储）
  redirects: [
    { hosts: ['jmcomic-zzz.one'], from: /^\/album\/(\d+)/, to: (m) => `/photo/${m[1]}` },
    { hosts: ['wnacg.com'], from: /^\/photos-index-aid-(\d+)/, to: (m) => `/photos-slide-aid-${m[1]}` }
  ],

  // 站点换域名时只改这里（以及 manifest 里对应的 matches）
  missav: { hosts: ['missav123.com', 'missav.live'] },

  // AI 聊天页：Enter 发送、Shift+Enter 换行、Ctrl+Enter 换行
  aiSites: [
    {
      id: 'gemini',
      label: 'Gemini',
      hosts: ['gemini.google.com'],
      input: ['div[contenteditable="true"]'],
      send: ['button[aria-label*="Send message"]', 'button[aria-label*="发送"]', '.send-button']
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      hosts: ['chatgpt.com'],
      input: ['#prompt-textarea.ProseMirror', 'div[contenteditable="true"][role="textbox"]', '#prompt-textarea'],
      send: ['button[data-testid="send-button"]', 'button[data-testid*="composer-send"]', 'button[aria-label*="Send"]']
    },
    {
      id: 'claude',
      label: 'Claude',
      hosts: ['claude.ai'],
      input: ['[aria-label="Send a message"][contenteditable="true"]', '.tiptap[contenteditable="true"]', 'div[contenteditable="true"]', 'div[role="textbox"]'],
      send: ['button[aria-label*="Send"]', 'button[data-testid="send-button"]']
    }
  ]
};
