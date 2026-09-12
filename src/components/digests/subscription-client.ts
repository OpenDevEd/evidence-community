export function subscriptionError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function changeSubscription(body: unknown) {
  const response = await fetch("/api/notifications/subscription", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}).catch(() => {
    throw new Error("Could not connect. Check your internet connection and try again.");
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(typeof result?.error === "string" ? result.error : "Could not save your subscription. Please try again.");
  }
}
