import { existsSync } from "node:fs";
import { chromium } from "playwright";

export function installedChromiumExecutable(): string {
  const candidates = [
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ];
  const result = candidates.find((path) => existsSync(path));
  if (result === undefined) throw new Error("A Chromium executable is required for scraper fixture tests.");
  return result;
}
