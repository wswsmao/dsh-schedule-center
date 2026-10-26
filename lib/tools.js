/** Tools call exactly the same scheduler service methods used by the UI. */
const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
const scheduleSchema = {
  type: 'object', properties: {
    kind: { type: 'string', enum: ['daily', 'weekly', 'every', 'once'] },
    time: { type: 'string', description: 'Host local HH:MM for daily or weekly.' },
    weekdays: { type: 'array', items: { type: 'integer' }, description: 'ISO weekdays 1–7 for weekly.' },
    everyMinutes: { type: 'integer', description: 'Fixed interval 1–10080 minutes.' },
    at: { type: 'string', description: 'Future ISO instant for once.' },
  }, required: ['kind'], additionalProperties: false,
}

export function createScheduleTools(center) {
  return [{
    name: 'schedule_center',
    description: '查看定时任务及已注册业务动作，创建不经过模型提示词的固定业务任务，或运行、取消、删除任务。业务任务跟踪真实终态；工具不选择或提升模型权限。',
    parameters: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['list', 'read', 'create_business', 'run', 'cancel_run', 'set_enabled', 'delete'] },
        task_id: { type: 'string', description: 'read/run/set_enabled/delete需要任务ID。' },
        run_id: { type: 'string', description: 'cancel_run需要定时任务运行记录ID，不是业务服务内部run_id。' },
        name: { type: 'string', description: 'create_business任务名称，1–120字符。' },
        action_id: { type: 'string', description: 'create_business选择list返回的已注册固定业务动作ID。' },
        project_dir: { type: 'string', description: 'create_business项目绝对目录。' },
        schedule: scheduleSchema,
        enabled: { type: 'boolean', description: 'create_business默认启用；set_enabled必须明确给出。' },
      }, required: ['action'], additionalProperties: false,
    },
    output,
    timeoutMs: 30000,
    isConcurrencySafe: (args) => args?.action === 'list' || args?.action === 'read',
    async execute(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须是对象。')
      const allowed = {
        list: ['action'], read: ['action', 'task_id'], create_business: ['action', 'name', 'action_id', 'project_dir', 'schedule', 'enabled'],
        run: ['action', 'task_id'], cancel_run: ['action', 'run_id'], set_enabled: ['action', 'task_id', 'enabled'], delete: ['action', 'task_id'],
      }
      if (!allowed[args.action] || Object.keys(args).some((key) => !allowed[args.action].includes(key))) throw new Error('动作或字段无效。')
      await center.ready
      switch (args.action) {
        case 'list': return center.list()
        case 'read': return { task: center.readTask(requireId(args.task_id)) }
        case 'create_business': return { task: await center.createTask({ type: 'business', name: args.name, actionId: args.action_id, cwd: args.project_dir, schedule: args.schedule, enabled: args.enabled }) }
        case 'run': return center.runTask(requireId(args.task_id))
        case 'cancel_run': return { run: await center.cancelRun(requireId(args.run_id)) }
        case 'set_enabled': return { task: await center.setEnabled(requireId(args.task_id), args.enabled) }
        case 'delete': return center.removeTask(requireId(args.task_id))
        default: throw new Error('动作无效。')
      }
    },
    presentCall(args) { return { card: 'generic', title: '定时任务管理', kind: ['list', 'read'].includes(args?.action) ? 'read' : 'execute', rawInput: args } },
  }]
}

function requireId(value) { if (typeof value !== 'string' || !value || value.length > 256) throw new Error('缺少有效标识。'); return value }
