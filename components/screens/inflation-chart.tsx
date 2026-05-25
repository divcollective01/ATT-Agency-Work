"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type InflationSeries = {
  date: string;
  cpi: number;
  ppi: number;
};

export function InflationChart({ data }: { data: InflationSeries[] }) {
  return (
    <div className="h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="#3D2B22" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="date" stroke="#A8927A" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis
            stroke="#A8927A"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            domain={["auto", "auto"]}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#241813",
              border: "1px solid #3D2B22",
              borderRadius: 16,
              color: "#F5E9D7"
            }}
            formatter={(v: number) => `${v.toFixed(2)}% YoY`}
          />
          <Legend wrapperStyle={{ color: "#A8927A", fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="cpi"
            name="CPI (consumer)"
            stroke="#2E6CF6"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5, stroke: "#15100D", strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="ppi"
            name="PPI (producer)"
            stroke="#FFE600"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5, stroke: "#15100D", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export type CommodityYoY = {
  label: string;
  code: string;
  yoyPct: number | null;
};

export function CommodityYoyChart({ data }: { data: CommodityYoY[] }) {
  const cleaned = data.filter((d) => d.yoyPct !== null) as Array<
    CommodityYoY & { yoyPct: number }
  >;
  return (
    <div className="h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={cleaned}
          layout="vertical"
          margin={{ top: 10, right: 24, bottom: 0, left: 12 }}
        >
          <CartesianGrid stroke="#3D2B22" strokeDasharray="3 4" horizontal={false} />
          <XAxis
            type="number"
            stroke="#A8927A"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            dataKey="label"
            type="category"
            stroke="#A8927A"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={150}
          />
          <Tooltip
            contentStyle={{
              background: "#241813",
              border: "1px solid #3D2B22",
              borderRadius: 16,
              color: "#F5E9D7"
            }}
            formatter={(v: number) => `${v.toFixed(2)}% YoY`}
          />
          <Bar dataKey="yoyPct" radius={[4, 10, 10, 4]}>
            {cleaned.map((d) => (
              <Cell key={d.code} fill={d.yoyPct >= 0 ? "#FF3B8A" : "#2E6CF6"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
