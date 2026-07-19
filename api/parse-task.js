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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY tanımlı değil (Vercel env variables)" });
    return;
  }

  const systemPrompt = `Sen bir görev ayrıştırma asistanısın. Kullanıcının doğal dil görev metnini JSON formatına çevirirsin.
Kuralllar:
- Göreceli tarih ifadelerini (perşembe, yarın, gelecek hafta) verilen "şu an" bilgisine göre kesin YYYY-MM-DD tarihine çevir.
- Saat belirtilmemişse "time" alanını null yap.
- Tarih belirtilmemişse "date" alanını null yap.
- Aciliyet belirtilmemişse priority "med" olsun.
- "title" kısa ve eylem odaklı olsun, tarih/saat ifadelerini title'dan çıkar.
- Sadece JSON döndür, başka hiçbir şey yazma.
Format: {"title": "...", "date": "YYYY-MM-DD veya null", "time": "HH:MM veya null", "priority": "low|med|high"}`;

  const userPrompt = `${context}\n\nGörev metni: "${rawText}"`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    const data = await groqRes.json();
    if (!groqRes.ok) {
      res.status(groqRes.status).json({ error: data?.error?.message || "Groq hatası" });
      return;
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      res.status(502).json({ error: "Groq'tan beklenen yanıt gelmedi" });
      return;
    }

    const parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası: " + err.message });
  }
}

