# OCR Review Workbench

OCR Review Workbench 是一个通用 OCR 对照校对工具，适合数学、物理、天文学等公式密集文档的 OCR Markdown 校对。

核心链路是：

```text
原文 PDF / 图片
-> OCR Markdown 结果，例如 MinerU middle.json
-> 页面级对照与 block 级校对
-> Mathpix / 人工编辑 draft patch
-> accepted patch
-> accepted 校正稿预览和下载
```

当前部署包只包含 OCR 校对工作台需要的前端、OCR core、PDF 预览、Mathpix 块级识别兼容接口和 OCR correction API。

## 功能范围

- 打开 `/ocr-compare.html`
- 上传 PDF / 图片并生成页面预览
- 上传 MinerU `_middle.json`
- 可选上传 `content_list.json`
- 当前页整页校对画布
- 块级 Mathpix 校正
- 人工编辑 patch
- accepted 校正稿预览和下载

不绑定某个特定项目，也不包含聊天、RAG 知识库、模型测试台页面、可视化展厅和离线批处理流水线。

## 本地启动

```bash
cd "/Users/Min369/Documents/同步空间/Manju/AIProjects/UnivModel/ocr-review-workbench"
python3 -m pip install -r requirements.txt
APP_HOST=127.0.0.1 APP_PORT=8789 python3 -m backend.ocr_server
```

访问：

```text
http://127.0.0.1:8789/ocr-compare.html
```

也可以使用脚本：

```bash
./start_ocr_workbench.sh
```

## Zeabur 部署

服务来源选择：

```text
GitHub
```

服务类型选择：

```text
Python
```

Build Command：

```bash
pip install -r requirements.txt
```

Start Command：

```bash
APP_HOST=0.0.0.0 APP_PORT=$PORT python3 -m backend.ocr_server
```

Health Check：

```text
/api/health
```

部署后访问：

```text
https://你的-zeabur域名/ocr-compare.html
https://你的-zeabur域名/api/health
```

## 环境变量

最小配置：

```bash
APP_HOST=0.0.0.0
MINERU_BASE_URL=https://mineryou.cpolar.top
MINERU_CONVERT_PATH=/api/convert
```

启用 Mathpix 块级校正：

```bash
MATHPIX_APP_ID=你的_app_id
MATHPIX_APP_KEY=你的_app_key
MATHPIX_MODEL=mathpix-text
MATHPIX_TIMEOUT_SECONDS=60
```

启用 LLM OCR correction API：

```bash
OCR_CORRECTION_PROVIDER=openai-compatible
OCR_CORRECTION_BASE_URL=你的_base_url
OCR_CORRECTION_API_KEY=你的_key
OCR_CORRECTION_MODEL=模型名
OCR_CORRECTION_PATH=/v1/chat/completions
```

如果使用云雾兼容通道：

```bash
OCR_CORRECTION_PROVIDER=yunwu-openai
YUNWU_API_BASE_URL=你的_base_url
YUNWU_API_KEY=你的_key
YUNWU_GPT55_MODEL=gpt-5.5
YUNWU_CHAT_PATH=/v1/chat/completions
```

## 测试

```bash
node scripts/test_ocr_compare_frontend.js
node frontend/ocr-core/tests/test_block_parser.js
node frontend/ocr-core/tests/test_patch_model.js
node frontend/ocr-core/tests/test_patch_merger.js
node frontend/ocr-core/tests/test_mathpix_render_pipeline.js
node frontend/ocr-core/tests/test_render_validator.js
node frontend/ocr-core/tests/test_mathpix_to_target_markdown_adapter.js
node scripts/test_ocr_core_fixtures.js
node frontend/ocr-core/tests/test_math_delimiter_normalizer.js
node -e "const fs=require('fs'); new Function(fs.readFileSync('frontend/ocr-compare.js','utf8')); console.log('ocr frontend ok')"
```

## GitHub 初始化

```bash
git init
git add .
git commit -m "Initial OCR review workbench deploy package"
git branch -M main
git remote add origin 你的GitHub仓库地址
git push -u origin main
```
