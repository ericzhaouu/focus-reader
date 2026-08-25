# 隐私说明 / Privacy Policy

**Focus Reader — 读完再存**

[English](#english) · [简体中文](#简体中文)

## 简体中文

最后更新：2026-08

## 简短版

这个扩展没有服务器。你的数据从不离开你的电脑。

## 我们收集什么

**没有。** Focus Reader 不收集、不传输、不出售任何数据。

- 没有后端服务器
- 没有分析、埋点或遥测代码
- 没有第三方 SDK
- 没有账号系统，无需注册或登录
- 没有后台 API、分析或遥测请求；只有你点击「打开」时，Chrome 会正常访问书签原网址
- 不读取或改写你打开的网页正文

## 数据存在哪里

全部存放在浏览器本地的 `chrome.storage.local` 中：

| 数据 | 内容 |
|---|---|
| 设置 | 待读文件夹 ID、每批篇数、选文策略、归档文件夹名 |
| 当前批次 | 当前锁定的文章标题与网址、已读状态 |
| 统计 | 累计已读数、连续阅读天数、每日阅读计数 |

卸载扩展即全部清除。

## 权限说明

| 权限 | 用途 | 是否必需 |
|---|---|---|
| `bookmarks` | 读取你指定的待读文件夹；「已读」时把文章归档到 `已读归档` 子文件夹；「放弃」时删除该条收藏。删除只在你明确点击「放弃」并二次确认后发生。 | 必需 |
| `storage` | 在本地保存上述设置与状态 | 必需 |

扩展不声明 `tabs`、`scripting` 或任何 host permission。点「打开」时，
Chrome 只负责在新标签页导航到书签原网址；扩展无法读取页面内容。

## 你的书签安全吗

扩展只在两种情况下改动你的书签，且都由你主动触发：

**1. 点击「已读」** —— 文章被归档到待读文件夹下的 `已读归档` 子文件夹。

由于 Chrome 的 API 不允许修改书签的「收藏时间」，归档采用**先在归档夹新建一份、再删除原件**的方式，
这样归档副本的时间戳就是你读完它的那天。顺序永远是先建后删——即使中途失败，你的书签也不会丢失，
最坏情况只是留下一份重复。

**2. 点击「放弃」** —— 该条收藏会被**永久删除**。

这是不可撤销的，所以按钮需要点两次确认：第一次点击只会把按钮变成「确定放弃？」，
再点一次才真正执行。四秒内不再点击会自动取消。

除此之外，扩展不会删除、移动或修改你的任何书签。设置页会读取书签文件夹层级，
以便让你选择待读文件夹；抽取、归档和放弃操作只作用于你指定的文件夹。

## 变更

隐私政策若有变更，会在扩展更新说明与本文件中一并说明。

## 联系

有疑问请通过 Chrome 应用商店的支持页面反馈。

---

## English

**Last updated: August 2026**

### Short version

Focus Reader has no server. Your data never leaves your device.

### Data handled locally

The extension processes the following data only inside Chrome:

| Data | Purpose |
|---|---|
| Settings | Reading folder ID, batch size, selection method, archive folder name |
| Current batch | Bookmark titles, URLs, and read/abandoned state |
| Statistics | Articles read, streak, completed batches, abandoned count, estimated words |

This data is stored in `chrome.storage.local` and is removed when the extension
is uninstalled.

The extension has:

- no account or sign-in;
- no backend server;
- no advertising, analytics, tracking, or telemetry;
- no third-party SDK;
- no background API requests;
- no access to page content.

When you click **Open**, Chrome navigates normally to the bookmark's original URL.
That request goes to the source website, not to the developer.

### Permissions

| Permission | Purpose |
|---|---|
| `bookmarks` | Show bookmark folders, draw articles from the selected folder, archive read bookmarks, and delete bookmarks only after an explicit two-step Abandon confirmation |
| `storage` | Store settings, the locked batch, reroll state, and reading progress locally |

The extension does not request `tabs`, `scripting`, host permissions, or optional
host permissions. It cannot read the contents of websites you open.

### Bookmark changes

Focus Reader changes bookmarks only after an explicit action:

1. **Read** — creates a copy in the archive subfolder first, then removes the
   original so the archived bookmark receives the completion date. If removing the
   original fails, the safe copy remains.
2. **Abandon** — permanently deletes the bookmark only after the user clicks the
   confirmation button a second time. Confirmation expires after four seconds.

The settings page reads the bookmark folder hierarchy so you can select a reading
folder. Drawing, archiving, and abandoning apply only to the folder you selected.

### Collection, transmission, and sharing

Focus Reader does not transmit, sell, share, or disclose bookmark data, queue
state, or reading activity to the developer or any third party.

### Changes

Material changes to this policy will be reflected in the extension's release
notes and this document.

### Contact

Use the Chrome Web Store support page or the GitHub issue tracker:

https://github.com/ericzhaouu/focus-reader/issues
