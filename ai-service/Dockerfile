# 脊椎健康自测 · 坐姿 AI 后端镜像
# 适配：微信云托管（CloudBase 容器）与 云服务器 ECS（Docker 运行）
FROM python:3.12-slim

WORKDIR /app

# opencv / mediapipe 运行所需的系统库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple/

COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
