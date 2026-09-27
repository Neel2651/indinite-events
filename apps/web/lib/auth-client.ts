"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { ac, roles } from "@indinite/auth/roles";

export const authClient = createAuthClient({ plugins: [organizationClient({ ac, roles })] });
