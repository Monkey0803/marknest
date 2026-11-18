/**
 * Marknest Service Worker
 * - 点击工具栏图标：打开侧边栏（Side Panel）
 * - 右键菜单：把当前页面/选中的链接收藏到 Marknest
 */

const MENU_SAVE_PAGE = 'mn-save-page';
const MENU_SAVE_LINK = 'mn-save-link';
const MENU_OPEN_MANAGER = 'mn-open-manager';

// 侧边栏初始化：点击图标时打开，并设置默认宽度
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.sidePanel.setOptions({ width: 400 }).catch(() => {});
});
// 每次 service worker 启动时也确保行为已设置（升级/重启后仍生效）
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  // 若当前窗口侧边栏未打开则打开；已打开时 open 会聚焦到该侧边栏
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error('open side panel failed', err);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SAVE_PAGE,
    title: '收藏此页面到 Marknest',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: MENU_SAVE_LINK,
    title: '收藏此链接到 Marknest',
    contexts: ['link'],
  });
  chrome.contextMenus.create({
    id: MENU_OPEN_MANAGER,
    title: '在大窗口打开 Marknest',
    contexts: ['page', 'action'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_OPEN_MANAGER) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return;
  }

  let title = '';
  let url = '';
  if (info.menuItemId === MENU_SAVE_LINK && info.linkUrl) {
    url = info.linkUrl;
    title = info.linkText || url;
  } else if (tab?.url) {
    url = tab.url;
    title = tab.title || url;
  }
  if (!url) return;

  // 直接写入 storage.sync 的书签分片，逻辑与前端 addBookmark 保持一致
  try {
    const metaObj = await chrome.storage.sync.get('mn:meta');
    const meta = metaObj['mn:meta'];
    const now = Date.now();
    const bookmark = {
      id: crypto.randomUUID(),
      title,
      url,
      description: '',
      groupId: null,
      tags: [],
      // 收藏整页用标签页图标；收藏链接时留空，由展示层按链接域名推导真实站点图标
      favicon: info.menuItemId === MENU_SAVE_LINK ? '' : (tab?.favIconUrl || ''),
      createdAt: now,
      updatedAt: now,
      visitedAt: 0,
      visits: 0,
      pinned: false,
      order: now,
    };

    if (meta && meta.bmChunks > 0) {
      const lastKey = `mn:bm:${meta.bmChunks - 1}`;
      const data = await chrome.storage.sync.get(lastKey);
      const chunk = data[lastKey] || [];
      chunk.push(bookmark);
      // 若分片过大则新建一片（保守 6000 字节）
      if (new TextEncoder().encode(JSON.stringify(chunk)).length > 6000) {
        const newKey = `mn:bm:${meta.bmChunks}`;
        await chrome.storage.sync.set({
          [newKey]: [bookmark],
          'mn:meta': { ...meta, bmChunks: meta.bmChunks + 1, updatedAt: now },
        });
      } else {
        await chrome.storage.sync.set({
          [lastKey]: chunk,
          'mn:meta': { ...meta, updatedAt: now },
        });
      }
    } else {
      await chrome.storage.sync.set({
        'mn:bm:0': [bookmark],
        'mn:meta': {
          version: 1,
          bmChunks: 1,
          grChunks: meta?.grChunks || 0,
          updatedAt: now,
          deviceId: meta?.deviceId || crypto.randomUUID(),
        },
      });
    }
  } catch (err) {
    console.error('Marknest save failed', err);
  }
});
