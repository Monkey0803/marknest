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

/* ------------------- 浏览器书签增量同步 -------------------
 * 监听 Chrome 书签树的增删改，把变更写入 local 队列；前端消费并合并。
 * 只有用户在设置里开启 browserSync.enabled 后前端才会真正合并，
 * 未开启时事件会被前端清空，不会造成重复数据。 */
const BM_EVENTS_KEY = 'mn:browser-events';
const MAX_EVENTS = 500;

async function pushBmEvent(evt) {
  try {
    const obj = await chrome.storage.local.get(BM_EVENTS_KEY);
    const list = Array.isArray(obj[BM_EVENTS_KEY]) ? obj[BM_EVENTS_KEY] : [];
    // 同节点的「同类」事件按字段合并：既抑制队列膨胀，又保证 created 基础事件
    // 不会被随后的 changed/moved 挤掉。旧实现判断的是入站 evt.type，来一个 changed
    // 就把已入队的 created 一并删除，前端按 browserId 找不到书签 → 新增后改名/移动即丢失。
    let merged = false;
    const next = list.map((e) => {
      if (e.nodeId !== evt.nodeId || e.type !== evt.type) return e;
      merged = true;
      return { ...e, ...evt };
    });
    if (!merged) next.push(evt);
    await chrome.storage.local.set({ [BM_EVENTS_KEY]: next.slice(-MAX_EVENTS) });
  } catch (err) {
    console.warn('enqueue browser bookmark event failed', err);
  }
}

if (chrome.bookmarks && chrome.bookmarks.onCreated) {
  chrome.bookmarks.onCreated.addListener((id, node) => {
    void pushBmEvent({
      type: 'created', nodeId: id, title: node.title || '',
      url: node.url || '', parentId: node.parentId || null, at: Date.now(),
    });
  });
  chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    void pushBmEvent({
      type: 'changed', nodeId: id, title: changeInfo.title, url: changeInfo.url, at: Date.now(),
    });
  });
  chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    void pushBmEvent({ type: 'moved', nodeId: id, parentId: moveInfo.parentId, at: Date.now() });
  });
  chrome.bookmarks.onRemoved.addListener((id) => {
    void pushBmEvent({ type: 'removed', nodeId: id, at: Date.now() });
  });
}

/* ------------------- 死链巡检定时提醒 -------------------
 * 真正的检测由前端在数据面板触发（扩展页跨域 fetch 受限）；
 * 这里只负责按间隔唤醒，写一个巡检请求标记，前端打开时读取。 */
const HEALTH_ALARM = 'mn-health-check';
async function syncHealthAlarm() {
  try {
    await chrome.alarms.clear(HEALTH_ALARM);
    const obj = await chrome.storage.sync.get('mn:settings');
    const hs = obj['mn:settings']?.healthMonitor;
    if (hs && hs.enabled) {
      const hours = Math.max(1, Number(hs.intervalHours) || 24);
      await chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: hours * 60 });
    }
  } catch (err) {
    console.warn('sync health alarm failed', err);
  }
}
chrome.runtime.onInstalled.addListener(() => { void syncHealthAlarm(); });
chrome.runtime.onStartup?.addListener?.(() => { void syncHealthAlarm(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes['mn:settings']) void syncHealthAlarm();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== HEALTH_ALARM) return;
  void chrome.storage.local.set({ 'mn:health-due': Date.now() }).catch(() => {});
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

  // 右键收藏入队，交给前端走 addBookmark 正规流程落盘。
  // 早期版本曾在这里直接拼 v1 明文分片（mn:bm:N），但前端早已升级到 v3 压缩分片，
  // 导致右键收藏的书签前端根本读不到、且无去重——这里改为纯入队，格式只由前端一处维护。
  try {
    const key = 'mn:pending-add';
    const obj = await chrome.storage.sync.get(key);
    const list = obj[key] || [];
    const norm = (u) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    // 队列内去重：同一页面反复右键只保留一条
    if (list.some((item) => norm(item.url) === norm(url))) return;
    list.push({
      url,
      title,
      favicon: info.menuItemId === MENU_SAVE_LINK ? '' : (tab?.favIconUrl || ''),
      createdAt: Date.now(),
    });
    await chrome.storage.sync.set({ [key]: list.slice(-50) });
  } catch (err) {
    console.error('Marknest save failed', err);
  }
});
