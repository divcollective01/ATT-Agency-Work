"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const COLORS = ["#FFE600", "#2E6CF6", "#3F38B5", "#FF3B8A", "#5A8CFF", "#FFF06A"];

export type BucketDatum = {
  bucket: string;
  thisMonth: number;
  hint: string;
};

export function LeakBucketsChart({ data }: { data: BucketDatum[] }) {
  return (
    <div className="h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#3D2B22" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="bucket"
            stroke="#A8927A"
            tickLine={false}
            axisLine={false}
            fontSize={12}
          />
          <YAxis
            stroke="#A8927A"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            cursor={{ fill: "rgba(245,233,215,0.05)" }}
            contentStyle={{
              background: "#241813",
              border: "1px solid #3D2B22",
              borderRadius: 16,
              color: "#F5E9D7"
            }}
            formatter={(value: number) => [
              new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value),
              "This month"
            ]}
          />
          <Bar dataKey="thisMonth" radius={[10, 10, 4, 4]}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
