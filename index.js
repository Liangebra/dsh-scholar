/**
 * dsh-scholar — DeepSeek Harness 科研工具套件
 *
 * 三个模型工具：
 *   - arxiv_search   检索 arXiv（免费官方 API）
 *   - scholar_fetch  抓取 URL：HTML→文本、PDF→抽文本，可选代理
 *   - journal_lookup 查期刊元数据（OpenAlex 免费 API）
 *
 * 用法：`dsh plugin add dsh-scholar`，然后在 cordis.patch.yml 里按需配 proxy。
 * 详见 README.md。
 */
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { searchArxiv } from "./lib/arxiv.js";
import { fetchResource } from "./lib/fetch.js";
import { lookupJournal } from "./lib/openalex.js";

export const name = "scholar";
export const inject = ["tools", "systemPrompt"];

export const Config = z.object({
  arxiv: z.boolean().default(true),
  fetch: z.boolean().default(true),
  journal: z.boolean().default(true),
  proxy: z.string().default(""),
  fetchTimeoutMs: z.number().default(30000),
  arxivMaxResults: z.number().default(8)
});

function assertPositiveInteger(label, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`scholar: ${label} must be a positive integer`);
  }
}

/** 通用：把 execute 结果渲染成 markdown 文本块。 */
function renderMarkdown(text) {
  return [{ type: "text", text }];
}

function applyArxivSearch(ctx, cfg) {
  ctx.systemPrompt.section({
    name: "tool:arxiv_search",
    order: 200,
    text: "Use arxiv_search to find papers on arXiv (free, no key). It returns titles, authors, abstracts, and abs/PDF links. Cite the arXiv links as markdown links."
  });
  ctx.tools.register(defineTool({
    name: "arxiv_search",
    description: "Search arXiv for papers. Returns title, authors, abstract, and abs/PDF links for each result.",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "arXiv search query. Supports field prefixes (all:, ti:, au:) and AND/OR, e.g. 'ti:elliptic curves AND cat:math.NT'."
      },
      max_results: {
        type: "number",
        description: "Maximum results to return (bounded by the deployment's arxivMaxResults)."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", required: true },
          totalResults: { type: "number", required: true },
          results: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                authors: { type: "array", items: { type: "string" } },
                published: { type: "string" },
                id: { type: "string" },
                absUrl: { type: "string" },
                pdfUrl: { type: "string" }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        const lines = [];
        lines.push(`arXiv search for "${value.query}" — ${value.totalResults} total results.`);
        for (const r of value.results) {
          lines.push(`\n### ${r.title}\n- Authors: ${(r.authors || []).join(", ") || "—"}\n- Published: ${r.published || "—"}\n- [abs](${r.absUrl}) · [pdf](${r.pdfUrl})\n- ${r.summary}`);
        }
        if (value.results.length === 0) lines.push("\nNo results. Try a broader query.");
        return renderMarkdown(lines.join("\n"));
      }
    },
    timeoutMs: cfg.fetchTimeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const maxResults = Math.min(args.max_results ?? cfg.arxivMaxResults, cfg.arxivMaxResults);
      return searchArxiv({ query: args.query, maxResults, proxy: cfg.proxy, signal: exec.signal });
    }
  }));
}

function applyScholarFetch(ctx, cfg) {
  ctx.systemPrompt.section({
    name: "tool:scholar_fetch",
    order: 201,
    text: "Use scholar_fetch to retrieve a paper or web page by URL. It decodes HTML pages to text and extracts text from PDFs. Use it after arxiv_search/web_search to read full content. Cite the URL as a markdown link."
  });
  ctx.tools.register(defineTool({
    name: "scholar_fetch",
    description: "Fetch a URL (web page or PDF) and return its text content. Handles HTML→text and PDF→text extraction.",
    parameters: {
      url: {
        type: "string",
        required: true,
        description: "The HTTP(S) URL to fetch (e.g. an arXiv abs page, its /pdf link, or a journal page)."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          statusCode: { type: "number", required: true },
          contentType: { type: "string" },
          text: { type: "string", required: true },
          truncated: { type: "boolean", required: true }
        }
      },
      render: (_args, value) => {
        const header = `Fetched ${value.url} (HTTP ${value.statusCode}, ${value.contentType || "unknown"})`;
        const footer = value.truncated ? "\n\n(Content truncated. Fetch a more specific URL or section for the full text.)" : "";
        return renderMarkdown(header + "\n\n" + value.text + footer);
      }
    },
    timeoutMs: cfg.fetchTimeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return fetchResource({ url: args.url, proxy: cfg.proxy, signal: exec.signal });
    }
  }));
}

function applyJournalLookup(ctx, cfg) {
  ctx.systemPrompt.section({
    name: "tool:journal_lookup",
    order: 202,
    text: "Use journal_lookup to look up a journal's metadata and citation metrics via OpenAlex. OpenAlex citation metrics are NOT the official JCR impact factor; verify against the official source before making decisions."
  });
  ctx.tools.register(defineTool({
    name: "journal_lookup",
    description: "Look up journal/venue metadata and OpenAlex citation metrics by name or ISSN.",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "Journal name or ISSN to look up, e.g. 'Annals of Mathematics' or '0003-486X'."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", required: true },
          count: { type: "number", required: true },
          venues: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                displayName: { type: "string" },
                publisher: { type: "string" },
                issn: { type: "string" },
                issnL: { type: "string" },
                worksCount: { type: "number" },
                citedByCount: { type: "number" },
                twoYrMeanCitedness: { type: "number" },
                hIndex: { type: "number" },
                homepage: { type: "string" }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        const lines = [`Journal lookup for "${value.query}" — ${value.count} match(es).`];
        for (const v of value.venues) {
          lines.push(`\n### ${v.displayName}\n- Publisher: ${v.publisher || "—"}\n- ISSN: ${v.issn || "—"}\n- Works: ${v.worksCount}, Cited by: ${v.citedByCount}, 2yr-mean-citedness: ${v.twoYrMeanCitedness ?? "n/a"}, h-index: ${v.hIndex ?? "n/a"}\n- ${v.homepage || ""}`);
        }
        if (value.venues.length === 0) lines.push("\nNo matching venue. Try the ISSN or a shorter name.");
        lines.push("\n(Note: OpenAlex citation metrics are not the official JCR impact factor.)");
        return renderMarkdown(lines.join("\n"));
      }
    },
    timeoutMs: cfg.fetchTimeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return lookupJournal({ query: args.query, proxy: cfg.proxy, signal: exec.signal });
    }
  }));
}

export function apply(ctx, config) {
  assertPositiveInteger("fetchTimeoutMs", config.fetchTimeoutMs);
  assertPositiveInteger("arxivMaxResults", config.arxivMaxResults);
  if (config.arxiv) applyArxivSearch(ctx, config);
  if (config.fetch) applyScholarFetch(ctx, config);
  if (config.journal) applyJournalLookup(ctx, config);
}
