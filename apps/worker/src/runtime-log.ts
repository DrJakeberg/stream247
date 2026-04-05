export function logRuntimeEvent(event: string, fields: Record<string, unknown> = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    component: "worker",
    event,
    ...fields
  };

  // eslint-disable-next-line no-console
  console.info(JSON.stringify(payload));
}
