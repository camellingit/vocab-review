# 单词闯关 · 灯具英语

多邻国风格的英语词汇复习网页。纯静态站点（原生 HTML/CSS/JS，无构建步骤），手机优先，界面全中文。

## 内容
- `public/` 网站本体：`index.html`、`app.css`、`app.js`、`words.json`（词库）、`audio/`（预生成的英音朗读，含 `index.json` 映射）
- `scripts/transform.py` 把 Notion 导出的原始行转换成 `public/words.json`
- `scripts/gen_audio.py` 根据 `words.json` 用微软神经语音 en-GB-RyanNeural（edge-tts，无需任何密钥）生成 MP3
- `.github/workflows/pages.yml` 推送到 `main` 后自动把 `public/` 部署到 GitHub Pages

页面只使用相对路径，部署在任意子路径（如 `https://<用户名>.github.io/<仓库名>/`）都能正常工作。

## 功能
- 每课 10 题：看英文选中文、看中文选英文、例句填空；干扰项优先取同类别
- 答错的题会在本课末尾再出一次；有对错动画和音效、连对、XP、每日目标（30 XP）、连续天数和完成页
- 间隔重复：每个词有熟练度 0–5，并记录最近 20 次答题对错；新词和错词出现得更多
- 错题本 = 答错过、熟练度还不到 3 的词
- 点击朗读：优先播放预生成的英音男声 Ryan（en-GB-RyanNeural）；找不到文件或播放失败时，回退到浏览器自带的 speechSynthesis（优先 en-GB）。手机上由用户点击触发播放，兼容 iOS Safari
- 类别多选、词表页（搜索、筛选、例句、用法、逐句朗读）
- 「刷新词库」：重新加载 `words.json`（带防缓存参数），显示词数和同步时间

## 进度保存与备份
全部进度（XP、连续天数、今日目标、单词熟练度和答题记录、错题本、类别选择、音效开关）都存在浏览器的 localStorage 里，刷新或重新打开都不会丢；换设备或清除浏览器数据会丢。
- **导出进度**：下载一个 JSON 文件；同时显示文本，可一键复制（iPhone 下载不方便时用这个）
- **导入进度**：选择文件或粘贴文本，校验格式后选择
  - **合并**：同一个词取最近练习的那份记录，XP 取较大值，连续天数取较新的那份
  - **覆盖**：完全替换当前进度，会再确认一次

## 更新词库（Notion → words.json → 语音）
数据来源：Notion 数据库「英语复习词库」（只读）。每天同步按下面的顺序执行，先转换词库，再生成（或增量更新）语音，最后部署：
1. 分页读取全部行（每次 100 行，按 `createdTime, url` 排序，加 `OFFSET` 直到取完），字段为：
   `url, createdTime, "英文词 / 短语", "中文", "类别", "例句或用法", "材质英文通用名"`。
   先用 `COUNT(*)` 拿到总数，最后核对行数是否一致。
2. 把所有行合并成一个 JSON 数组，例如 `raw/notion_export.json`（已加入 .gitignore，不进仓库）。
3. `python3 scripts/transform.py raw/notion_export.json public/words.json`
4. `/home/box/tts-venv/bin/python scripts/gen_audio.py`
   （在已安装 `edge-tts` 的环境中也可直接运行 `python scripts/gen_audio.py`。增量：已有音频会跳过，词库里不再出现的旧文件会删除。）
5. 提交并推送 `public/words.json` 和 `public/audio/`，GitHub Pages 会自动重新部署；在网页里点「刷新词库」即可看到新词和对应发音。

转换规则：`例句或用法` 里每行 `例：English（中文）` 解析成 `{en, zh}`，`用法：…` 存为 `usage`，其他行存为 `notes`。每个例句会尝试找出目标词（支持简单词形变化、`A / B` 这种多种写法，并忽略括号里的内容），找到就记为 `hit`，填空题用它出题。

## 本地预览
```
cd public && python3 -m http.server 8787
# 打开 http://127.0.0.1:8787/
```

## 部署到 GitHub Pages
推送到 GitHub 仓库的 `main` 分支即可。工作流会通过 `configure-pages`（`enablement: true`）自动开启 Pages，部署来源是 GitHub Actions。如果仓库设置不允许自动开启，就到 Settings → Pages → Source 手动选「GitHub Actions」。
