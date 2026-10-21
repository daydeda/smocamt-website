import "dotenv/config";

const isPglite = process.env.DB_TYPE === "pglite";

if (isPglite && process.env.NODE_ENV === "production") {
  throw new Error("DB_TYPE 'pglite' is not allowed in production environment");
}

async function test() {
  try {
    let result: unknown;
    if (isPglite) {
      console.log("📦 PGlite active. Testing connection...");
      const { PGlite } = await import("@electric-sql/pglite");
      const client = new PGlite("./.pglite-data");
      result = await client.query("SELECT 1 as connected");
      await client.close();
    } else {
      if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL environment variable is required");
      }
      const { default: postgres } = await import("postgres");
      const sql = postgres(process.env.DATABASE_URL);
      result = await sql`SELECT 1 as connected`;
      await sql.end();
    }
    console.log("Database connection successful:", result);
    process.exit(0);
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
}

test();
