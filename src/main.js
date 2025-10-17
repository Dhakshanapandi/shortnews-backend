import fs from "fs";
import path from "path";
import { scrapeTamil } from "./scrapers/tamil.js";
import { summarizeGroupedNews } from "./services/summarizeNews.js"; // 🧠 Gemini summarizer
import { uploadSummariesToFirestore } from "./services/uploadToFirebase.js"; // 🔥 Firestore uploader

// ✅ Define config path
const configPath = path.resolve("./config/tamil.json");

// ✅ Define output paths
const outputRaw = path.resolve("output/tamil-raw.json");
const outputGrouped = path.resolve("output/tamil-grouped.json");
const outputSummarized = path.resolve("output/tamil-summarized.json");

// 🚀 Helper: group articles by category
function groupByCategory(articles) {
  const grouped = {};
  for (const article of articles) {
    const cat = article.category || "uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(article);
  }
  return grouped;
}

// 🚀 Main function
async function runTamilPipeline() {
  console.log("============================================================");
  console.log("📰 SHORT NEWS APP - SCRAPE → GROUP → GEMINI SUMMARIZE → FIRESTORE UPLOAD (TAMIL)");
  console.log("============================================================\n");

  // 1️⃣ Load configuration
  if (!fs.existsSync(configPath)) {
    console.error("❌ tamil.json config not found!");
    process.exit(1);
  }

  const tamilConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  console.log(`✅ Loaded config for: ${tamilConfig.language}\n`);

  // 2️⃣ Run the Tamil scraper (handles deep content + dedupe)
  console.log("⚙️ Running Tamil Scraper...");
  const articles = await scrapeTamil(tamilConfig);

  // 3️⃣ Save cleaned, deduplicated data
  if (!fs.existsSync("output")) fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync(outputRaw, JSON.stringify(articles, null, 2));
  console.log(`💾 Saved flat list → ${outputRaw}`);

  // 4️⃣ Group by category
  const grouped = groupByCategory(articles);
  fs.writeFileSync(outputGrouped, JSON.stringify(grouped, null, 2));
  console.log(`📦 Saved grouped data → ${outputGrouped}`);

  // 5️⃣ Summarize with Gemini API
  console.log("\n🧠 Starting Gemini summarization...");
  const summarized = await summarizeGroupedNews(grouped, "Tamil");
  fs.writeFileSync(outputSummarized, JSON.stringify(summarized, null, 2));
  console.log(`✨ Summarization completed → ${outputSummarized}`);

  // 6️⃣ Upload to Firestore
  console.log("\n🔥 Uploading summarized news to Firestore...");
  await uploadSummariesToFirestore(summarized, "tamil");

  // 7️⃣ Summary logs
  console.log("------------------------------------------------------------");
  console.log(`🗞️ Total categories processed: ${Object.keys(summarized).length}`);
  console.log("✅ Tamil scraping, summarization & Firestore sync completed successfully!");
  console.log("============================================================\n");
}

// 🏁 Execute
runTamilPipeline().catch((err) => {
  console.error("❌ Fatal error in Tamil pipeline:", err.message);
});
