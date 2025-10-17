// src/services/uploadToFirebase.js
import { db } from "../firebase.js";
import crypto from "crypto";

/**
 * 🔹 Generate a consistent ID from article source URL
 */
function hashId(url) {
  return crypto.createHash("md5").update(url).digest("hex");
}

/**
 * 🔥 Upload summarized news to Firestore with caching & trimming
 * Structure: news/tamil/{category}/{docs}
 * Each category keeps only latest 50
 */
export async function uploadSummariesToFirestore(summarizedData, language = "tamil") {
  console.log(`\n🚀 Starting Firestore Sync for ${language.toUpperCase()} news...\n`);

  for (const [category, articles] of Object.entries(summarizedData)) {
    // ✅ Collection path simplified
    const colRef = db.collection("news").doc(language).collection(category);

    console.log(`📂 Processing category: ${category} (${articles.length} articles)`);

    // 1️⃣ Fetch existing docs
    const snapshot = await colRef.get();
    const existingDocs = snapshot.docs.map((d) => ({
      id: d.id,
      publishedAt: d.data().publishedAt || "",
    }));
    const existingIds = new Set(existingDocs.map((d) => d.id));

    // 2️⃣ Filter only new ones
    const newArticles = articles.filter((a) => !existingIds.has(hashId(a.source)));

    if (newArticles.length === 0) {
      console.log(`♻️ No new articles for ${category}.`);
      continue;
    }

    // 3️⃣ Sort newest first
    newArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // 4️⃣ Upload new ones
    let addedCount = 0;
    for (const article of newArticles) {
      const id = hashId(article.source);
      const payload = {
        ...article,
        lastSyncedAt: new Date().toISOString(),
      };

      try {
        await colRef.doc(id).set(payload);
        console.log(`🆕 Added → ${article.title.slice(0, 50)}...`);
        addedCount++;
      } catch (err) {
        console.error(`❌ Failed to upload ${article.title.slice(0, 40)}: ${err.message}`);
      }
    }

    console.log(`✅ Uploaded ${addedCount} new article(s) to ${category}`);

    // 5️⃣ Maintain latest 50 only
    const allDocs = [...existingDocs, ...newArticles.map((a) => ({
      id: hashId(a.source),
      publishedAt: a.publishedAt,
    }))];

    allDocs.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    if (allDocs.length > 50) {
      const toDelete = allDocs.slice(50);
      console.log(`🗑️ Trimming ${toDelete.length} old articles from ${category}...`);

      for (const d of toDelete) {
        try {
          await colRef.doc(d.id).delete();
          console.log(`🗑️ Deleted → ${d.id}`);
        } catch (err) {
          console.error(`⚠️ Failed to delete ${d.id}: ${err.message}`);
        }
      }

      console.log(`✅ Trimmed ${category} to 50 latest.`);
    }

    console.log("--------------------------------------------\n");
  }

  console.log("🎯 Firestore Sync Completed Successfully ✅\n");
}
