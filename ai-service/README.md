# 坐姿 AI 服务（Flask + SQLite + MediaPipe）

坐姿检测用 **MediaPipe Pose Tasks**（CPU 推理、33 关键点）。模型文件 `pose_landmarker_lite.task`
需放在本目录（已随项目提供，缺失时从 MediaPipe 官方下载）。

推荐用独立虚拟环境（避免污染主环境、绕过 numpy 版本冲突）：

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app.py            # 监听 http://127.0.0.1:5000
.venv\Scripts\python app.py --selftest # 只跑分类逻辑自测，不加载模型
```

微信开发者工具需关闭「校验合法域名」才能访问 `http://127.0.0.1:5000`（已在本项目 `project.private.config.json` 置为 `urlCheck:false`）。

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/health` | 健康检查 |
| POST | `/auth/login` | 微信登录，换取 openid |
| POST | `/analyze` | 上传照片，返回打码结果（完整报告需解锁） |
| POST | `/unlock` | 付费解锁，返回完整报告 |
| POST | `/records` | 保存一条坐姿记录 |
| GET  | `/records?openid=` | 记录列表（含缩略图） |
| GET  | `/records/<id>` | 记录详情（含原图） |
| DELETE | `/records/<id>` | 删除记录 |
| POST | `/pressure/ingest` | 上报压力传感器帧 |
| GET  | `/pressure/sessions?openid= 或 deviceId=` | 压力会话列表 |
| GET  | `/pressure/sessions/<id>` | 压力会话详情（含原始帧） |

## 微信登录（openid）

```js
wx.login({ success: ({ code }) => {
  wx.request({ url: 'http://127.0.0.1:5000/auth/login', method: 'POST',
    data: { code, deviceId } })
}})
```

- 设置环境变量 `WX_APP_SECRET` 后，后端调用 `jscode2session` 换取**真实 openid**。
- 未设置密钥时进入「开发模式」，用客户端传来的 `deviceId`（稳定 UUID）生成 `dev_xxx` openid，本地即可跑通全流程。

## 坐姿分析（半藏半漏付费模式）

`POST /analyze` 上传照片后**免费返回打码结果**（分析照常完成，完整结果先锁在服务端）：

```json
{
  "analysisId": "abc123", "price": 9.9,
  "level": "warning", "postureType": "头前伸",
  "maskedAngle": "2_°",
  "teaserAdvice": "下巴微收、后脑靠后，屏幕调高…",
  "blurredImage": "<base64 高斯模糊图>"
}
```

调用 `POST /unlock`（`{analysisId, openid}`）支付成功后返回完整结果：

```json
{
  "angle": 25.3, "shoulderTilt": 1.3, "headTilt": 2.1, "lateralLean": 0.06,
  "level": "warning", "postureType": "头前伸", "status": "...", "advice": "...",
  "analyzedImage": "<base64>", "standardImage": "<base64>", "paid": true
}
```

> 当前 `/unlock` 为**模拟支付**（调用即解锁）。接入微信支付时：服务端 `统一下单` 生成订单 → 客户端 `wx.requestPayment` → 微信回调 `/pay/notify` 置 `paid=1` → 客户端再调 `/unlock` 拉取完整结果。

四级严重度 `ideal / good / warning / danger`，坐姿类型 `标准 / 头前伸 / 高低肩 / 头侧倾 / 侧偏 / 后仰`。阈值均为经验值，仅供参考，非诊断。

## 座椅压力传感器接口

传输用 **REST/JSON 批量上报**：坐姿稳定性是慢信号，每 1–2 秒上报一批（每批 10–50 帧）即可；需要 <1ms 级实时流再升级为 WebSocket 或 MQTT。

### 数据契约

```json
POST /pressure/ingest
{
  "openid": "dev_xxxx",     // 可选，绑定用户
  "deviceId": "seat-01",    // 座椅设备标识（必填）
  "unit": "kPa",            // 可选，仅记录
  "frames": [
    { "t": 1690000000000, "v": [[1.2, 0.3, ...], [0.5, ...], ...] },
    { "t": 1690000000100, "v": [[...], ...] }
  ]
}
```

约定 `v` 为 `[行, 列]` 压力矩阵，**第 0 行 = 座椅前缘**。后端据此计算：

- `mean` 平均压力；`cv` 变异系数（压力随时间的稳定性）
- `copX / copY` 归一化压力中心（-1..1；copY 负 = 前倾、正 = 后仰；copX 负 = 偏左、正 = 偏右）
- `asymmetry` 左右不对称度（-1..1）

返回该批次的坐姿分类（`level` + `postureType` + `status` + `advice`），并落库到 `pressure_sessions`，可在历史/对比里查看。

> 传感器矩阵尺寸可变（如 16×16、24×10），后端按实际 `[行, 列]` 计算，无需改代码。
