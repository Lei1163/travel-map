# 用 GitHub + Cloudflare Pages 发布「赴迹」

目标：代码放在 GitHub，网站由 Cloudflare Pages 托管；以后只要你把改动推到 GitHub，
网站会在 1–2 分钟内自动更新，不用再手动上传任何东西。

---

## 一、把项目推到 GitHub

本目录已经初始化好 git 仓库并完成了首次提交（分支 `main`）。你只需要做一次「关联远程仓库 + 推送」。

### 1. 在 GitHub 上新建仓库

1. 打开 <https://github.com/new>
2. Repository name 填一个名字，比如 `travel-atlas`
3. 选择 **Private**（推荐，代码不公开）或 Public
4. **不要**勾选 "Add a README file" / ".gitignore" / "license"（本地已经有了）
5. 点 **Create repository**

### 2. 把本地仓库推上去

在项目目录（`D:\project\travel map`）打开 PowerShell，执行（把地址换成你自己的）：

```bash
git remote add origin https://github.com/你的用户名/travel-atlas.git
git push -u origin main
```

第一次推送会弹出 GitHub 登录窗口，按提示授权即可。

> 如果提示 `remote origin already exists`，说明之前加过，用
> `git remote set-url origin https://github.com/你的用户名/travel-atlas.git` 改地址。

---

## 二、用 Cloudflare Pages 建站

1. 打开 <https://dash.cloudflare.com> → 左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 授权 GitHub，选中刚才的 `travel-atlas` 仓库 → **Begin setup**
3. 构建设置按下表填写：

| 选项 | 填什么 | 说明 |
| --- | --- | --- |
| Project name | `travel-atlas` | 会成为 `travel-atlas.pages.dev` |
| Production branch | `main` | 每次推 main 都自动部署 |
| Framework preset | **None** | 纯静态站点 |
| Build command | **留空** | `dist/` 已经随代码提交，无需构建 |
| Build output directory | `dist` | 成品都在这个目录 |

4. 点 **Save and Deploy**，等 30–60 秒，得到网址：`https://travel-atlas.pages.dev`

### 为什么用 `dist` 而不是仓库根目录

仓库根目录里有 `tools/`、`.github/`、各种预览图和 `raw/` 原图，不适合直接公开。
`dist/` 是 `python tools/build-dist.py` 生成的纯净站点（只有 index.html、app.js、styles.css、
data/、assets/、manifest、sw.js 和 Cloudflare 需要的 `_redirects` / `_headers`）。

---

## 三、以后怎么更新网站

改完代码后，二选一：

### 方式 A：双击 `publish.bat`（推荐）

它会自动：重新生成 `dist/` → `git add -A` → 提交 → 推送。

推上去之后 Cloudflare 会自动检测到新提交并重新部署，1–2 分钟后线上就是最新版。

### 方式 B：手动敲命令

```bash
python tools/build-dist.py
git add -A
git commit -m "更新说明"
git push
```

> **关键点**：改完代码一定要先跑 `python tools/build-dist.py`，因为线上发布的是 `dist/`。
> 只改根目录的 `app.js` 而不重新生成 `dist/`，网站不会变化。

---

## 四、上线后建议检查的几件事

| 检查项 | 怎么看 |
| --- | --- |
| 站点能打开 | 访问 `https://你的项目.pages.dev` |
| 安装成 App | Chrome/Edge 地址栏右侧出现「安装」图标；手机上「添加到主屏幕」 |
| 离线可用 | 打开一次后断网刷新，页面仍能显示（Service Worker 生效） |
| 数据仍在本地 | 换一个浏览器打开，地图是空的——记录只存在各自设备上 |

### 自定义域名（可选）

Cloudflare Pages 项目 → **Custom domains** → **Set up a domain**，
输入你的域名并按提示把 DNS 指到 Cloudflare（域名也在 Cloudflare 托管时一键完成）。
HTTPS 证书会自动签发。

---

## 五、常见问题

**Q：推送后网站没变？**
先确认这次提交里 `dist/` 有变化（`git status` 看得到 `dist/` 下的文件）。
如果只改了根目录源码，请运行 `python tools/build-dist.py` 再提交。

**Q：Service Worker 缓存了旧版本？**
`sw.js` 顶部的 `VERSION = 'atlas-v2'` 每发一次版可以加一（`atlas-v3`…），
配合 `_headers` 里的 `no-store`，浏览器会在下次访问时换新缓存。

**Q：仓库太大了？**
目前约 104 MB，主要是 `dist/`（36 MB）和 `assets/landmarks/`（36 MB）的图片。
`.gitignore` 已经排除了 59 MB 的 `assets/landmarks/raw/` 原图和中间数据。
如果以后想瘦身，可以改成「构建时生成 dist」：把 Build command 设为
`python tools/build-dist.py`、并在 `.gitignore` 里忽略 `dist/`（需要确认 Cloudflare
构建环境自带 python3）。

**Q：想同时在 GitHub Pages 上有一份？**
仓库里的 `.github/workflows/deploy-pages.yml` 已支持：在 GitHub 仓库
Settings → Pages → Source 选择 **GitHub Actions**，推送后会自动发布 `dist/`。

**Q：国内访问慢？**
`*.pages.dev` 在国内速度一般。可以绑定自己的域名走 Cloudflare，
或者同步部署到 Vercel（仓库里已有 `vercel.json`）。