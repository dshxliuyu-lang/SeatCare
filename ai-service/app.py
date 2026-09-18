"""脊椎健康自测 · 坐姿 AI 服务

在单角度头前伸分析的基础上，升级为多指标坐姿分类（参考 chair_ai_training 的
8 类坐姿 + ideal/good/warning/danger 四级严重度），并加入用户登录（微信 openid）、
坐姿历史记录、正/侧双图分析、付费解锁与座椅压力传感器接口。

依赖：flask / numpy / opencv-python / mediapipe（姿态检测用 MediaPipe Tasks）/ pymysql。
"""
import base64
import hashlib
import json
import math
import os
import sqlite3
import sys
import time
import urllib.request
import uuid
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "posture.db"

# 微信小程序登录配置：留空 WX_APP_SECRET 时进入「开发模式」，
# 用客户端传来的 deviceId 生成稳定 openid，本地即可跑通演示。
WX_APPID = os.environ.get("WX_APPID", "wx2ebe84d35cee84dd")
WX_SECRET = os.environ.get("WX_APP_SECRET", "")

# 完整报告解锁价格（元）。接入微信支付后，实际金额以订单为准。
UNLOCK_PRICE = 9.9

app = Flask(__name__)


@app.errorhandler(Exception)
def handle_exception(e):
    """把未捕获异常转成 JSON，便于云端排查（默认 500 是 HTML 页看不到原因）。"""
    return jsonify(error=f"{type(e).__name__}: {str(e)[:300]}"), 500


# ---------------------------------------------------------------------------
# 几何计算与坐姿分类（纯 numpy/math，便于单独自测）
# ---------------------------------------------------------------------------
def _pt(p):
    return np.asarray(p, dtype=float)


def head_forward_angle(nose, shoulder):
    """头前伸角：鼻-肩连线相对垂线的偏角（度）。0°=直立。"""
    vec = _pt(nose) - _pt(shoulder)
    norm = np.linalg.norm(vec)
    if norm < 1e-6:
        return 0.0
    cos = np.clip(np.dot(vec, [0.0, 1.0]) / norm, -1.0, 1.0)
    a = math.degrees(math.acos(cos))
    return 180.0 - a if a > 90 else a


def segment_tilt(p, q):
    """两点连线相对水平的倾角（度）。0°=水平，90°=垂直。"""
    p, q = _pt(p), _pt(q)
    dy = abs(q[1] - p[1])
    dx = abs(q[0] - p[0])
    return math.degrees(math.atan2(dy, dx + 1e-6))


def classify_posture(metrics):
    """根据多指标输出 (level, posture_type, status, advice)。

    metrics: head_forward / shoulder_tilt / head_tilt / lateral / forward_ratio
    """
    hf = metrics["head_forward"]       # 头前伸角
    st = metrics["shoulder_tilt"]      # 高低肩倾角
    ht = metrics["head_tilt"]          # 头侧倾角
    lat = abs(metrics["lateral"])      # 躯干侧偏比（横向偏移/躯干长）
    fwd = metrics["forward_ratio"]     # 前倾(+)/后仰(-) 归一化偏移

    order = ["ideal", "good", "warning", "danger"]

    def sev(v, i, g, w):
        if v < i:
            return "ideal"
        if v < g:
            return "good"
        if v < w:
            return "warning"
        return "danger"

    # 各指标经验阈值（非诊断，仅供科普提示）
    levels = {
        "头前伸": sev(hf, 15, 22, 32),
        "高低肩": sev(st, 2, 5, 8),
        "头侧倾": sev(ht, 3, 6, 10),
        "侧偏": sev(lat, 0.10, 0.18, 0.28),
    }
    if fwd < -0.20:
        levels["后仰"] = sev(abs(fwd), 0.20, 0.30, 0.45)

    overall = max(levels.values(), key=lambda x: order.index(x))
    if overall in ("ideal", "good"):
        ptype = "标准"
    else:
        ptype = max(levels, key=lambda k: order.index(levels[k]))

    status, advice = build_advice(ptype, overall)
    return overall, ptype, status, advice


def build_advice(ptype, level):
    if ptype == "标准":
        if level == "ideal":
            return "标准健康坐姿", "坐姿端正，请继续保持，并记得每 40–60 分钟起身活动。"
        return "坐姿基本良好", "整体不错，留意小幅前倾或高低肩，保持屏幕与视线齐平。"
    advices = {
        "头前伸": ("头部前伸", "下巴微收、后脑靠后，屏幕调高到视线水平，避免伸颈凑近。"),
        "高低肩": ("双肩不等高", "放松双肩，减少单肩背包；若持续明显不等高，建议就医排查。"),
        "头侧倾": ("头部侧倾", "检查是否习惯歪头，保持头颈中立，必要时咨询康复。"),
        "侧偏": ("躯干侧偏", "调整坐姿使重心居中，双脚均匀承重，避免长期偏向一侧。"),
        "后仰": ("躯干后仰", "靠背适度支撑腰背，身体前移到自然中立位，避免半躺。"),
    }
    status, advice = advices.get(ptype, (ptype, "请调整坐姿并定期活动。"))
    return status, advice


