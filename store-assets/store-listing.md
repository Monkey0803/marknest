# Marknest · 书签管家 — Chrome 应用商店上架文案

> 直接从下方复制到开发者控制台对应字段即可。

## 扩展名称（Name，≤75 字符）

```
Marknest · 书签管家
```

## 简短描述（Summary，≤132 字符）

```
侧边栏书签管理器：分组、标签、搜索、重复检测，一键收藏当前标签页，数据随 Google 账户自动同步。
```

## 详细描述（Description）

```
把书签管理变成一个安静、顺手的地方。Marknest 是一个常驻浏览器右侧的书签侧边栏，高度与窗口一致，随时呼出，帮你把收藏过的内容真正找回来。

核心功能

• 侧边栏随手可用
点击工具栏图标即在右侧展开侧边栏，与浏览器窗口等高，不打断当前浏览。支持浅色 / 深色 / 跟随系统三种主题。

• 分组与标签
用分组和标签 Organize 书签，支持自定义分组颜色、拖动排序、置顶常用项。新建分组有统一的面板，可实时预览配色。

• 一键收藏当前标签页
在「当前标签页」视图查看所有已打开的标签（可切换全部窗口 / 当前窗口），单条收藏或一键批量收藏，收藏时可指定分组或即时新建分组。

• 搜索与筛选
按标题、网址、标签、备注即时搜索；按分组、标签筛选；多种排序方式（手动、最近添加、访问次数、标题）。

• 重复检测
自动发现重复网址，帮你清理冗余收藏。

• 网站图标
每条书签显示网站真实 logo（favicon），收藏标签页时自动保存，无需手动维护。

• 云同步，无需配置
数据通过 Chrome 官方的 storage.sync 保存。只要在 Chrome 中登录 Google 账户并开启同步，书签就会自动同步到你所有的设备，并通过变更监听实时更新——没有后端、不需要注册账号、无需 OAuth 配置。顶部同步徽标随时显示同步状态。

• 导入 / 导出
支持 JSON 导入与导出，数据始终由你自己掌控。

隐私优先

Marknest 不运营任何服务器，不收集个人资料，不申请网站访问权限，不读取浏览历史或 Cookie。你的书签只保存在本机，并通过 Chrome 官方机制同步到你自己的 Google 账户。开发者无法访问你的数据。

容量说明

Chrome 的同步存储有容量上限（总量约 100KB、单条约 8KB）。Marknest 采用分片存储，可容纳数百条书签；超出上限时会在界面提示导出备份。

---
如有建议或问题，欢迎通过下方开发者联系方式反馈。
```

## 分类（Category）

```
生产力（Productivity）
```

## 权限说明（Privacy practices → Permission justification）

| 权限 | 说明（英文版见下） |
|---|---|
| `storage` | 保存书签、分组和界面偏好，并通过 Chrome 官方同步机制在用户自己的设备间同步。 |
| `tabs` | 读取当前已打开标签页的标题、网址和图标，用于「当前标签页」列表和一键收藏功能。 |
| `activeTab` | 在用户主动点击扩展时获取当前标签页信息，用于收藏操作。 |
| `windows` | 在「全部窗口」模式下切换到其他窗口的标签时，聚焦目标窗口，使切换可见。 |
| `contextMenus` | 在网页右键菜单中提供「收藏此页面」快捷入口。 |
| `sidePanel` | 承载并展示扩展的侧边栏界面。 |

英文版（如控制台要求英文）：

```
storage   — Store bookmarks, groups and UI preferences, and sync them across the user's own devices via Chrome's built-in sync.
tabs      — Read the titles, URLs and favicons of currently open tabs to power the "Open Tabs" view and one-click saving.
activeTab — Access the current tab only when the user explicitly activates the extension, for saving bookmarks.
windows   — Focus the target browser window when switching to a tab in a different window, so the switch is visible.
contextMenus — Provide a "Save this page" shortcut in the page context menu.
sidePanel — Host and display the extension's side panel interface.
```

## 数据使用披露（Data usage）

在「Privacy practices」中如实勾选 / 填写：

- 是否收集个人身份信息：**否**
- 是否收集浏览记录 / 网址：**是（有限）** —— 仅用户主动收藏的书签网址与标题，以及使用「当前标签页」功能时临时读取的已打开标签信息；全部仅存本地与用户自有 Google 同步空间，不发送给开发者。
- 第三方服务：**仅图标获取** —— 为显示网站图标，会加载站点 favicon.ico 与 Google s2 图标服务，详见隐私政策第 4 节。
- 隐私政策 URL：`（填入你托管 privacy.html 后的公开链接）`

## 上架前需你补充 / 确认

1. 把 `privacy.html` 托管到可公开访问的 URL（GitHub Pages 最简单），填入控制台与上方占位处。
2. 开发者联系方式（邮箱）填写到商店资料。
3. 若名称 `Marknest · 书签管家` 已被占用，准备一个备选名。
4. 确认Logo图标无第三方商标争议（当前为原创极简书签图形）。
