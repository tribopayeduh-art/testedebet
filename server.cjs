/**
 * Cloud Run / Production entry point
 * Boots the server and handles unhandled rejections safely.
 */
const path = require("path");
const fs = require("fs");
const url = require("url");

process.on("unhandledRejection", (reason) => {
  console.warn("[Process Warning] Unhandled Rejection:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.warn("[Process Warning] Uncaught Exception:", err?.message || err);
});

async function boot() {
  try {
    let serverPath = path.resolve(process.cwd(), "server/index.mjs");
    if (!fs.existsSync(serverPath)) {
      serverPath = path.resolve(__dirname, "../server/index.mjs");
    }
    if (!fs.existsSync(serverPath)) {
      serverPath = path.resolve(__dirname, "server/index.mjs");
    }

    const fileUrl = url.pathToFileURL(serverPath).href;
    await import(fileUrl);
  } catch (err) {
    console.error("[Boot Error] Failed to boot server/index.mjs:", err);
    process.exit(1);
  }
}

boot();