def pressure_metrics(frames):
    """由连续压力帧计算均值 / 变异系数 / 压力中心 / 左右不对称。

    frames: [帧数, 行, 列]；约定 v 第 0 行为座椅前缘，
    copY 负 = 压力偏前(前倾)，正 = 偏后(后仰)；copX 负 = 偏左，正 = 偏右。
    """
    mat = np.asarray(frames, dtype=float)
    if mat.ndim != 3 or mat.shape[0] == 0:
        raise ValueError("frames 需为 [帧数, 行, 列] 三维数组")
    flat = mat.reshape(mat.shape[0], -1)
    means = flat.mean(axis=1)
    mean = float(means.mean())
    cv = float(means.std() / mean) if mean > 1e-6 else 0.0
    rows, cols = mat.shape[1], mat.shape[2]
    ys, xs = np.indices((rows, cols))
    cops = []
    for f in mat:
        total = f.sum()
        if total < 1e-6:
            cops.append((0.0, 0.0))
        else:
            cops.append((float((xs * f).sum() / total) / max(cols - 1, 1) * 2 - 1,
                         float((ys * f).sum() / total) / max(rows - 1, 1) * 2 - 1))
    cops = np.asarray(cops)
    half = cols // 2
    left = float(mat[:, :, :half].sum())
    right = float(mat[:, :, half:].sum())
    asymmetry = (right - left) / (left + right + 1e-6)
    return {"mean": mean, "cv": cv, "copX": float(cops[:, 0].mean()),
            "copY": float(cops[:, 1].mean()), "asymmetry": float(asymmetry)}


def classify_pressure(m):
    """压力特征 → (level, posture_type, status, advice)。"""
    order = ["ideal", "good", "warning", "danger"]

    def sev(v, i, g, w):
        if v < i:
            return "ideal"
        if v < g:
            return "good"
        if v < w:
            return "warning"
        return "danger"

    cy, ax, cv = m["copY"], abs(m["asymmetry"]), m["cv"]
    cand = {}
    if cy < -0.25:
        cand["前倾"] = sev(-cy, 0.25, 0.45, 0.65)
    elif cy > 0.25:
        cand["后仰"] = sev(cy, 0.25, 0.45, 0.65)
    cand["侧偏"] = sev(ax, 0.08, 0.15, 0.25)
    cand["坐姿不稳"] = sev(cv, 0.08, 0.15, 0.25)

    overall = max(cand.values(), key=lambda x: order.index(x))
    if overall in ("ideal", "good"):
        ptype = "标准"
    else:
        ptype = max(cand, key=lambda k: order.index(cand[k]))
    status, advice = pressure_advice(ptype)
    return overall, ptype, status, advice


def pressure_advice(ptype):
    if ptype == "标准":
        return "标准受力分布", "压力分布对称稳定，坐姿良好，继续保持。"
    return {
        "前倾": ("重心前移", "躯干前倾、压力集中前缘，请靠后坐，让靠背承托腰背。"),
        "后仰": ("重心后移", "压力集中在后部，可能半躺，请坐直并让双脚踩实地面。"),
        "侧偏": ("左右不均", "左右压力不均，可能有单侧承重或跷腿，请调整重心居中。"),
        "坐姿不稳": ("坐姿不稳", "压力波动较大、频繁挪动，建议设置活动提醒并调整坐姿。"),
    }.get(ptype, (ptype, "请调整坐姿。"))


