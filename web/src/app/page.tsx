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
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  }

  return (
    <main className="flex h-screen flex-col bg-background">
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

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6 px-6 pb-6">
        <form
          onSubmit={send}
          className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={PLACEHOLDER[mode]}
            className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-5 py-4 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to send</span>
            <Button type="submit" size="sm" className="gap-1.5" disabled={!draft.trim()}>
              Send
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </form>

        <div />
      </div>
    </main>
  );
}
