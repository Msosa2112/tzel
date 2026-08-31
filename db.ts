import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

let url = process.env.TURSO_DATABASE_URL || "";
if (url.startsWith("libsql://")) {
  url = url.replace("libsql://", "https://");
}
const authToken = process.env.TURSO_AUTH_TOKEN || "";

if (!url) {
  console.warn("[DB WARNING] TURSO_DATABASE_URL is not set in environment variables.");
}

export const db = createClient({
  url,
  authToken,
});
