// API types mirroring the backend Pydantic schemas.

export type MonitorType = "http" | "keyword" | "api_json" | "ssl";
export type CheckStatus = "up" | "down";

export interface User {
  id: number;
  email: string;
  webhook_url: string | null;
  created_at: string;
}

export interface LatencyStats {
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  count: number;
}

export interface Monitor {
  id: number;
  name: string;
  type: MonitorType;
  target_url: string;
  enabled: boolean;
  interval_seconds: number;
  timeout_seconds: number;
  expected_status: number;
  keyword: string | null;
  keyword_mode: "contains" | "not_contains";
  json_path: string | null;
  json_expected_value: string | null;
  ssl_check_enabled: boolean;
  ssl_warning_days: number;
  last_status: CheckStatus | null;
  last_checked_at: string | null;
  next_check_at: string | null;
  ssl_status: string;
  ssl_expires_at: string | null;
  ssl_days_remaining: number | null;
  ssl_last_checked_at: string | null;
  last_latency_ms: number | null;
  uptime_24h: number | null;
  latency_stats?: LatencyStats | null;
  created_at: string;
  updated_at: string;
}

export interface MonitorInput {
  name: string;
  type: MonitorType;
  target_url: string;
  enabled?: boolean;
  interval_seconds: number;
  timeout_seconds: number;
  expected_status: number;
  keyword?: string | null;
  keyword_mode?: "contains" | "not_contains";
  json_path?: string | null;
  json_expected_value?: string | null;
  ssl_check_enabled?: boolean;
  ssl_warning_days?: number;
}

export interface Check {
  id: number;
  monitor_id: number;
  checked_at: string;
  status: CheckStatus;
  http_status: number | null;
  latency_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  keyword_result: string | null;
  json_result: string | null;
  ssl_days_remaining: number | null;
  ssl_status: string;
}

export interface CheckHistory {
  items: Check[];
  total: number;
  limit: number;
  offset: number;
}

export interface Incident {
  id: number;
  monitor_id: number;
  monitor_name?: string | null;
  started_at: string;
  resolved_at: string | null;
  duration_seconds: number | null;
  failure_count: number;
  cause: string | null;
  is_resolved: boolean;
}

export interface IncidentList {
  items: Incident[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardSummary {
  total_monitors: number;
  up: number;
  down: number;
  paused: number;
  pending: number;
  uptime_24h: number | null;
  active_incidents: number;
  generated_at: string;
}

export interface UptimeStats {
  monitor_id: number;
  window: string;
  total_checks: number;
  up_checks: number;
  uptime_percentage: number | null;
}

export interface SslInfo {
  monitor_id: number;
  scheme: string;
  ssl_status: string;
  expires_at: string | null;
  days_remaining: number | null;
  last_checked_at: string | null;
  warning_threshold_days: number;
}
