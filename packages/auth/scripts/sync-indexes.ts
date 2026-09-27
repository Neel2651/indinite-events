/** Create Better Auth's MongoDB indexes. Also run by seed-users. */
import { MongoClient } from "mongodb";
import { ensureAuthIndexes } from "../src/indexes";

const client = new MongoClient(process.env.MONGODB_URI!);
await ensureAuthIndexes(client.db());
console.log("Auth indexes synced");
await client.close();
