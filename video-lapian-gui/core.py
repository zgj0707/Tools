# -*- coding: utf-8 -*-
"""
核心逻辑（无 GUI 依赖）：镜头检测 + 按镜头抽取代表帧。
- 检测阶段：ContentDetector，可在线程间干净取消（SceneManager.stop）
- 抽帧阶段：自研逐镜头循环（不用 save_images，后者起 daemon 线程无法中途打断），
  逐个镜头 seek/read 并按需缩放，可使用取消令牌在镜头边界停止
- 回调协议：
    log(level, msg)      level ∈ info / success / warn / error，均在调用方线程触发
    progress(done, total, phase)   phase ∈ detect（按帧） / save（按图）
- 设置持久化：脚本同目录 config.json（原子写入；失败静默降级）
"""
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import cv2
import numpy as np

from scenedetect import open_video, SceneManager
from scenedetect.detectors import ContentDetector
from scenedetect.video_stream import VideoOpenFailure

# scenedetect 0.7.1 内部选帧工具（requirements 锁版本，行为与 save_images 完全一致）
# 生成每镜头 num_images 个抽帧时间点（含首尾 margin 保护）
from scenedetect.output.image import _generate_timecode_list  # noqa: E402

# ---- 回调级别 / 结果状态 ----
L_INFO = "info"
L_SUCCESS = "success"
L_WARN = "warn"
L_ERROR = "error"

STATUS_COMPLETED = "completed"
STATUS_CANCELED = "canceled"
STATUS_ERROR = "error"

DEFAULT_SETTINGS = {
    "sensitivity": 10,
    "min_scene_len": 15,
    "num_images": 2,
    "output_width": None,        # None = 原始尺寸；或 720 / 1280 / 1920
    "last_video_dir": "",
    "last_out_dir": "",
    "window_geometry": "",
}
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

_JPEG_QUALITY = 95


# ---------------------------------------------------------------------------
# 数据类
# ---------------------------------------------------------------------------
@dataclass
class AnalyzeParams:
    """ContentDetector 与抽帧的参数集合。"""

    sensitivity: int = 10            # ContentDetector 阈值，越小越敏感
    min_scene_len: int = 15         # 最短镜头长度（帧），滤除抖动等过短切点
    num_images: int = 2             # 每镜头抽帧数
    output_width: Optional[int] = None  # 输出帧图宽（等比缩放），None=原始尺寸


@dataclass
class AnalyzeResult:
    status: str                     # completed / canceled / error
    scene_count: int = 0
    images_saved: int = 0
    out_dir: str = ""
    elapsed: float = 0.0            # 秒
    error: str = ""


@dataclass
class VideoInfo:
    path: str
    name: str
    width: int
    height: int
    fps: float
    duration_secs: float
    total_frames: int

    def as_text(self) -> str:
        size = f"{self.width}×{self.height}" if self.width and self.height else "未知分辨率"
        return (f"{size} · {fmt_fps(self.fps)}fps · "
                f"时长 {fmt_duration(self.duration_secs)} · {self.total_frames} 帧")


# ---------------------------------------------------------------------------
# 格式化工具
# ---------------------------------------------------------------------------
def fmt_duration(seconds: float) -> str:
    """秒 → 「HH:MM:SS.mmm」（与抽帧文件命名时间格式一致）。"""
    ms = max(0, int(round(seconds * 1000)))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def fmt_fps(fps: float) -> str:
    if fps == int(fps):
        return str(int(fps))
    return f"{fps:.2f}".rstrip("0").rstrip(".")


def fmt_elapsed(seconds: float) -> str:
    """耗时展示：<1 分显示「X 秒」，否则「X 分 Y 秒」。"""
    seconds = max(0, round(seconds))
    if seconds < 60:
        return f"{seconds} 秒"
    return f"{seconds // 60} 分 {seconds % 60} 秒"


# ---------------------------------------------------------------------------
# 取消 / 进度
# ---------------------------------------------------------------------------
class CancelToken:
    """线程安全的一次性取消令牌。

    register_stopper 在注册时若已取消会立即调用回调，覆盖
    「用户先点停止、worker 后构造 SceneManager」的竞态。
    """

    def __init__(self) -> None:
        self._event = threading.Event()
        self._stopper: Optional[Callable[[], None]] = None

    @property
    def canceled(self) -> bool:
        return self._event.is_set()

    def cancel(self) -> None:
        self._event.set()
        stopper = self._stopper
        if stopper is not None:
            try:
                stopper()
            except Exception:
                pass

    def register_stopper(self, fn: Optional[Callable[[], None]]) -> None:
        self._stopper = fn
        if fn is not None and self._event.is_set():
            try:
                fn()
            except Exception:
                pass


