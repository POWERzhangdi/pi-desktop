# pi-desktop 功能清单

> 版本：v0.1.0 - 2026-08-07
>
> pi coding agent 的 Electron 桌面客户端。

---

## 左侧栏

### 工作区列表
- **文件夹图标**：线条风格，颜色随状态变化（绿=运行中·呼吸 / 橙=待确认 / 红=崩溃 / 灰=空闲）
- **单行紧凑**：`[📁] 工作区名  3会话  [+][⋯]`
- **激活态**：蓝色左竖条 + `accent-soft` 柔和蓝底 + 文字 accent 加重
- **hover 显示操作**：新开会话（plus）、更多菜单（归档/删除），`opacity-0 group-hover:opacity-100` 淡入
- **菜单常驻低透**：`opacity-40 group-hover:opacity-100`（工作区头部）

### 会话列表
- **单行紧凑**：`[💬] 标题  5分钟前  [归档][删除]`
- **激活态**：紫色左竖条 + `purple/15` 紫底（和工作区蓝区分层级）
- **hover 显示操作**：归档（archive 图标）、删除（trash 图标），完全隐藏 hover 淡入
- **会话删除**：unlink `.jsonl` 文件，若为当前会话则自动切到剩余首个
- **会话归档**：重命名加 `.archived` 后缀（移出列表，文件保留）

### 归档区
- archive 盒子图标 + 标题「已归档(N)」，点击展开/收起
- 归档项 hover 显示恢复（旋转箭头）、删除（trash）图标按钮
- `animate-list` 展开淡入

### 底部固定操作栏
- **添加工作区**（plus 图标）
- **设置**（gear 图标，打开环境/OCR 设置面板）
- 右对齐，不随列表滚动

### 配色
- **浅色**：ground `#f6f6f4` / side `#ececea` / card `#ffffff`（暖灰层次，不撞色）
- **深色**：ground `#1b1b1d` / side `#131316` / card `#2a2a2d`
- 侧栏比主区深一档，层次分明

---

## 输入区（Composer）

### @ 文件引用
- `@` 触发当前工作区文件搜索（`@` 前需空白/行首，避免邮箱误触）
- **空 query**：广度第一层（顶层目录 + 顶层文件），极快（`scanTop` 只扫一层）
- **打字 query**：深度 fuzzy 模糊匹配（字符按顺序出现即命中，连续/词首加分）+ 全量索引（深度 12，排除 `node_modules`/`target`/`.git` 等）
- **预热缓存**：创建/切换工作区时后台 `warmCache`，`@` 时即时命中（缓存 60s）
- 选中后：**chip 徽章**（文件夹蓝色图标+名称 / 文件彩色类型图标+名称），可移除，发送时拼绝对路径给 pi
- **文件类型图标**（FileIcon）：彩色字母方块（`TS` 蓝/`JS` 黄/`Py` 绿/`J` 橙/`P` 红 PDF/`{}` json 等）+ 文件夹蓝 + 图片绿

### / 命令补全
- 输入 `/` 触发命令列表，上下键选择，Tab/Enter 确认

### 能力按钮
- PDF 解析（`read_pdf`）、Excel 解析（`read_excel`）、OCR 识别、图片附件
- 客户端直接调 pi 扩展（不走 LLM，不消耗 token），结果填入输入框

### 图标按钮
- 全部 SVG 图标（plus/x/arrow-up/minus/more 等），统一 `btn-press` 类
- **按压反馈**：`active:scale(0.97)` + 150ms `--ease-out` 过渡
- `transition-colors` → `transform,background-color,color` 三属性过渡

---

## 设置面板（EnvSettingsDialog）

### 布局
- **左右分栏**：左侧导航（环境检测 / OCR 引擎）+ 右侧内容
- portal 渲染到 body（避免 StatusBar `backdrop-blur` 裁剪）

### 环境检测
- 检测 pi / Node / Python 路径与版本
- **记住结果**：localStorage 存储，关闭再开不重复检测；显示「上次检测时间」
- **路径可编辑**：点「改」→ 输入框编辑 → Enter/失焦保存
  - pi/Node 路径写 `~/.pi-desktop/config.json` + 重启后端生效
  - Python 路径写 config.json，OCR 引擎用指定 python
- Python 未装：引导 `winget install Python.Python.3.12` 提示

### OCR 引擎
- **tesseract**（默认·纯 JS·无需环境）/ **RapidOCR**（强·PaddleOCR·需 Python+包）
- RapidOCR 安装引导：一键安装按钮 → **终端风格安装弹窗**（pip 逐行滚动 + 闪烁光标 + 自动滚到底）
- `onOcrInstallProgress` IPC 事件推送逐行进度

---

## 顶部栏（StatusBar）

### 用量统计
- **环形上下文进度**：20px SVG 环形，颜色随占用（绿<60% / 橙60-80% / 红>80%），`strokeDashoffset` 300ms 过渡
- **tokens**：⚡闪电图标 + 紧凑数字（`5.2k` / `800`）
- **成本**：$ 图标 + 智能小数

### 视觉效果
- **毛玻璃**：`bg-card/80 backdrop-blur-md`
- **边框淡化**：`--sep` 0.13→0.10（浅）/ 0.12→0.10（深）
- **nativeTheme 跟随**：主题切换时 `nativeTheme.themeSource` 同步，系统标题栏/边框随 app 主题变色

---

## 全局

### 入场动画
- 全部使用 `@starting-style`（无需 JS）：
  - **Toast**：`translateY(-12px)` → 0，300ms ease-out
  - **Modal**：`scale(0.95)` → 1，200ms ease-out
  - **Popover**：`scale(0.95)` → 1，150ms ease-out，`--transform-origin` 从 trigger
  - **列表**：`translateY(8px)` → 0，150ms ease-out
- **prefers-reduced-motion**：去掉 transform 位移，保留 opacity 淡入，停止持续动画

### 按钮统一
- `.btn-press` 工具类：`transform: scale(0.97)` on active，150ms `cubic-bezier(0.23, 1, 0.32, 1)` ease-out
- 单字字符（`+` `×` `↑` `−` `⋯` `改` `检测`）全部换 SVG 图标

### 文件扫描（后端）
- `files.ts`：`scanTop`（第一层快速）+ `scanAll`（深度 12 全量）+ `fuzzyScore` 模糊匹配
- `warmCache` 预热（60s 缓存）+ `scanTop` 即时回退（缓存未就绪也不卡）
- 排除 `node_modules`/`.git`/`target`/`.idea`/`.gradle`/`__pycache__` 等

---

## 后端能力

| 功能 | 实现 |
| --- | --- |
| PDF 解析 | `pdf-reader` 扩展（unpdf） |
| Excel 解析 | `excel-reader` 扩展（exceljs） |
| OCR 识别 | `ocr` 扩展（tesseract.js + RapidOCR/PaddleOCR） |
| 环境检测 | `checkEnv`（pi/Node/Python 路径+版本） |
| 配置持久化 | `~/.pi-desktop/config.json`（cliPath/nodePath/pythonPath） |
| 安装 RapidOCR | `installRapidocr`（pip install，进度 IPC 推送） |
| 文件扫描 | `listFiles`（fuzzy + 全量索引 + 缓存） |
| 会话操作 | `sessionDelete`（unlink）/ `sessionArchive`（rename .archived） |
| 工作区管理 | 添加/归档/恢复/删除 |
| 主题跟随 | `nativeTheme.themeSource` |

---

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |
| `Tab` / `↑` `↓` | 补全列表导航 |
| `Esc` | 关闭补全 / 取消 |
| `/` | 命令补全 |
| `@` | 文件引用 |
