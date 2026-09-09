export function subscriptionError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function changeSubscription(body: unknown) {
  const response = await fetch("/api/notifications/subscription", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not save your subscription.");
}
