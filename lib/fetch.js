/**
 * 抓取一个 URL：HTML→纯文本（结构化，保留段落/代码块/表格）、PDF→抽文本（unpdf）、
 * 其余按 text 透传。可选走代理。给模型用，输出做长度上限截断。
 *
 * HTML→纯文本的改进（相对 v0.1.0）：
 *   - 全量 HTML 实体解码（he，覆盖命名 + 数字实体；原版只解 5 个）
 *   - 块级结构保留：段落/标题/列表/表格按行输出，不再压成一行
 *   - <pre> 代码块以 ``` 围栏保留原始缩进（围栏外才折叠空白）
 *   - 丢弃 nav/header/footer/aside 等样板区域
 *   - 提取 <title> 作为首行标题
 *   - 表格单元格 ' | ' 分隔、行换行
 */

import he from "he";

const MAX_TEXT_CHARS = 200000;

const { decode } = he;

/** 移除样板区域（nav/header/footer/aside）与 script/style 等整块。 */
function stripBoilerplate(html) {
  return html
    .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ");
}

/** 结构化 HTML→纯文本：保留标题/段落/代码块/表格结构。 */
export function htmlToText(html) {
  let title = "";
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) title = decode(titleMatch[1]).replace(/\s+/g, " ").trim();

  const text = decode(
    stripBoilerplate(html)
      .replace(/<\s*pre\b[^>]*>/gi, "\n```\n")
      .replace(/<\/\s*pre\s*>/gi, "\n```\n")
      .replace(/<\s*(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\s*(td|th)\s*[^>]*>/gi, " | ")
      .replace(/<\s*\/?\s*(tr|p|div|h[1-6]|li|ul|ol|table|blockquote|section|article|main|figure|figcaption|dl|dt|dd|fieldset)\b[^>]*>/gi, () => "\n")
      .replace(/<[^>]+>/g, " "),
  );

  // 围栏感知的空白归一：``` 围栏内代码块先按公共缩进 dedent 再原样保留，
  // 围栏外折叠空白（段落/标题等）。
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let inFence = false;
  let code = [];
  let blank = false;
  const flushCode = () => {
    if (code.length === 0) return;
    const nonBlank = code.filter((l) => l.trim() !== "");
    let min = Infinity;
    for (const l of nonBlank) {
      const m = /^[ \t]*/.exec(l);
      if (m[0].length < min) min = m[0].length;
    }
    if (Number.isFinite(min) && min > 0) code = code.map((l) => (l.trim() === "" ? l : l.slice(min)));
    out.push(...code);
    code = [];
  };
  for (const raw of lines) {
    if (raw.trim() === "```") {
      if (inFence) flushCode();
      inFence = !inFence;
      out.push("```");
      blank = false;
      continue;
    }
    if (inFence) {
      code.push(raw.replace(/[ \t]+$/, ""));
      blank = false;
      continue;
    }
    const line = raw.replace(/[ \t]+$/, "").trim();
    if (line === "") {
      if (!blank && out.length > 0) out.push("");
      blank = true;
      continue;
    }
    out.push(line);
    blank = false;
  }
  if (inFence) flushCode();
  while (out.length > 0 && out[out.length - 1] === "") out.pop();

  return title ? `# ${title}\n\n${out.join("\n")}` : out.join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} [opts.proxy]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{url:string, statusCode:number, contentType:string, text:string, truncated:boolean}>}
 */
export async function fetchResource({ url, proxy = "", signal }) {
  const { fetchWithProxy } = await import("./arxiv.js");
  const res = await fetchWithProxy(url, { proxy, signal });
  const statusCode = res.status;
  const contentType = res.headers.get("content-type") || "";
  let text = "";

  if (statusCode < 200 || statusCode >= 300) {
    // 非 2xx：把状态码报出来，而不是抛错
    return { url: res.url || url, statusCode, contentType, text: `HTTP ${statusCode}`, truncated: false };
  }

  if (/application\/pdf/i.test(contentType)) {
    const { extractText } = await import("unpdf");
    const data = new Uint8Array(await res.arrayBuffer());
    const out = await extractText(data, { mergePages: true });
    text = out.text;
  } else {
    const raw = await res.text();
    text = /text\/html/i.test(contentType) ? htmlToText(raw) : raw;
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
  return { url: res.url || url, statusCode, contentType, text, truncated };
}
