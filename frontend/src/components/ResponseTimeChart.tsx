import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LabelStats } from "../types";

const COLORS = ["#e8a33d", "#4fb6a8", "#e5564b", "#8b92a0", "#5ec8d8", "#c792ea"];

/**
 * Merges each label's bucketed time series into one combined dataset (one
 * row per time bucket, one column per label) so multi-step flows show every
 * step's response time on the same timeline for easy comparison.
 */
function mergeTimeSeries(stats: LabelStats[]) {
  const tSet = new Set<number>();
  stats.forEach((s) => s.timeSeries.forEach((p) => tSet.add(p.t)));
  const allT = Array.from(tSet).sort((a, b) => a - b);

  return allT.map((t) => {
    const row: Record<string, number | string | undefined> = { t };
    for (const s of stats) {
      const point = s.timeSeries.find((p) => p.t === t);
      row[s.label] = point ? point.avgMs : undefined;
    }
    return row;
  });
}

export default function ResponseTimeChart({ stats }: { stats: LabelStats[] }) {
  const data = mergeTimeSeries(stats);

  if (data.length < 2) {
    return <p className="muted">Not enough samples over time to chart yet.</p>;
  }

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2e37" />
          <XAxis
            dataKey="t"
            stroke="#8c8f98"
            fontSize={11}
            label={{ value: "seconds into run", position: "insideBottomRight", offset: -4, fill: "#8c8f98", fontSize: 11 }}
          />
          <YAxis
            stroke="#8c8f98"
            fontSize={11}
            label={{ value: "avg ms", angle: -90, position: "insideLeft", fill: "#8c8f98", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: "#1d2027", border: "1px solid #2a2e37", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#e7e6e2" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {stats.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
