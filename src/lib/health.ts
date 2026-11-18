import type { Bookmark } from '../types';

/**
 * 书签健康检查：
 * - 静态统计（无标签 / 无备注）
 * - 死链检测：对 http(s) 书签发起受限并发请求，检测能否连通。
 *
 * 说明：扩展页面发起跨域请求受 CORS 限制，无法读取响应状态码，
 * 因此采用 `mode: 'no-cors'` —— 请求成功（opaque）视为可达，
 * 网络层失败（DNS 失败、断网、超时）视为不可达。结果为可达性参考，
 * 不能区分 404 与 200。
 */

export interface LinkCheckResult {
  id: string;
  url: string;
  ok: boolean;
  /** 失败原因（超时 / 无法连接） */
  error?: string;
}

function checkOne(url: string, timeoutMs = 8000): Promise<{ ok: boolean; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    method: 'GET',
    mode: 'no-cors',
    redirect: 'follow',
    signal: ctrl.signal,
    credentials: 'omit',
  })
    .then(() => ({ ok: true }))
    .catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error && err.name === 'AbortError' ? '超时' : '无法连接',
    }))
    .finally(() => clearTimeout(timer));
}

/** 受限并发批量检测，通过 onProgress 汇报进度 */
export async function checkLinks(
  bookmarks: Bookmark[],
  onProgress: (done: number, total: number) => void,
  concurrency = 6,
): Promise<LinkCheckResult[]> {
  const targets = bookmarks.filter((b) => /^https?:\/\//i.test(b.url));
  const queue = [...targets];
  const results: LinkCheckResult[] = [];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const bm = queue.shift();
      if (!bm) break;
      const r = await checkOne(bm.url);
      results.push({ id: bm.id, url: bm.url, ...r });
      done += 1;
      onProgress(done, targets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}

/** 静态健康统计 */
export function healthStats(bookmarks: Bookmark[]) {
  return {
    total: bookmarks.length,
    noTags: bookmarks.filter((b) => b.tags.length === 0).length,
    noDesc: bookmarks.filter((b) => !b.description.trim()).length,
  };
}
