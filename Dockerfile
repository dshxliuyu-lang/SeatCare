# SeatCare 坐姿 AI 后端镜像（微信云托管用，构建上下文 = 仓库根目录）
FROM python:3.12-slim

WORKDIR /app

# opencv / mediapipe 运行所需的系统库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 libegl1 libgles2 \
    && rm -rf /var/lib/apt/lists/*

COPY ai-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple/

COPY ai-service/ .

EXPOSE 5000

CMD ["python", "app.py"]
