# -*- coding: utf-8 -*-
"""
拉片辅助 · Web 界面（浏览器打开，零第三方依赖，仅标准库）

- 本地 HTTP 服务：ThreadingHTTPServer 提供页面与 JSON API
- 核心逻辑全部复用 core.py（镜头检测 / 抽帧 / 取消 / 进度回调）
- 「选择视频/目录」按钮通过服务端隐藏 Tk 弹出原生对话框（浏览器无法给本地路径）
- 启动后自动用默认浏览器打开 http://127.0.0.1:<port>/
- 生命周期：页面右上角「退出」停止服务；直接关标签页时服务会驻留（无害）
"""
import json
import os
import queue
import socket
import subprocess
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import core

HERE = os.path.dirname(os.path.abspath(__file__))
HTML_FILE = os.path.join(HERE, "ui.html")
BASE_PORT = 8765
MAX_LOGS = 500
APP_VERSION = "2.0.0"        # 与 ui.html 底部展示一致；启动时校验已有实例是否同版本
APP_WINDOW_SIZE = "440,540"  # --app 独立窗口尺寸
# 独立 Edge 用户目录：强制 --app/--window-size 生效（避免并入已在运行的浏览器会话）
EDGE_PROFILE = os.path.join(os.environ.get("LOCALAPPDATA") or HERE, "拉片辅助-edge")

VIDEO_TYPES = [("视频文件", "*.mp4 *.mkv *.avi *.mov *.flv *.wmv *.ts *.m4v *.webm"),
               ("所有文件", "*.*")]

_BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def _open_app_window(url):
    """用 Chromium --app 模式打开，做成无浏览器外壳的独立应用窗口；
    使用独立用户目录，保证窗口尺寸生效。找不到浏览器则退回默认浏览器。"""
    for exe in _BROWSERS:
        if os.path.isfile(exe):
            try:
                subprocess.Popen([exe, f"--app={url}",
                                  f"--window-size={APP_WINDOW_SIZE}",
                                  f"--user-data-dir={EDGE_PROFILE}",
                                  "--no-first-run", "--no-default-browser-check"])
                return True
            except OSError:
                break
    webbrowser.open(url)
    return False


# ---------------------------------------------------------------------------
# 全局状态：worker 线程写，HTTP 线程读（GIL 保证简单读写安全）
# ---------------------------------------------------------------------------
class AppState:
    def __init__(self):
        self.settings = core.load_settings()
        self.running = False
        self.token = None
        self.t0 = None
        self.phase = None
        self.done = 0
        self.total = 0
        self.status = "就绪：选择视频后点「开始分析」"
        self.video_info = ""
        self.used_out_dir = ""      # 最近一次分析实际使用的输出目录（含默认推导）
        self.logs = []          # [(ts, level, msg)]
        self._log_seq = 0       # 供前端增量拉取
        self._lock = threading.Lock()


state = AppState()


def _log(level, msg):
    ts = time.strftime("%H:%M:%S")
    with state._lock:
        state.logs.append((ts, level, msg))
        if len(state.logs) > MAX_LOGS:
            del state.logs[: len(state.logs) - MAX_LOGS]
        state._log_seq += 1


def _push_progress(done, total, phase):
    state.phase = phase
    state.done = done
    state.total = total
    elapsed = time.time() - state.t0 if state.t0 else 0
    if phase == "detect":
        if total:
            pct = done * 100.0 / total
            eta = ""
            if done > 0:
                eta = f" · 预计剩余 {core.fmt_elapsed((total - done) / done * elapsed)}"
            state.status = (f"检测中：{done:,}/{total:,} 帧（{pct:.0f}%）"
                            f" · 已用 {core.fmt_elapsed(elapsed)}{eta}")
        else:
            state.status = f"检测中：已处理 {done:,} 帧 · 已用 {core.fmt_elapsed(elapsed)}"
    elif phase == "save":
        state.status = f"正在保存帧图… {done}/{total} 张"


def _worker(video, out_dir, params):
    state.running = True
    state.t0 = time.time()
    state.phase = None
    state.done = 0
    state.total = 0
    state.status = "正在准备…"
    token = core.CancelToken()
    state.token = token
    try:
        result = core.analyze_video(video, out_dir, params,
                                    log=_log, progress=_push_progress, token=token)
    except Exception as exc:
        _log(core.L_ERROR, f"发生未预期错误：{exc}")
        result = core.AnalyzeResult(core.STATUS_ERROR, error=str(exc))
    state.result = result
    state.running = False
    state.token = None
    state.used_out_dir = result.out_dir or ""
    _finish_summary(result)


