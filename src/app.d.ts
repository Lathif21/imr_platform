import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '$lib/domain';
import type { AuthUser } from '$lib/server/auth';

declare global {
  namespace App {
    interface Locals {
      /**
       * Request-scoped PostgREST client. Every query runs under the caller's
       * RLS. Only `.from()` and `.rpc()` exist on it — see hooks.server.ts;
       * auth goes through `$lib/server/auth`.
       */
      supabase: SupabaseClient;
      /**
       * The session token, already verified in `hooks.server.ts`. Null when
       * there is no valid session.
       */
      session: string | null;
      user: AuthUser | null;
      /**
       * Read from `profiles`, for UI shaping only. Authorization is RLS —
       * see CLAUDE.md invariant 1. Never branch on this to permit a write.
       */
      role: UserRole | null;
      fullName: string | null;
    }
  }
}

export {};
