/**
 * Browser half of the scheduled-tasks plugin.
 *
 * Registers one global panel beside the shipped Plugins and Automation tasks
 * entries, renders the task list and run records, and owns the new-task dialog.
 * Data comes from the Host half's `/plugins/schedule-center` JSON API.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-schedule-center',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'schedule-center'
    const PANEL_ID = 'schedule-center'
    const API = '/plugins/schedule-center'
    const STYLE_ID = '@local/dsh-schedule-center/ScheduleCenterPage.css'

    // ---------------------------------------------------------------- copy

    const zh = {
      'meta.locale': 'zh-CN',
      'panel': '定时任务',
      'page.subtitle': '按计划在你的工作空间里自动运行提示词。',
      'tab.tasks': '定时任务',
      'tab.runs': '运行记录',
      'new.action': '新建',
      'refresh.action': '刷新',
      'filter.all': '全部',
      'filter.enabled': '已启用',
      'filter.paused': '已暂停',
      'search.placeholder': '搜索任务',
      'search.clear': '清除搜索',
      'empty.title': '还没有定时任务',
      'empty.body': '创建一个任务，让它在指定时间自动开始一轮对话。',
      'empty.action': '新建任务',
      'empty.filtered': '没有匹配的任务。',
      'card.runNow': '立即运行',
      'card.delete': '删除任务',
      'card.enable': '启用任务',
      'card.disable': '暂停任务',
      'card.paused': '已暂停',
      'card.finished': '已完成',
      'card.nextPrefix': '',
      'card.lastRun': '上次运行',
      'card.promptEmpty': '（没有提示词）',
      'freq.daily': '每天 {time}',
      'freq.weekly': '每{weekdays} {time}',
      'freq.hours': '每 {count} 小时',
      'freq.minutes': '每 {count} 分钟',
      'freq.once': '仅一次 · {time}',
      'freq.join': '、',
      'weekday.1': '周一',
      'weekday.2': '周二',
      'weekday.3': '周三',
      'weekday.4': '周四',
      'weekday.5': '周五',
      'weekday.6': '周六',
      'weekday.7': '周日',
      'next.due': '即将执行',
      'next.minutes': '{count} 分钟后执行',
      'next.hours': '{count} 小时后执行',
      'next.days': '{count} 天后执行',
      'next.date': '{date} 执行',
      'run.status.running': '运行中',
      'run.status.success': '成功',
      'run.status.error': '失败',
      'run.openSession': '打开会话',
      'run.noSession': '尚未创建会话',
      'run.empty': '还没有运行记录',
      'run.emptyBody': '任务运行后，这里会保留每次运行的状态和会话入口。',
      'run.trigger.schedule': '定时触发',
      'run.trigger.manual': '手动触发',
      'run.duration.seconds': '{count} 秒',
      'run.duration.minutes': '{minutes} 分 {seconds} 秒',
      'run.duration.hours': '{hours} 小时 {minutes} 分',
      'delete.title': '删除任务',
      'delete.body': '“{name}”将被移除，运行记录也会一并删除；已经创建的会话会保留。',
      'delete.cancel': '取消',
      'delete.confirm': '删除',
      'dialog.title': '新建定时任务',
      'dialog.namePlaceholder': '输入任务名称',
      'dialog.promptPlaceholder': '添加提示词',
      'dialog.workspace': '选择工作空间',
      'dialog.workspaceCustom': '选择其他文件夹…',
      'dialog.permission': '权限',
      'dialog.repeat': '重复',
      'dialog.repeat.daily': '每天',
      'dialog.repeat.weekly': '每周',
      'dialog.repeat.every': '固定间隔',
      'dialog.repeat.once': '仅一次',
      'dialog.time': '时间',
      'dialog.weekdays': '星期',
      'dialog.every': '间隔',
      'dialog.minutes': '分钟',
      'dialog.onceAt': '执行时间',
      'dialog.enable': '创建后立即启用',
      'dialog.cancel': '取消',
      'dialog.submit': '确定',
      'dialog.submitting': '创建中…',
      'dialog.error.name': '请填写任务名称。',
      'dialog.error.prompt': '请填写任务提示词。',
      'dialog.error.workspace': '请选择工作空间。',
      'dialog.error.once': '执行时间必须晚于当前时间。',
      'dialog.error.every': '间隔必须是大于 0 的整数分钟。',
      'dialog.anyDay': '请选择星期',
      'permission.fullAccess': '允许完全访问',
      'permission.workspaceWrite': '仅限工作空间',
      'notice.created': '任务已创建',
      'notice.enabled': '任务已启用',
      'notice.paused': '任务已暂停',
      'notice.ran': '任务已开始运行',
      'notice.deleted': '任务已删除',
      'error.fetch': '无法读取任务列表。',
      'error.action': '操作失败。',
      'status.loading': '加载中…',
      'status.retry': '重试',
      'common.close': '关闭',
      'common.never': '未运行',
      'common.auto': '自动',
    }

    const en = {
      'meta.locale': 'en-US',
      'panel': 'Scheduled tasks',
      'page.subtitle': 'Run prompts automatically in your workspace on a schedule.',
      'tab.tasks': 'Scheduled tasks',
      'tab.runs': 'Run records',
      'new.action': 'New',
      'refresh.action': 'Refresh',
      'filter.all': 'All',
      'filter.enabled': 'Enabled',
      'filter.paused': 'Paused',
      'search.placeholder': 'Search tasks',
      'search.clear': 'Clear search',
      'empty.title': 'No scheduled tasks yet',
      'empty.body': 'Create a task and it will start a conversation on its own schedule.',
      'empty.action': 'Create task',
      'empty.filtered': 'No matching tasks.',
      'card.runNow': 'Run now',
      'card.delete': 'Delete task',
      'card.enable': 'Enable task',
      'card.disable': 'Pause task',
      'card.paused': 'Paused',
      'card.finished': 'Finished',
      'card.nextPrefix': '',
      'card.lastRun': 'Last run',
      'card.promptEmpty': '(no prompt)',
      'freq.daily': 'Every day {time}',
      'freq.weekly': 'Every {weekdays} {time}',
      'freq.hours': 'Every {count} hours',
      'freq.minutes': 'Every {count} minutes',
      'freq.once': 'Once · {time}',
      'freq.join': ', ',
      'weekday.1': 'Mon',
      'weekday.2': 'Tue',
      'weekday.3': 'Wed',
      'weekday.4': 'Thu',
      'weekday.5': 'Fri',
      'weekday.6': 'Sat',
      'weekday.7': 'Sun',
      'next.due': 'Runs soon',
      'next.minutes': 'Runs in {count} min',
      'next.hours': 'Runs in {count} h',
      'next.days': 'Runs in {count} days',
      'next.date': 'Runs {date}',
      'run.status.running': 'Running',
      'run.status.success': 'Succeeded',
      'run.status.error': 'Failed',
      'run.openSession': 'Open conversation',
      'run.noSession': 'No conversation yet',
      'run.empty': 'No run records yet',
      'run.emptyBody': 'Each run leaves its status and a conversation link here.',
      'run.trigger.schedule': 'Scheduled',
      'run.trigger.manual': 'Manual',
      'run.duration.seconds': '{count}s',
      'run.duration.minutes': '{minutes}m {seconds}s',
      'run.duration.hours': '{hours}h {minutes}m',
      'delete.title': 'Delete task',
      'delete.body': '“{name}” will be removed with its run records. Conversations it created are kept.',
      'delete.cancel': 'Cancel',
      'delete.confirm': 'Delete',
      'dialog.title': 'New scheduled task',
      'dialog.namePlaceholder': 'Task name',
      'dialog.promptPlaceholder': 'Add a prompt',
      'dialog.workspace': 'Workspace',
      'dialog.workspaceCustom': 'Choose another folder…',
      'dialog.permission': 'Permission',
      'dialog.repeat': 'Repeat',
      'dialog.repeat.daily': 'Every day',
      'dialog.repeat.weekly': 'Every week',
      'dialog.repeat.every': 'Fixed interval',
      'dialog.repeat.once': 'Once',
      'dialog.time': 'Time',
      'dialog.weekdays': 'Weekdays',
      'dialog.every': 'Interval',
      'dialog.minutes': 'minutes',
      'dialog.onceAt': 'Runs at',
      'dialog.enable': 'Enable after creating',
      'dialog.cancel': 'Cancel',
      'dialog.submit': 'Create',
      'dialog.submitting': 'Creating…',
      'dialog.error.name': 'Enter a task name.',
      'dialog.error.prompt': 'Enter a prompt.',
      'dialog.error.workspace': 'Choose a workspace.',
      'dialog.error.once': 'The run time must be in the future.',
      'dialog.error.every': 'The interval must be a whole number of minutes.',
      'dialog.anyDay': 'Pick a weekday',
      'permission.fullAccess': 'Full access',
      'permission.workspaceWrite': 'Workspace only',
      'notice.created': 'Task created',
      'notice.enabled': 'Task enabled',
      'notice.paused': 'Task paused',
      'notice.ran': 'Task started',
      'notice.deleted': 'Task deleted',
      'error.fetch': 'Could not load tasks.',
      'error.action': 'The action failed.',
      'status.loading': 'Loading…',
      'status.retry': 'Retry',
      'common.close': 'Close',
      'common.never': 'Never',
      'common.auto': 'Auto',
    }

    // ------------------------------------------------------------- styles

    const CSS = `
.dsc-page{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.55}
.dsc-top{display:flex;align-items:center;gap:8px;width:100%;max-width:1000px;margin:0 auto;padding:22px clamp(20px,4vw,44px) 0;box-sizing:border-box}
.dsc-tabs{display:flex;align-items:center;gap:2px;margin-right:auto;min-width:0}
.dsc-tab{height:34px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:22px;cursor:pointer;white-space:nowrap}
.dsc-tab:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent));color:var(--dsw-alias-label-primary)}
.dsc-tab[aria-selected=true]{color:var(--dsw-alias-label-primary);font-weight:500;background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent))}
.dsc-actions{display:flex;align-items:center;gap:8px;flex:none}
.dsc-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.dsc-content{width:100%;max-width:1000px;margin:0 auto;padding:18px clamp(20px,4vw,44px) 48px;box-sizing:border-box}
.dsc-lead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:2px 0 16px;flex-wrap:wrap}
.dsc-lead h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dsc-lead p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}
.dsc-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.dsc-chip{height:30px;padding:0 12px;border:0;border-radius:15px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.dsc-chip:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent));color:var(--dsw-alias-label-primary)}
.dsc-chip[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent));color:var(--dsw-alias-label-primary);font-weight:500}
.dsc-search{display:flex;align-items:center;gap:6px;height:34px;min-width:200px;padding:0 10px;margin-left:auto;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:10px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsc-search:focus-within{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
.dsc-search input{flex:1;min-width:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsc-search input::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.dsc-card{position:relative;display:flex;flex-direction:column;gap:12px;min-width:0;padding:16px 18px 13px;border:.5px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s}
.dsc-card:hover{border-color:var(--dsw-alias-border-l2)}
.dsc-card[data-disabled=true]{background:var(--dsw-alias-bg-layer-1)}
.dsc-card-head{display:flex;align-items:flex-start;gap:8px}
.dsc-card-title{flex:1;min-width:0;margin:0;font-size:15px;font-weight:500;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-card[data-disabled=true] .dsc-card-title{color:var(--dsw-alias-label-secondary)}
.dsc-card-tools{display:flex;align-items:center;gap:2px;flex:none}
.dsc-card-prompt{margin:0;min-height:44px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.dsc-card-foot{display:flex;align-items:center;gap:8px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12.5px;min-width:0}
.dsc-card-freq{display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-card-next{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsc-hover-action{opacity:0}
.dsc-card:hover .dsc-hover-action,.dsc-card:focus-within .dsc-hover-action{opacity:1}
@media (hover:none){.dsc-hover-action{opacity:1}}
.dsc-iconbtn{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.dsc-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent));color:var(--dsw-alias-label-primary)}
.dsc-iconbtn[data-danger=true]:hover{color:var(--dsw-alias-state-error-primary)}
.dsc-iconbtn:disabled{opacity:.4;cursor:default}
.dsc-switch{position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));cursor:pointer;box-sizing:border-box}
.dsc-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.dsc-switch:disabled{opacity:.5;cursor:default}
.dsc-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-bg-base));transition:transform .12s ease}
.dsc-switch[aria-checked=false] .dsc-switch-thumb{background:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.dsc-switch[aria-checked=true] .dsc-switch-thumb{transform:translateX(16px)}
.dsc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:72px 20px;text-align:center;border:.5px dashed var(--dsw-alias-border-l2);border-radius:18px;color:var(--dsw-alias-label-secondary)}
.dsc-empty h2{margin:6px 0 0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500}
.dsc-empty p{margin:0;max-width:380px;font-size:13px}
.dsc-empty .dsc-glyph{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsc-empty .dsc-btn{margin-top:8px}
.dsc-running{padding:56px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}
.dsc-error{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;color:var(--dsw-alias-state-error-primary);font-size:13px}
.dsc-error button{margin-left:auto}
.dsc-notice{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:9px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);font-size:13px;animation:dsc-fade .16s ease}
.dsc-notice[data-kind=error]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
@keyframes dsc-fade{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.dsc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;cursor:pointer;white-space:nowrap}
.dsc-btn:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent))}
.dsc-btn:disabled{opacity:.4;cursor:not-allowed}
.dsc-btn[data-variant=primary]{height:38px;padding:0 18px;border-radius:19px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.dsc-btn[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-label-primary));opacity:.92}
.dsc-btn[data-variant=outline]{border:.5px solid var(--dsw-alias-border-l2)}
.dsc-btn[data-variant=ghost]{color:var(--dsw-alias-label-secondary)}
.dsc-runs{display:flex;flex-direction:column;gap:2px}
.dsc-run{display:flex;align-items:flex-start;gap:12px;padding:12px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsc-run:last-child{border-bottom:0}
.dsc-dot{flex:none;width:8px;height:8px;margin-top:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.dsc-dot[data-status=success]{background:var(--dsw-alias-state-success-primary)}
.dsc-dot[data-status=error]{background:var(--dsw-alias-state-error-primary)}
.dsc-dot[data-status=running]{background:var(--dsw-alias-state-warn-primary)}
.dsc-run-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsc-run-title{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}
.dsc-run-title strong{font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dsc-run-meta{color:var(--dsw-alias-label-secondary);font-size:12.5px;display:flex;gap:10px;flex-wrap:wrap}
.dsc-run-summary{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.dsc-run-side{flex:none;display:flex;align-items:center;gap:6px;padding-top:1px}
.dsc-badge{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:11px;background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent));color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.dsc-badge[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.dsc-badge[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.dsc-badge[data-tone=running]{color:var(--dsw-alias-state-warn-primary)}
.dsc-section-title{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:15px;font-weight:500}
.dsc-section-title span{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:400}
.dsc-dialog{box-sizing:border-box;width:min(780px,calc(100vw - 40px));max-width:none;max-height:none;margin:auto;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary)}
.dsc-dialog::backdrop{background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.dsc-dialog-card{display:flex;flex-direction:column;gap:16px;padding:22px 26px 20px;border-radius:20px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent,0 24px 64px rgba(0,0,0,.28))}
.dsc-dialog-head{display:flex;align-items:center;gap:12px}
.dsc-dialog-head h2{margin:0;font-size:18px;font-weight:600;line-height:26px}
.dsc-dialog-head .dsc-iconbtn{margin-left:auto}
.dsc-dialog-note{margin:-6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}
.dsc-input{box-sizing:border-box;width:100%;height:44px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;outline:none}
.dsc-input::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsc-input:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
.dsc-prompt-box{display:flex;flex-direction:column;min-height:210px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:16px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dsc-prompt-box:focus-within{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
.dsc-prompt-box textarea{flex:1;min-height:146px;padding:14px 16px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:1.6;resize:none;outline:none}
.dsc-prompt-box textarea::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsc-prompt-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsc-pill{position:relative;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;max-width:100%}
.dsc-pill:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent));color:var(--dsw-alias-label-primary)}
.dsc-pill[data-warn=true]{color:var(--dsw-alias-state-warn-primary)}
.dsc-pill select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font:inherit}
.dsc-pill .dsc-pill-text{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsc-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.dsc-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsc-field-label{color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dsc-control{position:relative;display:flex;align-items:center;height:38px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:10px;background:transparent;padding:0 10px;gap:6px}
.dsc-control select,.dsc-control input{flex:1;min-width:0;height:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;outline:none}
.dsc-control .dsc-suffix{color:var(--dsw-alias-label-secondary);font-size:13px;flex:none}
.dsc-field[data-wide=true]{grid-column:1/-1}
.dsc-weekdays{display:flex;gap:6px;flex-wrap:wrap}
.dsc-weekday{width:40px;height:32px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dsc-weekday[aria-pressed=true]{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent));color:var(--dsw-alias-label-primary)}
.dsc-enable{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.dsc-enable .dsc-switch{margin-left:auto}
.dsc-form-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:13px}
.dsc-dialog-foot{display:flex;justify-content:flex-end;gap:10px;padding-top:2px}
.dsc-confirm-card{width:min(420px,calc(100vw - 40px))}
.dsc-confirm-body{margin:0;color:var(--dsw-alias-label-secondary);font-size:13.5px;line-height:1.6}
.dsc-confirm-body b{color:var(--dsw-alias-label-primary);font-weight:500}
.dsc-muted{color:var(--dsw-alias-label-secondary)}
.dsc-spin{animation:dsc-spin 1s linear infinite}
@keyframes dsc-spin{to{transform:rotate(360deg)}}
`

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-schedule-center'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    // ------------------------------------------------------------- icons

    const svgProps = (size, extra) => ({
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
      ...extra,
    })

    function SidebarIcon({ size }) {
      return h(
        'svg',
        svgProps(size, { strokeWidth: 1.5 }),
        h('circle', { cx: 12, cy: 12, r: 8.5 }),
        h('path', { d: 'M12 7.5V12l3 1.8' }),
        h('path', { d: 'M17.8 4.2l1 1' }),
      )
    }

    function IconClock({ size = 14 }) {
      return h('svg', svgProps(size), h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: 'M12 7.5V12l3 1.8' }))
    }

    function IconPlus({ size = 15 }) {
      return h('svg', svgProps(size), h('path', { d: 'M12 5v14M5 12h14' }))
    }

    function IconClose({ size = 16 }) {
      return h('svg', svgProps(size), h('path', { d: 'M6 6l12 12M18 6L6 18' }))
    }

    function IconPlay({ size = 15 }) {
      return h('svg', svgProps(size), h('path', { d: 'M9 6.5l8 5.5-8 5.5z' }))
    }

    function IconTrash({ size = 15 }) {
      return h('svg', svgProps(size), h('path', { d: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12' }))
    }

    function IconRefresh({ size = 15 }) {
      return h('svg', svgProps(size), h('path', { d: 'M20 12a8 8 0 1 1-2.4-5.7' }), h('path', { d: 'M20 5v5h-5' }))
    }

    function IconFolder({ size = 14 }) {
      return h('svg', svgProps(size), h('path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h3.2l1.8 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }))
    }

    function IconWarning({ size = 14 }) {
      return h('svg', svgProps(size), h('path', { d: 'M12 4.5l8 14H4z' }), h('path', { d: 'M12 10v4M12 16.5v.01' }))
    }

    function IconSearch({ size = 14 }) {
      return h('svg', svgProps(size), h('circle', { cx: 11, cy: 11, r: 6.5 }), h('path', { d: 'M16 16l4 4' }))
    }

    function IconCheck({ size = 14 }) {
      return h('svg', svgProps(size), h('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }))
    }

    function IconAlert({ size = 14 }) {
      return h('svg', svgProps(size), h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: 'M12 8v5M12 16v.01' }))
    }

    // ----------------------------------------------------------- helpers

    const pad2 = (value) => String(value).padStart(2, '0')

    function localeTag(t) {
      return t('meta.locale')
    }

    function formatClock(time) {
      return typeof time === 'string' ? time : ''
    }

    function formatDateTime(ms, t) {
      try {
        return new Intl.DateTimeFormat(localeTag(t), {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ms))
      } catch {
        return new Date(ms).toLocaleString()
      }
    }

    function formatRunTime(ms, t) {
      try {
        return new Intl.DateTimeFormat(localeTag(t), {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ms))
      } catch {
        return new Date(ms).toLocaleString()
      }
    }

    function weekdayText(weekdays, t) {
      return weekdays.map((day) => t(`weekday.${day}`)).join(t('freq.join'))
    }

    function frequencyText(schedule, t) {
      if (schedule === undefined || schedule === null) return ''
      switch (schedule.kind) {
        case 'daily':
          return t('freq.daily', { time: formatClock(schedule.time) })
        case 'weekly':
          return t('freq.weekly', { weekdays: weekdayText(schedule.weekdays, t), time: formatClock(schedule.time) })
        case 'every': {
          const minutes = schedule.everyMinutes
          if (minutes % 60 === 0) return t('freq.hours', { count: minutes / 60 })
          return t('freq.minutes', { count: minutes })
        }
        case 'once':
          return t('freq.once', { time: formatRunTime(Date.parse(schedule.at), t) })
        default:
          return ''
      }
    }

    function nextRunText(task, now, t) {
      if (task.enabled !== true || typeof task.nextRunAt !== 'number') {
        if (task.schedule?.kind === 'once' && task.lastStatus !== null) return t('card.finished')
        return t('card.paused')
      }
      const diff = task.nextRunAt - now
      if (diff <= 30_000) return t('next.due')
      const minutes = Math.round(diff / 60_000)
      if (minutes < 60) return t('next.minutes', { count: Math.max(1, minutes) })
      const hours = Math.round(minutes / 60)
      if (hours < 24) return t('next.hours', { count: hours })
      const days = Math.round(hours / 24)
      if (days <= 14) return t('next.days', { count: days })
      return t('next.date', { date: formatRunTime(task.nextRunAt, t) })
    }

    function durationText(startedAt, finishedAt, t) {
      const seconds = Math.max(0, Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000))
      if (seconds < 60) return t('run.duration.seconds', { count: seconds })
      if (seconds < 3600) return t('run.duration.minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
      return t('run.duration.hours', { hours: Math.floor(seconds / 3600), minutes: Math.floor((seconds % 3600) / 60) })
    }

    function permissionLabel(permission, options, t) {
      if (permission === 'danger-full-access') return t('permission.fullAccess')
      if (permission === 'workspace-write') return t('permission.workspaceWrite')
      const option = Array.isArray(options) ? options.find((entry) => entry.value === permission) : undefined
      return option?.name ?? permission ?? t('common.auto')
    }

    function basename(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[\\/]+/).filter(Boolean)
      return parts.length === 0 ? path : parts[parts.length - 1]
    }

    function defaultTimeValue(offsetMinutes) {
      const date = new Date(Date.now() + offsetMinutes * 60_000)
      date.setSeconds(0, 0)
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function defaultOnceValue() {
      const date = new Date(Date.now() + 60 * 60_000)
      date.setSeconds(0, 0)
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function useNow(intervalMs) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    // -------------------------------------------------------- data access

    function useSnapshot() {
      const [snapshot, setSnapshot] = useState({ status: 'loading', data: null, error: null })
      const aliveRef = useRef(true)

      const reload = useCallback(async () => {
        try {
          const response = await fetch(`${API}/state`, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true || payload.state === undefined) {
            throw new Error(payload?.message || `HTTP ${response.status}`)
          }
          if (aliveRef.current) setSnapshot({ status: 'ready', data: payload.state, error: null })
        } catch (error) {
          if (!aliveRef.current) return
          setSnapshot((previous) => ({
            status: previous.data === null ? 'error' : 'stale',
            data: previous.data,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }, [])

      useEffect(() => {
        aliveRef.current = true
        void reload()
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void reload()
        }, 8000)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
        }
      }, [reload])

      return { ...snapshot, reload }
    }

    function requestJson(path, init) {
      return fetch(API + path, {
        cache: 'no-store',
        ...init,
        headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      }).then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload?.ok !== true) {
          const error = new Error(payload?.message || `HTTP ${response.status}`)
          error.code = payload?.code
          throw error
        }
        return payload
      })
    }

    // ------------------------------------------------------------ dialogs

    function useModal(open) {
      const ref = useRef(null)
      useEffect(() => {
        const element = ref.current
        if (!open || element === null) return undefined
        if (!element.open) {
          try {
            element.showModal()
          } catch {
            element.setAttribute('open', '')
          }
        }
        return () => {
          if (element.open) element.close()
        }
      }, [open])
      return ref
    }

    function NewTaskDialog({ t, workspaces, permissions, onClose, onCreated }) {
      const open = true
      const ref = useModal(open)
      const nameRef = useRef(null)
      const [name, setName] = useState('')
      const [prompt, setPrompt] = useState('')
      const [target, setTarget] = useState(() => {
        const first = Array.isArray(workspaces) && workspaces.length > 0 ? workspaces[0] : null
        return first === null ? { kind: 'custom', cwd: '' } : { kind: 'workspace', id: first.id, cwd: first.path, title: first.title }
      })
      const [permission, setPermission] = useState(() => permissions?.defaultPreset ?? 'danger-full-access')
      const [repeat, setRepeat] = useState('daily')
      const [time, setTime] = useState(() => defaultTimeValue(1))
      const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5])
      const [everyMinutes, setEveryMinutes] = useState(60)
      const [onceAt, setOnceAt] = useState(defaultOnceValue)
      const [enabled, setEnabled] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      useEffect(() => {
        const handle = requestAnimationFrame(() => nameRef.current?.focus())
        return () => cancelAnimationFrame(handle)
      }, [])

      const close = useCallback(() => {
        if (!busy) onClose()
      }, [busy, onClose])

      const chooseWorkspace = useCallback(
        async (event) => {
          const value = event.target.value
          if (value === '__custom') {
            const picked = await (onCreated.pickDirectory ? onCreated.pickDirectory() : null)
            if (typeof picked === 'string' && picked !== '') setTarget({ kind: 'custom', cwd: picked })
            return
          }
          const workspace = workspaces.find((entry) => entry.id === value)
          if (workspace !== undefined) setTarget({ kind: 'workspace', id: workspace.id, cwd: workspace.path, title: workspace.title })
        },
        [workspaces, onCreated],
      )

      const toggleWeekday = (day) => {
        setWeekdays((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort()))
      }

      async function submit(event) {
        event.preventDefault()
        if (busy) return
        setError('')
        if (name.trim() === '') {
          setError(t('dialog.error.name'))
          return
        }
        if (prompt.trim() === '') {
          setError(t('dialog.error.prompt'))
          return
        }
        if (target.kind === 'custom' && (typeof target.cwd !== 'string' || target.cwd === '')) {
          setError(t('dialog.error.workspace'))
          return
        }
        let schedule
        if (repeat === 'daily') schedule = { kind: 'daily', time }
        else if (repeat === 'weekly') {
          if (weekdays.length === 0) {
            setError(t('dialog.anyDay'))
            return
          }
          schedule = { kind: 'weekly', time, weekdays }
        } else if (repeat === 'every') {
          const minutes = Number(everyMinutes)
          if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isInteger(minutes)) {
            setError(t('dialog.error.every'))
            return
          }
          schedule = { kind: 'every', everyMinutes: minutes }
        } else {
          const parsed = new Date(onceAt)
          if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
            setError(t('dialog.error.once'))
            return
          }
          schedule = { kind: 'once', at: parsed.toISOString() }
        }
        setBusy(true)
        try {
          await requestJson('/tasks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: name.trim(),
              prompt,
              workspaceId: target.kind === 'workspace' ? target.id : undefined,
              cwd: target.kind === 'custom' ? target.cwd : undefined,
              permission,
              enabled,
              schedule,
            }),
          })
          onCreated.afterCreate()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setBusy(false)
        }
      }

      const workspaceLabel =
        target.kind === 'custom'
          ? basename(target.cwd) || t('dialog.workspaceCustom')
          : target.title || basename(target.cwd) || t('dialog.workspace')

      return h(
        'dialog',
        {
          ref,
          className: 'dsc-dialog',
          'aria-label': t('dialog.title'),
          onCancel: (event) => {
            event.preventDefault()
            close()
          },
          onClick: (event) => {
            if (event.target === ref.current) close()
          },
        },
        h(
          'form',
          { className: 'dsc-dialog-card', onSubmit: submit },
          h(
            'header',
            { className: 'dsc-dialog-head' },
            h('h2', null, t('dialog.title')),
            h('button', { type: 'button', className: 'dsc-iconbtn', onClick: close, 'aria-label': t('common.close') }, h(IconClose, { size: 16 })),
          ),
          h('input', {
            ref: nameRef,
            className: 'dsc-input',
            value: name,
            onChange: (event) => setName(event.target.value),
            placeholder: t('dialog.namePlaceholder'),
            'aria-label': t('dialog.namePlaceholder'),
            maxLength: 120,
          }),
          h(
            'div',
            { className: 'dsc-prompt-box' },
            h('textarea', {
              value: prompt,
              onChange: (event) => setPrompt(event.target.value),
              placeholder: t('dialog.promptPlaceholder'),
              'aria-label': t('dialog.promptPlaceholder'),
              rows: 6,
            }),
            h(
              'div',
              { className: 'dsc-prompt-tools' },
              h(
                'span',
                { className: 'dsc-pill', title: target.cwd },
                h(IconFolder),
                h('span', { className: 'dsc-pill-text' }, workspaceLabel),
                h(
                  'select',
                  { value: target.kind === 'workspace' ? target.id : '__custom', onChange: chooseWorkspace, 'aria-label': t('dialog.workspace') },
                  workspaces.map((workspace) =>
                    h('option', { key: workspace.id, value: workspace.id }, workspace.title || workspace.path),
                  ),
                  h('option', { value: '__custom' }, t('dialog.workspaceCustom')),
                ),
              ),
              h(
                'span',
                { className: 'dsc-pill', 'data-warn': permission === 'danger-full-access' ? 'true' : 'false', title: t('dialog.permission') },
                h(IconWarning),
                h('span', { className: 'dsc-pill-text' }, permissionLabel(permission, permissions?.options, t)),
                h(
                  'select',
                  { value: permission, onChange: (event) => setPermission(event.target.value), 'aria-label': t('dialog.permission') },
                  (permissions?.options ?? []).map((option) =>
                    h('option', { key: option.value, value: option.value }, permissionLabel(option.value, permissions.options, t)),
                  ),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsc-controls' },
            h(
              'label',
              { className: 'dsc-field' },
              h('span', { className: 'dsc-field-label' }, t('dialog.repeat')),
              h(
                'span',
                { className: 'dsc-control' },
                h(
                  'select',
                  { value: repeat, onChange: (event) => setRepeat(event.target.value) },
                  h('option', { value: 'daily' }, t('dialog.repeat.daily')),
                  h('option', { value: 'weekly' }, t('dialog.repeat.weekly')),
                  h('option', { value: 'every' }, t('dialog.repeat.every')),
                  h('option', { value: 'once' }, t('dialog.repeat.once')),
                ),
              ),
            ),
            repeat === 'daily' || repeat === 'weekly'
              ? h(
                  'label',
                  { className: 'dsc-field' },
                  h('span', { className: 'dsc-field-label' }, t('dialog.time')),
                  h('span', { className: 'dsc-control' }, h('input', { type: 'time', value: time, onChange: (event) => setTime(event.target.value) })),
                )
              : null,
            repeat === 'every'
              ? h(
                  'label',
                  { className: 'dsc-field' },
                  h('span', { className: 'dsc-field-label' }, t('dialog.every')),
                  h(
                    'span',
                    { className: 'dsc-control' },
                    h('input', {
                      type: 'number',
                      min: 1,
                      step: 1,
                      value: everyMinutes,
                      onChange: (event) => setEveryMinutes(event.target.value),
                    }),
                    h('span', { className: 'dsc-suffix' }, t('dialog.minutes')),
                  ),
                )
              : null,
            repeat === 'once'
              ? h(
                  'label',
                  { className: 'dsc-field', 'data-wide': 'true' },
                  h('span', { className: 'dsc-field-label' }, t('dialog.onceAt')),
                  h(
                    'span',
                    { className: 'dsc-control' },
                    h('input', { type: 'datetime-local', value: onceAt, onChange: (event) => setOnceAt(event.target.value) }),
                  ),
                )
              : null,
            repeat === 'weekly'
              ? h(
                  'div',
                  { className: 'dsc-field', 'data-wide': 'true' },
                  h('span', { className: 'dsc-field-label' }, t('dialog.weekdays')),
                  h(
                    'div',
                    { className: 'dsc-weekdays', role: 'group', 'aria-label': t('dialog.weekdays') },
                    [1, 2, 3, 4, 5, 6, 7].map((day) =>
                      h(
                        'button',
                        {
                          key: day,
                          type: 'button',
                          className: 'dsc-weekday',
                          'aria-pressed': weekdays.includes(day),
                          onClick: () => toggleWeekday(day),
                        },
                        t(`weekday.${day}`),
                      ),
                    ),
                  ),
                )
              : null,
          ),
          h(
            'label',
            { className: 'dsc-enable' },
            h('span', null, t('dialog.enable')),
            h(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': enabled,
                className: 'dsc-switch',
                onClick: () => setEnabled((value) => !value),
                'aria-label': t('dialog.enable'),
              },
              h('span', { className: 'dsc-switch-thumb' }),
            ),
          ),
          error === '' ? null : h('p', { className: 'dsc-form-error', role: 'alert' }, error),
          h(
            'footer',
            { className: 'dsc-dialog-foot' },
            h('button', { type: 'button', className: 'dsc-btn', onClick: close, disabled: busy }, t('dialog.cancel')),
            h(
              'button',
              { type: 'submit', className: 'dsc-btn', 'data-variant': 'primary', disabled: busy },
              busy ? t('dialog.submitting') : t('dialog.submit'),
            ),
          ),
        ),
      )
    }

    function ConfirmDeleteDialog({ t, task, busy, onCancel, onConfirm }) {
      const ref = useModal(true)
      return h(
        'dialog',
        { ref, className: 'dsc-dialog', 'aria-label': t('delete.title'), onCancel: (event) => {
          event.preventDefault()
          if (!busy) onCancel()
        } },
        h(
          'div',
          { className: 'dsc-dialog-card dsc-confirm-card' },
          h('header', { className: 'dsc-dialog-head' }, h('h2', null, t('delete.title'))),
          h('p', { className: 'dsc-confirm-body' }, t('delete.body', { name: task.name })),
          h(
            'footer',
            { className: 'dsc-dialog-foot' },
            h('button', { type: 'button', className: 'dsc-btn', onClick: onCancel, disabled: busy }, t('delete.cancel')),
            h(
              'button',
              {
                type: 'button',
                className: 'dsc-btn',
                'data-variant': 'primary',
                onClick: onConfirm,
                disabled: busy,
              },
              t('delete.confirm'),
            ),
          ),
        ),
      )
    }

    // -------------------------------------------------------------- cards

    function TaskCard({ task, now, t, pending, onToggle, onRun, onDelete }) {
      const disabled = task.enabled !== true
      return h(
        'article',
        { className: 'dsc-card', 'data-disabled': disabled ? 'true' : 'false' },
        h(
          'div',
          { className: 'dsc-card-head' },
          h('h2', { className: 'dsc-card-title', title: task.name }, task.name),
          h(
            'div',
            { className: 'dsc-card-tools' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsc-iconbtn dsc-hover-action',
                title: t('card.runNow'),
                'aria-label': `${t('card.runNow')}：${task.name}`,
                disabled: pending || task.running,
                onClick: onRun,
              },
              h(IconPlay),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsc-iconbtn dsc-hover-action',
                title: t('card.delete'),
                'aria-label': `${t('card.delete')}：${task.name}`,
                disabled: pending,
                onClick: onDelete,
              },
              h(IconTrash),
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'switch',
                className: 'dsc-switch',
                'aria-checked': task.enabled === true,
                'aria-label': task.enabled === true ? t('card.disable') : t('card.enable'),
                disabled: pending,
                onClick: onToggle,
              },
              h('span', { className: 'dsc-switch-thumb' }),
            ),
          ),
        ),
        h('p', { className: 'dsc-card-prompt' }, task.prompt || t('card.promptEmpty')),
        h(
          'div',
          { className: 'dsc-card-foot' },
          h('span', { className: 'dsc-card-freq' }, h(IconClock), frequencyText(task.schedule, t)),
          h('span', { className: 'dsc-card-next' }, nextRunText(task, now, t)),
        ),
      )
    }

    function RunRow({ run, t, onOpenSession }) {
      const status = run.status === 'success' || run.status === 'error' || run.status === 'running' ? run.status : 'error'
      return h(
        'div',
        { className: 'dsc-run' },
        h('span', { className: 'dsc-dot', 'data-status': status }),
        h(
          'div',
          { className: 'dsc-run-main' },
          h(
            'div',
            { className: 'dsc-run-title' },
            h('strong', { title: run.taskName }, run.taskName),
            h('span', { className: 'dsc-badge' }, run.trigger === 'manual' ? t('run.trigger.manual') : t('run.trigger.schedule')),
          ),
          h(
            'div',
            { className: 'dsc-run-meta' },
            h('span', null, formatRunTime(run.startedAt, t)),
            h('span', null, durationText(run.startedAt, run.finishedAt, t)),
            h('span', { className: 'dsc-badge', 'data-tone': status }, t(`run.status.${status}`)),
          ),
          run.summary === null || run.summary === undefined ? null : h('p', { className: 'dsc-run-summary' }, run.summary),
          run.error === null || run.error === undefined ? null : h('p', { className: 'dsc-run-summary', style: { color: 'var(--dsw-alias-state-error-primary)' } }, run.error),
        ),
        h(
          'div',
          { className: 'dsc-run-side' },
          run.sessionId === null || run.sessionId === undefined
            ? h('span', { className: 'dsc-muted', style: { fontSize: '12.5px' } }, t('run.noSession'))
            : h(
                'button',
                { type: 'button', className: 'dsc-btn', 'data-variant': 'outline', onClick: () => onOpenSession(run.sessionId) },
                t('run.openSession'),
              ),
        ),
      )
    }

    // --------------------------------------------------------------- page

    function ScheduleCenterPage(props) {
      const { t, pickDirectory, openSession } = props
      const snapshot = useSnapshot()
      const now = useNow(30_000)
      const [view, setView] = useState('tasks')
      const [filter, setFilter] = useState('all')
      const [search, setSearch] = useState('')
      const [dialogOpen, setDialogOpen] = useState(false)
      const [deleteTarget, setDeleteTarget] = useState(null)
      const [pendingId, setPendingId] = useState(null)
      const [notice, setNotice] = useState(null)

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 5000)
        return () => clearTimeout(timer)
      }, [notice])

      const data = snapshot.data
      const tasks = useMemo(() => (Array.isArray(data?.tasks) ? data.tasks : []), [data])
      const runs = useMemo(() => (Array.isArray(data?.runs) ? data.runs : []), [data])
      const workspaces = useMemo(() => (Array.isArray(data?.workspaces) ? data.workspaces : []), [data])
      const permissions = data?.permissions

      const counts = useMemo(
        () => ({
          all: tasks.length,
          enabled: tasks.filter((task) => task.enabled === true).length,
          paused: tasks.filter((task) => task.enabled !== true).length,
        }),
        [tasks],
      )

      const visibleTasks = useMemo(() => {
        const query = search.trim().toLowerCase()
        return tasks
          .filter((task) => filter === 'all' || (filter === 'enabled' ? task.enabled === true : task.enabled !== true))
          .filter(
            (task) =>
              query === '' ||
              task.name.toLowerCase().includes(query) ||
              String(task.prompt).toLowerCase().includes(query),
          )
          .slice()
          .sort((left, right) => {
            if ((left.enabled === true) !== (right.enabled === true)) return left.enabled === true ? -1 : 1
            const leftNext = typeof left.nextRunAt === 'number' ? left.nextRunAt : Number.MAX_SAFE_INTEGER
            const rightNext = typeof right.nextRunAt === 'number' ? right.nextRunAt : Number.MAX_SAFE_INTEGER
            if (leftNext !== rightNext) return leftNext - rightNext
            return right.createdAt - left.createdAt
          })
      }, [tasks, filter, search])

      const run = useCallback(
        async (task, path, init, message) => {
          setPendingId(task.id)
          try {
            await requestJson(path, init)
            setNotice({ kind: 'success', text: message })
            await snapshot.reload()
          } catch (error) {
            setNotice({ kind: 'error', text: error instanceof Error ? error.message : t('error.action') })
          } finally {
            setPendingId(null)
          }
        },
        [snapshot, t],
      )

      const toggle = useCallback(
        (task) =>
          run(
            task,
            `/tasks/${encodeURIComponent(task.id)}/enabled`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: task.enabled !== true }) },
            task.enabled === true ? t('notice.paused') : t('notice.enabled'),
          ),
        [run, t],
      )

      const runNow = useCallback(
        (task) => run(task, `/tasks/${encodeURIComponent(task.id)}/run`, { method: 'POST' }, t('notice.ran')),
        [run, t],
      )

      const confirmDelete = useCallback(async () => {
        const task = deleteTarget
        if (task === null) return
        setPendingId(task.id)
        try {
          await requestJson(`/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' })
          setNotice({ kind: 'success', text: t('notice.deleted') })
          setDeleteTarget(null)
          await snapshot.reload()
        } catch (error) {
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : t('error.action') })
        } finally {
          setPendingId(null)
        }
      }, [deleteTarget, snapshot, t])

      const created = useCallback(async () => {
        setDialogOpen(false)
        setNotice({ kind: 'success', text: t('notice.created') })
        await snapshot.reload()
      }, [snapshot, t])

      const createDialogProps = useMemo(
        () => ({
          t,
          workspaces,
          permissions,
          onClose: () => setDialogOpen(false),
          onCreated: { afterCreate: created, pickDirectory },
        }),
        [t, workspaces, permissions, created, pickDirectory],
      )

      const tabs = [
        { id: 'tasks', label: t('tab.tasks') },
        { id: 'runs', label: t('tab.runs') },
      ]

      return h(
        'section',
        { className: 'dsc-page', 'aria-label': t('panel') },
        h(
          'div',
          { className: 'dsc-top' },
          h(
            'div',
            { className: 'dsc-tabs', role: 'tablist', 'aria-label': t('panel') },
            tabs.map((tab) =>
              h(
                'button',
                {
                  key: tab.id,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': view === tab.id,
                  className: 'dsc-tab',
                  onClick: () => setView(tab.id),
                },
                tab.label,
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsc-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsc-iconbtn',
                title: t('refresh.action'),
                'aria-label': t('refresh.action'),
                onClick: () => void snapshot.reload(),
              },
              h(IconRefresh),
            ),
            h(
              'button',
              { type: 'button', className: 'dsc-btn', 'data-variant': 'primary', onClick: () => setDialogOpen(true) },
              h(IconPlus),
              t('new.action'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsc-scroll' },
          h(
            'div',
            { className: 'dsc-content' },
            notice === null
              ? null
              : h(
                  'div',
                  { className: 'dsc-notice', 'data-kind': notice.kind, role: 'status' },
                  notice.kind === 'error' ? h(IconAlert) : h(IconCheck),
                  h('span', null, notice.text),
                ),
            view === 'tasks'
              ? h(
                  'div',
                  { className: 'dsc-lead' },
                  h('div', null, h('h1', null, t('panel')), h('p', null, t('page.subtitle'))),
                )
              : null,
            view === 'tasks'
              ? h(
                  'div',
                  { className: 'dsc-filters' },
                  [
                    { id: 'all', label: t('filter.all'), count: counts.all },
                    { id: 'enabled', label: t('filter.enabled'), count: counts.enabled },
                    { id: 'paused', label: t('filter.paused'), count: counts.paused },
                  ].map((chip) =>
                    h(
                      'button',
                      {
                        key: chip.id,
                        type: 'button',
                        className: 'dsc-chip',
                        'aria-pressed': filter === chip.id,
                        onClick: () => setFilter(chip.id),
                      },
                      `${chip.label} (${chip.count})`,
                    ),
                  ),
                  h(
                    'span',
                    { className: 'dsc-search' },
                    h(IconSearch),
                    h('input', {
                      type: 'search',
                      value: search,
                      placeholder: t('search.placeholder'),
                      'aria-label': t('search.placeholder'),
                      onChange: (event) => setSearch(event.target.value),
                    }),
                    search === ''
                      ? null
                      : h(
                          'button',
                          { type: 'button', className: 'dsc-iconbtn', 'aria-label': t('search.clear'), onClick: () => setSearch('') },
                          h(IconClose, { size: 13 }),
                        ),
                  ),
                )
              : null,
            snapshot.status === 'loading' ? h('div', { className: 'dsc-running' }, t('status.loading')) : null,
            snapshot.status === 'error'
              ? h(
                  'div',
                  { className: 'dsc-error', role: 'alert' },
                  h(IconAlert),
                  h('span', null, `${t('error.fetch')} ${snapshot.error ?? ''}`),
                  h(
                    'button',
                    { type: 'button', className: 'dsc-btn', 'data-variant': 'outline', onClick: () => void snapshot.reload() },
                    t('status.retry'),
                  ),
                )
              : null,
            view === 'tasks' && snapshot.status !== 'loading'
              ? visibleTasks.length === 0
                ? h(
                    'div',
                    { className: 'dsc-empty' },
                    h('span', { className: 'dsc-glyph' }, h(IconClock, { size: 26 })),
                    h('h2', null, tasks.length === 0 ? t('empty.title') : t('empty.filtered')),
                    h('p', null, tasks.length === 0 ? t('empty.body') : ''),
                    tasks.length === 0
                      ? h('button', { type: 'button', className: 'dsc-btn', 'data-variant': 'outline', onClick: () => setDialogOpen(true) }, t('empty.action'))
                      : null,
                  )
                : h(
                    'div',
                    { className: 'dsc-grid' },
                    visibleTasks.map((task) =>
                      h(TaskCard, {
                        key: task.id,
                        task,
                        now,
                        t,
                        pending: pendingId === task.id,
                        onToggle: () => void toggle(task),
                        onRun: () => void runNow(task),
                        onDelete: () => setDeleteTarget(task),
                      }),
                    ),
                  )
              : null,
            view === 'runs' && snapshot.status !== 'loading'
              ? h(
                  'div',
                  null,
                  h('h1', { className: 'dsc-section-title' }, t('tab.runs'), h('span', null, runs.length === 0 ? '' : String(runs.length))),
                  runs.length === 0
                    ? h(
                        'div',
                        { className: 'dsc-empty' },
                        h('span', { className: 'dsc-glyph' }, h(IconClock, { size: 26 })),
                        h('h2', null, t('run.empty')),
                        h('p', null, t('run.emptyBody')),
                      )
                    : h(
                        'div',
                        { className: 'dsc-runs' },
                        runs.map((entry) =>
                          h(RunRow, {
                            key: entry.id,
                            run: entry,
                            t,
                            onOpenSession: (sessionId) => openSession(sessionId),
                          }),
                        ),
                      ),
                )
              : null,
          ),
        ),
        dialogOpen ? h(NewTaskDialog, createDialogProps) : null,
        deleteTarget === null
          ? null
          : h(ConfirmDeleteDialog, {
              t,
              task: deleteTarget,
              busy: pendingId === deleteTarget.id,
              onCancel: () => setDeleteTarget(null),
              onConfirm: () => void confirmDelete(),
            }),
      )
    }

    // ------------------------------------------------------------ plugin

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'schedule-center: dictionaries')
      ctx.effect(() => installStyles(), 'schedule-center: styles')
      const t = ctx.locale.bind(NS)
      const pickDirectory = async () => {
        try {
          return await ctx.uiWorkspace.pickDirectory()
        } catch (error) {
          console.warn('[schedule-center] could not pick a directory:', error)
          return null
        }
      }
      const openSession = (sessionId) => {
        try {
          ctx.uiWorkspace.openSession(sessionId)
        } catch (error) {
          console.warn('[schedule-center] could not open the session:', error)
        }
      }
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') },
          SidebarIcon,
        ),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ pickDirectory, openSession }) },
          ScheduleCenterPage,
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply,
    }
  },
})
