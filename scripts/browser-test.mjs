import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const demo = JSON.parse(await fs.readFile("data/demo-workspace.json", "utf8"));
const wid = demo.workspace_id;
const out = "research/verification";
await fs.mkdir(out, { recursive: true });
const get = async (p) => {
  const r = await fetch("http://127.0.0.1:8000/api" + p);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const failures = [];
const observations = [];
let qaWorkspaceId;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) failures.push({ status: r.status(), url: r.url() });
});
await page.addInitScript(
  ({ wid }) => {
    if (!sessionStorage.getItem("qa-initialized")) {
      localStorage.setItem("riften-workspace", wid);
      localStorage.setItem("riften-page", "Home");
      sessionStorage.setItem("qa-initialized", "true");
    }
  },
  { wid },
);
const nav = async (name) => {
  await page.locator("nav").getByTitle(name, { exact: true }).click();
  await expect(page.locator(".breadcrumbs strong")).toHaveText(name);
};
const shot = async (name) => {
  await page.screenshot({ path: out + "/" + name + ".png", fullPage: true });
};
async function submit(name) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 });
}
try {
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".connection")).toHaveText("Nugen aligned model");
  await expect(page.locator(".assessment-card")).toHaveCount(1);
  await shot("01-home");
  await nav("Regulatory sources");
  await page
    .getByRole("button", { name: /Existing provisions, official annex/ })
    .click();
  await expect(page.locator(".source-inspector h2")).toHaveText(
    "Existing provisions, official annex",
  );
  await page.locator(".passage summary").first().click();
  await expect(page.locator(".passage").first()).toContainText("fifteen lakh");
  await shot("02-source-evidence");
  await nav("Change explorer");
  await expect(page.locator(".change-tabs>button")).toHaveCount(4);
  await expect(page.locator(".interpretation")).toContainText(
    "Verified textual finding",
  );
  await expect(page.locator(".interpretation")).toContainText(
    "Independent checks flagged",
  );
  await shot("03-change-comparison");
  const exportedEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export", exact: true }).click();
  const exported = await exportedEvent;
  await exported.saveAs(out + "/exported-assessment.json");
  const bundle = JSON.parse(
    await fs.readFile(out + "/exported-assessment.json", "utf8"),
  );
  if (!bundle.changes?.length || !bundle.old_version?.content_hash)
    throw new Error("Incomplete export");
  let assessments = await get("/assessments?workspace_id=" + wid);
  let assessment = await get("/assessments/" + assessments[0].id);
  const change = assessment.changes[0];
  await nav("Impact graph");
  let entities = await get("/entities?workspace_id=" + wid);
  for (const [kind, name, description] of [
    [
      "policy",
      "Synthetic deposit product policy",
      "Demonstration policy tied to RBI domestic individual deposit clause. Test configuration only.",
    ],
    [
      "process",
      "Synthetic term deposit onboarding",
      "Demonstration process for individual domestic term deposit opening.",
    ],
    [
      "control",
      "Synthetic withdrawal facility check",
      "Demonstration control checks withdrawal evidence for applicable synthetic products.",
    ],
  ]) {
    if (entities.some((e) => e.name === name)) continue;
    await page.getByRole("button", { name: "Add entity", exact: true }).click();
    await page.getByLabel("Type", { exact: true }).selectOption(kind);
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Description / evidence").fill(description);
    await page.getByLabel("Synthetic demonstration entity").check();
    await submit("Save");
  }
  await nav("Impact replay");
  entities = await get("/entities?workspace_id=" + wid);
  if (!entities.some((e) => e.kind === "record")) {
    await page
      .getByRole("button", { name: "Import records", exact: true })
      .click();
    await page
      .getByLabel("CSV or JSON file")
      .setInputFiles(path.join(root, "public/sample-records.csv"));
    await page.getByLabel("These are synthetic test records").check();
    await submit("Validate & import");
  }
  await page.getByRole("button", { name: /Organizational records/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await shot("04-record-import");
  await nav("Impact graph");
  entities = await get("/entities?workspace_id=" + wid);
  let graph = await get("/graph?workspace_id=" + wid);
  const nodeFor = (e) => graph.nodes.find((n) => n.entity_id === e.id);
  const requirement = graph.nodes.find((n) => n.change_id === change.id);
  const policy = nodeFor(
    entities.find((e) => e.name === "Synthetic deposit product policy"),
  );
  const processNode = nodeFor(
    entities.find((e) => e.name === "Synthetic term deposit onboarding"),
  );
  const control = nodeFor(
    entities.find((e) => e.name === "Synthetic withdrawal facility check"),
  );
  const links = [
    [requirement, policy],
    [policy, processNode],
    [processNode, control],
    ...entities
      .filter((e) => e.kind === "record" && e.external_id !== "SYN-007")
      .map((e) => [control, nodeFor(e)]),
  ];
  for (const [source, target] of links) {
    if (
      graph.edges.some(
        (e) => e.source_id === source.id && e.target_id === target.id,
      )
    )
      continue;
    await page
      .getByRole("button", { name: "Map dependency", exact: true })
      .first()
      .click();
    await page.getByLabel("Upstream source").selectOption(source.id);
    await page.getByLabel("Dependent object").selectOption(target.id);
    await page
      .getByLabel("Evidence and relationship rationale")
      .fill(
        "Synthetic demonstration mapping, explicitly reviewed for this test dataset. " +
          source.label +
          " governs " +
          target.label +
          ". No real business dependency is asserted.",
      );
    await submit("Save verified relationship");
  }
  await page.getByLabel("Filter graph by kind").selectOption("all");
  await expect(page.locator(".react-flow__node")).toHaveCount(
    graph.nodes.length,
  );
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Synthetic withdrawal facility check" })
    .click();
  await expect(page.locator(".inspector")).toContainText(
    "Synthetic demonstration mapping",
  );
  await shot("05-impact-graph");
  await nav("Impact replay");
  await page
    .getByRole("button", { name: "Replay workspace", exact: true })
    .click();
  if (!change.requirement?.verified) {
    await page
      .getByRole("button", { name: "Verify rule", exact: true })
      .click();
    await page
      .getByLabel("Independent verification note")
      .fill(
        "Synthetic assessment only. Checked the official RBI annex section 7(a)(iii): inclusive INR 1,500,000 to INR 10,000,000 boundary; mandatory premature withdrawal. Applicability flag explicitly belongs to the test fixture. No retroactivity assumption or real legal determination.",
      );
    await page
      .getByLabel(
        "I have reviewed this rule against the source and confirmed its scope.",
      )
      .check();
    await submit("Approve bounded rule");
  }
  await page.getByRole("button", { name: "Run replay", exact: true }).click();
  await expect(page.locator(".replay-counts")).toContainText(
    "2requires review",
    { timeout: 15000 },
  );
  await expect(page.locator("tbody tr")).toHaveCount(7);
  await expect(page.locator(".replay-counts")).toContainText("1evidence gap");
  await expect(page.locator(".replay-counts")).toContainText("1unconnected");
  await shot("06-replay-results");
  const before = await get("/replays?workspace_id=" + wid);
  await page.reload();
  await expect(page.locator(".replay-counts")).toContainText(
    "2requires review",
  );
  observations.push({
    replay: before[0].id,
    records: 7,
    requires_review: 2,
    evidence_gaps: 1,
    unconnected: 1,
  });
  const existingTasks = await get("/tasks?workspace_id=" + wid);
  if (!existingTasks.length) {
    await page
      .locator("tbody tr")
      .filter({ hasText: "Synthetic individual deposit A" })
      .getByRole("button", { name: "Review", exact: true })
      .click();
    await page
      .getByLabel("Action", { exact: true })
      .fill("Review synthetic deposit SYN-001");
    await page
      .getByLabel("Supporting evidence / next steps")
      .fill(
        "Synthetic replay flags a newly triggered withdrawal-facility condition. Review demonstrates task linkage only; no real deposit or legal closure is asserted.",
      );
    await submit("Create action");
  }
  await nav("Reviews & actions");
  await page
    .locator("tbody tr")
    .filter({ hasText: "Review synthetic deposit SYN-001" })
    .click();
  await page
    .getByRole("button", { name: "Update status & add comment" })
    .click();
  await page.getByLabel("Status", { exact: true }).selectOption("in_progress");
  await page
    .getByLabel("Reviewer comment / completion evidence")
    .fill(
      "Synthetic demonstration review in progress. Source and replay inputs inspected. Real institution, contract dates and applicability would need independent verification.",
    );
  await submit("Record update");
  await expect(page.locator(".inspector")).toContainText("in progress");
  await shot("07-review-action");
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page
    .getByLabel("Ask Riften Assistant")
    .fill(
      "Quote the stored RBI source sentence containing one crore. Cite its section ID.",
    );
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.locator(".assistant-panel .answer")).toBeVisible({
    timeout: 100000,
  });
  await shot("08-assistant");
  await page.getByRole("button", { name: "Close assistant" }).click();
  await nav("Model Lab");
  await expect(page.locator(".deployment")).toContainText("DEPLOYED");
  await shot("09-model-lab");
  await page
    .getByRole("button", { name: "Request history", exact: true })
    .click();
  await expect(page.locator("tbody")).toContainText("succeeded");
  await nav("Overview");
  await expect(page.locator(".metrics-strip")).toContainText("7");
  await shot("10-overview");
  for (const [width, height] of [
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await nav("Home");
    await shot("11-home-" + width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    );
    if (overflow) throw new Error("Horizontal viewport overflow at " + width);
    await nav("Change explorer");
    await shot("12-change-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav("Home");
  await page
    .getByLabel("Regulatory analysis command")
    .fill("Compare these two policy versions.");
  await page.getByRole("button", { name: "Run command" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Compare regulatory versions",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // An empty QA workspace exercises onboarding and actual file uploads separately from the showcase.
  await page.getByLabel("Workspace", { exact: true }).selectOption("new");
  await page
    .getByLabel("Organization or workspace name")
    .fill("Isolated browser QA " + new Date().toISOString());
  await submit("Create workspace");
  qaWorkspaceId=await page.getByLabel('Workspace',{exact:true}).inputValue();
  await expect(page.locator(".recent-empty")).toBeVisible();
  await nav("Regulatory sources");
  await page
    .locator("main")
    .getByRole("button", { name: "Import source", exact: true })
    .click();
  await page.getByLabel("Source title").fill("Synthetic browser QA policy");
  await page.getByLabel("Version label").fill("QA original");
  await page.getByLabel("Original document").setInputFiles({
    name: "original.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "1. Test records require evidence when amount is at most 10.\n\n2. Test-only fixture. Not regulatory content.",
    ),
  });
  await submit("Import document");
  await expect(page.locator(".source-inspector")).toContainText("QA original");
  await page.getByRole("button", { name: "Add version", exact: true }).click();
  await page.getByLabel("Version label").fill("QA updated");
  await page.getByLabel("Original document").setInputFiles({
    name: "updated.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "1. Test records require evidence when amount is at most 20.\n\n2. Test-only fixture. Not regulatory content.",
    ),
  });
  await submit("Import document");
  await page
    .getByRole("button", { name: "Compare versions", exact: true })
    .click();
  await page
    .getByLabel("Original version")
    .selectOption({ label: "Synthetic browser QA policy / QA original" });
  await page
    .getByLabel("Updated version")
    .selectOption({ label: "Synthetic browser QA policy / QA updated" });
  await submit("Create comparison");
  await expect(page.locator(".change-tabs>button")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".clause-content").first()).toContainText(
    "at most 10",
  );
  await page.getByLabel("Workspace", { exact: true }).selectOption(wid);
  await nav("Home");
  await fs.writeFile(
    out + "/browser-report.json",
    JSON.stringify(
      { errors, failures, observations, verified_at: new Date().toISOString() },
      null,
      2,
    ),
  );
  if (errors.length || failures.length)
    throw new Error(JSON.stringify({ errors, failures }));
  console.log("Browser journeys passed. Screenshots and report: " + out);
} catch (e) {
  await shot("failure");
  await fs.writeFile(
    out + "/browser-failure.json",
    JSON.stringify({ error: String(e), errors, failures }, null, 2),
  );
  throw e;
} finally {
  if(qaWorkspaceId)await fetch('http://127.0.0.1:8000/api/workspaces/'+qaWorkspaceId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:true})});
  await browser.close();
}
