const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const BRAZIL_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
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

function withTimeout(promise, ms, message) {
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

function clampNumber(value, min, max, fallback) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numberValue));
}

function shouldTryPhotoForSection(sectionTitle) {
  const title = String(sectionTitle || "").toLowerCase();

  return (
    title.includes("ponto") ||
    title.includes("turíst") ||
    title.includes("passeio") ||
    title.includes("experiência") ||
    title.includes("restaurante") ||
    title.includes("comer") ||
    title.includes("entretenimento") ||
    title.includes("atividade")
  );
}

async function findPlaceWithPhoto(searchQuery) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey || !searchQuery) {
    return null;
  }

  try {
    const response = await withTimeout(
      fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.rating",
            "places.googleMapsUri",
            "places.photos.name",
            "places.photos.authorAttributions",
          ].join(","),
        },
        body: JSON.stringify({
          textQuery: searchQuery,
          languageCode: "pt-BR",
          maxResultCount: 1,
        }),
      }),
      10000,
      "Tempo limite ao buscar imagem no Google Places."
    );

    if (!response.ok) {
      const text = await response.text();

      console.warn("[PLACES] Erro ao buscar local:", response.status, text);

      return null;
    }

    const data = await response.json();
    const place = data?.places?.[0];

    if (!place) {
      return null;
    }

    const photo = Array.isArray(place.photos) ? place.photos[0] : null;
    const photoName = photo?.name || null;

    return {
      placeId: place.id || null,
      name: place.displayName?.text || null,
      address: place.formattedAddress || null,
      rating: place.rating || null,
      googleMapsUri: place.googleMapsUri || null,
      photoName,
      photoUrl: photoName
        ? `/places/photo?name=${encodeURIComponent(photoName)}&maxWidthPx=720`
        : null,
      photoAttributions: photo?.authorAttributions || [],
    };
  } catch (err) {
    console.warn("[PLACES] Falha ao enriquecer local:", err.message);

    return null;
  }
}

async function enrichSectionsWithPlaces(sections, destinationForAi) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return sections;
  }

  const maxPhotosPerSection = clampNumber(
    process.env.PLACES_MAX_PHOTOS_PER_SECTION,
    0,
    5,
    2
  );

  if (maxPhotosPerSection <= 0) {
    return sections;
  }

  return Promise.all(
    sections.map(async (section) => {
      if (!shouldTryPhotoForSection(section.title)) {
        return section;
      }

      let photosUsed = 0;

      const enrichedItems = await Promise.all(
        section.items.map(async (item) => {
          if (photosUsed >= maxPhotosPerSection) {
            return {
              ...item,
              place: null,
            };
          }

          photosUsed += 1;

          const query =
            item.searchQuery ||
            `${item.name || ""} ${destinationForAi || ""}`.trim();

          const place = await findPlaceWithPhoto(query);

          return {
            ...item,
            place,
          };
        })
      );

      return {
        ...section,
        items: enrichedItems,
      };
    })
  );
}

function buildSourcesFromSections(sections) {
  const sourcesByUri = new Map();

  for (const section of sections) {
    for (const item of section.items || []) {
      const place = item.place;

      if (place?.googleMapsUri) {
        sourcesByUri.set(place.googleMapsUri, {
          title: place.name || item.name || "Google Maps",
          uri: place.googleMapsUri,
        });
      }
    }
  }

  return Array.from(sourcesByUri.values());
}

/**
 * Rota proxy para fotos do Google Places.
 *
 * O frontend usa:
 * <img [src]="apiUrl + item.place.photoUrl">
 *
 * Essa rota evita expor GOOGLE_MAPS_API_KEY no Angular.
 */