def demo():
    """分类逻辑自测：相机多指标 + 压力特征应落到预期类型。"""
    cam_cases = [
        ({"head_forward": 5, "shoulder_tilt": 1, "head_tilt": 1, "lateral": 0.02, "forward_ratio": 0.0}, "标准", "ideal"),
        ({"head_forward": 28, "shoulder_tilt": 1, "head_tilt": 2, "lateral": 0.05, "forward_ratio": 0.1}, "头前伸", "warning"),
        ({"head_forward": 10, "shoulder_tilt": 7, "head_tilt": 2, "lateral": 0.05, "forward_ratio": 0.0}, "高低肩", "warning"),
        ({"head_forward": 8, "shoulder_tilt": 1, "head_tilt": 2, "lateral": 0.25, "forward_ratio": 0.0}, "侧偏", "warning"),
        ({"head_forward": 12, "shoulder_tilt": 1, "head_tilt": 2, "lateral": 0.05, "forward_ratio": -0.5}, "后仰", "danger"),
    ]
    for m, wt, wl in cam_cases:
        level, ptype, _, _ = classify_posture(m)
        assert ptype == wt, f"{m} -> {ptype}, 期望 {wt}"
        assert level == wl, f"{m} -> {level}, 期望 {wl}"

    p_cases = [
        ({"copY": 0.0, "asymmetry": 0.02, "cv": 0.05}, "标准", "ideal"),
        ({"copY": -0.5, "asymmetry": 0.03, "cv": 0.06}, "前倾", "warning"),
        ({"copY": 0.55, "asymmetry": 0.03, "cv": 0.06}, "后仰", "warning"),
        ({"copY": 0.05, "asymmetry": 0.30, "cv": 0.06}, "侧偏", "danger"),
        ({"copY": 0.0, "asymmetry": 0.03, "cv": 0.30}, "坐姿不稳", "danger"),
    ]
    for m, wt, wl in p_cases:
        level, ptype, _, _ = classify_pressure(m)
        assert ptype == wt, f"{m} -> {ptype}, 期望 {wt}"
        assert level == wl, f"{m} -> {level}, 期望 {wl}"

    print("selftest OK: 相机 5/5 + 压力 5/5 分类正确")


if "--selftest" in sys.argv:
    demo()
    sys.exit(0)

# ---------------------------------------------------------------------------
# 模型与图像处理（MediaPipe Pose Tasks，CPU 推理；登录/历史/压力接口不依赖本模型）
# ---------------------------------------------------------------------------
import cv2  # noqa: E402
import mediapipe as mp  # noqa: E402
from mediapipe.tasks import python as mp_python  # noqa: E402
from mediapipe.tasks.python import vision  # noqa: E402

MODEL_FILE = BASE_DIR / "pose_landmarker_lite.task"

# MediaPipe 33 关键点中坐姿检测用到的索引：
# 0 鼻 / 2,5 眼 / 7,8 耳 / 11,12 肩 / 13,14 肘 / 15,16 腕 / 23,24 髋
CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 7), (0, 4), (4, 5), (5, 6), (6, 8), (9, 10),
    (11, 12), (11, 13), (13, 15), (15, 17), (15, 19), (15, 21), (17, 19),
    (12, 14), (14, 16), (16, 18), (16, 20), (16, 22), (18, 20),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (24, 26), (25, 27), (26, 28), (27, 29), (28, 30), (29, 31), (30, 32), (27, 31), (28, 32),
)

SKELETON = (
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
)

_detector = None


def get_detector():
    global _detector
    if _detector is None:
        try:
            if not MODEL_FILE.exists():
                raise FileNotFoundError(
                    f"缺少 {MODEL_FILE.name}，请下载 pose_landmarker_lite.task 放到本目录")
            # 用字节流加载模型，绕过 C++ 层对中文/括号路径的处理问题
            options = vision.PoseLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_buffer=MODEL_FILE.read_bytes()),
                running_mode=vision.RunningMode.IMAGE,
                num_poses=1,
                min_pose_detection_confidence=0.5,
            )
            _detector = vision.PoseLandmarker.create_from_options(options)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"模型加载失败: {type(exc).__name__}: {exc}") from exc
    return _detector


def detect_pose(frame_bgr):
    """返回 (关键点像素坐标 [33,2], 可见度 [33])，未检测到返回 (None, None)。"""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = get_detector().detect(image)
    if not result.pose_landmarks:
        return None, None
    h, w = frame_bgr.shape[:2]
    lm = result.pose_landmarks[0]
    pts = np.array([(p.x * w, p.y * h) for p in lm], dtype=float)
    vis = np.array([p.visibility for p in lm], dtype=float)
    return pts, vis


def encode_image(image, quality=88):
    ok, data = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("图像编码失败")
    return base64.b64encode(data).decode("ascii")


