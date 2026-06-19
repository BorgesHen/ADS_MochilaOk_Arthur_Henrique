const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function getMapsSources(response) {
  const chunks =
    response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

  return chunks
    .filter((chunk) => chunk.maps)
    .map((chunk) => ({
      title: chunk.maps.title,
      uri: chunk.maps.uri,
      placeId: chunk.maps.placeId || null,
    }))
    .filter((source) => source.title && source.uri);
}

router.post("/destinations/:id/ai/suggestions", requireAuth, async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY não configurada no backend.",
      });
    }

    const destinationId = req.params.id;
    const userId = getUserId(req);

    const days = normalizeText(req.body.days) || "não informado";
    const budget = normalizeText(req.body.budget) || "moderado";
    const travelStyle = normalizeText(req.body.travelStyle) || "equilibrado";

    const interests = Array.isArray(req.body.interests)
      ? req.body.interests.map(normalizeText).filter(Boolean)
      : [];

    const destinationResult = await pool.query(
      `
      SELECT
        d.id,
        d.title,
        d.location,
        dm.role AS my_role
      FROM destinations d
      JOIN destination_members dm
        ON dm.destination_id = d.id
      WHERE d.id = $1
        AND dm.user_id = $2
      `,
      [destinationId, userId]
    );

    if (destinationResult.rowCount === 0) {
      return res.status(404).json({
        error: "Viagem não encontrada ou sem acesso.",
      });
    }

    const destination = destinationResult.rows[0];

    const itemsResult = await pool.query(
      `
      SELECT
        c.name AS category_name,
        c.mode AS category_mode,
        i.title AS item_title,
        i.qty,
        i.unit,
        i.notes
      FROM categories c
      LEFT JOIN items i
        ON i.category_id = c.id
      WHERE c.destination_id = $1
      ORDER BY
        c.sort_order ASC,
        c.name ASC,
        i.created_at ASC
      `,
      [destinationId]
    );

    const existingItems = itemsResult.rows
      .filter((row) => row.item_title)
      .map((row) => {
        const qty = row.qty ? `Qtd: ${row.qty}${row.unit ? ` ${row.unit}` : ""}` : "";
        const notes = row.notes ? ` - ${row.notes}` : "";

        return `- ${row.category_name}: ${row.item_title} ${qty}${notes}`.trim();
      })
      .join("\n");

    const destinationName = [destination.title, destination.location]
      .filter(Boolean)
      .join(" - ");

    const prompt = `
Você é um assistente de planejamento de viagens dentro do app MochilaOK.

Destino/local da viagem:
${destinationName || "Destino não informado"}

Duração:
${days}

Orçamento:
${budget}

Estilo da viagem:
${travelStyle}

Interesses dos viajantes:
${interests.length ? interests.join(", ") : "não informado"}

Itens já cadastrados na mochila:
${existingItems || "Nenhum item cadastrado ainda."}

Monte sugestões práticas para essa viagem, em português do Brasil.

Quero que você organize a resposta nestes blocos:

1. Pontos turísticos recomendados
2. Passeios e experiências
3. Restaurantes e lugares para comer
4. Entretenimento ou atividades extras
5. Dicas práticas para a viagem
6. Itens que poderiam ser adicionados na mochila

Regras:
- Seja objetivo e útil.
- Não invente endereço exato se não tiver certeza.
- Priorize opções conhecidas e relevantes para o destino.
- Quando fizer sentido, indique se é melhor para família, amigos, casal, aventura, economia ou gastronomia.
- Inclua uma observação dizendo que horários, valores e disponibilidade devem ser conferidos antes da visita.
`;

    const { GoogleGenAI } = await import("@google/genai");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [
          {
            googleMaps: {},
          },
        ],
        temperature: 0.4,
      },
    });

    const sources = getMapsSources(response);

    return res.json({
      destination: {
        id: destination.id,
        title: destination.title,
        location: destination.location,
      },
      answer: response.text,
      sources,
    });
  } catch (err) {
    console.error("ERRO GEMINI SUGGESTIONS:", err);

    return res.status(500).json({
      error: "Erro ao gerar sugestões com IA.",
      detail: err.message,
    });
  }
});

module.exports = router;