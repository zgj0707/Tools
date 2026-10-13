# 拉片辅助 · 镜头检测抽帧

一个超简单的本地桌面小工具：选择视频 → 自动检测镜头边界 → 按镜头抽取代表帧图 → 提取音轨 → 生成拉片数据 JSON，为后续（主要由 AI 完成的）拉片工作备好简明清晰的数据。

- 集成 [PySceneDetect](https://github.com/Breakthrough/PySceneDetect)（Python API，进程内调用，不走命令行）
- **界面为本地 Web 应用**：启动后自动弹出独立小窗口（Edge/Chrome `--app` 模式，约 440×540），无浏览器外壳
- 纯本地运行（`127.0.0.1`），视频不上传，无需联网
- 检测器：ContentDetector（实测最准），支持灵敏度（阈值）调节

## 功能

| 能力 | 说明 |
| --- | --- |
| 镜头检测 | ContentDetector 自动切分镜头边界，输出镜头清单 |
| 按镜头抽帧 | 每个镜头抽取 N 张代表帧（默认 2 张/镜头），文件以「视频名_时间点」命名，如 `test_video_00;00;02.400.jpg` |
| 灵敏度可调 | 阈值 5–60（默认 10），越小越敏感、检出更多切点 |
| 最短镜头长度 | 过滤过短切点（默认 15 帧 ≈ 0.5 秒），避免抖动/闪切被切碎 |
| 输出宽度可调 | 原始 / 1920 / 1280 / 720，4K 视频也能产出小巧的帧图 |
| **音轨提取** | 自动提取 `audio.m4a`（AAC 128kbps），供语音识别/台词分析使用；ffmpeg 由依赖自带，无需手动安装 |
| **拉片数据 JSON** | 生成 `scene_analysis.json`：镜头边界、每镜头代表帧清单、音轨路径、视频元信息——结构化数据，供 AI 后续拉片直接消费 |
| 实时进度 | 检测阶段显示进度条、百分比与预计剩余时间；保存阶段按图计数 |
| 随时停止 | 检测/抽帧过程中可一键中止，已完成的镜头帧图照常保留 |
| 一键打开目录 | 完成后点「打开目录」直达结果文件夹 |
| 记住设置 | 参数、上次目录、窗口位置自动记忆，下次启动直接恢复 |
| 快捷键 | Ctrl+O 打开视频对话框 |
| 原生选文件 | 「选择视频/目录」走 Windows 原生对话框 |
| 视频信息 | 选中视频即显示分辨率、帧率、时长、总帧数 |

## 输出一览

一次分析会在输出目录产出三类数据：

```
拉片帧图-<视频名>/
├── <视频名>_00;00;02.400.jpg …   # 代表帧（按时间点命名）
├── audio.m4a                     # 音轨（AAC 128k）
└── scene_analysis.json           # 拉片数据（供 AI 使用）
```

### scene_analysis.json 结构（给 AI 的拉片数据）

```json
{
  "schema_version": 1,
  "tool": "拉片辅助",
  "video": { "name": "10月12日", "width": 1280, "height": 720,
             "fps": 30.0, "duration_sec": 115.3, "total_frames": 3459, "path": "…" },
  "params": { "sensitivity": 10, "min_scene_len_frames": 15,
              "images_per_scene": 2, "output_width": null },
  "assets": { "frames_dir": "…", "audio_file": "…/audio.m4a" },
  "image_count": 68,
  "scenes": [
    {
      "index": 1,
      "start_sec": 0.0, "end_sec": 4.0, "duration_sec": 4.0,
      "start_timecode": "00:00:00.000", "end_timecode": "00:00:04.000",
      "frames": [
        { "file": "10月12日_00;00;01.400.jpg", "timecode": "00:00:01.400", "time_sec": 1.4 }
      ]
    }
  ]
}
```

AI 拉片时的用法：读 `scenes[]` 得镜头边界与时间码；看 `frames[]` 里的代表帧做画面分析；听/识别 `audio_file` 得台词线索；按 `start_sec/end_sec` 对齐时间轴。

## 目录结构

```
video-lapian-gui/
├── webapp.py          # 本地 Web 服务（标准库 http.server + 后端 API）
├── ui.html            # 界面页面（HTML/CSS/JS，浏览器打开）
├── core.py            # 核心逻辑（无 GUI 依赖，可命令行调用）
├── app.py             # 备用：旧 tkinter 原生界面（不随默认启动）
├── run.bat            # 启动脚本（双击运行）
├── setup.bat          # 一键安装脚本（首次使用）
├── requirements.txt   # Python 依赖（scenedetect + imageio-ffmpeg）
└── config.json        # 首次运行后自动生成的用户设置
```

## 设备要求

- Windows 10/11
- Python 3.10+：请使用 [python.org](https://www.python.org/downloads/) 官方安装包（自带 tkinter，供原生文件对话框使用；其他来源如商店版/精简版可能缺少），安装时勾选 **Add python.exe to PATH**
- Edge 或 Chrome（Windows 自带 Edge）

## 安装（首次使用，一次即可）

```
双击 setup.bat
```

脚本会自动：创建 `.venv` 虚拟环境 → 安装依赖（scenedetect + imageio-ffmpeg，约 1–3 分钟）。`imageio-ffmpeg` 自带 ffmpeg 二进制，音轨提取无需单独安装 ffmpeg。

## 启动

```
双击 run.bat
```

（也可用桌面上的「拉片辅助」快捷方式。）脚本会启动本地服务，并自动打开一个约 440×540 的独立应用窗口；重复双击会直接唤起已运行的实例，不会开第二个服务。

## 使用

1. 「选择视频…」（或 Ctrl+O）：选择要分析的视频（支持 mp4/mkv/avi/mov/flv/wmv/ts/m4v/webm），选中后显示分辨率/帧率/时长/总帧数
2. 「帧图保存到」：选择输出目录；留空则自动保存到视频同目录的 `拉片帧图-<视频名>` 文件夹
3. 参数：
   - **灵敏度**：ContentDetector 阈值，默认 10。越小越敏感（检出更多切点，也可能误报）；越大越钝
   - **最短镜头长度**：默认 15 帧（约 0.5 秒），低于此长度的切点会被合并，防止抖动误切
   - **每镜头抽帧数**：每个镜头保存的代表帧数量，默认 2
   - **输出宽度**：原始 / 1920 / 1280 / 720，决定成图文件大小；原始画质不变但文件大
4. 点「开始分析」（按钮变为「停止」，可随时点击中止），进度条实时显示处理进度、百分比与预计剩余时间，日志区显示镜头数、帧图、音轨与拉片数据的保存结果
5. 完成后点「打开目录」在资源管理器中查看结果；用完点右上角「退出」停止后台服务

## 命令行调用（可选）

激活 `.venv` 后，不打开界面直接跑核心逻辑：

```
.venv\Scripts\python -c "import core; r=core.analyze_video(r'视频.mp4', params=core.AnalyzeParams(10,15,2,None), log=lambda lvl,msg: print(msg)); print(r)"
```

`AnalyzeParams(灵敏度, 最短镜头长度, 每镜头抽帧数, 输出宽度=None)`；返回的 `AnalyzeResult` 含 `status`（completed/canceled/error）、`scene_count`、`images_saved`、`scenes`（拉片数据）、`json_file`、`audio_file`、`out_dir`、`elapsed`。

## 常见问题

**Q：双击后没看到窗口？**
A：正常情况下会自动弹出独立应用窗口。若未弹出，直接在浏览器访问 `http://127.0.0.1:8765/` 即可（服务在后台运行）。「退出」按钮会停止服务。

**Q：提示无法打开/解码视频？**
A：H.264 编码的 MP4 开箱即用。RMVB / HEVC / MKV 等格式需要 ffmpeg，`imageio-ffmpeg` 已自带 ffmpeg 二进制，通常也能解；个别封装例外可尝试 `winget install ffmpeg` 加入 PATH。

**Q：没有音轨怎么办？**
A：视频本身没有音轨时，日志会提示「音轨提取失败（视频可能没有音轨）」，其余产出不受影响。

**Q：镜头切得不准怎么办？**
A：主要调「灵敏度」。硬切多的素材可降到 5–10；运镜/渐变多的素材适当调高（15–30）。镜头被切得过于细碎时把「最短镜头长度」调大（如 20–30 帧）；切得太少则调小。可以先跑一遍看镜头数是否接近预期，再微调。

**Q：抽出来的帧图太大？**
A：把「输出宽度」选为 1280 或 720，帧图按比例缩小，文件体积大幅下降。

**Q：设置会被记住吗？**
A：会。参数与上次目录保存到脚本目录下的 `config.json`（可随时删除恢复默认）。

## 说明

- 检测原理为帧间内容差异打分（启发式算法），对快速硬切准确度高，对渐变/同场景大运动存在固有局限。
- 本项目由本地工作流整理发布，测试基准：6 段硬切测试视频，阈值 8 全镜头命中（默认阈值已调至 10，日常素材更不易误报）。
