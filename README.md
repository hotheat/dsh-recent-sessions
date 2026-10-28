# dsh-recent-sessions

DSH Web 左侧栏的「最近」会话列表。
跨工作区收集有内容的会话，按最后活动时间倒序排列，过滤空白、已归档及 subagent 会话。
同时间戳保留宿主列表顺序。

## 位置与行为

插件通过 `sidebar.footer.action` 注册，从 owner props 读取 `wide`。
展开侧栏时，以第一个工作区分组段的父节点定位树容器，无论当前是否溢出。
React portal 固定渲染进插件自己的 host，host 挂在树容器的最后，和工作区共用滚动区域。
收起侧栏时整个区块卸载。

头部可折叠，选择保存到浏览器 localStorage 的 `dsh-recent-sessions:collapsed`。
首屏显示 10 条，点击「展开更多」每次增加 10 条。
点击标题通过 `ctx.uiWorkspace.openSession(id)` 打开会话。
状态显示复用原生 `StateDot`：运行中显示原生 spinner，等待响应显示 warning 点，跑完未读显示 done 点，其余不显示。
读屏通过行按钮的 `aria-label` 播报状态。
鼠标停留时用原生 tooltip 显示「项目名 · 相对时间」。

## 边界

工作区列表很长时，需要滚到底部才能看到「最近」。
单列表、搜索模式或没有可识别分组段的结构下，整个区块隐藏。
只有检测到分组段但取不到父节点的异常结构，才回退到 footer 内联显示，并使用限高的内部滚动。
过滤后没有会话时，整个区块隐藏。

插件只移动自己拥有的 host，React 管理 host 内部的内容。
观察器仅监听侧栏内的子节点变化，通过 requestAnimationFrame 合并重定位，卸载时取消待执行帧并移除 host。
标题优先使用宿主的 `title`，缺失时使用宿主的 `displayTitle`。
中英文跟随宿主 locale，默认中文；颜色跟随宿主主题 token。

## 安装与卸载

```sh
dsh plugin --profile web add github:hotheat/dsh-recent-sessions
```

浏览器半由 DSH 启动时载入内存，安装或修改后需要重启 `dsh web`，刷新页面不足以生效。

卸载：

```sh
dsh plugin --profile web remove dsh-recent-sessions
```

可选清除浏览器 localStorage 键 `dsh-recent-sessions:collapsed` 以重置折叠选择。

## 验证

在本目录执行：

```sh
node --check lib/index.js
node --check lib/client.js
npm test
```

`test/client-load.mjs` 检查 ModuleLoader 和槽位契约。
`test/rows.mjs` 检查派生、排序、过滤及分页。
`test/portal.mjs` 检查短树挂载、无分组隐藏、host 移动、异常结构回退、帧合并与观察器清理。

实现参考 [ttmouse/dsh-recent](https://github.com/ttmouse/dsh-recent) 的 ModuleLoader、槽位与 portal 机制，原生契约以 DeepSeek Harness 源码为准。
