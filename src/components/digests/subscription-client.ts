export function subscriptionError(error: unknown, fallback = "Could not save your subscription. Please try again.") {
  if (error instanceof Error) return error.message;
  return typeof error === "string" && error.trim() ? error : fallback;
}

export async function changeSubscription(body: unknown) {
  const response = await fetch("/api/notifications/subscription", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}).catch(() => {
    throw new Error("Could not connect. Check your internet connection and try again.");
  });
  const {ok, error} = await response.json().catch(() => null) ?? {};
  if (!response.ok || ok !== true) {
    throw new Error(subscriptionError(error));
  }
}
