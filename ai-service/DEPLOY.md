# 部署到云端（挂载云服务器）

后端是 **Python Flask + MediaPipe**，微信「云函数」跑的是 Node.js，**跑不了 Python 机器学习**，所以正确做法是**容器化后部署到「云托管」或「云服务器 ECS」**。两者用同一个 Dockerfile。

## 一、本地先测（有 Docker 的话）

```powershell
cd ai-service
docker build -t spine-ai .
docker run -p 5000:5000 spine-ai
# 打开 http://localhost:5000/health 看是否返回 {"ok":true}
```

## 二、部署到「微信云托管」（推荐，最省心）

1. 微信开发者工具 → 云开发 → 开通「云托管」。
2. 上传 `ai-service` 目录（Dockerfile 会被自动识别）。
3. 云托管会构建镜像并常驻运行（无需自己管进程、自带 HTTPS）。
4. 拿到云托管的 HTTPS 域名，例如 `https://xxx.ap-shanghai.tcb.qcloud.la`。
5. 改 `spine-test/app.js` 里 `aiServiceUrl` 为这个域名。

## 三、部署到「云服务器 ECS」（自建，省钱可控）

```bash
# ① 买一台 Linux 服务器（1核2G 够，MediaPipe 是 CPU 推理）
# ② 服务器装 Docker
curl -fsSL https://get.docker.com | sh

# ③ 传代码（本机执行）
scp -r ai-service root@你的IP:/root/

# ④ 服务器上构建 + 常驻运行
cd /root/ai-service
docker build -t spine-ai .
docker run -d --name spine-ai --restart=always -p 5000:5000 spine-ai
# --restart=always 保证崩溃自动重启、开机自启（即「一直挂载」）
```

## 四、小程序连到云端

把 `spine-test/app.js` 的 `aiServiceUrl` 改成云端 HTTPS 地址：

```js
globalData: {
  aiServiceUrl: 'https://你的域名',   // 原来是 http://127.0.0.1:5000
  ...
}
```

> 正式域名需要 **ICP 备案 + HTTPS 证书**（支付回调也强制要）。云托管自带 HTTPS 域名，最省事。

## 五、切云数据库（MySQL）

代码已支持「本地 SQLite + 云端 MySQL」双模式：**不设环境变量 = 用本地 SQLite；设了 `DB_HOST` = 自动切 MySQL**。

在云托管控制台的服务「环境变量」里配：

| 环境变量 | 说明 | 示例 |
|---|---|---|
| `DB_HOST` | MySQL 主机地址 | `你的云数据库内网地址` |
| `DB_PORT` | 端口（默认 3306） | `3306` |
| `DB_USER` | 用户名 | `root` |
| `DB_PASSWORD` | 密码 | `****` |
| `DB_NAME` | 数据库名（需先建库） | `spine_ai` |

建库方式：云开发控制台 → 「数据库」→ 开通 **MySQL 版（云开发 MySQL / TDSQL-C）** → 建一个名为 `spine_ai` 的库。表结构（4 张表）会在后端首次启动时**自动创建**，无需手动建表。

> 不配这些环境变量，云托管会用内置的临时 SQLite（重启丢数据）；配了就持久化到 MySQL。

## 环境变量

- `WX_APP_SECRET`：填了就换真实微信 openid，不填走开发模式。
- `UNLOCK_PRICE`：解锁价格（代码里默认 9.9）。
- `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`：MySQL 连接（见上）。
