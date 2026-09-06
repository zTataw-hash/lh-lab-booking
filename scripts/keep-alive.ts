// Node.js 24 can run this TypeScript file directly; no npm dependencies needed.
// Uses the existing read-only database RPC, not Storage admin APIs or fake tables.
import { pathToFileURL } from 'node:url';

export async function keepAlive({ env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_PUBLISHABLE_KEY 环境变量');
  const project = new URL(url);
  if (project.protocol !== 'https:' || !project.hostname.endsWith('.supabase.co') || project.username || project.password) throw new Error('请使用 Supabase HTTPS 项目 URL');
  if (key.startsWith('sb_secret_')) throw new Error('请使用 publishable/anon 公钥，不要使用 secret key');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(`${project.origin}/rest/v1/rpc/zyc_api`, {
        method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'read', args: {}, token: '' }),
        signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      if (!response.ok) {
        const error = new Error(`Supabase 返回 HTTP ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const data = await response.json();
      if (data?.ok !== true || !data.bookings || typeof data.bookings !== 'object' || Array.isArray(data.bookings) || !data.docs?.info) {
        const error = new Error('数据库接口未返回有效成功结果，请检查初始化 SQL 和项目状态');
        error.retryable = false;
        throw error;
      }
      console.log(`[${new Date().toISOString()}] 数据库只读检查成功（第 ${attempt} 次尝试）`);
      // Never log keys, reservation names, purposes, or the RPC response body.
      return;
    } catch (error) {
      if (error.retryable === false || attempt === 3) throw error;
      console.warn(`第 ${attempt} 次连接未成功，准备重试`);
      await sleep(attempt * 2000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  keepAlive().catch(() => {
    console.error('保活检查失败：请检查网络、项目是否暂停、环境变量和 zyc_api 接口。');
    process.exitCode = 1;
  });
}
