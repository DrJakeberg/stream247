export type AppConfig = {
  appName: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  moderationPresenceEnabled: boolean;
  moderationCommand: string;
};

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    appName: "Stream247",
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? "",
    redisUrl: env.REDIS_URL ?? "",
    moderationPresenceEnabled: env.MOD_PRESENCE_ENABLED !== "false",
    moderationCommand: env.MOD_PRESENCE_COMMAND ?? "here"
  };
}

