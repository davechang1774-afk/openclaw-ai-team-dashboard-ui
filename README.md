# OpenClaw AI Team Dashboard UI

一个可直接安装到 OpenClaw 的 AI Team 调度中心定制前端。

这个仓库只分发自定义 UI 层和安装脚本：
- `template/index.html`
- `template/dashboard.js`
- `template/dashboard.css`
- `scripts/install.ps1`
- `scripts/uninstall.ps1`

安装脚本会自动：
1. 复制这套自定义 UI 到 `~/.openclaw/control-ui-dashboard`
2. 从你本机已安装的 OpenClaw 中提取官方 `dist/control-ui` 的 `assets` 和 `favicon`
3. 生成兼容 OpenClaw 的 `stock/index.html`
4. 自动写入 `~/.openclaw/openclaw.json` 的 `gateway.controlUi.root`

这样做的目的是让朋友只要已经装好 OpenClaw，就可以一键应用同样的界面，而不用手工复制文件。

## 快速开始

先确保本机已经能运行 `openclaw` 命令，然后执行：

```powershell
git clone https://github.com/davechang1774-afk/openclaw-ai-team-dashboard-ui.git
cd openclaw-ai-team-dashboard-ui
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
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

卸载脚本会：
- 删除当前安装的自定义 UI
- 尝试恢复安装前备份的 UI 目录
- 恢复或清除 `gateway.controlUi.root`

## 包含的定制内容

- OpenClaw 网关内嵌式 AI Team Dashboard
- Bots 列表自动读取 `agents.list`
- 实时会话、代码提交、模型路由、skills 展示
- 实际命中 fallback 状态显示
- Feishu 群会话映射与展示
- 可折叠 skills 卡片
- 可拉伸对话框与滚动位置保持
- 页面底部原作者链接与二次改造声明

## 说明

本仓库是 OpenClaw 的定制控制台前端，不是原始 AI Team Dashboard 后端项目。  
界面风格参考原作者项目，署名与说明见 [NOTICE.md](./NOTICE.md)。
