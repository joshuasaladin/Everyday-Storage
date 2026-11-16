/**
 * Fill an EMPTY local database with example data, for trying things out and
 * for the browser test (npm run smoke). Refuses to run in production or on a
 * database that already has units, so it can never mix with real records.
 *
 *   DATA_DIR=./data-example npm run seed:example
 *   DATA_DIR=./data-example npm run dev
 *
 * Sign in as owner@example.test (or manager@ / staff@) with password example-pass1.
 */
import { getDb, DATA_DIR } from "@/lib/db";
import { EXAMPLE_PASSWORD, seedExample } from "@/lib/seed";

if (process.env.NODE_ENV === "production" || process.env.RENDER) {
  console.error("Refusing to load example data in production.");
  process.exit(1);
}
const db = getDb();
if (db.num(`SELECT COUNT(*) FROM units`) > 0 || db.num(`SELECT COUNT(*) FROM renters`) > 0) {
  console.error(`${DATA_DIR} already has records. Example data only goes into an empty database — point DATA_DIR at a new folder.`);
  process.exit(1);
}
seedExample(db);
console.log(`Example data loaded into ${DATA_DIR}. Sign in as owner@example.test / ${EXAMPLE_PASSWORD}.`);
