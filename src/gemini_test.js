import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const HF_TOKEN = process.env.HF_TOKEN;

async function testTamilSummarization() {
  const model = "csebuetnlp/mT5_multilingual_XLSum";
  const inputText = `
விசாகப்பட்டினம்: மகளிர் உலகக் கோப்பை கிரிக்கெட் போட்டியின் லீக் ஆட்டத்தில் இன்று இந்தியா, தென் ஆப்பிரிக்க அணிகள் மோதவுள்ளன. 
இந்த ஆட்டம் பிற்பகல் 3 மணிக்கு தொடங்கும். இந்திய அணி இதுவரை இரண்டு ஆட்டங்களில் வெற்றி பெற்று 4 புள்ளிகளுடன் மூன்றாவது இடத்தில் உள்ளது.
`;

  try {
    const res = await axios.post(
      `https://api-inference.huggingface.co/models/${model}`,
      { inputs: inputText },
      {
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 180000,
      }
    );

    console.log("\n✅ Summary:\n", res.data?.[0]?.summary_text || res.data);
  } catch (err) {
    console.error("❌ Failed:", err.response?.status, err.message);
  }
}

testTamilSummarization();