class ProgressStream:
    """包装 VideoStream，在 read() 时统计已解码帧并节流回调进度。

    仅用于检测阶段；其余属性/方法全部委托给内层流。
    """

    def __init__(self, inner, total_frames: int, progress: Callable) -> None:
        self._inner = inner
        self._total = total_frames
        self._progress = progress
        self._n = 0
        self._last_t = 0.0

    def read(self, decode: bool = True):
        frame = self._inner.read(decode=decode)
        if decode and isinstance(frame, np.ndarray):
            self._n += 1
            now = time.monotonic()
            # 节流：每 300 帧或 0.3 秒回报一次，避免高频回调拖慢检测
            if self._n % 300 == 0 or now - self._last_t >= 0.3:
                self._last_t = now
                done = min(self._n, self._total) if self._total else self._n
                self._progress(done, self._total, "detect")
        return frame

    def __getattr__(self, name):
        return getattr(self._inner, name)


# ---------------------------------------------------------------------------
# 探测 / 路径
# ---------------------------------------------------------------------------
def probe_video(path: str) -> Optional[VideoInfo]:
    """读取视频元信息；失败（打不开/无视频流）返回 None。"""
    try:
        stream = open_video(path)
    except (VideoOpenFailure, OSError):
        return None
    try:
        duration = stream.duration
        frame_size = stream.frame_size
        fps = stream.frame_rate
        return VideoInfo(
            path=path,
            name=stream.name,
            width=frame_size[0] if frame_size else 0,
            height=frame_size[1] if frame_size else 0,
            fps=float(fps) if fps else 0.0,
            duration_secs=duration.seconds if duration else 0.0,
            total_frames=duration.frame_num if duration else 0,
        )
    except Exception:
        return None
    finally:
        try:
            stream.reset()  # 释放解码器，恢复游标
        except Exception:
            pass


def derive_default_outdir(video_path: str) -> str:
    """默认输出：视频同目录下的「拉片帧图-<视频名>」。"""
    base = os.path.splitext(os.path.basename(video_path))[0]
    return os.path.join(os.path.dirname(video_path) or ".", f"拉片帧图-{base}")


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def analyze_video(
    video_path: str,
    out_dir: str = "",
    params: Optional[AnalyzeParams] = None,
    log: Callable[[str, str], None] = None,
    progress: Optional[Callable[[int, int, str], None]] = None,
    token: Optional[CancelToken] = None,
) -> AnalyzeResult:
    """镜头检测 + 按镜头抽帧，全程可被 token 取消。

    log:  回调 log(level, msg)，level ∈ info/success/warn/error
    progress: 可选，progress(done, total, phase)，phase ∈ detect/save
    token: 可选，线程安全取消令牌
    """
    params = params or AnalyzeParams()
    token = token or CancelToken()
    if log is None:
        log = lambda _level, msg: print(msg)

    start = time.monotonic()

    if not video_path or not os.path.isfile(video_path):
        log(L_ERROR, "错误：请先选择有效的视频文件")
        return AnalyzeResult(STATUS_ERROR, error="视频文件不存在")

    if not out_dir:
        out_dir = derive_default_outdir(video_path)
        log(L_INFO, f"未指定保存位置，使用默认目录：{out_dir}")
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as exc:
        log(L_ERROR, f"无法创建输出目录：{exc}")
        return AnalyzeResult(STATUS_ERROR, error=f"无法创建输出目录：{exc}")

    log(L_INFO, f"视频：{video_path}")
    log(L_INFO,
        f"灵敏度（阈值）{params.sensitivity} ｜ 最短镜头长度 {params.min_scene_len} 帧"
        f" ｜ 每镜头抽帧数 {params.num_images}"
        f" ｜ 输出宽度 {params.output_width if params.output_width else '原始'}")
    log(L_INFO, f"帧图保存到：{out_dir}")

    # ---- 打开视频 ----
    try:
        video_stream = open_video(video_path)
    except (VideoOpenFailure, OSError) as exc:
        log(L_ERROR, f"无法打开视频：{exc}")
        log(L_WARN, "提示：文件可能已损坏，或需安装 ffmpeg 解码"
                    "（HEVC/RM/部分 MKV 依赖 ffmpeg；H.264 MP4 一般开箱即用）")
        return AnalyzeResult(STATUS_ERROR, error=str(exc))

    total_frames = 0
    try:
        total_frames = video_stream.duration.frame_num
    except Exception:
        total_frames = 0

    # ---- 检测阶段 ----
    scene_list = []
    try:
        detect_stream = ProgressStream(video_stream, total_frames, progress) \
            if progress is not None else video_stream
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(
            threshold=params.sensitivity, min_scene_len=params.min_scene_len))
        token.register_stopper(scene_manager.stop)
        if token.canceled:
            log(L_WARN, "已取消")
            return AnalyzeResult(STATUS_CANCELED, out_dir=out_dir,
                                 elapsed=time.monotonic() - start)
        if total_frames:
            log(L_INFO, f"正在检测镜头边界…（共 {total_frames} 帧，阈值越小越敏感）")
        else:
            log(L_INFO, "正在检测镜头边界…（阈值越小越敏感）")
        scene_manager.detect_scenes(detect_stream, show_progress=False)
        scene_list = scene_manager.get_scene_list()
    except Exception as exc:
        log(L_ERROR, f"检测失败：{exc}")
        if token.canceled:
            return AnalyzeResult(STATUS_CANCELED, out_dir=out_dir,
                                 elapsed=time.monotonic() - start)
        return AnalyzeResult(STATUS_ERROR, error=str(exc), out_dir=out_dir,
                             elapsed=time.monotonic() - start)

    n = len(scene_list)
    if token.canceled:
        log(L_WARN, f"检测已停止，保留已检测到的 {n} 个镜头")
    else:
        log(L_SUCCESS, f"共检测到 {n} 个镜头")
    if n == 0:
        if token.canceled:
            return _finish(token, 0, 0, out_dir, start)
        log(L_WARN, "未检测到镜头边界：画面可能全程无变化，或参数偏钝")
        log(L_WARN, "建议：调低「灵敏度」，或把「最短镜头长度」调小")
        return AnalyzeResult(STATUS_COMPLETED, scene_count=0, images_saved=0,
                             out_dir=out_dir, elapsed=time.monotonic() - start)

    # ---- 抽帧阶段 ----
    try:
        video_stream.reset()  # 检测后游标在片尾，重置回开头
    except Exception as exc:
        log(L_ERROR, f"重置视频流失败：{exc}")
        return _finish(token, n, 0, out_dir, start,
                       error=f"重置视频流失败：{exc}" if not token.canceled else "")

    try:
        timecode_list = _generate_timecode_list(scene_list, params.num_images, 1)
    except Exception:
        log(L_WARN, "时间点生成异常，改用镜头中点策略")
        timecode_list = _fallback_timecodes(scene_list, params.num_images)

    total_images = n * params.num_images
    images_saved = 0
    for i, scene_tcs in enumerate(timecode_list, start=1):
        if token.canceled:
            break
        for tc in scene_tcs:
            if token.canceled:
                break
            try:
                video_stream.seek(tc)
                frame = video_stream.read()
            except Exception:
                frame = None
            if not isinstance(frame, np.ndarray):
                log(L_WARN, f"镜头 {i}：{tc} 处的帧解码失败，跳过")
                continue
            try:
                img = _resize_to_width(frame, params.output_width)
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, _JPEG_QUALITY])
                if not ok:
                    log(L_WARN, f"镜头 {i}：{tc} 编码失败，跳过")
                    continue
                fname = f"{video_stream.name}_{tc.get_timecode().replace(':', ';')}.jpg"
                buf.tofile(os.path.join(out_dir, fname))
                images_saved += 1
                if progress is not None:
                    progress(images_saved, total_images, "save")
            except OSError as exc:
                log(L_ERROR, f"写盘失败：{exc}")
                return _finish(token, n, images_saved, out_dir, start, error=str(exc))
            except Exception as exc:
                log(L_WARN, f"镜头 {i}：{tc} 保存失败（{exc}），跳过")
                continue

    if token.canceled:
        log(L_WARN, f"已停止：共保存 {images_saved} 张帧图（目标 {total_images} 张）")
    else:
        log(L_SUCCESS, f"已保存 {images_saved} 张帧图")
    return _finish(token, n, images_saved, out_dir, start)


