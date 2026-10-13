# -*- coding: utf-8 -*-
"""
本地视频拉片 · 镜头检测抽帧（GUI）

- 卡片式布局：输入 / 参数 / 操作与进度 / 运行日志
- 后台线程执行 core.analyze_video，回调经 queue 交给主线程轮询更新界面
- 支持中途停止（检测用 SceneManager.stop，抽帧在镜头边界检查）
- 设置持久化（脚本同目录 config.json）、快捷键（Ctrl+O / F5 / Esc）
"""
import os
import queue
import re
import subprocess
import sys
import time
import threading
import tkinter as tk
from tkinter import ttk, filedialog

import core


class LapianApp:
    # 配色
    BG = "#f4f5f7"
    ACCENT = "#2563eb"

    def __init__(self, root):
        self.root = root
        root.title("本地视频拉片 · 镜头检测抽帧")
        root.configure(bg=self.BG)
        root.minsize(640, 560)

        self._queue = queue.Queue()
        self._settings = core.load_settings()
        self._token = None
        self._running = False
        self._t0 = None

        self._build_style()
        self._build_ui()
        self._restore_state()
        self._bind_shortcuts()

        root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.log("就绪：选择视频和保存位置后点「开始分析」（F5 快捷开始，Esc 停止）")
        self.log("提示：阈值越小越敏感；结果图以视频时间点命名，可对照时间轴查看")
        self._poll()

    # ------------------------------------------------------------------
    # 主题
    # ------------------------------------------------------------------
    def _build_style(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TFrame", background=self.BG)
        style.configure("TLabelframe", background=self.BG, bordercolor="#d9dbe0")
        style.configure("TLabelframe.Label", background=self.BG, foreground="#4b5563",
                        font=("Microsoft YaHei UI", 9, "bold"))
        style.configure("TLabel", background=self.BG, foreground="#333")
        style.configure("Muted.TLabel", background=self.BG, foreground="#8a8f98")
        style.configure("TButton", padding=(10, 5))
        style.configure("TEntry", padding=(6, 3))
        style.configure("TSpinbox", padding=(3, 2))
        style.configure("TCombobox", padding=(3, 2))
        style.configure("TProgressbar", troughcolor="#e5e7eb", bordercolor="#e5e7eb",
                        background=self.ACCENT, lightcolor=self.ACCENT, darkcolor=self.ACCENT)
        style.configure("Accent.TButton", background=self.ACCENT, foreground="#ffffff",
                        padding=(22, 9), font=("Microsoft YaHei UI", 10, "bold"))
        style.map("Accent.TButton",
                  background=[("active", "#1d4ed8"), ("disabled", "#a5c3f5")],
                  foreground=[("disabled", "#eef3fd")])
        style.configure("Stop.TButton", background="#dc2626", foreground="#ffffff",
                        padding=(22, 9), font=("Microsoft YaHei UI", 10, "bold"))
        style.map("Stop.TButton", background=[("active", "#b91c1c")])
        style.configure("Stopping.TButton", background="#d97706", foreground="#ffffff",
                        padding=(22, 9), font=("Microsoft YaHei UI", 10, "bold"))

    # ------------------------------------------------------------------
    # 界面
    # ------------------------------------------------------------------
    def _build_ui(self):
        outer = ttk.Frame(self.root, padding=14)
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(5, weight=1)  # 日志区占剩余空间

        # ---- 输入卡 ----
        card1 = ttk.LabelFrame(outer, text=" 视频与输出 ", padding=10)
        card1.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        card1.columnconfigure(1, weight=1)

        ttk.Label(card1, text="视频文件").grid(row=0, column=0, sticky="w", pady=(0, 6))
        self.video_var = tk.StringVar()
        ttk.Entry(card1, textvariable=self.video_var).grid(
            row=0, column=1, sticky="ew", padx=8, pady=(0, 6))
        ttk.Button(card1, text="选择视频…", command=self.pick_video).grid(
            row=0, column=2, pady=(0, 6))

        ttk.Label(card1, text="帧图保存到").grid(row=1, column=0, sticky="w")
        self.out_var = tk.StringVar()
        ttk.Entry(card1, textvariable=self.out_var).grid(
            row=1, column=1, sticky="ew", padx=8)
        ttk.Button(card1, text="选择目录…", command=self.pick_outdir).grid(
            row=1, column=2, sticky="w")

        self.video_info_var = tk.StringVar(value="")
        ttk.Label(card1, textvariable=self.video_info_var, style="Muted.TLabel").grid(
            row=2, column=0, columnspan=3, sticky="w", pady=(6, 0))

        # ---- 参数卡 ----
        card2 = ttk.LabelFrame(outer, text=" 参数 ", padding=10)
        card2.grid(row=1, column=0, sticky="ew", pady=(0, 8))

        ttk.Label(card2, text="灵敏度").grid(row=0, column=0, sticky="w", padx=(0, 4))
        self.sens_var = tk.IntVar(value=10)
        ttk.Spinbox(card2, from_=5, to=60, textvariable=self.sens_var, width=5).grid(
            row=0, column=1, sticky="w", padx=(0, 20))

        ttk.Label(card2, text="最短镜头（帧）").grid(row=0, column=2, sticky="w", padx=(0, 4))
        self.minlen_var = tk.IntVar(value=15)
        ttk.Spinbox(card2, from_=1, to=300, textvariable=self.minlen_var, width=5).grid(
            row=0, column=3, sticky="w", padx=(0, 20))

        ttk.Label(card2, text="每镜头抽帧数").grid(row=0, column=4, sticky="w", padx=(0, 4))
        self.num_var = tk.IntVar(value=2)
        ttk.Spinbox(card2, from_=1, to=10, textvariable=self.num_var, width=5).grid(
            row=0, column=5, sticky="w", padx=(0, 20))

        ttk.Label(card2, text="输出宽度").grid(row=0, column=6, sticky="w", padx=(0, 4))
        self.width_var = tk.StringVar(value="原始")
        ttk.Combobox(card2, textvariable=self.width_var,
                     values=["原始", "1920", "1280", "720"], width=6,
                     state="readonly").grid(row=0, column=7, sticky="w")

        ttk.Label(card2, text="阈值越小越敏感；最短镜头长度用于滤掉过短切点；输出宽度影响成图文件大小",
                  style="Muted.TLabel").grid(row=1, column=0, columnspan=8, sticky="w", pady=(6, 0))

        # ---- 操作行 ----
        ops = ttk.Frame(outer)
        ops.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        self.run_btn = ttk.Button(ops, text="开始分析", style="Accent.TButton",
                                  command=self.toggle_run)
        self.run_btn.pack(side="left")
        ttk.Button(ops, text="打开输出目录", command=self.open_outdir).pack(
            side="left", padx=(12, 0))

        # ---- 进度 ----
        self.prog = ttk.Progressbar(outer, maximum=100, value=0)
        self.prog.grid(row=3, column=0, sticky="ew", pady=(0, 4))
        self.status_var = tk.StringVar(value="就绪：选择视频 → 点「开始分析」")
        ttk.Label(outer, textvariable=self.status_var, style="Muted.TLabel").grid(
            row=4, column=0, sticky="w", pady=(0, 8))

        # ---- 日志卡 ----
        card3 = ttk.LabelFrame(outer, text=" 运行日志 ", padding=8)
        card3.grid(row=5, column=0, sticky="nsew")
        card3.rowconfigure(0, weight=1)
        card3.columnconfigure(0, weight=1)
        self.log_box = tk.Text(card3, height=11, wrap="word", state="disabled",
                               font=("Consolas", 9), bg="#fbfbfb", fg="#333",
                               relief="flat", padx=6, pady=4)
        self.log_box.grid(row=0, column=0, sticky="nsew")
        sb = ttk.Scrollbar(card3, orient="vertical", command=self.log_box.yview)
        sb.grid(row=0, column=1, sticky="ns")
        self.log_box.configure(yscrollcommand=sb.set)
        self.log_box.tag_configure("ts", foreground="#a3a8b0")
        self.log_box.tag_configure("success", foreground="#16a34a")
        self.log_box.tag_configure("warn", foreground="#b45309")
        self.log_box.tag_configure("error", foreground="#dc2626")

    def _restore_state(self):
        s = self._settings
        self.sens_var.set(self._clamp_int(s.get("sensitivity"), 5, 60, 10))
        self.minlen_var.set(self._clamp_int(s.get("min_scene_len"), 1, 300, 15))
        self.num_var.set(self._clamp_int(s.get("num_images"), 1, 10, 2))
        self.width_var.set(self._width_label(s.get("output_width")))
        geo = s.get("window_geometry", "")
        if geo and self._geometry_on_screen(geo):
            self.root.geometry(geo)
        else:
            self._center_window()

    # ------------------------------------------------------------------
    # 输入动作
    # ------------------------------------------------------------------
    def pick_video(self):
        initial = self._last_video_dir() or None
        path = filedialog.askopenfilename(
            title="选择要分析的视频",
            initialdir=initial,
            filetypes=[("视频文件", "*.mp4 *.mkv *.avi *.mov *.flv *.wmv *.ts *.m4v *.webm"),
                       ("所有文件", "*.*")])
        if not path:
            return
        self.video_var.set(path)
        if not self.out_var.get().strip():
            self.out_var.set(core.derive_default_outdir(path))
        self.video_info_var.set("正在读取视频信息…")
        threading.Thread(target=self._probe_worker, args=(path,), daemon=True).start()

    def pick_outdir(self):
        initial = self.out_var.get().strip() or self._last_video_dir() or ""
        if initial and not os.path.isdir(initial):
            initial = ""
        path = filedialog.askdirectory(title="选择帧图保存目录",
                                       initialdir=initial or None)
        if path:
            self.out_var.set(path)

    def open_outdir(self):
        out_dir = self.out_var.get().strip()
        if not out_dir:
            video = self.video_var.get().strip()
            if not video:
                self.log("尚未设置输出目录：请先选择视频，或直接指定保存位置", core.L_WARN)
                return
            out_dir = core.derive_default_outdir(video)
            self.out_var.set(out_dir)
            self.log(f"未指定保存位置，将使用默认目录：{out_dir}")
        if not os.path.isdir(out_dir):
            self.log(f"目录不存在：{out_dir}", core.L_WARN)
            self.log("运行分析后会自动创建该目录，之后再打开即可", core.L_INFO)
            return
        try:
            if sys.platform == "win32":
                os.startfile(out_dir)
            else:
                subprocess.Popen(["xdg-open", out_dir])
        except OSError as exc:
            self.log(f"打开目录失败：{exc}", core.L_ERROR)

    # ------------------------------------------------------------------
    # 运行控制
    # ------------------------------------------------------------------
    def toggle_run(self):
        if self._running:
            self.stop_analysis()
        else:
            self.start_analysis()

    def start_analysis(self):
        if self._running or self.run_btn.instate(["disabled"]):
            return
        video = self.video_var.get().strip()
        if not video or not os.path.isfile(video):
            self.log("请先选择有效的视频文件", core.L_ERROR)
            self.status_var.set("未选择视频")
            return

        params = self._read_params()
        self._persist_settings(video)

        self._running = True
        self._t0 = time.time()
        self.prog["value"] = 0
        self.status_var.set("正在准备…")
        self._set_run_button("running")

        token = core.CancelToken()
        self._token = token
        args = (video, self.out_var.get().strip(), params, token)
        threading.Thread(target=self._worker, args=args, daemon=True).start()

    def stop_analysis(self):
        if not self._running:
            return
        if self._token is not None:
            self._token.cancel()
        self._set_run_button("stopping")
        self.status_var.set("正在停止…")

    def _worker(self, video, out_dir, params, token):
        try:
            result = core.analyze_video(
                video, out_dir, params,
                log=self._push_log, progress=self._push_progress, token=token)
        except Exception as exc:
            self._push_log(core.L_ERROR, f"发生未预期错误：{exc}")
            result = core.AnalyzeResult(core.STATUS_ERROR, error=str(exc))
        self._queue.put(("finished", result))

    # ------------------------------------------------------------------
    # 后台线程回调：只入队，绝不直接碰界面
    # ------------------------------------------------------------------
    def _push_log(self, level, msg):
        self._queue.put(("log", level, msg))

    def _push_progress(self, done, total, phase):
        self._queue.put(("progress", done, total, phase))

    def _probe_worker(self, path):
        info = core.probe_video(path)
        if info is not None:
            self._queue.put(("video_info", info.as_text()))
        else:
            self._queue.put(("video_info", ""))
            self._queue.put(("log", core.L_WARN,
                             f"无法读取视频信息：{os.path.basename(path)}"
                             "（文件可能损坏，或缺少解码器）"))

    # ------------------------------------------------------------------
    # 主线程轮询
    # ------------------------------------------------------------------
    def _poll(self):
        try:
            while True:
                self._dispatch(self._queue.get_nowait())
        except queue.Empty:
            pass
        self.root.after(50, self._poll)

    def _dispatch(self, item):
        kind = item[0]
        if kind == "log":
            self.log(item[2], item[1])
        elif kind == "progress":
            self._show_progress(item[1], item[2], item[3])
        elif kind == "video_info":
            self.video_info_var.set(item[1])
        elif kind == "finished":
            self._on_finished(item[1])

    def _show_progress(self, done, total, phase):
        if phase == "detect":
            if total and total > 0:
                self.prog["value"] = 0
                self.prog["maximum"] = total
                self.prog["value"] = done
            else:
                # 未知总帧数：不显示百分比，只报已处理帧数
                self.prog["value"] = 0
                self.prog["maximum"] = 100
            elapsed = time.time() - self._t0 if self._t0 else 0
            pct = done * 100.0 / total if total else 0
            eta = ""
            if done > 0 and total > 0:
                eta = f" · 预计剩余 {core.fmt_elapsed((total - done) / done * elapsed)}"
            if total:
                self.status_var.set(
                    f"检测中：{done:,}/{total:,} 帧（{pct:.0f}%）"
                    f" · 已用 {core.fmt_elapsed(elapsed)}{eta}")
            else:
                self.status_var.set(
                    f"检测中：已处理 {done:,} 帧 · 已用 {core.fmt_elapsed(elapsed)}")
        elif phase == "save":
            self.prog["value"] = 0
            self.prog["maximum"] = max(total, 1)
            self.prog["value"] = done
            self.status_var.set(f"正在保存帧图… {done}/{total} 张")

    def _on_finished(self, result):
        self._running = False
        self._token = None
        self._set_run_button("idle")
        if result.status == core.STATUS_ERROR:
            self.status_var.set("出错，详见日志")
            self.prog["value"] = 0
        elif result.status == core.STATUS_CANCELED:
            self.status_var.set(f"已取消：保留 {result.images_saved} 张帧图")
        elif result.scene_count == 0:
            self.status_var.set("完成：未检测到镜头边界")
            self.prog["value"] = 0
        else:
            self.status_var.set(f"完成：{result.scene_count} 个镜头，"
                                f"保存 {result.images_saved} 张帧图")
            self.prog["value"] = self.prog["maximum"]
        self._print_summary(result)

    def _print_summary(self, result):
        if result.status == core.STATUS_ERROR:
            self.log(f"出错：{result.error}", core.L_ERROR)
            self.log("无法打开视频时，可检查：文件是否损坏、是否缺少 ffmpeg 解码器", core.L_INFO)
            return
        if result.status == core.STATUS_CANCELED:
            self.log(f"已取消：保留部分结果（{result.scene_count} 个镜头，"
                     f"{result.images_saved} 张帧图）", core.L_WARN)
        elif result.scene_count == 0:
            self.log("完成：0 个镜头（画面可能全程无变化，或参数偏钝）", core.L_WARN)
            self.log("建议：调低「灵敏度」，或把「最短镜头长度」调小", core.L_INFO)
            return
        else:
            self.log(f"完成：共 {result.scene_count} 个镜头，保存 {result.images_saved} 张帧图"
                     f" · 耗时 {core.fmt_elapsed(result.elapsed)}", core.L_SUCCESS)
        self.log(f"输出目录：{result.out_dir}", core.L_INFO)

    # ------------------------------------------------------------------
    # 按钮状态 / 参数读取
    # ------------------------------------------------------------------
    def _set_run_button(self, state):
        if state == "idle":
            self.run_btn.configure(style="Accent.TButton", text="开始分析", state="normal")
        elif state == "running":
            self.run_btn.configure(style="Stop.TButton", text="停止", state="normal")
        else:  # stopping
            self.run_btn.configure(style="Stopping.TButton", text="正在停止…", state="disabled")

    def _read_params(self):
        return core.AnalyzeParams(
            sensitivity=self._clamp_int(self.sens_var.get(), 5, 60, 10),
            min_scene_len=self._clamp_int(self.minlen_var.get(), 1, 300, 15),
            num_images=self._clamp_int(self.num_var.get(), 1, 10, 2),
            output_width=self._width_value(self.width_var.get()),
        )

    @staticmethod
    def _clamp_int(raw, lo, hi, default):
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return default
        return max(lo, min(hi, value))

    @staticmethod
    def _width_label(value):
        return str(value) if value in (1920, 1280, 720) else "原始"

    @staticmethod
    def _width_value(label):
        try:
            return int(label)
        except (TypeError, ValueError):
            return None

    # ------------------------------------------------------------------
    # 设置持久化
    # ------------------------------------------------------------------
    def _persist_settings(self, video):
        s = self._settings
        s["sensitivity"] = self._clamp_int(self.sens_var.get(), 5, 60, 10)
        s["min_scene_len"] = self._clamp_int(self.minlen_var.get(), 1, 300, 15)
        s["num_images"] = self._clamp_int(self.num_var.get(), 1, 10, 2)
        s["output_width"] = self._width_value(self.width_var.get())
        s["last_video_dir"] = os.path.dirname(video) or ""
        s["last_out_dir"] = self.out_var.get().strip()
        if not core.save_settings(s):
            self.log("设置保存失败（目录不可写？），本次参数仅本次生效", core.L_WARN)

    def _save_on_close(self):
        self._persist_settings(self.video_var.get().strip() or "")
        self._settings["window_geometry"] = self.root.winfo_geometry()
        core.save_settings(self._settings)

    def _last_video_dir(self):
        d = self._settings.get("last_video_dir") or ""
        return d if d and os.path.isdir(d) else ""

    def _geometry_on_screen(self, geo):
        m = re.match(r"^(\d+)x(\d+)([+-]\d+)([+-]\d+)$", geo)
        if not m:
            return False
        w, h, x, y = (int(g) for g in m.groups())
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        return 0 < w <= sw and 0 < h <= sh and x < sw and y < sh and x + w > 0 and y + h > 0

    def _center_window(self):
        w, h = 900, 640
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        x, y = max(0, (sw - w) // 2), max(0, (sh - h) // 2)
        self.root.geometry(f"{w}x{h}+{x}+{y}")

    # ------------------------------------------------------------------
    # 快捷键 / 关闭
    # ------------------------------------------------------------------
    def _bind_shortcuts(self):
        self.root.bind("<Control-o>", self._on_ctrl_o)
        self.root.bind("<Control-O>", self._on_ctrl_o)
        self.root.bind("<F5>", self._on_toggle)
        self.root.bind("<Control-Return>", self._on_toggle)
        self.root.bind("<Escape>", self._on_escape)

    def _on_ctrl_o(self, _event):
        self.pick_video()
        return "break"

    def _on_toggle(self, _event):
        self.toggle_run()
        return "break"

    def _on_escape(self, _event):
        if self._running:
            self.stop_analysis()
        return "break"

    def _on_close(self):
        self._save_on_close()
        if self._running and self._token is not None:
            self._token.cancel()
        self.root.destroy()

    # ------------------------------------------------------------------
    # 日志
    # ------------------------------------------------------------------
    def log(self, msg, level=core.L_INFO):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", f"[{time.strftime('%H:%M:%S')}] ", "ts")
        self.log_box.insert("end", msg + "\n", level)
        self.log_box.configure(state="disabled")
        self.log_box.see("end")


if __name__ == "__main__":
    root = tk.Tk()
    LapianApp(root)
    root.mainloop()
