# 定时任务 / Scheduled Tasks

给 DeepSeek Harness Desktop 增加一个左侧边栏入口「定时任务」。它按计划在指定工作空间里新建一轮会话并发送提示词，同时保留每次运行的状态与对应会话入口。

## 功能

- 左侧边栏新增面板入口（位于「插件」「自动化任务」之后），打开全局任务页。
- 新建任务对话框：任务名称、提示词、工作空间（可选其它文件夹）、权限模式、重复规则、时间、创建后是否立即启用。
- 重复规则：每天、每周（多选星期）、固定间隔（N 分钟）、仅一次。
- 任务卡片：启用/暂停开关、立即运行、删除；显示规则、下次运行时间。
- 运行记录：每次运行的触发方式、开始时间、耗时、状态、摘要，以及「打开会话」。
- 所有任务与运行记录持久化到 `$DSH_HOME/schedule-center/state.json`。

每次运行都会通过宿主会话控制器新建一个普通会话（`sessionController.create` + `prompt`），因此：

- 任务的历史对话可以在侧边栏和「运行记录」里继续查看；
- 同一任务再次运行时使用全新会话，不会污染上一次的上下文；
- 所选权限预设会在提示词进入模型之前应用到新会话；
- 只选择目录时，该目录会被注册为工作空间，运行产生的会话因此出现在侧边栏对应工作空间下。

## 安装

插件目录位于工作区 `plugins/dsh-schedule-center`。通过 Plugin Manager 安装本地目录：

```
plugin_manager install_bundle target=D:\Program Files (x86)\dsh-deploy\plugins\dsh-schedule-center
```

磁盘上的修改需要重启或重新安装才会生效；安装完成后左侧边栏出现「定时任务」。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主插件：任务存储、定时器、运行调度、JSON API、会话事件跟踪 |
| `lib/schedule.js` | 纯函数：规则校验与下次运行时间计算（本地时区） |
| `client.js` | 浏览器插件：侧边栏图标、任务页、运行记录、新建/删除对话框与样式 |
| `cordis.patch.yml` | 向 Profile 插入 `schedule-center` 行 |
| `locale/*.json` | Plugin Manager 展示用的标题与描述 |
| `test/schedule.test.mjs` | 规则计算的单元测试 |

## HTTP API

所有接口都位于 `http://127.0.0.1:<port>/plugins/schedule-center`，并先经过 `ctx.connection.requestRejection` 的 Origin 校验与浏览器身份校验。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/state` | 任务、运行记录、工作空间、权限预设快照 |
| POST | `/tasks` | 新建任务 |
| POST | `/tasks/:id/enabled` | 启用/暂停 |
| POST | `/tasks/:id/run` | 立即运行 |
| DELETE | `/tasks/:id` | 删除任务及其运行记录 |

## 行为与边界

- **宿主必须运行**：定时器属于 Host 进程，关闭 Desktop 后不会触发；重新启动后，错过的任务会在下一个 tick 运行一次（不补跑多次）。
- **时区**：每天/每周按 Host 进程的本地时区计算。仅一次任务按浏览器选择的时间换算为绝对时间保存。
- **运行状态**：以会话的 `turn/end` 事件为准；广告「成功」表示本轮对话正常结束，不保证任务目标一定达成。运行超过 2 小时未结束会标记为失败。
- **暂停**只是不再触发，不中止正在进行的会话。
- **删除任务**会删除它的运行记录，但不会删除已经创建的会话。
- 暂不支持编辑已有任务、批量管理、推送到企业微信；这些可以在此版本上继续扩展。

## 开发

```powershell
node --test test/schedule.test.mjs   # 规则单元测试
node --check index.js
node --check client.js
```

修改 `client.js` 或 `index.js` 后需要重新安装/重启宿主才会加载新代码；client 端切面注册可用 `cordis_inspect_query`（Slots）确认。
