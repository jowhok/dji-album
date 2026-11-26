# DJI 相册（dji-album）

一款面向 **DJI Osmo Pocket 4P** 的 Windows 桌面相册应用：素材由相机自动上传至家庭局域网 NAS，本应用通过 **SMB / UNC 直连**读取，用本地 SQLite 建索引，提供浏览、预览、收藏、删除与元数据管理，**不改动 NAS 原文件**（唯一的例外是回收站里的「彻底删除」）。

> 个人非商业项目。`DJI` 是 SZ DJI Technology Co., Ltd. 的商标，本项目与其无关联。

当前版本：**v0.1.3** ｜ 平台：Windows 10/11 x64 ｜ 语言：简体中文

---

## 功能一览

| 模块 | 能力 |
|---|---|
| 媒体索引 | 扫描 NAS 照片根下 `YYYYMMDD/` 目录，识别 `.mp4`（高清）、同名 `.lrf`（低清代理）、`.jpg`；旧库自动迁移补列 |
| 时光轴 | 按日期分组（最新在上）的**横向瀑布流**（行优先 `i % cols`，ResizeObserver 自适应列数）；视频时长角标；日期筛选浮层按 `YYYYMM` 分组、可折叠、带媒体计数；分批渲染（首批 500）+「加载更多」 |
| 缩略图 | `ffmpeg-static` 从 LRF 抽帧 + `sharp` 压缩 JPG，缓存到 `%APPDATA%/dji-album/thumbs/`；512 MB LRU 上限按最旧淘汰 |
| 播放器 | 默认播 `.lrf` 低清代理，一键切 `.mp4` 高清并保留进度；本地 HTTP **Range 206** 流式代理，可任意拖动 seek；播放/暂停、±5s、静音、上/下一个、时间轴；两档浮窗（默认 80% 窗口 / 放大 100% 铺满）；关闭即停 |
| HEVC | 直接 `<video>` 播放 HEVC Main10 原片，无需转码；启动时用 `mediaCapabilities.decodingInfo` 探测 `hvc1` 支持并提示 |
| 照片预览 | 原图查看（实测 7680×4320）；**滚轮以鼠标为锚点缩放 1~8 倍、左键拖动平移、双击复位**；缩放走 `width/height + left/top` 布局属性（不用 transform 合成层，规避大图分块栅格化的白线） |
| 元数据 | 右键「查看元数据」14 项：时长、分辨率、帧率、视频/音频编码、码率、大小、拍摄时间、日期目录、LRF 代理、文件状态、完整路径（可复制） |
| 右键菜单 | 查看元数据 / 加入收藏（可取消）/ 下载原片（系统另存为 + 进度）/ 移入回收站；播放页内同样可用 |
| 收藏与回收站 | 收藏夹视图、回收站视图（勾选 + 批量恢复）；彻底删除二次确认，列出每个待删文件的完整 UNC 路径与体积 |
| 外观 | 浅色 / 深色 / 跟随系统三态主题（localStorage 持久化 + `nativeTheme` 同步）；侧栏全屏按钮 + F11；全站按钮图标化 |
| 设置页 | NAS 配置与连通性测试、缓存与索引统计、重新扫描 / 重建缩略图 / 重新提取元数据 / 清理缓存（带进度）、外观、快捷键说明、关于 |
| 状态探测 | 侧栏真实探测 NAS 连通性并显示失败原因 / 重试；HEVC 解码能力启动探测 |

---

## 技术栈

- **Electron 33** + **React 18** + **TypeScript 5** + **electron-vite 2** / Vite 5
- **better-sqlite3**（WAL，三表）、**sharp**（图片）、**ffmpeg-static**（抽帧与元数据探测）
- 主进程内置本地 HTTP 媒体服务；`contextBridge` + `ipcMain.handle` 做 IPC；CSS variables + `data-theme` 做主题
- 打包：**electron-builder 26**（NSIS 安装版 + 免安装便携版）、`asarUnpack` 外置原生模块

---

## 架构

