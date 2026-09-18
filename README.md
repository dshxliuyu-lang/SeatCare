# SeatCare · 坐姿健康小程序

一款面向「坐姿检测 + 久坐提醒」的健康科普微信小程序。通过**正/侧双图 AI 姿态检测**识别头前伸、高低肩、驼背等不良体态，结合问卷给出综合评估，并提供矫正视频、久坐提醒与历史前后对比。

> ⚠️ 本工具为**非医疗器械**，仅用于健康科普与风险自测，不能替代医院检查、医学诊断、治疗或疾病监测。

## ✨ 功能特性

- **正/侧双图坐姿检测**：MediaPipe Pose 33 关键点；正面测高低肩/头侧倾/躯干侧偏，侧面测头前伸/驼背
- **四维度问卷**：结构体征 / 疼痛不适 / 生活习惯 / 运动核心，按人群（年龄/性别/场景）定制建议 + 红旗征筛查
- **综合报告**：问卷 + 检测结果合并评估
- **付费解锁（终身会员）**：半藏半漏结果预览，一次付费终身免费
- **历史记录 + 前后对比**：保存原始照/检测图/标准坐姿三张图
- **久坐提醒**：滚轮设置时长（小时+分钟），订阅消息兜底推送
- **每日健康贴士**：联网更新、每天轮换
- **座椅压力传感器接口**（预留）：`POST /pressure/ingest`

## 📁 目录结构

```
SeatCare/
├── project.config.json      # 微信工程配置（miniprogramRoot 指向 spine-test）
├── spine-test/              # 小程序源码（8 个页面）
│   ├── app.js / app.json / app.wxss
│   └── pages/
│       ├── index/           # 首页（检测 + 久坐提醒）
│       ├── shoot/           # 正/侧双图拍摄引导
│       ├── test/            # 四维度问卷
│       ├── result/          # 综合报告
│       ├── knowledge/       # 健康知识（8 种坐姿类型）
│       ├── history/         # 历史记录 + 对比
│       ├── profile/         # 我的（会员）
│       └── login/           # 微信登录
├── ai-service/              # 后端 Flask + MediaPipe
│   ├── app.py               # 主服务（检测/登录/历史/订阅消息/压力接口）
│   ├── pose_landmarker_lite.task  # MediaPipe 姿态模型
│   ├── requirements.txt
│   ├── Dockerfile           # 容器化
│   └── DEPLOY.md            # 部署文档
└── README.md
```

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 微信小程序（原生 WXML/WXSS/JS） |
| 检测 | MediaPipe Pose Tasks（CPU 推理，33 关键点） |
| 后端 | Python Flask |
| 数据库 | SQLite（本地）/ MySQL（云端，`DB_HOST` 环境变量切换） |
| 部署 | Docker + 微信云托管 / 云服务器 |

## 🚀 快速开始

### 1. 打开小程序

1. 微信开发者工具 → 导入项目 → 选择 `SeatCare` 文件夹。
2. AppID 用默认 `wx7521671c7181df90`（或改成你自己的）。
3. 点「编译」。

### 2. 启动后端（登录/检测/历史需要）

```bash
cd ai-service
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt    # Windows
.venv/Scripts/python app.py                      # 监听 http://127.0.0.1:5000
```

> Linux/macOS 用 `.venv/bin/pip` 和 `.venv/bin/python`。
> 已在 `project.private.config.json` 关闭域名校验，模拟器可访问本地后端。

## 📦 部署

后端已容器化（`ai-service/Dockerfile`），可部署到**微信云托管**或**云服务器**。详见 [`ai-service/DEPLOY.md`](ai-service/DEPLOY.md)。

云端环境变量：

| 变量 | 说明 |
|---|---|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MySQL 连接（云端持久化） |
| `WX_APP_SECRET` | 微信登录密钥（换真实 openid） |
| `WX_TEMPLATE_ID` | 订阅消息模板 ID（久坐提醒推送） |

## 🗄 数据模型

后端自动创建 6 张表：`users`、`posture_records`、`pressure_sessions`、`analyses`、`tips`、`reminders`。字段定义见 [`ai-service/README.md`](ai-service/README.md)。

## 📄 免责声明

本工具为非医疗器械，所有坐姿分析基于**经验阈值**，结果仅供参考，不构成任何医疗建议。如有持续疼痛、活动受限、麻木无力等症状，请及时到正规医疗机构就诊。

## 📝 License

MIT
