/**
 * 抓取一个 URL：HTML→纯文本、PDF→抽文本（unpdf）、其余按 text 透传。
 * 可选走代理。给模型用，输出做长度上限截断。
 */

const MAX_TEXT_CHARS = 200000;

/** 简单 HTML→纯文本：去 script/style，去标签，折叠空白，解常见实体。 */
export function htmlToText(html) {
  const noScript = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");
  const noTags = noScript.replace(/<[^>]+>/g, " ");
  return noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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
