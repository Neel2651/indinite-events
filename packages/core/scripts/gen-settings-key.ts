import { randomBytes } from "node:crypto";

// Key for encrypting settings stored in the database (Meta Conversions API tokens). Keep it secret; one per server.
console.log(`SETTINGS_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
