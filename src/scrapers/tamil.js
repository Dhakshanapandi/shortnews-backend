import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import puppeteer from "puppeteer";
import pLimit from "p-limit";
import { removeDuplicates } from "../utils/removeDuplicates.js";

/**
 * 📰 Tamil Scraper — Dinamalar + Vikatan (All Categories)
 */
export async function scrapeTamil(languageConfig) {
  const allArticles = [];
  const logs = [];

  console.log("🚀 Starting Tamil scraping with deep content...\n");

  const CACHE_PATH = "cache/tamil-urls.json";
  if (!fs.existsSync("cache")) fs.mkdirSync("cache", { recursive: true });
  let cachedUrls = [];
  if (fs.existsSync(CACHE_PATH)) {
    cachedUrls = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    console.log(`📦 Loaded cache — ${cachedUrls.length} URLs`);
  }

  const browser = await getBrowser(); // shared Puppeteer instance
  const limit = pLimit(3); // concurrent deep scrapes

  for (const [category, urls] of Object.entries(languageConfig.categories)) {
    console.log(`📂 Category: ${category}`);
    let categoryArticles = [];

    for (const url of urls) {
      console.log(`   🌐 Fetching from ${url.includes("vikatan") ? "Vikatan" : "Dinamalar"} (${category})`);
      let articles = [];

      try {
        // 👇 Automatic site detection
        if (url.includes("cinema.vikatan.com")) {
          articles = await scrapeVikatanCinema(url, category);
        } else {
          articles = await scrapeDinamalar(url, category);
        }

        const newArticles = articles.filter((a) => !cachedUrls.includes(a.source));

        // Parallel deep scraping
        await Promise.allSettled(
          newArticles.slice(0, 50).map((article) =>
            limit(async () => {
              try {
                if (article.source.includes("vikatan")) {
                  article.content = await scrapeVikatanDeep(article.source);
                } else {
                  article.content = await scrapeDinamalarDeep(article.source, browser);
                }
                console.log(`   📰 Content ✓ ${article.title.slice(0, 40)}...`);
              } catch {
                article.content = "";
                console.warn(`   ⚠️ Content missing for ${article.title.slice(0, 40)}`);
              }
            })
          )
        );

        categoryArticles.push(...newArticles);
        logs.push({ site: url.includes("vikatan") ? "vikatan" : "dinamalar", category, count: newArticles.length, status: "success" });

        if (categoryArticles.length >= 50) break;
      } catch (err) {
        console.error(`   ❌ Scrape error (${category}):`, err.message);
        logs.push({ site: url.includes("vikatan") ? "vikatan" : "dinamalar", category, status: "error", message: err.message });
      }
    }

    categoryArticles = categoryArticles.slice(0, 50);
    allArticles.push(...categoryArticles);
    console.log(`📦 Final count for ${category}: ${categoryArticles.length}\n`);
  }

  // ✅ Deduplicate & Save
  const uniqueArticles = removeDuplicates(allArticles, 0.85);
  if (!fs.existsSync("logs")) fs.mkdirSync("logs", { recursive: true });
  if (!fs.existsSync("output")) fs.mkdirSync("output", { recursive: true });

  fs.writeFileSync("logs/tamil-log.json", JSON.stringify(logs, null, 2));
  fs.writeFileSync("output/tamil-raw.json", JSON.stringify(uniqueArticles, null, 2));

  // ✅ Update Cache
  const newUrls = uniqueArticles.map((a) => a.source);
  const updatedCache = Array.from(new Set([...cachedUrls, ...newUrls]));
  fs.writeFileSync(CACHE_PATH, JSON.stringify(updatedCache, null, 2));

  await closeBrowser();
  console.log(`\n🎯 Tamil scraping done — ${uniqueArticles.length} unique articles`);
  return uniqueArticles;
}

/* ---------------------------------------------------
   🧩 Dinamalar Scraper (All Categories)
--------------------------------------------------- */
async function scrapeDinamalar(url, category) {
  const { data } = await axios.get(url, { headers: { "User-Agent": userAgent() } });
  const $ = cheerio.load(data);
  const articles = [];

  $("div.MuiCard-root").each((_, el) => {
    const link = $(el).find("a[href]").first().attr("href")?.trim();
    const title =
      $(el).find("p.MuiTypography-body1").text().trim() ||
      $(el).find("p.MuiTypography-body2").text().trim();
    const image = $(el).find("img").attr("src") || "";

    if (!title || !link || (image && image.includes("dummy-noimg"))) return;

    const absolute = link.startsWith("http") ? link : "https://www.dinamalar.com" + link;

    articles.push({
      title,
      source: absolute,
      image,
      category,
      language: "tamil",
      publishedAt: new Date().toISOString(),
    });
  });

  console.log(`✅ Dinamalar (${category}): ${articles.length} found`);
  return articles.slice(0, 50);
}

