export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Sadece POST" });
    return;
  }

  const { rawText, context } = req.body || {};
  if (!rawText) {
    res.status(400).json({ error: "rawText eksik" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY tanımlı değil (Vercel env variables)" });
    return;
  }

  const prompt = `${context}\n\nKullanıcının görev metni: "${rawText}"\n\nBunu ayrıştır. Göreceli tarih ifadelerini (perşembe, yarın, gelecek hafta) verilen "şu an" bilgisine göre kesin bir tarihe çevir. Saat belirtilmemişse time alanını boş bırak. Aciliyet belirtilmemişse priority "med" olsun. title kısa ve eylem odaklı olsun, tarih/saat ifadelerini title'dan çıkar.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                date: { type: "STRING" },
                time: { type: "STRING" },
                priority: { type: "STRING", enum: ["low", "med", "high"] },
              },
              required: ["title", "priority"],
            },
          },
        }),
      }
    );

    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      res.status(geminiRes.status).json({ error: data?.error?.message || "Gemini hatası" });
      return;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: "Gemini'den beklenen yanıt gelmedi" });
      return;
    }

    const parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
}

