import type {
  CreateDraftInput,
  DispatchDraft,
  Provider,
  ProviderEvaluation,
  RequestConditions,
  ServiceHistoryEntry,
  Vehicle,
} from "./types";

export const SCENARIO_NOW = "2026-08-27T10:00:00+09:00";

export const VEHICLE: Vehicle = {
  id: "vehicle-001",
  name: "2024 Calystren Veo",
  customer: "Northstar Auto Gallery",
  finish: "Deep graphite",
  current_request: "Exterior correction and ceramic coating",
};

export const REQUEST_CONDITIONS: RequestConditions = {
  certification_required: true,
  completion_before: "2026-08-28T00:00:00+09:00",
  max_price_jpy: 60_000,
  previous_service_history_required: true,
  human_approval_required: true,
};

export const SERVICE_HISTORY: ServiceHistoryEntry[] = [
  {
    id: "history-001",
    completed_at: "2026-02-12",
    service: "Paint decontamination",
    provider: "Orison Surface Lab",
    note: "No machine polishing on the left rear quarter.",
  },
  {
    id: "history-002",
    completed_at: "2025-10-03",
    service: "Localized finish repair",
    provider: "Northline Finish Room",
    note: "Inspect repaired clear coat before correction.",
  },
];

export const PROVIDERS: Provider[] = [
  {
    id: "provider-001",
    name: "Kairo Detail Works",
    certified: true,
    price_jpy: 58_000,
    distance_km: 7.4,
    services: ["Exterior correction", "Ceramic coating"],
    slot: {
      id: "slot-001",
      starts_at: "2026-08-27T13:00:00+09:00",
      ends_at: "2026-08-27T17:30:00+09:00",
      label: "Thu, Aug 27 · 13:00–17:30",
    },
  },
  {
    id: "provider-002",
    name: "Brightlane Auto Care",
    certified: false,
    price_jpy: 48_000,
    distance_km: 4.2,
    services: ["Exterior correction", "Ceramic coating"],
    slot: {
      id: "slot-002",
      starts_at: "2026-08-27T10:00:00+09:00",
      ends_at: "2026-08-27T15:00:00+09:00",
      label: "Thu, Aug 27 · 10:00–15:00",
    },
  },
  {
    id: "provider-003",
    name: "Lumen Finish Studio",
    certified: true,
    price_jpy: 55_000,
    distance_km: 11.8,
    services: ["Exterior correction", "Ceramic coating"],
    slot: {
      id: "slot-003",
      starts_at: "2026-08-29T09:00:00+09:00",
      ends_at: "2026-08-29T14:00:00+09:00",
      label: "Sat, Aug 29 · 09:00–14:00",
    },
  },
];

export const DRAFT_INPUT: CreateDraftInput = {
  provider_id: "provider-001",
  slot_id: "slot-001",
  quoted_price_jpy: 58_000,
  rationale: "Certified, within budget, and can complete before the deadline.",
};

function cloneProvider(provider: Provider): Provider {
  return {
    ...provider,
    services: [...provider.services],
    slot: { ...provider.slot },
  };
}

export function evaluateProviders(
  providers: Provider[] = PROVIDERS,
  conditions: RequestConditions = REQUEST_CONDITIONS,
): ProviderEvaluation[] {
  const deadline = Date.parse(conditions.completion_before);

  return providers.map((provider) => {
    const certificationMatches =
      !conditions.certification_required || provider.certified;
    const budgetMatches = provider.price_jpy <= conditions.max_price_jpy;
    const deadlineMatches = Date.parse(provider.slot.ends_at) <= deadline;
    const matches =
      certificationMatches && budgetMatches && deadlineMatches;

    let reason =
      "Certified, within budget, and can complete before the deadline.";
    if (!certificationMatches) {
      reason = "Excluded — required certification is missing.";
    } else if (!deadlineMatches) {
      reason = "Excluded — service cannot be completed by the deadline.";
    } else if (!budgetMatches) {
      reason = "Excluded — quoted price exceeds the approved budget.";
    }

    return {
      provider: cloneProvider(provider),
      matches,
      certification_matches: certificationMatches,
      budget_matches: budgetMatches,
      deadline_matches: deadlineMatches,
      reason,
    };
  });
}

export function buildDispatchDraft(
  input: CreateDraftInput = DRAFT_INPUT,
): DispatchDraft {
  const provider = PROVIDERS.find((item) => item.id === input.provider_id);

  if (!provider || provider.slot.id !== input.slot_id) {
    throw new Error("The selected fictional provider or slot does not exist.");
  }

  const draftProvider = cloneProvider(provider);

  return {
    draft_id: "D-1042",
    vehicle: { ...VEHICLE },
    provider: draftProvider,
    slot: { ...draftProvider.slot },
    quoted_price_jpy: input.quoted_price_jpy,
    work_scope: "Exterior correction and ceramic coating",
    rationale: input.rationale,
  };
}
