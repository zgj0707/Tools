# -*- coding: utf-8 -*-
"""
本地视频拉片 · 镜头检测抽帧小工具 v3
- 仅保留 ContentDetector 模式（实测最准），支持灵敏度（阈值）调节
- 集成 PySceneDetect（Python API，不走命令行）：镜头检测 + 按镜头抽取代表帧
运行环境：pyscenedetect-env（scenedetect 0.7.1 + opencv）
"""
import os
import time
import threading
import tkinter as tk
from tkinter import ttk, filedialog, scrolledtext

from scenedetect import open_video, SceneManager, save_images
from scenedetect.detectors import ContentDetector


def analyze_video(video_path, out_dir, num_images, sensitivity, log):
    """核心逻辑：ContentDetector 检测镜头 -> 每个镜头抽代表帧 -> 保存到 out_dir。可脱离 GUI 调用。"""
    if not video_path or not os.path.isfile(video_path):
        log("错误：请先选择有效的视频文件")
        return None
    if not out_dir:
        base = os.path.splitext(os.path.basename(video_path))[0]
        out_dir = os.path.join(os.path.dirname(video_path), f"拉片帧图-{base}")
    os.makedirs(out_dir, exist_ok=True)

    log(f"打开视频：{video_path}")
    log(f"检测器：ContentDetector｜灵敏度(阈值)：{sensitivity}｜每镜头抽帧数：{num_images}")
    log(f"帧图保存到：{out_dir}")

    start = time.time()
    try:
        video_stream = open_video(video_path)
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(threshold=sensitivity))
        log("正在检测镜头边界…（阈值越小越敏感）")
        scene_manager.detect_scenes(video_stream, show_progress=False)
        scene_list = scene_manager.get_scene_list()
    except Exception as exc:
        log(f"检测失败：{exc}")
        log("提示：若提示无法打开/解码，可能缺少 ffmpeg（对 H.264 MP4 通常可正常解码）")
        return None

    n = len(scene_list)
    log(f"共检测到 {n} 个镜头")
    if n == 0:
        log("未检测到镜头边界（视频画面可能全程无变化，或阈值过钝，可把灵敏度调低）")
        return {"scene_count": 0, "images_saved": 0, "out_dir": out_dir,
                "elapsed": time.time() - start}

    try:
        save_images(scene_list, video_stream, num_images=num_images,
                    output_dir=out_dir, show_progress=False)
    except Exception as exc:
        log(f"抽帧失败：{exc}")
        return {"scene_count": n, "images_saved": 0, "out_dir": out_dir,
                "elapsed": time.time() - start}

    saved = n * num_images
    log(f"已保存 {saved} 张帧图（每镜头 {num_images} 张）")
    log(f"完成，耗时 {time.time() - start:.1f} 秒")
    return {"scene_count": n, "images_saved": saved, "out_dir": out_dir,
            "elapsed": time.time() - start}


class LapianApp:
    def __init__(self, root):
        self.root = root
        root.title("本地视频拉片 · 镜头检测抽帧")
        root.geometry("680x540")
        root.minsize(560, 460)

        frame = ttk.Frame(root, padding=14)
        frame.pack(fill="both", expand=True)

        # 视频文件
        ttk.Label(frame, text="视频文件").grid(row=0, column=0, sticky="w", pady=4)
        self.video_var = tk.StringVar()
        ttk.Entry(frame, textvariable=self.video_var).grid(
            row=0, column=1, sticky="ew", padx=6)
        ttk.Button(frame, text="选择视频…", command=self.pick_video).grid(
            row=0, column=2, padx=(0, 6))

        # 保存位置
        ttk.Label(frame, text="帧图保存到").grid(row=1, column=0, sticky="w", pady=4)
        self.out_var = tk.StringVar()
        ttk.Entry(frame, textvariable=self.out_var).grid(
            row=1, column=1, sticky="ew", padx=6)
        ttk.Button(frame, text="选择位置…", command=self.pick_outdir).grid(
            row=1, column=2, padx=(0, 6))

        # 灵敏度（ContentDetector 阈值）
        ttk.Label(frame, text="灵敏度").grid(row=2, column=0, sticky="w", pady=4)
        self.sens_var = tk.IntVar(value=8)
        ttk.Spinbox(frame, from_=5, to=60, textvariable=self.sens_var, width=6).grid(
            row=2, column=1, sticky="w", padx=6)
        ttk.Label(frame, text="越小越敏感（默认 8，调低可检出更多切点）",
                  foreground="#888").grid(row=2, column=2, sticky="w")

        # 抽帧数
        ttk.Label(frame, text="每镜头抽帧数").grid(row=3, column=0, sticky="w", pady=4)
        self.num_var = tk.IntVar(value=2)
        ttk.Spinbox(frame, from_=1, to=10, textvariable=self.num_var, width=6).grid(
            row=3, column=1, sticky="w", padx=6)
        ttk.Label(frame, text="留空保存位置时：默认存到视频同目录下的“拉片帧图-<视频名>”",
                  foreground="#888").grid(row=4, column=0, columnspan=3, sticky="w", pady=(2, 8))

        # 开始按钮
        self.run_btn = ttk.Button(frame, text="开始分析", command=self.start)
        self.run_btn.grid(row=5, column=0, columnspan=3, pady=(2, 10), sticky="w")

        # 日志区
        self.log_box = scrolledtext.ScrolledText(frame, height=15, state="disabled",
                                                 font=("Consolas", 10))
        self.log_box.grid(row=6, column=0, columnspan=3, sticky="nsew")
        frame.rowconfigure(6, weight=1)
        frame.columnconfigure(1, weight=1)

        self.log("就绪：选择视频和保存位置后点“开始分析”。")
        self.log("检测器：ContentDetector（灵敏度可调，默认 8，越小越敏感）。")

    # ---------- 界面动作 ----------
    def pick_video(self):
        path = filedialog.askopenfilename(
            title="选择要分析的视频",
            filetypes=[("视频文件", "*.mp4 *.mkv *.avi *.mov *.flv *.wmv *.ts *.m4v *.webm"),
                       ("所有文件", "*.*")])
        if path:
            self.video_var.set(path)

    def pick_outdir(self):
        path = filedialog.askdirectory(title="选择帧图保存目录")
        if path:
            self.out_var.set(path)

    def start(self):
        if self.run_btn.instate(["disabled"]):
            return
        self.run_btn.state(["disabled"])
        try:
            num = max(1, int(self.num_var.get()))
        except (TypeError, ValueError):
            num = 3
        try:
            sens = max(1, min(100, int(self.sens_var.get())))
        except (TypeError, ValueError):
            sens = 8

        args = (self.video_var.get().strip(), self.out_var.get().strip(),
                num, sens)
        threading.Thread(target=self._worker, args=args, daemon=True).start()

    def _worker(self, video, out_dir, num, sens):
        def log(msg):
            self.root.after(0, lambda: self.log(msg))

        try:
            analyze_video(video, out_dir, num, sens, log)
        except Exception as exc:  # 兜底，避免线程静默失败
            log(f"发生未预期错误：{exc}")
        finally:
            self.root.after(0, self._re_enable)

    def _re_enable(self):
        self.run_btn.state(["!disabled"])

    def log(self, msg):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")


if __name__ == "__main__":
    root = tk.Tk()
    LapianApp(root)
    root.mainloop()
