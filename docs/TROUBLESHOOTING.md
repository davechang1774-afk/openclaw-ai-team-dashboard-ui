# Troubleshooting

## 1. `openclaw` 命令不存在

先确认 OpenClaw 已通过全局 npm 安装：

```powershell
npm i -g openclaw@latest
openclaw --version
```

如果命令仍不存在，通常是全局 npm 路径没有加入环境变量。

## 2. 安装脚本提示未找到官方 `control-ui`

安装脚本会尝试从本机已安装的 OpenClaw 中读取：

- `npm root -g`
- `%APPDATA%\\npm\\node_modules\\openclaw\\dist\\control-ui`

如果这里都没有，说明：

- OpenClaw 没有正确全局安装
- 或者 npm 全局目录被改到了非默认位置

先运行：

```powershell
npm root -g
```

确认该目录下存在 `openclaw\\dist\\control-ui`。

## 3. 执行 `openclaw gateway` 时提示 already running

这不是 UI 安装失败，而是网关已经在后台运行。先停掉再启动：

```powershell
openclaw gateway stop
openclaw gateway
```

如果仍不行，可尝试：

```powershell
schtasks /End /TN "OpenClaw Gateway"
openclaw gateway
```

## 4. 安装完成后页面还是旧版

按下面顺序处理：

1. 执行 `openclaw gateway stop`
2. 再执行 `openclaw gateway`
3. 浏览器按一次 `Ctrl+F5` 强刷

很多时候是浏览器缓存了旧的 `dashboard.js` 或 `dashboard.css`。

## 5. 自定义 `OpenClawHome` 时，安装结果里的校验提示看起来不直观

OpenClaw 当前的 `openclaw config validate` 只能直接校验默认 `~/.openclaw`。

所以当你安装到自定义目录时，安装脚本会：

- 继续完成文件复制与配置写入
- 明确提示跳过 CLI 级配置校验

这不代表安装失败，只是 OpenClaw CLI 本身暂不支持指定配置文件路径。

## 6. 想恢复原版界面

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

它会优先恢复安装前的备份 UI，并回退 `gateway.controlUi.root`。

## 7. 想确认仓库本身有没有缺文件

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-package.ps1
```

这个脚本会检查：

- 模板文件是否齐全
- PowerShell 脚本语法是否正常
- 文档与工作流是否存在