def _finish_summary(r):
    if r.status == core.STATUS_ERROR:
        _log(core.L_ERROR, f"出错：{r.error}")
        _log(core.L_INFO, "无法打开视频时，可检查：文件是否损坏、是否缺少 ffmpeg 解码器")
        state.status = "出错，详见日志"
        return
    if r.status == core.STATUS_CANCELED:
        _log(core.L_WARN, f"已取消：保留部分结果（{r.scene_count} 个镜头，"
                          f"{r.images_saved} 张帧图）")
        state.status = f"已取消：保留 {r.images_saved} 张帧图"
    elif r.scene_count == 0:
        _log(core.L_WARN, "完成：0 个镜头（画面可能全程无变化，或参数偏钝）")
        _log(core.L_INFO, "建议：调低「灵敏度」，或把「最短镜头长度」调小")
        state.status = "完成：未检测到镜头边界"
        return
    else:
        _log(core.L_SUCCESS, f"完成：共 {r.scene_count} 个镜头，保存 {r.images_saved} 张帧图"
                             f" · 耗时 {core.fmt_elapsed(r.elapsed)}")
        state.status = f"完成：{r.scene_count} 个镜头，保存 {r.images_saved} 张帧图"
    _log(core.L_INFO, f"输出目录：{r.out_dir}")
    if r.json_file:
        _log(core.L_INFO, f"拉片数据：{r.json_file}")
    if r.audio_file:
        _log(core.L_INFO, f"音轨：{r.audio_file}")


# ---------------------------------------------------------------------------
# 原生文件对话框：独立线程持有隐藏 Tk（浏览器无法读取本地路径）
# ---------------------------------------------------------------------------
class _DialogService(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="dialog-service")
        self._req = queue.Queue()
        self._resp = queue.Queue()

    def run(self):
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        while True:
            kind, initialdir = self._req.get()
            if kind == "video":
                path = filedialog.askopenfilename(
                    parent=root, title="选择要分析的视频",
                    initialdir=initialdir or None, filetypes=VIDEO_TYPES)
            elif kind == "dir":
                path = filedialog.askdirectory(
                    parent=root, title="选择帧图保存目录", initialdir=initialdir or None)
            else:
                path = ""
            self._resp.put(path)

    def ask(self, kind, initialdir=""):
        try:
            self._req.put((kind, initialdir))
            return self._resp.get()
        except Exception:
            return ""


_dialog = _DialogService()
_dialog.start()


