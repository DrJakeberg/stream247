export function isTwitchScheduleSyncEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.TWITCH_SCHEDULE_SYNC_ENABLED || "1") !== "0";
}
