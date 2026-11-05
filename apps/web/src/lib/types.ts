import type { ArtifactDto, CaseEvent, CaseSummaryDto, ConversionFactor, RoomBindingDto, ScenarioDto, VerificationRunDto } from "@reissue/contracts";

/**
 * Response envelopes the API returns around contract DTOs. The contracts package defines the
 * DTOs themselves; these wrappers mirror apps/api/src/routes/*.ts.
 */

export interface SessionResponse {
  user: string | null;
  expiresAt?: string;
}

export interface CaseListResponse {
  cases: CaseSummaryDto[];
}

export interface CaseEventsResponse {
  events: CaseEvent[];
}

export interface IntakeResponse {
  caseCode: string;
  caseId: string;
  accepted: { filename: string; versionId: string }[];
  duplicates: unknown[];
  quarantined: unknown[];
  rejected: unknown[];
}

export interface ReplacementResponse {
  accepted: unknown[];
  duplicates: unknown[];
  quarantined: unknown[];
  rejected: unknown[];
}

export interface ArtifactsResponse {
  artifacts: ArtifactDto[];
}

export interface PackageResponse {
  queued: boolean;
  epoch: number;
  reason?: string;
}

export interface ReminderPolicy {
  label: string;
  firstReminderMinutes: number;
  repeatIntervalMinutes: number;
  maxReminders: number;
  escalationAfterMinutes: number;
  quietHours: { start: string; end: string } | null;
  timezone: string;
}

export interface SettingsResponse {
  workspace: string | undefined;
  caseReferenceRule: string;
  reminderPolicy: ReminderPolicy;
  demoTimingProfile: boolean;
  unitConversions: { builtIn: string[]; defaults: ConversionFactor[] };
  suppliers: { id: string; name: string }[];
  agents: { coordinator: string | null; examiner: string | null; liaison: string | null };
  extraction: { provider: string; model: string | null | undefined };
  replyClassifier: string;
  fileRetentionDays: number;
  limits: { maxUploadBytes: number; chatMediaMaxBytes: number };
}

export interface RoomsResponse {
  bindings: RoomBindingDto[];
}

export interface ScenariosResponse {
  scenarios: ScenarioDto[];
  fixtureLabel: string;
}

export interface ScenarioStartResponse {
  runId: string;
  caseCode: string;
  accepted: number;
}

export interface ScenarioNextResponse {
  step: number;
  label: string;
}

export interface VerificationRunsResponse {
  runs: VerificationRunDto[];
  metrics: { total: number; passed: number; failed: number; running: number; medianSettleMs: number | null };
}

export interface FailedJob {
  id: string;
  type: string;
  shipmentId: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export interface FailedMessage {
  id: string;
  purpose: string;
  shipmentId: string | null;
  lastError: string | null;
  attempts: number;
}

export interface JobsResponse {
  jobs: FailedJob[];
  failedMessages: FailedMessage[];
  queues: Record<string, number>;
}
