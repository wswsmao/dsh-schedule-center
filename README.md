# 定时任务 / Scheduled Tasks

给 DeepSeek Harness Desktop 增加一个左侧边栏入口「定时任务」。它按计划在指定工作空间里新建一轮会话并发送提示词，同时保留每次运行的状态与对应会话入口。

## 功能

- 左侧边栏新增面板入口（位于「插件」「自动化任务」之后），打开全局任务页。
- 新建任务对话框：任务名称、提示词、工作空间（可选其它文件夹）、权限模式、重复规则、时间、创建后是否立即启用。
- 重复规则：每天、每周（多选星期）、固定间隔（N 分钟）、仅一次。
- 任务卡片：启用/暂停开关、立即运行、删除；显示规则、下次运行时间。
- 运行记录：每次运行的触发方式、开始时间、耗时、状态、摘要，以及「打开会话」。
- 所有任务与运行记录持久化到 `$DSH_HOME/schedule-center/state.json`。

提示词任务每次运行都会通过宿主会话控制器新建一个普通会话（`sessionController.create` + `prompt`），因此：

- 任务的历史对话可以在侧边栏和「运行记录」里继续查看；
- 同一任务再次运行时使用全新会话，不会污染上一次的上下文；
- 所选权限预设会在提示词进入模型之前应用到新会话；
- 只选择目录时，该目录会被注册为工作空间，运行产生的会话因此出现在侧边栏对应工作空间下。

## 固定业务任务

新增任务时可选择“提示词任务”或“固定业务任务”。旧任务缺少类型时自动按提示词任务读取，原有会话与权限选择保持不变。

固定业务任务只选择已注册业务动作和项目工作空间，不输入提示词、不新建模型会话，也不由工具选择或提升模型权限。权限、发布授权、模型配置由对应业务插件独立校验。运行记录保留业务服务的 `complete`、`partial`、`failed`、`blocked`、`cancelled`、`interrupted` 等真实状态，以及业务运行ID、阶段和报告链接。

消费插件声明 `scheduleCenter` 依赖并在其效果中注册：

```js
ctx.effect(() => ctx.scheduleCenter.registerAction({
  id: 'ai-tech-daily',
  title: 'AI技术日报',
  description: '采集、归档并发布AI技术日报。',
  start: ({ project_dir, trigger, schedule_occurrence }) =>
    ctx.aiDaily.start({ project_dir, trigger, schedule_occurrence }),
  status: (runId) => ctx.aiDaily.status(runId),
  cancel: (runId) => ctx.aiDaily.cancel(runId),
}))
```

`start` 必须返回 `{ run_id, status }`，`status` 返回 `{ status, stages?, report_url?, summary?, error?, stop_reason? }`。`schedule_occurrence` 是稳定业务幂等键。业务服务必须对相同键重复请求返回同一个run receipt，以恢复“已开始但尚未存回receipt”的崩溃窗口；不支持该幂等语义的动作不应注册为定时业务。

同一任务运行期间不会再次触发。定时intent与下次触发时间在业务调用前持久化；重启后有receipt只查状态，无receipt使用相同幂等键恢复。业务插件暂未加载时等待注册，不调用模型兜底；超8小时无法结束或恢复时明确失败，不重放新任务。固定业务沿用原有15秒ticker，没有第二套定时器。

Agent工具 `schedule_center` 提供 `list`（含动作目录）、`read`、`create_business`、`run`、`cancel_run`、`set_enabled`、`delete`。它与网页调用同一实现；创建工具没有权限参数。`cancel_run.run_id` 是定时任务运行记录ID，不是业务内部run_id。运行中的业务任务必须取消并结束后才能删除，避免丢失恢复receipt。

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
| POST | `/runs/:id/cancel` | 请求取消固定业务运行 |

## 行为与边界

- **宿主必须运行**：定时器属于 Host 进程，关闭 Desktop 后不会触发；重新启动后，错过的任务会在下一个 tick 运行一次（不补跑多次）。
- **时区**：每天/每周按 Host 进程的本地时区计算。仅一次任务按浏览器选择的时间换算为绝对时间保存。
- **提示词运行状态**：以会话的 `turn/end` 事件为准；「成功」表示本轮对话正常结束，不保证任务目标一定达成。超过2小时未结束标记失败。
- **固定业务运行状态**：依据业务provider真实终态，不以模型turn/end冒充完成；最长追踪8小时，部分完成和需处理明确保留。
- **暂停**只是不再触发，不中止正在进行的会话。
- **删除任务**会删除它的运行记录，但不会删除已经创建的会话。
- 暂不支持编辑已有任务、批量管理、推送到企业微信；这些可以在此版本上继续扩展。

## 开发

```powershell
node --test test/*.test.mjs   # 规则、业务生命周期、prompt回归与UI结构测试
node --check index.js
node --check client.js
```

修改 `client.js` 或 `index.js` 后需要重新安装/重启宿主才会加载新代码；client 端切面注册可用 `cordis_inspect_query`（Slots）确认。
