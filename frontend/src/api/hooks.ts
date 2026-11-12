// React Query hooks for every backend resource the UI needs.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import type {
  Check,
  CheckHistory,
  DashboardSummary,
  Incident,
  IncidentList,
  Monitor,
  MonitorInput,
  SslInfo,
  UptimeStats,
  User,
} from "./types";

/** Detail-page window selector → API `hours` value for the check history. */
export const WINDOW_HOURS: Record<string, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 168,
  "30d": 720,
};

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  monitors: ["monitors"] as const,
  monitor: (id: number) => ["monitors", id] as const,
  checks: (id: number, hours: number, limit: number) =>
    ["monitors", id, "checks", hours, limit] as const,
  monitorData: (id: number) => ["monitors", id] as const,
  uptime: (id: number, window: string) => ["monitors", id, "uptime", window] as const,
  incidents: (active: boolean | undefined) => ["incidents", active] as const,
  allIncidents: ["incidents"] as const,
  monitorIncidents: (id: number) => ["monitors", id, "incidents"] as const,
  ssl: (id: number) => ["ssl", id] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get<DashboardSummary>("/api/dashboard/summary"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useMonitors() {
  return useQuery({
    queryKey: queryKeys.monitors,
    queryFn: () => api.get<Monitor[]>("/api/monitors"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useMonitor(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.monitor(id ?? 0),
    queryFn: () => api.get<Monitor>(`/api/monitors/${id}`),
    enabled: id !== undefined,
    refetchInterval: 15_000,
  });
}

export function useChecks(id: number | undefined, hours: number, limit = 100) {
  return useQuery({
    // The limit belongs in the key: dashboard rows request 30 checks while the
    // detail page requests 100. Without it both views shared one cache entry
    // and the detail page silently rendered only 30 rows.
    queryKey: queryKeys.checks(id ?? 0, hours, limit),
    queryFn: () =>
      api.get<CheckHistory>(
        `/api/monitors/${id}/checks?hours=${hours}&limit=${limit}&offset=0`,
      ),
    enabled: id !== undefined,
  });
}

export function useUptime(id: number | undefined, window: string) {
  return useQuery({
    queryKey: queryKeys.uptime(id ?? 0, window),
    queryFn: () => api.get<UptimeStats>(`/api/monitors/${id}/uptime?window=${window}`),
    enabled: id !== undefined,
  });
}

export function useMonitorIncidents(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.monitorIncidents(id ?? 0),
    queryFn: () => api.get<IncidentList>(`/api/monitors/${id}/incidents?limit=20`),
    enabled: id !== undefined,
  });
}

export function useIncidents(active?: boolean) {
  return useQuery({
    queryKey: queryKeys.incidents(active),
    queryFn: () =>
      api.get<IncidentList>(`/api/incidents?limit=100${active === undefined ? "" : `&active=${active}`}`),
    refetchInterval: 30_000,
  });
}

export function useSslInfo(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.ssl(id ?? 0),
    queryFn: () => api.get<SslInfo>(`/api/ssl/${id}`),
    enabled: id !== undefined,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.monitors });
  qc.invalidateQueries({ queryKey: queryKeys.dashboard });
  qc.invalidateQueries({ queryKey: queryKeys.allIncidents });
}

export function useCreateMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MonitorInput) => api.post<Monitor>("/api/monitors", input),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateMonitor(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<MonitorInput>) => api.put<Monitor>(`/api/monitors/${id}`, input),
    onSuccess: () => {
      invalidateAll(qc);
      // A changed URL / type invalidates cached history, uptime and SSL info.
      qc.invalidateQueries({ queryKey: queryKeys.monitorData(id) });
      qc.invalidateQueries({ queryKey: queryKeys.ssl(id) });
    },
  });
}

export function useDeleteMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/monitors/${id}`),
    onSuccess: (_data, id) => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: queryKeys.monitorData(id) });
    },
  });
}

export function useSetMonitorEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.post<Monitor>(`/api/monitors/${id}/${enabled ? "enable" : "disable"}`),
    onSuccess: (monitor) => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: queryKeys.monitorData(monitor.id) });
    },
  });
}

export function useCheckNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<Check>(`/api/monitors/${id}/check`),
    mutationKey: ["check-now"],
    onSuccess: (_data, id) => {
      invalidateAll(qc);
      // Invalidate every window/limit variant of this monitor's history.
      qc.invalidateQueries({ queryKey: queryKeys.monitorData(id) });
      qc.invalidateQueries({ queryKey: queryKeys.ssl(id) });
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (webhook_url: string | null) =>
      api.put<User>("/api/me/notifications", { webhook_url }),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: () => api.post<{ status: string; detail: string | null }>("/api/me/notifications/test"),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<User>("/api/auth/me"),
    retry: false,
  });
}

export type { Incident };
