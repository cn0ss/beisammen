interface BillingReturnParams {
  billing?: string | string[];
  source?: string | string[];
}

interface BillingReturnRefreshInput {
  params: BillingReturnParams;
  handledReturnKey: string | null;
}

interface BillingReturnRefreshDecision {
  shouldRefresh: boolean;
  nextHandledReturnKey: string | null;
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function getBillingReturnRefreshDecision(
  input: BillingReturnRefreshInput,
): BillingReturnRefreshDecision {
  const billingParam = firstParam(input.params.billing);

  if (billingParam !== 'return') {
    return {
      shouldRefresh: false,
      nextHandledReturnKey: null,
    };
  }

  const sourceParam = firstParam(input.params.source) ?? 'checkout';
  const returnKey = `${billingParam}:${sourceParam}`;

  if (input.handledReturnKey === returnKey) {
    return {
      shouldRefresh: false,
      nextHandledReturnKey: input.handledReturnKey,
    };
  }

  return {
    shouldRefresh: true,
    nextHandledReturnKey: returnKey,
  };
}
