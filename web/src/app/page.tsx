"use client";

import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Mode = "halo" | "prism";

export default function Home() {
  const [mode, setMode] = useState<Mode>("halo");

  return (
    <main className="min-h-screen bg-background">
      <div className="flex justify-center pt-6">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value as Mode);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="halo" className="px-4 text-xs font-medium tracking-wide">
            HALO
          </ToggleGroupItem>
          <ToggleGroupItem value="prism" className="px-4 text-xs font-medium tracking-wide">
            PRISM
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </main>
  );
}
