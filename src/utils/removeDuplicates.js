import stringSimilarity from "string-similarity";

/**
 * Remove near-duplicate news items based on title similarity
 * @param {Array} articles - array of article objects
 * @param {number} threshold - similarity threshold (default 0.85)
 */
export function removeDuplicates(articles, threshold = 0.85) {
  const unique = [];
  const seenTitles = [];

  for (const article of articles) {
    const currentTitle = normalize(article.title);

    // Compare with already kept titles
    let isDuplicate = false;
    for (const prev of seenTitles) {
      const similarity = stringSimilarity.compareTwoStrings(currentTitle, prev);
      if (similarity >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seenTitles.push(currentTitle);
      unique.push(article);
    }
  }

  console.log(
    `🧹 Fuzzy deduplication complete → kept ${unique.length}/${articles.length} articles`
  );
  return unique;
}

// Normalize Tamil or any language titles by removing spaces/punctuation
function normalize(text) {
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, "") // remove punctuation
    .replace(/\s+/g, "")
    .toLowerCase();
}
