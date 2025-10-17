import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import pLimit from "p-limit";
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CACHE_PATH = "cache/tamil-summaries.json";

console.log("🔑 OpenAI Key:", OPENAI_API_KEY ? "✅ Loaded" : "❌ Missing");

if (!fs.existsSync("cache")) fs.mkdirSync("cache", { recursive: true });
let summaryCache = {};
if (fs.existsSync(CACHE_PATH)) {
  try {
    summaryCache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    console.log(`📦 Cache loaded (${Object.keys(summaryCache).length} entries)`);
  } catch {
    summaryCache = {};
  }
}

/* ---------------------------------------------------
   ⚙️ Helpers
--------------------------------------------------- */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanTitle(title = "") {
  return title
    .replace(/[0-9]+.*$/, "")
    .replace(/["“”]/g, "")
    .replace(/[:!;,.]+$/, "")
    .replace(/(மணி.*முன்|hour.*ago)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanContent(text = "") {
  return text
    .replace(/(hour\(s\)\s*ago.*$)/gi, "")
    .replace(/(Updated.*|Published.*|Posted.*|புதுப்பிக்கப்பட்டது.*)/gi, "")
    .replace(/([0-9]+ ?மணி(யா)?களுக்கு முன்)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countTamilWords(text) {
  return (text.match(/[\u0B80-\u0BFF]+/g) || []).length;
}

/* ---------------------------------------------------
   🏷️ Detect News Source
--------------------------------------------------- */
function detectSource(url = "") {
  const domain = url.toLowerCase();
  if (domain.includes("dinamalar")) return "Dinamalar";
  if (domain.includes("vikatan")) return "Cinema Vikatan";
  if (domain.includes("dailythanthi")) return "Daily Thanthi";
  if (domain.includes("thehindu")) return "The Hindu Tamil";
  if (domain.includes("oneindia")) return "OneIndia Tamil";
  if (domain.includes("maalaimalar")) return "Maalaimalar";
  return "Unknown";
}

/* ---------------------------------------------------
   🧩 Local summarizer (fallback)
--------------------------------------------------- */
function localSummarizer(article) {
  const text = cleanContent(article.content || "");
  const sentences = text
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const summary = sentences.slice(0, 3).join(". ").trim();
  const title = sentences[0]?.split(" ").slice(0, 5).join(" ") || "செய்தி புதுப்பிப்பு";
  return { title: cleanTitle(title), summary };
}

/* ---------------------------------------------------
   🔁 Safe GPT Call with Retry + Quota Check
--------------------------------------------------- */
async function safeGPTCall(fn, retries = 4) {
  try {
    return await fn();
  } catch (e) {
    const status = e.response?.status;
    const message = e.response?.data?.error?.message || e.message;

    if (status === 429 && message.includes("quota")) {
      console.error("\n❌ OpenAI quota exhausted — check billing:");
      console.error("👉 https://platform.openai.com/account/billing\n");
      process.exit(1);
    }

    if (status === 429 && retries > 0) {
      console.warn("⚠️ Rate limit hit — backing off...");
      const wait = (5 - retries) * 20000 + Math.random() * 5000;
      console.log(`⏳ Waiting ${Math.round(wait / 1000)}s before retry…`);
      await sleep(wait);
      return safeGPTCall(fn, retries - 1);
    }

    console.error("❌ GPT Error:", message);
    throw e;
  }
}

/* ---------------------------------------------------
   🧠 GPT Tamil Summarizer (5 Tamil words + 300 chars)
--------------------------------------------------- */
async function summarizeWithGPT(article) {
  const cleanText = cleanContent(article.content);
  const prompt = `
You are a professional Tamil newspaper editor.

Generate a Tamil headline and summary for the news below.

🎯 Rules:
- Headline: exactly 5 meaningful Tamil words forming a natural, complete news headline.
  (உதாரணம்: "சென்னையில் இன்று தங்கம் விலை உயர்வு")
- தலைப்பு: ஐந்து தமிழ் சொற்களாக மட்டுமே இருக்க வேண்டும்; ஒவ்வொரு சொல்லும் பொருள் கொண்டதாகவும், முழுமையான செய்தி வாக்கியமாகவும் இருக்க வேண்டும்.
- No English, no numbers, no time info (e.g., "11 மணி", "hours ago").
- Summary: within 300 Tamil characters, must end as a full sentence.
- Tone must sound like professional newspaper writing.
- Avoid emojis, English, and unnecessary punctuation.

Format exactly like this:
தலைப்பு: ...
சுருக்கம்: ...

News article:
${cleanText.slice(0, 3500)}
`;

  try {
    const res = await safeGPTCall(() =>
      axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 700,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 240000,
        }
      )
    );

    let text = res.data?.choices?.[0]?.message?.content || "";
    if (!text.trim()) return localSummarizer(article);

    const titleMatch = text.match(/தலைப்பு[:：]\s*(.+?)(?=சுருக்கம்|$)/i);
    const summaryMatch = text.match(/சுருக்கம்[:：]\s*(.+)$/i);

    let title = cleanTitle(titleMatch ? titleMatch[1] : article.title);
    let summary = summaryMatch ? summaryMatch[1].trim() : "";
    if (!summary) throw new Error("Empty GPT summary");

    // 🔹 Clean & clip summary to ≤300 chars
    summary = summary.replace(/\s+/g, " ").replace(/[“”"]/g, "").trim();
    if (summary.length > 300) {
      let trimmed = summary.slice(0, 300);
      const lastPunc = Math.max(
        trimmed.lastIndexOf("。"),
        trimmed.lastIndexOf("."),
        trimmed.lastIndexOf("!"),
        trimmed.lastIndexOf("?")
      );
      if (lastPunc > 200) trimmed = trimmed.slice(0, lastPunc + 1);
      summary = trimmed.trim();
    }
    if (!/[.!?。…]$/.test(summary)) summary += "。";

    // 🔹 Strict title validation
    title = cleanTitle(title);
    let wordCount = countTamilWords(title);

    if (wordCount !== 5) {
      console.warn(`⚠️ Title invalid (${wordCount} Tamil words) — regenerating...`);
      const rePrompt = `
Rewrite only the Tamil headline below into exactly 5 meaningful Tamil words.
It must read like a professional Tamil newspaper headline.
No numbers, English, or time info.

Original headline: "${title}"
Article: ${cleanText.slice(0, 1000)}
`;
      const reRes = await safeGPTCall(() =>
        axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o",
            messages: [{ role: "user", content: rePrompt }],
            temperature: 0.3,
            max_tokens: 100,
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        )
      );
      const reTitle = cleanTitle(reRes.data?.choices?.[0]?.message?.content || title);
      const reCount = countTamilWords(reTitle);
      if (reTitle && reCount === 5) title = reTitle;
      else if (reCount > 5) title = reTitle.split(" ").slice(0, 5).join(" ");
    }

    return { title, summary };
  } catch (e) {
    console.error("⚠️ GPT summarization failed:", e.message);
    return localSummarizer(article);
  }
}

/* ---------------------------------------------------
   🚀 Summarization Loop (with batching)
--------------------------------------------------- */
export async function summarizeGroupedNews(groupedData, language = "Tamil") {
  const summarized = {};
  const limit = pLimit(3); // 🧩 Up to 3 GPT calls in parallel

  console.log(`\n🚀 Starting Batched Tamil Summarization (≤300 chars)…`);

  for (const [category, articles] of Object.entries(groupedData)) {
    console.log(`\n🧠 Category: ${category} (${articles.length} articles)…`);
    summarized[category] = [];

    // 🧩 Prepare summarization tasks
    const tasks = articles.map((article, idx) =>
      limit(async () => {
        if (summaryCache[article.source]) {
          console.log(`⚡ [Cache] ${article.title.slice(0, 35)}...`);
          return {
            ...article,
            title: summaryCache[article.source].title,
            summary: summaryCache[article.source].summary,
            sourceName: detectSource(article.source),
            language,
          };
        }

        console.log(`📰 [${idx + 1}/${articles.length}] Summarizing: ${article.title.slice(0, 40)}...`);
        const result = await summarizeWithGPT(article);

        const sourceName = detectSource(article.source);
        const enriched = { ...article, ...result, sourceName, language };

        summaryCache[article.source] = result;
        fs.writeFileSync(CACHE_PATH, JSON.stringify(summaryCache, null, 2));

        console.log(`✅ Done: ${result.title} (${sourceName})`);
        return enriched;
      })
    );

    // 🧩 Run batch of tasks
    const results = await Promise.all(tasks);
    summarized[category].push(...results);

    console.log(`✅ Completed ${category} (${results.length} articles)`);
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(summaryCache, null, 2));
  console.log(`💾 Cache updated → ${Object.keys(summaryCache).length} entries`);
  return summarized;
}
