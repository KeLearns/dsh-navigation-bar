# dsh-navigation-bar

钢琴键风格的会话导航条插件（DeepSeek Harness Web GUI 官方插件机制，与桌面壳无关）。

## 功能

- **位置**：左侧边栏与主消息区分界线右侧的竖直窄条，叠加在主界面之上（官方
  \`shell.overlay\` 槽位，不侵入 DSH 源码）。
- **每个钢琴键锚定一个用户消息**（当前会话中每个 user 消息对应一根键，按时间正序）。
- **悬停动效**：悬停键视为选中态 —— 变长（约 4 倍）并变色；上下相邻键长度
  **阶梯递减 3 级**（≈65% / ≈47% / ≈30%），上下第 4 根键及更远恢复正常长度；
  首/尾键悬停时阶梯自然单侧裁剪。
- **悬停气泡**：显示该轮**用户消息（单行，超宽省略号）** 与 **模型消息（最多 3 行，
  \`-webkit-line-clamp\` 省略）**。
- **非悬停态**：所有键保持最短长度；**当前页面正在查看内容所对应的用户消息键高亮**
  （主题色 + 左端圆点），随滚动实时联动。
- **点击跳转**：点击任意键平滑滚动到对应消息。
- 深浅色主题自适应（跟随 DSH \`data-ds-dark-theme\` + 系统媒体查询兜底）。

## 结构（官方双面插件）

| 文件 | 说明 |
| --- | --- |
| \`index.js\` | host 半端（空操作 cordis 插件；数据全部走客户端官方会话服务） |
| \`lib/client.js\` | browser 半端（手写 bundle，无构建步骤；\`window.__ModuleLoader__.load\`） |
| \`cordis.patch.yml\` | bundle patch：把插件行插入 web profile 名单 |
| \`package.json\` | \`dsh.bundle.patch\` + \`dsh.client\`（platform web）声明 |

数据来源（全部官方 API）：
- \`ctx.sessions.binding(currentId).session\` → \`ConversationSnapshot\`
  （\`useSyncExternalStore\` 实时订阅）
- DOM 锚点：滚动容器 \`[data-conversation-scroll]\`，消息行
  \`[data-chat-anchor-key]\`（与快照 \`chat\` 视图节点的稳定 key 对应）

## 安装（官方插件机制）

\`\`\`bash
# 本地开发（link 方式，改代码后重启 web 实例生效）
dsh plugin --profile web add link:<本目录>

# 或从 npm 安装
dsh plugin --profile web add @kelearns/dsh-navigation-bar
\`\`\`

注意：DSH 的插件名单在实例启动时加载 —— 新插件安装后需要重启
\`dsh web\` 实例（\`dsh web --port 3080\`）再刷新页面。

## 参考图分析

设计参考图由 MiMo V2.5（opencode-go，视觉多模态）逐图分析，
完整结论与像素估算见 \`docs/ref-picture-analysis.md\`。

## License

MIT
