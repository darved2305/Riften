import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const { workspace_id: wid } = JSON.parse(
  await fs.readFile("data/demo-workspace.json", "utf8"),
);
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (e) => {
  if (e.type() === "error") errors.push(e.text());
});
await page.addInitScript((wid) => {
  localStorage.setItem("riften-workspace", wid);
  localStorage.setItem("riften-page", "Home");
}, wid);
try {
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".connection")).toHaveText("Nugen aligned model");
  await page.getByRole("button", { name: "Select aligned model" }).click();
  await expect(page.locator(".model-menu")).toContainText(
    "Qwen/Qwen2.5-1.5B-Instruct",
  );
  await page.screenshot({
    path: "research/verification/13-model-selection.png",
  });
  await page.locator(".model-menu").getByRole("button").first().click();
  await expect(page.locator(".model-menu")).toHaveCount(0);
  await page.locator("nav").getByTitle("Impact graph", { exact: true }).click();
  await page.getByLabel("Search graph").fill("Synthetic individual deposit A");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.locator(".react-flow__node").click();
  await expect(page.locator(".inspector h2")).toHaveText(
    "Synthetic individual deposit A",
  );
  await page.screenshot({ path: "research/verification/14-graph-search.png" });
  await page.getByLabel("Search graph").fill("");
  await page.getByRole("button", { name: "Fit view" }).click();
  await expect(page.locator(".react-flow__minimap-node")).toHaveCount(16);
  await page.screenshot({ path: "research/verification/15-graph-fit.png" });
  await page.locator("nav").getByTitle("Model Lab", { exact: true }).click();
  await page.getByRole("button", { name: "Evaluation", exact: true }).click();
  await expect(page.locator(".evaluation-metrics tbody tr")).toHaveCount(2);
  await page.screenshot({
    path: "research/verification/16-evaluation.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("nav").getByTitle("Home", { exact: true }).click();
  await expect(page.getByLabel("Mobile workspace")).toBeVisible();
  await page.screenshot({
    path: "research/verification/17-mobile-workspace.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    )
  )
    throw new Error("Mobile overflow");
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log(
    "Final UI controls passed: model dropdown, graph search and fit, evaluation, mobile workspace. No console errors.",
  );
} finally {
  await browser.close();
}
