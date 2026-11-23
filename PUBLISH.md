# 发布 / 分享给别人的几种方式

> 当前版本 **1.8.0**，发布者署名 **Dongyao**。
> 仓库里已经准备好了：`manifest.json`、`main.js`、`styles.css`、`versions.json`、`README.md`、`LICENSE`、`.gitignore`，并且已建好 git 仓库、提交和 `1.8.0` 标签。

## 我（AI）能做什么、不能做什么

能：把仓库整理成可发布的形态、生成构建产物、打 tag、写好要提交的 PR 内容、写文档。
不能：替你注册/登录 GitHub、创建远程仓库、提交 PR —— 这些都要用你自己的 GitHub 账号在网页上完成（我没有你的凭据，也不应该要）。

所以剩下的只是「复制几条命令 + 在网页上点几下」。

---

## 方式 1：直接发 zip（零门槛，先让人用起来）

`dist/daily-note-template-1.8.0.zip` 可直接发给别人：解压后把 `daily-note-template` 放进 `<仓库>/.obsidian/plugins/`，重载后在「第三方插件」里启用。包里的 `安装说明.md` 就是给对方看的。

---

## 方式 2：GitHub 仓库 + Release（上架市场的前提）

### 1. 建远程仓库

在 GitHub 新建一个 **public** 仓库，建议命名 `obsidian-daily-note-template`。

### 2. 推代码（本地已提交好）

```bash
cd obsidian-daily-note-template
git remote add origin https://github.com/<你的用户名>/obsidian-daily-note-template.git
git push -u origin main
git push origin 1.8.0
```

> 如果你的默认分支不是 `main`，先 `git branch -M main` 再推。
> 提交作者目前是 `Dongyao <dongyao@users.noreply.github.com>`；想让它归属你的 GitHub 账号，先 `git config user.email "你的GitHub邮箱"`，再 `git commit --amend --reset-author --no-edit` 并重新打 tag。

### 3. 发 Release（这一步最关键）

GitHub → **Releases → Draft a new release**：

- Tag：选 `1.8.0`（**必须与 `manifest.json` 的 version 完全一致，不要加 v 前缀**）
- 标题：`1.8.0`
- 附件上传三个文件：`main.js`、`manifest.json`、`styles.css`
- Publish release

---

## 方式 3：上架官方插件市场

### 前置检查（都已满足）

- [x] `manifest.json` 有 `id`、`name`、`version`、`minAppVersion`、`description`、`author`、`isDesktopOnly`
- [x] `id` = `daily-note-template`（不含 `obsidian`）
- [x] 名称不以 `Obsidian` 开头
- [x] 仓库根目录有 `main.js`、`manifest.json`、`styles.css`、`versions.json`、`README.md`、`LICENSE`
- [x] `versions.json` 含 `"1.8.0": "1.4.0"`
- [x] 无网络请求、无遥测（README 的「隐私与权限」已写明）

### 提交步骤

1. Fork [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
2. 编辑仓库根目录的 `community-plugins.json`，在数组末尾加一条：

```json
{
  "id": "daily-note-template",
  "name": "日记模板 Daily Note Template",
  "author": "Dongyao",
  "description": "日记模板：自动补建每一天，待办/任务/紧急任务跟随当天日记，并自动维护年、月节点与链接。",
  "repo": "Dongyao/obsidian-daily-note-template"
}
```

> `repo` 必须和你实际的 GitHub 用户名/仓库名一致，前后不能有空格。数组里最后一条后面不要留逗号。

3. 提交 PR，标题写 `Add plugin: 日记模板 (Daily Note Template)`，正文填：
   - 插件 id、仓库地址
   - 一句话说明它做什么
   - 确认「没有网络请求、不收集数据」
4. 等审核（通常几天到两三周）。被要求修改时，改仓库、发新版 Release（版本号 +1），再更新 PR 里的 `community-plugins.json` 版本相关内容和 `versions.json`。

### 审核常看的点

- Release 里的三个文件能直接跑，`manifest.json` 的 version 与 tag 一致
- README 说清楚功能与用法，有 LICENSE
- 不访问网络、不采集数据、不自动改用户没让它管的文件
- 名称/描述没有夸大或蹭关键词

---

## 方式 4：BRAT（市场审核期间的过渡）

对方先装社区插件 **BRAT**，命令面板执行「BRAT: Add a beta plugin for testing」，填 `<你的用户名>/obsidian-daily-note-template`。之后你发新 Release，他们能自动更新。

---

## 每次发版的清单

1. 改 `package.json` 与 `manifest.json` 的 `version`
2. `versions.json` 追加一行 `"新版本": "最低Obsidian版本"`
3. `pnpm build && pnpm test`（类型检查 + 打包 + 79 项测试）
4. `git add -A && git commit -m "vX.Y.Z" && git tag -a X.Y.Z -m "vX.Y.Z"`
5. `git push && git push origin X.Y.Z`
6. GitHub Release 上传 `main.js` / `manifest.json` / `styles.css`
7. 如果已上架：向 `obsidian-releases` 提 PR 更新 `community-plugins.json` 里的版本（或按官方流程等自动同步）
