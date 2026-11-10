import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { url, wid, bypass } = JSON.parse(raw);
if (!bypass) throw new Error("Missing private deployment test access");
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [],
  failed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400)
    failed.push({ status: r.status(), path: new URL(r.url()).pathname });
});
await page.route(url + "/**", (route) =>
  route.continue({
    headers: {
      ...route.request().headers(),
      "x-vercel-protection-bypass": bypass,
    },
  }),
);
try {
  await page.goto(url + "/?workspace=" + wid);
  await expect(page).toHaveTitle("Riften");
  await expect(page.locator(".connection")).toHaveText("Nugen aligned model", {
    timeout: 60000,
  });
  await expect(page.locator(".assessment-card")).toHaveCount(1);
  await page.screenshot({ path: "docs/assets/workspace.png", fullPage: true });
  const lab = await page.evaluate(
    async (wid) =>
      fetch("/api/model-lab?workspace_id=" + wid).then((r) => r.json()),
    wid,
  );
  if (!lab.deployments.some((d) => d.status === "DEPLOYED"))
    throw new Error("Missing migrated model deployment");
  const sources = await page.evaluate(
    async (wid) =>
      fetch("/api/sources?workspace_id=" + wid).then((r) => r.json()),
    wid,
  );
  const original = await page.evaluate(async (id) => {
    const r = await fetch("/api/versions/" + id + "/original");
    return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
  }, sources[0].versions[0].id);
  if (original.status !== 200 || original.bytes < 1000)
    throw new Error("Hosted original source missing");
  await page
    .locator("nav")
    .getByTitle("Impact replay", { exact: true })
    .click();
  await expect(page.locator(".replay-counts")).toContainText(
    "2requires review",
  );
  await page.screenshot({ path: "docs/assets/replay.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".replay-counts")).toContainText(
    "2requires review",
    { timeout: 30000 },
  );
  const inference = await page.evaluate(async (wid) => {
    const r = await fetch("/api/model-lab/inference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: wid,
        prompt: "Reply with: Riften is connected.",
      }),
    });
    return { status: r.status, body: await r.json() };
  }, wid);
  if (inference.status !== 200 || inference.body.run?.status !== "succeeded")
    throw new Error("Hosted aligned inference failed");
  await page.locator("nav").getByTitle("Model Lab", { exact: true }).click();
  await expect(page.locator(".model-project h2")).toHaveText(
    "Riften domain alignment",
  );
  await page.screenshot({ path: "docs/assets/model-lab.png", fullPage: true });
  if (errors.length || failed.length)
    throw new Error(JSON.stringify({ errors, failed }));
  await fs.writeFile(
    "docs/hosted-verification.json",
    JSON.stringify(
      {
        url,
        verified_at: new Date().toISOString(),
        workspace_name: "Riften research workspace",
        assessments: 1,
        original_source_bytes: original.bytes,
        aligned_model: inference.body.run.model_id,
        inference_status: inference.body.run.status,
        inference_answer: inference.body.answer,
        refresh_persistence: true,
        console_errors: errors,
        failed_requests: failed,
      },
      null,
      2,
    ),
  );
  console.log(
    "Hosted browser checks passed: Riften branding, migrated workspace, original source bytes, replay persistence, deployed model and live aligned inference.",
  );
} finally {
  await browser.close();
}
