"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { ac, roles } from "@indinite/auth/roles";
import { retryAfterText } from "@indinite/core";

export const authClient = createAuthClient({ plugins: [organizationClient({ ac, roles })] });

/**
 * Rate-limit wording for Better Auth calls (1 Oct 2026): pass `retry.fetchOptions` to a call, then
 * `retry.message()` says "Too many attempts. Try again in 45 seconds." from its X-Retry-After header.
 */
export function retryTracker() {
  let seconds = 0;
  return {
    fetchOptions: {
      onError: (ctx: { response: Response }) => {
        seconds = Number(ctx.response.headers.get("X-Retry-After") ?? 0) || 0;
      },
    },
    message: () => `Too many attempts. ${retryAfterText(Date.now() + Math.max(1, seconds || 60) * 1000)}`,
  };
}