router.get("/places/photo", async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const name = String(req.query.name || "").trim();

    const maxWidthPx = clampNumber(req.query.maxWidthPx, 100, 1600, 720);

    if (!apiKey) {
      return res.status(500).json({
        error: "GOOGLE_MAPS_API_KEY não configurada.",
      });
    }

    if (!name) {
      return res.status(400).json({
        error: "Nome da foto não informado.",
      });
    }

    const safeName = name
      .replace(/^\/+/, "")
      .replace(/\/media$/, "");

    if (!safeName.startsWith("places/") || !safeName.includes("/photos/")) {
      return res.status(400).json({
        error: "Nome da foto inválido.",
      });
    }

    const url = new URL(`https://places.googleapis.com/v1/${safeName}/media`);

    url.searchParams.set("maxWidthPx", String(maxWidthPx));
    url.searchParams.set("key", apiKey);

    const photoResponse = await fetch(url.toString(), {
      redirect: "manual",
    });

    const redirectUrl = photoResponse.headers.get("location");

    if (redirectUrl) {
      return res.redirect(302, redirectUrl);
    }

    if (!photoResponse.ok) {
      const text = await photoResponse.text();

      return res.status(photoResponse.status).send(text);
    }

    const contentType =
      photoResponse.headers.get("content-type") || "image/jpeg";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

    const arrayBuffer = await photoResponse.arrayBuffer();

    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("[PLACES PHOTO] Erro:", err);

    return res.status(500).json({
      error: "Erro ao carregar foto do local.",
    });
  }
});

router.post("/destinations/:id/ai/suggestions", requireAuth, async (req, res) => {
  const startedAt = Date.now();

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

    console.log("[AI] Iniciando sugestões");
    console.log("[AI] destinationId:", destinationId);
    console.log("[AI] userId:", userId);

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

    if (!destinationForAi || destinationForAi.length < 3) {
      return res.status(400).json({
        error: "Informe um destino/local válido para gerar sugestões.",
      });
    }

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
        const qty = row.qty
          ? `Qtd: ${row.qty}${row.unit ? ` ${row.unit}` : ""}`
          : "";

        const notes = row.notes ? ` - ${row.notes}` : "";

        return `- ${row.category_name}: ${row.item_title} ${qty}${notes}`.trim();
      })
      .join("\n");

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
- searchQuery: texto curto para pesquisar o local no Google Places. Quando for um ponto turístico, restaurante, passeio ou entretenimento, inclua o nome do local e o destino principal. Para dicas práticas ou itens de mochila, use uma string vazia.
`;

    const { GoogleGenAI, Type } = await import("@google/genai");

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    console.log("[AI] Chamando Gemini...");

    const response = await withTimeout(
      ai.models.generateContent({
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
                description:
                  "Resumo curto da viagem e do tipo de sugestão gerada.",
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
                            description:
                              "Explicação curta e útil da sugestão.",
                          },
                          tag: {
                            type: Type.STRING,
                            description:
                              "Etiqueta curta, como Família, Econômico, Aventura, Gastronomia ou Cultura.",
                          },
                          searchQuery: {
                            type: Type.STRING,
                            description:
                              "Consulta para encontrar este local no Google Places. Inclua nome do local, cidade e estado quando possível. Para dicas práticas ou itens de mochila, pode ser vazio.",
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
      }),
      45000,
      "A IA demorou mais de 45 segundos para responder."
    );

    console.log(`[AI] Gemini respondeu em ${Date.now() - startedAt}ms`);

    let structured;

    try {
      structured = JSON.parse(response.text || "{}");
    } catch (parseErr) {
      console.error("Erro ao interpretar JSON do Gemini:", parseErr);

      structured = {
        summary: response.text || "Sugestões geradas para esta viagem.",
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
                searchQuery: item.searchQuery || "",
              }))
            : [],
        }))
      : [];

    const enrichedSections = await enrichSectionsWithPlaces(
      normalizedSections,
      destinationForAi
    );

    const sources = buildSourcesFromSections(enrichedSections);

    return res.json({
      destination: {
        id: destination.id,
        title: destination.title,
        location: destination.location,
      },
      answer: structured.summary || "Sugestões geradas para esta viagem.",
      sections: enrichedSections,
      sources,
    });
  } catch (err) {
    console.error("ERRO GEMINI SUGGESTIONS:", err);

    const isTimeout = String(err.message || "").includes("45 segundos");

    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout
        ? "A IA demorou muito para responder. Tente novamente em alguns instantes."
        : "Erro ao gerar sugestões com IA.",
      detail: err.message,
    });
  }
});

module.exports = router;