import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AsyncLocalStorage } from 'async_hooks';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface RequestCtx {
  client: SupabaseClient;
  token: string | null;
}

const storage = new AsyncLocalStorage<RequestCtx>();

function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Bọc handler của 1 API route: mọi lệnh gọi `supabase.from(...)` bên trong (kể cả ở các
// hàm module-level khác trong cùng file) sẽ tự dùng client đã gắn access token của người
// gọi request này — để auth.uid() resolve đúng trong RLS phía Supabase.
export function withRequestSupabase<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const token = bearerToken(req);
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return storage.run({ client, token }, fn);
}

// Dùng thay `import { supabase } from '@/lib/supabase'` trong các API route — chỉ cần
// đổi đường dẫn import, không cần sửa các lệnh `supabase.from(...)` đã có sẵn.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error('lib/serverAuth: "supabase" dùng ngoài withRequestSupabase() — bọc handler trước.');
    }
    const value = (ctx.client as any)[prop];
    return typeof value === 'function' ? value.bind(ctx.client) : value;
  },
});

// app_users.id của người gọi request hiện tại (null nếu chưa đăng nhập / token không hợp lệ /
// chưa có hồ sơ app_users tương ứng). Dùng cho các route owner-scoped (Trợ lý nhắc việc).
export async function getCallerAppUserId(): Promise<string | null> {
  const ctx = storage.getStore();
  if (!ctx?.token) return null;
  const { data, error } = await ctx.client.auth.getUser(ctx.token);
  if (error || !data.user) return null;
  const { data: profile } = await ctx.client
    .from('app_users')
    .select('id')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();
  return profile?.id ?? null;
}

export function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
