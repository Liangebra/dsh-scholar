# dsh-scholar

DeepSeek Harness（DSH）科研工具套件：给 agent 补上「检索论文 / 读论文全文 / 查期刊」三个工具。

## 提供的工具

| 工具 | 作用 | 数据源 |
|---|---|---|
| `arxiv_search` | 搜 arXiv 论文（标题/作者/摘要/abs+pdf 链接） | 官方免费 arXiv API，无需 key |
| `scholar_fetch` | 按 URL 抓全文：HTML→纯文本、**PDF→抽文本** | 任意 HTTP(S)，可选代理 |
| `journal_lookup` | 查期刊元数据（出版社/ISSN/发文量/被引/引用指标） | OpenAlex API，无需 key |

## 为什么做这个

DSH 原生的 `web_fetch` 只能抓 HTML/纯文本，**不支持 PDF**、也**不带代理**；对科研场景（读 arXiv PDF、查期刊）是明显缺口。`dsh-scholar` 补上这两点。

## 安装

```bash
dsh plugin add dsh-scholar
```

装完在组合里自动插入一个 host 行，三个工具默认全开。需要代理（国内访问境外论文站）时，编辑 profile 的 `cordis.patch.yml`，给 `scholar` 行加：

```yaml
- id: scholar
  config:
    proxy: http://127.0.0.1:7890   # 你的 Clash 混合端口；留空 = 直连
```

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `arxiv` / `fetch` / `journal` | `true` | 三个工具的开关 |
| `proxy` | `""` | HTTP(S) 出网代理 URL，空 = 直连 |
| `fetchTimeoutMs` | `30000` | 单次请求超时预算 |
| `arxivMaxResults` | `8` | arXiv 单次最多返回条数 |

## 注意

- **`journal_lookup` 返回的 OpenAlex 引用指标不是官方 JCR 影响因子**。判断分区/影响因子请以官方（JCR / 中科院分区）为准。
- 本项目采用 MIT 许可证；对第三方数据源（arXiv / OpenAlex）的调用请遵守其使用条款与频率限制。
- PDF 抽取质量取决于 PDF 本身（扫描版/公式密集的排版可能抽得差，公式会碎）；数学公式以 LaTeX 源为最佳。

## 开发

```bash
npm install      # 装 unpdf / undici
npm link         # 本地联调
```

代码是纯 ESM JavaScript，无需构建。工具注册范式对齐 `@deepseek-ai/dsh-tool-web`。
