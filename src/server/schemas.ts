// Gemini response schemas keep extraction, mapping, and grading predictable.

const number01 = { type: "NUMBER", minimum: 0, maximum: 1 };

export const QUESTION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          page: { type: "INTEGER", minimum: 0 },
          label: { type: "STRING" },
          text: { type: "STRING" },
          maxScore: { type: "NUMBER" },
          confidence: number01,
        },
        required: ["page", "label", "text", "maxScore", "confidence"],
      },
    },
  },
  required: ["questions"],
} as const;

export const ANSWER_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    blocks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          page: { type: "INTEGER", minimum: 0 },
          label: { type: "STRING" },
          transcript: { type: "STRING" },
          visualDescription: { type: "STRING" },
          // Exactly one physical region per answer block.
          regions: {
            type: "ARRAY",
            minItems: 1,
            maxItems: 1,
            items: {
              type: "OBJECT",
              properties: {
                page: { type: "INTEGER", minimum: 0 },
                bbox: {
                  type: "ARRAY",
                  minItems: 4,
                  maxItems: 4,
                  items: { type: "NUMBER", minimum: 0, maximum: 1000 },
                },
              },
              required: ["page", "bbox"],
            },
          },
          confidence: number01,
          labelConfidence: number01,
        },
        required: ["page", "label", "transcript", "visualDescription", "regions", "confidence", "labelConfidence"],
      },
    },
  },
  required: ["blocks"],
} as const;

export const MAPPING_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    assignments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          label: { type: "STRING" },
          continuation: { type: "BOOLEAN" },
          confidence: number01,
        },
        required: ["id", "label", "continuation", "confidence"],
      },
    },
  },
  required: ["assignments"],
} as const;

export const GRADING_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    grades: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          maxScore: { type: "NUMBER", minimum: 0 },
          score: { type: "NUMBER", minimum: 0 },
          feedback: { type: "STRING" },
        },
        required: ["label", "maxScore", "score", "feedback"],
      },
    },
    overall: { type: "STRING" },
  },
  required: ["grades", "overall"],
} as const;

export const FINAL_ASSESSMENT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    assignments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          label: { type: "STRING" },
          continuation: { type: "BOOLEAN" },
          confidence: number01,
        },
        required: ["id", "label", "continuation", "confidence"],
      },
    },
    grades: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          maxScore: { type: "NUMBER", minimum: 0 },
          score: { type: "NUMBER", minimum: 0 },
          feedback: { type: "STRING" },
        },
        required: ["label", "maxScore", "score", "feedback"],
      },
    },
    overall: { type: "STRING" },
  },
  required: ["assignments", "grades", "overall"],
} as const;

export const COMPLETE_ASSESSMENT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          page: { type: "INTEGER", minimum: 0 },
          label: { type: "STRING" },
          text: { type: "STRING" },
          maxScore: { type: "NUMBER", minimum: 0 },
          confidence: number01,
        },
        required: ["page", "label", "text", "maxScore", "confidence"],
      },
    },
    blocks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          page: { type: "INTEGER", minimum: 0 },
          label: { type: "STRING" },
          transcript: { type: "STRING" },
          visualDescription: { type: "STRING" },
          // One entry per physical answer region/page. Boxes are
          // [ymin, xmin, ymax, xmax] integers from 0 to 1000.
          regions: {
            type: "ARRAY",
            minItems: 1,
            maxItems: 1,
            items: {
              type: "OBJECT",
              properties: {
                page: { type: "INTEGER", minimum: 0 },
                bbox: {
                  type: "ARRAY",
                  minItems: 4,
                  maxItems: 4,
                  items: { type: "NUMBER", minimum: 0, maximum: 1000 },
                },
              },
              required: ["page", "bbox"],
            },
          },
          confidence: number01,
          labelConfidence: number01,
        },
        required: ["page", "label", "transcript", "visualDescription", "regions", "confidence", "labelConfidence"],
      },
    },
    assignments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          label: { type: "STRING" },
          continuation: { type: "BOOLEAN" },
          confidence: number01,
        },
        required: ["id", "label", "continuation", "confidence"],
      },
    },
    grades: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          maxScore: { type: "NUMBER", minimum: 0 },
          score: { type: "NUMBER", minimum: 0 },
          feedback: { type: "STRING" },
        },
        required: ["label", "maxScore", "score", "feedback"],
      },
    },
    overall: { type: "STRING" },
  },
  required: ["questions", "blocks", "assignments", "grades", "overall"],
} as const;
