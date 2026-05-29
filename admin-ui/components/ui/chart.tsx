"use client";

// shadcn/ui chart primitives (recharts wrapper). Trimmed to what the
// dashboard uses: ChartContainer (theme/CSS-var injection + responsive
// wrapper), ChartTooltip + ChartTooltipContent, and the ChartConfig type.

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  };
};

type ChartContextProps = { config: ChartConfig };
const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const ctx = React.useContext(ChartContext);
  if (!ctx) throw new Error("useChart must be used within a <ChartContainer />");
  return ctx;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-tooltip-cursor]:stroke-border",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, c]) => c.color);
  if (!colorConfig.length) return null;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colorConfig
          .map(([key, c]) => (c.color ? `  --color-${key}: ${c.color};` : null))
          .filter(Boolean)
          .join("\n")}\n}`,
      }}
    />
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  hideLabel = false,
  className,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; dataKey?: string; color?: string; payload?: Record<string, unknown> }>;
  label?: React.ReactNode;
  labelFormatter?: (label: React.ReactNode) => React.ReactNode;
  formatter?: (value: number | string, name: string) => React.ReactNode;
  hideLabel?: boolean;
  className?: string;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  return (
    <div
      className={cn(
        "grid min-w-[8rem] gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-md",
        className,
      )}
    >
      {!hideLabel && (
        <div className="font-medium">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      {payload.map((item, i) => {
        const key = item.dataKey ?? item.name ?? `item-${i}`;
        const cfg = config[key as string];
        return (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block size-2 rounded-[2px]"
                style={{ background: item.color ?? cfg?.color ?? "var(--color-primary)" }}
              />
              {cfg?.label ?? item.name ?? key}
            </span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {formatter && item.value != null
                ? formatter(item.value, String(item.name ?? key))
                : item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartStyle, useChart };