def _finish(token, n, saved, out_dir, start, error: str = "") -> AnalyzeResult:
    status = STATUS_CANCELED if token.canceled else (STATUS_ERROR if error else STATUS_COMPLETED)
    return AnalyzeResult(status=status, scene_count=n, images_saved=saved,
                         out_dir=out_dir, elapsed=time.monotonic() - start, error=error)


def _resize_to_width(frame: np.ndarray, output_width: Optional[int]) -> np.ndarray:
    """按目标宽度等比缩放；None 或同为原宽时原样返回。"""
    if not output_width:
        return frame
    height, width = frame.shape[:2]
    if width == output_width:
        return frame
    factor = output_width / width
    return cv2.resize(frame, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)


def _fallback_timecodes(scene_list, num_images: int):
    """兜底选帧：每镜头均匀取 num_images 个点（正常情况下不会走到）。"""
    from scenedetect import FrameTimecode  # 延迟导入，仅在兜底分支使用

    result = []
    for start, end in scene_list:
        duration = max((end - start).frame_num, 1)
        step = duration / max(num_images, 1)
        tcs = []
        for j in range(num_images):
            fc = min(start.frame_num + int((j + 0.5) * step), end.frame_num - 1)
            tcs.append(FrameTimecode(frame_num=fc, fps=start.fps))
        result.append(tcs)
    return result


# ---------------------------------------------------------------------------
# 设置持久化
# ---------------------------------------------------------------------------
def load_settings() -> dict:
    settings = dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            settings.update({k: v for k, v in saved.items() if k in settings})
            # output_width 只能是 None 或合法整数，防御脏数据
            if settings["output_width"] not in (None, 720, 1280, 1920):
                settings["output_width"] = None
    except Exception:
        pass
    return settings


def save_settings(settings: dict) -> bool:
    """原子写入（临时文件 + os.replace）；失败返回 False 由调用方降级。"""
    try:
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        os.replace(tmp, SETTINGS_FILE)
        return True
    except Exception:
        return False