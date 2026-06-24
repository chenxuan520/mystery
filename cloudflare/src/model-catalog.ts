export type WorkersAiModelOption = {
  id: string;
  name: string;
  model: string;
  endpoint: string;
};

export const WORKERS_AI_MODEL_OPTIONS: WorkersAiModelOption[] = [
  {
    id: "cf-mistral-small-3.1-24b",
    name: "Mistral Small 3.1 24B",
    model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    endpoint: "Workers AI",
  },
  {
    id: "cf-glm-4.7-flash",
    name: "Zhipu GLM 4.7 Flash",
    model: "@cf/zai-org/glm-4.7-flash",
    endpoint: "Workers AI",
  },
  {
    id: "cf-glm-5.2",
    name: "Zhipu GLM 5.2",
    model: "@cf/zai-org/glm-5.2",
    endpoint: "Workers AI",
  },
];

export const DEFAULT_PLAY_MODEL_ID = "cf-mistral-small-3.1-24b";
export const DEFAULT_GENERATOR_MODEL_ID = "cf-mistral-small-3.1-24b";
export const DEFAULT_REVIEW_MODEL_ID = "cf-mistral-small-3.1-24b";

export function listAdminModelOptions() {
  return WORKERS_AI_MODEL_OPTIONS.map((option) => ({
    id: option.id,
    name: option.name,
    model: option.model,
    endpoint: option.endpoint,
  }));
}

export function findModelOptionById(optionId: string | undefined) {
  return WORKERS_AI_MODEL_OPTIONS.find((option) => option.id === optionId);
}

export function findModelOptionByModel(model: string | undefined) {
  return WORKERS_AI_MODEL_OPTIONS.find((option) => option.model === model);
}

export function resolveModelOption(optionId: string | undefined, fallbackId: string) {
  return findModelOptionById(optionId) ?? findModelOptionById(fallbackId) ?? WORKERS_AI_MODEL_OPTIONS[0]!;
}
