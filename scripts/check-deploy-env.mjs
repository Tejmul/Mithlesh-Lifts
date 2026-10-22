// Runs first in `npm run vercel-build`: stops a deploy that would point at a laptop database.
const url = process.env.DATABASE_URL ?? "";
const problems = [];
if (!url) problems.push("DATABASE_URL is not set.");
else if (/localhost|127\.0\.0\.1/.test(url)) problems.push("DATABASE_URL points to localhost (your laptop's database), which Vercel can't reach.");
if (url && /aivencloud\.com/.test(url) && !process.env.DATABASE_CA_CERT) problems.push("DATABASE_CA_CERT is missing (Aiven's CA certificate).");
if (problems.length) {
  console.error("\nDeploy settings need fixing:\n- " + problems.join("\n- "));
  console.error("\nFix: Vercel → Settings → Environment Variables → paste the values from mithlesh/.env, then redeploy.\n");
  process.exit(1);
}
console.log("Deploy settings look right.");
