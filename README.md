# pi-desktop

[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 编码 agent 的可视化桌面客户端。Electron + React + Tailwind v4,界面采用 Kimi 官方配色 token,支持浅色/深色主题。

## 0→1 设计

### 出发点

pi 本身是一个终端 agent(TUI/RPC)。这个桌面端的目标是把它的能力可视化:会话与工作区管理图形化、多工作区并行、模型与密钥免手工改 JSON。核心原则:**pi 是唯一事实来源,桌面端只是它的 RPC 客户端**——对话、工具执行、压缩、扩展等 agent 逻辑全部交给 pi 进程,客户端只做进程编排、协议适配和 UI。

### 关键设计决策

1. **走 RPC 协议,不包装伪终端。** 以 `pi --mode rpc` 启动子进程,stdin/stdout 跑 JSON Lines:命令带自增 `id` 配对响应(180s 超时),事件不带 id 异步推送。分帧自己实现而不用 readline——U+2028/2029 会被误判为行尾。进程死亡后下一条命令自动重启。
2. **一个工作区 = 一个 pi 进程。** 上下文隔离直接利用 pi 的进程模型:每个 cwd 一条 RPC 通道,`RpcClientPool` 用 `Map<cwd, RpcClient>` 懒启动并保持存活。切换工作区只是切换渲染目标,互不中断;事件/状态包成 `{cwd, ...}` 信封,渲染端按 cwd 分桶归并。
3. **workspace 注册表 = 手动 ∪ 发现 − 隐藏。** 手动添加存 `config.json`;有会话历史的目录从 sessions 目录自动发现(会话 header 里存了真实 cwd,目录名转义不可逆故不反解);"删除"发现型工作区实际写入 hidden 列表;另支持归档(收进"已归档"区,可恢复)。侧栏按工作区平铺,非下拉。
4. **会话列表靠自扫描。** RPC 协议没有"列出会话"命令,直接扫 `~/.pi/agent/sessions/<转义cwd>/*.jsonl`:取首行 header + 第一条 user 消息当标题(单文件最多读 64KB)。
5. **模型与密钥:配置文件是唯一配置面,保存即重启。** 内置 provider 的 key 读写 `~/.pi/agent/auth.json`(0600,完整 key 不出主进程,UI 只见掩码;编辑时留空 = 保持不变,测试连接由主进程自己取 key);自定义 provider 读写 `~/.pi/agent/models.json`(兼容 OpenAI/Anthropic/Google API 的端点都能接)。经实测(见 `scripts/smoke-hot-config.mjs`),运行中的 pi 进程对这两份配置**不热感知**,因此任何保存都会重启全部后端进程;有任务在跑时先弹确认。`/login` 的 OAuth 订阅流是 TUI 交互、RPC 驱动不了,明确不做——API key 路线已覆盖主流模型。
6. **模型偏好按工作区记忆。** 每个工作区的模型/思考等级选择存 localStorage,后端进程懒启动或重启后自动恢复。
7. **UI 用 Kimi 官方配色 token。** 深浅两套主题;状态栏一排:模型选择器(provider 分组 + 搜索 + 思考徽标,底部进"模型与密钥"管理页)、思考等级选择器(中文:关闭/极简/低/中/高/极高/最大)、tokens/成本/上下文占用、主题切换图标;工作区状态点:绿=运行中、黄=待确认、红=崩溃、灰=空闲。

## 架构

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  main 进程                        renderer 进程(React)          │
│  ┌──────────────────────┐  IPC   ┌───────────────────────────┐   │
│  │ RpcClientPool        │◄──────►│ zustand store             │   │
│  │  Map<cwd, RpcClient> │ {cwd,*}│  按 cwd 分桶(byCwd)      │   │
│  │  懒启动/保持存活      │        └────────────▲──────────────┘   │
│  │ ProvidersStore       │                 contextBridge        │
│  │  auth.json/models.json│       ┌────────────┴──────────────┐   │
│  │ workspaces 注册表     │        │ preload(window.piApi)     │   │
│  │ sessions/scanner     │        └───────────────────────────┘   │
│  └──────────┬───────────┘                                        │
└─────────────┼────────────────────────────────────────────────────┘
              ▼ JSON Lines(每个 workspace 一条)
     pi --mode rpc × N(@earendil-works/pi-coding-agent)
```

- **main / RpcClientPool**:`Map<cwd, RpcClient>`;每个 client 自写 JSONL 分帧,命令按自增 id 配对响应(180s 超时),事件包成 `{cwd, evt}` 信封转发;进程崩溃上报 stderr 尾部,发命令时自动重启;`restartAll()` 用于配置变更后的整体重启。
- **main / ProvidersStore**:内置 provider 目录(Kimi、DeepSeek、智谱 GLM、MiniMax、通义千问、OpenAI、Anthropic、Gemini、OpenRouter、xAI、Groq、Mistral 等 14 个)+ auth.json 读写(key 掩码返回)+ models.json 自定义 provider 增删改(编辑时保留表单外既有字段如 headers/compat)。
- **main / workspaces 注册表**:见"关键设计决策 3",配置存 `%USERPROFILE%\.pi-desktop\config.json`。
- **main / scanner**:见"关键设计决策 4"。
- **preload**:contextBridge 暴露 `window.piApi`:sendCommand(cwd,…) / onRpcEvent / onBackendStatus / listSessions / getConfig / workspace 增删归档恢复 / providers 五个管理接口。
- **renderer**:zustand store 按 cwd 分桶,事件信封路由到对应桶;当前桶驱动消息流/状态栏/输入框;后台工作区任务完成或有确认请求时 toast 提醒(可一键前往)。组件:WorkspaceList(平铺、+ 新会话、⋯ 归档/删除、已归档区)、ModelPicker/ThinkingPicker、ModelManagerPage(模型与密钥管理页)、消息流、工具卡片、Composer(斜杠命令补全)、ExtensionUiDialog、Toast、ThemeToggle。

## 前提

- **安装 Node.js**(硬性前提;Windows 默认取 `C:\Program Files\nodejs\node.exe`,macOS/Linux 直接取 PATH 上的 `node`)。
- pi CLI 全局安装**不再是必须**:客户端已内置 pi(场景 2);若本机已全局安装
  `npm i -g @earendil-works/pi-coding-agent`,客户端优先使用本地的(场景 1,版本由用户控制)。
- 支持 **Windows / macOS**(按 `process.platform` 自动识别:node 路径、pi 全局安装目录、Python 命令、安装引导文案均分平台)。

macOS 上 pi 的全局安装目录通过 `npm root -g` 自动解析(兼容 npm / nvm / Homebrew 安装);
也可以在设置面板里手工指定 cliPath / nodePath。mac 安装包(dmg/zip,arm64+x64)在 mac 上执行
`npm run dist:mac` 构建(Windows 上只能构建 Windows 安装包)。

## pi CLI 来源(双场景)

- **场景 1:本地已装 pi** → 用本地的(解析顺序:环境变量 `PI_DESKTOP_CLI` > 配置 `cliPath` > 全局安装 > 内置)。
- **场景 2:本地没装 pi** → 自动使用客户端内置的 pi(已作为依赖打包,零安装)。

### 内置 pi 装在哪里

| 环境 | 位置 |
| --- | --- |
| 开发态 | `<项目>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` |
| 安装版 | `~/.pi-desktop/runtime/pi/<piVersion>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` |

安装包里只附带一个 `resources/runtime.tar`(载荷,约 70MB);**首次启动**时解到用户目录
(约 63MB / 8.8k 文件,实测 ~1–3s),随后删除 tar,之后每次启动直接复用。
之所以不放在安装目录里跑:内置 pi 要用系统 node 起子进程,子进程读不了 asar;
而把上万个文件解到 `app.asar.unpacked` 会让安装目录变成一堆散文件,也无法单独升级 pi。
放在用户目录后,路径可见、可手工替换/升级,删掉后重新安装应用即可恢复(缺失时横幅会给出提示)。

环境检测面板里能看到当前实际使用的 pi 路径与来源徽章(内置/自定义/环境变量/全局检测)。

## 内置插件自动部署

客户端内置插件源在 `extensions/bundled/`(approve-bash 审批门、pdf/excel/ocr 能力、RapidOCR 脚本),
启动时自动同步到 `~/.pi/agent/extensions/`(pi 的标准扩展目录,本地/内置 pi 都会加载)。
同步按 sha256 清单幂等:**客户端升级才覆盖,你本地改过的插件保留**。带依赖的扩展
(pdf/excel/ocr)首次使用对应能力时自动 `npm install`。

## 命令

```bash
npm install        # 安装依赖
npm run dev        # 开发模式(electron-vite dev,渲染端热更新;改 main/preload 需重启)
npm run verify     # 提交前门禁:typecheck + lint + 全部测试
npm run typecheck  # 仅类型检查(node + web 两个 project)
npm run lint       # oxlint(src / scripts / extensions)
npm test           # 单测(tests/,node:test)+ 后端脚本测试(插件部署/MCP/模型连接)
npm run build      # 类型检查 + 打包到 out/
npm run build:runtime # 生成内置 pi 运行时载荷(build/runtime.tar + manifest)
npm run dist:win   # 构建 Windows 安装包(release/)—— 已包含上面两步
npm run smoke      # RPC 冒烟:不走 UI,直接验证 pi 协议链路
```

CI 在 `.github/workflows/ci.yml`:`npm ci → typecheck → lint → test → build`(Windows runner)。

> npm 11 会对 `.npmrc` 里的 `electron_mirror` 打一条 `Unknown project config` 警告。该键仍会被 electron 的安装脚本读到(`npm_config_electron_mirror`),属于已知无害警告;若日后失效,可改用环境变量 `ELECTRON_MIRROR`。

`scripts/smoke-hot-config.mjs` 是另一件开发工具:验证运行中的 pi 进程对 auth.json/models.json 变更不热感知(会临时写入假配置再恢复原文件)。所有脚本统一通过 `scripts/lib/pi.mjs` 解析 pi CLI(env > 配置 > 全局 > 内置),不再各自硬编码路径。

## 配置

默认即可工作。需要覆盖时,写 `%USERPROFILE%\.pi-desktop\config.json`:

```json
{
	"nodePath": "C:\\Program Files\\nodejs\\node.exe",
	"cliPath": "C:\\Users\\<你>\\AppData\\Roaming\\npm\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js",
	"sessionsDir": "C:\\Users\\<你>\\.pi\\agent\\sessions",
	"cwd": "C:\\projects\\my-app",
	"workspaces": ["C:\\projects\\app-a", "C:\\projects\\app-b"],
	"hiddenWorkspaces": [],
	"archivedWorkspaces": []
}
```

- `workspaces`:手动添加的工作区目录(应用内"添加工作区"也会写这里)。
- `hiddenWorkspaces`:被移除的"发现型"工作区(应用内"移除工作区"自动维护)。
- `archivedWorkspaces`:归档的工作区(收进侧栏"已归档"区,可恢复)。
- `cwd`:首次启动且没有任何工作区时的兜底目录。
- 写入是**原子替换**(临时文件 + rename),由主进程的 `ConfigStore` 单一入口维护,不会出现多写入口互相覆盖。

环境变量优先级更高(仅 nodePath / cliPath):`PI_DESKTOP_NODE`、`PI_DESKTOP_CLI`。冒烟脚本同样认 `PI_DESKTOP_CLI`。

## 功能

- **多 workspace 并行**:侧栏平铺管理多个工作区(自动发现有会话历史的目录 + 手动添加);每个工作区独立 pi 进程,切换不中断、可并行跑任务;状态点绿=运行中/黄=待确认/红=崩溃/灰=空闲;工作区右上角 + 新建会话,⋯ 归档/删除;底部"已归档"区可恢复;后台工作区完成或请求确认时 toast 提醒,一键前往。
- **模型与密钥管理页**:模型选择器底部"管理模型与密钥…"进入独立页面;内置 provider 卡片式填 key(状态徽标:已配置/环境变量/未配置,key 掩码显示,可更换/删除);自定义模型表单(名称、API 类型、Base URL、Key 或 $环境变量、模型列表、是否支持思考);保存即重启后端生效,有任务在跑会先确认;保存后模型列表自动刷新、各工作区模型偏好自动恢复。
- 流式对话:text/thinking delta 实时渲染,Markdown(GFM + 代码高亮)。
- 工具调用卡片:bash 深底等宽块(命令 + 输出 + exit 徽标)、edit/write 新旧文本 diff、其余工具参数/结果折叠;流式 partial 输出实时更新。
- 会话管理:新建会话、当前工作区的历史会话列表(自扫描)、点击切换(get_entries 水合历史);应用重启后自动恢复当前工作区的会话画面。
- 状态栏:模型选择器(provider 分组 + 搜索)、思考等级选择器(中文)、累计 tokens / 成本 / 上下文窗口占用;右端主题切换图标。
- 斜杠命令补全:`/` 触发,按前缀过滤,显示 extension/prompt/skill 来源徽标。
- 扩展 UI 子协议:confirm/select/input/editor 阻塞请求弹模态对话框,notify 弹 toast,setStatus 显示在状态栏;agent 运行中止(■)、流式中 steer 插话、排队数提示。
- 后端崩溃横幅 + 一键重连(按工作区)。
- **桌面交互**:中文应用菜单(Alt 显示)+ 右键菜单(复制/粘贴/全选/复制链接)+ 拖放/粘贴文件与截图;窗口大小与位置记忆;深浅色跟随系统(手动切换后不再跟随)。

## 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Enter` / `Shift+Enter` | 发送 / 换行(中文输入法上屏不会误发) |
| `/` · `@` | 斜杠命令补全 · 文件引用补全(`↑↓` 选择,`Tab/Enter` 确认,`Esc` 收起) |
| `Ctrl+N` | 新建会话 |
| `Ctrl+O` | 添加工作区 |
| `Ctrl+,` | 设置 |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 放大 / 缩小 / 重置界面缩放 |
| `Ctrl+Shift+L` | 切换深浅色 |
| `Ctrl+W` / `Ctrl+Q` | 关闭窗口 / 退出 |

## 安全边界

渲染进程被视为「可能被模型输出/外链污染」的不受信环境:

- **沙箱**:`contextIsolation` + `sandbox` 开启,preload 用 CJS 打包,只暴露白名单 API(渲染进程没有 Node 能力)。
- **导航**:页面内导航与新窗口一律拦截,http(s) 外链交给系统浏览器;`javascript:`/`file:` 等协议直接丢弃。
- **CSP**:开发态由主进程响应头放行 HMR(内联脚本 + 本地 ws),生产态注入严格 meta(`script-src 'self'`,禁用 object/base-uri/form-action)。
- **密钥**:完整 key 只存在于主进程;渲染进程只见掩码,编辑时留空表示不修改。
- **命令审批**:策略由主进程持有(`~/.pi-desktop/approval.json`),默认 `approve`(危险命令逐条确认);渲染进程只能切换模式,不能自行放行。审批请求的自动放行也在主进程完成,事件根本不下发渲染进程。
- **文件操作**:会话删除/归档会校验路径必须位于 sessions 目录内的 `.jsonl`,防止路径穿越。

## 已知限制

- Windows 为优先开发平台;macOS 支持已就绪,但需在 mac 上完成真机验证与打包(构建/签名)。
- 每个用过的 workspace 有一个常驻 pi 进程(内存随开数增长);**空闲 10 分钟且不在执行中会自动回收**,下次使用时懒启动。
- provider/模型配置变更需要重启全部后端进程才生效(pi 进程启动时缓存配置,实测不热感知);保存时若有任务在运行会提示确认。
- 打包时内置 pi 以 `build/runtime.tar` 单文件随包附带,首次启动解到用户目录(见「内置 pi 装在哪里」);改了这部分逻辑(`src/main/runtime.ts` / `scripts/build-runtime.mjs`)要重新验证打包版的首次启动与二次启动。
- OAuth 订阅式 provider(`/login` 的 ChatGPT/Claude/Copilot 等)是 TUI 交互流,RPC 驱动不了,不支持;API key 路线已覆盖主流模型。
- 工具审批等交互依赖 pi 扩展走 extension_ui 子协议(已适配 confirm/select/input);pi 自身在 RPC 模式下没有内置审批 UI。
- 会话列表为自扫描实现,按 (mtime,size) 做增量缓存;会话极多时首次加载仍会读每个文件头(单文件最多 64KB)。
- 消息流默认只渲染最近 60 条(更早的折叠,可一键展开),避免长会话流式时重解析全部 Markdown。
- 主题仅深浅两套,token 取自 Kimi 官方前端。
