const databaseUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];

if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error(
    "CLOUDMARKUP_TEST_DATABASE_URL is required for the dedicated PostgreSQL integration suite.",
  );
}
