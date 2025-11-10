"use client";

import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const chartData = [
  { category: "Hey Amir", score: 85 },
  { category: "These are Metrics", score: 78 },
  { category: "We Can Change Them", score: 92 },
  { category: "Using The Prompts", score: 88 },
  { category: "And Other Stuff", score: 81 },
];

const chartConfig = {
  score: {
    label: "Score",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function ScoringChart() {
  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <RadarChart data={chartData}>
        <PolarGrid />
        <PolarAngleAxis dataKey="category" />
        <Radar dataKey="score" fill="var(--color-score)" fillOpacity={0.6} stroke="var(--color-score)" />
        <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
      </RadarChart>
    </ChartContainer>
  );
}
