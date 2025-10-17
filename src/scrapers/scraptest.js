import axios from "axios";
import * as cheerio from "cheerio";

async function scrapeDinamalarPureContent(url) {
  try {
    // 1️⃣ Fetch HTML page
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    // 2️⃣ Load into cheerio
    const $ = cheerio.load(data);

    // 3️⃣ Select ONLY the article <p> tags with class "css-1oiyee6"
    const paragraphs = [];
    $("p.css-1oiyee6").each((_, el) => {
      const text = $(el).text().trim();
      if (text) paragraphs.push(text);
    });

    // 4️⃣ Clean and deduplicate
    const seen = new Set();
    const cleanParagraphs = paragraphs
      .filter((p) => {
        const trimmed = p.replace(/\s+/g, " ").trim();
        if (trimmed.length < 40) return false;
        if (seen.has(trimmed)) return false;
        seen.add(trimmed);
        return true;
      })
      .map((p) => p.replace(/\.css-[a-z0-9\-{}@:;().]+/gi, "").trim()); // remove stray CSS strings

    // 5️⃣ Join final article text
    const content = cleanParagraphs.join("\n\n").trim();

    if (!content) {
      console.log("⚠️ No valid content found. Structure may have changed.");
      return;
    }

    console.log("✅ Article Content Only:\n");
    console.log(content);
  } catch (err) {
    console.error("❌ Error scraping Dinamalar:", err.message);
  }
}

// 🔗 Example URL
const url =
  "https://www.dinamalar.com/news/sports-cricket/cricketwestindiestourofindiatestdelhi/4057471";

scrapeDinamalarPureContent(url);