```
┌─ Renderer (React) ────────────────────────────────┐
│  Timeline / Player / DateFilter / ContextMenu /    │
│  TrashView / SettingsView / PurgeConfirm           │
│        │ window.api（contextBridge，最小 API 面）   │
└────────┼──────────────────────────────────────────┘
         │ ipcMain.handle
┌────────┼──────────────────────────────────────────┐
│  Main  │  scanner · thumbnails · metadata · cache  │
│        │  db(SQLite) · purge · settings · ipc       │
│        └──── media-server (127.0.0.1:随机端口) ────┤
│             /ping  /thumb/<hash>.jpg  /media/<token>│
└───────────────────────────────────────────────────┘
                      │ 直接读 UNC 路径
              \\<NAS-IP>\<共享>\DJI Device\...\YYYYMMDD\
```

- **媒体服务**：`/thumb/` 返回带 `Content-Length` 的 JPEG（支持 HEAD）；`/media/<token>` 按 Range 返回 206/416，支持边下边播。token 为 `sha1(path)`，且路径必须已在 `files` 表登记，未登记返回 404，**防止借 URL 读取任意本地文件**。
- **数据**：`files`（索引 + 9 列元数据）、`favorites`、`trash` 三表，均以 NAS 绝对 UNC 路径为主键。
- **安全**：软删只写本地 `trash`，NAS 原文件不动；彻底删除由主进程强制校验（`JOIN trash` 命中、`win32.resolve` 后仍位于 NAS 根内、扩展名白名单 `.mp4/.lrf/.jpg/.jpeg`、执行时重新构建计划），逐个 `unlink`、不递归、不通配，且支持幂等重试。下载只保存 MP4 原片。
- **密码**：不落明文，通过 Windows `cmdkey` 写入凭据管理器；配置存 `%APPDATA%/dji-album/settings.json`。

---

## 环境要求

1. Windows 10/11 x64。
2. 一台可通过 SMB（UNC）访问的局域网 NAS，且相机上传目录形如 `<照片根>/YYYYMMDD/`。
3. 系统具备 **HEVC 解码**能力（Chromium 依赖系统解码器）；应用启动会自行探测并在不支持时提示。
4. 首次运行在引导页填写 NAS 主机 / 共享 / 用户名 / 照片根目录，密码可选（写入 Windows 凭据管理器）。

> 代码里 `src/main/settings.ts` 的 `DEFAULTS` 含一份示例 NAS 地址与共享名（本项目实际使用值）。Fork / 复用时请按自己的环境修改；仓库为私有，仍请注意不要把凭据提交进来。

---

## 快速开始

### 直接用打包版

`release/v0.1.3/` 下提供两个产物（二进制不入库，需从本地或 Release 页面获取）：

| 文件 | 说明 |
|---|---|
| `DJI 相册-Setup-0.1.3.exe` | NSIS 安装版，可选目录、桌面/开始菜单快捷方式、带卸载程序（启动更快，推荐） |
| `DJI 相册-Portable-0.1.3.exe` | 免安装单文件，双击即用（自解压约 15~20 秒才出现窗口） |

exe 未做代码签名，首次运行 Windows SmartScreen 可能提示「未知发布者」→「更多信息 → 仍要运行」。安装版与便携版共用 `%APPDATA%/dji-album` 数据目录。

### 开发模式

```bash
npm install
npm run dev        # 开发（热更新）
npm run typecheck  # 类型检查（node + web 两份 tsconfig）
npm run build      # 构建到 out/
npm run start      # 生产预览
```

> 在 WorkBuddy 内嵌终端里启动需 `env -u ELECTRON_RUN_AS_NODE npm run start`（宿主注入了该环境变量会让 Electron 变成纯 Node）。用户自己的终端不受影响。

### 构建安装包

```bash
npm run icons       # 从 assets/dji-wordmark.svg 重新生成 build/icon.ico / png
npm run dist        # build + electron-builder --win --x64
npm run dist:clean  # 干净打包：绕开清空旧 stage 的守卫，输出到全新目录再覆盖回稳定目录
```

输出目录由 `package.json` 的 `build.directories.output` 决定（当前 `release/v0.1.3`）。`npmRebuild: false` 依赖本机原生模块已匹配 Electron 33 ABI；`asarUnpack` 显式解包 `better-sqlite3` / `sharp` / `@img` / `ffmpeg-static`。

