import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient(options?: { signal: AbortSignal }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured");
  }

  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      ...(options ? { global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        try {
          return await fetch(input, {
            ...init,
            signal: init?.signal ? AbortSignal.any([init.signal, options.signal]) : options.signal,
          })
        } catch (error) {
          if (options.signal.aborted) throw new DOMException('Read deadline exceeded', 'AbortError')
          throw error
        }
      } } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    },
  );
}
