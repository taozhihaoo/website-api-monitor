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
import { useI18n } from "../i18n/I18nContext";

export function LatencyChart({ checks }: { checks: Check[] | undefined }) {
  const { t, locale } = useI18n();
  const data = (checks || [])
    .filter((c) => c.latency_ms !== null)
    .slice(0, 100)
    .reverse()
    .map((c) => ({
      time: new Date(c.checked_at).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      ms: c.latency_ms as number,
    }));

  if (data.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center text-[13px] text-slate-500">
        {t("feedback.noLatency")}
      </div>
    );
  }

  return (
    <div className="h-52 w-full" data-testid="latency-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity={0.42} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148,163,184,0.1)" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={52}
            unit=" ms"
          />
          <Tooltip
            cursor={{ stroke: "rgba(129,140,248,0.35)", strokeWidth: 1 }}
            contentStyle={{
              background: "rgba(12,19,34,0.96)",
              border: "1px solid rgba(129,140,248,0.3)",
              borderRadius: 12,
              color: "#e8edf8",
              boxShadow: "0 16px 40px -20px rgba(0,0,0,0.9)",
              fontSize: 12,
            }}
            formatter={(value: number | string) => [`${value} ms`, t("format.latency")]}
          />
          <Area
            type="monotone"
            dataKey="ms"
            stroke="#818cf8"
            strokeWidth={2.2}
            fill="url(#latencyFill)"
            activeDot={{ r: 4, fill: "#22d3ee", stroke: "#0a1020", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
