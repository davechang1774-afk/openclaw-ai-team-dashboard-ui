# OpenClaw AI Team Dashboard UI

一个可直接安装到 OpenClaw 的 AI Team 调度中心定制前端。

这不是独立后端项目，而是一层可落地到 `gateway.controlUi.root` 的自定义 UI 包。朋友只要已经安装好 OpenClaw，就可以通过这个仓库把同一套界面装到自己的网关里。

## 适用范围

- 面向 Windows + `npm -g openclaw`
- 适配 OpenClaw `2026.3.x`
- 适合需要多 agent、模型路由、Feishu 群会话与技能面板可视化的用户

## 这个仓库包含什么

- `template/index.html`
- `template/dashboard.js`
- `template/dashboard.css`
- `scripts/install.ps1`
- `scripts/uninstall.ps1`
- `scripts/install.cmd`
- `scripts/uninstall.cmd`
- `scripts/validate-package.ps1`

安装脚本会自动：
1. 复制自定义 UI 到 `~/.openclaw/control-ui-dashboard`
2. 从你本机已安装的 OpenClaw 中提取官方 `dist/control-ui` 的 `assets` 与 favicon
3. 生成兼容 OpenClaw 的 `stock/index.html`
4. 自动写入 `~/.openclaw/openclaw.json` 的 `gateway.controlUi.root`
5. 为当前安装生成清单文件，便于后续卸载或恢复

## 功能亮点

- OpenClaw 网关内嵌式 AI Team Dashboard
- Bots 列表自动读取 `agents.list`
- 实时会话、代码提交、模型路由、skills 展示
- 实际命中 fallback 状态显示
- Feishu 群会话映射与展示
- 可折叠 skills 卡片
- 可拉伸输入框与滚动位置保持
- 页面底部原作者链接与二次改造声明

## 快速开始

先确保本机已经能运行 `openclaw` 命令，然后执行：

```powershell
git clone https://github.com/davechang1774-afk/openclaw-ai-team-dashboard-ui.git
cd openclaw-ai-team-dashboard-ui
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

如果你更喜欢双击或 `cmd` 风格，也可以直接运行：

```cmd
scripts\install.cmd
```

安装完成后，重启 gateway：

```powershell
openclaw gateway stop
openclaw gateway
```

然后访问：

```text
http://127.0.0.1:18789/chat?session=agent%3Amain%3Amain
```

## 可选参数

如果你的 OpenClaw 目录不是默认的 `~/.openclaw`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -OpenClawHome 'D:\Custom\.openclaw'
```

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

或：

```cmd
scripts\uninstall.cmd
```

卸载脚本会：
- 删除当前安装的自定义 UI
- 尝试恢复安装前备份的 UI 目录
- 恢复或清除 `gateway.controlUi.root`

## 项目结构

```text
openclaw-ai-team-dashboard-ui/
├─ template/                  # 实际安装到 OpenClaw 的自定义前端文件
├─ scripts/                   # 安装、卸载、自检脚本
├─ docs/                      # 说明文档与常见问题
├─ .github/workflows/         # 基础包体自检
├─ CHANGELOG.md               # 版本记录
├─ LICENSE-STATUS.md          # 许可状态说明
└─ NOTICE.md                  # 原作者链接与二次改造声明
```

## 维护与排错

- 常见安装问题见 [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
- 版本记录见 [CHANGELOG.md](./CHANGELOG.md)
- 包体自检可运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-package.ps1
```

## 说明

本仓库是 OpenClaw 的定制控制台前端，不是原始 AI Team Dashboard 后端项目。  
界面风格参考原作者项目，署名与说明见 [NOTICE.md](./NOTICE.md)。

## 许可状态

当前仓库未附带标准开源许可证，原因说明见 [LICENSE-STATUS.md](./LICENSE-STATUS.md)。如果你准备将这套内容继续公开分发或用于更正式的场景，建议先阅读该文件。
