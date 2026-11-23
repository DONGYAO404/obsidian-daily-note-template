# 发布 / 分享给别人的几种方式

## 方式 1：直接发 zip（最简单，零门槛）

`dist/daily-note-template-1.6.0.zip` 已经是可直接分发的包：

```
daily-note-template/
├── main.js
├── manifest.json
├── styles.css
├── README.md
└── 安装说明.md
```

对方解压后把 `daily-note-template` 放进 `<仓库>/.obsidian/plugins/`，重启或 `Ctrl+R`，在「设置 → 第三方插件」里启用即可。`安装说明.md` 就是给对方看的。

> zip 里**没有** `data.json`，所以对方拿到的是默认配置，不会带上你的日记路径、待办和同步状态。

## 方式 2：GitHub + BRAT（能一键安装、自动更新）

适合想让别人长期用、你能持续更新。

1. 在 GitHub 新建一个 **public** 仓库，例如 `obsidian-daily-note-template`。
2. 把项目推上去（不用推 `node_modules`、`dist`、`test/.build`）：

   ```bash
   cd obsidian-daily-note-template
   git init
   git add .
   git commit -m "v1.6.0"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/obsidian-daily-note-template.git
   git push -u origin main
   ```

3. 发布 Release（BRAT 认的是 Release 里的三个文件）：

   ```bash
   git tag -a 1.6.0 -m "v1.6.0"
   git push origin 1.6.0
   ```

   然后 GitHub → **Releases → Draft a new release** → 选 tag `1.6.0` → 上传
   `main.js`、`manifest.json`、`styles.css` 作为附件 → Publish。

4. 对方安装 BRAT 后：

   - 命令面板执行 **「BRAT: Add a beta plugin for testing」**
   - 填 `<你的用户名>/obsidian-daily-note-template`
   - BRAT 会自动拉取 Release；以后你发新版本，对方能一键更新。

## 方式 3：上架官方社区市场（所有人都能搜到）

门槛（摘要）：

- 仓库公开，根目录有 `manifest.json`、`main.js`、`styles.css`、`versions.json`、`README.md`、`LICENSE`。
- `manifest.json` 的 `version` 必须与 GitHub Release 的 tag 完全一致；每次发版在 `versions.json` 里补一条 `"新版本": "最低Obsidian版本"`。
- `id` 不能包含 `obsidian`，名称不能以 `Obsidian` 开头。
- 向 [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) 提交 PR，在 `community-plugins.json` 里加一条记录，等待审核。
- 审核关注：不侵权、不采集数据、无明显安全风险、README 说明清楚。

建议在公开仓库里加一个 `LICENSE`（MIT 最省事），并在 README 顶部写清楚插件作用、截图和安装方式。

## 每次发版的清单

1. 改 `package.json` 和 `manifest.json` 的 `version`。
2. 在 `versions.json` 追加一行。
3. `pnpm build && pnpm test`（类型检查 + 打包 + 72 项测试）。
4. 更新 `README.md` 的更新日志（可选）。
5. `git tag` + GitHub Release 上传 `main.js` / `manifest.json` / `styles.css`。