def draw_detected(frame, points, vis, metrics, level, ptype):
    output = frame.copy()
    for a, b in CONNECTIONS:
        if vis[a] >= 0.5 and vis[b] >= 0.5:
            cv2.line(output, tuple(points[a].astype(int)), tuple(points[b].astype(int)),
                     (57, 220, 159), 2, cv2.LINE_AA)
    for i, p in enumerate(points):
        if vis[i] >= 0.5:
            cv2.circle(output, tuple(p.astype(int)), 4, (235, 255, 247), -1, cv2.LINE_AA)
            cv2.circle(output, tuple(p.astype(int)), 4, (23, 107, 77), 2, cv2.LINE_AA)
    ear = ((points[7] + points[8]) / 2).astype(int)
    shoulder = ((points[11] + points[12]) / 2).astype(int)
    cv2.line(output, tuple(ear), tuple(shoulder), (255, 120, 65), 4, cv2.LINE_AA)
    text = f"{ptype} 头前伸{metrics['head_forward']:.1f}deg"
    cv2.putText(output, text, (24, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (30, 45, 38), 5, cv2.LINE_AA)
    cv2.putText(output, text, (24, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (235, 255, 247), 2, cv2.LINE_AA)
    return output


def personalized_standard(points, vis):
    """按本人骨段比例生成标准坐姿参考骨架（肩宽/躯干/上臂）。"""
    canvas = np.full((360, 480, 3), (244, 248, 246), dtype=np.uint8)

    def seg(i, j, default):
        if vis[i] >= .5 and vis[j] >= .5:
            return float(np.linalg.norm(points[i] - points[j]))
        return default

    shoulder_width = float(np.clip(seg(11, 12, 120.0), 70, 145))
    torso = float(np.clip(np.mean([seg(11, 23, 105.0), seg(12, 24, 105.0)]), 82, 125))
    upper_arm = float(np.clip(np.mean([seg(11, 13, 62.0), seg(12, 14, 62.0)]), 48, 80))

    cx, shoulder_y = 240, 115
    half = shoulder_width / 2
    hip_y = shoulder_y + torso
    target = {
        0: (cx, 63), 7: (cx - 9, 57), 8: (cx + 9, 57),
        11: (cx - half, shoulder_y), 12: (cx + half, shoulder_y),
        13: (cx - half, shoulder_y + upper_arm), 14: (cx + half, shoulder_y + upper_arm),
        15: (cx - 20, shoulder_y + upper_arm + 25), 16: (cx + 20, shoulder_y + upper_arm + 25),
        23: (cx - half * .55, hip_y), 24: (cx + half * .55, hip_y),
    }
    for a, b in SKELETON:
        if a in target and b in target:
            cv2.line(canvas, target[a], target[b], (47, 69, 60), 6, cv2.LINE_AA)
    for p in target.values():
        cv2.circle(canvas, (int(p[0]), int(p[1])), 5, (28, 154, 111), -1, cv2.LINE_AA)
    cv2.line(canvas, (cx, 45), (cx, 245), (28, 154, 111), 2, cv2.LINE_AA)
    cv2.putText(canvas, "PERSONAL POSTURE BASELINE", (86, 342), cv2.FONT_HERSHEY_SIMPLEX,
                .58, (28, 107, 77), 2, cv2.LINE_AA)
    return canvas


def mask_angle(a):
    """把角度打码（半藏半漏）：25 → "2_°"，8 → "_°"。"""
    a = float(a)
    return f"{int(a) // 10}_°" if a >= 10 else "_°"


def make_thumb(image_b64, width=180):
    """生成列表页缩略图，减小接口体积。"""
    try:
        arr = np.frombuffer(base64.b64decode(image_b64), np.uint8)
    except Exception:
        return None
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    scale = width / w
    small = cv2.resize(img, (width, int(h * scale)))
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return base64.b64encode(buf).decode("ascii") if ok else None


# ---------------------------------------------------------------------------
# 姿态检测与分诊错误
# ---------------------------------------------------------------------------
class _PoseError(Exception):
    """带错误码的姿态检测异常，前端据此给出具体分诊指令。"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def measure(frame):
    """检测单张照片并计算全部几何指标。失败抛 _PoseError(code, message)。"""
    if cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean() < 45:
        raise _PoseError("low_light", "光线太暗，请到亮处或开灯后重拍")
    points, vis = detect_pose(frame)
    if points is None:
        raise _PoseError("no_person", "未检测到人体，请后退一点、确保头部和肩部完整入镜")
    if vis[11] < 0.5 or vis[12] < 0.5:
        raise _PoseError("shoulder_occluded", "肩部被遮挡，请放下手臂、正对镜头重拍")

    shoulder = (points[11] + points[12]) / 2
    hip = ((points[23] + points[24]) / 2) if (vis[23] >= .5 and vis[24] >= .5) else shoulder + np.array([0.0, 100.0])
    ear = ((points[7] + points[8]) / 2) if (vis[7] >= .5 and vis[8] >= .5) else points[0]
    torso_len = np.linalg.norm(shoulder - hip) or 100.0
    head_tilt = segment_tilt(points[7], points[8]) if (vis[7] >= .5 and vis[8] >= .5) else segment_tilt(points[2], points[5])

    metrics = {
        "head_forward": round(head_forward_angle(ear, shoulder), 1),
        "shoulder_tilt": round(segment_tilt(points[11], points[12]), 1),
        "head_tilt": round(head_tilt, 1),
        "lateral": round(float((points[0][0] - hip[0]) / torso_len), 3),
        "forward_ratio": round(float((ear[0] - shoulder[0]) / torso_len), 3),
    }
    return metrics, points, vis


# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------
# 各表建表语句：(表名, SQLite 版, MySQL 版)
_SCHEMAS = (
    ("users",
     "CREATE TABLE IF NOT EXISTS users (openid TEXT PRIMARY KEY, nickname TEXT, created_at INTEGER, member INTEGER DEFAULT 0)",
     "CREATE TABLE IF NOT EXISTS users (openid VARCHAR(64) PRIMARY KEY, nickname VARCHAR(64), created_at BIGINT, member INT DEFAULT 0)"),
    ("posture_records",
     "CREATE TABLE IF NOT EXISTS posture_records (id INTEGER PRIMARY KEY AUTOINCREMENT, openid TEXT NOT NULL, angle REAL, shoulder_tilt REAL, head_tilt REAL, lateral_lean REAL, level TEXT, posture_type TEXT, status TEXT, advice TEXT, analyzed_image TEXT, original_image TEXT, standard_image TEXT, thumb TEXT, created_at INTEGER)",
     "CREATE TABLE IF NOT EXISTS posture_records (id INT AUTO_INCREMENT PRIMARY KEY, openid VARCHAR(64) NOT NULL, angle DOUBLE, shoulder_tilt DOUBLE, head_tilt DOUBLE, lateral_lean DOUBLE, level VARCHAR(16), posture_type VARCHAR(32), status VARCHAR(128), advice TEXT, analyzed_image MEDIUMTEXT, original_image MEDIUMTEXT, standard_image MEDIUMTEXT, thumb MEDIUMTEXT, created_at BIGINT)"),
    ("pressure_sessions",
     "CREATE TABLE IF NOT EXISTS pressure_sessions (id TEXT PRIMARY KEY, openid TEXT, device_id TEXT, frame_count INTEGER, mean REAL, cv REAL, cop_x REAL, cop_y REAL, asymmetry REAL, level TEXT, posture_type TEXT, status TEXT, advice TEXT, frames TEXT, created_at INTEGER)",
     "CREATE TABLE IF NOT EXISTS pressure_sessions (id VARCHAR(64) PRIMARY KEY, openid VARCHAR(64), device_id VARCHAR(64), frame_count INT, mean DOUBLE, cv DOUBLE, cop_x DOUBLE, cop_y DOUBLE, asymmetry DOUBLE, level VARCHAR(16), posture_type VARCHAR(32), status VARCHAR(128), advice TEXT, frames MEDIUMTEXT, created_at BIGINT)"),
    ("analyses",
     "CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, openid TEXT, paid INTEGER DEFAULT 0, result TEXT, created_at INTEGER)",
     "CREATE TABLE IF NOT EXISTS analyses (id VARCHAR(64) PRIMARY KEY, openid VARCHAR(64), paid INT DEFAULT 0, result MEDIUMTEXT, created_at BIGINT)"),
    ("tips",
     "CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, icon TEXT, color TEXT, content TEXT)",
     "CREATE TABLE IF NOT EXISTS tips (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(64), icon VARCHAR(8), color VARCHAR(16), content VARCHAR(256))"),
)

# 默认健康贴士（首次启动种子数据，之后可在数据库里增删改）
DEFAULT_TIPS = (
    ("调整坐姿", "坐", "green", "双脚平放，屏幕上缘接近视线水平。"),
    ("定时活动", "动", "orange", "每坐 40–60 分钟，起身舒展几分钟。"),
    ("保持头正", "正", "green", "下巴微收、后脑靠后，避免长时间头前伸。"),
    ("对称发力", "衡", "green", "避免单侧背包、长期单腿支撑，让身体左右对称。"),
    ("练练核心", "练", "orange", "每周 3 次核心与背部训练，腰背更省力。"),
    ("睡前拉伸", "拉", "green", "睡前温和拉伸颈肩腰背，帮助放松。"),
    ("枕头合适", "枕", "orange", "枕头过高过低都伤颈，仰卧时颈下微托即可。"),
    ("正确搬物", "搬", "green", "搬重物屈膝下蹲、腰背挺直，用腿发力。"),
)


class DB:
    """SQLite / MySQL 统一封装：本地默认 SQLite，设 DB_HOST 环境变量则切 MySQL。"""

    def __init__(self):
        self.mysql = bool(os.environ.get("DB_HOST"))
        if self.mysql:
            import pymysql
            self.conn = pymysql.connect(
                host=os.environ["DB_HOST"],
                port=int(os.environ.get("DB_PORT", "3306")),
                user=os.environ.get("DB_USER", "root"),
                password=os.environ.get("DB_PASSWORD", ""),
                database=os.environ.get("DB_NAME", "spine_ai"),
                charset="utf8mb4",
                cursorclass=pymysql.cursors.DictCursor,
            )
        else:
            self.conn = sqlite3.connect(DB_PATH)
            self.conn.row_factory = sqlite3.Row

    def execute(self, sql, params=()):
        if self.mysql:
            sql = sql.replace("?", "%s")
        cur = self.conn.cursor()
        cur.execute(sql, params)
        return cur

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.conn.commit()
        else:
            self.conn.rollback()
        self.conn.close()


def get_db():
    return DB()


def seed_tips():
    """首次启动时写入默认贴士；之后可直接在数据库里增删改。"""
    with get_db() as db:
        count = db.execute("SELECT COUNT(*) AS c FROM tips").fetchone()
        if count["c"] == 0:
            for title, icon, color, content in DEFAULT_TIPS:
                db.execute(
                    "INSERT INTO tips (title, icon, color, content) VALUES (?, ?, ?, ?)",
                    (title, icon, color, content),
                )


def _migrate_users_member():
    """给 users 表补 member 列（兼容已存在的旧数据库）。"""
    with get_db() as db:
        if db.mysql:
            try:
                db.execute("SELECT member FROM users LIMIT 1").fetchone()
            except Exception:  # noqa: BLE001
                db.execute("ALTER TABLE users ADD COLUMN member INT DEFAULT 0")
        else:
            cols = [r["name"] for r in db.execute("PRAGMA table_info(users)").fetchall()]
            if "member" not in cols:
                db.execute("ALTER TABLE users ADD COLUMN member INTEGER DEFAULT 0")


def init_db():
    with get_db() as db:
        for _name, sqlite_sql, mysql_sql in _SCHEMAS:
            db.execute(mysql_sql if db.mysql else sqlite_sql)
    _migrate_users_member()
    seed_tips()


init_db()


def resolve_openid(code, device_id):
    """优先用微信 jscode2session 换取真实 openid；无密钥时退回开发模式。"""
    if WX_SECRET:
        url = ("https://api.weixin.qq.com/sns/jscode2session"
               f"?appid={WX_APPID}&secret={WX_SECRET}"
               f"&js_code={code}&grant_type=authorization_code")
        try:
            with urllib.request.urlopen(url, timeout=6) as r:
                data = json.loads(r.read().decode())
            if data.get("openid"):
                return data["openid"], None
            return None, data.get("errmsg", "微信登录失败")
        except Exception as exc:  # noqa: BLE001
            return None, f"微信接口不可达: {exc}"
    if device_id:
        return "dev_" + hashlib.sha1(device_id.encode()).hexdigest()[:16], None
    return None, "缺少登录凭证"


def get_member(openid):
    """查询用户是否为终身会员（一次付费，终身免费）。"""
    if not openid:
        return False
    with get_db() as db:
        row = db.execute("SELECT member FROM users WHERE openid = ?", (openid,)).fetchone()
        return bool(row and row["member"])


def set_member(openid):
    """把用户标记为终身会员（模拟支付成功；真支付接入后由支付回调调用）。"""
    with get_db() as db:
        upsert = (
            "INSERT INTO users (openid, nickname, created_at, member) VALUES (?, ?, ?, 1) "
            "ON DUPLICATE KEY UPDATE member = 1"
            if db.mysql else
            "INSERT INTO users (openid, nickname, created_at, member) VALUES (?, ?, ?, 1) "
            "ON CONFLICT(openid) DO UPDATE SET member = 1"
        )
        db.execute(upsert, (openid, "用户" + openid[-4:], int(1e3 * time.time())))


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return jsonify(ok=True)


@app.get("/tips")
def get_tips():
    """返回今日健康贴士：按一年中的第几天轮换 2 条，每天不同。"""
    with get_db() as conn:
        rows = conn.execute("SELECT title, icon, color, content FROM tips ORDER BY id").fetchall()
    tips = [dict(r) for r in rows]
    if not tips:
        return jsonify(tips=[])
    day = time.localtime().tm_yday
    picked = [tips[(day + i) % len(tips)] for i in range(min(2, len(tips)))]
    return jsonify(tips=picked)


@app.post("/auth/login")
def auth_login():
    body = request.get_json(silent=True) or {}
    openid, err = resolve_openid(body.get("code"), body.get("deviceId"))
    if err:
        return jsonify(error=err), 401
    nickname = (body.get("nickname") or "用户" + openid[-4:]).strip()
    with get_db() as conn:
        upsert = (
            "INSERT INTO users (openid, nickname, created_at) VALUES (?, ?, ?) "
            "ON DUPLICATE KEY UPDATE nickname=VALUES(nickname)"
            if conn.mysql else
            "INSERT INTO users (openid, nickname, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(openid) DO UPDATE SET nickname=excluded.nickname"
        )
        conn.execute(upsert, (openid, nickname, int(1e3 * time.time())))
    return jsonify(openid=openid, nickname=nickname)


@app.get("/member/status")
def member_status():
    """查询当前用户是否为终身会员。"""
    return jsonify(member=get_member(request.args.get("openid") or ""))


@app.post("/analyze")
def analyze():
    upload = request.files.get("image")
    if upload is None:
        return jsonify(error="缺少 image 文件"), 400
    frame = cv2.imdecode(np.frombuffer(upload.read(), np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return jsonify(error="无法读取照片"), 400

    # 正面照：测高低肩 / 头侧倾 / 躯干侧偏
    try:
        front_metrics, points, vis = measure(frame)
    except _PoseError as exc:
        return jsonify(code=exc.code, error=exc.message), 422

    # 可选侧面照：测头前伸 / 后仰（以 base64 从 formData 传来）
    side_metrics = None
    side_b64 = request.form.get("side") or ""
    if side_b64:
        try:
            side_frame = cv2.imdecode(np.frombuffer(base64.b64decode(side_b64), np.uint8), cv2.IMREAD_COLOR)
        except Exception:
            side_frame = None
        if side_frame is not None:
            try:
                side_metrics, _, _ = measure(side_frame)
            except _PoseError as exc:
                return jsonify(code=exc.code, error="侧面照：" + exc.message), 422

    metrics = {
        "head_forward": side_metrics["head_forward"] if side_metrics else 0.0,
        "shoulder_tilt": front_metrics["shoulder_tilt"],
        "head_tilt": front_metrics["head_tilt"],
        "lateral": front_metrics["lateral"],
        "forward_ratio": side_metrics["forward_ratio"] if side_metrics else 0.0,
    }
    level, ptype, status, advice = classify_posture(metrics)
    if side_metrics is None:
        advice += " 未提供侧面照，头前伸未评估，建议补拍。"

    detected = draw_detected(frame, points, vis, metrics, level, ptype)
    full = {
        "angle": metrics["head_forward"],
        "shoulderTilt": metrics["shoulder_tilt"],
        "headTilt": metrics["head_tilt"],
        "lateralLean": metrics["lateral"],
        "level": level, "postureType": ptype, "status": status, "advice": advice,
        "analyzedImage": encode_image(detected),
        "originalImage": encode_image(frame),
        "standardImage": encode_image(personalized_standard(points, vis)),
        "hasSide": bool(side_metrics),
    }
    aid = uuid.uuid4().hex
    openid = request.form.get("openid") or ""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO analyses (id, openid, paid, result, created_at) VALUES (?, ?, 0, ?, ?)",
            (aid, openid, json.dumps(full), int(time.time() * 1e3)),
        )

    # 终身会员：分析完成后直接返回完整报告，无需二次付费
    if get_member(openid):
        return jsonify(analysisId=aid, member=True, paid=True, **full)

    # 非会员：半藏半漏，免费返回类型 + 严重度 + 打码角度 + 截断建议 + 高斯模糊图，其余解锁后可见
    return jsonify(
        analysisId=aid,
        price=UNLOCK_PRICE,
        member=False,
        level=level,
        postureType=ptype,
        hasSide=bool(side_metrics),
        maskedAngle=mask_angle(metrics["head_forward"]),
        teaserAdvice=(advice[:12] + "…") if len(advice) > 12 else advice,
        blurredImage=encode_image(cv2.GaussianBlur(detected, (51, 51), 0), quality=70),
    )


@app.post("/unlock")
def unlock():
    """一次性开通终身会员（模拟支付），之后所有报告终身免费查看。

    接入微信支付后：服务端统一下单 → 客户端 wx.requestPayment →
    微信回调 /pay/notify 校验成功后，调用本接口把该 openid 标记为终身会员。
    """
    body = request.get_json(silent=True) or {}
    aid = body.get("analysisId")
    openid = body.get("openid") or ""
    if not openid:
        return jsonify(error="请先登录后再开通会员"), 400

    # 模拟支付成功：标记终身会员（一次付费，终身免费）
    set_member(openid)

    if not aid:
        return jsonify(member=True, paid=True)

    with get_db() as conn:
        row = conn.execute("SELECT * FROM analyses WHERE id = ?", (aid,)).fetchone()
        if row is None:
            return jsonify(error="分析结果不存在或已过期", member=True), 404
        conn.execute("UPDATE analyses SET paid = 1 WHERE id = ?", (aid,))
    result = json.loads(row["result"])
    result["paid"] = True
    result["member"] = True
    return jsonify(result)


@app.post("/records")
def create_record():
    body = request.get_json(silent=True) or {}
    openid = body.get("openid")
    if not openid:
        return jsonify(error="缺少 openid"), 400
    analyzed_image = body.get("analyzedImage") or ""
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO posture_records
               (openid, angle, shoulder_tilt, head_tilt, lateral_lean, level,
                posture_type, status, advice, analyzed_image, original_image,
                standard_image, thumb, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (openid, body.get("angle"), body.get("shoulderTilt"), body.get("headTilt"),
             body.get("lateralLean"), body.get("level"), body.get("postureType"),
             body.get("status"), body.get("advice"), analyzed_image,
             body.get("originalImage") or "", body.get("standardImage") or "",
             make_thumb(analyzed_image) if analyzed_image else None,
             body.get("createdAt") or int(1e3 * time.time())),
        )
        return jsonify(id=cur.lastrowid)


@app.get("/records")
def list_records():
    openid = request.args.get("openid")
    if not openid:
        return jsonify(error="缺少 openid"), 400
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, angle, shoulder_tilt, head_tilt, lateral_lean, level,
                      posture_type, status, thumb, created_at
               FROM posture_records WHERE openid = ? ORDER BY created_at DESC""",
            (openid,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/records/<int:rid>")
def get_record(rid):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM posture_records WHERE id = ?", (rid,)
        ).fetchone()
    if row is None:
        return jsonify(error="记录不存在"), 404
    return jsonify(dict(row))


@app.delete("/records/<int:rid>")
def delete_record(rid):
    with get_db() as conn:
        conn.execute("DELETE FROM posture_records WHERE id = ?", (rid,))
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# 座椅压力传感器接口（后续座椅硬件接入用）
# 传输：REST/JSON 批量上报（每 1–2 秒一批，每批 10–50 帧）。
# 高频实时流可升级为 WebSocket 或 MQTT；本接口覆盖坐姿稳定性这类慢信号，够用。
# ---------------------------------------------------------------------------
@app.post("/pressure/ingest")
def pressure_ingest():
    body = request.get_json(silent=True) or {}
    frames = body.get("frames")
    if not frames or not isinstance(frames, list):
        return jsonify(error="缺少 frames 数组"), 400
    try:
        mat = [[[float(v) for v in row] for row in f["v"]] for f in frames]
    except (KeyError, TypeError, ValueError):
        return jsonify(error="frames 需为 [{t, v:[[...]]}]"), 400
    m = pressure_metrics(mat)
    level, ptype, status, advice = classify_pressure(m)
    sid = uuid.uuid4().hex
    with get_db() as conn:
        conn.execute(
            """INSERT INTO pressure_sessions
               (id, openid, device_id, frame_count, mean, cv, cop_x, cop_y,
                asymmetry, level, posture_type, status, advice, frames, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (sid, body.get("openid"), body.get("deviceId"), len(frames),
             m["mean"], m["cv"], m["copX"], m["copY"], m["asymmetry"],
             level, ptype, status, advice, json.dumps(frames),
             int(time.time() * 1e3)),
        )
    return jsonify(sessionId=sid, frameCount=len(frames), mean=m["mean"],
                   cv=m["cv"], copX=m["copX"], copY=m["copY"], asymmetry=m["asymmetry"],
                   level=level, postureType=ptype, status=status, advice=advice)


@app.get("/pressure/sessions")
def list_pressure_sessions():
    openid = request.args.get("openid")
    device_id = request.args.get("deviceId")
    if not openid and not device_id:
        return jsonify(error="缺少 openid 或 deviceId"), 400
    where, args = [], []
    if openid:
        where.append("openid = ?")
        args.append(openid)
    if device_id:
        where.append("device_id = ?")
        args.append(device_id)
    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT id, device_id, frame_count, mean, cv, cop_x, cop_y,
                       asymmetry, level, posture_type, status, created_at
                FROM pressure_sessions WHERE {' AND '.join(where)}
                ORDER BY created_at DESC""",
            args,
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/pressure/sessions/<sid>")
def get_pressure_session(sid):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM pressure_sessions WHERE id = ?", (sid,)).fetchone()
    if row is None:
        return jsonify(error="会话不存在"), 404
    d = dict(row)
    d["frames"] = json.loads(d["frames"])
    return jsonify(d)


if __name__ == "__main__":
    # P1-6：服务启动即预热模型，避免用户第一次分析时长时间等待
    try:
        get_detector()
        print("AI 坐姿模型预热完成")
    except Exception as exc:  # noqa: BLE001
        print(f"模型预热失败（登录/历史/压力接口不受影响）: {exc}")
    app.run(host="0.0.0.0", port=5000, debug=False)
