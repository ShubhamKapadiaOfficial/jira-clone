import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { AUTH_COOKIE } from '@/features/auth/constants';
import { signInFormSchema, signUpFormSchema } from '@/features/auth/schema';
import { createAdminClient } from '@/lib/supabase';
import { sessionMiddleware } from '@/lib/session-middleware';

const app = new Hono()
  .get(
    '/',
    zValidator(
      'query',
      z.object({
        userId: z.string().trim().min(1),
        secret: z.string().trim().min(1),
      }),
    ),
    async (ctx) => {
      const { userId, secret } = ctx.req.valid('query');

      const { account } = await createAdminClient();
      const session = await account.createSession(userId, secret);

      setCookie(ctx, AUTH_COOKIE, session.secret, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 30,
      });

      return ctx.redirect(process.env.NEXT_PUBLIC_APP_BASE_URL);
    },
  )
  .get('/current', sessionMiddleware, (ctx) => {
    const user = ctx.get('user');

    return ctx.json({ data: user });
  })
  .post('/login', zValidator('json', signInFormSchema), async (ctx) => {
    const { email, password } = ctx.req.valid('json');

    const supabase = await createAdminClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return ctx.json({ error: error.message }, 400);
    }

    if (data.session) {
      setCookie(ctx, AUTH_COOKIE, data.session.access_token, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return ctx.json({ success: true });
  })
  .post('/register', zValidator('json', signUpFormSchema), async (ctx) => {
    const { name, email, password } = ctx.req.valid('json');

    const supabase = await createAdminClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
        },
      },
    });

    if (error) {
      return ctx.json({ error: error.message }, 400);
    }

    if (data.session) {
      setCookie(ctx, AUTH_COOKIE, data.session.access_token, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return ctx.json({ success: true });
  })
  .post('/logout', sessionMiddleware, async (ctx) => {
    const supabase = ctx.get('supabase');

    deleteCookie(ctx, AUTH_COOKIE);
    await supabase.auth.signOut();

    return ctx.json({ success: true });
  });

export default app;
