"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Mode = "halo" | "prism";

const PLACEHOLDER: Record<Mode, string> = {
  halo: "Paste an agent action or trajectory…",
  prism: "Paste text to scan for sensitive data…",
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("halo");
  const [draft, setDraft] = useState("");

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim()) return;
    // wiring comes next
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex justify-center py-4">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value as Mode);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="halo" className="px-5 text-xs font-medium tracking-wide">
            HALO
          </ToggleGroupItem>
          <ToggleGroupItem value="prism" className="px-5 text-xs font-medium tracking-wide">
            PRISM
          </ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="flex flex-1 items-center justify-center px-4">
        <form
          onSubmit={send}
          className="relative w-full max-w-xl rounded-2xl border bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={PLACEHOLDER[mode]}
            rows={1}
            className="max-h-48 min-h-[56px] resize-none border-0 bg-transparent px-4 py-4 pr-14 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <div className="absolute bottom-2.5 right-2.5">
            <Button
              type="submit"
              size="icon"
              className="size-8 rounded-full"
              disabled={!draft.trim()}
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