# ---------------------------------------------------------------------------
# HTTP 处理
# ---------------------------------------------------------------------------
def _build_state():
    with state._lock:
        logs = list(state.logs)
        seq = state._log_seq
    return {
        "running": state.running,
        "status": state.status,
        "phase": state.phase,
        "done": state.done,
        "total": state.total,
        "video_info": state.video_info,
        "log_seq": seq,
        "logs": logs,
        "settings": dict(state.settings),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 静默访问日志，避免刷屏

    # ---------- 通用 ----------
    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self):
        try:
            with open(HTML_FILE, "rb") as f:
                body = f.read()
        except OSError:
            self._send_json({"error": "ui.html 缺失"}, 500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    # ---------- 路由 ----------
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            self._send_html()
        elif path == "/api/state":
            self._send_json(_build_state())
        elif path == "/api/ping":
            self._send_json({"ok": True, "version": APP_VERSION})
        elif path == "/api/quit":
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            self._send_json({"ok": True})
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/analyze":
            self._api_analyze()
        elif path == "/api/stop":
            self._api_stop()
        elif path == "/api/pick_video":
            self._api_pick_video()
        elif path == "/api/pick_dir":
            self._api_pick_dir()
        elif path == "/api/open_dir":
            self._api_open_dir()
        elif path == "/api/settings":
            self._api_settings()
        else:
            self._send_json({"error": "not found"}, 404)

    # ---------- 具体接口 ----------
    def _api_analyze(self):
        if state.running:
            self._send_json({"error": "已在分析中"}, 409)
            return
        data = self._read_json()
        video = (data.get("video") or "").strip()
        if not video or not os.path.isfile(video):
            self._send_json({"error": "请先选择有效的视频文件"}, 400)
            return
        out_dir = (data.get("out_dir") or "").strip()
        p = data.get("params") or {}
        params = core.AnalyzeParams(
            sensitivity=_clamp_int(p.get("sensitivity"), 5, 60, 10),
            min_scene_len=_clamp_int(p.get("min_scene_len"), 1, 300, 15),
            num_images=_clamp_int(p.get("num_images"), 1, 10, 2),
            output_width=p.get("output_width"),
        )
        if params.output_width not in (None, 720, 1280, 1920):
            params.output_width = None
        _save_settings(video, out_dir, params)
        threading.Thread(target=_worker, args=(video, out_dir, params),
                         daemon=True, name="analyze-worker").start()
        self._send_json({"ok": True})

    def _api_stop(self):
        if state.running and state.token is not None:
            state.token.cancel()
            state.status = "正在停止…"
        self._send_json({"ok": True})

    def _api_pick_video(self):
        path = _dialog.ask("video", state.settings.get("last_video_dir") or "")
        if not path:
            self._send_json({"ok": False, "path": ""})
            return
        state.settings["last_video_dir"] = os.path.dirname(path) or ""
        state.video_info = "正在读取视频信息…"
        info = core.probe_video(path)
        state.video_info = info.as_text() if info else ""
        if info is None:
            _log(core.L_WARN, f"无法读取视频信息：{os.path.basename(path)}"
                              "（文件可能损坏，或缺少解码器）")
        self._send_json({"ok": True, "path": path})

    def _api_pick_dir(self):
        path = _dialog.ask("dir", state.settings.get("last_out_dir") or "")
        if path:
            state.settings["last_out_dir"] = path
        self._send_json({"ok": True, "path": path})

    def _api_open_dir(self):
        data = self._read_json()
        out_dir = (data.get("out_dir") or "").strip()
        # 留空时：优先最近一次分析实际使用的目录，其次按视频推导默认目录
        if not out_dir:
            out_dir = state.used_out_dir
        if not out_dir:
            video = (data.get("video") or "").strip()
            if video:
                out_dir = core.derive_default_outdir(video)
        if not out_dir:
            self._send_json({"error": "尚未设置输出目录：请先选择视频或指定保存位置"}, 400)
            return
        if not os.path.isdir(out_dir):
            self._send_json({"error": f"目录不存在：{out_dir}（运行分析后会自动创建）"}, 400)
            return
        try:
            import sys
            if sys.platform == "win32":
                os.startfile(out_dir)
            else:
                import subprocess
                subprocess.Popen(["xdg-open", out_dir])
            self._send_json({"ok": True, "out_dir": out_dir})
        except OSError as exc:
            self._send_json({"error": str(exc)}, 500)

    def _api_settings(self):
        data = self._read_json()
        if isinstance(data, dict) and data:
            for k in ("sensitivity", "min_scene_len", "num_images",
                      "output_width", "last_video_dir", "last_out_dir"):
                if k in data:
                    state.settings[k] = data[k]
            state.settings["output_width"] = (
                state.settings["output_width"] if state.settings["output_width"] in (720, 1280, 1920)
                else None)
            core.save_settings(state.settings)
        self._send_json({"settings": dict(state.settings)})


def _clamp_int(raw, lo, hi, default):
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _save_settings(video, out_dir, params):
    s = state.settings
    s["sensitivity"] = params.sensitivity
    s["min_scene_len"] = params.min_scene_len
    s["num_images"] = params.num_images
    s["output_width"] = params.output_width
    if video:
        s["last_video_dir"] = os.path.dirname(video) or ""
    if out_dir:
        s["last_out_dir"] = out_dir
    if not core.save_settings(s):
        _log(core.L_WARN, "设置保存失败（目录不可写？），本次参数仅本次生效")


# ---------------------------------------------------------------------------
# 启动
# ---------------------------------------------------------------------------
def _pick_port():
    for port in range(BASE_PORT, BASE_PORT + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    # 端口全占：让系统分配
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _existing_instance():
    """若默认端口已有【同版本】本服务在跑，返回其地址（供复用，避免重复实例）。

    版本不匹配（如代码已更新而旧服务未退出）时不复用，避免跑到旧逻辑。
    """
    try:
        with socket.create_connection(("127.0.0.1", BASE_PORT), timeout=0.6) as s:
            s.sendall(b"GET /api/ping HTTP/1.0\r\n\r\n")
            data = b""
            s.settimeout(1.0)
            while b'"ok"' not in data:
                chunk = s.recv(256)
                if not chunk:
                    break
                data += chunk
        body = data.split(b"\r\n\r\n", 1)[-1]
        try:
            return json.loads(body).get("version") == APP_VERSION
        except Exception:
            return False
    except OSError:
        return False


def main():
    if _existing_instance():
        url = f"http://127.0.0.1:{BASE_PORT}/"
        print(f"[拉片辅助] 检测到已有实例，直接打开：{url}")
        _open_app_window(url)
        return
    port = _pick_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    threading.Timer(0.5, lambda: _open_app_window(url)).start()
    print(f"[拉片辅助] 服务已启动：{url}")
    print("关闭页面右上角「退出」按钮或按 Ctrl+C 可停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
