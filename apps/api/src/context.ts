import { createServices, type ServiceHandle } from "@reissue/workflows";

export interface ApiConfig {
  API_PORT: number;
  WORKBENCH_ACCESS_CODE: string;
  REISSUE_EXAMINER_TOOL_TOKEN: string | null;
  REISSUE_LIAISON_TOOL_TOKEN: string | null;
}

export interface AppContext extends ServiceHandle {
  api: ApiConfig;
}

export async function createContext(env: NodeJS.ProcessEnv = process.env): Promise<AppContext> {
  const handle = await createServices("reissue-api", env);
  const accessCode = env.WORKBENCH_ACCESS_CODE?.trim() ?? "";
  if (accessCode.length < 8) throw new Error("WORKBENCH_ACCESS_CODE must be at least 8 characters");
  return {
    ...handle,
    api: {
      API_PORT: Number(env.API_PORT ?? 4210),
      WORKBENCH_ACCESS_CODE: accessCode,
      REISSUE_EXAMINER_TOOL_TOKEN: env.REISSUE_EXAMINER_TOOL_TOKEN?.trim() || null,
      REISSUE_LIAISON_TOOL_TOKEN: env.REISSUE_LIAISON_TOOL_TOKEN?.trim() || null,
    },
  };
}
