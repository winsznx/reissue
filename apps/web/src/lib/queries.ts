"use client";

import useSWR, { type SWRResponse } from "swr";

import { CaseDetailDto, HealthDto, type CaseListTab } from "@reissue/contracts";

import { getJson, getParsed } from "./api";
import type {
  CaseEventsResponse,
  CaseListResponse,
  JobsResponse,
  RoomsResponse,
  ScenariosResponse,
  SessionResponse,
  SettingsResponse,
  VerificationRunsResponse,
} from "./types";

export type CaseSort = "updated_desc" | "updated_asc" | "created_desc" | "code_asc";

const json = <T,>(path: string) => getJson<T>(path);

export function caseListKey(tab: CaseListTab, q: string, sort: CaseSort): string {
  const params = new URLSearchParams({ tab, sort });
  if (q.trim()) params.set("q", q.trim());
  return `/v1/cases?${params.toString()}`;
}

export const caseDetailKey = (code: string) => `/v1/cases/${encodeURIComponent(code)}`;
export const caseEventsKey = (code: string) => `/v1/cases/${encodeURIComponent(code)}/events`;

export function useSession(): SWRResponse<SessionResponse> {
  return useSWR("/v1/auth/session", json<SessionResponse>, { revalidateOnFocus: false });
}

export function useCaseList(tab: CaseListTab, q: string, sort: CaseSort): SWRResponse<CaseListResponse> {
  return useSWR(caseListKey(tab, q, sort), json<CaseListResponse>, { keepPreviousData: true, refreshInterval: 20_000 });
}

export function useCaseDetail(code: string): SWRResponse<CaseDetailDto> {
  return useSWR(caseDetailKey(code), (path: string) => getParsed(path, CaseDetailDto), { revalidateOnFocus: false });
}

export function useCaseEvents(code: string): SWRResponse<CaseEventsResponse> {
  return useSWR(caseEventsKey(code), json<CaseEventsResponse>, { revalidateOnFocus: false });
}

export function useSettings(): SWRResponse<SettingsResponse> {
  return useSWR("/v1/settings", json<SettingsResponse>);
}

export function useRooms(): SWRResponse<RoomsResponse> {
  return useSWR("/v1/settings/rooms", json<RoomsResponse>);
}

export function useScenarios(): SWRResponse<ScenariosResponse> {
  return useSWR("/v1/demo/scenarios", json<ScenariosResponse>, { revalidateOnFocus: false });
}

export function useVerificationRuns(): SWRResponse<VerificationRunsResponse> {
  return useSWR("/v1/verification/runs", json<VerificationRunsResponse>, {
    refreshInterval: (latest: VerificationRunsResponse | undefined) => (latest?.runs.some((r) => r.status === "RUNNING") ? 2_000 : 15_000),
  });
}

export function useJobs(): SWRResponse<JobsResponse> {
  return useSWR("/v1/jobs?status=DEAD,FAILED", json<JobsResponse>, { refreshInterval: 15_000 });
}

export function useHealth(): SWRResponse<HealthDto> {
  return useSWR("/v1/health", (path: string) => getParsed(path, HealthDto), { refreshInterval: 15_000 });
}
