// Vercel Serverless Function
// Route: /api/analyze?submission_id=XXXXX

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Config ────────────────────────────────────────────
  const FILLOUT_API_KEY = process.env.FILLOUT_API_KEY;
  const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

  // ── Validate params ───────────────────────────────────
  const { submission_id, form_id } = req.query;

  if (!submission_id) {
    return res.status(400).json({ error: 'submission_id is required' });
  }

  // form_id: з URL параметра або fallback на env змінну
  const FILLOUT_FORM_ID = form_id || process.env.FILLOUT_FORM_ID;

  try {
    // ── 1. Fetch submission from Fillout API ─────────────
    const filloutRes = await fetch(
      `https://api.fillout.com/v1/api/forms/${FILLOUT_FORM_ID}/submissions/${submission_id}`,
      {
        headers: { Authorization: `Bearer ${FILLOUT_API_KEY}` }
      }
    );

    if (!filloutRes.ok) {
      return res.status(404).json({ error: 'Submission not found in Fillout' });
    }

    const submission = await filloutRes.json();
    const questions  = submission.questions || [];

    if (questions.length === 0) {
      return res.status(404).json({ error: 'Submission has no answers' });
    }

    // ── 2. Parse questions ────────────────────────────────
    const questions_text = questions
      .map((q, i) => `${i + 1}. ${q.name}: ${q.value}`)
      .join('\n');

    // ── 3. Build prompt ───────────────────────────────────
    const system_prompt = `Jsi přímočarý mentor ve SKVOTu - škole kreativních průmyslů zaměřené na grafický design.

Analyzuj odpovědi potenciálního studenta a vrať personalizovaný feedback ve třech sekcích.

DŮLEŽITÉ: Vrať POUZE validní JSON bez jakéhokoliv textu před nebo za ním.

Formát odpovědi:
{"sections": [{"title": "Tvoje situace", "content": "..."}, {"title": "Hlavní problém", "content": "..."}, {"title": "Co dělat dál", "content": "..."}]}

Pravidla:
- Jazyk: pouze čeština
- Délka každé sekce: 3-4 krátké věty
- Tón: odvážný, přímý, empatický — nula prázdných frází a obecností
- Používej konkrétní detaily z odpovědí studenta

Sekce 1 'Tvoje situace': Přímo zrkaď jejich situaci a bolest. Mluv o jejich konkrétní profesi, odvětví a délce zkušeností.
Sekce 2 'Hlavní problém': Popiš konkrétně co je drží zpátky a jak SKVOT řeší právě toto.
Sekce 3 'Co dělat dál': Konkrétní emocionální nebo finanční výsledek po absolvování kurzu.`;

    const user_message = `Zde jsou odpovědi potenciálního studenta:\n\n${questions_text}`;

    // ── 4. Call OpenAI ────────────────────────────────────
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model:           'gpt-4o',
        messages: [
          { role: 'system', content: system_prompt },
          { role: 'user',   content: user_message  }
        ],
        response_format: { type: 'json_object' },
        max_tokens:      800,
        temperature:     0.7
      })
    });

    const aiData = await openaiRes.json();

    if (!aiData.choices || !aiData.choices[0]) {
      return res.status(500).json({ error: 'OpenAI returned invalid response', detail: aiData });
    }

    // ── 5. Parse AI response ──────────────────────────────
    const content = aiData.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(500).json({ error: 'OpenAI returned invalid JSON', raw: content });
    }

    if (!parsed.sections || !Array.isArray(parsed.sections)) {
      return res.status(500).json({ error: 'Missing sections in AI response', raw: parsed });
    }

    const sections = parsed.sections.map(s => ({
      title:   s.title   || 'Section',
      content: s.content || ''
    }));

    // ── 6. Return result ──────────────────────────────────
    return res.status(200).json({ sections });

  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
