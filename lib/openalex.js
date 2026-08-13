/**
 * 期刊查证：调 OpenAlex API（api.openalex.org）。
 * 按名称/ISSN 检索 source（期刊/会议），返回元数据。
 *
 * 注意：OpenAlex 的引用指标不是官方 JCR 影响因子。
 */

const OPENALEX_SOURCES = "https://api.openalex.org/sources";

function projectVenue(v) {
  return {
    id: v.id,
    displayName: v.display_name,
    publisher: v.host_organization_name || v.publisher || "",
    issn: Array.isArray(v.issn) ? v.issn.join(", ") : v.issn_l || "",
    issnL: v.issn_l || "",
    worksCount: v.works_count ?? 0,
    citedByCount: v.cited_by_count ?? 0,
    ...(v.summary_stats?.["2yr_mean_citedness"] != null
      ? { twoYrMeanCitedness: v.summary_stats["2yr_mean_citedness"] }
      : {}),
    ...(v.summary_stats?.h_index != null ? { hIndex: v.summary_stats.h_index } : {}),
    homepage: v.homepage_url || ""
  };
}

/**
 * @param {object} opts
 * @param {string} opts.query   期刊名或 ISSN
 * @param {string} [opts.proxy]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{query:string, count:number, venues:Array}>}
 */
export async function lookupJournal({ query, proxy = "", signal }) {
  const { fetchWithProxy } = await import("./arxiv.js");
  const q = encodeURIComponent(query.trim());
  const url = `${OPENALEX_SOURCES}?search=${q}&per_page=10`;
  const res = await fetchWithProxy(url, { proxy, signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenAlex returned HTTP ${res.status}`);
  const data = await res.json();
  const venues = (data.results || []).map(projectVenue);
  return { query: query.trim(), count: data.meta?.count ?? venues.length, venues };
}
