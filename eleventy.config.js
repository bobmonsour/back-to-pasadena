import "dotenv/config";
import { execSync } from "child_process";

export default function (eleventyConfig) {
  // Sync stubs + pull mutable state before every build
  eleventyConfig.on("eleventy.before", async () => {
    try {
      execSync("node scripts/sync-kv.js", { stdio: "inherit" });
    } catch (err) {
      console.error("sync-kv failed:", err.message);
    }
    try {
      execSync("node scripts/pull-state.js", { stdio: "inherit" });
    } catch (err) {
      console.error("pull-state failed:", err.message);
    }
    try {
      execSync("node scripts/refresh-status.js", { stdio: "inherit" });
    } catch (err) {
      console.error("refresh-status failed:", err.message);
    }
  });

  eleventyConfig.addGlobalData("googleMapsKey", process.env.GOOGLE_MAPS_API_KEY || "");
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/images");

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
}
