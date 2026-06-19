const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const BRAZIL_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
]);

function parseTripLocation(location) {
  const raw = String(location || "").trim();

  if (!raw) {
    return {
      raw: "",
      origin: null,
      destination: null,
    };
  }

  const parts = raw
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return {
      raw,
      origin: null,
      destination: raw,
    };
  }

  const lastPart = parts[parts.length - 1].toUpperCase();

  /**
   * Caso: "Gramado - RS"
   * Aqui não é origem/destino. É cidade + UF.
   */
  if (parts.length === 2 && BRAZIL_STATES.has(lastPart)) {
    return {
      raw,
      origin: null,
      destination: raw,
    };
  }

  /**
   * Caso: "Passo Fundo - Gramado - RS"
   * Destino = "Gramado - RS"
   * Origem = "Passo Fundo"
   */
  if (parts.length >= 3 && BRAZIL_STATES.has(lastPart)) {
    return {
      raw,
      origin: parts.slice(0, -2).join(" - "),
      destination: parts.slice(-2).join(" - "),
    };
  }

  /**
   * Caso: "Carazinho - Ubatuba"
   * Destino = "Ubatuba"
   * Origem = "Carazinho"
   */
  return {
    raw,
    origin: parts.slice(0, -1).join(" - "),
    destination: parts[parts.length - 1],
  };
}


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

    const parsedLocation = parseTripLocation(destination.location);

const destinationForAi =
  parsedLocation.destination ||
  destination.location ||
  destination.title;

const originForAi =
  parsedLocation.origin ||
  "não informado";

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

        Nome da viagem:
        ${destination.title}

        Campo informado pelo usuário:
        ${destination.location || "não informado"}

        Origem / cidade de saída:
        ${originForAi}

        Destino principal para pesquisa:
        ${destinationForAi}

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

        Muito importante:
        - Use o destino principal como local principal para pontos turísticos, restaurantes, passeios e entretenimento.
        - Use a origem apenas para dicas de deslocamento, quando fizer sentido.
        - Não trate a origem como destino turístico principal.
        - Não invente endereço exato se não tiver certeza.
        - Priorize opções conhecidas e relevantes para o destino informado.
        - Seja objetivo, claro e útil.
        - Horários, valores e disponibilidade devem ser conferidos antes da visita.

        Crie exatamente estas seções:
        1. Pontos turísticos recomendados
        2. Passeios e experiências
        3. Restaurantes e lugares para comer
        4. Entretenimento ou atividades extras
        5. Dicas práticas para a viagem
        6. Itens que poderiam ser adicionados na mochila

        Cada seção deve ter de 2 a 5 sugestões.
        Cada sugestão deve ter:
        - name: nome curto da sugestão
        - details: explicação útil em 1 ou 2 frases
        - tag: etiqueta curta, como Família, Econômico, Aventura, Cultura, Gastronomia, Segurança ou Organização
        `;

    const { GoogleGenAI, Type } = await import("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const response = await ai.models.generateContent({
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  contents: prompt,
  config: {
    temperature: 0.4,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: "Resumo curto da viagem e do tipo de sugestão gerada.",
        },
        sections: {
          type: Type.ARRAY,
          description: "Categorias de sugestões para a viagem.",
          items: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: "Título da categoria.",
              },
              description: {
                type: Type.STRING,
                description: "Descrição curta da categoria.",
              },
              items: {
                type: Type.ARRAY,
                description: "Sugestões dentro da categoria.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: {
                      type: Type.STRING,
                      description: "Nome da sugestão.",
                    },
                    details: {
                      type: Type.STRING,
                      description: "Explicação curta e útil da sugestão.",
                    },
                    tag: {
                      type: Type.STRING,
                      description: "Etiqueta curta, como Família, Econômico, Aventura, Gastronomia ou Cultura.",
                    },
                  },
                  required: ["name", "details"],
                },
              },
            },
            required: ["title", "description", "items"],
          },
        },
      },
      required: ["summary", "sections"],
    },
  },
});

let structured;

try {
  structured = JSON.parse(response.text || "{}");
} catch (parseErr) {
  console.error("Erro ao interpretar JSON do Gemini:", parseErr);

  structured = {
    summary: "Não foi possível organizar a resposta em cards.",
    sections: [],
  };
}

const normalizedSections = Array.isArray(structured.sections)
  ? structured.sections.map((section) => ({
      title: section.title || "Sugestão",
      description: section.description || "",
      items: Array.isArray(section.items)
        ? section.items.map((item) => ({
            name: item.name || "Sugestão",
            details: item.details || "",
            tag: item.tag || "",
          }))
        : [],
    }))
  : [];

return res.json({
  destination: {
    id: destination.id,
    title: destination.title,
    location: destination.location,
  },
  answer: structured.summary || "Sugestões geradas para esta viagem.",
  sections: normalizedSections,
  sources: [],
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