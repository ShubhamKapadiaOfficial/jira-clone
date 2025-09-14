import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import 'server-only';

import { AUTH_COOKIE } from '@/features/auth/constants';

type AdditionalContext = {
  Variables: {
    supabase: ReturnType<typeof createServerClient>;
    user: User;
  };
};

export const sessionMiddleware = createMiddleware<AdditionalContext>(async (ctx, next) => {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return getCookie(ctx, name);
        },
        set(name: string, value: string, options: any) {
          // This is handled by the auth endpoints
        },
        remove(name: string, options: any) {
          // This is handled by the logout endpoint
        },
      },
    }
  );

  const session = getCookie(ctx, AUTH_COOKIE);

  if (!session) {
    return ctx.json({ error: 'Unauthorized.' }, 401);
  }

  // Verify the session with Supabase
  const { data: { user }, error } = await supabase.auth.getUser(session);

  if (error || !user) {
    return ctx.json({ error: 'Unauthorized.' }, 401);
  }

  ctx.set('supabase', supabase);
  ctx.set('user', user);

  await next();
});