/* ---------------------------------------------------
   🎬 Vikatan Cinema Scraper — Handles All Layouts
--------------------------------------------------- */
async function scrapeVikatanCinema(url, category) {
  const BASE_URL = "https://cinema.vikatan.com";
  const { data } = await axios.get(url, { headers: { "User-Agent": userAgent() } });
  const $ = cheerio.load(data);
  const articles = [];

  // All major link types on cinema.vikatan.com
  const selectors = [
    "a.styles-m__first-big-card__SeFeF",
    "a.styles-m__first-big-card__1Sbya",
    "a.styles-m__line-separater__1JUZK",
    "a.card-with-image-zoom"
  ];

  $(selectors.join(",")).each((_, el) => {
    const link = $(el).attr("href")?.trim();
    if (!link) return;

    // Extract title from h3 or aria-label
    const title =
      $(el).find("h3").text().trim() ||
      $(el).attr("aria-label")?.replace(/^Read full story:\s*/i, "").trim() ||
      "";

    // Extract image (varies by card type)
    let image =
      $(el).find("img").attr("data-src-base") ||
      $(el).find("img").attr("data-src") ||
      $(el).find("img").attr("src") ||
      "";

    if (!title || title.length < 5) return;

    const absolute = link.startsWith("http") ? link : `${BASE_URL}${link}`;
    if (image.startsWith("/")) image = `${BASE_URL}${image}`;

    articles.push({
      title,
      source: absolute,
      image,
      category,
      language: "tamil",
      publishedAt: new Date().toISOString(),
    });
  });

  console.log(`✅ Vikatan Cinema: ${articles.length} found`);
  return articles.slice(0, 50);
}


/* ---------------------------------------------------
   🧠 Deep Scrapers
--------------------------------------------------- */
let sharedBrowser = null;

async function getBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return sharedBrowser;
}

async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

// 🧠 Dinamalar Deep Scraper
async function scrapeDinamalarDeep(url, browser) {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("p.css-1oiyee6", { timeout: 10000 }).catch(() => {});
    const html = await page.content();
    const $ = cheerio.load(html);

    const paragraphs = [];
    $("p.css-1oiyee6").each((_, el) => {
      const text = $(el).text().trim();
      if (text) paragraphs.push(text);
    });

    const seen = new Set();
    const cleanParagraphs = paragraphs
      .filter((p) => {
        const t = p.replace(/\s+/g, " ").trim();
        if (t.length < 40) return false;
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .map((p) => p.replace(/\.css-[a-z0-9\-{}@:;().]+/gi, "").trim());

    const content = cleanParagraphs.join(" ").trim();
    await page.close();
    return cleanTamilContent(content);
  } catch (error) {
    console.warn(`⚠️ Dinamalar deep scrape failed: ${error.message}`);
    await page.close();
    return "";
  }
}

// 🎬 Vikatan Deep Scraper
async function scrapeVikatanDeep(url) {
  try {
    const { data } = await axios.get(url, { headers: { "User-Agent": userAgent() }, timeout: 20000 });
    const $ = cheerio.load(data);
    let content = "";

    $("div.article-content p, div.qt-content p, article p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 40) content += text + " ";
    });

    return cleanTamilContent(content);
  } catch (err) {
    console.warn(`⚠️ Vikatan deep scrape failed: ${err.message}`);
    return "";
  }
}

/* ---------------------------------------------------
   🧰 Utils
--------------------------------------------------- */
function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
}

function cleanTamilContent(content) {
  if (!content) return "";
  return content
    .replace(/ADVERTISEMENT/g, "")
    .replace(/இதைப் படித்தீர்களா\?.*/g, "")
    .replace(/திங்கள்|செவ்வாய்|புதன்|வியாழன்|வெள்ளி|சனி|ஞாயிறு/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ---------------------------------------------------
   🏁 Standalone Runner
--------------------------------------------------- */
if (process.argv[1].includes("tamil.js")) {
  const config = JSON.parse(fs.readFileSync("src/config/tamil.json", "utf8"));
  scrapeTamil(config)
    .then(() => console.log("✅ Tamil scraping completed successfully."))
    .catch((err) => console.error("❌ Tamil scraping failed:", err));
}
