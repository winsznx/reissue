import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  WORKER_URL: z.string().default("http://127.0.0.1:4220"),
  REISSUE_PUBLIC_URL: z.string().default("http://localhost:3210"),
  API_BASE_URL: z.string().default("http://localhost:4210"),
  APP_SESSION_SECRET: z.string().min(16),
  REISSUE_TENANT_NAME: z.string().default("Reissue workspace"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  SWITCH_MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  SWITCH_BASE_URL: optional,
  SWITCH_REGISTRATION_KEY: optional,
  SWITCH_COORDINATOR_AGENT_ID: optional,
  SWITCH_COORDINATOR_AGENT_API_KEY: optional,
  SWITCH_COORDINATOR_NAME: z.string().default("reissue"),
  SWITCH_EXAMINER_NAME: optional,
  SWITCH_LIAISON_NAME: optional,
  SWITCH_OPS_ROOM_ID: optional,
  SWITCH_OPS_PLATFORM: z.string().default("slack"),
  SWITCH_SUPPLIER_ROOM_ID: optional,
  SWITCH_SUPPLIER_PLATFORM: z.string().default("telegram"),
  SWITCH_VERIFICATION_ROOM_ID: optional,
  SWITCH_VERIFICATION_PLATFORM: z.string().default("mattermost"),
  REVIEW_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(180),
  LIAISON_POST_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  EXTRACTION_MODEL_PROVIDER: optional,
  EXTRACTION_MODEL: optional,
  EXTRACTION_API_KEY: optional,
  REPLY_CLASSIFIER_PROVIDER: optional,
  DEMO_TIMING_PROFILE: bool,
  LOG_LEVEL: z.string().default("info"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    ...e,
    switchEnabled: Boolean(e.SWITCH_BASE_URL && e.SWITCH_COORDINATOR_AGENT_ID && e.SWITCH_COORDINATOR_AGENT_API_KEY),
    reminderPolicy: e.DEMO_TIMING_PROFILE
      ? {
          label: "Demo timing profile",
          firstReminderMinutes: 2,
          repeatIntervalMinutes: 2,
          maxReminders: 2,
          escalationAfterMinutes: 7,
          quietHours: null,
          timezone: "UTC",
        }
      : {
          label: "Standard",
          firstReminderMinutes: 240,
          repeatIntervalMinutes: 1440,
          maxReminders: 3,
          escalationAfterMinutes: 2880,
          quietHours: { start: "20:00", end: "07:00" },
          timezone: "UTC",
        },
  };
}
