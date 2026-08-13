/**
 * arXiv 搜索：调官方免费 API（export.arxiv.org，返回 Atom XML），
 * 用轻量正则抽取条目，避免引入重量级 XML 依赖。
 *
 * 注意：arXiv API 对查询语法很敏感，query 直接透传给 search_query，
 * 支持 all:xxx / ti:xxx / au:xxx 等字段前缀，多词用 AND/OR。
 */

const ARXIV_API = "https://export.arxiv.org/api/query";

/** 把 Atom 里转义的实体还原成文本（只处理最常见的几个）。 */
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 从一段 <entry>…</entry> 里抽取一个条目。 */
function parseEntry(block) {
  const get = (tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? decodeEntities(m[1].trim()) : "";
  };
  // 多个 <author><name>…</name></author>
  const authors = [];
  const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let am;
  while ((am = authorRe.exec(block)) !== null) authors.push(decodeEntities(am[1].trim()));

  const id = get("id"); // 形如 https://arxiv.org/abs/2501.00001v2
  const abs = id.replace("/abs/", "/abs/");
  const pdf = id.replace("/abs/", "/pdf/");
  return {
    title: get("title"),
    summary: get("summary").replace(/\s+/g, " "),
    authors,
    published: get("published"),
    id,
    absUrl: abs,
    pdfUrl: pdf
  };
}

/**
 * @param {object} opts
 * @param {string} opts.query   arXiv search_query
 * @param {number} [opts.maxResults]
 * @param {string} [opts.proxy]  代理 URL，空则直连
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{query:string, totalResults:number, results:Array}>}
 */
export async function searchArxiv({ query, maxResults = 8, proxy = "", signal }) {
  const q = encodeURIComponent(query.trim());
  const url = `${ARXIV_API}?search_query=${q}&start=0&max_results=${Math.max(1, maxResults)}`;
  const res = await fetchWithProxy(url, { proxy, signal, headers: { Accept: "application/atom+xml" } });
  if (!res.ok) throw new Error(`arXiv API returned HTTP ${res.status}`);
  const xml = await res.text();

  // totalResults 从 <opensearch:totalResults>N</opensearch:totalResults>
  const total = (xml.match(/<opensearch:totalResults[^>]*>([\s\S]*?)<\/opensearch:totalResults>/) || [])[1];
  const totalResults = total ? parseInt(total.trim(), 10) : 0;

  const results = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) results.push(parseEntry(m[1]));

  return { query: query.trim(), totalResults, results };
}

/** 带可选代理的 fetch（undici ProxyAgent 直连 Node 全局 fetch）。 */
export async function fetchWithProxy(url, { proxy = "", signal, headers = {} } = {}) {
  const opts = { signal, headers };
  if (proxy) {
    const { ProxyAgent } = await import("undici");
    opts.dispatcher = new ProxyAgent(proxy);
  }
  return fetch(url, opts);
}
