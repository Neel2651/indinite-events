import "server-only";
import { createAuth } from "@indinite/auth";
import { nextCookies } from "better-auth/next-js";

/** Staff auth for server components, server actions and route handlers. */
export const auth = createAuth([nextCookies()]);
