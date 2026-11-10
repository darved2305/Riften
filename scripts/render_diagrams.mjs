import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 780 },
  });
  for (const name of ["architecture", "change-to-action"]) {
    const svg = await fs.readFile("docs/assets/" + name + ".svg");
    await page.setContent(
      '<html><body style="margin:0"><img style="width:1280px;display:block" src="data:image/svg+xml;base64,' +
        svg.toString("base64") +
        '"></body></html>',
    );
    await page.locator("img").evaluate(async (img) => {
      if (!img.complete)
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
    });
    console.log(
      name,
      await page
        .locator("img")
        .evaluate((i) => ({
          loaded: i.complete,
          width: i.naturalWidth,
          height: i.naturalHeight,
        })),
    );
    await page.screenshot({
      path: "data/" + name + "-preview.png",
      timeout: 60000,
    });
  }
} finally {
  await browser.close();
}
