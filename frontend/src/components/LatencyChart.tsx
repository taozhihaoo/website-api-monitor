import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Check } from "../api/types";

export function LatencyChart({ checks }: { checks: Check[] | undefined }) {
  const data = (checks || [])
    .filter((c) => c.latency_ms !== null)
    .slice(0, 100)
    .reverse()
    .map((c) => ({
      time: new Date(c.checked_at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      ms: c.latency_ms as number,
    }));

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-500">
        No latency data yet — waiting for the first checks.
      </div>
    );
  }

  return (
    <div className="h-48 w-full" data-testid="latency-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#1e293b" }}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
            unit=" ms"
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              color: "#e2e8f0",
            }}
            formatter={(value: number | string) => [`${value} ms`, "Latency"]}
          />
          <Area
            type="monotone"
            dataKey="ms"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#latencyFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