---

## 回归测试

统一入口 `scripts/check-all.mjs`（13 个 CDP 真实交互脚本），会先自动探测基线（`files` / `favorites` / `trash`）再依次刷干净页跑各脚本：

```bash
# 前置：应用带 --remote-debugging-port=9222 启动（开发态或打包版均可）
CDP_PORT=9222 npm run check:all
DJI_ONLY=thumbs CDP_PORT=9222 npm run check:all   # 只跑名字含 thumbs 的脚本
```

| 类别 | 脚本 |
|---|---|
| 纯函数单测（Electron ABI 内跑） | `test-features` `test-media`(range/http) `test-purge` `test-scanner` `test-thumbs` |
| CDP 真实交互 | `check-thumbs` `check-date-filter` `check-photo-zoom` `check-settings` `check-player-ui` `check-player-popup` `check-player` `check-m6` `check-features` `check-views` `check-contextmenu` `check-release` |
| 辅助 | `reload-cdp` `check-all` `dist-clean` `build-icon` `probe-*` |

- 涉及**真实输入**的回归一律用 CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`；合成 `dispatchEvent` 会绕过 React 18 离散事件的同步 effect，曾漏掉「真实右键打不开菜单」的 bug。
- 后台启动的实例可能被 Chromium 判定为 hidden 并节流图片请求，脚本已用 `Page.bringToFront` 处理；出现缩略图 0 张时优先怀疑这个而非应用缺陷。
- 基线通过 `DJI_TILES` / `DJI_FAV` 环境变量注入，`check-all` 自动设置，无需手工同步 NAS 文件数量。

---

## 目录结构

```
dji-album/
├─ src/
│  ├─ main/         # 主进程：db / scanner / thumbnails / metadata / cache /
│  │                #   media-server / range / purge / settings / ipc / index
│  ├─ preload/      # contextBridge 暴露的 window.api
│  ├─ renderer/src/ # React：App / Timeline / Player / DateFilter / ContextMenu /
│  │                #   TrashView / SettingsView / PurgeConfirm / Icon / theme / layout
│  └─ shared/       # 跨进程类型定义
├─ scripts/         # 单测、CDP 回归、构建与图标生成脚本
├─ assets/          # DJI 官方字标 SVG（图标来源）与 favicon
├─ build/           # 生成的 icon.ico / png（由 npm run icons 产出）
├─ docs/            # 需求、开发计划、代码评审、交付概览
├─ electron.vite.config.ts / tsconfig*.json
└─ package.json
```

`out/`、`node_modules/`、`release/`、`.tmp/` 均被 `.gitignore` 排除，不入库。

---

## 已知限制

- **彻底删除未在真实 NAS 上执行验证**（安全考虑，只在临时目录单测里真实 unlink）；首次点击「永久删除」即为真实删除，请核对清单。
- **下载功能未做自动化验证**：会弹出系统原生「另存为」对话框，需手动确认一次。
- 播放走 WiFi 读 NAS：LRF 代理约 5~7 Mbps 流畅；切 MP4 高清（30~50 Mbps、4K 10-bit）在无线下可能卡顿。
- F11 全屏由主进程 `before-input-event` 捕获，CDP 注入按键不经过该管线，按钮路径已硬验证、F11 需真实键盘确认。
- 应用级全局快捷键、代码签名、自动更新尚未实现。
- 无单实例锁：安装版与便携版同时打开会共享 `userData`，建议只开一个（见 `docs/03-代码评审.md`）。

---

## 文档

- `docs/01-需求说明.md` — 原始需求
- `docs/02-开发计划.md` — 里程碑 M1~M6
- `docs/03-代码评审.md` — 2026-11-26 代码评审（含 P0/P1 待修项）
- `docs/04-交付概览.md` — 逐轮交付与验证记录

## 许可与商标

个人非商业自用。`DJI` 及图标字标归 SZ DJI Technology Co., Ltd. 所有；应用图标基于其官方字标绘制，仅作标识用途。
